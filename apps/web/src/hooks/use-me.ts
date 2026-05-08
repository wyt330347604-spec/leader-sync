'use client';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';

export interface CurrentUser {
  readonly user_id: string;
  readonly open_id?: string;
  readonly user_name?: string;
  readonly dept_id?: string;
  readonly dept_name?: string;
  readonly manager_user_id?: string;
  readonly manager_name?: string;
}

export function useMe() {
  return useSWR<CurrentUser>('/api/v1/auth/me', (url: string) => apiFetch<CurrentUser>(url));
}
