/** 甘特时间轴换算工具（需求维度 / 人力容量维度共用）。 */
export const DAY = 24 * 60 * 60 * 1000;

export const ms = (s: string | null | undefined): number | null => (s ? new Date(s).getTime() : null);

/** 月度刻度（左偏移百分比 + 标签）。 */
export function monthTicks(min: number, max: number): { left: number; label: string }[] {
  const ticks: { left: number; label: string }[] = [];
  const span = max - min || DAY;
  const d = new Date(min);
  d.setDate(1);
  if (d.getTime() < min) d.setMonth(d.getMonth() + 1);
  while (d.getTime() <= max) {
    ticks.push({ left: ((d.getTime() - min) / span) * 100, label: `${d.getMonth() + 1}月` });
    d.setMonth(d.getMonth() + 1);
  }
  return ticks;
}

/** 起止时间映射成泳道内的 {left,width} 百分比；缺端点时给 7 天兜底。 */
export function pos(start: number | null, end: number | null, min: number, max: number): { left: number; width: number } | null {
  if (start === null && end === null) return null;
  const span = max - min || DAY;
  const s = start ?? (end as number) - 7 * DAY;
  const e = end ?? (start as number) + 7 * DAY;
  const left = Math.max(0, ((s - min) / span) * 100);
  const width = Math.max(1.5, Math.min(100 - left, ((e - s) / span) * 100));
  return { left, width };
}

/** 收集一组 [start,end] 端点求全局范围；无数据返回 null。 */
export function rangeOf(spans: readonly { start: number | null; end: number | null }[]): { min: number; max: number } | null {
  let min: number | null = null, max: number | null = null;
  for (const { start, end } of spans) {
    if (start !== null) min = min === null ? start : Math.min(min, start);
    if (end !== null) max = max === null ? end : Math.max(max, end);
    if (start !== null) max = max === null ? start : Math.max(max, start);
    if (end !== null) min = min === null ? end : Math.min(min, end);
  }
  if (min === null) return null;
  if (max === null || max <= min) return { min, max: min + 30 * DAY };
  return { min, max };
}

/** 生成 [from,to] 的逐日时间戳（按天对齐）。用于容量每日负载。 */
export function dayStamps(min: number, max: number): number[] {
  const days: number[] = [];
  const d = new Date(min);
  d.setHours(0, 0, 0, 0);
  while (d.getTime() <= max) {
    days.push(d.getTime());
    d.setDate(d.getDate() + 1);
  }
  return days;
}
