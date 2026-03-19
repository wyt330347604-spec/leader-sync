# 部署方案草案

## 1. 目标

定义本项目的起步部署方式，优先考虑低复杂度、可维护、可平滑升级。

## 2. 推荐部署模式

### 起步模式
- 1 台 ECS
- Docker Compose
- Nginx/Caddy 反向代理
- API、Web、Worker、PostgreSQL、Redis 同机部署

### 增强模式
- 应用独立 ECS
- PostgreSQL 使用 RDS
- Redis 独立托管
- OSS 负责备份与归档

## 3. 容器建议

- `web`
- `api`
- `worker`
- `postgres`
- `redis`
- `nginx` 或 `caddy`

## 4. 发布流程

1. 合并代码到主分支
2. 执行测试
3. 构建镜像
4. 备份数据库
5. 执行 migration
6. 滚动重启服务
7. 验证健康检查
8. 验证飞书回调

## 5. 健康检查

- `/healthz`：进程存活
- `/readyz`：依赖已就绪
- 数据库连接检查
- Redis 连接检查
- 飞书 token 获取检查

## 6. 回滚策略

- 应用版本回滚
- migration 需具备回退策略
- 发布前强制数据库备份
- 关键环境变量变更必须留档
