'use client';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';

export function useTask(taskUid: string | null) {
  return useSWR(
    taskUid ? `/api/v1/tasks/${taskUid}` : null,
    (url) => apiFetch<any>(url),
  );
}
