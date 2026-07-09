import { describe, it, expect } from 'vitest';
import {
  buildQuarterSelfWindowCard,
  buildQuarterDeadlineCard,
  buildPanelEveCard,
} from '../message-builder';

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
function buttonUrls(card: any): string[] {
  const urls: string[] = [];
  for (const el of card.elements ?? []) {
    if (el.tag === 'action') for (const a of el.actions ?? []) if (a.url) urls.push(a.url);
  }
  return urls;
}

describe('季度评分 worker 卡片', () => {
  it('buildQuarterSelfWindowCard：待自评，按钮跳自评页 /quarter/sheet/:uid', () => {
    const card: any = buildQuarterSelfWindowCard('张三', '2026-Q3', '2026-10-04', 'qs_self1');
    const text = collectText(card).join('\n');
    expect(text).toContain('张三');
    expect(text).toContain('2026-Q3');
    expect(text).toContain('2026-10-04');
    expect(text).toContain('自评');
    expect(buttonUrls(card).some((u) => u.endsWith('/quarter/sheet/qs_self1'))).toBe(true);
  });

  it('buildQuarterDeadlineCard：催办含未完成项数 + 截止 + 按钮跳 /quarter', () => {
    const card: any = buildQuarterDeadlineCard('李四', '2026-Q3', 3, '2026-10-09');
    const text = collectText(card).join('\n');
    expect(text).toContain('李四');
    expect(text).toContain('3');
    expect(text).toContain('2026-10-09');
    expect(buttonUrls(card).some((u) => u.endsWith('/quarter'))).toBe(true);
  });

  it('buildPanelEveCard：评分会前一天清单，含被评人数 + 会议日期 + 按钮跳 /quarter/panel', () => {
    const card: any = buildPanelEveCard('王总', '2026-Q3', '2026-10-15', ['张三', '李四']);
    const text = collectText(card).join('\n');
    expect(text).toContain('王总');
    expect(text).toContain('2026-10-15');
    expect(text).toContain('张三');
    expect(buttonUrls(card).some((u) => u.endsWith('/quarter/panel'))).toBe(true);
  });
});
