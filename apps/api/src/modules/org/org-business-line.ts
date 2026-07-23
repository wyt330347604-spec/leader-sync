// 顶端负责人句柄 → 业务线。数据无公司/部门字段，按汇报链顶端归类。
// 2026-07-23：Tobi=虾条(2 账号)；孔德俊/祁雁飞=曙条。加新公司改此表一行。
const ROOT_TO_LINE: Record<string, 'xt' | 'dfw'> = {
  '2d2adg26': 'xt',
  ou_243a9225acc248c148c25f8fe0699407: 'xt', // Tobi
  ou_da7e2a5ae070ceb2b247569aa8acdf87: 'dfw', // 孔德俊
  ou_b23684cac81e32b5631dfcee7dbe4e27: 'dfw', // 祁雁飞
};

/** 沿 manager 链向上爬到顶端，返回顶端句柄对应业务线；爬不到已知顶端 → 'ungrouped' */
export function resolveBusinessLine(
  row: any,
  lookup: Map<string, any>,
  ouHandle: (r: any) => string,
): 'xt' | 'dfw' | 'ungrouped' {
  const seen = new Set<number>();
  let cursor: any = row;
  while (cursor) {
    if (seen.has(cursor.id)) break; // 防环
    seen.add(cursor.id);
    const line = ROOT_TO_LINE[ouHandle(cursor)];
    if (line) return line;
    const mid = cursor.managerUserId;
    if (!mid || mid === cursor.userId) break; // 到顶
    cursor = lookup.get(mid);
  }
  return 'ungrouped';
}
