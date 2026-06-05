'use client';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';

export interface DashboardPeriod {
  readonly mode: 'month' | 'quarter';
  readonly value: string;
}

export function useDashboard(period: DashboardPeriod, enabled = true) {
  let params = '';
  if (period.mode === 'quarter') params = `?quarter=${period.value}`;
  else params = `?month=${period.value}`;

  // enabled=false（无全员概览权限）→ key 为 null，SWR 不发请求，避免 403。
  return useSWR(
    enabled ? `/api/v1/dashboard/boss${params}` : null,
    (url) => apiFetch<any>(url),
  );
}
