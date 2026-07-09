/**
 * sync-departments.ts
 *
 * 飞书组织架构部门树 + 入职时间同步（spec 2026-07-08 performance-review-module §2.3/§3.3）。
 *   1. contact.department.children 递归 → upsert feishu_department（level 从根往下算）。
 *   2. 各部门成员 join_time → 写 org_cache.joined_at（拿不到容忍，不覆盖为 null）。
 *
 * 与 sync-org-hierarchy 并列（不改后者已测行为）。每日 07:05 cron。
 * 软引用、无 DB 外键；权限/网络错误上抛由 cron 包装捕获。
 */

import { createDb, type Database } from '@leader-sync/db';
import { orgCache, feishuDepartment } from '@leader-sync/db';
import { eq, or } from 'drizzle-orm';
import { config } from '../config';
import { feishuClient } from '../services/feishu-api';

let _defaultDb: Database | null = null;
function defaultDb(): Database {
  if (!_defaultDb) _defaultDb = createDb(config.databaseUrl);
  return _defaultDb;
}

export interface DeptNode {
  deptId: string;
  parentDeptId: string;
  name: string;
  leaderUserId: string; // open_id，可空串
}

export interface UserJoinTime {
  openId: string;
  /** 入职时间；接口未返回则为 null（不写库） */
  joinedAt: Date | null;
}

export interface DepartmentDeps {
  /** 全量部门（根 '0' 递归子树，不含根自身）。 */
  listDepartments(): Promise<DeptNode[]>;
  /** 全量用户入职时间（open_id → joinedAt）。 */
  listUserJoinTimes(): Promise<UserJoinTime[]>;
}

/** 默认实现：复用生产 lark client（与 sync-org-hierarchy 同套凭证/枚举方式）。 */
const defaultDeps: DepartmentDeps = {
  async listDepartments(): Promise<DeptNode[]> {
    const out: DeptNode[] = [];
    let pageToken: string | undefined;
    do {
      const res: any = await feishuClient.contact.department.children({
        path: { department_id: '0' },
        params: {
          fetch_child: true,
          page_size: 50,
          department_id_type: 'open_department_id',
          user_id_type: 'open_id',
          ...(pageToken ? { page_token: pageToken } : {}),
        },
      });
      if (res?.code !== 0) throw new Error(`departments code=${res?.code} msg=${res?.msg}`);
      for (const d of res?.data?.items ?? []) {
        out.push({
          deptId: d.open_department_id,
          parentDeptId: d.parent_department_id ?? '0',
          name: d.name ?? '',
          leaderUserId: d.leader_user_id ?? '',
        });
      }
      pageToken = res?.data?.has_more ? res?.data?.page_token : undefined;
    } while (pageToken);
    return out;
  },

  async listUserJoinTimes(): Promise<UserJoinTime[]> {
    const byOpenId = new Map<string, UserJoinTime>();
    // 沿部门枚举成员（同 sync-org-hierarchy 的覆盖方式）
    const deptIds = ['0', ...(await defaultDeps.listDepartments()).map((d) => d.deptId)];
    for (const deptId of deptIds) {
      let pt: string | undefined;
      do {
        const res: any = await feishuClient.contact.user.findByDepartment({
          params: {
            department_id: deptId,
            page_size: 50,
            user_id_type: 'open_id',
            department_id_type: 'open_department_id',
            ...(pt ? { page_token: pt } : {}),
          },
        });
        if (res?.code !== 0) throw new Error(`findByDepartment(${deptId}) code=${res?.code} msg=${res?.msg}`);
        for (const u of res?.data?.items ?? []) {
          if (!u?.open_id) continue;
          // join_time 为 unix 秒；缺失则 null（不覆盖）
          const joinedAt = u.join_time ? new Date(Number(u.join_time) * 1000) : null;
          if (!byOpenId.has(u.open_id)) byOpenId.set(u.open_id, { openId: u.open_id, joinedAt });
        }
        pt = res?.data?.has_more ? res?.data?.page_token : undefined;
      } while (pt);
    }
    return [...byOpenId.values()];
  },
};

/** 由 parent 链计算 level：parent 为 '0'/空 → 1；否则 parentLevel + 1。 */
export function computeLevels(depts: DeptNode[]): Map<string, number> {
  const parentOf = new Map<string, string>();
  for (const d of depts) parentOf.set(d.deptId, d.parentDeptId);
  const levelOf = new Map<string, number>();
  const resolve = (id: string, guard: Set<string>): number => {
    if (levelOf.has(id)) return levelOf.get(id)!;
    const parent = parentOf.get(id);
    let lvl: number;
    if (!parent || parent === '0' || !parentOf.has(parent)) {
      lvl = 1; // 根的直接子
    } else if (guard.has(id)) {
      lvl = 1; // 防环兜底
    } else {
      guard.add(id);
      lvl = resolve(parent, guard) + 1;
    }
    levelOf.set(id, lvl);
    return lvl;
  };
  for (const d of depts) resolve(d.deptId, new Set());
  return levelOf;
}

export interface DepartmentSyncOptions {
  now?: Date;
  dryRun?: boolean;
  db?: Database;
  deps?: DepartmentDeps;
}

export interface DepartmentSyncResult {
  deptCount: number;
  deptUpserted: number;
  joinedAtUpdated: number;
  dryRun: boolean;
}

export async function runSyncDepartments(opts: DepartmentSyncOptions = {}): Promise<DepartmentSyncResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? false;
  const db = opts.db ?? defaultDb();
  const deps = opts.deps ?? defaultDeps;

  const result: DepartmentSyncResult = { deptCount: 0, deptUpserted: 0, joinedAtUpdated: 0, dryRun };

  // 1. 部门树
  const depts = await deps.listDepartments();
  result.deptCount = depts.length;
  const levels = computeLevels(depts);

  for (const d of depts) {
    if (!dryRun) {
      await db
        .insert(feishuDepartment)
        .values({
          deptId: d.deptId,
          parentDeptId: d.parentDeptId || null,
          name: d.name || null,
          leaderUserId: d.leaderUserId || null,
          level: levels.get(d.deptId) ?? 1,
          syncedAt: now,
        })
        .onConflictDoUpdate({
          target: feishuDepartment.deptId,
          set: {
            parentDeptId: d.parentDeptId || null,
            name: d.name || null,
            leaderUserId: d.leaderUserId || null,
            level: levels.get(d.deptId) ?? 1,
            syncedAt: now,
          },
        });
    }
    result.deptUpserted++;
  }

  // 2. 入职时间（仅在拿到 join_time 时写；不覆盖为 null）
  const joinTimes = await deps.listUserJoinTimes();
  for (const u of joinTimes) {
    if (!u.joinedAt) continue;
    if (!dryRun) {
      await db
        .update(orgCache)
        .set({ joinedAt: u.joinedAt, updatedAt: now })
        .where(or(eq(orgCache.openId, u.openId), eq(orgCache.userId, u.openId)));
    }
    result.joinedAtUpdated++;
  }

  console.log(
    `  [sync-departments] depts=${result.deptCount} upserted=${result.deptUpserted} ` +
      `joined-at=${result.joinedAtUpdated}${dryRun ? ' [DRY-RUN]' : ''}`,
  );
  return result;
}
