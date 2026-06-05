'use client';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';

export interface MemberTaskItem {
  readonly taskUid: string;
  readonly title: string;
  readonly status: string;
  readonly priority: string;
  readonly dueAt: string | null;
  readonly completedAt: string | null;
  readonly isOverdue: boolean;
  readonly progressPercent: number;
  readonly bossAttentionFlag: boolean;
  readonly delayCount: number;
  readonly carryOverCount: number;
}

export interface MemberTasksData {
  readonly month: string;
  readonly userId: string;
  readonly userName: string;
  readonly summary: {
    readonly total: number;
    readonly done: number;
    readonly overdue: number;
    readonly completionRate: number;
  };
  readonly tasks: readonly MemberTaskItem[];
}

export function useLeaderMemberTasks(memberUserId: string | null, month: string, enabled = true) {
  const params = month ? `?month=${month}` : '';
  return useSWR<MemberTasksData>(
    enabled && memberUserId ? `/api/v1/dashboard/leader/monthly/${memberUserId}/tasks${params}` : null,
    (url: string) => apiFetch<MemberTasksData>(url),
  );
}
