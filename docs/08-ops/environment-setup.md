# 环境准备清单

## 1. 目标

定义本项目从本地开发到生产环境所需的账户、服务和配置项。

## 2. 基础准备

### 必备账号
- 飞书开放平台管理员账号
- 阿里云账号
- 域名注册/管理账号
- SSL 证书管理账号

### 必备资源
- 1 个域名
- 1 台服务器
- HTTPS 证书
- PostgreSQL
- Redis
- 对象存储 OSS（建议）

## 3. 环境分层

### 本地开发
- `.env.local`
- Mock 飞书回调
- 本地 PostgreSQL/Redis 或 Docker Compose

### 测试环境
- 独立回调域名
- 独立数据库
- 独立飞书应用或测试配置

### 生产环境
- 独立域名或二级域名
- 正式飞书应用配置
- 正式数据库与备份

## 4. 环境变量建议

- `APP_ENV`
- `APP_BASE_URL`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_VERIFICATION_TOKEN`
- `FEISHU_ENCRYPT_KEY`
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `OSS_BUCKET`
- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`

## 5. 交付前检查

- 域名解析完成
- HTTPS 可用
- 回调地址公网可达
- 服务器时间同步
- PostgreSQL 自动备份已启用
- Redis 持久化策略已确认
