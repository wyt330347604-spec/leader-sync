/**
 * sync-perf-roles.ts
 *
 * 飞书群成员同步 → perf_role（绩效打分身份，非 RBAC）。
 * spec 2026-07-08 performance-review-module §2.1/§2.2。
 *
 * 两个群（默认值在 config，可用 PERF_MGMT_CHAT_ID / PERF_LEADER_CHAT_ID 覆盖）：
 *   管理层群 → is_management ；leader 群 → is_leader。
 *
 * 全量对账（非只追加）：在群→置位，不在群→置 false。open_id 关联 org_cache
 * 补 user_id；群里有但 org_cache 没有的人记 warn 跳过。
 *
 * 凭证策略（spec §2.2）：默认用生产 FEISHU_APP_ID/SECRET（方案A）；若配了
 * FEISHU_SYNC_APP_ID + FEISHU_SYNC_APP_SECRET（文档应用，方案B兜底），群成员
 * 接口改用这组凭证，自管 tenant_access_token（缓存写法参考 feishu-bot.service.ts）。
 *
 * 每日 07:10 cron（org 07:00 之后），另提供 scripts/run-sync-perf-roles-once.ts。
 */

import { createDb, type Database } from '@leader-sync/db';
import { orgCache, perfRole } from '@leader-sync/db';
import { eq } from 'drizzle-orm';
import { config } from '../config';

let _defaultDb: Database | null = null;
function defaultDb(): Database {
  if (!_defaultDb) _defaultDb = createDb(config.databaseUrl);
  return _defaultDb;
}

const FEISHU_BASE = 'https://open.feishu.cn';

export interface ChatMember {
  /** 群成员 open_id（member_id_type=open_id 时 member_id 即 open_id） */
  openId: string;
  name: string;
}

export interface ChatMemberDeps {
  /** 拉某群全部成员（自动翻页）；权限/网络错误上抛。 */
  listMembers(chatId: string): Promise<ChatMember[]>;
}

