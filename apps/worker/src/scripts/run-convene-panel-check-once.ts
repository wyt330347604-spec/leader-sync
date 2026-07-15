// 一次性运行评分会自动召集检查（convene-panel-check 的独立版）。
// 幂等：只命中 status=scoring 且全部 enrolled 任务 scored 的周期，召集后转 panel 不再命中。
// 用法：
//   tsx apps/worker/src/scripts/run-convene-panel-check-once.ts --dry-run   # 预览将召集的周期数/发卡数
//   tsx apps/worker/src/scripts/run-convene-panel-check-once.ts             # 正式召集 + 发卡
import 'dotenv/config';
import { runConvenePanelCheck } from '../jobs/convene-panel-check';

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  console.log(`[run-convene-panel-check-once] dryRun=${dryRun}`);
  const result = await runConvenePanelCheck({ dryRun });
  console.log('[run-convene-panel-check-once] result:', JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('[run-convene-panel-check-once] FAILED:', err?.message ?? err);
  process.exit(1);
});
