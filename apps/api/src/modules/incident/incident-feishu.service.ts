/**
 * IncidentFeishuService
 *
 * Thin Feishu notification wrapper for the incident module.
 * Delegates token + send to the shared FeishuMessengerService; keeps only the
 * incident-specific message composition. Failures never surface to the API response.
 */
import { Injectable } from '@nestjs/common';
import { FeishuMessengerService } from '../../common/feishu/feishu-messenger.service';

@Injectable()
export class IncidentFeishuService {
  constructor(private readonly messenger: FeishuMessengerService) {}

  async sendTextToUser(openId: string, text: string): Promise<void> {
    await this.messenger.sendTextToUser(openId, text);
  }

  /**
   * Notify all PMO users that a P0/P1 incident is pending confirmation.
   */
  async notifyPmoOfPendingIncident(
    pmoOpenIds: string[],
    incidentUid: string,
    title: string,
    reporterName: string,
    severity: string,
  ): Promise<void> {
    const msg = `[事故待确认] ${severity} - ${title}\n记录人: ${reporterName}\n事故ID: ${incidentUid}\n请前往系统确认或驳回。`;
    await Promise.allSettled(pmoOpenIds.map((id) => this.sendTextToUser(id, msg)));
  }

  /**
   * Notify all involved employees that a P0/P1 incident has been confirmed.
   */
  async notifyUsersIncidentConfirmed(
    involvedOpenIds: string[],
    incidentUid: string,
    title: string,
    severity: string,
  ): Promise<void> {
    const msg = `[事故记录已确认] ${severity} - ${title}\n事故ID: ${incidentUid}\n此事故记录已由 PMO/Boss 确认生效，请知悉。`;
    await Promise.allSettled(involvedOpenIds.map((id) => this.sendTextToUser(id, msg)));
  }
}
