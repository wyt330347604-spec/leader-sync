'use client';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';

export interface NotificationPreference {
  readonly dailyOverdueEnabled: boolean;
  readonly weeklySummaryEnabled: boolean;
}

export function useNotificationPreference() {
  return useSWR<NotificationPreference>(
    '/api/v1/me/notification-preference',
    (url: string) => apiFetch<NotificationPreference>(url),
  );
}

export async function updateNotificationPreference(
  patch: Partial<NotificationPreference>,
): Promise<NotificationPreference> {
  return apiFetch<NotificationPreference>('/api/v1/me/notification-preference', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
