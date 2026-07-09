import { describe, it, expect } from 'vitest';
import { addWorkingDays } from '../working-days';

// 工作日推算（周六日跳过）——用于季度公示后「+3 个工作日」申诉期。
// 约定：按 UTC 判定星期，与运行环境时区无关（与 perf-scoring 一致）；返回新 Date，不改入参。
describe('addWorkingDays', () => {
  // 2026-07-06 是周一
  const MON = new Date(Date.UTC(2026, 6, 6, 8, 0, 0));
  const FRI = new Date(Date.UTC(2026, 6, 10, 8, 0, 0)); // 周五
  const THU = new Date(Date.UTC(2026, 6, 9, 8, 0, 0)); // 周四
  const SAT = new Date(Date.UTC(2026, 6, 11, 8, 0, 0)); // 周六

  it('周一 + 3 工作日 → 周四', () => {
    expect(addWorkingDays(MON, 3).toISOString()).toBe(new Date(Date.UTC(2026, 6, 9, 8, 0, 0)).toISOString());
  });

  it('周五 + 3 工作日 → 跨周末到下周三', () => {
    // 周五→周一(1)→周二(2)→周三(3)
    expect(addWorkingDays(FRI, 3).toISOString()).toBe(new Date(Date.UTC(2026, 6, 15, 8, 0, 0)).toISOString());
  });

  it('周四 + 3 工作日 → 下周二', () => {
    // 周四→周五(1)→周一(2)→周二(3)
    expect(addWorkingDays(THU, 3).toISOString()).toBe(new Date(Date.UTC(2026, 6, 14, 8, 0, 0)).toISOString());
  });

  it('周六 + 1 工作日 → 下周一（起点为周末，先跳到工作日再计数）', () => {
    expect(addWorkingDays(SAT, 1).toISOString()).toBe(new Date(Date.UTC(2026, 6, 13, 8, 0, 0)).toISOString());
  });

  it('n=0 返回等值副本且不修改入参', () => {
    const r = addWorkingDays(MON, 0);
    expect(r.toISOString()).toBe(MON.toISOString());
    expect(r).not.toBe(MON);
    expect(MON.toISOString()).toBe(new Date(Date.UTC(2026, 6, 6, 8, 0, 0)).toISOString());
  });

  it('保留时分秒（仅推进日期）', () => {
    const t = new Date(Date.UTC(2026, 6, 6, 13, 45, 30));
    const r = addWorkingDays(t, 2); // 周一+2 → 周三
    expect(r.getUTCHours()).toBe(13);
    expect(r.getUTCMinutes()).toBe(45);
    expect(r.getUTCSeconds()).toBe(30);
    expect(r.getUTCDate()).toBe(8);
  });

  it('负数工作日抛错', () => {
    expect(() => addWorkingDays(MON, -1)).toThrow();
  });
});
