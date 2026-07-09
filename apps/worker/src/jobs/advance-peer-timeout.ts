/**
 * advance-peer-timeout.ts
 *
 * 同事评价超时自动放行（硬化3，防一人卡全链）。cron 每日 09:10（跟在 advance-self-timeout 09:05 之后）。
 * spec 2026-07-08 performance-review-module §3.3 §5 §10.7 + Harvey 2026-07-08 硬化3：
 *   pending_peer_manager 且已过 stage_deadlines.peer_manager 且 peer sheet 未 submitted
 *   → peer_skipped=true；门控视同「同事已完成」重算 stage：
 *     非 mgmt_required 且直属已完成（或无直属 sheet）→ scored；
 *     其余（mgmt_required 时直属尚未提交，否则不会停在本状态）→ 维持 pending_peer_manager。
 *
 * 幂等：只选 stage=pending_peer_manager 且 peer_skipped=false 的任务；放行后重复执行不再命中。
 * 无指定同事 / peer 已提交 → 跳过（不放行）。
 * 支持 dry-run + 单测 + scripts/run-advance-peer-timeout-once.ts。
 */

import { createDb, type Database } from '@leader-sync/db';
import { quarterTask, quarterSheet } from '@leader-sync/db';
import { and, eq, inArray } from 'drizzle-orm';
import { config } from '../config';

let _defaultDb: Database | null = null;
function defaultDb(): Database {
  if (!_defaultDb) _defaultDb = createDb(config.databaseUrl);
  return _defaultDb;
}

export interface AdvancePeerTimeoutOptions {
  now?: Date;
  dryRun?: boolean;
  db?: Database;
}

export interface AdvancePeerTimeoutResult {
  checked: number; // 处于 pending_peer_manager 且未放行的任务数
  skipped: number; // 本次放行（peer_skipped=true）的任务数
  scored: number; // 放行后推进到 scored 的任务数
  dryRun: boolean;
}

export async function runAdvancePeerTimeout(opts: AdvancePeerTimeoutOptions = {}): Promise<AdvancePeerTimeoutResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? false;
  const db = opts.db ?? defaultDb();

  const rows: any[] = await db
    .select()
    .from(quarterTask)
    .where(and(eq(quarterTask.stage, 'pending_peer_manager'), eq(quarterTask.enrolled, true)));

  const result: AdvancePeerTimeoutResult = { checked: rows.length, skipped: 0, scored: 0, dryRun };

  // 过滤已超时且尚未放行的任务
  const timedOut = rows.filter((t) => {
    if (t.peerSkipped) return false;
    const dl = t.stageDeadlines?.peer_manager;
    if (!dl) return false;
    const deadline = new Date(dl);
    if (Number.isNaN(deadline.getTime())) return false;
    return now > deadline;
  });

  if (timedOut.length === 0) {
    console.log(`  [advance-peer-timeout] checked=${result.checked} skipped=0 scored=0${dryRun ? ' [DRY-RUN]' : ''}`);
    return result;
  }

  // 拉这些任务的全部 sheet，按 task 分组，判定 peer/manager 状态
  const taskUids = timedOut.map((t) => t.taskUid);
  const sheets: any[] = await db.select().from(quarterSheet).where(inArray(quarterSheet.taskUid, taskUids));
  const sheetsByTask = new Map<string, any[]>();
  for (const s of sheets) {
    const arr = sheetsByTask.get(s.taskUid);
    if (arr) arr.push(s);
    else sheetsByTask.set(s.taskUid, [s]);
  }

  for (const t of timedOut) {
    const ts = sheetsByTask.get(t.taskUid) ?? [];
    const peer = ts.find((s) => s.raterRole === 'peer');
    if (!peer) continue; // 未指定同事：无同事可放行（缺席由合成阶段处理）
    if (peer.status === 'submitted') continue; // 同事已提交：不该在此状态，安全跳过

    const manager = ts.find((s) => s.raterRole === 'manager');
    const managerDone = !manager || manager.status === 'submitted';
    // pending_peer_manager 下 mgmt_required 意味着直属尚未提交（否则会在 pending_mgmt）
    // → 维持本状态等直属；非 mgmt 且直属已完成 → scored。
    const newStage = !t.mgmtRequired && managerDone ? 'scored' : 'pending_peer_manager';

    if (!dryRun) {
      await db
        .update(quarterTask)
        .set({ peerSkipped: true, stage: newStage, updatedAt: now })
        .where(eq(quarterTask.taskUid, t.taskUid));
    }
    result.skipped++;
    if (newStage === 'scored') result.scored++;
  }

  console.log(
    `  [advance-peer-timeout] checked=${result.checked} skipped=${result.skipped} scored=${result.scored}${dryRun ? ' [DRY-RUN]' : ''}`,
  );
  return result;
}
