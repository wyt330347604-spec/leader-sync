import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FeishuMessengerService } from './feishu-messenger.service';

function mockFetch(messageCode = 0) {
  return vi.fn(async (url: string, _init?: any) => {
    if (String(url).includes('app_access_token')) {
      return { json: async () => ({ code: 0, app_access_token: 'tok', expire: 7200 }) } as any;
    }
    return { json: async () => ({ code: messageCode, msg: messageCode === 0 ? 'ok' : 'bad receive_id' }) } as any;
  });
}

describe('FeishuMessengerService', () => {
  let svc: FeishuMessengerService;
  beforeEach(() => {
    process.env.FEISHU_APP_ID = 'a';
    process.env.FEISHU_APP_SECRET = 's';
    svc = new FeishuMessengerService();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('成功发送 → true，且 receive_id_type=open_id', async () => {
    const f = mockFetch(0);
    vi.stubGlobal('fetch', f);
    const ok = await svc.sendTextToUser('ou_a', 'hi');
    expect(ok).toBe(true);
    const msgCall = f.mock.calls.find((c) => String(c[0]).includes('/im/v1/messages'))!;
    expect(String(msgCall[0])).toContain('receive_id_type=open_id');
    expect(JSON.parse((msgCall[1] as any).body).receive_id).toBe('ou_a');
  });

  it('飞书返回非 0 → false（不抛）', async () => {
    vi.stubGlobal('fetch', mockFetch(99991));
    await expect(svc.sendTextToUser('ou_a', 'hi')).resolves.toBe(false);
  });

  it('token 拿不到 → false，不发消息', async () => {
    const f = vi.fn(async (_url: string, _init?: any) => ({ json: async () => ({ code: 1, app_access_token: '', expire: 0 }) }) as any);
    vi.stubGlobal('fetch', f);
    const ok = await svc.sendTextToUser('ou_a', 'hi');
    expect(ok).toBe(false);
    expect(f.mock.calls.some((c) => String(c[0]).includes('/im/v1/messages'))).toBe(false);
  });

  it('token 复用缓存：连续两次发送只取一次 token', async () => {
    const f = mockFetch(0);
    vi.stubGlobal('fetch', f);
    await svc.sendTextToUser('ou_a', 'hi');
    await svc.sendTextToUser('ou_b', 'yo');
    const tokenCalls = f.mock.calls.filter((c) => String(c[0]).includes('app_access_token'));
    expect(tokenCalls.length).toBe(1);
  });

  describe('sendCardToUser', () => {
    const CARD = { config: { wide_screen_mode: true }, header: { title: { tag: 'plain_text', content: 't' } }, elements: [] };

    it('成功发送卡片 → true，msg_type=interactive 且 content 为卡片 JSON', async () => {
      const f = mockFetch(0);
      vi.stubGlobal('fetch', f);
      const ok = await svc.sendCardToUser('ou_a', CARD);
      expect(ok).toBe(true);
      const msgCall = f.mock.calls.find((c) => String(c[0]).includes('/im/v1/messages'))!;
      expect(String(msgCall[0])).toContain('receive_id_type=open_id');
      const body = JSON.parse((msgCall[1] as any).body);
      expect(body.receive_id).toBe('ou_a');
      expect(body.msg_type).toBe('interactive');
      expect(JSON.parse(body.content)).toEqual(CARD);
    });

    it('飞书返回非 0 → false（不抛）', async () => {
      vi.stubGlobal('fetch', mockFetch(99991));
      await expect(svc.sendCardToUser('ou_a', CARD)).resolves.toBe(false);
    });

    it('token 拿不到 → false，不发消息', async () => {
      const f = vi.fn(async (_url: string, _init?: any) => ({ json: async () => ({ code: 1, app_access_token: '', expire: 0 }) }) as any);
      vi.stubGlobal('fetch', f);
      const ok = await svc.sendCardToUser('ou_a', CARD);
      expect(ok).toBe(false);
      expect(f.mock.calls.some((c) => String(c[0]).includes('/im/v1/messages'))).toBe(false);
    });

    it('fetch 抛异常 → false（不冒泡）', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (String(url).includes('app_access_token')) return { json: async () => ({ code: 0, app_access_token: 'tok', expire: 7200 }) } as any;
        throw new Error('network down');
      }));
      await expect(svc.sendCardToUser('ou_a', CARD)).resolves.toBe(false);
    });
  });
});
