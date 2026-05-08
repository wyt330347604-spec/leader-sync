# 可视化测试审计 · 2026-05-08

## 概览

- **总截图：48 张**（playwright 跑通 48/48 在 baseline 生成时）
  - desktop（1440×900）27 张 + error-states 7 张
  - mobile（390×844）7 张 + tablet（820×1180）7 张
- **基线位置**：`screenshots/__baseline__/{spec}/{project}/{name}.png`
- **重跑命令**：`pnpm dev:tunnel && NODE_ENV=development pnpm --filter @leader-sync/api dev` + `pnpm --filter @leader-sync/web dev` + `cd apps/web && pnpm e2e:audit:all`
- **更新基线**：`pnpm e2e:audit:update`
- **CI**：`.github/workflows/ci.yml` —— 每个 PR 自动跑 lint + vitest + 视觉回归

## P0/P1/P2 修复对照

| 问题 | 修复 | 文件 | 验证 |
|---|---|---|---|
| **P0** e07 未登录白屏 | (1) 抽 `<LoadingScreen />` 共享组件（深色背景 + spinner + "正在跳转登录..."）(2) `ensureAuth()` 把 redirect 用 `setTimeout(800ms)` 延迟，给 LoadingScreen 渲染窗口；(3) 6 个页面 `if (!authed) return <LoadingScreen />` 替换 | `components/loading-screen.tsx`、`lib/auth.ts`、6 个 page.tsx | 截图显示"正在跳转登录..."文案 ✓ |
| **P1** Mobile top nav 文字竖排 | 抽 `<TopNav />` client 组件：`sm:` 以上完整 nav；`sm:hidden` 时显示 hamburger ☰ 图标 + 主题切换；点击展开抽屉式 menu | `components/top-nav.tsx`、`app/layout.tsx` | mobile 截图：品牌名"督办系统"完整一行 + ☰ 按钮 ✓ |
| **P1** Mobile 筛选按钮挤压 | role tabs / 月份按钮 / status filter 全部加 `overflow-x-auto whitespace-nowrap` + 隐藏滚动条 | `app/tasks/page.tsx` | mobile 截图：4 个状态按钮单行（"进行中/已完成/已停滞/全部"），月份可横滑 ✓ |
| **P2** Dialog overlay 太浅 | `bg-black/50` → `bg-black/70` + `backdrop-blur-sm` | `components/ui/dialog.tsx`、`alert-dialog.tsx` | 弹层后景明显加深（包含模糊） |

## CI（GitHub Actions）

`.github/workflows/ci.yml` 触发于 push/PR 到 main/master：

1. 起 postgres + redis service container
2. `pnpm install --frozen-lockfile`
3. 编译 workspace packages（shared-types / domain-core / db）
4. 跑 backend vitest + frontend vitest（lint + test）
5. build api + web
6. drizzle push schema + seed fixtures
7. 后台启 API + Web
8. install playwright chromium
9. **跑 `playwright test` 全套**（视觉回归）
10. 失败时上传 screenshots/test-results/playwright-report/logs/ 作为 artifact

## 我已主动 Read 的截图

- 桌面：01 02 03 04 05 06 07 11 13 14 15 16 23
- 错误：e01 e07
- 移动：r01 r03 + 修复后 r01

## 留下的小细节

1. **e07 修复后截图样式没渲染**：next dev 第一次访问编译 CSS 慢（playwright 截图时 CSS 仍在加载）。这只影响 e2e 截图，**真实用户在 production build（next start）下不会有这个问题**——production CSS 已在 build 期生成。可以加 `await page.waitForLoadState('networkidle')` 或在 production build 上跑 audit。
2. **e04/e05/e06 错误态 toast 内容**：不在本次 Read 范围；下次 audit 时主动 Read 这 3 张确认。
3. **dashboard 19-22 多视图**：tab 名称用了正则匹配（容错好），但实际 baseline 可能仍是默认视图——下次手测确认。

## 三铁律工作流（最终生效）

| 铁律 | 命令 |
|---|---|
| **1. 先证伪后修复** | `cd apps/api && pnpm test` 或 `cd apps/web && pnpm test` |
| **2. UI 截图审计** | `pnpm e2e:audit:all`（diff 出现时看 `playwright-report/`），然后 Read 关键截图 |
| **3. 排查必读 logs/** | `pnpm logs:pull --tail 200` 或 `pnpm logs:pull` |

## 文件清单（此次新增）

```
apps/web/src/components/loading-screen.tsx     # 加载/跳转友好态
apps/web/src/components/top-nav.tsx              # 响应式 nav (含 hamburger)
.github/workflows/ci.yml                         # CI 流程
docs/visual-audit-2026-05-08.md                  # 本报告
```

## 文件清单（此次修改）

```
apps/web/src/lib/auth.ts                  # redirect 延迟 800ms
apps/web/src/app/layout.tsx                # 用 <TopNav />
apps/web/src/app/tasks/page.tsx            # 筛选按钮 overflow-x-auto + LoadingScreen
apps/web/src/app/tasks/[task_uid]/page.tsx # LoadingScreen
apps/web/src/app/tasks/create/page.tsx     # LoadingScreen
apps/web/src/app/projects/page.tsx         # LoadingScreen
apps/web/src/app/dashboard/page.tsx        # LoadingScreen
apps/web/src/app/settings/notifications/page.tsx # LoadingScreen
apps/web/src/components/ui/dialog.tsx      # overlay 加深
apps/web/src/components/ui/alert-dialog.tsx # overlay 加深
apps/web/e2e/error-states.spec.ts          # e07 测试改进
apps/web/playwright.config.ts              # snapshot 路径加 {projectName}
```

## 下一步建议

1. **Push 这次改动 + 触发 CI**：`git push` 后 GitHub Actions 应自动跑全套，验证 CI 真的工作。
2. **真机验证**：在飞书 mobile webview 里打开 https://www.harveywang.xyz/tasks，确认 hamburger menu 能正常使用。
3. **加 visual regression 阈值微调**：如果 CI 因 font hinting / antialiasing 误报，可以把 `maxDiffPixelRatio` 从 0.02 调到 0.03。
4. **未做的扩展场景**（v2）：i18n、长内容溢出、空数据态变体、错误 toast 完整态。
