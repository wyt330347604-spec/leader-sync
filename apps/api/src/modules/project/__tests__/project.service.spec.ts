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

describe('ProjectService — 子项目两级约束（parentProjectUid）', () => {
  // select().from().where() → 可配置数组（按调用顺序）；insert/update.returning 可配置。
  function mockDb() {
    const selectWhere = vi.fn();
    const insertReturning = vi.fn().mockResolvedValue([{ projectUid: 'new', name: 'X' }]);
    const updateReturning = vi.fn().mockResolvedValue([{ projectUid: 'p1', name: 'X' }]);
    const db: any = {
      select: () => ({ from: () => ({ where: selectWhere, orderBy: () => Promise.resolve([]) }) }),
      insert: () => ({ values: vi.fn(() => ({ returning: insertReturning })) }),
      update: () => ({ set: vi.fn(() => ({ where: () => ({ returning: updateReturning }) })) }),
    };
    // 暴露 values 以便断言
    const valuesSpy = vi.fn(() => ({ returning: insertReturning }));
    db.insert = () => ({ values: valuesSpy });
    return { db, selectWhere, valuesSpy, insertReturning, updateReturning };
  }

  it('create 子项目：父为顶级项目 → 成功，写入 parentProjectUid', async () => {
    const { db, selectWhere, valuesSpy } = mockDb();
    selectWhere.mockResolvedValueOnce([{ projectUid: 'top', parentProjectUid: null }]); // 父查找
    const service = new ProjectService(db as any);
    await service.create({ name: '子', parentProjectUid: 'top' });
    expect(valuesSpy).toHaveBeenCalledWith(expect.objectContaining({ parentProjectUid: 'top' }));
  });

  it('create 子项目：父不存在 → 1003', async () => {
    const { db, selectWhere } = mockDb();
    selectWhere.mockResolvedValueOnce([]); // 父不存在
    const service = new ProjectService(db as any);
    await expect(service.create({ name: '子', parentProjectUid: 'ghost' }))
      .rejects.toMatchObject({ businessCode: 1003 });
  });

  it('create 子项目：父本身是子项目 → 拒绝三级（1004）', async () => {
    const { db, selectWhere } = mockDb();
    selectWhere.mockResolvedValueOnce([{ projectUid: 'mid', parentProjectUid: 'top' }]); // 父已是子项目
    const service = new ProjectService(db as any);
    await expect(service.create({ name: '孙', parentProjectUid: 'mid' }))
      .rejects.toMatchObject({ businessCode: 1004 });
  });

  it('update：自己已有子项目时不能降级为子项目（1004）', async () => {
    const { db, selectWhere } = mockDb();
    selectWhere
      .mockResolvedValueOnce([{ projectUid: 'top', parentProjectUid: null }]) // 父合法
      .mockResolvedValueOnce([{ projectUid: 'child' }]);                       // 自己有子项目
    const service = new ProjectService(db as any);
    await expect(service.update('self', { parentProjectUid: 'top' }))
      .rejects.toMatchObject({ businessCode: 1004 });
  });

  it('update：parent = 自己 → 1004', async () => {
    const { db } = mockDb();
    const service = new ProjectService(db as any);
    await expect(service.update('p1', { parentProjectUid: 'p1' }))
      .rejects.toMatchObject({ businessCode: 1004 });
  });

  it('update：parentProjectUid=null 升级回顶级项目 → 允许', async () => {
    const { db } = mockDb();
    const service = new ProjectService(db as any);
    await expect(service.update('p1', { parentProjectUid: null })).resolves.toBeDefined();
  });

  it('create：picUserId 透传写入', async () => {
    const { db, valuesSpy } = mockDb();
    const service = new ProjectService(db as any);
    await service.create({ name: '项目X', picUserId: 'ou_pic' });
    expect(valuesSpy).toHaveBeenCalledWith(expect.objectContaining({ picUserId: 'ou_pic' }));
  });
});
