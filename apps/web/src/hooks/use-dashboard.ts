'use client';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';

export interface DashboardPeriod {
  readonly mode: 'month' | 'quarter';
  readonly value: string;
}

export function useDashboard(period: DashboardPeriod) {
  let params = '';
  if (period.mode === 'quarter') params = `?quarter=${period.value}`;
  else params = `?month=${period.value}`;

  return useSWR(
    `/api/v1/dashboard/boss${params}`,
    (url) => apiFetch<any>(url),
  );
}
