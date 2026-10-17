/**
 * Agent 主动监控 Loop：设备离线事件的检测、通知、升级与恢复闭环。
 * 当前使用进程内状态模拟事件源，后续可替换为设备心跳或消息队列适配器。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runAgentWithDiagnostics } from './orchestrator.js'
import { ApiContractError } from './safety.js'
import { isEmailNotificationConfigured, sendNotificationEmail } from './notificationEmail.js'

const OFFLINE_ALERT_AFTER_MINUTES = 5
const ESCALATE_AFTER_MINUTES = 15
const HEARTBEAT_STALE_AFTER_MINUTES = 2
const STATE_FILE = process.env.AGENT_MONITOR_STATE_PATH || join(process.cwd(), 'tmp', 'agent-monitor-state.json')

const DEVICE_CATALOG = [
  {
    deviceId: 'device-A-001',
    storeId: 'A',
    storeName: '朝阳旗舰店',
    regionName: '朝阳区',
    owner: '区域经理 · 张伟',
    ownerRole: '区域经理',
  },
  {
    deviceId: 'device-B-001',
    storeId: 'B',
    storeName: '南关生活店',
    regionName: '南关区',
    owner: '门店店长 · 李明',
    ownerRole: '门店店长',
  },
  {
    deviceId: 'device-C-001',
    storeId: 'C',
    storeName: '宽城北站店',
    regionName: '宽城区',
    owner: '门店店长 · 王芳',
    ownerRole: '门店店长',
  },
  {
    deviceId: 'device-E-001',
    storeId: 'E',
    storeName: '绿园万达店',
    regionName: '绿园区',
    owner: '门店店长 · 赵强',
    ownerRole: '门店店长',
  },
]

const devices = new Map(DEVICE_CATALOG.map((device) => [device.deviceId, { ...device, status: 'online' }]))
const alerts = new Map()
const notifications = []
const loopTrace = []
let sequence = 0
let timeOffsetMs = 0

function loadPersistedState() {
  if (!existsSync(STATE_FILE)) return
  try {
    const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    sequence = Number(saved.sequence) || 0
    for (const savedDevice of saved.devices || []) {
      const device = devices.get(savedDevice.deviceId)
      if (device) Object.assign(device, savedDevice)
    }
    for (const alert of saved.alerts || []) {
      if (alert?.alertId) alerts.set(alert.alertId, alert)
    }
    notifications.push(...(Array.isArray(saved.notifications) ? saved.notifications : []))
    loopTrace.push(...(Array.isArray(saved.loopTrace) ? saved.loopTrace : []))
  } catch (error) {
    console.error('[agent-monitor-loop] state restore failed:', error?.message || error)
  }
}

function persistState() {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true })
    writeFileSync(
      STATE_FILE,
      JSON.stringify(
        {
          schemaVersion: 1,
          savedAt: new Date().toISOString(),
          sequence,
          devices: Array.from(devices.values()),
          alerts: Array.from(alerts.values()),
          notifications: notifications.slice(0, 60),
          loopTrace: loopTrace.slice(0, 80),
        },
        null,
        2,
      ),
      'utf8',
    )
  } catch (error) {
    console.error('[agent-monitor-loop] state persistence failed:', error?.message || error)
  }
}

loadPersistedState()

function nowMs() {
  return Date.now() + timeOffsetMs
}

function timestamp(ms = nowMs()) {
  return new Date(ms).toISOString()
}

function createId(prefix) {
  sequence += 1
  return `${prefix}_${Date.now().toString(36)}_${sequence.toString(36)}`
}

function addTrace(alert, node, detail = {}) {
  const event = {
    id: createId('trace'),
    alertId: alert?.alertId || null,
    deviceId: alert?.deviceId || detail.deviceId || null,
    node,
    at: timestamp(),
    detail,
  }
  loopTrace.unshift(event)
  if (loopTrace.length > 80) loopTrace.length = 80
  if (alert) alert.trace = [event, ...(alert.trace || [])]
  persistState()
  return event
}

function addNotification(alert, recipient, type, message) {
  const notification = {
    notificationId: createId('notification'),
    alertId: alert.alertId,
    recipient,
    type,
    message,
    status: 'sent',
    channel: [
      'in_app',
      process.env.AGENT_NOTIFY_WEBHOOK_URL ? 'webhook' : null,
      isEmailNotificationConfigured() ? 'qq_email' : null,
    ]
      .filter(Boolean)
      .join('+'),
    at: timestamp(),
  }
  notifications.unshift(notification)
  if (notifications.length > 60) notifications.length = 60
  alert.notificationIds = [...(alert.notificationIds || []), notification.notificationId]
  persistState()
  void deliverWebhookNotification(notification)
  void deliverEmailNotification(notification)
  return notification
}

async function deliverEmailNotification(notification) {
  if (!isEmailNotificationConfigured()) return
  try {
    const result = await sendNotificationEmail(notification)
    notification.emailStatus = result.status
    notification.emailMessageId = result.messageId || null
  } catch (error) {
    notification.emailStatus = 'failed'
    notification.emailError = error?.message || 'QQ_EMAIL_DELIVERY_FAILED'
  }
  persistState()
}

async function deliverWebhookNotification(notification) {
  const webhookUrl = process.env.AGENT_NOTIFY_WEBHOOK_URL
  if (!webhookUrl || typeof fetch !== 'function') return
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'liesen-retail-agent',
        notification,
      }),
    })
    notification.externalStatus = response.ok ? 'delivered' : 'failed'
    notification.externalStatusCode = response.status
  } catch (error) {
    notification.externalStatus = 'failed'
    notification.externalError = error?.message || 'WEBHOOK_DELIVERY_FAILED'
  }
  persistState()
}

function getDevice(deviceId) {
  const device = devices.get(String(deviceId || '').trim())
  if (!device) {
    throw new ApiContractError(404, 'DEVICE_NOT_FOUND', `未找到设备：${deviceId}`)
  }
  return device
}

function activeAlertFor(deviceId) {
  return Array.from(alerts.values()).find(
    (alert) => alert.deviceId === deviceId && !['resolved', 'dismissed'].includes(alert.status),
  )
}

function minutesOffline(alert) {
  return Math.max(0, Math.round((nowMs() - alert.offlineSinceMs) / 60000))
}

async function enrichAlertWithAgent(alert) {
  if (alert.agentTraceId || alert.agentStatus === 'running') return
  alert.agentStatus = 'running'
  addTrace(alert, 'agent.audit', { status: 'started' })
  try {
    const result = await runAgentWithDiagnostics({
      query: `核查设备 ${alert.deviceId} 离线影响并给出处置建议`,
      sessionId: `monitor_${alert.deviceId}`,
    })
    alert.agentStatus = 'completed'
    alert.agentTraceId = result?.traceId || null
    alert.agentSummary = result?.response?.summary || '已完成离线设备经营影响核查。'
    alert.agentRecommendations = Array.isArray(result?.response?.recommendations)
      ? result.response.recommendations
      : []
    alert.agentFindings = Array.isArray(result?.response?.findings) ? result.response.findings : []
    addTrace(alert, 'agent.audit', {
      status: 'completed',
      traceId: alert.agentTraceId,
      findingsCount: alert.agentFindings.length,
    })
  } catch (error) {
    alert.agentStatus = 'degraded'
    alert.agentSummary = '设备已离线，但经营影响核查暂不可用。'
    alert.agentError = error?.message || 'AGENT_AUDIT_FAILED'
    addTrace(alert, 'agent.audit', { status: 'degraded', error: alert.agentError })
  }
}

async function evaluateAlert(alert) {
  if (alert.status === 'resolved') return

  const elapsed = minutesOffline(alert)
  alert.durationMinutes = elapsed
  alert.updatedAt = timestamp()

  if (elapsed >= OFFLINE_ALERT_AFTER_MINUTES && !alert.notifiedAt) {
    alert.status = 'alerted'
    alert.severity = 'P2'
    alert.notifiedAt = timestamp()
    addTrace(alert, 'monitor.notify', {
      reason: '设备离线超过 5 分钟',
      recipient: alert.owner,
    })
    addNotification(
      alert,
      alert.owner,
      'offline_alert',
      `${alert.storeName} ${alert.deviceId} 已离线 ${elapsed} 分钟，请尽快检查通信模块。`,
    )
    void enrichAlertWithAgent(alert)
  }

  if (
    elapsed >= ESCALATE_AFTER_MINUTES &&
    !alert.escalatedAt &&
    !alert.acknowledgedAt
  ) {
    alert.status = 'escalated'
    alert.severity = 'P1'
    alert.escalatedAt = timestamp()
    addTrace(alert, 'monitor.escalate', {
      reason: '提醒后仍未确认',
      elapsedMinutes: elapsed,
      recipient: '区域运营总监',
    })
    addNotification(
      alert,
      '区域运营总监',
      'offline_escalation',
      `${alert.storeName} ${alert.deviceId} 离线已 ${elapsed} 分钟且无人确认，已升级督办。`,
    )
  }
}

async function evaluateAll() {
  await evaluateStaleHeartbeats()
  for (const alert of alerts.values()) {
    await evaluateAlert(alert)
  }
}

async function evaluateStaleHeartbeats() {
  for (const device of devices.values()) {
    if (!device.lastHeartbeatAtMs || device.status === 'offline') continue
    const staleMinutes = (nowMs() - device.lastHeartbeatAtMs) / 60000
    if (staleMinutes >= HEARTBEAT_STALE_AFTER_MINUTES) {
      await simulateDeviceOffline({
        deviceId: device.deviceId,
        durationMinutes: Math.floor(staleMinutes),
        source: 'heartbeat_timeout',
      })
    }
  }
}

export async function getMonitorOverview() {
  await evaluateAll()
  const alertList = Array.from(alerts.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const deviceList = Array.from(devices.values()).map((device) => {
    const activeAlert = activeAlertFor(device.deviceId)
    return {
      ...device,
      alertId: activeAlert?.alertId || null,
      alertStatus: activeAlert?.status || null,
      durationMinutes: activeAlert?.durationMinutes || 0,
    }
  })

  return {
    now: timestamp(),
    notificationChannels: {
      inApp: true,
      qqEmail: {
        configured: isEmailNotificationConfigured(),
        recipient: String(process.env.AGENT_NOTIFY_EMAIL_TO || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
          .map((value) => value.replace(/^(.{2}).*(@.*)$/, '$1***$2'))
          .join(', '),
      },
      webhook: Boolean(process.env.AGENT_NOTIFY_WEBHOOK_URL),
    },
    thresholds: {
      alertAfterMinutes: OFFLINE_ALERT_AFTER_MINUTES,
      escalateAfterMinutes: ESCALATE_AFTER_MINUTES,
      heartbeatStaleAfterMinutes: HEARTBEAT_STALE_AFTER_MINUTES,
    },
    devices: deviceList,
    alerts: alertList,
    notifications: notifications.slice(0, 20),
    trace: loopTrace.slice(0, 40),
    metrics: {
      monitoredDevices: deviceList.length,
      offlineDevices: deviceList.filter((device) => device.status === 'offline').length,
      activeAlerts: alertList.filter((alert) => !['resolved', 'dismissed'].includes(alert.status)).length,
      unacknowledgedAlerts: alertList.filter(
        (alert) => !alert.acknowledgedAt && !['resolved', 'dismissed'].includes(alert.status),
      ).length,
      escalatedAlerts: alertList.filter((alert) => alert.status === 'escalated').length,
      notificationsSent: notifications.length,
    },
  }
}

export async function simulateDeviceOffline({ deviceId = 'device-B-001', durationMinutes = 0, source = 'manual_demo' } = {}) {
  const device = getDevice(deviceId)
  const existing = activeAlertFor(device.deviceId)
  if (existing) {
    const requestedMinutes = Math.max(0, Number(durationMinutes) || 0)
    if (requestedMinutes > existing.durationMinutes) {
      existing.offlineSinceMs = nowMs() - requestedMinutes * 60000
      existing.updatedAt = timestamp()
      existing.source = source
      await evaluateAlert(existing)
    }
    return getMonitorOverview()
  }

  const alert = {
    alertId: createId('alert'),
    eventId: createId('event'),
    dedupeKey: `device-offline:${device.deviceId}`,
    eventType: 'device_offline',
    source,
    deviceId: device.deviceId,
    storeId: device.storeId,
    storeName: device.storeName,
    regionName: device.regionName,
    owner: device.owner,
    ownerRole: device.ownerRole,
    status: 'detected',
    severity: 'P3',
    offlineSinceMs: nowMs() - Math.max(0, Number(durationMinutes) || 0) * 60000,
    detectedAt: timestamp(),
    updatedAt: timestamp(),
    acknowledgedAt: null,
    notifiedAt: null,
    escalatedAt: null,
    resolvedAt: null,
    durationMinutes: Math.max(0, Number(durationMinutes) || 0),
    trace: [],
    notificationIds: [],
    agentStatus: 'pending',
    agentTraceId: null,
    agentFindings: [],
    agentRecommendations: [],
  }
  alerts.set(alert.alertId, alert)
  device.status = 'offline'
  device.updatedAt = timestamp()
  persistState()
  addTrace(alert, 'monitor.detect', {
    eventType: 'device_offline',
    dedupeKey: alert.dedupeKey,
    durationMinutes: alert.durationMinutes,
  })
  await evaluateAlert(alert)
  return getMonitorOverview()
}

export async function receiveDeviceHeartbeat({ deviceId, status = 'online', observedAt } = {}) {
  const device = getDevice(deviceId)
  const heartbeatAtMs = observedAt ? Date.parse(observedAt) : nowMs()
  if (!Number.isFinite(heartbeatAtMs)) {
    throw new ApiContractError(400, 'INVALID_HEARTBEAT', 'observedAt 必须是有效的 ISO 时间。')
  }
  device.lastHeartbeatAtMs = heartbeatAtMs
  device.lastHeartbeatAt = timestamp(heartbeatAtMs)
  device.lastHeartbeatStatus = status
  device.updatedAt = timestamp()

  if (status === 'offline') {
    return simulateDeviceOffline({
      deviceId: device.deviceId,
      durationMinutes: Math.max(0, Math.floor((nowMs() - heartbeatAtMs) / 60000)),
      source: 'iot_heartbeat',
    })
  }

  if (status !== 'online') {
    throw new ApiContractError(400, 'INVALID_HEARTBEAT_STATUS', 'status 只能是 online 或 offline。')
  }

  const activeAlert = activeAlertFor(device.deviceId)
  if (activeAlert) return recoverDevice({ alertId: activeAlert.alertId })
  device.status = 'online'
  persistState()
  return getMonitorOverview()
}

export async function acknowledgeDeviceAlert({ alertId } = {}) {
  const alert = alerts.get(alertId)
  if (!alert) {
    throw new ApiContractError(404, 'ALERT_NOT_FOUND', `未找到告警：${alertId}`)
  }
  if (alert.status === 'resolved') return getMonitorOverview()
  alert.acknowledgedAt = timestamp()
  alert.updatedAt = timestamp()
  if (alert.status !== 'escalated') alert.status = 'acknowledged'
  addTrace(alert, 'monitor.acknowledge', { by: '区域运营总监' })
  addNotification(alert, alert.owner, 'acknowledged', `已确认 ${alert.deviceId} 离线告警，进入现场排查。`)
  return getMonitorOverview()
}

export async function recoverDevice({ deviceId, alertId } = {}) {
  const alert = alertId ? alerts.get(alertId) : activeAlertFor(deviceId)
  if (!alert) {
    throw new ApiContractError(404, 'ALERT_NOT_FOUND', `未找到设备的活动告警：${deviceId || alertId}`)
  }
  const device = getDevice(alert.deviceId)
  device.status = 'online'
  device.updatedAt = timestamp()
  alert.status = 'resolved'
  alert.resolvedAt = timestamp()
  alert.updatedAt = timestamp()
  alert.resolution = `设备恢复在线，累计离线 ${minutesOffline(alert)} 分钟。`
  addTrace(alert, 'monitor.resolve', {
    durationMinutes: minutesOffline(alert),
    resolution: alert.resolution,
  })
  addNotification(alert, alert.owner, 'device_recovered', `${alert.storeName} ${alert.deviceId} 已恢复在线，告警自动结案。`)
  persistState()
  return getMonitorOverview()
}

export async function advanceMonitorClock({ minutes = 5 } = {}) {
  const increment = Math.max(1, Math.min(24 * 60, Number(minutes) || 5))
  timeOffsetMs += increment * 60000
  await evaluateAll()
  return getMonitorOverview()
}

export async function resetMonitorLoop() {
  alerts.clear()
  notifications.splice(0, notifications.length)
  loopTrace.splice(0, loopTrace.length)
  timeOffsetMs = 0
  sequence = 0
  for (const device of devices.values()) {
    device.status = 'online'
    delete device.updatedAt
    delete device.lastHeartbeatAt
    delete device.lastHeartbeatAtMs
    delete device.lastHeartbeatStatus
  }
  persistState()
  return getMonitorOverview()
}

const monitorTimer = setInterval(() => {
  evaluateAll().catch((error) => {
    console.error('[agent-monitor-loop] evaluation failed:', error?.message || error)
  })
}, 5000)
monitorTimer.unref?.()

