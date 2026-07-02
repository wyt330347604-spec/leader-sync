import 'dotenv/config';
import { registerJob } from './lib/cron';
import { runSyncInbound } from './jobs/sync-inbound';
import { runSyncOutbound } from './jobs/sync-outbound';
import { runWeeklyReminder } from './jobs/weekly-reminder';
import { runOverdueReminder } from './jobs/overdue-reminder';
import { runMonthlyClose } from './jobs/monthly-close';
import { runScoreEscalation } from './jobs/score-escalation';
import { runSyncOrgHierarchy } from './jobs/sync-org-hierarchy';
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

console.log('All jobs registered. Worker running.');
