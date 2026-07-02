import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { orgCache } from '@leader-sync/db';
import { eq } from 'drizzle-orm';

export interface SetManagerValues {
  managerUserId: string | null;
  managerName: string | null;
  managerSource: 'feishu' | 'manual';
  managerUpdatedAt: Date;
  managerUpdatedBy: string;
}

@Injectable()
export class OrgRepository {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  /** 全员 org_cache（组织树 + 防环校验都在内存中做，组织规模小） */
  async listAll() {
    return this.db.select().from(orgCache);
  }

  /** 按行 id 写 manager（值由 service 仲裁好） */
  async setManager(rowId: number, values: SetManagerValues): Promise<void> {
    await this.db
      .update(orgCache)
      .set({
        managerUserId: values.managerUserId,
        managerName: values.managerName,
        managerSource: values.managerSource,
        managerUpdatedAt: values.managerUpdatedAt,
        managerUpdatedBy: values.managerUpdatedBy,
        updatedAt: values.managerUpdatedAt,
      })
      .where(eq(orgCache.id, rowId));
  }

  /** 仅翻转来源标记（「恢复飞书默认」：保留现值，等下一次通讯录同步刷新） */
  async setManagerSource(rowId: number, source: 'feishu' | 'manual', updatedAt: Date, updatedBy: string): Promise<void> {
    await this.db
      .update(orgCache)
      .set({
        managerSource: source,
        managerUpdatedAt: updatedAt,
        managerUpdatedBy: updatedBy,
        updatedAt,
      })
      .where(eq(orgCache.id, rowId));
  }
}
