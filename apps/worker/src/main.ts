import 'dotenv/config';
import { registerJob } from './lib/cron';
import { runSyncInbound } from './jobs/sync-inbound';
import { runSyncOutbound } from './jobs/sync-outbound';
import { runWeeklyReminder } from './jobs/weekly-reminder';
import { runOverdueReminder } from './jobs/overdue-reminder';
import { runMonthlyClose } from './jobs/monthly-close';

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
registerJob('monthly-close', '0 8 1 * *', runMonthlyClose);

console.log('All jobs registered. Worker running.');
