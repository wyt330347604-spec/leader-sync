# leader-sync — AI Handoff Document

> **Purpose**: This document is written to be fed wholesale to another LLM so it can start contributing to the codebase without grepping. It contains: project identity, architecture, domain model, business rules, deployment mechanics, and known gotchas. Last refreshed: **2026-05-22**.

---

## 1. At a Glance

**What it is**: A web + Feishu (Lark) integrated task management system for tracking executive ("leader") monthly to-dos. Built for a single organization (~14 named users, 20+ task assignees, 500+ active tasks).

**Production**: https://www.harveywang.xyz (HTTPS via Let's Encrypt, expires 2026-07-03).

**Primary entry points users see**:
1. Feishu Bitable (multidimensional table) — `base Hvctbu6dTaLLRysBCrLcIqF1nwx / 督办子表 tblOP52tRfq7K8TV`
2. Web UI — five pages: `/tasks`, `/tasks/create`, `/tasks/[uid]`, `/dashboard`, `/projects`, `/settings/notifications`, `/widget` (Feishu webview)
3. Feishu cards (push) — weekly digest, daily overdue, monthly close

**Three source-of-truth principle**:
- **PostgreSQL is the master.**
- Bitable / Feishu Task / Feishu Calendar are *projections + interaction surfaces*.
- All cross-system writes go through `sync-engine`.
- All event handling is **idempotent** (via `inbound_event.source_event_id` uniqueness + hash diff).

---

## 2. Tech Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict mode) |
| Backend framework | NestJS 11 |
| Frontend | Next.js 15 (App Router) + React 19 + Tailwind 4 + SWR |
| DB | PostgreSQL (Docker container `leader-sync-postgres-1`) |
| ORM | Drizzle ORM |
| Cache / Queue | Redis (declared but unused in current code) |
| Worker runtime | `tsx` (TypeScript executed directly, NOT compiled `dist/`) |
| Cron | `node-cron` |
| Auth | JWT cookie (HS256, 7-day expiry) + Feishu OAuth / JS-SDK |
| Feishu SDK | `@larksuiteoapi/node-sdk` (worker) + raw HTTP (api) |
| Package manager | pnpm 10 (monorepo with `pnpm-workspace.yaml`) |
| Test | Vitest (unit/component) + Playwright (e2e + screenshot audit) |
| Deploy | Manual rsync + nohup on Ubuntu (no CI auto-deploy) |
| CI | GitLab `ai-coding-lab/leader-sync` (k3s test env only) |

---

## 3. Monorepo Layout

```
leader-sync/
├── apps/
│   ├── api/       @leader-sync/api          NestJS REST API (port 3001)
│   ├── web/       @leader-sync/web          Next.js 15 frontend (port 3000)
│   └── worker/    @leader-sync/worker       node-cron jobs (sync + reminders)
├── db/            @leader-sync/db           Drizzle schema + connection factory
├── packages/
│   ├── shared-types/ @leader-sync/shared-types  Enums + API contract types
│   └── domain-core/  @leader-sync/domain-core   State machine + UID gen
├── docs/                                    Internal docs (governance + specs)
├── helm/                                    k8s charts (legacy)
└── scripts/                                 Dev tunnel + log pull
```

Workspace declared in `pnpm-workspace.yaml`: `apps/*`, `packages/*`, `db`.

---

## 4. Architecture & Data Flow

```
┌───────────────┐  webhook+poll  ┌────────────────┐  ORM   ┌─────────────┐
│ Feishu Bitable│ ──────────────▶│ Worker (cron)  │ ─────▶│ PostgreSQL  │
│   多维表格    │ ◀──────────────│  sync-inbound  │ ◀──── │  (master)   │
└───────────────┘                │  sync-outbound │        └──────┬──────┘
                                 │  overdue/weekly│               │
                                 │  monthly-close │               │
                                 └────────────────┘               │
┌───────────────┐                                                 │
│ Feishu Card   │ ◀── push                                        │
│   通知卡片    │                                                 │
└───────────────┘                                                 │
                                                                  ▼
┌───────────────┐  /api/v1/*   ┌────────────────┐  Drizzle  ┌──────────────┐
│ Web (Next.js) │ ────────────▶│ API (NestJS)   │ ─────────▶│ PostgreSQL   │
│   apps/web    │ ◀────────────│   apps/api     │ ◀─────────│              │
└───────────────┘              └────────────────┘            └──────────────┘
       ▲
       │ Feishu JS-SDK OAuth
       │
┌───────────────┐
│   User in     │
│ Feishu / Web  │
└───────────────┘
```

**Sync direction priority**: hash-based ("last write wins"). DB's `external_mapping.last_sync_hash` (MD5 first 16 chars) gates outbound writes; same for inbound.

**Idempotency mechanism**: `inbound_event` table uniqueness on `source_event_id`; OCC (`task.version` + `WHERE version = ?` on every update) for API writes.

---

## 5. Domain Model

### 5.1 Core Entities

| Entity | Table | Identity | Key Relationships |
|---|---|---|---|
| Task | `task` | `task_uid` (varchar 64) | → `project.project_uid` (string FK), → `task_leader[]`, ← `external_mapping[]`, ← `task_progress_log[]` |
| Project | `project` | `project_uid` (varchar 64) | ← `task.project_uid` |
| User | `org_cache` | `user_id` (varchar 128) | mirror of Feishu org, has `open_id` alias |
| External Mapping | `external_mapping` | (task_uid, source_type) | Maps a task to its Bitable record ID |
| Notification Pref | `user_notification_preference` | `user_id` (unique) | Per-user opt-out for cards |
| Monthly Snapshot | `monthly_snapshot` | `snapshot_uid` | Frozen month-end stats per scope |

