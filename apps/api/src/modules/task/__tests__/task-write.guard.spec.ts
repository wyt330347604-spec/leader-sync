import { describe, it, expect, vi } from 'vitest';
import { TaskWriteGuard } from '../task-write.guard';

function makeCtx(params: any, user: any) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ params, user }) }),
  } as any;
}

function makeGuard(task: any) {
  const repo = { findByUid: vi.fn().mockResolvedValue(task) };
  return { guard: new TaskWriteGuard(repo as any), repo };
}

const TASK = {
  taskUid: 't1',
  assigneeUserId: 'ou_alice',
  issuerUserId: 'ou_boss',
  leaderUserId: 'ou_harvey',
  collaborators: [{ user_id: 'ou_carol' }],
};

describe('TaskWriteGuard', () => {
  it('放行：负责人本人', async () => {
    const { guard } = makeGuard(TASK);
    const ok = await guard.canActivate(makeCtx({ task_uid: 't1' }, { user_id: 'ou_alice', role: 'employee' }));
    expect(ok).toBe(true);
  });

  it('放行：协作人', async () => {
    const { guard } = makeGuard(TASK);
    const ok = await guard.canActivate(makeCtx({ task_uid: 't1' }, { user_id: 'ou_carol', role: 'employee' }));
    expect(ok).toBe(true);
  });

  it('放行：admin/boss 角色（与任务无关）', async () => {
    const { guard } = makeGuard(TASK);
    const ok = await guard.canActivate(makeCtx({ task_uid: 't1' }, { user_id: 'ou_x', role: 'boss' }));
    expect(ok).toBe(true);
  });

  it('拒绝：无关普通用户 → 抛 1002', async () => {
    const { guard } = makeGuard(TASK);
    await expect(
      guard.canActivate(makeCtx({ task_uid: 't1' }, { user_id: 'ou_stranger', role: 'employee' })),
    ).rejects.toMatchObject({ businessCode: 1002 });
  });

  it('放行：任务不存在（交由 handler 返回 404）', async () => {
    const { guard } = makeGuard(null);
    const ok = await guard.canActivate(makeCtx({ task_uid: 'missing' }, { user_id: 'ou_x', role: 'employee' }));
    expect(ok).toBe(true);
  });

  it('放行：无 task_uid 参数的路由', async () => {
    const { guard, repo } = makeGuard(TASK);
    const ok = await guard.canActivate(makeCtx({}, { user_id: 'ou_x', role: 'employee' }));
    expect(ok).toBe(true);
    expect(repo.findByUid).not.toHaveBeenCalled();
  });

  it('匹配 open_id 双口径：assignee 存的是 open_id 时本人可改', async () => {
    const { guard } = makeGuard({ ...TASK, assigneeUserId: 'ou_open_alice' });
    const ok = await guard.canActivate(
      makeCtx({ task_uid: 't1' }, { user_id: 'uid_alice', open_id: 'ou_open_alice', role: 'employee' }),
    );
    expect(ok).toBe(true);
  });
});
