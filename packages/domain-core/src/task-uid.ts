import { nanoid } from 'nanoid';

export function generateTaskUid(): string {
  return `task_${nanoid(16)}`;
}

export function generateLogUid(): string {
  return `log_${nanoid(16)}`;
}

export function generateSnapshotUid(): string {
  return `snap_${nanoid(16)}`;
}
