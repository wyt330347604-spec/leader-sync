# 域名、SSL 与基础设施准备

## 1. 目标

为本项目以及后续类似内部小项目准备统一可复用的基础设施，包括：

- 域名策略
- 服务器购买
- HTTPS 证书
- DNS 解析
- 安全组
- 备份与监控

## 2. 域名策略

### 2.1 主域名原则
建议由公司主体持有一个主域名，例如：

- `yourcompany.com`
- `yourcompany.cn`

后续小项目统一使用二级域名，而不是每个项目单独买一个主域名。

### 2.2 二级域名建议

- `app.yourcompany.com`：网页应用
- `api.yourcompany.com`：后端 API
- `callback.yourcompany.com`：飞书事件/卡片回调
- `admin.yourcompany.com`：管理后台
- `status.yourcompany.com`：状态页（可选）

### 2.3 购买注意事项

- 域名注册主体建议使用公司
- 打开自动续费
- 注册邮箱必须长期可用
- 开启账号双重验证
- 完成实名验证
- 记录续费负责人与交接方式

## 3. 服务器策略

### 3.1 起步方案（建议）
- 1 台阿里云 ECS
- Ubuntu LTS
- 2 vCPU / 4GB RAM 起步
- 系统盘 40GB 起
- 公网 IP
- Docker Compose 部署

### 3.2 长期方案（扩展）
- ECS 跑 API / Worker / Web
- RDS PostgreSQL
- Redis
- OSS 存备份
- 可选负载均衡

## 4. HTTPS 证书

### 要求
- 全站强制 HTTPS
- 所有飞书回调域名必须可安全访问
- 证书有效期、续期责任人、安装位置需文档化

### 建议
- 起步可以使用自动化证书方案
- 若使用商用证书，必须记录到期日
- 续期后需验证回调与主站是否正常

## 5. DNS 规划

建议记录以下解析：

| 主机记录 | 目标 | 用途 |
|---|---|---|
| app | ECS/SLB | 网页应用 |
| api | ECS/SLB | 后端接口 |
| callback | ECS/SLB | 飞书回调 |
| admin | ECS/SLB | 管理后台 |

建议：
- 预发布或灰度时适当下调 TTL
- 生产切换前做回调联通性验证

## 6. 安全组建议

### 对公网开放
- 80
- 443

### 限制来源
- 22（SSH）仅允许管理员固定 IP

### 禁止公网暴露
- PostgreSQL 端口
- Redis 端口
- 内部管理端口

## 7. 部署基础组件

- Nginx / Caddy
- Docker / Docker Compose
- PostgreSQL
- Redis
- API 服务
- Worker 服务
- Web 服务
- 结构化日志

## 8. 备份策略

### 数据库
- 每日自动备份
- 保留最近 7 / 30 / 90 天快照
- 备份到 OSS 或异地存储

### 应用配置
- `.env` 加密存储
- Nginx/Caddy 配置备份
- 数据库 migration 版本管理

## 9. 运维检查清单

上线前至少确认：

- [ ] 域名已实名认证
- [ ] DNS 已生效
- [ ] HTTPS 可访问
- [ ] 回调地址公网可访问
- [ ] 安全组收敛完成
- [ ] 数据库不暴露公网
- [ ] 日志路径和备份策略明确
- [ ] 告警通道可用
- [ ] 证书到期提醒已配置

## 10. 面向后续项目的复用建议

建议把当前项目沉淀为一套可复制基础底座：

- 统一域名策略
- 统一服务器基座
- 统一 Docker 模板
- 统一 Nginx / Caddy 模板
- 统一飞书回调处理模板
- 统一 PostgreSQL / Redis / 备份模板
