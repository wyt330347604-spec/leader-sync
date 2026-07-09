// 一次性手动执行飞书群成员 → perf_role 同步。
// 凭证：默认生产 FEISHU_APP_ID/SECRET（方案A）；配了 FEISHU_SYNC_APP_ID/SECRET 则用它（方案B）。
// 用法：
//   tsx apps/worker/src/scripts/run-sync-perf-roles-once.ts --dry-run   # 预览对账，不写库
//   tsx apps/worker/src/scripts/run-sync-perf-roles-once.ts             # 正式同步
import 'dotenv/config';
import { runSyncPerfRoles } from '../jobs/sync-perf-roles';

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');

  console.log(`[run-sync-perf-roles-once] dryRun=${dryRun}`);
  const result = await runSyncPerfRoles({ dryRun });
  console.log('[run-sync-perf-roles-once] result:', JSON.stringify(result, null, 2));
  if (result.notFound > 0) {
    console.warn(
      `[run-sync-perf-roles-once] ⚠️ ${result.notFound} 名群成员在 org_cache 查无此人，未写身份。` +
        '请先跑通讯录同步（sync-org-hierarchy）补齐 org_cache。',
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[run-sync-perf-roles-once] FAILED:', err.message ?? err);
  process.exit(1);
});
