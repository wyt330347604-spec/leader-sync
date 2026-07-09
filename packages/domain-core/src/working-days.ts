// 工作日推算（纯函数，零 I/O）
// 依据：spec 2026-07-08 performance-review-module §5 步骤4：公示后 appeal_deadline = 公示 + 3 个工作日。
// 约定：按 UTC 判定星期（周六=6、周日=0 跳过），与运行环境时区无关（与 perf-scoring 一致）；
//   保留入参时分秒，仅推进日期；返回新 Date，不修改入参。

const MS_PER_DAY = 86_400_000;
const SATURDAY = 6;
const SUNDAY = 0;

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === SATURDAY || day === SUNDAY;
}

/**
 * 从 base 起推进 n 个工作日（周六日不计入）。n=0 返回等值副本。
 * 逐个自然日前移：落在工作日才计数，直至计满 n 个工作日。
 * 起点若为周末不计为工作日，会先跨到最近的工作日再开始计数。
 */
export function addWorkingDays(base: Date, n: number): Date {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`addWorkingDays: n must be a non-negative integer, got ${n}`);
  }
  const result = new Date(base.getTime());
  let counted = 0;
  while (counted < n) {
    result.setTime(result.getTime() + MS_PER_DAY);
    if (!isWeekend(result)) counted += 1;
  }
  return result;
}
