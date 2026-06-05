'use client';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';
import type { PaginatedData } from '@leader-sync/shared-types';

export function useTasks(query: { status?: string; role?: string; page?: number; page_size?: number; bucket?: string; from?: string }) {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.role && query.role !== 'all') params.set('role', query.role);
  if (query.page) params.set('page', String(query.page));
  if (query.page_size) params.set('page_size', String(query.page_size ?? 20));
  if (query.bucket) params.set('bucket', query.bucket);
  if (query.from) params.set('from', query.from);

  const key = `/api/v1/me/tasks?${params.toString()}`;
  return useSWR(key, (url) => apiFetch<PaginatedData<any>>(url));
}
