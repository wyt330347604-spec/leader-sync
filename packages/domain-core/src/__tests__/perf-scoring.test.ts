import { describe, it, expect } from 'vitest';
import {
  monthlyTotal,
  monthlyGrade,
  quarterlyDimScore,
  softSum,
  mgmtAverage,
  mergeSoft,
  quarterlyTotal,
  quarterlyGrade,
  halfYearTotal,
  completeMonthsInQuarter,
  enrolledInQuarter,
  validatePeerAssignment,
  promotionEligible,
  InvalidRawScoreError,
  InvalidQuarterFormatError,
} from '../perf-scoring';

// 季度 soft 维度权重（V2.3 定稿）：员工软项和为 55（目标 45 → 满分 100）
const EMPLOYEE_SOFT = [
  { raw: 10, weight: 18 }, // 专业
  { raw: 10, weight: 15 }, // 主动担当
  { raw: 10, weight: 10 }, // 协作
  { raw: 10, weight: 12 }, // 学习自省
];

// Q3 2026：以 UTC 月份计算，避免运行环境时区影响
const Q3_START = new Date(Date.UTC(2026, 6, 1)); // 7月
const Q3_END = new Date(Date.UTC(2026, 8, 30)); // 9月

describe('monthlyTotal', () => {
  it('空维度返回 0', () => {
    expect(monthlyTotal([])).toEqual({ total: 0, composite: 0 });
  });

  it('员工版全 1.0 系数（15/85）总分 100、综合系数 1.0', () => {
    expect(monthlyTotal([
      { coefficient: 1.0, weight: 15 },
      { coefficient: 1.0, weight: 85 },
    ])).toEqual({ total: 100, composite: 1 });
  });

  it('leader 版全 1.0 系数（10/70/20）总分 100', () => {
    expect(monthlyTotal([
      { coefficient: 1.0, weight: 10 },
      { coefficient: 1.0, weight: 70 },
      { coefficient: 1.0, weight: 20 },
    ])).toEqual({ total: 100, composite: 1 });
  });

  it('系数低于 1 时总分与综合系数同比例下降', () => {
    expect(monthlyTotal([
      { coefficient: 0.9, weight: 15 },
      { coefficient: 0.9, weight: 85 },
    ])).toEqual({ total: 90, composite: 0.9 });
  });

  it('系数可大于 1，总分可超过 100', () => {
    expect(monthlyTotal([
      { coefficient: 2.0, weight: 15 },
      { coefficient: 1.0, weight: 85 },
    ])).toEqual({ total: 115, composite: 1.15 });
  });

  it('总分四舍五入到 1 位小数（半值进位 0.25→0.3）', () => {
    expect(monthlyTotal([{ coefficient: 0.25, weight: 1 }]).total).toBe(0.3);
    expect(monthlyTotal([{ coefficient: 0.75, weight: 1 }]).total).toBe(0.8);
  });

  it('两位小数系数在浮点噪声下仍正确进位', () => {
    // 0.55×85 + 0.9×15 = 46.75 + 13.5 = 60.25 → 60.3；综合 0.6025 → 0.60
    expect(monthlyTotal([
      { coefficient: 0.55, weight: 85 },
      { coefficient: 0.9, weight: 15 },
    ])).toEqual({ total: 60.3, composite: 0.6 });
    // 0.55×85 + 1.0×15 = 61.75 → 61.8；综合 0.6175 → 0.62
    expect(monthlyTotal([
      { coefficient: 0.55, weight: 85 },
      { coefficient: 1.0, weight: 15 },
    ])).toEqual({ total: 61.8, composite: 0.62 });
  });

  it('不修改入参（不可变）', () => {
    const dims = [
      { coefficient: 0.9, weight: 15 },
      { coefficient: 0.9, weight: 85 },
    ];
    const snapshot = JSON.stringify(dims);
    monthlyTotal(dims);
    expect(JSON.stringify(dims)).toBe(snapshot);
  });
});

