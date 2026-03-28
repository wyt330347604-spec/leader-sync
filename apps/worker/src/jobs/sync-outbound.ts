import { createDb } from '@leader-sync/db';
import { task, externalMapping } from '@leader-sync/db';
import { eq, and, isNull } from 'drizzle-orm';
import { config } from '../config';
import { feishuApi } from '../services/feishu-api';
import { taskToBitableFields, computeHash } from '../services/sync-engine';

const db = createDb(config.databaseUrl);

export async function runSyncOutbound(): Promise<void> {
  // 1. Find tasks updated since last sync
  // Join task with external_mapping, find where task.updated_at > mapping.last_sync_at
  const tasksWithMapping = await db
    .select({
      task: task,
      mapping: externalMapping,
    })
    .from(task)
    .leftJoin(externalMapping, and(
      eq(task.taskUid, externalMapping.taskUid),
      eq(externalMapping.sourceType, 'bitable'),
    ))
    .where(isNull(task.deletedAt));

  let updated = 0, created = 0, skipped = 0;

  for (const row of tasksWithMapping) {
    const t = row.task;
    const m = row.mapping;

    const bitableFields = taskToBitableFields(t);
    const newHash = computeHash(bitableFields);

    if (m) {
      // Has mapping — check if we need to push
      if (m.lastSyncHash === newHash) { skipped++; continue; }
      if (m.lastSyncAt && t.updatedAt && t.updatedAt <= m.lastSyncAt) { skipped++; continue; }

      try {
        await feishuApi.updateBitableRecord(m.externalObjectId, bitableFields);
        await db.update(externalMapping)
          .set({ lastSyncHash: newHash, lastSyncAt: new Date(), syncStatus: 'success' })
          .where(eq(externalMapping.id, m.id));
        updated++;
      } catch (err) {
        console.warn(`  Outbound update failed for ${t.taskUid}:`, (err as Error).message);
        await db.update(externalMapping)
          .set({ syncStatus: 'failed' })
          .where(eq(externalMapping.id, m.id));
      }
    } else {
      // No mapping — create new Bitable record
      try {
        const recordIds = await feishuApi.createBitableRecords([{ fields: bitableFields }]);
        if (recordIds[0]) {
          await db.insert(externalMapping).values({
            taskUid: t.taskUid,
            sourceType: 'bitable',
            externalObjectId: recordIds[0],
            externalParentId: `${config.bitableAppToken}/${config.bitableTableId}`,
            syncVersion: 1,
            lastSyncHash: newHash,
            lastSyncAt: new Date(),
            syncStatus: 'success',
          });
          created++;
        }
      } catch (err) {
        console.warn(`  Outbound create failed for ${t.taskUid}:`, (err as Error).message);
      }
    }
  }

  if (updated > 0 || created > 0) {
    console.log(`  Outbound: ${updated} updated, ${created} created, ${skipped} skipped`);
  }
}
