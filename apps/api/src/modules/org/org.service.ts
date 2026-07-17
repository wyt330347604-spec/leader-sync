import { Injectable, HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { OrgRepository } from './org.repository';
import { ErrorCode } from '@leader-sync/shared-types';

// 组织架构调整白名单（用户决策 2026-07-02：暂仅 Harvey 与 HR 杨平，不走角色；
// 后期由标签体系（BOSS/HR/PMO > CORE > Leader，最高权限生效）接管，见 spec）
const ORG_STRUCTURE_ADMINS = new Set<string>([
  'ou_1c419560953e219d5876918a2b934dfb', // Harvey/王永涛
  'ou_5a06e17c2ec88a72a2ef4ce040b3d77d', // 杨平（HR）
  // dev fixture（仅 NODE_ENV=development 的 dev-login 可签发）
  'ou_dev_harvey',
]);

export interface OrgRequester {
  userId: string;
  openId?: string | null;
}

function canEditOrg(requester: OrgRequester): boolean {
  return ORG_STRUCTURE_ADMINS.has(requester.openId ?? '') || ORG_STRUCTURE_ADMINS.has(requester.userId);
}

export interface OrgTreeNode {
  user_id: string;
  open_id: string | null;
  user_name: string | null;
  manager_user_id: string | null;
  manager_name: string | null;
  manager_source: string;
  current_grade: string | null;
  left_at: string | null;
  hidden_at: string | null;
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

  /** 组织树数据。默认只返回在册；管理员传 includeHidden 可见离职/隐藏。任意登录可读。 */
  async getTree(
    requester: OrgRequester,
    includeHidden = false,
  ): Promise<{
    users: OrgTreeNode[];
    last_feishu_sync_at: string | null;
    can_edit: boolean;
    hidden_count: number;
  }> {
    const rows = await this.orgRepository.listAll();
    const effectiveIncludeHidden = includeHidden && canEditOrg(requester);

    // 手动隐藏人数（按句柄去重，供前端「显示已隐藏 (N)」徽章；离职不计入）
    const hiddenHandles = new Set<string>();
    for (const r of rows as any[]) {
      if (r.hiddenAt) hiddenHandles.add(ouHandle(r));
    }

    let lastSync: Date | null = null;
    const visibleRows = (rows as any[]).filter((r) =>
      effectiveIncludeHidden ? true : !r.leftAt && !r.hiddenAt,
    );
    const users: OrgTreeNode[] = visibleRows.map((r: any) => {
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
        left_at: r.leftAt ? new Date(r.leftAt).toISOString() : null,
        hidden_at: r.hiddenAt ? new Date(r.hiddenAt).toISOString() : null,
      };
    });

    return {
      users,
      last_feishu_sync_at: lastSync ? (lastSync as Date).toISOString() : null,
      can_edit: canEditOrg(requester),
      hidden_count: hiddenHandles.size,
    };
  }

  /**
   * 人工调整直属上级（组织架构图拖拽）。仅白名单（Harvey/杨平）。
   * 写 manager_source='manual'：通讯录同步不再覆盖，直到「恢复飞书默认」。
   */
  async setManager(
    requester: OrgRequester,
    targetUserId: string,
    newManagerId: string | null,
  ): Promise<{ user_id: string; manager_user_id: string | null; manager_source: string }> {
    this.assertOrgAdmin(requester);

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
      managerUpdatedBy: requester.userId,
    });

    return { user_id: target.userId, manager_user_id: managerHandle, manager_source: 'manual' };
  }

  /**
   * 恢复飞书默认：翻转 manager_source='feishu'（保留现值），
   * 下一次通讯录同步（每日 07:00 或手动脚本）会用飞书真实上级刷新。
   */
  async resetManagerToFeishu(
    requester: OrgRequester,
    targetUserId: string,
  ): Promise<{ user_id: string; manager_source: string }> {
    this.assertOrgAdmin(requester);

    const rows = await this.orgRepository.listAll();
    const target = buildLookup(rows).get(targetUserId);
    if (!target) {
      throw new BusinessException(
        ErrorCode.ORG_USER_NOT_FOUND,
        `用户 ${targetUserId} 不在组织缓存中`,
        HttpStatus.NOT_FOUND,
      );
    }

    await this.orgRepository.setManagerSource(target.id, 'feishu', new Date(), requester.userId);
    return { user_id: target.userId, manager_source: 'feishu' };
  }

  /**
   * 手动隐藏/取消隐藏成员（在职但不入目录，如豁免账号/双账号）。仅白名单。
   * 按 ou_ 句柄连带同一人的所有行（Albern 式双账号）。
   */
  async setHidden(
    requester: OrgRequester,
    targetUserId: string,
    hidden: boolean,
  ): Promise<{ user_id: string; hidden: boolean }> {
    this.assertOrgAdmin(requester);

    const rows = await this.orgRepository.listAll();
    const target = buildLookup(rows).get(targetUserId);
    if (!target) {
      throw new BusinessException(
        ErrorCode.ORG_USER_NOT_FOUND,
        `用户 ${targetUserId} 不在组织缓存中`,
        HttpStatus.NOT_FOUND,
      );
    }

    const handle = ouHandle(target);
    const rowIds = rows.filter((r: any) => ouHandle(r) === handle).map((r: any) => r.id);
    const now = new Date();
    await this.orgRepository.setHidden(rowIds, {
      hiddenAt: hidden ? now : null,
      hiddenBy: hidden ? requester.userId : null,
      updatedAt: now,
    });

    return { user_id: target.userId, hidden };
  }

  private assertOrgAdmin(requester: OrgRequester): void {
    if (!canEditOrg(requester)) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '仅组织架构管理员（Harvey / 杨平）可调整汇报线',
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
