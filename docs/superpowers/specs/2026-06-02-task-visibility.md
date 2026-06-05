# 任务可见性：个人私有 vs 公开

## 决策（已确认 2026-06-02）
- 仅创建者可见；纯个人（私有任务 assignee 固定=创建者，不可指派他人）；可转公开。
- 私有任务**不计入任何完成统计**、**不同步多维表格**。

## 新增决策（本 spec 拍板，待用户可否决）
- **私有任务不参与月结**：monthly-close 的 Step1 查询排除 private → 不计数、不快照、不自动继承。私有是个人 to-do，由创建者自行管理（用「全部月份」筛选查看跨月私有）。日后可加专门的个人待办视图/私有自动继承（follow-up）。

## 数据模型
- `task.visibility` varchar(16) NOT NULL DEFAULT 'public'，取值 `public`|`private`。migration `0009_task_visibility.sql`：加列 + 存量回填 public。
- shared-types 加 `TaskVisibility = { PUBLIC:'public', PRIVATE:'private' }`。

## 后端改动点
1. **创建**（task.service.createTask）：dto 加 `visibility`（默认 public）。private 时强制 `assigneeUserId = 创建者`、忽略 collaborators、不发 leader 通知。
2. **列表**（buildListConditions）：加 `(visibility != 'private' OR created_by ∈ viewerIds)` → 私有仅创建者可见。
3. **详情**（getTask）：private 且非创建者 → TASK_NOT_FOUND（不泄漏存在性）。
4. **搜索**：若任务搜索涉及，排除他人 private（本期任务列表 + 详情为主）。
5. **驾驶舱口径排除**：`belongsToMonths` 内追加 `visibility != 'private'` → 所有 dashboard 查询（boss/gantt/leader/my/member）自动排除私有，统计不含私有。
6. **月结排除**：monthly-close Step1 查询加 `visibility != 'private'`。
7. **同步排除**：sync-outbound 推 Bitable 时排除 private（私有不进公司共享多维表格）。
8. **转公开端点**：`POST /tasks/:uid/publish` → visibility='public'；仅创建者（复用 canMutateTask + 额外 created_by 校验）。

## 前端改动点
- quick-add + 创建：「仅自己可见 / 公开」切换（默认公开）。private 时隐藏负责人/协作人（固定自己）。
- 列表：private 任务加 🔒 私有 徽章。
- 详情：私有标识 + 「转为公开」按钮。

## 测试
- service：createTask private 强制 assignee=self；buildListConditions 私有可见性 SQL；getTask 私有越权 404；publish 端点。
- dashboard：belongsToMonths 含 visibility 排除（SQL 断言）。
- monthly-close：Step1 排除 private（私有不计数/不继承）。

## 部署
- migration 先在生产 DB 执行（加列默认 public，存量安全）；再 shared-types/db dist → api dist → worker 源码 → web。
