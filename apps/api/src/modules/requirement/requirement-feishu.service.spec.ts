import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RequirementFeishuService, type P0NotifyInfo } from './requirement-feishu.service';

const INFO: P0NotifyInfo = {
  requirementUid: 'req_1', title: '风控升级', expectedReleaseDate: '2026-07-15',
  peopleCount: 2, taskCount: 3, overloadedCount: 1, kind: 'create',
};

function mockMessenger() {
  return { sendTextToUser: vi.fn().mockResolvedValue(true) };
}

describe('RequirementFeishuService.notifyP0Impact', () => {
  let svc: RequirementFeishuService;
  let messenger: ReturnType<typeof mockMessenger>;
  beforeEach(() => {
    messenger = mockMessenger();
    svc = new RequirementFeishuService(messenger as any);
  });

  it('空名单 → 0，不发消息', async () => {
    const n = await svc.notifyP0Impact([], INFO);
    expect(n).toBe(0);
    expect(messenger.sendTextToUser).not.toHaveBeenCalled();
  });

  it('逐人下发 → 返回成功条数', async () => {
    const n = await svc.notifyP0Impact(['ou_a', 'ou_b'], INFO);
    expect(n).toBe(2);
    expect(messenger.sendTextToUser).toHaveBeenCalledTimes(2);
  });

  it('去重重复 open_id', async () => {
    const n = await svc.notifyP0Impact(['ou_a', 'ou_a', 'ou_b'], INFO);
    expect(n).toBe(2);
    expect(messenger.sendTextToUser).toHaveBeenCalledTimes(2);
  });

  it('消息含标题/期望上线/详情链接，且不代为改期措辞', async () => {
    await svc.notifyP0Impact(['ou_a'], INFO);
    const text = messenger.sendTextToUser.mock.calls[0][1] as string;
    expect(text).toContain('风控升级');
    expect(text).toContain('2026-07-15');
    expect(text).toContain('/requirements/req_1');
    expect(text).toContain('不会自动改期');
  });

  it('变更 kind → 标题为变更影响', async () => {
    await svc.notifyP0Impact(['ou_a'], { ...INFO, kind: 'change' });
    const text = messenger.sendTextToUser.mock.calls[0][1] as string;
    expect(text).toContain('变更影响');
  });

  it('部分送达失败 → 只计成功条数', async () => {
    messenger.sendTextToUser.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const n = await svc.notifyP0Impact(['ou_a', 'ou_b'], INFO);
    expect(n).toBe(1);
  });
});
