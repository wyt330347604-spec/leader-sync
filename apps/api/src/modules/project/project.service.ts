import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { project } from '@leader-sync/db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { BusinessException } from '../../common/exceptions/business.exception';

@Injectable()
export class ProjectService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async list() {
    return this.db.select().from(project).orderBy(project.name);
  }

  async create(name: string) {
    const uid = `proj_${nanoid(12)}`;
    const [result] = await this.db.insert(project).values({
      projectUid: uid,
      name,
    }).returning();
    return result;
  }

  async update(projectUid: string, name: string) {
    const [result] = await this.db.update(project)
      .set({ name })
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

  async getDefault() {
    const [def] = await this.db.select().from(project).where(eq(project.isDefault, true));
    return def ?? null;
  }
}
