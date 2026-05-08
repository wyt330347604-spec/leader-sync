import { TaskStatusLabel, PriorityLabel, TaskTypeLabel, BitableStatusMap, BitablePriorityMap } from '@leader-sync/shared-types';
import crypto from 'node:crypto';

// DB -> Bitable field mapping
export function taskToBitableFields(task: any): Record<string, any> {
  const fields: Record<string, any> = {
    '待办事项': task.title || '',
    '任务详情': task.detail || '',
    '任务类型': TaskTypeLabel[task.taskType] || '本月新增',
    '进展': TaskStatusLabel[task.status] || '待办',
    '重要紧急程度': PriorityLabel[task.priority] || '重要紧急',
    '部门': task.assigneeDeptName || '',
    '进度百分比': task.progressPercent || 0,
    '最新进展记录': task.latestProgress || '',
    '剩余天数': task.daysToDue || 0,
    '是否延期': task.isOverdue ? '已延期' : '正常',
    '归属月份': task.monthBucket || '',
    '重点任务': task.bossAttentionFlag || false,
  };
  if (task.assigneeUserId?.startsWith('ou_')) {
    fields['任务负责人'] = [{ id: task.assigneeUserId }];
  }
  if (task.assigneeManagerUserId?.startsWith('ou_')) {
    fields['直属上级'] = [{ id: task.assigneeManagerUserId }];
  }
  if (task.startAt) fields['开始日期'] = new Date(task.startAt).getTime();
  if (task.dueAt) fields['预计完成日期'] = new Date(task.dueAt).getTime();
  if (task.completedAt) fields['实际完成日期'] = new Date(task.completedAt).getTime();
  return fields;
}

// Bitable -> DB field mapping
export function bitableToTaskFields(record: any): Record<string, any> {
  const f = record.fields;
  const result: Record<string, any> = {};

  // Text fields
  const title = extractText(f['待办事项']);
  if (title) result.title = title;
  const detail = extractText(f['任务详情']);
  if (detail !== undefined) result.detail = detail;
  const progress = extractText(f['最新进展记录']);
  if (progress !== undefined) result.latestProgress = progress;

  // Select fields -> enum mapping
  const statusCn = f['进展'];
  if (statusCn && BitableStatusMap[statusCn]) result.status = BitableStatusMap[statusCn];
  const priorityCn = f['重要紧急程度'];
  if (priorityCn && BitablePriorityMap[priorityCn]) result.priority = BitablePriorityMap[priorityCn];

  // Number
  if (f['进度百分比'] !== undefined && f['进度百分比'] !== null) {
    result.progressPercent = Math.min(100, Math.max(0, Math.round(f['进度百分比'])));
  }

  // Person fields
  const assignee = f['任务负责人'];
  if (Array.isArray(assignee) && assignee[0]?.id) {
    result.assigneeUserId = assignee[0].id;
    result.assigneeName = assignee[0].name || '';
  }

  // Date fields (ms -> Date)
  if (f['开始日期']) result.startAt = new Date(f['开始日期']);
  if (f['预计完成日期']) result.dueAt = new Date(f['预计完成日期']);
  if (f['实际完成日期']) result.completedAt = new Date(f['实际完成日期']);

  return result;
}

function extractText(val: any): string | undefined {
  if (!val) return undefined;
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.map((v: any) => v?.text || '').join('');
  if (val?.text) return val.text;
  return undefined;
}

// Compute hash of fields for change detection
export function computeHash(fields: Record<string, any>): string {
  const sorted = JSON.stringify(fields, Object.keys(fields).sort());
  return crypto.createHash('md5').update(sorted).digest('hex').slice(0, 16);
}
