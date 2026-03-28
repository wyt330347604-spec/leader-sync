import 'dotenv/config';

export const config = {
  databaseUrl: process.env.DATABASE_URL!,
  feishuAppId: process.env.FEISHU_APP_ID!,
  feishuAppSecret: process.env.FEISHU_APP_SECRET!,
  bitableAppToken: process.env.BITABLE_APP_TOKEN || 'Rv93bpZpQakM5wspg5Pc8xwcnRc',
  bitableTableId: process.env.BITABLE_TABLE_ID || 'tblXBNGXXkKMlo4C',
  appBaseUrl: process.env.APP_BASE_URL || 'http://www.harveywang.xyz',
};
