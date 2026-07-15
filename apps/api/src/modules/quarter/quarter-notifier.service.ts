/**
 * QuarterNotifierService
 *
 * 季度评分的飞书下发封装（与 RequirementFeishuService / IncidentFeishuService 同模式）。
 * P4b 升级：公示出分 / 申诉提交 / 同事被指定 一律发交互卡片（sendCardToUser），
 * 卡片结构见 quarter-cards.ts。失败仅告警返回 false/条数，绝不冒泡到 API 响应。
 */
import { Injectable, Logger } from '@nestjs/common';
import { FeishuMessengerService } from '../../common/feishu/feishu-messenger.service';
import {
  buildPublishCard,
  buildAppealCard,
  buildPeerAssignedCard,
  buildPanelReminderCard,
} from './quarter-cards';

export interface PublishedNotifyInfo {
  rateeName: string | null;
  quarter: string | null;
  total: number | null;
  grade: string | null;
  deadlineText: string | null;
  resultUid: string;
}

export interface AppealNotifyInfo {
  rateeName: string | null;
  quarter: string | null;
  content: string;
}

export interface PeerAssignedNotifyInfo {
  peerName: string | null;
  rateeName: string | null;
  quarter: string | null;
  sheetUid: string;
}

export interface PanelReminderNotifyInfo {
  managerName: string | null;
  quarter: string | null;
  cycleUid: string;
  pendingCount: number;
}

@Injectable()
export class QuarterNotifierService {
  private readonly logger = new Logger(QuarterNotifierService.name);

  constructor(private readonly messenger: FeishuMessengerService) {}

  private get webBase(): string {
    return process.env.WEB_BASE_URL ?? process.env.PUBLIC_WEB_URL ?? 'https://www.harveywang.xyz';
  }

  /** 公示出分通知本人（卡片：总分/评级/申诉截止/查看详情按钮）。返回是否送达。 */
  async notifyPublished(openId: string | null, info: PublishedNotifyInfo): Promise<boolean> {
    if (!openId) return false;
    return this.messenger.sendCardToUser(openId, buildPublishCard(this.webBase, info));
  }

  /** 申诉提交通知 hr（可多人，卡片）。返回成功条数。 */
  async notifyAppeal(hrOpenIds: readonly string[], info: AppealNotifyInfo): Promise<number> {
    const ids = [...new Set(hrOpenIds.filter(Boolean))];
    if (ids.length === 0) return 0;
    const card = buildAppealCard(this.webBase, info);
    let ok = 0;
    for (const id of ids) {
      if (await this.messenger.sendCardToUser(id, card)) ok += 1;
    }
    return ok;
  }

  /** 同事被指定通知（卡片：为谁打分 + 前往打分按钮）。返回是否送达。 */
  async notifyPeerAssigned(openId: string | null, info: PeerAssignedNotifyInfo): Promise<boolean> {
    if (!openId) return false;
    return this.messenger.sendCardToUser(openId, buildPeerAssignedCard(this.webBase, info));
  }

  /** 评分会召集通知单个管理层成员（卡片：待评人数 + 进评分会看板按钮）。返回是否送达。 */
  async notifyPanelReminder(openId: string | null, info: PanelReminderNotifyInfo): Promise<boolean> {
    if (!openId) return false;
    return this.messenger.sendCardToUser(openId, buildPanelReminderCard(this.webBase, info));
  }
}
