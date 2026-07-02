/**
 * sync-org-hierarchy.ts
 *
 * 飞书通讯录上下级同步：为 org_cache 每个用户拉取其直属上级
 * （contact v3 user.leader_user_id，user_id_type=open_id），写入
 * manager_user_id/manager_name —— 这是月度绩效打分 rater 的唯一来源。
 *
 * 同步范围 = org_cache 全部行 ∪ 活跃任务 distinct 负责人（覆盖从未登录
 * Web 但有任务的员工，此类会新建 org_cache 行，user_id=open_id=ou_）。
 *
 * 仲裁规则（spec 2026-07-02 D1）：manager_source='manual'（组织架构图人工
 * 调整）的行跳过，同步不覆盖；'feishu' 行每次同步刷新。
 *
 * 前置：飞书后台需开通讯录只读权限（contact:contact.base:readonly）。
 * 未开权限时抛 OrgSyncPermissionError（带指引），不做任何部分写入。
 */

import { createDb, type Database } from '@leader-sync/db';
import { orgCache, task } from '@leader-sync/db';
import { eq, isNull } from 'drizzle-orm';
import { config } from '../config';
import { feishuClient } from '../services/feishu-api';

let _defaultDb: Database | null = null;
function defaultDb(): Database {
  if (!_defaultDb) _defaultDb = createDb(config.databaseUrl);
  return _defaultDb;
}

export class OrgSyncPermissionError extends Error {
  constructor(detail: string) {
    super(
      `飞书通讯录权限未开通，无法同步上下级关系（${detail}）。` +
        '请在飞书开放平台后台为应用开通「contact:contact.base:readonly」权限并发布版本后重试。',
    );
    this.name = 'OrgSyncPermissionError';
  }
}

/** 飞书返回的权限类错误码（tenant 无通讯录 scope） */
const PERMISSION_ERROR_PATTERN = /99991663|99991672|99992402|Access denied|no.?permission/i;

export interface ContactUser {
  openId: string;
  name: string;
  /** 直属上级 open_id（ou_），无上级为空串 */
  leaderOpenId: string;
}

export interface ContactDeps {
  /** 按 open_id 查用户；查不到（离职等）返回 null；权限错误抛 OrgSyncPermissionError */
  getUser(openId: string): Promise<ContactUser | null>;
}

const defaultContact: ContactDeps = {
  async getUser(openId: string): Promise<ContactUser | null> {
    let res: any;
    try {
      res = await feishuClient.contact.user.get({
        path: { user_id: openId },
        params: { user_id_type: 'open_id', department_id_type: 'open_department_id' },
      });
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (PERMISSION_ERROR_PATTERN.test(msg)) throw new OrgSyncPermissionError(msg);
      console.warn(`  [sync-org] getUser(${openId}) failed:`, msg);
      return null;
    }
    if (res?.code !== 0) {
      const detail = `code=${res?.code} msg=${res?.msg}`;
      if (PERMISSION_ERROR_PATTERN.test(detail)) throw new OrgSyncPermissionError(detail);
      console.warn(`  [sync-org] getUser(${openId}) non-zero:`, detail);
      return null;
    }
    const u = res?.data?.user;
    if (!u) return null;
    return { openId: u.open_id ?? openId, name: u.name ?? '', leaderOpenId: u.leader_user_id ?? '' };
  },
};

export interface OrgSyncOptions {
  now?: Date;
  dryRun?: boolean;
  db?: Database;
  contact?: ContactDeps;
}

export interface OrgSyncResult {
  /** 参与同步的身份数（org_cache ∪ 任务负责人，去重后） */
  scanned: number;
  updated: number;
  created: number;
  skippedManual: number;
  notFound: number;
  noOpenId: number;
  dryRun: boolean;
}

