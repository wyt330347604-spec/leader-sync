# M1 基础底座 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the foundation: monorepo scaffold, PostgreSQL schema (9 tables), NestJS API (auth + task CRUD), Next.js web (login + task list + detail).

**Architecture:** Monorepo with pnpm workspaces + Turborepo. NestJS API server handles auth and business logic. Next.js frontend communicates via REST. Drizzle ORM manages schema and migrations. PostgreSQL is the single source of truth. Auth via Feishu JS-SDK (H5) + OAuth (browser), JWT in httpOnly cookie.

**Tech Stack:** Node 22, pnpm, Turborepo, NestJS, Next.js (App Router), Drizzle ORM, PostgreSQL 15, Redis 7, shadcn/ui, Tailwind, SWR

**Reference docs (in `leader-sync-docs 2/docs/`):**
- `02-data/enum-dictionary.md` — all enum values
- `02-data/field-dictionary.md` — field definitions and required levels
- `07-architecture/db-schema.md` — complete table DDL
- `07-architecture/api-contracts.md` — API interface contracts
- `04-process/state-machine.md` — status transitions
- `05-permissions/permission-matrix.md` — role permissions

---

## Task 1: Monorepo Scaffold

**Files:**
- Create: `leader-sync/package.json`
- Create: `leader-sync/pnpm-workspace.yaml`
- Create: `leader-sync/turbo.json`
- Create: `leader-sync/tsconfig.base.json`
- Create: `leader-sync/.gitignore`
- Create: `leader-sync/.env.example`
- Create: `leader-sync/docker-compose.yml`
- Create: `leader-sync/.nvmrc`

**Step 1: Create root directory and package.json**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger
mkdir leader-sync && cd leader-sync
```

`package.json`:
```json
{
  "name": "leader-sync",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint",
    "test": "turbo test",
    "db:generate": "pnpm --filter db generate",
    "db:migrate": "pnpm --filter db migrate",
    "db:seed": "pnpm --filter db seed"
  },
  "engines": {
    "node": ">=22"
  }
}
```

**Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "db"
```

**Step 3: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "test": {}
  }
}
```

**Step 4: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "baseUrl": "."
  },
  "exclude": ["node_modules", "dist"]
}
```

**Step 5: Create .nvmrc, .gitignore, .env.example**

`.nvmrc`:
```
22
```

`.gitignore`:
```
node_modules/
dist/
.next/
.env
.env.local
*.log
.turbo/
.DS_Store
```

`.env.example`:
```bash
# App
APP_ENV=development
APP_BASE_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://leader_sync:leader_sync@localhost:5432/leader_sync

# Redis
REDIS_URL=redis://localhost:6379

# Feishu
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_VERIFICATION_TOKEN=
FEISHU_ENCRYPT_KEY=

# JWT
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=8h

# API
API_PORT=3001
API_PREFIX=/api/v1
```

**Step 6: Create docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:15-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: leader_sync
      POSTGRES_USER: leader_sync
      POSTGRES_PASSWORD: leader_sync
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pgdata:
```

**Step 7: Init git, install pnpm, verify**

```bash
git init
pnpm init  # already have package.json, skip
pnpm add -Dw turbo typescript
docker compose up -d
```

Run: `docker compose ps`
Expected: postgres and redis running

**Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo with pnpm + turborepo"
```

---

## Task 2: shared-types Package

**Files:**
- Create: `leader-sync/packages/shared-types/package.json`
- Create: `leader-sync/packages/shared-types/tsconfig.json`
- Create: `leader-sync/packages/shared-types/src/enums.ts`
- Create: `leader-sync/packages/shared-types/src/task.ts`
- Create: `leader-sync/packages/shared-types/src/api.ts`
- Create: `leader-sync/packages/shared-types/src/index.ts`

**Step 1: Create package.json and tsconfig**

`packages/shared-types/package.json`:
```json
{
  "name": "@leader-sync/shared-types",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc",
    "lint": "tsc --noEmit"
  }
}
```

`packages/shared-types/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**Step 2: Create enums.ts (aligned with enum-dictionary.md)**

```typescript
// All enums are the single source of truth in code,
// aligned with docs/02-data/enum-dictionary.md

