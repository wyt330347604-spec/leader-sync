// 一次性手动执行月结（数据补救用）。
// 用法：
//   tsx apps/worker/src/scripts/run-monthly-close-once.ts --dry-run            # 预览，不写库
//   tsx apps/worker/src/scripts/run-monthly-close-once.ts --skip-notifications # 只补继承+快照，不发飞书卡片
import 'dotenv/config';
import { runMonthlyClose } from '../jobs/monthly-close';

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const skipNotifications = args.has('--skip-notifications');

  console.log(`[run-monthly-close-once] dryRun=${dryRun} skipNotifications=${skipNotifications}`);
  const result = await runMonthlyClose({ dryRun, skipNotifications });
  console.log('[run-monthly-close-once] result:', JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('[run-monthly-close-once] FAILED:', err);
  process.exit(1);
});
