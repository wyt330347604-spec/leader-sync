import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { project, orgCache } from '@leader-sync/db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { BusinessException } from '../../common/exceptions/business.exception';
import {
  ProjectCategory,
  ProjectRegion,
  ProjectCategoryOrder,
  ProjectRegionList,
} from '@leader-sync/shared-types';

const CATEGORY_VALUES = new Set<string>(ProjectCategoryOrder);
const REGION_VALUES = new Set<string>(ProjectRegionList);

export interface ProjectInput {
  name: string;
  category?: ProjectCategory | null;
  ownerName?: string | null;
  region?: ProjectRegion | null;
  subtitle?: string | null;
  /** 父项目 uid：null/缺省=顶级项目，非空=子项目。限两级。 */
  parentProjectUid?: string | null;
  /** PIC 负责人用户 id（真实用户，可过滤/追责）。 */
  picUserId?: string | null;
}
export type ProjectPatch = Partial<ProjectInput>;

function validateInput(p: ProjectPatch) {
  if (p.category != null && !CATEGORY_VALUES.has(p.category)) {
    throw new BusinessException(1004, `Invalid category: ${p.category}`);
  }
  if (p.region != null && !REGION_VALUES.has(p.region)) {
    throw new BusinessException(1004, `Invalid region: ${p.region}`);
  }
}

@Injectable()
export class ProjectService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async list() {
    return this.db
      .select({
        id: project.id,
        projectUid: project.projectUid,
        name: project.name,
        isDefault: project.isDefault,
        createdAt: project.createdAt,
        category: project.category,
        ownerName: project.ownerName,
        region: project.region,
        subtitle: project.subtitle,
        parentProjectUid: project.parentProjectUid,
        picUserId: project.picUserId,
        picName: orgCache.userName,
      })
      .from(project)
      .leftJoin(orgCache, eq(project.picUserId, orgCache.userId))
      .orderBy(project.createdAt);
  }

  /**
   * 校验父项目合法性（强制两级：项目→子项目）：
   * - 不能以自己为父；
   * - 父项目必须存在且本身是顶级项目（其 parent 为空）；
   * - 自己若已有子项目，则不能再降级为子项目（否则出现三级）。
   */
  private async assertValidParent(parentUid: string, selfUid?: string) {
    if (selfUid && parentUid === selfUid) {
      throw new BusinessException(1004, '项目不能以自己为父项目');
    }
    const [parent] = await this.db.select().from(project).where(eq(project.projectUid, parentUid));
    if (!parent) throw new BusinessException(1003, '父项目不存在');
    if (parent.parentProjectUid) {
      throw new BusinessException(1004, '父项目必须是顶级项目（最多两级：项目→子项目）');
    }
    if (selfUid) {
      const children = await this.db.select().from(project).where(eq(project.parentProjectUid, selfUid));
      if (children.length > 0) {
        throw new BusinessException(1004, '该项目下已有子项目，不能再设为子项目');
      }
    }
  }

  async create(input: ProjectInput) {
    validateInput(input);
    if (input.parentProjectUid) await this.assertValidParent(input.parentProjectUid);
    const uid = `proj_${nanoid(12)}`;
    const [result] = await this.db.insert(project).values({
      projectUid: uid,
      name: input.name,
      category: input.category ?? null,
      ownerName: input.ownerName ?? null,
      region: input.region ?? null,
      subtitle: input.subtitle ?? null,
      parentProjectUid: input.parentProjectUid ?? null,
      picUserId: input.picUserId ?? null,
    }).returning();
    return result;
  }

  async update(projectUid: string, patch: ProjectPatch) {
    validateInput(patch);
    if (patch.parentProjectUid != null) await this.assertValidParent(patch.parentProjectUid, projectUid);
    const updateSet: Record<string, unknown> = {};
    if (patch.name !== undefined) updateSet.name = patch.name;
    if (patch.category !== undefined) updateSet.category = patch.category;
    if (patch.ownerName !== undefined) updateSet.ownerName = patch.ownerName;
    if (patch.region !== undefined) updateSet.region = patch.region;
    if (patch.subtitle !== undefined) updateSet.subtitle = patch.subtitle;
    // parentProjectUid：传 null 可"升级"回顶级项目；传非空走上面的校验。
    if (patch.parentProjectUid !== undefined) updateSet.parentProjectUid = patch.parentProjectUid;
    if (patch.picUserId !== undefined) updateSet.picUserId = patch.picUserId;

    const [result] = await this.db.update(project)
      .set(updateSet)
      .where(eq(project.projectUid, projectUid))
      .returning();
    if (!result) throw new BusinessException(1003, 'Project not found');
    return result;
  }

  async remove(projectUid: string) {
    const [proj] = await this.db.select().from(project).where(eq(project.projectUid, projectUid));
    if (!proj) throw new BusinessException(1003, 'Project not found');
    if (proj.isDefault) throw new BusinessException(1001, 'Cannot delete default project');
    await this.db.delete(project).where(eq(project.projectUid, projectUid));
    return { deleted: true };
  }

  async setDefault(projectUid: string) {
    await this.db.update(project).set({ isDefault: false }).where(eq(project.isDefault, true));
    const [result] = await this.db
      .update(project)
      .set({ isDefault: true })
      .where(eq(project.projectUid, projectUid))
      .returning();
    if (!result) throw new BusinessException(1003, 'Project not found');
    return result;
  }

  async getDefault() {
    const [def] = await this.db.select().from(project).where(eq(project.isDefault, true));
    return def ?? null;
  }
}
