'use client';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';

export interface LeaderWeeklyMember {
  readonly userId: string;
  readonly name: string;
  readonly newCount: number;
  readonly doneCount: number;
  readonly overdueCount: number;
  readonly completionRate: number;
}

export interface LeaderWeeklyData {
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly leaderId: string;
  readonly leaderName: string;
  readonly members: readonly LeaderWeeklyMember[];
  readonly teamSummary: {
    readonly newCount: number;
    readonly doneCount: number;
    readonly overdueCount: number;
    readonly completionRate: number;
  };
}

export function useLeaderWeekly(enabled = true) {
  return useSWR<LeaderWeeklyData>(
    enabled ? '/api/v1/dashboard/leader/weekly' : null,
    (url: string) => apiFetch<LeaderWeeklyData>(url),
  );
}
