/**
 * One-time migration: 把生产环境 project 表迁移到「项目架构总览」字段结构。
 *
 * 步骤：
 *   1. UPDATE 公司建设  SET category='jt'
 *   2. UPDATE 印度金融 → name='XT 印度', category='zy', region='印度', owner_name='Mia'
 *   3. UPDATE 印尼电商 → name='XL 电商', category='zy', region='印尼', owner_name='Shawn'
 *   4. INSERT 18 条新项目
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx db/scripts/migrate-projects-prod-2026-05.ts           # dry-run
 *   DATABASE_URL=... pnpm tsx db/scripts/migrate-projects-prod-2026-05.ts --apply   # 真正执行
 */
import 'dotenv/config';
import { createDb } from '../src/connection';
import { project } from '../src/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

interface UpdateRow { match: string; set: Record<string, unknown>; }
const UPDATES: UpdateRow[] = [
  { match: '公司建设', set: { category: 'jt' } },
  { match: '印度金融', set: { name: 'XT 印度', category: 'zy', region: '印度', ownerName: 'Mia' } },
  { match: '印尼电商', set: { name: 'XL 电商', category: 'zy', region: '印尼', ownerName: 'Shawn' } },
];

interface InsertRow {
  name: string;
  category: string;
  ownerName: string | null;
  region: string | null;
  subtitle: string | null;
}
const INSERTS: InsertRow[] = [
  { name: 'DFW 印度',     category: 'zy', ownerName: 'Qi',          region: '印度',      subtitle: null },
  { name: 'XL 内容',      category: 'zy', ownerName: 'Shawn',       region: '印尼',      subtitle: null },
  { name: 'XL 供应链',    category: 'zy', ownerName: 'George',      region: '印尼',      subtitle: null },
  { name: 'XT 巴基斯坦',  category: 'zy', ownerName: null,          region: '巴基斯坦',  subtitle: null },
  { name: 'DFW 巴基斯坦', category: 'zy', ownerName: 'Qi',          region: '巴基斯坦',  subtitle: null },
  { name: 'XT 孟加拉',    category: 'zy', ownerName: '建豪',        region: '孟加拉',    subtitle: null },
  { name: 'XW 印度',      category: 'fw', ownerName: 'Mia',         region: '印度',      subtitle: null },
  { name: 'AS 印度',      category: 'fw', ownerName: 'Mia',         region: '印度',      subtitle: null },
  { name: 'CQ 风控',      category: 'fw', ownerName: 'Yang',        region: '印度',      subtitle: null },
  { name: 'KD',           category: 'tz', ownerName: '建豪',        region: '巴基斯坦',  subtitle: null },
  { name: 'LWT',          category: 'tz', ownerName: '建豪',        region: '巴基斯坦',  subtitle: null },
  { name: 'SkyD',         category: 'tz', ownerName: '建豪',        region: '巴基斯坦',  subtitle: null },
  { name: 'Zeropay',      category: 'tz', ownerName: 'Yang',        region: '印度',      subtitle: null },
  { name: 'allenpay',     category: 'tz', ownerName: 'Yang',        region: '印度',      subtitle: null },
  { name: 'DFW',          category: 'tz', ownerName: 'Tobi + Yang', region: '印度',      subtitle: '联合负责' },
  { name: 'VN 深圳',      category: 'tz', ownerName: 'Harvey',      region: '深圳',      subtitle: null },
  { name: 'cash 印度',    category: 'hz', ownerName: 'Harvey',      region: '印度',      subtitle: 'NBFC × 2' },
  { name: 'CQ 孟加拉',    category: 'hz', ownerName: 'Harvey',      region: '孟加拉',    subtitle: null },
];

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL missing');
    process.exit(1);
  }
  const db = createDb(process.env.DATABASE_URL);

  const before = await db.select().from(project);
  console.log(`Before: ${before.length} projects`);

  for (const u of UPDATES) {
    const hit = before.find((p) => p.name === u.match);
    if (!hit) {
      console.warn(`! UPDATE skip: name "${u.match}" not found`);
      continue;
    }
    console.log(`[update] ${u.match} → ${JSON.stringify(u.set)}`);
    if (apply) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.update(project).set(u.set as any).where(eq(project.id, hit.id));
    }
  }

  const existingNames = new Set(
    before.map((p) => p.name).concat(
      UPDATES.map((u) => u.set.name as string).filter(Boolean) as string[],
    ),
  );
  for (const row of INSERTS) {
    if (existingNames.has(row.name)) {
      console.log(`[insert skip] ${row.name} already exists`);
      continue;
    }
    console.log(`[insert] ${row.name}`);
    if (apply) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.insert(project).values({
        projectUid: `proj_${nanoid(12)}`,
        ...row,
      } as any);
    }
  }

  const after = await db.select().from(project);
  console.log(`After: ${after.length} projects (apply=${apply})`);
  if (!apply) {
    console.log('\n>> dry-run only. Add --apply to actually execute.');
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
