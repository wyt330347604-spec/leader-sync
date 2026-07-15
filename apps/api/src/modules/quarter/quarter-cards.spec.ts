import { describe, it, expect } from 'vitest';
import {
  buildPublishCard,
  buildAppealCard,
  buildPeerAssignedCard,
  buildPanelReminderCard,
} from './quarter-cards';

const BASE = 'https://app.example.com';

/** 递归收集卡片里全部 lark_md / plain_text 文案，便于断言关键文案存在。 */
function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || typeof node !== 'object') return out;
  const n = node as Record<string, unknown>;
  if (typeof n.content === 'string') out.push(n.content);
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) v.forEach((x) => collectText(x, out));
    else if (typeof v === 'object') collectText(v, out);
  }
  return out;
}

/** 收集全部按钮 url。 */
function collectButtonUrls(card: any): string[] {
  const urls: string[] = [];
  for (const el of card.elements ?? []) {
    if (el.tag === 'action') for (const a of el.actions ?? []) if (a.url) urls.push(a.url);
  }
  return urls;
}

describe('quarter-cards', () => {
  describe('buildPublishCard（公示出分 → 本人）', () => {
    const card: any = buildPublishCard(BASE, {
      rateeName: '张三',
      quarter: '2026-Q2',
      total: 88.5,
      grade: 'A',
      deadlineText: '2026-07-12',
      resultUid: 'qr_abc',
    });
    it('header violet + 含季度/总分/评级/申诉截止', () => {
      expect(card.header.template).toBe('violet');
      const text = collectText(card).join('\n');
      expect(text).toContain('2026-Q2');
      expect(text).toContain('88.5');
      expect(text).toContain('A');
      expect(text).toContain('2026-07-12');
    });
    it('按钮跳详情页 /quarter/result/:uid', () => {
      expect(collectButtonUrls(card)).toContain(`${BASE}/quarter/result/qr_abc`);
    });
  });

  describe('buildAppealCard（申诉提交 → HR）', () => {
    const card: any = buildAppealCard(BASE, {
      rateeName: '李四',
      quarter: '2026-Q2',
      content: '目标分偏低，请复核',
    });
    it('含申诉人/内容 + 按钮进申诉台', () => {
      const text = collectText(card).join('\n');
      expect(text).toContain('李四');
      expect(text).toContain('目标分偏低');
      expect(collectButtonUrls(card).some((u) => u.startsWith(BASE))).toBe(true);
    });
  });

  describe('buildPeerAssignedCard（被指定同事）', () => {
    const card: any = buildPeerAssignedCard(BASE, {
      peerName: '王五',
      rateeName: '张三',
      quarter: '2026-Q2',
      sheetUid: 'qs_xyz',
    });
    it('含"为谁打分" + 按钮跳打分页 /quarter/sheet/:uid', () => {
      const text = collectText(card).join('\n');
      expect(text).toContain('张三');
      expect(collectButtonUrls(card)).toContain(`${BASE}/quarter/sheet/qs_xyz`);
    });
  });

  describe('buildPanelReminderCard（评分会召集 → 管理层）', () => {
    const card: any = buildPanelReminderCard(BASE, {
      managerName: '潘安',
      quarter: '2026-Q3',
      cycleUid: 'qc_panel',
      pendingCount: 7,
    });
    it('header violet + 含管理层姓名/季度/待评人数', () => {
      expect(card.header.template).toBe('violet');
      const text = collectText(card).join('\n');
      expect(text).toContain('潘安');
      expect(text).toContain('2026-Q3');
      expect(text).toContain('7');
    });
    it('按钮跳评分会看板 /quarter/panel?cycle=:uid', () => {
      expect(collectButtonUrls(card)).toContain(`${BASE}/quarter/panel?cycle=qc_panel`);
    });
    it('管理层姓名缺失也不崩', () => {
      const c: any = buildPanelReminderCard(BASE, { managerName: null, quarter: '2026-Q3', cycleUid: 'qc_x', pendingCount: 0 });
      expect(collectButtonUrls(c)).toContain(`${BASE}/quarter/panel?cycle=qc_x`);
    });
  });
});
