'use client';
import useSWR from 'swr';
import { useMemo } from 'react';
import { apiFetch } from '@/lib/api-client';

export interface ProjectLite {
  readonly projectUid: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly parentProjectUid: string | null;
  readonly category: string | null;
  readonly region: string | null;
  readonly ownerName: string | null;
}

/** 全部项目（业务线=顶级 parentProjectUid 为空；app=有 parent）。 */
export function useProjects(enabled = true) {
  const swr = useSWR(
    enabled ? '/api/v1/projects' : null,
    (url) => apiFetch<ProjectLite[]>(url),
  );
  const businessLines = useMemo(
    () => (swr.data ?? []).filter((p) => !p.parentProjectUid),
    [swr.data],
  );
  const appsByLine = useMemo(() => {
    const m = new Map<string, ProjectLite[]>();
    for (const p of swr.data ?? []) {
      if (p.parentProjectUid) {
        const arr = m.get(p.parentProjectUid) ?? [];
        arr.push(p);
        m.set(p.parentProjectUid, arr);
      }
    }
    return m;
  }, [swr.data]);
  return { ...swr, businessLines, appsByLine };
}