### 5.2 Task Fields (the important ones)

```typescript
// Drizzle schema in db/src/schema/task.ts
{
  task_uid: string;             // business key
  title: string;
  detail?: string;
  task_type: 'new' | 'carry_over';
  priority: Priority;           // 4 quadrants
  status: TaskStatus;
  progress_percent?: number;    // 0-100
  latest_progress?: string;

  // People
  assignee_user_id: string;
  assignee_name: string;
  assignee_manager_user_id?: string;     // = leader at create time
  leader_user_id: string;                // PRIMARY single leader
  // additional leaders live in `task_leader` join table
  collaborators?: Array<{user_id: string, user_name: string}>;  // jsonb array

  // Dates
  start_at?: Date;
  due_at: Date;                 // required
  completed_at?: Date;

  // Derived (server-computed, NEVER from Bitable formula)
  days_to_due?: number;         // ceil((due_at - now) / 86400), null for done/shelved/closed
  is_overdue?: boolean;         // due_at < now AND status not in done-set

  // Time bucketing
  month_bucket: string;         // 'YYYY-MM', MUTATED on carry-over
  source_month?: string;        // original month before any carry-over
  is_carried_over?: boolean;
  carry_over_count?: number;
  carried_from_task_uid?: string;

  delay_count: number;          // incremented on every /delay call

  // Flags
  monthly_commitment_flag?: boolean;
  boss_attention_flag?: boolean;       // 重点任务

  // Project
  project_uid?: string;

  // OCC
  version: number;              // incremented on every update

  // Audit
  created_at, updated_at, created_by, updated_by, deleted_at;
}
```

### 5.3 Enum Inventory (`packages/shared-types/src/enums.ts`)

```typescript
TaskStatus:
  pending | not_started | in_progress | stalled | done | shelved
  | pending_review | reopened | closed
  // pending_review is reserved but not in valid transitions

Priority (四象限):
  urgent_important           // 重要紧急
  important_not_urgent       // 重要不紧急
  urgent_not_important       // 紧急不重要
  not_urgent_not_important   // 不紧急不重要

TaskType: new | carry_over

AssignmentType:
  boss_assign | manager_assign | peer_collaboration | self_claim | carry_over

SyncStatus:
  pending | syncing | retrying | success | failed
  | conflict | manual_review | skipped

SourceType: bitable | task | calendar | card | api | system

UserRole: employee | leader | boss | pmo | admin

RoleScope: employee | leader | company

ProjectCategory: jt(集团) | zy(自营) | fw(服务) | tz(投资) | hz(合作)
ProjectCategoryOrder: ['jt', 'zy', 'fw', 'tz', 'hz']

ProjectRegion: 印度 | 印尼 | 巴基斯坦 | 孟加拉 | 深圳

ConflictResolutionStatus:
  resolved_keep_local | resolved_accept_remote | resolved_merge
  | resolved_manual_override | unresolved_pending_review
```

### 5.4 Bitable ↔ DB Field Mapping (selected — see `apps/worker/src/services/sync-engine.ts`)

| Bitable (中文) | DB column | Direction | Notes |
|---|---|---|---|
| 待办事项 | `title` | ⇄ | |
| 任务详情 | `detail` | ⇄ | |
| 进展 | `status` | ⇄ | via `BitableStatusMap` |
| 重要紧急程度 | `priority` | ⇄ | via `BitablePriorityMap` |
| 进度百分比 | `progress_percent` | ⇄ | |
| 最新进展记录 | `latest_progress` | ⇄ | |
| 任务负责人 | `assignee_user_id` | ⇄ | `[{id:"ou_xxx"}]` |
| 直属上级 | `assignee_manager_user_id` | → outbound | |
| 预计完成日期 | `due_at` | ⇄ | ms timestamp |
| 实际完成日期 | `completed_at` | ⇄ | |
| 归属月份 | `month_bucket` | → outbound | |
| 剩余天数 | `days_to_due` | → outbound | DERIVED |
| 是否延期 | `is_overdue` | → outbound | DERIVED, "已延期"/"正常" |
| 重点任务 | `boss_attention_flag` | → outbound | boolean |

**Forbidden**: never let Bitable formulas be authoritative. Always compute `days_to_due`/`is_overdue` server-side and write back.

---

## 6. Business Rules

### 6.1 `month_bucket` (核心月度概念)

- Set at task creation: `due_at.slice(0, 7)` → `'YYYY-MM'`.
- On `/delay` (deferral): `due_at` changes, but **`month_bucket` does NOT change**.
- On monthly close: incomplete tasks have their `month_bucket` **mutated** to `thisMonth`. No new row is created. `source_month` captures the original.

This means: a task lives in **exactly one** month at any time. Dashboard queries `WHERE month_bucket IN (...)`.

### 6.2 Status Transition (`packages/domain-core/src/task-state-machine.ts`)

```
pending     → not_started, in_progress, done, shelved
not_started → in_progress, done, shelved
in_progress → stalled, done, shelved
stalled     → in_progress, done, shelved   // requires non-empty stall_reason
done        → reopened, closed
reopened    → in_progress, done
shelved     → in_progress, closed
closed      → (terminal)
```

