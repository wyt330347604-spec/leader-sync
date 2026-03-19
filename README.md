# Leader Sync Docs

本目录是"飞书领导月度督办系统"的初始文档包，面向以下目标：

- 在飞书内完成领导月度事项督办
- 以多维表格作为业务操作台
- 以自建应用 + 服务端作为同步中枢
- 支持多维表格、飞书任务、飞书日历的双向同步
- 支持周提醒、月结、继承任务、老板驾驶舱
- 适合用 Claude Code 持续维护

## 建议使用方式

1. 先通读 `docs/00-charter/project-charter.md`
2. 再确认 `docs/01-product/prd.md`
3. 字段和状态以 `docs/02-data/field-dictionary.md`、`docs/04-process/state-machine.md` 为准
4. 同步逻辑以 `docs/03-sync/*` 为准
5. 飞书权限与订阅以 `docs/06-feishu/*` 为准
6. 部署与域名以 `docs/08-ops/*` 为准

## 文档约束

- 修改字段前，先更新 `field-dictionary.md`
- 修改状态机前，先更新 `state-machine.md`
- 修改角色权限前，先更新 `permission-matrix.md`
- 修改同步逻辑前，先更新 `sync-field-authority.md` 与 `sync-conflict-policy.md`
- 修改飞书能力或权限前，先更新 `api-permissions.md` 与 `event-subscriptions.md`

## 当前目录

```text
docs/
  00-charter/
  01-product/
  02-data/
  03-sync/
  04-process/
  05-permissions/
  06-feishu/
  07-architecture/
  08-ops/
  09-roadmap/
```

## 主权文档说明

| 主权 | 文档 |
|---|---|
| 业务语义 | `field-dictionary.md` + `enum-dictionary.md` |
| 物理落库 | `db-schema.md` |
| 外部接口 | `api-contracts.md` |
| 里程碑 | `milestone-plan.md` |

其他文档只引用，不重复定义。

## 后续还可以继续补代码骨架

- `db/schema/`
- `apps/api/`
- `apps/web/`
- `apps/worker/`
