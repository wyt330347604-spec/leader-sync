import { describe, it, expect } from 'vitest';
import { rollupProject } from '../project-health';

const NOW = new Date('2026-06-15T00:00:00Z');
const past = (d: string) => new Date(d);

function task(status: string, dueAt?: string, startAt?: string) {
  return { status, dueAt: dueAt ?? null, startAt: startAt ?? '2026-06-01', createdAt: '2026-06-01' };
}

describe('rollupProject — 健康度 / 滚动汇总', () => {
  it('overdue：存在过期未完成任务', () => {
    const r = rollupProject([
      task('done', '2026-06-10'),
      task('in_progress', '2026-06-12'), // 已过期未完成
    ], NOW);
    expect(r.health).toBe('overdue');
    expect(r.counts).toEqual({ total: 2, done: 1, overdue: 1 });
    expect(r.progress).toBe(50);
  });

  it('at_risk：进度落后于已耗时间（>20%）', () => {
    // 区间 6/01→6/30，now=6/15 → 已耗 ~47%；完成率 0% → 落后 47% > 20%
    const r = rollupProject([
      task('in_progress', '2026-06-30', '2026-06-01'),
      task('not_started', '2026-06-30', '2026-06-01'),
    ], NOW);
    expect(r.health).toBe('at_risk');
    expect(r.counts.overdue).toBe(0);
  });

  it('at_risk：临近截止(≤7天)且进度<80%', () => {
    // due 6/20（距今5天），1/2 完成=50% <80%，且未过期
    const r = rollupProject([
      task('done', '2026-06-20', '2026-06-14'),
      task('in_progress', '2026-06-20', '2026-06-14'),
    ], NOW);
    expect(r.health).toBe('at_risk');
  });

  it('on_track：完成跟上进度、无逾期', () => {
    // 区间 6/01→6/30，已耗~47%；3/4 完成=75% → 落后为负；非临近
    const r = rollupProject([
      task('done', '2026-06-28', '2026-06-01'),
      task('done', '2026-06-28', '2026-06-01'),
      task('done', '2026-06-28', '2026-06-01'),
      task('in_progress', '2026-06-28', '2026-06-01'),
    ], NOW);
    expect(r.health).toBe('on_track');
    expect(r.progress).toBe(75);
  });

  it('shelved 不入分母', () => {
    const r = rollupProject([
      task('done', '2026-06-28'),
      task('shelved', '2026-06-10'),
    ], NOW);
    expect(r.counts.total).toBe(1);
    expect(r.progress).toBe(100);
  });

  it('空项目：on_track，progress 0，无区间', () => {
    const r = rollupProject([], NOW);
    expect(r).toMatchObject({ progress: 0, health: 'on_track', spanStart: null, spanEnd: null });
    expect(r.counts).toEqual({ total: 0, done: 0, overdue: 0 });
  });

  it('span：取 min(start) → max(due)', () => {
    const r = rollupProject([
      task('done', '2026-06-20', '2026-06-05'),
      task('in_progress', '2026-06-28', '2026-06-02'),
    ], NOW);
    expect(r.spanStart).toEqual(past('2026-06-02'));
    expect(r.spanEnd).toEqual(past('2026-06-28'));
  });
});
