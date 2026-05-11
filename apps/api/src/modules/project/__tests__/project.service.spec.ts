import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectService } from '../project.service';
import { BusinessException } from '../../../common/exceptions/business.exception';

function createMockDb() {
  const chain: any = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    from: vi.fn(() => chain),
    values: vi.fn(() => chain),
    set: vi.fn(() => chain),
    where: vi.fn(() => chain),
    returning: vi.fn(),
    orderBy: vi.fn(() => chain),
  };
  return chain;
}

describe('ProjectService.create — new fields', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: ProjectService;

  beforeEach(() => {
    db = createMockDb();
    service = new ProjectService(db as any);
  });

  it('persists category / ownerName / region / subtitle', async () => {
    db.returning.mockResolvedValue([{ id: 1, name: 'X', category: 'zy', ownerName: 'Mia', region: '印度', subtitle: null }]);
    const result = await service.create({
      name: 'XT 印度',
      category: 'zy',
      ownerName: 'Mia',
      region: '印度',
    });
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({
      name: 'XT 印度', category: 'zy', ownerName: 'Mia', region: '印度', subtitle: null,
    }));
    expect(result.category).toBe('zy');
  });

  it('rejects category not in enum', async () => {
    await expect(service.create({ name: 'X', category: 'bad' as any }))
      .rejects.toBeInstanceOf(BusinessException);
  });

  it('rejects region not in enum', async () => {
    await expect(service.create({ name: 'X', region: '火星' as any }))
      .rejects.toBeInstanceOf(BusinessException);
  });

  it('accepts only required name (other fields optional)', async () => {
    db.returning.mockResolvedValue([{ id: 2, name: '内部', category: null }]);
    await service.create({ name: '内部' });
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({
      name: '内部', category: null, ownerName: null, region: null, subtitle: null,
    }));
  });
});

describe('ProjectService.update — partial updates', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: ProjectService;

  beforeEach(() => {
    db = createMockDb();
    service = new ProjectService(db as any);
  });

  it('updates only provided fields', async () => {
    db.returning.mockResolvedValue([{ projectUid: 'p1', name: 'old', category: 'zy' }]);
    await service.update('p1', { category: 'zy' });
    expect(db.set).toHaveBeenCalledWith({ category: 'zy' });
  });

  it('rejects category not in enum on update', async () => {
    await expect(service.update('p1', { category: 'bad' as any }))
      .rejects.toBeInstanceOf(BusinessException);
  });
});
