# 回调契约草案

## 1. 目标

统一定义飞书事件回调、卡片回调、内部 webhook 的接收、验签、幂等和处理流程。

## 2. 统一流程

1. 接收回调请求
2. 校验签名 / token
3. 解析 source_type 与 source_event_id
4. 写入 inbound_event 表
5. 返回 200 接受受理
6. 后台异步处理业务逻辑

## 3. 回调元数据

所有回调进入系统后统一转成内部格式：

```json
{
  "source_type": "bitable|task|calendar|card",
  "source_event_id": "evt_xxx",
  "source_object_id": "obj_xxx",
  "occurred_at": "2026-03-17T10:00:00+08:00",
  "trace_id": "tr_xxx",
  "payload": {}
}
```

## 4. 回调域名

业务 API 和飞书回调分域名：
- 飞书事件回调：`https://callback.example.com/feishu/events`
- 卡片回调：`https://callback.example.com/feishu/cards`
- 日历回调：`https://callback.example.com/feishu/calendar/events`

## 5. 卡片回调

### 要求
- 3 秒内返回受理结果
- 回调中必须带 operator 信息
- 所有交互按钮必须携带 task_uid 或可映射对象 ID

### 常见动作
- 标记完成
- 更新进展
- 申请延期
- 查看详情
- 重新同步

## 6. 多维表格回调

### 注意事项
- 仅以真实字段变更作为触发依据
- 公式字段变化不作为回调源
- 回调到中心主档后需做字段主权判断

## 7. 日历回调

- 只接受已绑定 calendar_event_id 的对象
- 若事件无映射关系，进入异常队列
- 若变更字段不属于双向字段，则只记日志不回写业务主档

## 8. 幂等规则

- `source_event_id` 唯一
- 若无 `source_event_id`，则生成 `(source_type + object_id + hash(payload))`
- 同一事件重复到达时直接丢弃业务处理，但保留访问日志

## 9. 安全要求

- 验签失败直接拒绝
- 记录来源 IP、UA、签名状态
- 原始 payload 落库归档，便于审计和回放
