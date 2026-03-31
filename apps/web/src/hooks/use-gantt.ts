'use client';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';
import type { DashboardPeriod } from './use-dashboard';

export function useGantt(period: DashboardPeriod) {
  let params = '';
  if (period.mode === 'year') params = `?year=${period.value}`;
  else if (period.mode === 'quarter') params = `?quarter=${period.value}`;
  else params = `?month=${period.value}`;

  return useSWR(
    `/api/v1/dashboard/gantt${params}`,
    (url) => apiFetch<any>(url),
  );
}
