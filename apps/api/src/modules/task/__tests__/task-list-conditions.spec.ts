import { describe, it, expect } from 'vitest';
import { buildListConditions } from '../task.repository';

/** 循环安全 stringify，用于在 drizzle SQL 条件里查列名/操作符 */
function safeStr(obj: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (_k, v) => {
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return undefined;
      seen.add(v);
    }
    return v;
  }).toLowerCase();
}

const USERS = ['ou_alice'];

describe('buildListConditions — 软删除 / 状态筛选口径', () => {
  it('默认（active）只看未删除：deleted_at IS NULL，且状态限定活跃集', () => {
    const conds = buildListConditions(USERS, { status: 'active', role: 'all' });
    const s = safeStr(conds);
    expect(s).toMatch(/deleted_at/);
    expect(s).toMatch(/null/);
    expect(s).not.toMatch(/not null|is not null/);
    // 活跃集包含 in_progress
    expect(s).toMatch(/in_progress/);
  });

  it('deleted 筛选：只看已删除（deleted_at IS NOT NULL），不再叠加状态等值', () => {
    const conds = buildListConditions(USERS, { status: 'deleted', role: 'all' });
    const s = safeStr(conds);
    expect(s).toMatch(/not null/);
    // deleted 视图不叠加任何 status 等值/集合过滤（不应出现活跃集或 stalled 集 token）
    expect(s).not.toMatch(/in_progress/);
    expect(s).not.toMatch(/stalled/);
  });

  it('stalled 仍映射 stalled+shelved 且只看未删除', () => {
    const conds = buildListConditions(USERS, { status: 'stalled', role: 'all' });
    const s = safeStr(conds);
    expect(s).toMatch(/shelved/);
    expect(s).toMatch(/null/);
    expect(s).not.toMatch(/not null/);
  });

  it('bucket 过滤生效', () => {
    const conds = buildListConditions(USERS, { status: 'deleted', role: 'all', bucket: '2026-05' });
    expect(safeStr(conds)).toMatch(/month_bucket/);
  });

  it('from（本月及未来）过滤：month_bucket >= from', () => {
    const conds = buildListConditions(USERS, { status: 'active', role: 'all', from: '2026-06' });
    const s = safeStr(conds);
    expect(s).toMatch(/month_bucket/);
    expect(s).toMatch(/2026-06/);
    // 应是 >= 比较（gte），不是精确等值
    expect(s).toMatch(/>=|gte/);
  });

  it('私有可见性：条件含 visibility + created_by（私有仅创建者可见）', () => {
    const s = safeStr(buildListConditions(USERS, { status: 'active', role: 'all' }));
    expect(s).toMatch(/visibility/);
    expect(s).toMatch(/created_by/);
  });
});