Same-status patch is allowed (no transition validation). `pending_review` is unreachable in current state machine (declared but no entry in `VALID_TRANSITIONS`).

### 6.3 Permissions

**Project CRUD** (hardcoded in `apps/api/src/modules/project/project.controller.ts`):

```typescript
const PROJECT_ADMIN_IDS = new Set([
  'ou_243a9225acc248c148c25f8fe0699407',  // Tobi
  'ou_1c419560953e219d5876918a2b934dfb',  // Harvey
  'ou_5a06e17c2ec88a72a2ef4ce040b3d77d',  // 杨平
  'ou_dev_harvey', 'ou_dev_boss',         // dev only (only issuable in NODE_ENV=development)
]);
```

Check matches against both `user.open_id` and `user.user_id` from JWT.

**Task CRUD**: any authenticated user (no role enforcement on task endpoints currently).

**Leader detection at task creation**:
- `leader_user_id` = the assignee's `manager_user_id` from `org_cache`.
- If issuer has no manager (root of org) → leader falls back to issuer.

### 6.4 Risk Calculation (Dashboard)

A task gets `riskReasons` if ANY of:
1. **overdue**: `is_overdue=true` AND status not in `done|shelved|closed`
2. **carry_over**: `carry_over_count >= 2`
3. **stalled**: `status = 'stalled'`
4. **near_due**: `0 <= days_to_due <= 3` AND not done
5. **important_no_progress**: `boss_attention_flag=true` AND `progress_percent=0` AND not done

Implementation: `apps/api/src/modules/dashboard/dashboard.service.ts → computeRiskReasons()`.

### 6.5 Multi-Leader

- `task.leader_user_id` is the PRIMARY single leader (set at creation, immutable through normal updates).
- `task_leader` table holds ADDITIONAL leaders (M:N junction, no uniqueness constraint).
- Dashboard groups a task under EVERY leader (`getLeaderIdsForTask()` unions primary + task_leader).
- Weekly leader digest SQL: `UNION` of both sources.

### 6.6 Sync Idempotency

Every Bitable record carries an MD5 hash (first 16 hex chars) of its normalized field map. Stored in `external_mapping.last_sync_hash`.

- **Inbound** (`sync-inbound.ts`, runs every minute):
  - Pull all Bitable records (page_size=100)
  - Compute hash, compare to stored hash
  - If unchanged → skip. If changed → UPDATE task + UPDATE mapping
  - If no mapping → CREATE task + CREATE mapping (must have `due_at`)
- **Outbound** (`sync-outbound.ts`, runs every minute):
  - LEFT JOIN task with mapping where `source_type='bitable'`, `deleted_at IS NULL`
  - Same hash gate + `updated_at > last_sync_at` gate
  - On API failure → mark `sync_status='failed'`, log warning

### 6.7 Optimistic Concurrency Control

Every API write that changes a task uses `taskRepository.updateWithVersion(taskUid, version, values)`:

```sql
UPDATE task SET ..., version = version + 1
WHERE task_uid = ? AND version = ?
```

Returns null if no row affected → throws `BusinessException(1009, 'VERSION_CONFLICT')`. Frontend can re-fetch and retry.

---

## 7. API Surface

**Base prefix**: `/api/v1` (configurable via `API_PREFIX` env).

**Auth**: `AuthGuard` (`apps/api/src/common/guards/auth.guard.ts`) reads cookie `token`, verifies JWT with `JWT_SECRET`, attaches payload to `req.user`. Applied globally except `/auth/feishu/callback` and `/health`.

**Response envelope** (all responses, success or fail):
```json
{"code": 0, "message": "ok", "trace_id": "tr_xxx", "data": {...}}
{"code": 1009, "message": "VERSION_CONFLICT", "trace_id": "tr_xxx", "data": null}
```

Common error codes: 1001 (bad request), 1002 (no permission, HTTP 403), 1003 (not found), 1004 (invalid enum), 1009 (version conflict).

### 7.1 Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/feishu/jsapi-auth` | JS-SDK code → JWT cookie |
| GET | `/auth/feishu/callback` | OAuth redirect handler (no guard) |
| GET | `/auth/me` | Current user profile |
| POST | `/auth/dev-login` | DEV-ONLY (returns 404 in prod). Body: `{user_id}`. Signs JWT + sets cookie. Used by Playwright e2e. |

### 7.2 Tasks

| Method | Path | Notes |
|---|---|---|
| POST | `/tasks` | create |
| GET | `/tasks/:task_uid` | read |
| PATCH | `/tasks/:task_uid` | update (validates transition if `status` changes) |
| DELETE | `/tasks/:task_uid` | soft-delete (sets `deleted_at`) |
| POST | `/tasks/:task_uid/assign` | reassign |
| POST | `/tasks/:task_uid/complete` | force `done` transition |
| POST | `/tasks/:task_uid/delay` | delay due_at; +1 delay_count; date >= today (Asia/Shanghai) and >= current due_at |
| POST | `/tasks/:task_uid/toggle-important` | flip boss_attention_flag |
| POST | `/tasks/:task_uid/notify-leader` | stub (MVP) |
| PATCH | `/tasks/:task_uid/status` | delegates to PATCH /tasks/:uid |
| PATCH | `/tasks/:task_uid/priority` | same |
| PATCH | `/tasks/:task_uid/progress` | same |
| GET | `/me/tasks` | paginated list. Query: `status, bucket, priority, role={all\|owner\|collaborator}, page, page_size` |
| POST/DELETE/GET | `/tasks/:uid/leaders[/:leader_user_id]` | task_leader CRUD |
| POST/DELETE/GET | `/tasks/:uid/collaborators[/:collab_id]` | mutates `collaborators` jsonb |

