# M1 基础底座设计文档

> 状态：已确认
> 日期：2026-03-19

## 1. 目标

搭建中心主档、飞书登录、任务 CRUD，验证全链路闭环。

## 2. 技术选型

| 项 | 选择 |
|---|---|
| 后端 | NestJS |
| 前端 | Next.js (App Router) |
| Monorepo | pnpm workspaces + Turborepo |
| ORM | Drizzle |
| Node | 22 |
| UI | shadcn/ui + Tailwind |
| 请求 | fetch + SWR |
| 认证 | 飞书 JS-SDK 免登（优先）+ OAuth（兼容），JWT |
| 本地开发 | Docker Compose (PostgreSQL 15 + Redis 7) |

## 3. Monorepo 结构

```
leader-sync/
├── apps/
│   ├── api/                    ← NestJS 后端
│   │   └── src/
│   │       ├── modules/
│   │       │   ├── auth/       ← 飞书登录
│   │       │   ├── task/       ← 任务 CRUD
│   │       │   └── health/     ← 健康检查
│   │       └── common/
│   │           ├── guards/
│   │           ├── interceptors/
│   │           └── filters/
│   └── web/                    ← Next.js 前端
│       └── src/
│           ├── app/
│           │   ├── (auth)/
│           │   └── tasks/
│           ├── lib/
│           └── components/
├── packages/
│   ├── shared-types/           ← 枚举、DTO、常量
│   └── domain-core/            ← 状态机、业务规则
├── db/
│   ├── schema/                 ← Drizzle schema（9 张表）
│   ├── migrations/
│   ├── seed/
│   └── drizzle.config.ts
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── .env.example
└── docker-compose.yml
```

### M1 不创建的模块
- `packages/sync-engine` → M2
- `packages/feishu-sdk-wrapper` → M2
- `apps/worker` → M3

## 4. 数据库

- 严格对齐 `db-schema.md`，9 张表完整建出
- Drizzle schema 集中在 `db/schema/`，API 和 Worker 共用
- `drizzle-kit` 生成 migration SQL
- seed 脚本插入测试用户和角色

### 9 张表
1. task
2. task_progress_log
3. external_mapping
4. inbound_event
5. sync_log
6. sync_conflict
7. monthly_snapshot
8. user_role_binding
9. org_cache

## 5. API 接口

### 认证
| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/v1/auth/feishu/callback` | GET | 飞书 OAuth 回调 |
| `/api/v1/auth/feishu/jsapi-auth` | POST | JS-SDK 免登 |
| `/api/v1/auth/me` | GET | 当前用户信息 |

### 任务 CRUD
| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/v1/tasks` | POST | 创建任务 |
| `/api/v1/tasks/:task_uid` | GET | 任务详情 |
| `/api/v1/tasks/:task_uid` | PATCH | 更新任务（强制 version） |
| `/api/v1/tasks/:task_uid/assign` | POST | 指派 |
| `/api/v1/tasks/:task_uid/complete` | POST | 提交完成 |
| `/api/v1/tasks/:task_uid/delay` | POST | 延期 |
| `/api/v1/me/tasks` | GET | 我的任务列表 |

### 健康检查
| 接口 | 方法 | 说明 |
|---|---|---|
| `/healthz` | GET | 存活 |
| `/readyz` | GET | 就绪（DB + Redis） |

### 通用中间件
- TraceIdInterceptor：生成 trace_id
- ResponseInterceptor：统一 `{ code, message, trace_id, data }`
- HttpExceptionFilter：全局异常，错误码 1001-1009
- AuthGuard：JWT 校验
- VersionGuard：PATCH 乐观锁 409

### 响应格式
```json
{
  "code": 0,
  "message": "ok",
  "trace_id": "tr_xxx",
  "data": {}
}
```

## 6. 认证流程

### 飞书工作台 H5（优先）
```
前端 JS-SDK → tt.login() 获取 code
→ POST /auth/feishu/jsapi-auth { code }
→ 后端用 code 换 user_access_token → 获取 user_id
→ 签发 JWT → 返回前端
```

### 独立浏览器（兼容）
```
重定向到飞书 OAuth 授权页
→ 用户授权 → 回调 /auth/feishu/callback?code=xxx
→ 后端用 code 换 user_access_token → 获取 user_id
→ 签发 JWT → 重定向到前端页面
```

### JWT
- payload: `{ user_id, user_name, role, dept_id }`
- 有效期: 8h
- 存储: cookie (httpOnly, secure, sameSite=lax)
- 角色来源: user_role_binding + org_cache

## 7. 前端页面

### 页面清单
| 页面 | 路由 | 功能 |
|---|---|---|
| 登录/回调 | `/auth/callback` | OAuth 回调 + JS-SDK 免登跳转 |
| 我的任务 | `/tasks` | 默认首页，任务列表，状态筛选，分页 |
| 任务详情 | `/tasks/[task_uid]` | 查看/编辑，操作按钮按角色显隐 |

### 技术
- App Router + Server Components
- shadcn/ui + Tailwind CSS
- SWR 做请求缓存和乐观更新
- `@open/lark-js-sdk` 飞书环境判断和免登

## 8. M1 不做的内容

- sync-engine / feishu-sdk-wrapper
- Worker / 定时任务
- 多维表格 / 飞书任务 / 日历同步
- 卡片交互
- 月结 / 驾驶舱 / Leader 视图
- 复杂筛选、图表、统计
