import 'dotenv/config';
import { registerJob } from './lib/cron';
import { runSyncInbound } from './jobs/sync-inbound';
import { runSyncOutbound } from './jobs/sync-outbound';
import { runWeeklyReminder } from './jobs/weekly-reminder';
import { runOverdueReminder } from './jobs/overdue-reminder';
import { runMonthlyClose } from './jobs/monthly-close';
import { runScoreEscalation } from './jobs/score-escalation';
import { runSyncOrgHierarchy } from './jobs/sync-org-hierarchy';
import { runSyncDepartments } from './jobs/sync-departments';
import { runSyncPerfRoles } from './jobs/sync-perf-roles';
import { runOpenQuarterWindow } from './jobs/open-quarter-window';
import { runAdvanceSelfTimeout } from './jobs/advance-self-timeout';
import { runAdvancePeerTimeout } from './jobs/advance-peer-timeout';
import { runQuarterDeadlineReminder } from './jobs/quarter-deadline-reminder';
import { runConvenePanelCheck } from './jobs/convene-panel-check';
// feishu-bot: message handler (not a cron). handleFeishuBotMessage() is called
// by the NestJS API's feishu-bot webhook controller, not registered here as a cron.
// Import is retained to ensure the module is bundled and types are available.
import type { handleFeishuBotMessage as _HandleFeishuBotMessage } from './jobs/feishu-bot';

console.log('Leader-Sync Worker starting...');
console.log(`Database: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@')}`);

// Sync: every 1 minute
registerJob('sync-inbound', '*/1 * * * *', runSyncInbound);
registerJob('sync-outbound', '*/1 * * * *', runSyncOutbound);

// Weekly reminder: Monday 09:00
registerJob('weekly-reminder', '0 9 * * 1', runWeeklyReminder);

// Overdue reminder: daily 10:00
registerJob('overdue-reminder', '0 10 * * *', runOverdueReminder);

// Monthly close: 1st of month 08:00
registerJob('monthly-close', '0 8 1 * *', async () => {
  await runMonthlyClose();
});

// Score escalation: daily 09:00 Asia/Shanghai — checks 48h-overdue challenges
registerJob('score-escalation', '0 9 * * *', runScoreEscalation);

// Org hierarchy sync: daily 07:00 — 早于月结 08:00，保证打分 rater 数据新鲜。
// 通讯录权限未开时抛 OrgSyncPermissionError（cron 包装捕获记录，不影响其他任务）。
registerJob('sync-org-hierarchy', '0 7 * * *', async () => {
  await runSyncOrgHierarchy();
});

// Department tree + join dates: daily 07:05 — 紧跟 org 同步，供绩效一级部门排除规则/新人规则。
registerJob('sync-departments', '5 7 * * *', async () => {
  await runSyncDepartments();
});

// Perf role sync: daily 07:10 — org 同步之后，拉两个飞书群成员置 perf_role 打分身份。
registerJob('sync-perf-roles', '10 7 * * *', async () => {
  await runSyncPerfRoles();
});

// Open quarter window: 季度结束次日 08:05（每季首日 1,4,7,10 月 1 日）—— 建 cycle + 生成任务/打分表 + 发「待自评」卡。
registerJob('open-quarter-window', '5 8 1 1,4,7,10 *', async () => {
  await runOpenQuarterWindow({ sendCards: true });
});

// Advance self-review timeout: daily 09:05 —— pending_self 超时自动放行下一环（标 self_skipped）。
registerJob('advance-self-timeout', '5 9 * * *', async () => {
  await runAdvanceSelfTimeout();
});

// Advance peer timeout: daily 09:10 —— pending_peer_manager 同事超时自动放行（标 peer_skipped，硬化3）。
registerJob('advance-peer-timeout', '10 9 * * *', async () => {
  await runAdvancePeerTimeout();
});

// Quarter deadline reminder: daily 09:15 —— 当前环节截止 T-2d 内给未完成 sheet 的人发催办卡。
registerJob('quarter-deadline-reminder', '15 9 * * *', async () => {
  await runQuarterDeadlineReminder();
});

// Convene panel check: daily 09:20 —— scoring 周期全部 enrolled 任务 scored → 转 panel + 发管理层召集卡。
// 触发条件保守（全 scored 才召集），时间/阈值口径待全面测试后收口。
registerJob('convene-panel-check', '20 9 * * *', async () => {
  await runConvenePanelCheck();
});

// 评分会前一天给管理层发个人清单卡（buildPanelEveCard）：触发时机依赖 quarter_cycle.panel_at
// 配置——待各周期 panel_at 落库后，可加一个每日 08:30 job 扫描「panel_at 在明天」的周期并下发。
// 当前 cycle 多无 panel_at（P2/P3 未强制设置），故先只交付 builder + 单测，job 接线待 panel_at 就绪。

console.log('All jobs registered. Worker running.');
