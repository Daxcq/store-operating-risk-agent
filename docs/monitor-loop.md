# Agent 主动监控 Loop

## 目的

主动监控 Loop 将设备心跳或离线事件转换为可追踪的告警闭环：检测、通知、升级、确认和恢复结案。它与用户主动发起的 `/api/v1/agent/run` 问答链路分开运行，设备事件可以在没有用户提问时唤醒 Agent 审计。

## 状态机

```text
detected --(离线达到 5 分钟)--> alerted
alerted --(负责人确认)--------> acknowledged
alerted --(15 分钟未确认)-----> escalated
acknowledged ------------------> resolved  (设备恢复)
escalated ---------------------> resolved  (设备恢复)
```

- 同一设备只能存在一个未结案的离线告警，重复事件按 `device-offline:{deviceId}` 去重。
- 5 分钟后发送第一条负责人通知；15 分钟仍未确认时发送升级通知。
- 告警进入通知阶段后，会异步调用现有 Agent 审计链路，结果保存在告警的 `agentSummary`、`agentFindings` 和 `agentTraceId` 中。
- 已确认告警不会因为后续检查再次升级；恢复事件会记录离线时长并自动结案。

## API

### `GET /api/v1/agent/monitor`

返回设备、告警、通知、Loop Trace 和聚合指标。

### `POST /api/v1/agent/monitor/event`

注入离线事件，用于事件适配器和本地演示。

```json
{
  "deviceId": "device-B-001",
  "durationMinutes": 0,
  "source": "iot_heartbeat"
}
```

### `POST /api/v1/agent/monitor/heartbeat`

接收设备心跳。`status` 只能是 `online` 或 `offline`，`observedAt` 可选且必须是 ISO 时间。设备首次上报在线心跳后，连续 2 分钟没有新的心跳会被判定为离线。

```json
{
  "deviceId": "device-C-001",
  "status": "online",
  "observedAt": "2026-10-17T04:00:00.000Z"
}
```

### `POST /api/v1/agent/monitor/acknowledge`

确认告警：`{ "alertId": "alert_..." }`。

### `POST /api/v1/agent/monitor/recover`

模拟或接收设备恢复：`{ "alertId": "alert_..." }`，也可使用 `{ "deviceId": "device-B-001" }`。

### `POST /api/v1/agent/monitor/advance`

仅用于本地演示推进时间：`{ "minutes": 5 }`。生产环境不应使用该接口。

### `POST /api/v1/agent/monitor/reset`

清空本地演示状态。

错误响应遵循项目统一格式，例如未知设备返回 `404 DEVICE_NOT_FOUND`，未知告警返回 `404 ALERT_NOT_FOUND`。

## 持久化和通知

- 默认状态写入 `tmp/agent-monitor-state.json`，因此服务重启后会恢复设备状态、告警、通知和 Loop Trace。可用 `AGENT_MONITOR_STATE_PATH` 覆盖路径。
- 通知默认写入站内通知列表。设置 `AGENT_NOTIFY_WEBHOOK_URL` 后，会异步向该 Webhook 发送 JSON 通知；发送结果记录在 `externalStatus`。该适配器不是短信或企业微信 SDK，接入真实渠道时应在 Webhook 后端完成鉴权、签名和重试。
- 可选接入 QQ 邮箱 SMTP：设置 `QQ_SMTP_USER`、`QQ_SMTP_AUTH_CODE` 和 `AGENT_NOTIFY_EMAIL_TO`（多个收件人用逗号分隔）。默认使用 `smtp.qq.com:465` 的 SSL 连接，邮件发送是异步的，结果记录在 `emailStatus` 和 `emailMessageId`。QQ 邮箱必须先在设置中开启 SMTP 并生成授权码，不能使用登录密码。
- 当前设备目录、负责人和进程内定时检查仍是本地 Demo 实现，尚未连接真实 IoT 网关、消息队列或数据库。生产化时应将心跳入口接入鉴权后的设备网关，并把状态存储迁移到持久化数据库。

## 回归验证

```bash
npm run test:monitor-loop
```

该脚本覆盖事件去重、5 分钟通知、15 分钟升级、确认、恢复结案、心跳超时、状态重启恢复及非法设备/告警错误分支。

