import cron from 'node-cron';

export function registerJob(name: string, schedule: string, handler: () => Promise<void>) {
  cron.schedule(schedule, async () => {
    const start = Date.now();
    console.log(`[${new Date().toISOString()}] [${name}] Starting...`);
    try {
      await handler();
      console.log(`[${new Date().toISOString()}] [${name}] Done in ${Date.now() - start}ms`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] [${name}] Failed:`, err);
    }
  });
  console.log(`Registered job: ${name} (${schedule})`);
}