describe('monthlyGrade', () => {
  it('红线一票否决为 D（无视总分）', () => {
    expect(monthlyGrade(200, true)).toBe('D');
    expect(monthlyGrade(95, true)).toBe('D');
  });

  const cases: [number, string][] = [
    [100.05, 'S'],
    [101, 'S'],
    [100, 'A'], // 100 归 A（含端点）
    [95, 'A'],
    [90, 'A'],
    [89.95, 'B'],
    [89.9, 'B'],
    [80, 'B'],
    [79.9, 'C'],
    [70, 'C'],
    [69.9, 'D'],
    [0, 'D'],
  ];
  it.each(cases)('total=%s（未触红线）应为 %s', (total, grade) => {
    expect(monthlyGrade(total, false)).toBe(grade);
  });
});

describe('quarterlyDimScore', () => {
  it('raw/10 × weight', () => {
    expect(quarterlyDimScore(10, 18)).toBe(18);
    expect(quarterlyDimScore(5, 18)).toBe(9);
    expect(quarterlyDimScore(7, 15)).toBe(10.5);
    expect(quarterlyDimScore(1, 10)).toBe(1);
  });

  it('raw 越界（0 / 11 / 负数）抛错', () => {
    expect(() => quarterlyDimScore(0, 18)).toThrow(InvalidRawScoreError);
    expect(() => quarterlyDimScore(11, 18)).toThrow(InvalidRawScoreError);
    expect(() => quarterlyDimScore(-1, 18)).toThrow(InvalidRawScoreError);
  });

  it('raw 非整数抛错', () => {
    expect(() => quarterlyDimScore(5.5, 18)).toThrow(InvalidRawScoreError);
  });
});

describe('softSum', () => {
  it('员工软项全 10 分 = 权重之和 55', () => {
    expect(softSum(EMPLOYEE_SOFT)).toBe(55);
  });

  it('全 8 分 = 0.8 × 55 = 44', () => {
    const items = EMPLOYEE_SOFT.map((d) => ({ raw: 8, weight: d.weight }));
    expect(softSum(items)).toBe(44);
  });

  it('空项返回 0', () => {
    expect(softSum([])).toBe(0);
  });

  it('任一 raw 越界则抛错', () => {
    expect(() => softSum([{ raw: 8, weight: 10 }, { raw: 0, weight: 10 }])).toThrow(InvalidRawScoreError);
  });
});

describe('mgmtAverage', () => {
  it('无排除时取全部均值', () => {
    expect(mgmtAverage([
      { raterId: 'a', softTotal: 40 },
      { raterId: 'b', softTotal: 44 },
      { raterId: 'c', softTotal: 48 },
    ], [])).toBe(44);
  });

  it('排除指定评分人后取均值', () => {
    expect(mgmtAverage([
      { raterId: 'a', softTotal: 40 },
      { raterId: 'b', softTotal: 44 },
      { raterId: 'c', softTotal: 48 },
    ], ['a'])).toBe(46); // (44+48)/2
  });

  it('排除名单里不存在的 id 不影响结果', () => {
    expect(mgmtAverage([
      { raterId: 'a', softTotal: 40 },
      { raterId: 'b', softTotal: 44 },
    ], ['zzz'])).toBe(42);
  });

  it('全部被排除返回 null', () => {
    expect(mgmtAverage([
      { raterId: 'a', softTotal: 40 },
      { raterId: 'b', softTotal: 44 },
    ], ['a', 'b'])).toBeNull();
  });

  it('空 sheet 返回 null', () => {
    expect(mgmtAverage([], [])).toBeNull();
  });

  it('不修改入参（不可变）', () => {
    const sheets = [
      { raterId: 'a', softTotal: 40 },
      { raterId: 'b', softTotal: 44 },
    ];
    const excludeIds = ['a'];
    const sSnap = JSON.stringify(sheets);
    const eSnap = JSON.stringify(excludeIds);
    mgmtAverage(sheets, excludeIds);
    expect(JSON.stringify(sheets)).toBe(sSnap);
    expect(JSON.stringify(excludeIds)).toBe(eSnap);
  });
});

