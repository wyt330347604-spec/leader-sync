// 一次性开季度打分窗口（open-quarter-window 的独立版，演练/补跑用）。
// 幂等：cycle/task/sheet 唯一索引 + onConflictDoNothing，可重复执行只补缺失。
// 用法：
//   tsx apps/worker/src/scripts/run-open-quarter-window-once.ts --dry-run              # 按当前时间算刚结束季度，预览
//   tsx apps/worker/src/scripts/run-open-quarter-window-once.ts --quarter 2026-Q2      # 显式指定季度，正式开窗
//   tsx apps/worker/src/scripts/run-open-quarter-window-once.ts --quarter 2026-Q2 --dry-run
import 'dotenv/config';
import { runOpenQuarterWindow } from '../jobs/open-quarter-window';

async function main() {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const qIdx = argv.indexOf('--quarter');
  const quarter = qIdx >= 0 ? argv[qIdx + 1] : undefined;
  const dryRun = args.has('--dry-run');

  if (quarter && !/^\d{4}-Q[1-4]$/.test(quarter)) {
    console.error('用法: run-open-quarter-window-once.ts [--quarter YYYY-QN] [--dry-run]');
    process.exit(1);
  }

  console.log(`[run-open-quarter-window-once] quarter=${quarter ?? '(按 now 推算)'} dryRun=${dryRun}`);
  const result = await runOpenQuarterWindow({ quarter, dryRun });
  console.log('[run-open-quarter-window-once] result:', JSON.stringify(result, null, 2));
  if (result.noManager > 0 || result.noPeer > 0) {
    console.warn(
      `[run-open-quarter-window-once] ⚠️ ${result.noManager} 人无直属、${result.noPeer} 人未指定同事——` +
        '相应 manager/peer 打分表未生成，请在周期管理页补齐。',
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[run-open-quarter-window-once] FAILED:', err?.message ?? err);
  process.exit(1);
});
