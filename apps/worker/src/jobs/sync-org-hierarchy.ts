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

/** 安全阀：本次通讯录枚举数不足在册行数此比例 → 判定飞书 API 故障，跳过离职判定 */
const LEAVE_SAFETY_MIN_RATIO = 0.5;

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
  /** 全量枚举通讯录（根部门递归 + 各部门成员，去重）；权限错误抛 OrgSyncPermissionError */
  listAllUsers(): Promise<ContactUser[]>;
}

/** 从 lark SDK 异常/非零响应中提取错误详情；权限类直接抛 OrgSyncPermissionError */
function extractFeishuError(err: unknown): string {
  const body = (err as any)?.response?.data;
  const detail = body ? `code=${body.code} msg=${body.msg}` : ((err as Error).message ?? String(err));
  if (PERMISSION_ERROR_PATTERN.test(detail)) throw new OrgSyncPermissionError(detail);
  return detail;
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
      // lark SDK 把飞书错误包成裸 AxiosError（message 只有 status），
      // 真正的 code/msg 在 response.data —— 权限错误必须从这里识别（实测 99991672 → HTTP 400）
      console.warn(`  [sync-org] getUser(${openId}) failed:`, extractFeishuError(err));
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

  // 全量：根部门递归拿所有部门 → 逐部门拉成员（分页）→ 按 open_id 去重。
  // 实测覆盖比 user.get 更全（个别用户 user.get 报 41050，但部门枚举可见）。
  async listAllUsers(): Promise<ContactUser[]> {
    const users = new Map<string, ContactUser>();
    try {
      const deptIds: string[] = ['0'];
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
        for (const d of res?.data?.items ?? []) deptIds.push(d.open_department_id);
        pageToken = res?.data?.has_more ? res?.data?.page_token : undefined;
      } while (pageToken);

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
            users.set(u.open_id, {
              openId: u.open_id,
              name: u.name ?? '',
              leaderOpenId: u.leader_user_id ?? '',
            });
          }
          pt = res?.data?.has_more ? res?.data?.page_token : undefined;
        } while (pt);
      }
    } catch (err) {
      if (err instanceof OrgSyncPermissionError) throw err;
      throw PERMISSION_ERROR_PATTERN.test(String((err as any)?.response?.data?.code ?? '') + ((err as Error).message ?? ''))
        ? new OrgSyncPermissionError((err as Error).message)
        : err;
    }
    return [...users.values()];
  },
};

export interface OrgSyncOptions {
  now?: Date;
  dryRun?: boolean;
  db?: Database;
  contact?: ContactDeps;
}

