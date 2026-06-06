import { describe, it, expect } from 'vitest';
import { computeImpact, type ImpactTask, type ProjectMeta } from './requirement.impact';

const DAY = 24 * 60 * 60 * 1000;
const base = new Date('2026-06-01T00:00:00Z').getTime();
const d = (n: number) => new Date(base + n * DAY);

function task(over: Partial<ImpactTask>): ImpactTask {
  return {
    taskUid: 't', title: '任务', assigneeUserId: 'u1', assigneeName: '张三',
    startAt: d(0), dueAt: d(10), allocationPct: 50, requirementUid: null, projectUid: 'app1',
    ...over,
  };
}
const projects: ProjectMeta[] = [{ projectUid: 'app1', name: '收银台', picUserId: 'pic1', ownerName: '老板' }];
const picNames = new Map([['pic1', 'PIC小王']]);

describe('computeImpact', () => {
  const win = { windowStart: base, windowEnd: base + 30 * DAY };

  it('范围内重叠任务计入受影响', () => {
    const r = computeImpact({ scopeUids: ['app1'], ...win, tasks: [task({})], projects, picNames });
    expect(r.summary.peopleCount).toBe(1);
    expect(r.summary.taskCount).toBe(1);
    expect(r.affectedPeople[0].userName).toBe('张三');
  });

  it('范围外任务被排除', () => {
    const r = computeImpact({ scopeUids: ['app1'], ...win, tasks: [task({ projectUid: 'other' })], projects, picNames });
    expect(r.summary.taskCount).toBe(0);
  });

  it('窗口外（晚于期望上线）任务被排除', () => {
    const r = computeImpact({ scopeUids: ['app1'], windowStart: base, windowEnd: base + 5 * DAY, tasks: [task({ startAt: d(20), dueAt: d(25) })], projects, picNames });
    expect(r.summary.taskCount).toBe(0);
  });

  it('并行任务叠加 → 峰值>100 标记过载', () => {
    const tasks = [
      task({ taskUid: 'a', allocationPct: 70 }),
      task({ taskUid: 'b', allocationPct: 60 }),
    ];
    const r = computeImpact({ scopeUids: ['app1'], ...win, tasks, projects, picNames });
    expect(r.affectedPeople[0].peakLoadPct).toBe(130);
    expect(r.affectedPeople[0].level).toBe('overloaded');
    expect(r.summary.overloadedCount).toBe(1);
  });

  it('通知名单含受影响人 + 项目 PIC + 负责人', () => {
    const r = computeImpact({ scopeUids: ['app1'], ...win, tasks: [task({})], projects, picNames });
    const names = r.notify.map((n) => n.name);
    expect(names).toContain('张三');
    expect(names).toContain('PIC小王');
    expect(names).toContain('老板');
  });

  it('不静默改期：结果只含影响与通知，无任何任务写操作字段', () => {
    const r = computeImpact({ scopeUids: ['app1'], ...win, tasks: [task({})], projects, picNames });
    expect(r).toHaveProperty('affectedPeople');
    expect(r).toHaveProperty('notify');
    expect(r).not.toHaveProperty('appliedChanges');
  });
});