### 7.3 Dashboard

| Method | Path | Notes |
|---|---|---|
| GET | `/dashboard/boss` | Query: `month?\|quarter?\|year?`. Aggregated by leader → member. |
| GET | `/dashboard/gantt` | Same query. Groups by leader. |

### 7.4 Projects

| Method | Path | Notes |
|---|---|---|
| GET | `/projects` | list |
| GET | `/projects/permissions` | `{canManage: bool}` |
| POST | `/projects` | admin-only. Body: `{name, category?, ownerName?, region?, subtitle?}` |
| PATCH | `/projects/:project_uid` | admin-only. Same fields |
| DELETE | `/projects/:project_uid` | admin-only. Cannot delete `is_default=true` |
| POST | `/projects/:project_uid/set-default` | admin-only |

### 7.5 Users / Notification

| Method | Path | Notes |
|---|---|---|
| GET | `/users/search?q=` | In-memory fuzzy: Chinese name + full pinyin + first-letter abbreviation. Top 10. |
| GET | `/me/notification-preference` | get pref (creates default if absent) |
| PATCH | `/me/notification-preference` | update `daily_overdue_enabled` and/or `weekly_summary_enabled` |

---

## 8. Frontend Structure

### 8.1 Routes (`apps/web/src/app/`)

| Route | File | Purpose |
|---|---|---|
| `/` | `page.tsx` | redirects to `/tasks` |
| `/tasks` | `tasks/page.tsx` | task list |
| `/tasks/create` | `tasks/create/page.tsx` | create form |
| `/tasks/[task_uid]` | `tasks/[task_uid]/page.tsx` | detail + inline edit |
| `/dashboard` | `dashboard/page.tsx` | boss dashboard |
| `/projects` | `projects/page.tsx` | project architecture overview (5 categories, 21 projects) |
| `/settings/notifications` | `settings/notifications/page.tsx` | per-user opt-out toggles |
| `/widget` | `widget/page.tsx` | embedded Feishu webview entry |
| `/(auth)/callback` | `(auth)/callback/page.tsx` | OAuth client-side handler |

### 8.2 UI Primitives (`src/components/ui/`)

```
button.tsx          Radix Slot + CVA variants
dialog.tsx          Radix Dialog wrapper
alert-dialog.tsx    Radix AlertDialog
popover.tsx         Radix Popover
calendar.tsx        react-day-picker
combobox.tsx        ⭐ NEW (2026-05): cmdk-based, supports substring + pinyin search
sonner.tsx          Toast provider
```

### 8.3 Domain Components

```
top-nav.tsx              header navigation
status-badge.tsx         task status pill
priority-badge.tsx       priority pill
gantt-chart.tsx          Gantt chart canvas
delay-task-dialog.tsx    deferral modal
date-picker.tsx          calendar input
loading-screen.tsx       full-page spinner
project-modal.tsx        ⭐ project create/edit modal (used on /projects)
quick-add-task.tsx       floating quick-add widget
theme-toggle.tsx         dark/light toggle
```

### 8.4 Lib (`src/lib/`)

- **`api-client.ts`** — `apiFetch<T>(path, options)`:
  - Uses `credentials: 'include'`
  - Base URL: `NEXT_PUBLIC_API_URL || ''` (relative path → Next rewrite forwards to API)
  - Parses `ApiResponse<T>`, returns `data` if `code === 0`, throws `ApiError` otherwise
- **`auth.ts`** — `ensureAuth()`:
  - Calls `/api/v1/auth/me`
  - If 401 in Feishu webview (UA-sniffed via `isFeishuEnv()`) → uses JS-SDK `requestAuthCode` → POST `/auth/feishu/jsapi-auth`
  - Else → redirect to `/api/v1/auth/feishu/callback?redirect=<currentPath>` (with 800ms delay so LoadingScreen renders)
- **`feishu.ts`** — JS-SDK wrapper (`window.tt.requestAuthCode`)
- **`avatar.ts`** — `getAvatar(name)`: deterministic color/initial from name (djb2 hash → 8-color palette); `'?'` for null/empty
- **`utils.ts`** — `cn()` (clsx + tailwind-merge)

### 8.5 API Client Envelope Handling

```typescript
// Success path
const projects = await apiFetch<Project[]>('/api/v1/projects');
// → API returns {code:0, data:[...], message:"ok", trace_id:"tr_xxx"}
// → apiFetch returns the array directly

// Error path
try {
  await apiFetch('/api/v1/projects', { method: 'POST', body: JSON.stringify({...}) });
} catch (err) {
  if (err instanceof ApiError) {
    // err.code, err.message, err.traceId
  }
}
```

### 8.6 Next.js Rewrite

