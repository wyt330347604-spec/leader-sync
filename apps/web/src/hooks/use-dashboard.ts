'use client';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';

export function useDashboard(month?: string) {
  const params = month ? `?month=${month}` : '';
  return useSWR(
    `/api/v1/dashboard/boss${params}`,
    (url) => apiFetch<any>(url),
  );
}
