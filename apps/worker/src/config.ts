import 'dotenv/config';

export const config = {
  databaseUrl: process.env.DATABASE_URL!,
  feishuAppId: process.env.FEISHU_APP_ID!,
  feishuAppSecret: process.env.FEISHU_APP_SECRET!,
  bitableAppToken: process.env.BITABLE_APP_TOKEN || 'Rv93bpZpQakM5wspg5Pc8xwcnRc',
  bitableTableId: process.env.BITABLE_TABLE_ID || 'tblXBNGXXkKMlo4C',
  appBaseUrl: process.env.APP_BASE_URL || 'http://www.harveywang.xyz',

  // 绩效群同步（sync-perf-roles）。chat id 非机密，作默认值；env 可覆盖。
  perfMgmtChatId: process.env.PERF_MGMT_CHAT_ID || 'oc_ba5a3862c93e8c932cf1e68a3a2f14f5',
  perfLeaderChatId: process.env.PERF_LEADER_CHAT_ID || 'oc_1181b79589e1dffa8b484857e8d75984',
  // 群成员接口凭证策略：默认用生产 FEISHU_APP_ID/SECRET（方案A）；
  // 若配了下面这组（文档应用凭证，方案B兜底）则群成员接口改用它，不影响其余同步。
  feishuSyncAppId: process.env.FEISHU_SYNC_APP_ID || '',
  feishuSyncAppSecret: process.env.FEISHU_SYNC_APP_SECRET || '',
};