`apps/web/next.config.ts`:
```typescript
{
  output: 'standalone',
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.API_URL || 'http://localhost:3001'}/api/:path*` }];
  },
}
```

Browser sees `/api/*` on the same origin; Next dev server proxies to API on 3001. Production uses standalone server with the same rewrite.

---

## 9. Worker (apps/worker)

Single process, hardcoded cron schedule (no env gates). Uses **`tsx`** to run TS source directly — does NOT use compiled `dist/`.

**Job registry** (`apps/worker/src/main.ts`):

| Job | Schedule (cron, server TZ Asia/Shanghai) | UTC | Handler |
|---|---|---|---|
| `sync-inbound` | `*/1 * * * *` | every minute | `runSyncInbound()` |
| `sync-outbound` | `*/1 * * * *` | every minute | `runSyncOutbound()` |
| `weekly-reminder` | `0 9 * * 1` (Mon 09:00) | Mon 01:00 UTC | `runWeeklyReminder()` |
| `overdue-reminder` | `0 10 * * *` (10:00 daily) | 02:00 UTC | `runOverdueReminder()` |
| `monthly-close` | `0 8 1 * *` (1st of month, 08:00) | 1st 00:00 UTC | `runMonthlyClose()` |

**Notification gate semantics**:
- `weekly-reminder` per-user opt-out: `user_notification_preference.weekly_summary_enabled` (default `true`).
- `overdue-reminder` per-user opt-out: `user_notification_preference.daily_overdue_enabled` (default `false` at schema, but **worker treats `absent row` as `true`** — see Gotcha 4 in §13).
- `monthly-close` has no user opt-out.

---

## 10. Database Schema (compact reference)

All schemas in `db/src/schema/*.ts`. Drizzle generates types; migrations are **hand-written SQL** in `db/migrations/`.

### Tables

| Table | Primary Key | Unique | Purpose |
|---|---|---|---|
| `task` | `id` | `task_uid` | central task record |
| `task_leader` | `id` | — | M:N additional leaders for tasks |
| `project` | `id` | `project_uid` | project container |
| `external_mapping` | `id` | `(task_uid, source_type)` | task → Bitable record ID + sync hash |
| `inbound_event` | `id` | `source_event_id` | webhook idempotency log |
| `sync_log` | `id` | — | append-only sync audit |
| `sync_conflict` | `id` | — | field-level conflict records |
| `monthly_snapshot` | `id` | `snapshot_uid` | frozen month-end stats |
| `org_cache` | `id` | `user_id` | Feishu user/org mirror |
| `user_role_binding` | `id` | — | role assignment |
| `task_progress_log` | `id` | `log_uid` | immutable status/progress audit |
| `user_notification_preference` | `id` | `user_id` | per-user opt-out flags |

### Migrations Applied

- `0001_add_delay_count.sql` — added `delay_count` to task
- `0002_add_user_notification_preference.sql` — new table
- `0003_project_arch_fields.sql` — added `category, owner_name, region, subtitle` to project (2026-05)

Run via `psql -f` directly (no auto-migrate). Drizzle Kit's `generate` is set up but not used in deploy flow.

---

## 11. Build & Deploy

### 11.1 Build Commands

```bash
# Foundation packages (build dist for downstream consumption)
pnpm --filter @leader-sync/shared-types build       # tsc
cd db && pnpm exec tsc -p tsconfig.build.json       # MUST use tsconfig.build.json (default includes scripts/ which has missing deps)
pnpm --filter @leader-sync/domain-core build

# Applications
cd apps/api && pnpm exec nest build                  # NestCLI → apps/api/dist/
cd apps/web && pnpm build                            # Next → apps/web/.next/

# Worker uses tsx (no separate build step in dev/prod)
```

### 11.2 CommonJS Gotcha (CRITICAL)

NestJS runtime uses CommonJS (`require()`). The base `tsconfig.base.json` emits `module: ESNext` by default. If you build `db` or `shared-types` with the base config, their `dist/` will be ESM and **NestJS startup will fail with `ERR_MODULE_NOT_FOUND ./connection`**.

**Fix already applied** in:
- `db/tsconfig.build.json`: `"module": "commonjs"`, `"moduleResolution": "node"`
- `packages/shared-types/tsconfig.json`: same

If you create a NEW workspace package that NestJS will `require`, set `module: commonjs` in its tsconfig.

### 11.3 Deploy Procedure (manual, server-direct)

Production: `47.84.35.154` (root SSH via `~/Documents/AI-APP/task-manger/Harvey.pem`). App dir: `/opt/leader-sync/`.

```bash
# 1. Build locally (see 11.1)

# 2. rsync each dist separately (DO NOT multi-source rsync — see §13 gotcha 3)
rsync -avz --delete -e "ssh -i ~/Documents/AI-APP/task-manger/Harvey.pem" \
  packages/shared-types/dist/ root@47.84.35.154:/opt/leader-sync/packages/shared-types/dist/
rsync -avz --delete -e "ssh -i ~/Documents/AI-APP/task-manger/Harvey.pem" \
  db/dist/ root@47.84.35.154:/opt/leader-sync/db/dist/
rsync -avz --delete -e "ssh -i ~/Documents/AI-APP/task-manger/Harvey.pem" \
  apps/api/dist/ root@47.84.35.154:/opt/leader-sync/apps/api/dist/
rsync -avz --delete -e "ssh -i ~/Documents/AI-APP/task-manger/Harvey.pem" \
  apps/web/.next/ root@47.84.35.154:/opt/leader-sync/apps/web/.next/

# 3. If new dependencies added — sync package.json + lockfile, then install on prod
rsync apps/web/package.json root@47.84.35.154:/opt/leader-sync/apps/web/package.json
rsync pnpm-lock.yaml root@47.84.35.154:/opt/leader-sync/pnpm-lock.yaml
ssh -i ~/.../Harvey.pem root@47.84.35.154 'cd /opt/leader-sync && pnpm install --frozen-lockfile'

# 4. Restart (INDEPENDENT SSH calls — pkill kills the SSH connection too)
ssh ... 'pkill -f "apps/api/dist/main.js" || true'
ssh ... 'cd /opt/leader-sync && source .env && nohup node apps/api/dist/main.js > /var/log/leader-api.log 2>&1 < /dev/null & disown'
ssh ... 'pkill -f "next-server"'
ssh ... 'cd /opt/leader-sync/apps/web && nohup npx next start --port 3000 > /var/log/leader-web.log 2>&1 < /dev/null & disown'
# Worker: usually long-lived; restart only if its code changed
ssh ... 'pkill -f "apps/worker/src/main.ts" || true'
ssh ... 'cd /opt/leader-sync && nohup pnpm --filter @leader-sync/worker exec tsx src/main.ts > /var/log/leader-worker.log 2>&1 < /dev/null & disown'

# 5. Smoke test
curl -o /dev/null -w "%{http_code}\n" https://www.harveywang.xyz/projects   # expect 200
curl -o /dev/null -w "%{http_code}\n" https://www.harveywang.xyz/api/v1/projects   # expect 401 (auth required)
```

### 11.4 Production Filesystem

```
/opt/leader-sync/
├── apps/
│   ├── api/dist/main.js          ← rsynced
│   └── web/.next/                ← rsynced
├── db/
│   ├── dist/                     ← rsynced
│   ├── migrations/               ← run via psql -f
│   └── seed/                     (dev only)
├── packages/shared-types/dist/   ← rsynced
├── node_modules/                 ← pnpm install on prod
├── .env                          ← managed manually
└── pnpm-lock.yaml                ← rsynced with package.json
```

Docker containers:
- `leader-sync-postgres-1` — production PG on `127.0.0.1:5432`
- `leader-sync-dev-postgres-dev-1` — dev PG on `127.0.0.1:5433` (accessed via SSH tunnel from laptops)

Logs (rotated by nothing — append-only):
- `/var/log/leader-api.log`
- `/var/log/leader-web.log`
- `/var/log/leader-worker.log`

---

## 12. Environment Variables

### Required (production)

```bash
# Database
DATABASE_URL=postgresql://leader_sync:leader_sync@127.0.0.1:5432/leader_sync
REDIS_URL=redis://127.0.0.1:6379   # declared but unused currently

# Feishu
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=xxx      # webhook (unused)
FEISHU_ENCRYPT_KEY=xxx             # webhook (unused)

# Auth
JWT_SECRET=<long-random>
JWT_EXPIRES_IN=7d

# Bitable
BITABLE_APP_TOKEN=Rv93bpZpQakM5wspg5Pc8xwcnRc   # also has hardcoded fallback
BITABLE_TABLE_ID=tblXBNGXXkKMlo4C                # also has hardcoded fallback

# API server
API_PORT=3001
API_PREFIX=/api/v1
APP_ENV=production
APP_BASE_URL=https://www.harveywang.xyz
NODE_ENV=production

# Web build-time
NEXT_PUBLIC_API_URL=                # empty = same origin
NEXT_PUBLIC_FEISHU_APP_ID=cli_xxx
```

### Per-Env Behavior

- `NODE_ENV=development` → enables `POST /auth/dev-login` (returns 404 in prod). Tests + Playwright depend on this.
- `APP_ENV=production` → cookie `secure: true` in OAuth flow.

---

## 13. Known Gotchas / Footguns

### 1. CommonJS module format (see §11.2)
NestJS runtime fails to load `@leader-sync/db` / `@leader-sync/shared-types` if their dist is ESM. Both tsconfigs override `module: commonjs`. **Never remove these overrides.**

### 2. db/tsconfig.json default-builds everything (including scripts/ with missing deps)
`pnpm --filter @leader-sync/db build` invokes `tsc` which uses `tsconfig.json` (includes `scripts/` folder). Those scripts have missing module imports (`@larksuiteoapi/node-sdk` only in worker workspace), so default build fails.

**Correct build command**: `cd db && pnpm exec tsc -p tsconfig.build.json` (which excludes scripts/).

### 3. Multi-source rsync silently flattens paths
```bash
# WRONG — both files land in dest/ root, NOT preserving subdir
rsync pnpm-lock.yaml apps/web/package.json root@host:/opt/leader-sync/

# CORRECT — one rsync per file
rsync pnpm-lock.yaml root@host:/opt/leader-sync/pnpm-lock.yaml
rsync apps/web/package.json root@host:/opt/leader-sync/apps/web/package.json
```

In 2026-05-11 deploy, this overwrote workspace-root `/opt/leader-sync/package.json` with `apps/web/package.json` content. Workaround: rsync each file with explicit destination path.

### 4. Worker treats "absent notification pref row" as `enabled=true` — schema default says false
```typescript
// apps/worker/src/jobs/overdue-reminder.ts:53
// Comment says "absent row = default true"
if (pref && !pref.dailyOverdueEnabled) {
  skippedOptOut++;
  continue;
}
```

But schema is:
```typescript
dailyOverdueEnabled: boolean('daily_overdue_enabled').notNull().default(false)
```

The schema default only kicks in for explicit `INSERT` without the field. The worker logic ignores schema default — for users with NO row, they receive reminders. **As of 2026-05-18**, all 23 known assignees have explicit rows with `false` (mass UPSERT applied), but new Feishu users joining the org will lack rows and start receiving reminders unless preemptively populated.

**Permanent fix would be**: change the worker logic to `if (!pref || !pref.dailyOverdueEnabled)` — but this requires a worker code change + redeploy.

### 5. `pkill` kills the SSH connection
When running `ssh ... 'pkill -f "..."'`, the pkill matches its own parent shell (ssh subprocess) and kills the connection. Workaround: run pkill in a separate SSH invocation from the start commands.

### 6. `UID` is a readonly shell variable in zsh
`UID=$(curl ... | jq -r ...)` fails in zsh. Use any other name (`PUID`, `proj_uid`, etc.).

### 7. dev DB tunnel must be open before running migration scripts locally
Migration scripts (`db/scripts/migrate-projects-prod-2026-05.ts`) use `DATABASE_URL=localhost:5432`. That port maps to dev DB on server via SSH tunnel.

```bash
pnpm dev:tunnel              # opens localhost:5432→server:5433, localhost:6379→server:6380
pnpm dev:tunnel:status       # check
pnpm dev:tunnel:down         # close
```

### 8. The `5effb946`/`6ce3d5cf` users in user_notification_preference
These are legacy user IDs (pre-dating the `ou_` prefix convention). They predate the current Feishu org sync. Don't delete them.

---

## 14. Testing

### Run commands

```bash
pnpm test                                     # all packages
pnpm --filter @leader-sync/api test
pnpm --filter @leader-sync/web test
pnpm --filter @leader-sync/domain-core test
pnpm --filter @leader-sync/web e2e:audit      # desktop screenshots
pnpm --filter @leader-sync/web e2e:audit:mobile
```

### Coverage areas

| Package | Tests | Coverage |
|---|---|---|
| api | 36 | task service, auth, notification pref, project service |
| web | 26 | avatar utility, combobox component, projects page (RTL), 1 sanity |
| domain-core | (varies) | state machine transitions |

### E2E (Playwright)

```
apps/web/e2e/
├── desktop.spec.ts        full visual audit (dark theme) of all pages + modals
├── mobile.spec.ts         responsive across mobile/tablet
├── error-states.spec.ts   500/404 injected via page.route()
└── helpers.ts             devLogin(), setTheme(), visit(), snap()
```

Screenshots baseline: `screenshots/__baseline__/desktop.spec.ts-snapshots/desktop/*.png` (gitignored — regenerated with `--update-snapshots`).

### Vitest setup requirements (for cmdk + jsdom)

`apps/web/vitest.setup.ts` polyfills:
- `global.ResizeObserver` (cmdk uses it)
- `HTMLElement.prototype.scrollIntoView` (cmdk calls it)

Without these, all combobox tests fail.

---

## 15. Recent Changes (2026-04 → 2026-05)

### 2026-04: April sync incident (resolved)
Synced April subtable `tbluUoYhIp3t3DGB` to DB by `title+assigneeName`. Mistakenly deleted 368 records (the subtable had 122 blank-title rows). Rolled back. Net: +67 new, ~20 updates kept. Fixed sync-engine field name bug: `老板关注` → `重点任务`. Reset 451 failed `external_mapping` rows. Final: 522 tasks in subtable == 522 tasks in DB. Backup at server `/tmp/db-backup-2026-04-*.json`.

### 2026-05 Phase 1: Project Architecture Overview (deployed 2026-05-11)
- DB migration `0003_project_arch_fields.sql` — added `category, owner_name, region, subtitle` (4 nullable columns).
- `apps/web/src/app/projects/page.tsx` — full rewrite. Now shows 5-category grouping + 21 projects + stats row + ProjectCard (color dot, badge, region tag, vacant owner state).
- `apps/web/src/components/project-modal.tsx` — new create/edit modal.
- `apps/web/src/lib/avatar.ts` — deterministic owner avatar utility.
- `apps/web/src/app/globals.css` — added `--cat-jt/zy/fw/tz/hz` color tokens.
- Backend `ProjectService` + `ProjectController` extended to accept new fields with enum validation.
- 21 projects total: 公司建设 (jt) + 8 zy + 3 fw + 7 tz + 2 hz.
- Production data migration: `db/scripts/migrate-projects-prod-2026-05.ts`. Production backup at `/tmp/db-backup-pre-arch-2026-05-11-1541.sql`.

### 2026-05 Phase 2: Combobox refactor (deployed 2026-05-11)
- Added `cmdk@1.1.1` dependency.
- New atom `apps/web/src/components/ui/combobox.tsx` (Popover + cmdk + pinyin via `tiny-pinyin`).
- 5 native `<select>` replaced:
  1. `tasks/create/page.tsx` — project picker
  2. `tasks/[task_uid]/page.tsx` — project picker
  3. `components/quick-add-task.tsx` — project picker
  4. `components/project-modal.tsx` — region picker
  5. (region is fixed enum but uses Combobox for visual consistency)
- Search: substring + pinyin (full + initials, e.g. "yd" → 印度).

### 2026-05-18: daily overdue mass opt-out
- All 23 known assignees have `daily_overdue_enabled = false` in DB.
- Worker still runs the cron daily at 02:00 UTC (10:00 Beijing) but sends 0 messages.
- See Gotcha 4 above for the permanent-fix tradeoff.

---

## 16. Project Governance Rules (from `CLAUDE.md`)

> These are bound by the human project owner and must be honored by any AI working in this repo.

### Naming sovereignty (命名主权)
- `_at` suffix = timestamptz (datetime); `_date` suffix = date only.
- One canonical field name per business semantic — no per-doc renaming.

### Model sovereignty (模型主权)
- `docs/02-data/field-dictionary.md` + `enum-dictionary.md` = business semantic authority.
- `docs/02-data/db-schema.md` = physical storage authority.
- `docs/03-sync/api-contracts.md` = external API authority.
- Other docs may only **reference**, not redefine.

### Sync sovereignty (同步主权)
- "Bidirectional sync" ≠ "every system can write every field".
- Field-level ownership + conflict strategy + idempotency + reconciliation are mandatory.

### Month-close sovereignty (月结主权)
- Logical cutoff = end-of-month 23:59:59 local time.
- Execution = 1st-of-month 08:00 local time.
- These must be defined separately.

### Forbidden
- Bitable formula as authoritative for `days_to_due` / `is_overdue` / etc.
- Direct multi-system write without going through `sync-engine`.
- Status changes without `event_id + version + source` audit triple.
- Writing code before updating documentation when changing semantics.

### Mandatory protocols
1. **Document-first**: changes start with a written design (spec). All ambiguous points must be confirmed with project owner before coding.
2. **TDD with proof**: Red → Green required. Code changes without seeing test fail first are rejected.
3. **UI changes require screenshot audit**: Playwright e2e + manual review of generated PNG.
4. **Bug investigations start with logs**: `scripts/pull-logs.sh` + `tail -n 500 /var/log/leader-api.log` before guessing.

### Delivery flow
1. Write design doc → confirm ambiguities → wait for sign-off
2. Detailed plan with file changes + test plan → wait for sign-off
3. Execute + run all tests + verify endpoints with curl + verify deployment health → only then mark done

---

## 17. External Resources & Credentials

### Repositories
- **Primary (CI/CD)**: https://gitlab.xiatiaotechnology.xyz/ai-coding-lab/leader-sync
- Personal GitLab: https://gitlab.xiatiaotechnology.xyz/harvey/leader-sync
- Personal GitHub: https://github.com/wyt330347604-spec/leader-sync

### Production
- **Live URL**: https://www.harveywang.xyz
- **Server**: 47.84.35.154 (Ubuntu 22.04)
- **SSH key**: `~/Documents/AI-APP/task-manger/Harvey.pem`
- **App directory**: `/opt/leader-sync/`
- **SSL**: Let's Encrypt, expires 2026-07-03

### Feishu / Bitable
- **App**: 督办系统 (Lark Self-built app)
- **Bitable App Token**: `Rv93bpZpQakM5wspg5Pc8xwcnRc`
- **督办 Sub-table**: `tblXBNGXXkKMlo4C` (production) / `tblOP52tRfq7K8TV` (deprecated reference)
- **Base**: `Hvctbu6dTaLLRysBCrLcIqF1nwx`

### Real user IDs (production)
| Name | open_id |
|---|---|
| Tobi (boss) | `ou_243a9225acc248c148c25f8fe0699407` |
| Harvey/王永涛 | `ou_1c419560953e219d5876918a2b934dfb` |
| 杨平 | `ou_5a06e17c2ec88a72a2ef4ce040b3d77d` |

### Dev fixtures
| Name | user_id |
|---|---|
| Harvey (admin role) | `ou_dev_harvey` |
| Tobi (boss role) | `ou_dev_boss` |
| 张三 (employee) | `ou_dev_alice` |
| 李四 (employee) | `ou_dev_bob` |
| 王五 (employee) | `ou_dev_carol` |

Seed file: `db/seed/fixtures.ts`. Populates 5 users + 21 projects + 20 tasks (covering all status × priority × delay × carry × boss-attention visual states).

---

## 18. Pending / Roadmap

From project memory (see `~/.claude/projects/.../project_m1_progress.md`):

- 飞书后台回调地址改 HTTPS
- 飞书网页应用首页改 HTTPS
- 飞书小组件配置
- `systemd` 进程保活（替代 nohup）
- 通讯录 API 权限 (`contact:contact.base:readonly`)
- 飞书任务中心同步（独立需求）
- 添加协作人时发送飞书通知
- 数据库定时备份
- 监控告警
- 解决 Tobi 多 1 条 / 辛建豪少 1 条的微小差异（非阻塞）
- **快速创建任务的「高级」按钮：改为就地展开**，不要跳转到新建任务整页（2026-05-11 用户提出，未做）
- **Combobox Phase 3**: 把 5 处 inline 人员 popover (assignee/leader/collaborator) 重构为同一个 Combobox，删 ~150 行重复代码
- **延期提醒永久关闭决策**: 要么改 worker 代码 `absent row = default false`（永久兜底），要么周期性 UPSERT 新员工（需 cron job）

---

## 19. Where to Look First (orientation guide)

If you're a fresh AI starting on this codebase, read these files in order:

1. **`CLAUDE.md`** (repo root) — governance rules + delivery protocol
2. **`db/src/schema/task.ts`** — central data shape
3. **`packages/shared-types/src/enums.ts`** — all business enums
4. **`apps/api/src/modules/task/task.service.ts`** — main business logic
5. **`apps/worker/src/services/sync-engine.ts`** — Bitable field mapping
6. **`apps/worker/src/main.ts`** — cron job registry
7. **`apps/web/src/app/tasks/page.tsx`** — example complex page
8. **`docs/superpowers/specs/`** — recent design docs (2 specs as of 2026-05-22)
9. **`docs/superpowers/plans/`** — corresponding implementation plans

For deployment / ops: this document §11 + §13.
For domain modeling: §5 + §6.
For test/build issues: §11.2 + §14.

---

*End of handoff document. Length budget: ~3000 words. If you need more depth on any section, drill into the cited files.*
