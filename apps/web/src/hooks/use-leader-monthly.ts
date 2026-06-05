'use client';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';

export interface LeaderMemberSummary {
  readonly userId: string;
  readonly name: string;
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
  readonly completionRate: number;
}

export interface LeaderMonthlySummary {
  readonly month: string;
  readonly leaderId: string;
  readonly leaderName: string;
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
  readonly completionRate: number;
  readonly members: readonly LeaderMemberSummary[];
}

export function useLeaderMonthly(month: string, enabled = true) {
  const params = month ? `?month=${month}` : '';
  return useSWR<LeaderMonthlySummary>(
    enabled ? `/api/v1/dashboard/leader/monthly${params}` : null,
    (url: string) => apiFetch<LeaderMonthlySummary>(url),
  );
}