/** org_cache 行的 ou_ 句柄：优先 open_id，其次 user_id 本身是 ou_ */
function ouHandle(row: any): string | null {
  if (row.openId?.startsWith('ou_')) return row.openId;
  if (row.userId?.startsWith('ou_')) return row.userId;
  return null;
}

export async function runSyncOrgHierarchy(opts: OrgSyncOptions = {}): Promise<OrgSyncResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? false;
  const db = opts.db ?? defaultDb();
  const contact = opts.contact ?? defaultContact;

  const result: OrgSyncResult = {
    scanned: 0,
    updated: 0,
    created: 0,
    skippedManual: 0,
    notFound: 0,
    noOpenId: 0,
    dryRun,
  };

  // 1. 现有 org_cache 行 + 活跃任务负责人（去重）
  const orgRows: any[] = await db.select().from(orgCache);
  const assigneeRows: any[] = await db
    .select({ assigneeUserId: task.assigneeUserId })
    .from(task)
    .where(isNull(task.deletedAt));

  const rowByHandle = new Map<string, any>();
  for (const row of orgRows) {
    const h = ouHandle(row);
    if (h) rowByHandle.set(h, row);
    else result.noOpenId++;
  }
  const identitySet = new Set<string>(rowByHandle.keys());
  for (const a of assigneeRows) {
    const id = a.assigneeUserId;
    if (id?.startsWith('ou_')) identitySet.add(id);
  }
  result.scanned = identitySet.size;
  if (identitySet.size === 0) return result;

  // 2. worklist 拉通讯录：identity 全集 + 沿 leader 链向上发现的新用户
  //    （leader 也入库——score-window 解析 rater 姓名/发卡 open_id 需要其 org_cache 行）。
  //    权限错误直接上抛，不做部分写入；查不到的（离职等）跳过。
  const fetched = new Map<string, ContactUser>();
  const queue = [...identitySet];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const ou = queue.shift()!;
    const u = await contact.getUser(ou);
    if (!u) {
      if (identitySet.has(ou)) result.notFound++;
      continue;
    }
    fetched.set(ou, u);
    const leaderOu = u.leaderOpenId && u.leaderOpenId !== ou ? u.leaderOpenId : '';
    if (leaderOu && !seen.has(leaderOu)) {
      seen.add(leaderOu);
      queue.push(leaderOu);
    }
  }

  // 3. 写入：已有行 update（manual 跳过），无行 insert
  for (const [ou, u] of fetched) {
    const existing = rowByHandle.get(ou);
    const leaderOu = u.leaderOpenId && u.leaderOpenId !== ou ? u.leaderOpenId : '';
    const managerName = leaderOu ? (fetched.get(leaderOu)?.name || null) : null;

    if (existing) {
      if (existing.managerSource === 'manual') {
        result.skippedManual++;
        continue;
      }
      if (!dryRun) {
        await db
          .update(orgCache)
          .set({
            openId: existing.openId ?? ou,
            userName: existing.userName ?? u.name ?? null,
            managerUserId: leaderOu || null,
            managerName,
            managerSource: 'feishu',
            managerUpdatedAt: now,
            managerUpdatedBy: 'system:sync',
            updatedAt: now,
          })
          .where(eq(orgCache.id, existing.id));
      }
      result.updated++;
    } else {
      if (!dryRun) {
        await db
          .insert(orgCache)
          .values({
            userId: ou,
            openId: ou,
            userName: u.name || null,
            managerUserId: leaderOu || null,
            managerName,
            managerSource: 'feishu',
            managerUpdatedAt: now,
            managerUpdatedBy: 'system:sync',
            updatedAt: now,
          })
          .onConflictDoNothing();
      }
      result.created++;
    }
  }

  console.log(
    `  [sync-org] scanned=${result.scanned} updated=${result.updated} created=${result.created} ` +
      `manual-skipped=${result.skippedManual} not-found=${result.notFound} no-open-id=${result.noOpenId}` +
      `${dryRun ? ' [DRY-RUN]' : ''}`,
  );
  return result;
}