export interface OrgSyncResult {
  /** 通讯录全量枚举到的人数 */
  directoryCount: number;
  /** 系统内已知身份数（org_cache ∪ 任务负责人，去重后） */
  scanned: number;
  updated: number;
  created: number;
  skippedManual: number;
  notFound: number;
  noOpenId: number;
  /** 本次新标离职的行数 */
  markedLeft: number;
  /** 本次自愈复职（清 left_at）的行数 */
  revived: number;
  /** 安全阀触发（枚举数过低，跳过离职判定） */
  safetyValveTriggered: boolean;
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
    directoryCount: 0,
    scanned: 0,
    updated: 0,
    created: 0,
    skippedManual: 0,
    notFound: 0,
    noOpenId: 0,
    markedLeft: 0,
    revived: 0,
    safetyValveTriggered: false,
    dryRun,
  };

  // 1. 现有 org_cache 行 + 活跃任务负责人（去重）
  const orgRows: any[] = await db.select().from(orgCache);
  const assigneeRows: any[] = await db
    .select({ assigneeUserId: task.assigneeUserId })
    .from(task)
    .where(isNull(task.deletedAt));

  // 同一人可能有多行（历史手工 ou_ 行 + OAuth 员工 ID 行共享 open_id）——
  // 按句柄收集**全部**行，写入时逐行更新，避免另一行残留旧 manager。
  const rowsByHandle = new Map<string, any[]>();
  for (const row of orgRows) {
    const h = ouHandle(row);
    if (h) {
      const list = rowsByHandle.get(h) ?? [];
      list.push(row);
      rowsByHandle.set(h, list);
    } else {
      result.noOpenId++;
    }
  }
  const identitySet = new Set<string>(rowsByHandle.keys());
  for (const a of assigneeRows) {
    const id = a.assigneeUserId;
    if (id?.startsWith('ou_')) identitySet.add(id);
  }
  result.scanned = identitySet.size;

  // 2a. 全量通讯录（部门递归枚举）——所有在职员工都入库，不只系统已知的人。
  //     权限错误直接上抛，不做部分写入。
  const fetched = new Map<string, ContactUser>();
  for (const u of await contact.listAllUsers()) fetched.set(u.openId, u);
  result.directoryCount = fetched.size;

  // 2b. 系统内已知但不在通讯录枚举里的身份（离职残留等）+ 缺失的 leader，
  //     用单查 worklist 兜底；查不到的（离职等）跳过并计数。
  const queue: string[] = [];
  const seen = new Set<string>(fetched.keys());
  for (const id of identitySet) {
    if (!seen.has(id)) {
      seen.add(id);
      queue.push(id);
    }
  }
  for (const u of fetched.values()) {
    const leaderOu = u.leaderOpenId && u.leaderOpenId !== u.openId ? u.leaderOpenId : '';
    if (leaderOu && !seen.has(leaderOu)) {
      seen.add(leaderOu);
      queue.push(leaderOu);
    }
  }
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

  // 3. 写入：已有行逐行 update（manual 跳过），无行 insert
  for (const [ou, u] of fetched) {
    const existingRows = rowsByHandle.get(ou) ?? [];
    const leaderOu = u.leaderOpenId && u.leaderOpenId !== ou ? u.leaderOpenId : '';
    const managerName = leaderOu ? (fetched.get(leaderOu)?.name || null) : null;

    if (existingRows.length > 0) {
      for (const existing of existingRows) {
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
      }
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

  // 4. 离职判定：fetched 即本次通讯录枚举到的在职集合，做差集。
  //    安全阀：枚举数不足在册可解析行数一半 → 判定飞书 API 故障，跳过标记，防误判全员离职。
  const activeHandles = new Set<string>(fetched.keys());
  const resolvable = orgRows.filter((r) => ouHandle(r) !== null);
  const resolvableActive = resolvable.filter((r) => r.leftAt == null);
  if (fetched.size < resolvableActive.length * LEAVE_SAFETY_MIN_RATIO) {
    result.safetyValveTriggered = true;
    console.warn(
      `  [sync-org] SAFETY VALVE: directory=${fetched.size} < ${LEAVE_SAFETY_MIN_RATIO} * active=${resolvableActive.length} → 跳过离职判定`,
    );
  } else {
    for (const row of resolvable) {
      const h = ouHandle(row)!;
      const isActive = activeHandles.has(h);
      if (isActive && row.leftAt != null) {
        if (!dryRun) await db.update(orgCache).set({ leftAt: null, updatedAt: now }).where(eq(orgCache.id, row.id));
        result.revived++;
      } else if (!isActive && row.leftAt == null) {
        if (!dryRun) await db.update(orgCache).set({ leftAt: now, updatedAt: now }).where(eq(orgCache.id, row.id));
        result.markedLeft++;
      }
    }
  }

  console.log(
    `  [sync-org] directory=${result.directoryCount} scanned=${result.scanned} updated=${result.updated} created=${result.created} ` +
      `manual-skipped=${result.skippedManual} not-found=${result.notFound} no-open-id=${result.noOpenId} ` +
      `marked-left=${result.markedLeft} revived=${result.revived} safety-valve=${result.safetyValveTriggered}` +
      `${dryRun ? ' [DRY-RUN]' : ''}`,
  );
  return result;
}
