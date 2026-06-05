import { createDb } from '@leader-sync/db';
import { task, externalMapping } from '@leader-sync/db';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { config } from '../config';
import { feishuApi } from '../services/feishu-api';
import { taskToBitableFields, computeHash } from '../services/sync-engine';

const defaultDb = createDb(config.databaseUrl);

type Db = typeof defaultDb;
type FeishuApi = Pick<typeof feishuApi, 'updateBitableRecord' | 'createBitableRecords'>;

export interface SyncOutboundDeps {
  db?: Db;
  feishu?: FeishuApi;
}

/** 多维表格记录已被删除时 Feishu 返回的错误（msg 含 RecordIdNotFound）。 */
function isRecordGone(err: unknown): boolean {
  return /RecordIdNotFound/i.test((err as Error)?.message ?? '');
}

export async function runSyncOutbound(deps: SyncOutboundDeps = {}): Promise<void> {
  const db = deps.db ?? defaultDb;
  const feishu = deps.feishu ?? feishuApi;

  // 在多维表格新建记录并写入映射。返回是否成功。
  async function createRecordAndMapping(t: any, fields: Record<string, any>, hash: string): Promise<boolean> {
    const recordIds = await feishu.createBitableRecords([{ fields }]);
    if (!recordIds[0]) return false;
    await db.insert(externalMapping).values({
      taskUid: t.taskUid,
      sourceType: 'bitable',
      externalObjectId: recordIds[0],
      externalParentId: `${config.bitableAppToken}/${config.bitableTableId}`,
      syncVersion: 1,
      lastSyncHash: hash,
      lastSyncAt: new Date(),
      syncStatus: 'success',
    });
    return true;
  }

  // 1. 拉取所有未删除、非私有任务及其 bitable 映射
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
    // 私有任务不推送到公司共享多维表格。
    .where(and(isNull(task.deletedAt), sql`${task.visibility} <> 'private'`));

  let updated = 0, created = 0, skipped = 0, recreated = 0;

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
        await feishu.updateBitableRecord(m.externalObjectId, bitableFields);
        await db.update(externalMapping)
          .set({ lastSyncHash: newHash, lastSyncAt: new Date(), syncStatus: 'success' })
          .where(eq(externalMapping.id, m.id));
        updated++;
      } catch (err) {
        if (isRecordGone(err)) {
          // 自愈：多维表格里该记录已被删 → 删除失效映射并重建，而非永久 failed。
          console.warn(`  Outbound: bitable record gone for ${t.taskUid}, recreating...`);
          try {
            await db.delete(externalMapping).where(eq(externalMapping.id, m.id));
            if (await createRecordAndMapping(t, bitableFields, newHash)) recreated++;
          } catch (e2) {
            console.warn(`  Outbound recreate failed for ${t.taskUid}:`, (e2 as Error).message);
          }
        } else {
          console.warn(`  Outbound update failed for ${t.taskUid}:`, (err as Error).message);
          await db.update(externalMapping)
            .set({ syncStatus: 'failed' })
            .where(eq(externalMapping.id, m.id));
        }
      }
    } else {
      // No mapping — create new Bitable record
      try {
        if (await createRecordAndMapping(t, bitableFields, newHash)) created++;
      } catch (err) {
        console.warn(`  Outbound create failed for ${t.taskUid}:`, (err as Error).message);
      }
    }
  }

  if (updated > 0 || created > 0 || recreated > 0) {
    console.log(`  Outbound: ${updated} updated, ${created} created, ${recreated} recreated, ${skipped} skipped`);
  }
}
