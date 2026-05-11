import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { project } from '@leader-sync/db';
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
    return this.db.select().from(project).orderBy(project.createdAt);
  }

  async create(input: ProjectInput) {
    validateInput(input);
    const uid = `proj_${nanoid(12)}`;
    const [result] = await this.db.insert(project).values({
      projectUid: uid,
      name: input.name,
      category: input.category ?? null,
      ownerName: input.ownerName ?? null,
      region: input.region ?? null,
      subtitle: input.subtitle ?? null,
    }).returning();
    return result;
  }

  async update(projectUid: string, patch: ProjectPatch) {
    validateInput(patch);
    const updateSet: Record<string, unknown> = {};
    if (patch.name !== undefined) updateSet.name = patch.name;
    if (patch.category !== undefined) updateSet.category = patch.category;
    if (patch.ownerName !== undefined) updateSet.ownerName = patch.ownerName;
    if (patch.region !== undefined) updateSet.region = patch.region;
    if (patch.subtitle !== undefined) updateSet.subtitle = patch.subtitle;

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
