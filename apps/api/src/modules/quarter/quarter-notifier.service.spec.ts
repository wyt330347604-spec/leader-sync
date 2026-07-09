import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuarterNotifierService } from './quarter-notifier.service';

function mockMessenger() {
  return {
    sendTextToUser: vi.fn().mockResolvedValue(true),
    sendCardToUser: vi.fn().mockResolvedValue(true),
  };
}

describe('QuarterNotifierService（卡片下发）', () => {
  let svc: QuarterNotifierService;
  let messenger: ReturnType<typeof mockMessenger>;
  beforeEach(() => {
    process.env.WEB_BASE_URL = 'https://app.example.com';
    messenger = mockMessenger();
    svc = new QuarterNotifierService(messenger as any);
  });

  describe('notifyPublished', () => {
    const INFO = { rateeName: '张三', quarter: '2026-Q2', total: 88.5, grade: 'A', deadlineText: '2026-07-12', resultUid: 'qr_abc' };

    it('无 openId → false，不发送', async () => {
      const ok = await svc.notifyPublished(null, INFO);
      expect(ok).toBe(false);
      expect(messenger.sendCardToUser).not.toHaveBeenCalled();
    });

    it('发交互卡片给本人，卡片含季度/总分且按钮跳详情页', async () => {
      const ok = await svc.notifyPublished('ou_a', INFO);
      expect(ok).toBe(true);
      expect(messenger.sendCardToUser).toHaveBeenCalledTimes(1);
      const [openId, card] = messenger.sendCardToUser.mock.calls[0];
      expect(openId).toBe('ou_a');
      expect(JSON.stringify(card)).toContain('2026-Q2');
      expect(JSON.stringify(card)).toContain('/quarter/result/qr_abc');
    });

    it('发送失败 → 返回 false，不抛', async () => {
      messenger.sendCardToUser.mockResolvedValueOnce(false);
      await expect(svc.notifyPublished('ou_a', INFO)).resolves.toBe(false);
    });
  });

  describe('notifyAppeal', () => {
    const INFO = { rateeName: '李四', quarter: '2026-Q2', content: '请复核' };

    it('空名单 → 0，不发送', async () => {
      const n = await svc.notifyAppeal([], INFO);
      expect(n).toBe(0);
      expect(messenger.sendCardToUser).not.toHaveBeenCalled();
    });

    it('逐个 HR 发卡片并去重，返回成功条数', async () => {
      const n = await svc.notifyAppeal(['ou_hr1', 'ou_hr1', 'ou_hr2'], INFO);
      expect(n).toBe(2);
      expect(messenger.sendCardToUser).toHaveBeenCalledTimes(2);
    });

    it('部分失败 → 只计成功；不抛', async () => {
      messenger.sendCardToUser.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      const n = await svc.notifyAppeal(['ou_hr1', 'ou_hr2'], INFO);
      expect(n).toBe(1);
    });
  });

  describe('notifyPeerAssigned', () => {
    const INFO = { peerName: '王五', rateeName: '张三', quarter: '2026-Q2', sheetUid: 'qs_xyz' };

    it('无 openId → false，不发送', async () => {
      const ok = await svc.notifyPeerAssigned(null, INFO);
      expect(ok).toBe(false);
      expect(messenger.sendCardToUser).not.toHaveBeenCalled();
    });

    it('发卡片给被指定同事，按钮跳打分页', async () => {
      const ok = await svc.notifyPeerAssigned('ou_peer', INFO);
      expect(ok).toBe(true);
      const [openId, card] = messenger.sendCardToUser.mock.calls[0];
      expect(openId).toBe('ou_peer');
      expect(JSON.stringify(card)).toContain('/quarter/sheet/qs_xyz');
    });

    it('发送失败 → false，不抛', async () => {
      messenger.sendCardToUser.mockResolvedValueOnce(false);
      await expect(svc.notifyPeerAssigned('ou_peer', INFO)).resolves.toBe(false);
    });
  });
});
