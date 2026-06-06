'use client';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';

export type ProjectHealth = 'on_track' | 'at_risk' | 'overdue';

export interface PortfolioTask {
  readonly taskUid: string;
  readonly title: string;
  readonly status: string;
  readonly progressPercent: number;
  readonly startAt: string | null;
  readonly dueAt: string | null;
  readonly overdue: boolean;
}

export interface PortfolioNode {
  readonly projectUid: string;
  readonly name: string;
  readonly category: string | null;
  readonly region: string | null;
  readonly ownerName: string | null;
  readonly picUserId: string | null;
  readonly picName: string | null;
  readonly isDefault: boolean;
  readonly parentProjectUid: string | null;
  readonly progress: number;
  readonly counts: { total: number; done: number; overdue: number };
  readonly spanStart: string | null;
  readonly spanEnd: string | null;
  readonly health: ProjectHealth;
  readonly incidentCount?: number;
  readonly requirementCount?: number;
  readonly requirementOnLineCount?: number;
  // R0 业务线(顶级)字段
  readonly isBusinessLine?: boolean;
  readonly appCount?: number;
  readonly atRiskCount?: number;
  readonly overdueCount?: number;
  readonly tasks?: readonly PortfolioTask[];
  readonly subProjects?: readonly PortfolioNode[];
}

/** 项目组合视图（项目→子项目两级树 + 健康度滚动汇总）。enabled=false 不发请求。 */
export function useProjectPortfolio(enabled = true) {
  return useSWR(
    enabled ? '/api/v1/dashboard/projects' : null,
    (url) => apiFetch<PortfolioNode[]>(url),
  );
}
