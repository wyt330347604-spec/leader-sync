// 一次性推进同事超时任务（advance-peer-timeout 的独立版，硬化3）。
// 幂等：只命中 stage=pending_peer_manager、peer_skipped=false 且已过 stage_deadlines.peer_manager 的任务。
// 用法：
//   tsx apps/worker/src/scripts/run-advance-peer-timeout-once.ts --dry-run   # 预览将放行的任务数
//   tsx apps/worker/src/scripts/run-advance-peer-timeout-once.ts             # 正式推进
import 'dotenv/config';
import { runAdvancePeerTimeout } from '../jobs/advance-peer-timeout';

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  console.log(`[run-advance-peer-timeout-once] dryRun=${dryRun}`);
  const result = await runAdvancePeerTimeout({ dryRun });
  console.log('[run-advance-peer-timeout-once] result:', JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('[run-advance-peer-timeout-once] FAILED:', err?.message ?? err);
  process.exit(1);
});