// mergeSoft 四分支（硬化1，Harvey 2026-07-08 拍板）：按「管理层是否在场 × 同事是否在场」
// 缺席方权重并入直属。mgmt/peer 传 null 表示缺席（区别于「在场且打 0 分」传 0）。
describe('mergeSoft（四分支：缺席方权重归直属）', () => {
  it('管理层在 + 同事在 → 0.55/0.35/0.10', () => {
    const r = mergeSoft({ manager: 50, mgmt: 40, peer: 45 });
    expect(r.merged).toBeCloseTo(0.55 * 50 + 0.35 * 40 + 0.1 * 45, 10); // 46
    expect(r.usedWeights).toEqual({ manager: 0.55, mgmt: 0.35, peer: 0.1 });
  });

  it('管理层在 + 同事缺(null) → 0.65/0.35，同事的 0.10 并入直属', () => {
    const r = mergeSoft({ manager: 50, mgmt: 40, peer: null });
    expect(r.merged).toBeCloseTo(0.65 * 50 + 0.35 * 40, 10); // 46.5
    expect(r.usedWeights).toEqual({ manager: 0.65, mgmt: 0.35 });
    expect(r.usedWeights.peer).toBeUndefined();
  });

  it('管理层缺(null) + 同事在 → 0.90/0.10', () => {
    const r = mergeSoft({ manager: 50, mgmt: null, peer: 45 });
    expect(r.merged).toBeCloseTo(0.9 * 50 + 0.1 * 45, 10); // 49.5
    expect(r.usedWeights).toEqual({ manager: 0.9, peer: 0.1 });
    expect(r.usedWeights.mgmt).toBeUndefined();
  });

  it('管理层缺 + 同事缺 → 直属 1.00（李四场景）', () => {
    const r = mergeSoft({ manager: 44, mgmt: null, peer: null });
    expect(r.merged).toBeCloseTo(44, 10);
    expect(r.usedWeights).toEqual({ manager: 1 });
    expect(r.usedWeights.mgmt).toBeUndefined();
    expect(r.usedWeights.peer).toBeUndefined();
  });

  it('四组权重之和恒为 1', () => {
    const sum = (w: { manager: number; mgmt?: number; peer?: number }) =>
      w.manager + (w.mgmt ?? 0) + (w.peer ?? 0);
    expect(sum(mergeSoft({ manager: 1, mgmt: 1, peer: 1 }).usedWeights)).toBeCloseTo(1, 10);
    expect(sum(mergeSoft({ manager: 1, mgmt: 1, peer: null }).usedWeights)).toBeCloseTo(1, 10);
    expect(sum(mergeSoft({ manager: 1, mgmt: null, peer: 1 }).usedWeights)).toBeCloseTo(1, 10);
    expect(sum(mergeSoft({ manager: 1, mgmt: null, peer: null }).usedWeights)).toBeCloseTo(1, 10);
  });

  it('不修改入参（不可变）', () => {
    const input = { manager: 50, mgmt: 40, peer: 45 };
    const snap = JSON.stringify(input);
    mergeSoft(input);
    expect(JSON.stringify(input)).toBe(snap);
  });
});

describe('quarterlyTotal', () => {
  it('目标分 + 软项合成', () => {
    expect(quarterlyTotal(40, 46)).toBe(86);
  });

  it('四舍五入到 1 位小数（半值进位 90.25→90.3）', () => {
    expect(quarterlyTotal(45, 45.25)).toBe(90.3);
  });

  it('满分守恒：三方软项全 55 + 目标 45 = 100', () => {
    const merged = mergeSoft({ manager: 55, mgmt: 55, peer: 55 }).merged;
    expect(quarterlyTotal(45, merged)).toBe(100);
  });
});

describe('quarterlyGrade', () => {
  it('红线一票否决为 D', () => {
    expect(quarterlyGrade(95, true)).toBe('D');
  });

  const cases: [number, string][] = [
    [100, 'S'],
    [90, 'S'], // S≥90 含端点
    [89.9, 'A'],
    [80, 'A'],
    [79.9, 'B'],
    [70, 'B'],
    [69.9, 'C'],
    [60, 'C'],
    [59.9, 'D'],
    [0, 'D'],
  ];
  it.each(cases)('total=%s（未触红线）应为 %s', (total, grade) => {
    expect(quarterlyGrade(total, false)).toBe(grade);
  });
});

