/**
 * score-escalation.ts
 *
 * Daily 09:00 Asia/Shanghai cron job.
 * Checks for challenged monthly_score records that have exceeded 48h without a
 * rater response, notifies PMO + CCs the ratee via Feishu card.
 *
 * Idempotency: escalated_at IS NULL filter ensures each challenge only escalates once.
 * dry-run mode: no Feishu message sent, no DB write — only console output.
 */

import { createDb } from '@leader-sync/db';
import { monthlyScore, orgCache, userRoleBinding } from '@leader-sync/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { config } from '../config';
import { feishuApi } from '../services/feishu-api';
import { buildEscalationCard } from '../services/message-builder';

const db = createDb(config.databaseUrl);

// 48h in milliseconds
const ESCALATION_THRESHOLD_MS = 48 * 60 * 60 * 1000;

export async function runScoreEscalation(dryRun = false): Promise<void> {
  console.log(`  [score-escalation] Starting${dryRun ? ' (DRY RUN)' : ''}...`);

  const now = new Date();
  const cutoffTime = new Date(now.getTime() - ESCALATION_THRESHOLD_MS);

  // 1. Find all challenged scores that are overdue for escalation
  const overdueScores = await db
    .select()
    .from(monthlyScore)
    .where(
      and(
        eq(monthlyScore.status, 'challenged'),
        sql`${monthlyScore.challengedAt} IS NOT NULL`,
        sql`${monthlyScore.challengedAt} < ${cutoffTime.toISOString()}`,
        isNull(monthlyScore.escalatedAt),
      ),
    );

  if (overdueScores.length === 0) {
    console.log('  [score-escalation] No overdue challenges found.');
    return;
  }

  console.log(`  [score-escalation] Found ${overdueScores.length} overdue challenge(s)`);

  // 2. Fetch PMO users (open_id needed for Feishu message)
  const pmoRows = await db.execute(
    sql`SELECT DISTINCT oc.open_id AS open_id, oc.user_id AS user_id
        FROM user_role_binding urb
        JOIN org_cache oc ON oc.user_id = urb.user_id
        WHERE urb.role IN ('pmo', 'boss', 'admin')
          AND oc.open_id IS NOT NULL`,
  ) as unknown as Array<{ open_id: string; user_id: string }>;

  const pmoOpenIds = pmoRows.map((r) => r.open_id).filter(Boolean);

  let escalatedCount = 0;

  for (const score of overdueScores) {
    try {
      // Build card
      const card = buildEscalationCard(
        score.rateeName ?? score.rateeUserId,
        score.raterName ?? score.raterUserId,
        score.challengedAt!,
        score.scoreUid,
      );

      if (!dryRun) {
        // Notify all PMO users
        for (const openId of pmoOpenIds) {
          await feishuApi.sendCardMessage(openId, card);
        }

        // CC the ratee employee (if they have an open_id)
        const [rateeOrg] = await db
          .select()
          .from(orgCache)
          .where(eq(orgCache.userId, score.rateeUserId))
          .limit(1);

        const rateeOpenId: string = (rateeOrg as any)?.openId ?? (rateeOrg as any)?.open_id ?? '';
        if (rateeOpenId && rateeOpenId.startsWith('ou_')) {
          await feishuApi.sendCardMessage(rateeOpenId, card);
        }

        // Mark as escalated (idempotency guard)
        await db
          .update(monthlyScore)
          .set({ escalatedAt: now, updatedAt: now })
          .where(eq(monthlyScore.scoreUid, score.scoreUid));

        escalatedCount++;
      } else {
        console.log(`  [DRY RUN] Would escalate: scoreUid=${score.scoreUid} ratee=${score.rateeName ?? score.rateeUserId} rater=${score.raterName ?? score.raterUserId}`);
        escalatedCount++;
      }
    } catch (err) {
      console.warn(`  [score-escalation] Failed for ${score.scoreUid}:`, (err as Error).message);
    }
  }

  console.log(`  [score-escalation] Escalated ${escalatedCount}/${overdueScores.length} records`);
}
