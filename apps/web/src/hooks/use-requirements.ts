'use client';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';

/** 需求实体（后端 drizzle camelCase 行）。 */
export interface Requirement {
  readonly requirementUid: string;
  readonly title: string;
  readonly value: string | null;
  readonly description: string | null;
  readonly businessLineUid: string;
  readonly appProjectUid: string | null;
  readonly source: string;
  readonly priority: string;        // P0/P1/P2
  readonly status: string;          // RequirementStatus
  readonly targetVersion: string | null;
  readonly reporterUserId: string;
  readonly reporterName: string;
  readonly pmUserId: string | null;
  readonly pmName: string | null;
  readonly acceptorUserId: string | null;
  readonly acceptorName: string | null;
  readonly expectedReleaseDate: string | null;
  readonly estEffortDays: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RequirementArtifact {
  readonly id: number;
  readonly requirementUid: string;
  readonly type: string;
  readonly title: string;
  readonly url: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface RequirementTaskRef {
  readonly taskUid: string;
  readonly title: string;
  readonly status: string;
  readonly progressPercent: number | null;
  readonly assigneeName: string;
  readonly estEffortDays: string | null;
  readonly allocationPct: number | null;
  readonly dueAt: string | null;
}

export interface RequirementDetail extends Requirement {
  readonly artifacts: readonly RequirementArtifact[];
  readonly tasks: readonly RequirementTaskRef[];
}

export interface RequirementFilter {
  readonly businessLineUid?: string;
  readonly appProjectUid?: string;
  readonly status?: string;
  readonly priority?: string;
  readonly targetVersion?: string;
}

function toQuery(f: RequirementFilter): string {
  const p = new URLSearchParams();
  if (f.businessLineUid) p.set('business_line_uid', f.businessLineUid);
  if (f.appProjectUid) p.set('app_project_uid', f.appProjectUid);
  if (f.status) p.set('status', f.status);
  if (f.priority) p.set('priority', f.priority);
  if (f.targetVersion) p.set('target_version', f.targetVersion);
  const q = p.toString();
  return q ? `?${q}` : '';
}

/** 需求池列表（行级安全由后端按角色裁剪）。enabled=false 不发请求。 */
export function useRequirements(filter: RequirementFilter = {}, enabled = true) {
  const key = enabled ? `/api/v1/requirements${toQuery(filter)}` : null;
  return useSWR(key, (url) => apiFetch<Requirement[]>(url));
}

/** 单条需求详情（含产出物 + 任务）。 */
export function useRequirement(uid: string | null) {
  return useSWR(
    uid ? `/api/v1/requirements/${uid}` : null,
    (url) => apiFetch<RequirementDetail>(url),
  );
}

export interface CandidateTask {
  readonly taskUid: string;
  readonly title: string;
  readonly status: string;
  readonly progressPercent: number | null;
  readonly assigneeName: string;
  readonly dueAt: string | null;
  readonly projectUid: string | null;
}

/** 候选任务（同业务线/app、未挂需求）。仅在打开挂载弹窗时拉取。 */
export function useCandidateTasks(uid: string | null, enabled: boolean) {
  return useSWR(
    uid && enabled ? `/api/v1/requirements/${uid}/candidate-tasks` : null,
    (url) => apiFetch<CandidateTask[]>(url),
  );
}

// ── R2 双甘特 ─────────────────────────────────────────────────────
export interface GanttRequirement {
  readonly requirementUid: string;
  readonly title: string;
  readonly businessLineUid: string;
  readonly appProjectUid: string | null;
  readonly status: string;
  readonly priority: string;
  readonly pmName: string | null;
  readonly start: string | null;
  readonly end: string | null;
  readonly hasExplicitDeadline: boolean;
}

export interface CapacityTask {
  readonly taskUid: string;
  readonly title: string;
  readonly assigneeUserId: string;
  readonly assigneeName: string;
  readonly startAt: string | null;
  readonly dueAt: string | null;
  readonly allocationPct: number | null;
  readonly estEffortDays: string | null;
  readonly requirementUid: string | null;
  readonly status: string;
}

export interface CapacityPerson {
  readonly userId: string;
  readonly userName: string;
  readonly tasks: readonly CapacityTask[];
}

export function useRequirementGantt(filter: RequirementFilter = {}, enabled = true) {
  const q = new URLSearchParams();
  if (filter.businessLineUid) q.set('business_line_uid', filter.businessLineUid);
  if (filter.appProjectUid) q.set('app_project_uid', filter.appProjectUid);
  const qs = q.toString();
  return useSWR(
    enabled ? `/api/v1/requirements/gantt${qs ? `?${qs}` : ''}` : null,
    (url) => apiFetch<GanttRequirement[]>(url),
  );
}

export function useCapacity(enabled = true) {
  return useSWR(
    enabled ? '/api/v1/requirements/capacity' : null,
    (url) => apiFetch<CapacityPerson[]>(url),
  );
}

// ── 写操作 ───────────────────────────────────────────────────────
export interface CreateRequirementInput {
  title: string;
  value?: string;
  description?: string;
  business_line_uid: string;
  app_project_uid?: string | null;
  source?: string;
  priority: string;
  expected_release_date?: string | null;
}

export function createRequirement(input: CreateRequirementInput) {
  return apiFetch<Requirement>('/api/v1/requirements', { method: 'POST', body: JSON.stringify(input) });
}

export function updateRequirement(uid: string, patch: Record<string, unknown>) {
  return apiFetch<Requirement>(`/api/v1/requirements/${uid}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function claimRequirement(uid: string) {
  return apiFetch<Requirement>(`/api/v1/requirements/${uid}/claim`, { method: 'POST' });
}

export function linkRequirementTasks(uid: string, taskUids: string[], estEffortDays?: number, allocationPct?: number) {
  return apiFetch<{ linked: number }>(`/api/v1/requirements/${uid}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ task_uids: taskUids, est_effort_days: estEffortDays, allocation_pct: allocationPct }),
  });
}

// ── R3 影响评估 ───────────────────────────────────────────────────
export interface ImpactAffectedPerson {
  readonly userId: string;
  readonly userName: string;
  readonly peakLoadPct: number;
  readonly level: 'ok' | 'tight' | 'overloaded';
  readonly tasks: readonly { taskUid: string; title: string; dueAt: string | null; allocationPct: number; requirementUid: string | null }[];
}
export interface ImpactResult {
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly affectedPeople: readonly ImpactAffectedPerson[];
  readonly notify: readonly { name: string; reason: string }[];
  readonly summary: { peopleCount: number; taskCount: number; overloadedCount: number };
}

export function previewImpact(
  input: { business_line_uid: string; app_project_uid?: string | null; expected_release_date: string },
  signal?: AbortSignal,
) {
  return apiFetch<ImpactResult>('/api/v1/requirements/impact-preview', { method: 'POST', body: JSON.stringify(input), signal });
}

export function addRequirementArtifact(uid: string, artifact: { type: string; title: string; url?: string }) {
  return apiFetch<RequirementArtifact>(`/api/v1/requirements/${uid}/artifacts`, {
    method: 'POST',
    body: JSON.stringify(artifact),
  });
}
