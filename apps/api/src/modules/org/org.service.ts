import { Injectable, HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { OrgRepository } from './org.repository';
import { ErrorCode, UserRole } from '@leader-sync/shared-types';

// 可调整组织架构的角色（与 grade 写权限口径一致）
const WRITE_ALLOWED_ROLES = new Set<string>([UserRole.BOSS, UserRole.PMO, UserRole.ADMIN]);

export interface OrgTreeNode {
  user_id: string;
  open_id: string | null;
  user_name: string | null;
  manager_user_id: string | null;
  manager_name: string | null;
  manager_source: string;
  current_grade: string | null;
}

/** 行的 ou_ 句柄：manager_user_id 统一存 ou_ open_id（与任务/打分命名空间一致） */
function ouHandle(row: any): string {
  if (row.openId?.startsWith('ou_')) return row.openId;
  return row.userId;
}

/** user_id + open_id 双 key 查找表（两套 ID 命名空间任一命中） */
function buildLookup(rows: any[]): Map<string, any> {
  const map = new Map<string, any>();
  for (const r of rows) {
    if (r.userId) map.set(r.userId, r);
    if (r.openId && !map.has(r.openId)) map.set(r.openId, r);
  }
  return map;
}

@Injectable()
export class OrgService {
  constructor(private readonly orgRepository: OrgRepository) {}

  /** 组织树数据（全员平铺，前端按 manager 关系组树）。任意登录用户可读。 */
  async getTree(): Promise<{ users: OrgTreeNode[]; last_feishu_sync_at: string | null }> {
    const rows = await this.orgRepository.listAll();

    let lastSync: Date | null = null;
    const users: OrgTreeNode[] = rows.map((r: any) => {
      if (r.managerSource === 'feishu' && r.managerUpdatedAt) {
        if (!lastSync || r.managerUpdatedAt > lastSync) lastSync = r.managerUpdatedAt;
      }
      return {
        user_id: r.userId,
        open_id: r.openId ?? null,
        user_name: r.userName ?? null,
        manager_user_id: r.managerUserId ?? null,
        manager_name: r.managerName ?? null,
        manager_source: r.managerSource ?? 'feishu',
        current_grade: r.currentGrade ?? null,
      };
    });

    return { users, last_feishu_sync_at: lastSync ? (lastSync as Date).toISOString() : null };
  }

  /**
   * 人工调整直属上级（组织架构图拖拽）。boss/pmo/admin。
   * 写 manager_source='manual'：通讯录同步不再覆盖，直到「恢复飞书默认」。
   */
  async setManager(
    requesterUserId: string,
    requesterRole: string,
    targetUserId: string,
    newManagerId: string | null,
  ): Promise<{ user_id: string; manager_user_id: string | null; manager_source: string }> {
    this.assertWriteRole(requesterRole);

    const rows = await this.orgRepository.listAll();
    const lookup = buildLookup(rows);

    const target = lookup.get(targetUserId);
    if (!target) {
      throw new BusinessException(
        ErrorCode.ORG_USER_NOT_FOUND,
        `用户 ${targetUserId} 不在组织缓存中`,
        HttpStatus.NOT_FOUND,
      );
    }

    let managerRow: any = null;
    let managerHandle: string | null = null;
    if (newManagerId) {
      managerRow = lookup.get(newManagerId);
      if (!managerRow) {
        throw new BusinessException(
          ErrorCode.ORG_INVALID_MANAGER,
          `上级 ${newManagerId} 不在组织缓存中，无法指定`,
          HttpStatus.BAD_REQUEST,
        );
      }
      if (managerRow.id === target.id) {
        throw new BusinessException(
          ErrorCode.ORG_INVALID_MANAGER,
          '不能把自己设为自己的上级',
          HttpStatus.BAD_REQUEST,
        );
      }
      this.assertNoCycle(target, managerRow, lookup);
      managerHandle = ouHandle(managerRow);
    }

    const now = new Date();
    await this.orgRepository.setManager(target.id, {
      managerUserId: managerHandle,
      managerName: managerRow?.userName ?? null,
      managerSource: 'manual',
      managerUpdatedAt: now,
      managerUpdatedBy: requesterUserId,
    });

    return { user_id: target.userId, manager_user_id: managerHandle, manager_source: 'manual' };
  }

  /**
   * 恢复飞书默认：翻转 manager_source='feishu'（保留现值），
   * 下一次通讯录同步（每日 07:00 或手动脚本）会用飞书真实上级刷新。
   */
  async resetManagerToFeishu(
    requesterUserId: string,
    requesterRole: string,
    targetUserId: string,
  ): Promise<{ user_id: string; manager_source: string }> {
    this.assertWriteRole(requesterRole);

    const rows = await this.orgRepository.listAll();
    const target = buildLookup(rows).get(targetUserId);
    if (!target) {
      throw new BusinessException(
        ErrorCode.ORG_USER_NOT_FOUND,
        `用户 ${targetUserId} 不在组织缓存中`,
        HttpStatus.NOT_FOUND,
      );
    }

    await this.orgRepository.setManagerSource(target.id, 'feishu', new Date(), requesterUserId);
    return { user_id: target.userId, manager_source: 'feishu' };
  }

  private assertWriteRole(role: string): void {
    if (!WRITE_ALLOWED_ROLES.has(role)) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '仅 Boss/PMO/Admin 可调整组织架构',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /** 防环：沿新上级的 manager 链向上走，不得回到 target 本人。 */
  private assertNoCycle(target: any, newManager: any, lookup: Map<string, any>): void {
    const visited = new Set<number>([target.id]);
    let cursor: any = newManager;
    while (cursor) {
      if (visited.has(cursor.id)) {
        throw new BusinessException(
          ErrorCode.ORG_INVALID_MANAGER,
          `不能指定 ${newManager.userName ?? newManager.userId} 为上级：会形成汇报环`,
          HttpStatus.BAD_REQUEST,
        );
      }
      visited.add(cursor.id);
      cursor = cursor.managerUserId ? lookup.get(cursor.managerUserId) : null;
    }
  }
}
