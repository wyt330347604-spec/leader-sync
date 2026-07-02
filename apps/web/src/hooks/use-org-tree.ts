'use client';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';

export interface OrgTreeUser {
  readonly user_id: string;
  readonly open_id: string | null;
  readonly user_name: string | null;
  readonly manager_user_id: string | null;
  readonly manager_name: string | null;
  readonly manager_source: 'feishu' | 'manual' | string;
  readonly current_grade: string | null;
}

export interface OrgTreeData {
  readonly users: readonly OrgTreeUser[];
  readonly last_feishu_sync_at: string | null;
  /** 服务端按白名单判定（Harvey/杨平），前端仅做 UI 显隐，强校验在服务端 */
  readonly can_edit: boolean;
}

export function useOrgTree() {
  return useSWR<OrgTreeData>('/api/v1/org/tree', (key: string) => apiFetch<OrgTreeData>(key));
}

export async function setManager(userId: string, managerUserId: string | null): Promise<void> {
  await apiFetch(`/api/v1/org/users/${encodeURIComponent(userId)}/manager`, {
    method: 'PATCH',
    body: JSON.stringify({ manager_user_id: managerUserId }),
  });
}

export async function resetManagerToFeishu(userId: string): Promise<void> {
  await apiFetch(`/api/v1/org/users/${encodeURIComponent(userId)}/manager/reset`, {
    method: 'POST',
  });
}