export const TaskType = {
  STRATEGY: 'strategy',
  OPERATION: 'operation',
  PROJECT: 'project',
  REPORT: 'report',
  MEETING: 'meeting',
  COLLABORATION: 'collaboration',
  FOLLOW_UP: 'follow_up',
  OTHER: 'other',
} as const;
export type TaskType = (typeof TaskType)[keyof typeof TaskType];

export const Priority = {
  P0: 'p0',
  P1: 'p1',
  P2: 'p2',
  P3: 'p3',
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

export const AssignmentType = {
  BOSS_ASSIGN: 'boss_assign',
  MANAGER_ASSIGN: 'manager_assign',
  PEER_COLLABORATION: 'peer_collaboration',
  SELF_CLAIM: 'self_claim',
  CARRY_OVER: 'carry_over',
} as const;
export type AssignmentType = (typeof AssignmentType)[keyof typeof AssignmentType];

export const TaskStatus = {
  DRAFT: 'draft',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  BLOCKED: 'blocked',
  PENDING_REVIEW: 'pending_review',
  DONE: 'done',
  REOPENED: 'reopened',
  CANCELLED: 'cancelled',
  CLOSED: 'closed',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const SyncStatus = {
  PENDING: 'pending',
  SYNCING: 'syncing',
  RETRYING: 'retrying',
  SUCCESS: 'success',
  FAILED: 'failed',
  CONFLICT: 'conflict',
  MANUAL_REVIEW: 'manual_review',
  SKIPPED: 'skipped',
} as const;
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];

export const SourceType = {
  BITABLE: 'bitable',
  TASK: 'task',
  CALENDAR: 'calendar',
  CARD: 'card',
  API: 'api',
  SYSTEM: 'system',
} as const;
export type SourceType = (typeof SourceType)[keyof typeof SourceType];

export const RoleScope = {
  EMPLOYEE: 'employee',
  LEADER: 'leader',
  COMPANY: 'company',
} as const;
export type RoleScope = (typeof RoleScope)[keyof typeof RoleScope];

export const ConflictResolutionStatus = {
  RESOLVED_KEEP_LOCAL: 'resolved_keep_local',
  RESOLVED_ACCEPT_REMOTE: 'resolved_accept_remote',
  RESOLVED_MERGE: 'resolved_merge',
  RESOLVED_MANUAL_OVERRIDE: 'resolved_manual_override',
  UNRESOLVED_PENDING_REVIEW: 'unresolved_pending_review',
} as const;
export type ConflictResolutionStatus = (typeof ConflictResolutionStatus)[keyof typeof ConflictResolutionStatus];

export const UserRole = {
  EMPLOYEE: 'employee',
  LEADER: 'leader',
  BOSS: 'boss',
  PMO: 'pmo',
  ADMIN: 'admin',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
```

**Step 3: Create task.ts (DTOs)**

```typescript
import type { TaskType, Priority, AssignmentType, TaskStatus } from './enums';

// Create task — user-submitted required fields (A-level)
export interface CreateTaskDto {
  title: string;
  detail?: string;
  task_type: TaskType;
  priority: Priority;
  assignee_user_id: string;
  due_at: string; // ISO 8601
  start_at?: string;
  assignment_type?: AssignmentType;
  boss_attention_flag?: boolean;
}

// Update task — must include version for optimistic locking
export interface UpdateTaskDto {
  version: number; // required — optimistic lock
  title?: string;
  detail?: string;
  status?: TaskStatus;
  progress_percent?: number;
  latest_progress?: string;
  due_at?: string;
  completed_at?: string;
  blocked_reason?: string;
  delay_reason?: string;
}

export interface AssignTaskDto {
  assignee_user_id: string;
  assignment_type: AssignmentType;
  reason?: string;
}

export interface CompleteTaskDto {
  latest_progress?: string;
  completed_at?: string;
}

export interface DelayTaskDto {
  new_due_at: string;
  delay_reason: string;
}

export interface TaskListQuery {
  status?: TaskStatus;
  bucket?: string; // YYYY-MM
  priority?: Priority;
  page?: number;
  page_size?: number;
}
```

**Step 4: Create api.ts (response types)**

```typescript
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  trace_id: string;
  data: T;
}

export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export const ErrorCode = {
  INVALID_PARAMS: 1001,
  UNAUTHORIZED: 1002,
  TASK_NOT_FOUND: 1003,
  INVALID_STATUS_TRANSITION: 1004,
  SYNC_CONFLICT: 1005,
  EXTERNAL_SYSTEM_ERROR: 1006,
  MONTHLY_CLOSE_LOCKED: 1007,
  VERSION_CONFLICT: 1009,
} as const;
```

**Step 5: Create index.ts barrel export**

```typescript
export * from './enums';
export * from './task';
export * from './api';
```

**Step 6: Install dependencies and verify**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync
pnpm install
pnpm --filter @leader-sync/shared-types lint
```

Expected: no TypeScript errors

**Step 7: Commit**

```bash
git add packages/shared-types/
git commit -m "feat: add shared-types package with enums and DTOs"
```

---

## Task 3: Database Schema + Migrations

**Files:**
- Create: `leader-sync/db/package.json`
- Create: `leader-sync/db/tsconfig.json`
- Create: `leader-sync/db/drizzle.config.ts`
- Create: `leader-sync/db/src/connection.ts`
- Create: `leader-sync/db/src/schema/task.ts`
- Create: `leader-sync/db/src/schema/task-progress-log.ts`
- Create: `leader-sync/db/src/schema/external-mapping.ts`
- Create: `leader-sync/db/src/schema/inbound-event.ts`
- Create: `leader-sync/db/src/schema/sync-log.ts`
- Create: `leader-sync/db/src/schema/sync-conflict.ts`
- Create: `leader-sync/db/src/schema/monthly-snapshot.ts`
- Create: `leader-sync/db/src/schema/user-role-binding.ts`
- Create: `leader-sync/db/src/schema/org-cache.ts`
- Create: `leader-sync/db/src/schema/index.ts`
- Create: `leader-sync/db/src/index.ts`
- Create: `leader-sync/db/seed/index.ts`

**Step 1: Create db/package.json**

```json
{
  "name": "@leader-sync/db",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "generate": "drizzle-kit generate",
    "migrate": "drizzle-kit migrate",
    "seed": "tsx seed/index.ts",
    "studio": "drizzle-kit studio",
    "build": "tsc",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "drizzle-orm": "latest",
    "postgres": "latest",
    "@leader-sync/shared-types": "workspace:*"
  },
  "devDependencies": {
    "drizzle-kit": "latest",
    "tsx": "latest",
    "dotenv": "latest"
  }
}
```

**Step 2: Create drizzle.config.ts**

```typescript
import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

**Step 3: Create db/src/connection.ts**

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export function createDb(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
```

**Step 4: Create all 9 schema files**

Each schema file strictly follows `db-schema.md`. The full code for all 9 tables should be implemented as defined in the design doc. Key tables:

`db/src/schema/task.ts` — main task table with all fields from db-schema.md section 2.1, including indexes.

`db/src/schema/external-mapping.ts` — normalized mapping with UNIQUE(task_uid, source_type).

`db/src/schema/monthly-snapshot.ts` — includes snapshot_run_id, snapshot_version, is_latest, month_due_count.

All other tables (task-progress-log, inbound-event, sync-log, sync-conflict, user-role-binding, org-cache) follow db-schema.md exactly.

`db/src/schema/index.ts` — barrel export all tables.

**Step 5: Create db/src/index.ts**

```typescript
export * from './connection';
export * from './schema';
```

**Step 6: Generate and run migration**

```bash
cp .env.example .env  # fill in values
pnpm install
pnpm --filter @leader-sync/db generate
pnpm --filter @leader-sync/db migrate
```

Expected: migration files created in `db/migrations/`, tables created in PostgreSQL

**Step 7: Create seed script**

`db/seed/index.ts` — insert test data:
- 3 users in org_cache (employee, leader, boss)
- 3 role bindings in user_role_binding
- 5 sample tasks spanning different statuses

**Step 8: Run seed and verify**

```bash
pnpm --filter @leader-sync/db seed
```

Verify with: `docker compose exec postgres psql -U leader_sync -c "SELECT count(*) FROM task;"`
Expected: 5

**Step 9: Commit**

```bash
git add db/
git commit -m "feat: add database schema with all 9 tables and seed data"
```

---

## Task 4: domain-core Package — State Machine

**Files:**
- Create: `leader-sync/packages/domain-core/package.json`
- Create: `leader-sync/packages/domain-core/tsconfig.json`
- Create: `leader-sync/packages/domain-core/src/task-state-machine.ts`
- Create: `leader-sync/packages/domain-core/src/task-uid.ts`
- Create: `leader-sync/packages/domain-core/src/index.ts`
- Test: `leader-sync/packages/domain-core/src/__tests__/task-state-machine.test.ts`

**Step 1: Write failing tests for state machine**

Tests should cover all valid transitions from state-machine.md section 1:
- draft → assigned
- assigned → in_progress
- assigned → cancelled
- in_progress → blocked (requires blocked_reason)
- blocked → in_progress
- in_progress → pending_review
- pending_review → done
- pending_review → in_progress
- in_progress → done
- done → reopened
- reopened → in_progress
- done → closed
- cancelled → closed

And invalid transitions:
- draft → done (should throw)
- done → in_progress (should throw)
- closed → anything (should throw)

**Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @leader-sync/domain-core test
```

**Step 3: Implement state machine**

`task-state-machine.ts`:
- `VALID_TRANSITIONS` map: Record<TaskStatus, TaskStatus[]>
- `canTransition(from, to): boolean`
- `validateTransition(from, to, context?: { blocked_reason?: string }): void` — throws on invalid
- Enforce: `blocked` requires `blocked_reason`

`task-uid.ts`:
- `generateTaskUid(): string` — format: `task_${nanoid(16)}`

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```bash
git add packages/domain-core/
git commit -m "feat: add domain-core with task state machine"
```

---

## Task 5: NestJS API Scaffold + Common Middleware

**Files:**
- Create: `leader-sync/apps/api/package.json`
- Create: `leader-sync/apps/api/tsconfig.json`
- Create: `leader-sync/apps/api/nest-cli.json`
- Create: `leader-sync/apps/api/src/main.ts`
- Create: `leader-sync/apps/api/src/app.module.ts`
- Create: `leader-sync/apps/api/src/common/interceptors/trace-id.interceptor.ts`
- Create: `leader-sync/apps/api/src/common/interceptors/response.interceptor.ts`
- Create: `leader-sync/apps/api/src/common/filters/http-exception.filter.ts`
- Create: `leader-sync/apps/api/src/common/guards/auth.guard.ts`
- Create: `leader-sync/apps/api/src/common/decorators/current-user.decorator.ts`
- Create: `leader-sync/apps/api/src/common/exceptions/business.exception.ts`
- Create: `leader-sync/apps/api/src/modules/health/health.controller.ts`
- Create: `leader-sync/apps/api/src/modules/health/health.module.ts`

**Step 1: Create NestJS app with dependencies**

Key dependencies:
- `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`
- `@nestjs/config` — env management
- `@nestjs/jwt` — JWT signing/verification
- `drizzle-orm`, `postgres` — DB access via @leader-sync/db
- `nanoid` — UID generation
- `class-validator`, `class-transformer` — request validation

**Step 2: Implement common middleware**

- `TraceIdInterceptor`: generates `trace_id` per request, attaches to request object
- `ResponseInterceptor`: wraps all responses in `{ code: 0, message: "ok", trace_id, data }`
- `HttpExceptionFilter`: catches exceptions, maps to `{ code: errorCode, message, trace_id, data: null }`
- `BusinessException`: custom exception class with error code
- `AuthGuard`: extracts JWT from cookie, verifies, injects `req.user = { user_id, user_name, role, dept_id }`
- `CurrentUser` decorator: `createParamDecorator` that reads `req.user`

**Step 3: Implement health endpoints**

- `GET /healthz` → `{ status: "ok" }`
- `GET /readyz` → checks DB connection + Redis ping, returns `{ db: "ok", redis: "ok" }` or 503

**Step 4: Wire up app.module.ts**

Register global interceptors, filters, config module, DB provider.

**Step 5: Verify**

```bash
pnpm --filter api dev
curl http://localhost:3001/healthz
```

Expected: `{ "code": 0, "message": "ok", "trace_id": "...", "data": { "status": "ok" } }`

**Step 6: Commit**

```bash
git add apps/api/
git commit -m "feat: scaffold NestJS API with common middleware and health checks"
```

---

## Task 6: Auth Module (Feishu Login + JWT)

**Files:**
- Create: `leader-sync/apps/api/src/modules/auth/auth.module.ts`
- Create: `leader-sync/apps/api/src/modules/auth/auth.controller.ts`
- Create: `leader-sync/apps/api/src/modules/auth/auth.service.ts`
- Create: `leader-sync/apps/api/src/modules/auth/feishu-auth.service.ts`
- Test: `leader-sync/apps/api/src/modules/auth/__tests__/auth.service.spec.ts`

**Step 1: Write failing test for auth.service**

Test `AuthService.loginWithCode(code)`:
- Mock feishu API call
- Expect: returns JWT token
- Expect: user info stored/updated in org_cache

**Step 2: Run test — expect FAIL**

**Step 3: Implement FeishuAuthService**

- `getAppAccessToken()` — POST to `https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal`
- `getUserAccessToken(code)` — POST to `https://open.feishu.cn/open-apis/authen/v1/oidc/access_token`
- `getUserInfo(userAccessToken)` — GET `https://open.feishu.cn/open-apis/authen/v1/user_info`

**Step 4: Implement AuthService**

- `loginWithCode(code)`: calls feishu, upserts org_cache + user_role_binding, signs JWT
- `getMe(userId)`: returns user profile from org_cache + role

**Step 5: Implement AuthController**

- `POST /api/v1/auth/feishu/jsapi-auth` — body: `{ code }` → returns JWT in httpOnly cookie
- `GET /api/v1/auth/feishu/callback` — query: `code` → exchanges token, sets cookie, redirects to `/tasks`
- `GET /api/v1/auth/me` — requires auth, returns current user

**Step 6: Run tests — expect PASS**

**Step 7: Commit**

```bash
git add apps/api/src/modules/auth/
git commit -m "feat: add Feishu auth with JS-SDK and OAuth login"
```

---

## Task 7: Task CRUD Module

**Files:**
- Create: `leader-sync/apps/api/src/modules/task/task.module.ts`
- Create: `leader-sync/apps/api/src/modules/task/task.controller.ts`
- Create: `leader-sync/apps/api/src/modules/task/task.service.ts`
- Create: `leader-sync/apps/api/src/modules/task/task.repository.ts`
- Create: `leader-sync/apps/api/src/modules/task/dto/` — validation DTOs
- Test: `leader-sync/apps/api/src/modules/task/__tests__/task.service.spec.ts`
- Test: `leader-sync/apps/api/src/modules/task/__tests__/task.controller.spec.ts`

**Step 1: Write failing tests for task.service**

Test cases:
- `createTask()` — generates task_uid, auto-fills system fields, persists, writes progress log
- `getTask(taskUid)` — returns task or throws 1003
- `updateTask(taskUid, dto)` — checks version (409 if mismatch), validates state transition, increments version, writes progress log
- `completeTask(taskUid)` — validates pre-conditions (status in_progress/pending_review, no unresolved blocks), sets done + completed_at
- `assignTask(taskUid, dto)` — updates assignee fields, writes progress log
- `delayTask(taskUid, dto)` — updates due_at, writes delay_reason
- `listMyTasks(userId, query)` — filters by assignee/issuer/collaborator, paginated

**Step 2: Run tests — expect FAIL**

**Step 3: Implement task.repository.ts**

Thin wrapper around Drizzle queries:
- `insert(task)`, `findByUid(uid)`, `update(uid, version, fields)`, `listByUser(userId, filters, page)`
- `update` uses `WHERE task_uid = $uid AND version = $version` for optimistic locking — returns 0 rows if version mismatch

**Step 4: Implement task.service.ts**

Business logic layer:
- `createTask(userId, dto)`:
  - Generate task_uid via `generateTaskUid()`
  - Auto-fill: issuer_user_id = userId, assigner_user_id = userId, month_bucket from due_at, status = assigned (if assignee given) or draft, version = 1
  - Look up assignee from org_cache → fill assignee_name, leader_user_id, dept fields
  - Insert task + write progress log (source: api, new_status: draft/assigned)
- `updateTask(userId, taskUid, dto)`:
  - Load current task
  - If dto.status present → validateTransition(current.status, dto.status)
  - Attempt update with version check → throw 1009 if 0 rows affected
  - Write progress log
- `completeTask`, `assignTask`, `delayTask` — similar pattern with specific business rules

**Step 5: Implement task.controller.ts**

- Wire up 7 endpoints per api-contracts.md section 4-5
- Use `@CurrentUser()` decorator
- Validate request bodies with class-validator
- All routes behind `AuthGuard`

**Step 6: Implement validation DTOs**

Create NestJS-specific DTOs with class-validator decorators wrapping the shared-types interfaces.

**Step 7: Run tests — expect PASS**

**Step 8: Manual verification**

```bash
# Create task
curl -X POST http://localhost:3001/api/v1/tasks \
  -H "Content-Type: application/json" \
  -b "token=<jwt>" \
  -d '{"title":"测试任务","task_type":"operation","priority":"p1","assignee_user_id":"ou_test","due_at":"2026-04-01T18:00:00+08:00"}'

# Get task
curl http://localhost:3001/api/v1/tasks/<task_uid> -b "token=<jwt>"

# Update with version
curl -X PATCH http://localhost:3001/api/v1/tasks/<task_uid> \
  -H "Content-Type: application/json" \
  -b "token=<jwt>" \
  -d '{"version":1,"status":"in_progress"}'
```

**Step 9: Commit**

```bash
git add apps/api/src/modules/task/
git commit -m "feat: add task CRUD with optimistic locking and state machine"
```

---

## Task 8: Next.js Web Scaffold

**Files:**
- Create: `leader-sync/apps/web/package.json`
- Create: `leader-sync/apps/web/tsconfig.json`
- Create: `leader-sync/apps/web/next.config.ts`
- Create: `leader-sync/apps/web/tailwind.config.ts`
- Create: `leader-sync/apps/web/postcss.config.js`
- Create: `leader-sync/apps/web/src/app/layout.tsx`
- Create: `leader-sync/apps/web/src/app/globals.css`
- Create: `leader-sync/apps/web/src/lib/api-client.ts`
- Create: `leader-sync/apps/web/src/lib/feishu.ts`
- Create: `leader-sync/apps/web/src/lib/auth.ts`
- Create: `leader-sync/apps/web/src/components/ui/` — shadcn/ui components

**Step 1: Create Next.js app**

```bash
cd apps
pnpm create next-app web --typescript --tailwind --app --src-dir --no-eslint
```

Add dependencies:
- `@leader-sync/shared-types: workspace:*`
- `swr`

**Step 2: Configure next.config.ts**

- API proxy: rewrites `/api/**` → `http://localhost:3001/api/**` (dev mode)
- Output: standalone (for Docker)

**Step 3: Init shadcn/ui**

```bash
cd apps/web
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button card input select badge table dialog form label textarea
```

**Step 4: Create api-client.ts**

```typescript
import type { ApiResponse } from '@leader-sync/shared-types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  const json: ApiResponse<T> = await res.json();
  if (json.code !== 0) {
    throw new ApiError(json.code, json.message, json.trace_id);
  }
  return json.data;
}

export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public traceId: string,
  ) {
    super(message);
  }
}
```

**Step 5: Create feishu.ts — environment detection + JS-SDK**

```typescript
export function isFeishuEnv(): boolean {
  if (typeof window === 'undefined') return false;
  return /Lark|Feishu/i.test(navigator.userAgent);
}

export async function feishuLogin(): Promise<string> {
  // Dynamic import to avoid SSR issues
  const lark = await import('@open/lark-js-sdk');
  return new Promise((resolve, reject) => {
    lark.default.auth.login({
      success: (res: { code: string }) => resolve(res.code),
      fail: (err: unknown) => reject(err),
    });
  });
}
```

**Step 6: Create auth.ts — login flow orchestration**

```typescript
import { isFeishuEnv, feishuLogin } from './feishu';
import { apiFetch } from './api-client';

export async function ensureAuth(): Promise<boolean> {
  try {
    await apiFetch('/api/v1/auth/me');
    return true;
  } catch {
    if (isFeishuEnv()) {
      const code = await feishuLogin();
      await apiFetch('/api/v1/auth/feishu/jsapi-auth', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      return true;
    }
    // Browser: redirect to OAuth
    window.location.href = `/api/v1/auth/feishu/callback?redirect=${encodeURIComponent(window.location.pathname)}`;
    return false;
  }
}
```

**Step 7: Create root layout.tsx**

Basic layout with auth check, navigation shell.

**Step 8: Verify dev server starts**

```bash
pnpm --filter web dev
```

Expected: Next.js running on localhost:3000

**Step 9: Commit**

```bash
git add apps/web/
git commit -m "feat: scaffold Next.js web app with auth and API client"
```

---

## Task 9: Web Pages — Task List + Task Detail

**Files:**
- Create: `leader-sync/apps/web/src/app/(auth)/callback/page.tsx`
- Create: `leader-sync/apps/web/src/app/tasks/page.tsx`
- Create: `leader-sync/apps/web/src/app/tasks/[task_uid]/page.tsx`
- Create: `leader-sync/apps/web/src/app/tasks/create/page.tsx`
- Create: `leader-sync/apps/web/src/components/task-list.tsx`
- Create: `leader-sync/apps/web/src/components/task-detail.tsx`
- Create: `leader-sync/apps/web/src/components/task-form.tsx`
- Create: `leader-sync/apps/web/src/components/status-badge.tsx`
- Create: `leader-sync/apps/web/src/hooks/use-tasks.ts`
- Create: `leader-sync/apps/web/src/hooks/use-task.ts`

**Step 1: Create SWR hooks**

`use-tasks.ts`:
```typescript
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';
import type { PaginatedData, TaskListQuery } from '@leader-sync/shared-types';

export function useTasks(query: TaskListQuery) {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.page) params.set('page', String(query.page));
  if (query.page_size) params.set('page_size', String(query.page_size));

  return useSWR(
    `/api/v1/me/tasks?${params}`,
    (url) => apiFetch<PaginatedData<any>>(url),
  );
}
```

`use-task.ts`:
```typescript
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';

export function useTask(taskUid: string) {
  return useSWR(
    taskUid ? `/api/v1/tasks/${taskUid}` : null,
    (url) => apiFetch<any>(url),
  );
}
```

**Step 2: Create status-badge component**

Maps TaskStatus enum values to colored badges using shadcn Badge.

**Step 3: Create task list page (`/tasks`)**

- Auth check on mount (ensureAuth)
- Status filter tabs: 全部 / 进行中 / 已完成 / 已延期
- Table: 标题, 状态, 优先级, 截止时间, 负责人
- Pagination
- "新建任务" button → /tasks/create
- Row click → /tasks/[task_uid]

**Step 4: Create task detail page (`/tasks/[task_uid]`)**

- Load task via useTask hook
- Display all fields in readonly card
- Edit panel for allowed fields (status, progress, latest_progress)
- Action buttons: 提交完成, 申请延期, 指派 (conditional by role)
- All mutations carry current version for optimistic locking
- On 409 → show "数据已被修改" toast, refetch

**Step 5: Create task form (create page)**

- Form fields: title*, task_type*, priority*, assignee_user_id*, due_at*, detail, start_at, boss_attention_flag
- Submit → POST /api/v1/tasks → redirect to /tasks/[new_task_uid]

**Step 6: Create auth callback page**

- Reads code from URL query
- Calls jsapi-auth or handles OAuth redirect
- On success → redirect to /tasks

**Step 7: End-to-end manual test**

1. Start docker compose (PG + Redis)
2. Run seed
3. Start API (port 3001)
4. Start Web (port 3000)
5. Open browser → /tasks
6. Login flow triggers
7. See task list from seed data
8. Click task → see detail
9. Create new task → appears in list
10. Update status → version increments

**Step 8: Commit**

```bash
git add apps/web/src/
git commit -m "feat: add task list, task detail, and create pages"
```

---

## Task Dependency Graph

```
Task 1 (monorepo)
  ├── Task 2 (shared-types) ──┬── Task 4 (domain-core)
  │                           │
  └── Task 3 (db schema) ────┴── Task 5 (NestJS scaffold)
                                    ├── Task 6 (auth module)
                                    └── Task 7 (task CRUD) ── Task 8 (web scaffold) ── Task 9 (web pages)
```

**Parallelizable:**
- Task 2 + Task 3 (after Task 1)
- Task 4 + Task 5 (after Task 2)
- Task 8 can start as soon as Task 5 is done (doesn't need Task 7 complete for scaffold)
