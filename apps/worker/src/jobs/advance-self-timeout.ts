/**
 * advance-self-timeout.ts
 *
 * 自评超时自动放行（防一人卡全链）。cron 每日 09:05。
 * spec 2026-07-08 performance-review-module §3.3 §5 §10.7：
 *   pending_self 且已过 stage_deadlines.self → self_skipped=true、
 *   stage → pending_peer_manager（自评 sheet 保持 draft 不删）。
 *
 * 幂等：只选 stage=pending_self 的任务；推进后 stage 变更，重复执行不再命中。
 * 支持 dry-run + 单测 + scripts/run-advance-self-timeout-once.ts。
 */

import { createDb, type Database } from '@leader-sync/db';
import { quarterTask } from '@leader-sync/db';
import { and, eq } from 'drizzle-orm';
import { config } from '../config';

let _defaultDb: Database | null = null;
function defaultDb(): Database {
  if (!_defaultDb) _defaultDb = createDb(config.databaseUrl);
  return _defaultDb;
}

export interface AdvanceSelfTimeoutOptions {
  now?: Date;
  dryRun?: boolean;
  db?: Database;
}

export interface AdvanceSelfTimeoutResult {
  checked: number;
  advanced: number;
  dryRun: boolean;
}

export async function runAdvanceSelfTimeout(opts: AdvanceSelfTimeoutOptions = {}): Promise<AdvanceSelfTimeoutResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? false;
  const db = opts.db ?? defaultDb();

  // 只看仍在 pending_self 且参评的任务
  const rows: any[] = await db
    .select()
    .from(quarterTask)
    .where(and(eq(quarterTask.stage, 'pending_self'), eq(quarterTask.enrolled, true)));

  const result: AdvanceSelfTimeoutResult = { checked: rows.length, advanced: 0, dryRun };

  for (const t of rows) {
    const selfDeadline = t.stageDeadlines?.self;
    if (!selfDeadline) continue; // 无截止时间：跳过（安全）
    const deadline = new Date(selfDeadline);
    if (Number.isNaN(deadline.getTime())) continue;
    if (now <= deadline) continue; // 未超时

    if (!dryRun) {
      await db
        .update(quarterTask)
        .set({ selfSkipped: true, stage: 'pending_peer_manager', updatedAt: now })
        .where(eq(quarterTask.taskUid, t.taskUid));
    }
    result.advanced++;
  }

  console.log(
    `  [advance-self-timeout] checked=${result.checked} advanced=${result.advanced}${dryRun ? ' [DRY-RUN]' : ''}`,
  );
  return result;
}
