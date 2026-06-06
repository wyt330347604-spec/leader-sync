import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RequirementFeishuService, type P0NotifyInfo } from './requirement-feishu.service';

const INFO: P0NotifyInfo = {
  requirementUid: 'req_1', title: '风控升级', expectedReleaseDate: '2026-07-15',
  peopleCount: 2, taskCount: 3, overloadedCount: 1, kind: 'create',
};

function mockFetch() {
  return vi.fn(async (url: string, _init?: any) => {
    if (String(url).includes('app_access_token')) {
      return { json: async () => ({ code: 0, app_access_token: 'tok', expire: 7200 }) } as any;
    }
    return { json: async () => ({ code: 0, msg: 'ok' }) } as any;
  });
}

describe('RequirementFeishuService.notifyP0Impact', () => {
  let svc: RequirementFeishuService;
  let fetchMock: ReturnType<typeof mockFetch>;
  beforeEach(() => {
    process.env.FEISHU_APP_ID = 'a'; process.env.FEISHU_APP_SECRET = 's';
    svc = new RequirementFeishuService();
    fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('空名单 → 0，不发消息', async () => {
    const n = await svc.notifyP0Impact([], INFO);
    expect(n).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('逐人下发 → 返回成功条数', async () => {
    const n = await svc.notifyP0Impact(['ou_a', 'ou_b'], INFO);
    expect(n).toBe(2);
    const msgCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/im/v1/messages'));
    expect(msgCalls.length).toBe(2);
  });

  it('去重重复 open_id', async () => {
    const n = await svc.notifyP0Impact(['ou_a', 'ou_a', 'ou_b'], INFO);
    expect(n).toBe(2);
  });

  it('消息含标题/期望上线/详情链接，且不代为改期措辞', async () => {
    await svc.notifyP0Impact(['ou_a'], INFO);
    const msgCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/im/v1/messages'))!;
    const body = JSON.parse((msgCall[1] as any).body);
    const text = JSON.parse(body.content).text;
    expect(text).toContain('风控升级');
    expect(text).toContain('2026-07-15');
    expect(text).toContain('/requirements/req_1');
    expect(text).toContain('不会自动改期');
  });

  it('变更 kind → 标题为变更影响', async () => {
    await svc.notifyP0Impact(['ou_a'], { ...INFO, kind: 'change' });
    const msgCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/im/v1/messages'))!;
    const text = JSON.parse(JSON.parse((msgCall[1] as any).body).content).text;
    expect(text).toContain('变更影响');
  });
});
