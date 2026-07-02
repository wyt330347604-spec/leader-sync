// 一次性手动执行飞书通讯录上下级同步。
// 前提：飞书后台已开通讯录只读权限（contact:contact.base:readonly）。
// 用法：
//   tsx apps/worker/src/scripts/run-org-sync-once.ts --dry-run   # 预览，不写库
//   tsx apps/worker/src/scripts/run-org-sync-once.ts             # 正式同步
import 'dotenv/config';
import { runSyncOrgHierarchy } from '../jobs/sync-org-hierarchy';

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');

  console.log(`[run-org-sync-once] dryRun=${dryRun}`);
  const result = await runSyncOrgHierarchy({ dryRun });
  console.log('[run-org-sync-once] result:', JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('[run-org-sync-once] FAILED:', err.message ?? err);
  process.exit(1);
});
