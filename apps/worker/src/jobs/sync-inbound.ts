import { createDb } from '@leader-sync/db';
import { task, externalMapping, taskProgressLog } from '@leader-sync/db';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import { feishuApi } from '../services/feishu-api';
import { bitableToTaskFields, computeHash } from '../services/sync-engine';
import { generateTaskUid, generateLogUid } from '@leader-sync/domain-core';

const db = createDb(config.databaseUrl);

export async function runSyncInbound(): Promise<void> {
  // 1. Fetch all Bitable records
  const records = await feishuApi.listBitableRecords();

  // 2. Load all existing mappings
  const mappings = await db.select().from(externalMapping)
    .where(eq(externalMapping.sourceType, 'bitable'));
  const mappingByRecordId = new Map(mappings.map(m => [m.externalObjectId, m]));

  let updated = 0, created = 0, skipped = 0;

  for (const record of records) {
    const recordId = record.record_id as string;
    const mapping = mappingByRecordId.get(recordId);

    // Extract fields from Bitable
    const incomingFields = bitableToTaskFields(record);
    if (!incomingFields.title && !mapping) { skipped++; continue; } // skip empty new records

    const incomingHash = computeHash(incomingFields);

    if (mapping) {
      // Existing task — check if changed
      if (mapping.lastSyncHash === incomingHash) { skipped++; continue; }

      // Update DB task
      const updateFields: Record<string, unknown> = { ...incomingFields, updatedAt: new Date() };
      await db.update(task)
        .set(updateFields)
        .where(eq(task.taskUid, mapping.taskUid));

      // Write progress log
      await db.insert(taskProgressLog).values({
        logUid: generateLogUid(),
        taskUid: mapping.taskUid,
        sourceType: 'bitable',
        logText: 'Synced from Bitable',
        createdAt: new Date(),
      });

      // Update mapping
      await db.update(externalMapping)
        .set({ lastSyncHash: incomingHash, lastSyncAt: new Date(), syncStatus: 'success' })
        .where(eq(externalMapping.id, mapping.id));

      updated++;
    } else {
      // New record in Bitable — create task in DB
      if (!incomingFields.dueAt) { skipped++; continue; } // must have due date

      const taskUid = generateTaskUid();
      const now = new Date();
      const dueAt = new Date(incomingFields.dueAt as string | number);
      const monthBucket = `${dueAt.getFullYear()}-${String(dueAt.getMonth() + 1).padStart(2, '0')}`;

      await db.insert(task).values({
        taskUid,
        title: (incomingFields.title as string) || 'Untitled',
        detail: (incomingFields.detail as string) || null,
        taskType: 'new',
        priority: (incomingFields.priority as string) || 'urgent_important',
        status: (incomingFields.status as string) || 'pending',
        progressPercent: (incomingFields.progressPercent as number) || 0,
        latestProgress: (incomingFields.latestProgress as string) || null,
        assigneeUserId: (incomingFields.assigneeUserId as string) || 'unknown',
        assigneeName: (incomingFields.assigneeName as string) || '',
        leaderUserId: 'unknown',
        issuerUserId: 'bitable_user',
        assignerUserId: 'bitable_user',
        assignmentType: 'self_claim',
        dueAt,
        startAt: (incomingFields.startAt as Date) || null,
        completedAt: (incomingFields.completedAt as Date) || null,
        monthBucket,
        sourceMonth: monthBucket,
        version: 1,
        createdBy: 'sync_inbound',
        createdAt: now,
        updatedAt: now,
      });

      // Create mapping
      await db.insert(externalMapping).values({
        taskUid,
        sourceType: 'bitable',
        externalObjectId: recordId,
        externalParentId: `${config.bitableAppToken}/${config.bitableTableId}`,
        syncVersion: 1,
        lastSyncHash: incomingHash,
        lastSyncAt: now,
        syncStatus: 'success',
      });

      created++;
    }
  }

  if (updated > 0 || created > 0) {
    console.log(`  Inbound: ${updated} updated, ${created} created, ${skipped} skipped`);
  }
}
