import { Injectable } from '@nestjs/common';
import { NotificationPreferenceRepository } from './notification-preference.repository';

export interface NotificationPreference {
  readonly dailyOverdueEnabled: boolean;
  readonly weeklySummaryEnabled: boolean;
}

const DEFAULTS: NotificationPreference = {
  dailyOverdueEnabled: false,
  weeklySummaryEnabled: true,
};

@Injectable()
export class NotificationPreferenceService {
  constructor(private readonly repo: NotificationPreferenceRepository) {}

  async getForUser(userId: string): Promise<NotificationPreference> {
    const row = await this.repo.findByUserId(userId);
    if (!row) return DEFAULTS;
    return {
      dailyOverdueEnabled: row.dailyOverdueEnabled,
      weeklySummaryEnabled: row.weeklySummaryEnabled,
    };
  }

  async updateForUser(
    userId: string,
    patch: Partial<NotificationPreference>,
  ): Promise<NotificationPreference> {
    const current = (await this.repo.findByUserId(userId)) ?? {
      userId,
      ...DEFAULTS,
    };
    const merged = {
      dailyOverdueEnabled: patch.dailyOverdueEnabled ?? current.dailyOverdueEnabled,
      weeklySummaryEnabled: patch.weeklySummaryEnabled ?? current.weeklySummaryEnabled,
    };
    const saved = await this.repo.upsert(userId, merged);
    return {
      dailyOverdueEnabled: saved.dailyOverdueEnabled,
      weeklySummaryEnabled: saved.weeklySummaryEnabled,
    };
  }
}
