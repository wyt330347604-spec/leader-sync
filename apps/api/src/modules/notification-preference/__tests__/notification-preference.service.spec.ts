import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationPreferenceService } from '../notification-preference.service';
import { NotificationPreferenceRepository } from '../notification-preference.repository';

function createMockRepo(): Record<keyof NotificationPreferenceRepository, ReturnType<typeof vi.fn>> {
  return {
    findByUserId: vi.fn(),
    upsert: vi.fn(),
  };
}

describe('NotificationPreferenceService', () => {
  let service: NotificationPreferenceService;
  let repo: ReturnType<typeof createMockRepo>;

  beforeEach(() => {
    repo = createMockRepo();
    service = new NotificationPreferenceService(
      repo as unknown as NotificationPreferenceRepository,
    );
  });

  describe('getForUser', () => {
    it('returns defaults (both true) when no record exists', async () => {
      repo.findByUserId.mockResolvedValue(null);

      const result = await service.getForUser('user_1');

      expect(result).toEqual({
        dailyOverdueEnabled: false,
        weeklySummaryEnabled: true,
      });
      expect(repo.findByUserId).toHaveBeenCalledWith('user_1');
    });

    it('returns saved values when a record exists', async () => {
      repo.findByUserId.mockResolvedValue({
        userId: 'user_1',
        dailyOverdueEnabled: false,
        weeklySummaryEnabled: true,
      });

      const result = await service.getForUser('user_1');

      expect(result).toEqual({
        dailyOverdueEnabled: false,
        weeklySummaryEnabled: true,
      });
    });
  });

  describe('updateForUser', () => {
    it('upserts only the fields passed (preserving existing values via current row)', async () => {
      repo.findByUserId.mockResolvedValue({
        userId: 'user_1',
        dailyOverdueEnabled: true,
        weeklySummaryEnabled: true,
      });
      repo.upsert.mockResolvedValue({
        userId: 'user_1',
        dailyOverdueEnabled: false,
        weeklySummaryEnabled: true,
      });

      const result = await service.updateForUser('user_1', { dailyOverdueEnabled: false });

      expect(result.dailyOverdueEnabled).toBe(false);
      expect(result.weeklySummaryEnabled).toBe(true);
      expect(repo.upsert).toHaveBeenCalledWith('user_1', {
        dailyOverdueEnabled: false,
        weeklySummaryEnabled: true,
      });
    });

    it('falls back to defaults when current row missing and only one field given', async () => {
      repo.findByUserId.mockResolvedValue(null);
      repo.upsert.mockResolvedValue({
        userId: 'user_1',
        dailyOverdueEnabled: false,
        weeklySummaryEnabled: false,
      });

      await service.updateForUser('user_1', { weeklySummaryEnabled: false });

      // dailyOverdueEnabled falls back to DEFAULT (false), weeklySummaryEnabled is the patched value
      expect(repo.upsert).toHaveBeenCalledWith('user_1', {
        dailyOverdueEnabled: false,
        weeklySummaryEnabled: false,
      });
    });

    it('is idempotent: calling twice with same payload yields same result', async () => {
      repo.findByUserId.mockResolvedValue(null);
      repo.upsert.mockResolvedValue({
        userId: 'user_1',
        dailyOverdueEnabled: false,
        weeklySummaryEnabled: false,
      });

      const r1 = await service.updateForUser('user_1', {
        dailyOverdueEnabled: false,
        weeklySummaryEnabled: false,
      });
      const r2 = await service.updateForUser('user_1', {
        dailyOverdueEnabled: false,
        weeklySummaryEnabled: false,
      });

      expect(r1).toEqual(r2);
    });
  });
});
