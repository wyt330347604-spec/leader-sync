import { describe, it, expect } from 'vitest';
import { UserController } from './user.controller';

function makeController(rows: any[]) {
  const db = { select: () => ({ from: async () => rows }) } as any;
  return new UserController(db);
}

describe('UserController.search 过滤离职/隐藏', () => {
  const rows = [
    { userId: 'ou_a', openId: 'ou_a', userName: '张三', deptName: 'X', leftAt: null, hiddenAt: null },
    { userId: 'ou_left', openId: 'ou_left', userName: '张离职', deptName: 'X', leftAt: new Date(), hiddenAt: null },
    { userId: 'ou_hid', openId: 'ou_hid', userName: '张隐藏', deptName: 'X', leftAt: null, hiddenAt: new Date() },
  ];

  it('离职/隐藏成员不出现在搜索结果', async () => {
    const ctrl = makeController(rows);
    const res = await ctrl.search('张');
    expect(res.map((u) => u.userId)).toEqual(['ou_a']);
  });
});
