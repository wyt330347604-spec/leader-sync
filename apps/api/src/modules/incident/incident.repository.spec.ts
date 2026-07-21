import { describe, it, expect } from 'vitest';
import { IncidentRepository } from './incident.repository';

/**
 * findOrgUser 双命名空间回归：事故的报告人/关联人传入的 id 可能是员工 user_id，
 * 也可能是飞书 ou_ open_id（全系统 user_id/open_id 双命名空间问题）。旧实现只按
 * userId 匹配，会漏掉 org_cache 里以 open_id 为主键的行 → 查不到人、名字落空。
 * 新语义：user_id OR open_id 任一命中即返回。
 */

function makeDb(rows: any[]) {
  const whereConds: any[] = [];
  const db = {
    whereConds,
    select: () => ({
      from: (_tbl: any) => ({
        where: (cond: any) => {
          whereConds.push(cond);
          return Promise.resolve(rows);
        },
      }),
    }),
  };
  return { db, whereConds };
}

// 遍历 drizzle 条件 AST，收集其中引用到的列名（谓词盲 mock 的补强断言，
// 与 auth.service.spec 同款：mock 无视 WHERE 返回固定行，故须直接检查条件本身）。
function collectColumnNames(cond: any): string[] {
  const names: string[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (typeof n.name === 'string' && n.table) names.push(n.name);
    for (const k of n.queryChunks ?? (Array.isArray(n) ? n : [])) walk(k);
  };
  walk(cond);
  return names;
}

describe('IncidentRepository.findOrgUser 双命名空间', () => {
  it('查询条件同时按 user_id 和 open_id 匹配', async () => {
    const { db } = makeDb([{ userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice' }]);
    const repo = new IncidentRepository(db as any);

    const result = await repo.findOrgUser('emp_alice');

    expect(result).toMatchObject({ userName: 'Alice' });
    const colNames = collectColumnNames(db.whereConds[0]);
    expect(colNames).toContain('user_id');
    expect(colNames).toContain('open_id');
  });

  it('查无此人返回 null', async () => {
    const { db } = makeDb([]);
    const repo = new IncidentRepository(db as any);

    expect(await repo.findOrgUser('nobody')).toBeNull();
  });
});
