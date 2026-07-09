/**
 * me-performance.service.spec.ts — GET /api/v1/me/performance 聚合（repo/service 全 mock）。
 * 覆盖：聚合月度走势 + 季度成绩 + 半年成绩 + 当前职级 + 定级资格；空数据兜底。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MePerformanceService } from './me-performance.service';

const USER = { userId: 'ou_alice', role: 'employee', openId: 'ou_alice' };

function mocks() {
  const repo = {
    listMonthlyScoresByRatee: vi.fn().mockResolvedValue([]),
    findOrgByCandidates: vi.fn().mockResolvedValue(null),
  };
  const resultRepo = {
    listPublishedResultsByRatee: vi.fn().mockResolvedValue([]),
    listHalfYearResultsByRatee: vi.fn().mockResolvedValue([]),
  };
  const resultService = {
    getPromotionEligibility: vi.fn().mockResolvedValue({ eligible: false, reason: '暂无', basis: [] }),
  };
  return { repo, resultRepo, resultService };
}

function make(m: ReturnType<typeof mocks>) {
  return new MePerformanceService(m.repo as any, m.resultRepo as any, m.resultService as any);
}

describe('MePerformanceService.getMyPerformance', () => {
  let m: ReturnType<typeof mocks>;
  beforeEach(() => {
    m = mocks();
  });

  it('聚合月度走势/季度/半年/职级/定级资格', async () => {
    m.repo.listMonthlyScoresByRatee.mockResolvedValue([
      { scoreMonth: '2026-04', totalScore: '91.5', composite: '0.92', grade: 'A', redLine: false },
      { scoreMonth: '2026-05', totalScore: '88.0', composite: '0.88', grade: 'B', redLine: false },
    ]);
    m.resultRepo.listPublishedResultsByRatee.mockResolvedValue([
      { resultUid: 'qr_1', quarter: '2026-Q2', total: '88.5', grade: 'A', softMerged: '48.5', goalScore: '40.0' },
    ]);
    m.resultRepo.listHalfYearResultsByRatee.mockResolvedValue([
      { resultUid: 'hyr_1', half: '2026-H1', total: '87.0', grade: 'A', formula: '40/60' },
    ]);
    m.repo.findOrgByCandidates.mockResolvedValue({ userId: 'ou_alice', openId: 'ou_alice', currentGrade: 'T5.2' });
    m.resultService.getPromotionEligibility.mockResolvedValue({ eligible: true, reason: '当季 S', basis: ['2026-Q2'] });

    const out = await make(m).getMyPerformance(USER as any);

    expect(out.monthlyTrend).toHaveLength(2);
    expect(out.monthlyTrend[0]).toMatchObject({ month: '2026-04', composite: 0.92, grade: 'A' });
    expect(out.quarterResults).toHaveLength(1);
    expect(out.quarterResults[0]).toMatchObject({ quarter: '2026-Q2', total: 88.5, grade: 'A', resultUid: 'qr_1' });
    expect(out.halfYearResults[0]).toMatchObject({ half: '2026-H1', total: 87, grade: 'A', formula: '40/60' });
    expect(out.grade).toBe('T5.2');
    expect(out.promotion).toMatchObject({ eligible: true, reason: '当季 S', basis: ['2026-Q2'] });
    // 定级资格按本人查询（isSelf 放行）
    expect(m.resultService.getPromotionEligibility).toHaveBeenCalledWith('ou_alice', USER);
  });

  it('无任何数据 → 各列表空、grade null、promotion 不合格', async () => {
    const out = await make(m).getMyPerformance(USER as any);
    expect(out.monthlyTrend).toEqual([]);
    expect(out.quarterResults).toEqual([]);
    expect(out.halfYearResults).toEqual([]);
    expect(out.grade).toBeNull();
    expect(out.promotion.eligible).toBe(false);
  });
});
