/**
 * MePerformanceService
 *
 * GET /api/v1/me/performance 聚合当前登录人的绩效档案（spec §6 /me/performance）：
 *   月度综合系数走势 + 季度成绩 + 半年成绩 + 当前职级 + 定级定岗资格。
 * 只做组装，不重复计分：季度/半年/资格一律复用既有 service/repository。
 */
import { Injectable } from '@nestjs/common';
import { QuarterRepository } from './quarter.repository';
import { QuarterResultRepository } from './quarter-result.repository';
import { QuarterResultService } from './quarter-result.service';
import type { Requestor } from './quarter.service';

function idCandidates(userId: string, openId?: string | null): string[] {
  return [...new Set([userId, openId].filter((x): x is string => Boolean(x)))];
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface MonthlyTrendPoint {
  month: string;
  totalScore: number | null;
  composite: number | null;
  grade: string | null;
  redLine: boolean;
}

@Injectable()
export class MePerformanceService {
  constructor(
    private readonly repo: QuarterRepository,
    private readonly resultRepo: QuarterResultRepository,
    private readonly resultService: QuarterResultService,
  ) {}

  async getMyPerformance(user: Requestor) {
    const candidates = idCandidates(user.userId, user.openId);
    const [monthly, quarters, halfYears, org, promotion] = await Promise.all([
      this.repo.listMonthlyScoresByRatee(candidates),
      this.resultRepo.listPublishedResultsByRatee(candidates),
      this.resultRepo.listHalfYearResultsByRatee(candidates),
      this.repo.findOrgByCandidates(candidates),
      // 本人查本人 → isSelf 放行；复用既有资格判定纯函数，不重复实现。
      this.resultService.getPromotionEligibility(user.userId, user),
    ]);

    const monthlyTrend: MonthlyTrendPoint[] = monthly.map((m: any) => {
      const total = num(m.totalScore);
      // composite 优先取回写值；旧行（无 composite）由 total/100 推算，再退到 0–1 旧系数。
      const composite = num(m.composite) ?? (total !== null ? Math.round((total / 100) * 100) / 100 : num(m.score));
      return { month: m.scoreMonth, totalScore: total, composite, grade: m.grade ?? null, redLine: Boolean(m.redLine) };
    });

    const quarterResults = quarters.map((r: any) => ({
      resultUid: r.resultUid,
      quarter: r.quarter,
      total: num(r.total),
      grade: r.grade ?? null,
      softMerged: num(r.softMerged),
      goalScore: num(r.goalScore),
      sheetType: r.sheetType ?? null,
      status: r.status,
      appealDeadlineAt: r.appealDeadlineAt ?? null,
    }));

    const halfYearResults = halfYears.map((r: any) => ({
      resultUid: r.resultUid,
      half: r.half,
      total: num(r.total),
      grade: r.grade ?? null,
      formula: r.formula ?? null,
    }));

    return {
      monthlyTrend,
      quarterResults,
      halfYearResults,
      grade: org?.currentGrade ?? null,
      promotion: {
        eligible: promotion.eligible,
        reason: promotion.reason,
        basis: promotion.basis,
      },
    };
  }
}
