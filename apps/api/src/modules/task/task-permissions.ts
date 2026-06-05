import { UserRole } from '@leader-sync/shared-types';

/** 可越权管理任意任务的角色。 */
const TASK_ADMIN_ROLES: ReadonlySet<string> = new Set([UserRole.BOSS, UserRole.PMO, UserRole.ADMIN]);

/** 请求者身份（user_id + open_id 双口径，与 listByUser 一致）。 */
export interface Requester {
  userIds: string[];
  role: string;
}

/** 从 JWT 用户负载构造 Requester。 */
export function requesterFrom(user: {
  user_id: string;
  open_id?: string;
  role: string;
}): Requester {
  return {
    userIds: [user.user_id, user.open_id].filter(Boolean) as string[],
    role: user.role,
  };
}

/**
 * 是否有权对该任务做写操作：admin 角色，或本人为 负责人/指派人/直属上级/协作人。
 * 单一来源，被 service（删/恢复）与 TaskWriteGuard（其余写端点）共用。
 */
export function canMutateTask(t: any, requester: Requester): boolean {
  if (TASK_ADMIN_ROLES.has(requester.role)) return true;
  const ids = new Set(requester.userIds.filter(Boolean));
  if (ids.has(t.assigneeUserId) || ids.has(t.issuerUserId) || ids.has(t.leaderUserId)) return true;
  const collaborators = Array.isArray(t.collaborators) ? t.collaborators : [];
  return collaborators.some((c: any) => c && ids.has(c.user_id));
}
