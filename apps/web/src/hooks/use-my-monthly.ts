'use client';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';

export interface MyMonthlySummary {
  readonly month: string;
  readonly userId: string;
  readonly userName: string;
  readonly total: number;
  readonly done: number;
  readonly inProgress: number;
  readonly overdue: number;
  readonly completionRate: number;
  readonly carriedOver: number;
  readonly delayTotal: number;
}

export function useMyMonthly(month: string, enabled = true) {
  const params = month ? `?month=${month}` : '';
  return useSWR<MyMonthlySummary>(
    enabled ? `/api/v1/dashboard/me/monthly${params}` : null,
    (url: string) => apiFetch<MyMonthlySummary>(url),
  );
}