describe('halfYearTotal', () => {
  it('双季有分：前 40% + 后 60%', () => {
    expect(halfYearTotal(85, 90)).toEqual({ total: 88, formula: '40/60' });
  });

  it('双季有分：四舍五入到 1 位小数', () => {
    // 85.5×0.4 + 90.3×0.6 = 34.2 + 54.18 = 88.38 → 88.4
    expect(halfYearTotal(85.5, 90.3)).toEqual({ total: 88.4, formula: '40/60' });
  });

  it('仅后季有分 → 该季 ×100%', () => {
    expect(halfYearTotal(null, 90)).toEqual({ total: 90, formula: 'single_100' });
  });

  it('仅前季有分 → 该季 ×100%', () => {
    expect(halfYearTotal(85, null)).toEqual({ total: 85, formula: 'single_100' });
  });

  it('双季皆无 → null', () => {
    expect(halfYearTotal(null, null)).toEqual({ total: null, formula: null });
  });
});

describe('completeMonthsInQuarter', () => {
  it('joinedAt=null 视为远早于季度 → 3', () => {
    expect(completeMonthsInQuarter(null, Q3_START, Q3_END)).toBe(3);
  });

  it('季度前入职 → 3', () => {
    expect(completeMonthsInQuarter(new Date(Date.UTC(2026, 4, 15)), Q3_START, Q3_END)).toBe(3);
  });

  it('第 1 个月月初入职（入职当月不算）→ 2', () => {
    expect(completeMonthsInQuarter(new Date(Date.UTC(2026, 6, 1)), Q3_START, Q3_END)).toBe(2);
  });

  it('第 1 个月月中入职 → 2', () => {
    expect(completeMonthsInQuarter(new Date(Date.UTC(2026, 6, 15)), Q3_START, Q3_END)).toBe(2);
  });

  it('第 2 个月入职 → 1', () => {
    expect(completeMonthsInQuarter(new Date(Date.UTC(2026, 7, 10)), Q3_START, Q3_END)).toBe(1);
  });

  it('第 3 个月入职 → 0', () => {
    expect(completeMonthsInQuarter(new Date(Date.UTC(2026, 8, 20)), Q3_START, Q3_END)).toBe(0);
  });

  it('季度后入职 → 0', () => {
    expect(completeMonthsInQuarter(new Date(Date.UTC(2026, 9, 1)), Q3_START, Q3_END)).toBe(0);
  });
});

describe('enrolledInQuarter', () => {
  const enrolledCases: [Date | null, boolean][] = [
    [null, true],
    [new Date(Date.UTC(2026, 4, 15)), true], // 季前
    [new Date(Date.UTC(2026, 6, 15)), true], // 月 1 → 2 完整月
    [new Date(Date.UTC(2026, 7, 10)), false], // 月 2 → 1 完整月
    [new Date(Date.UTC(2026, 8, 20)), false], // 月 3 → 0
  ];
  it.each(enrolledCases)('joinedAt=%s → enrolled=%s', (joinedAt, expected) => {
    expect(enrolledInQuarter(joinedAt, Q3_START, Q3_END)).toBe(expected);
  });
});

