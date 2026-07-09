// perf-templates.ts
// 幂等灌入四个打分模板 + 维度 + 档位锚定（数据在 perf-template-data.ts）。
// 可重复执行：score_template 按 code 唯一、score_dimension 按 (template_uid, code)
// 唯一，均走 onConflictDoUpdate，重复跑只刷新不重复插。
//
// 灌库前做权重校验断言（不满足直接抛错、非零退出）：
//   monthly_*     维度权重和 = 100
//   quarterly_employee 软项和 = 55 且 + goal(45) = 100
//   quarterly_leader   软项和 = 60 且 + goal(40) = 100
//
// 用法：
//   pnpm --filter @leader-sync/db seed:perf                 # 正式灌库
//   DRY_RUN=1 pnpm --filter @leader-sync/db seed:perf       # 仅校验 + 打印，不写库
//   tsx db/seed/perf-templates.ts

import 'dotenv/config';
import { createDb, type Database } from '../src/connection';
import { scoreTemplate, scoreDimension } from '../src/schema';
import { PERF_TEMPLATES, type ScoreTemplateSeed } from './perf-template-data';

const templateUidOf = (code: string) => `spt_${code}`;
const dimensionUidOf = (code: string, dimCode: string) => `spd_${code}_${dimCode}`;

/** 各模板期望的软项权重和（灌库前硬校验）。 */
const EXPECTED_SOFT_SUM: Record<string, number> = {
  monthly_employee: 100,
  monthly_leader: 100,
  quarterly_employee: 55,
  quarterly_leader: 60,
};

/** 校验单个模板；不满足抛错。 */
function assertTemplate(t: ScoreTemplateSeed): void {
  const softSum = t.dimensions.reduce((s, d) => s + d.weight, 0);
  const expectedSoft = EXPECTED_SOFT_SUM[t.code];
  if (softSum !== expectedSoft) {
    throw new Error(`[perf-templates] ${t.code} 维度权重和=${softSum}，期望=${expectedSoft}`);
  }
  if (t.scale === 'coefficient') {
    if (t.goalWeight !== null) {
      throw new Error(`[perf-templates] ${t.code} 系数制不应有 goal_weight（当前=${t.goalWeight}）`);
    }
  } else {
    if (t.goalWeight === null) {
      throw new Error(`[perf-templates] ${t.code} 季度模板缺 goal_weight`);
    }
    const total = softSum + t.goalWeight;
    if (total !== 100) {
      throw new Error(`[perf-templates] ${t.code} 软项${softSum} + 目标${t.goalWeight} = ${total}，期望 100`);
    }
  }
  // 维度 code 不得重复（否则 (template_uid, code) 唯一约束会冲突）
  const codes = new Set(t.dimensions.map((d) => d.code));
  if (codes.size !== t.dimensions.length) {
    throw new Error(`[perf-templates] ${t.code} 存在重复维度 code`);
  }
}

export interface SeedPerfResult {
  templates: number;
  dimensions: number;
  dryRun: boolean;
}

export async function seedPerfTemplates(db: Database, dryRun = false): Promise<SeedPerfResult> {
  // 1. 全部先校验，再灌库（fail-fast，避免半写）
  for (const t of PERF_TEMPLATES) assertTemplate(t);

  const result: SeedPerfResult = { templates: 0, dimensions: 0, dryRun };
  if (dryRun) {
    for (const t of PERF_TEMPLATES) {
      result.templates++;
      result.dimensions += t.dimensions.length;
    }
    return result;
  }

  const now = new Date();
  for (const t of PERF_TEMPLATES) {
    const templateUid = templateUidOf(t.code);
    await db
      .insert(scoreTemplate)
      .values({
        templateUid,
        code: t.code,
        version: t.version,
        active: true,
        gradeBands: t.gradeBands,
        goalWeight: t.goalWeight,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: scoreTemplate.code,
        set: {
          templateUid,
          version: t.version,
          active: true,
          gradeBands: t.gradeBands,
          goalWeight: t.goalWeight,
          updatedAt: now,
        },
      });
    result.templates++;

    let sort = 0;
    for (const d of t.dimensions) {
      await db
        .insert(scoreDimension)
        .values({
          dimensionUid: dimensionUidOf(t.code, d.code),
          templateUid,
          code: d.code,
          name: d.name,
          description: d.description,
          // numeric 列的 drizzle 插入类型为 string
          weight: String(d.weight),
          sort,
          scale: t.scale,
          anchors: d.anchors,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [scoreDimension.templateUid, scoreDimension.code],
          set: {
            dimensionUid: dimensionUidOf(t.code, d.code),
            name: d.name,
            description: d.description,
            weight: String(d.weight),
            sort,
            scale: t.scale,
            anchors: d.anchors,
          },
        });
      result.dimensions++;
      sort++;
    }
  }
  return result;
}

async function main() {
  const dryRun = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run');

  // 校验永远先跑（即使无 DATABASE_URL 也能验证数据一致性）
  for (const t of PERF_TEMPLATES) assertTemplate(t);
  console.log(`[perf-templates] 校验通过：${PERF_TEMPLATES.length} 个模板，权重/目标和均正确`);

  if (dryRun) {
    const dims = PERF_TEMPLATES.reduce((s, t) => s + t.dimensions.length, 0);
    console.log(`[perf-templates] DRY_RUN：将灌 ${PERF_TEMPLATES.length} 模板 / ${dims} 维度（未写库）`);
    process.exit(0);
  }

  if (!process.env.DATABASE_URL) {
    console.error('[perf-templates] 缺 DATABASE_URL；如仅想校验请加 DRY_RUN=1。');
    process.exit(1);
  }

  const db = createDb(process.env.DATABASE_URL);
  const r = await seedPerfTemplates(db);
  console.log(`[perf-templates] 灌库完成：${r.templates} 模板 / ${r.dimensions} 维度（幂等 upsert）`);
  process.exit(0);
}

// 仅作为脚本直接运行时执行 main（被 import 时不触发）
if (process.argv[1] && process.argv[1].includes('perf-templates')) {
  main().catch((err) => {
    console.error('[perf-templates] FAILED:', err);
    process.exit(1);
  });
}
