import 'dotenv/config';
import { runSyncOutbound } from './jobs/sync-outbound';

async function main() {
  console.log('Manual outbound sync started...');
  await runSyncOutbound();
  console.log('Done.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