describe('validatePeerAssignment', () => {
  it('无历史 → 允许', () => {
    expect(validatePeerAssignment([], '2026-Q3', 'peerA')).toEqual({ ok: true });
  });

  it('连续第 2 季同一 peer → 允许', () => {
    expect(validatePeerAssignment(
      [{ quarter: '2026-Q2', peerId: 'peerA' }],
      '2026-Q3',
      'peerA',
    )).toEqual({ ok: true });
  });

  it('连续第 3 季同一 peer → 拒绝', () => {
    const r = validatePeerAssignment(
      [
        { quarter: '2026-Q1', peerId: 'peerA' },
        { quarter: '2026-Q2', peerId: 'peerA' },
      ],
      '2026-Q3',
      'peerA',
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('peerA');
  });

  it('跨年连续（2026-Q3→Q4→2027-Q1）第 3 季 → 拒绝', () => {
    const r = validatePeerAssignment(
      [
        { quarter: '2026-Q3', peerId: 'peerA' },
        { quarter: '2026-Q4', peerId: 'peerA' },
      ],
      '2027-Q1',
      'peerA',
    );
    expect(r.ok).toBe(false);
  });

  it('跨年仅连续 2 季（2026-Q4→2027-Q1）→ 允许', () => {
    expect(validatePeerAssignment(
      [{ quarter: '2026-Q4', peerId: 'peerA' }],
      '2027-Q1',
      'peerA',
    )).toEqual({ ok: true });
  });

  it('中间换过人打断连续 → 允许', () => {
    expect(validatePeerAssignment(
      [
        { quarter: '2026-Q1', peerId: 'peerA' },
        { quarter: '2026-Q2', peerId: 'peerB' },
      ],
      '2026-Q3',
      'peerA',
    )).toEqual({ ok: true });
  });

  it('前两季连续 peerA 但新指定 peerB → 允许', () => {
    expect(validatePeerAssignment(
      [
        { quarter: '2026-Q1', peerId: 'peerA' },
        { quarter: '2026-Q2', peerId: 'peerA' },
      ],
      '2026-Q3',
      'peerB',
    )).toEqual({ ok: true });
  });

  it('季度格式非法 → 抛错', () => {
    expect(() => validatePeerAssignment([], '2026-Q5', 'peerA')).toThrow(InvalidQuarterFormatError);
    expect(() => validatePeerAssignment([], 'bad', 'peerA')).toThrow(InvalidQuarterFormatError);
  });
});

// 定级定岗资格（spec §5 步骤5 / §10）：当季总评 S，或连续两季 A 及以上（S 亦算 A 及以上）。
describe('promotionEligible', () => {
  it('无历史 → 不合格', () => {
    expect(promotionEligible([]).eligible).toBe(false);
  });

  it('当季 S → 合格（依据当季）', () => {
    const r = promotionEligible([
      { quarter: '2026-Q1', grade: 'B' },
      { quarter: '2026-Q2', grade: 'S' },
    ]);
    expect(r.eligible).toBe(true);
    expect(r.basis).toEqual(['2026-Q2']);
  });

  it('连续两季 A + A → 合格（依据两季）', () => {
    const r = promotionEligible([
      { quarter: '2026-Q1', grade: 'A' },
      { quarter: '2026-Q2', grade: 'A' },
    ]);
    expect(r.eligible).toBe(true);
    expect(r.basis).toEqual(['2026-Q1', '2026-Q2']);
  });

  it('连续两季含 S（S 算 A 及以上）→ 合格', () => {
    expect(promotionEligible([
      { quarter: '2026-Q1', grade: 'S' },
      { quarter: '2026-Q2', grade: 'A' },
    ]).eligible).toBe(true);
  });

  it('单季 A（不足连续两季且非 S）→ 不合格', () => {
    expect(promotionEligible([{ quarter: '2026-Q2', grade: 'A' }]).eligible).toBe(false);
  });

  it('两季 A 但不相邻（中间缺季）→ 不合格', () => {
    expect(promotionEligible([
      { quarter: '2026-Q1', grade: 'A' },
      { quarter: '2026-Q3', grade: 'A' },
    ]).eligible).toBe(false);
  });

  it('最近两季非全 A 及以上（A + B）→ 不合格', () => {
    expect(promotionEligible([
      { quarter: '2026-Q1', grade: 'A' },
      { quarter: '2026-Q2', grade: 'B' },
    ]).eligible).toBe(false);
  });

  it('跨年连续两季 A（2026-Q4 + 2027-Q1）→ 合格', () => {
    expect(promotionEligible([
      { quarter: '2026-Q4', grade: 'A' },
      { quarter: '2027-Q1', grade: 'A' },
    ]).eligible).toBe(true);
  });

  it('乱序输入按季度排序后判定当季', () => {
    expect(promotionEligible([
      { quarter: '2026-Q2', grade: 'A' },
      { quarter: '2026-Q1', grade: 'A' },
    ]).eligible).toBe(true);
  });

  it('季度格式非法 → 抛错', () => {
    expect(() => promotionEligible([{ quarter: 'bad', grade: 'A' }])).toThrow(InvalidQuarterFormatError);
  });
});