/** tenant_access_token 提供者：按凭证缓存，过期前 60s 复用。 */
function makeTokenProvider(): () => Promise<string> {
  const useSync = Boolean(config.feishuSyncAppId && config.feishuSyncAppSecret);
  const appId = useSync ? config.feishuSyncAppId : config.feishuAppId;
  const appSecret = useSync ? config.feishuSyncAppSecret : config.feishuAppSecret;
  let token: string | null = null;
  let expiresAt = 0;

  return async () => {
    const now = Date.now();
    if (token && now < expiresAt - 60_000) return token;
    if (!appId || !appSecret) {
      throw new Error(
        'sync-perf-roles 缺飞书凭证：请配置 FEISHU_APP_ID/SECRET（方案A）或 FEISHU_SYNC_APP_ID/SECRET（方案B）。',
      );
    }
    const res = await fetch(`${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const json = (await res.json()) as { code: number; msg?: string; tenant_access_token?: string; expire?: number };
    if (json.code !== 0 || !json.tenant_access_token) {
      throw new Error(`获取 tenant_access_token 失败：${JSON.stringify(json)}`);
    }
    token = json.tenant_access_token;
    expiresAt = now + (json.expire ?? 7200) * 1000;
    return token;
  };
}

/** 默认群成员实现：REST + 分页（page_size=100，member_id_type=open_id）。 */
const defaultChat: ChatMemberDeps = {
  async listMembers(chatId: string): Promise<ChatMember[]> {
    const getToken = makeTokenProvider();
    const members: ChatMember[] = [];
    let pageToken: string | undefined;
    do {
      const token = await getToken();
      const url = new URL(`${FEISHU_BASE}/open-apis/im/v1/chats/${chatId}/members`);
      url.searchParams.set('member_id_type', 'open_id');
      url.searchParams.set('page_size', '100');
      if (pageToken) url.searchParams.set('page_token', pageToken);

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const json = (await res.json()) as {
        code: number;
        msg?: string;
        data?: { items?: Array<{ member_id?: string; name?: string }>; page_token?: string; has_more?: boolean };
      };
      if (json.code !== 0) {
        throw new Error(`拉群成员失败 chat=${chatId} code=${json.code} msg=${json.msg}`);
      }
      for (const it of json.data?.items ?? []) {
        if (it.member_id) members.push({ openId: it.member_id, name: it.name ?? '' });
      }
      pageToken = json.data?.has_more ? json.data?.page_token : undefined;
    } while (pageToken);
    return members;
  },
};

export interface PerfRoleSyncOptions {
  now?: Date;
  dryRun?: boolean;
  db?: Database;
  chat?: ChatMemberDeps;
  mgmtChatId?: string;
  leaderChatId?: string;
}

export interface PerfRoleSyncResult {
  /** 管理层群成员数（去重后 open_id 计数） */
  mgmtCount: number;
  /** leader 群成员数 */
  leaderCount: number;
  /** open_id 成功对回 org_cache 的唯一 user 数 */
  matched: number;
  /** upsert（置位）的 perf_role 行数 */
  upserted: number;
  /** 已退群 → 清零（两标志置 false）的行数 */
  cleared: number;
  /** 群里有但 org_cache 查无此人（跳过并 warn）的 open_id 数 */
  notFound: number;
  dryRun: boolean;
}

/** 从 org_cache 行建 open_id → 规范 user_id 的映射。 */
function buildOpenIdToUserId(orgRows: any[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of orgRows) {
    if (row.openId) map.set(row.openId, row.userId);
    // userId 本身是 ou_ open_id（历史手工/任务负责人行）时也可命中
    if (row.userId?.startsWith('ou_') && !map.has(row.userId)) map.set(row.userId, row.userId);
  }
  return map;
}

interface DesiredRole {
  userId: string;
  openId: string;
  isLeader: boolean;
  isManagement: boolean;
  sourceChatIds: string[];
}

export async function runSyncPerfRoles(opts: PerfRoleSyncOptions = {}): Promise<PerfRoleSyncResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? false;
  const db = opts.db ?? defaultDb();
  const chat = opts.chat ?? defaultChat;
  const mgmtChatId = opts.mgmtChatId ?? config.perfMgmtChatId;
  const leaderChatId = opts.leaderChatId ?? config.perfLeaderChatId;

  const result: PerfRoleSyncResult = {
    mgmtCount: 0,
    leaderCount: 0,
    matched: 0,
    upserted: 0,
    cleared: 0,
    notFound: 0,
    dryRun,
  };

  // 1. 拉两个群成员（open_id）
  const mgmtMembers = await chat.listMembers(mgmtChatId);
  const leaderMembers = await chat.listMembers(leaderChatId);
  const mgmtOpenIds = new Set(mgmtMembers.map((m) => m.openId));
  const leaderOpenIds = new Set(leaderMembers.map((m) => m.openId));
  result.mgmtCount = mgmtOpenIds.size;
  result.leaderCount = leaderOpenIds.size;

  // 2. org_cache 映射 open_id → user_id
  const orgRows: any[] = await db.select().from(orgCache);
  const openIdToUserId = buildOpenIdToUserId(orgRows);

  // 3. 期望态：union(两群) → 解析 user_id → 汇总标志
  const desired = new Map<string, DesiredRole>();
  const seenUnresolved = new Set<string>();
  for (const openId of new Set([...mgmtOpenIds, ...leaderOpenIds])) {
    const userId = openIdToUserId.get(openId);
    if (!userId) {
      if (!seenUnresolved.has(openId)) {
        seenUnresolved.add(openId);
        result.notFound++;
        console.warn(`  [sync-perf-roles] 群成员 open_id=${openId} 在 org_cache 查无此人，跳过`);
      }
      continue;
    }
    const isManagement = mgmtOpenIds.has(openId);
    const isLeader = leaderOpenIds.has(openId);
    const sourceChatIds: string[] = [];
    if (isManagement) sourceChatIds.push(mgmtChatId);
    if (isLeader) sourceChatIds.push(leaderChatId);

    // 同一 user_id 可能被多 open_id 命中（极少）——合并标志
    const prev = desired.get(userId);
    if (prev) {
      prev.isLeader = prev.isLeader || isLeader;
      prev.isManagement = prev.isManagement || isManagement;
      for (const c of sourceChatIds) if (!prev.sourceChatIds.includes(c)) prev.sourceChatIds.push(c);
    } else {
      desired.set(userId, { userId, openId, isLeader, isManagement, sourceChatIds });
    }
  }
  result.matched = desired.size;

  // 4. 现有 perf_role（用于对账清零）
  const existingRows: any[] = await db.select().from(perfRole);

  // 5. 置位：upsert 期望态
  for (const d of desired.values()) {
    if (!dryRun) {
      await db
        .insert(perfRole)
        .values({
          userId: d.userId,
          openId: d.openId,
          isLeader: d.isLeader,
          isManagement: d.isManagement,
          sourceChatIds: d.sourceChatIds,
          syncedAt: now,
        })
        .onConflictDoUpdate({
          target: perfRole.userId,
          set: {
            openId: d.openId,
            isLeader: d.isLeader,
            isManagement: d.isManagement,
            sourceChatIds: d.sourceChatIds,
            syncedAt: now,
          },
        });
    }
    result.upserted++;
  }

  // 6. 清零：已在库但两群都不在的行（且当前仍带任一标志）→ 置 false
  for (const row of existingRows) {
    if (desired.has(row.userId)) continue;
    if (!row.isLeader && !row.isManagement) continue;
    if (!dryRun) {
      await db
        .update(perfRole)
        .set({ isLeader: false, isManagement: false, sourceChatIds: [], syncedAt: now })
        .where(eq(perfRole.userId, row.userId));
    }
    result.cleared++;
  }

  console.log(
    `  [sync-perf-roles] mgmt=${result.mgmtCount} leader=${result.leaderCount} matched=${result.matched} ` +
      `upserted=${result.upserted} cleared=${result.cleared} not-found=${result.notFound}${dryRun ? ' [DRY-RUN]' : ''}`,
  );
  return result;
}
