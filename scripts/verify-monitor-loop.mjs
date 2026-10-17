import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

process.env.AGENT_MONITOR_STATE_PATH = join(process.cwd(), 'tmp', 'monitor-loop-regression.json')

const { handleApiRequest } = await import('../src/server/api.js')

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

async function request(method, url, payload) {
  const result = await handleApiRequest({
    method,
    url,
    body: payload === undefined ? '' : JSON.stringify(payload),
  })
  return result
}

async function main() {
  console.log('=== Agent monitor loop regression ===')

  await request('POST', '/api/v1/agent/monitor/reset')

  let result = await request('POST', '/api/v1/agent/monitor/event', {
    deviceId: 'device-B-001',
    durationMinutes: 0,
  })
  assert(result.status === 200, 'offline event should be accepted')
  assert(result.body.alerts.length === 1, 'first offline event should create one alert')
  assert(result.body.alerts[0].status === 'detected', 'alert should wait for the five-minute threshold')
  assert(result.body.notifications.length === 0, 'no notification should be sent before five minutes')

  result = await request('POST', '/api/v1/agent/monitor/event', {
    deviceId: 'device-B-001',
    durationMinutes: 0,
  })
  assert(result.body.alerts.length === 1, 'duplicate offline event should be deduplicated')

  result = await request('POST', '/api/v1/agent/monitor/advance', { minutes: 5 })
  assert(result.body.alerts[0].status === 'alerted', 'five minutes should send the first notification')
  assert(result.body.notifications.filter((item) => item.type === 'offline_alert').length === 1, 'one offline notification expected')

  result = await request('POST', '/api/v1/agent/monitor/advance', { minutes: 10 })
  assert(result.body.alerts[0].status === 'escalated', 'fifteen unacknowledged minutes should escalate')
  assert(result.body.notifications.filter((item) => item.type === 'offline_escalation').length === 1, 'one escalation expected')

  const alertId = result.body.alerts[0].alertId
  result = await request('POST', '/api/v1/agent/monitor/acknowledge', { alertId })
  assert(result.status === 200, 'valid acknowledgement should succeed')
  assert(result.body.alerts[0].acknowledgedAt, 'acknowledgement timestamp should be recorded')
  assert(result.body.metrics.unacknowledgedAlerts === 0, 'acknowledged alert should leave the unacknowledged queue')

  result = await request('POST', '/api/v1/agent/monitor/recover', { alertId })
  assert(result.body.alerts[0].status === 'resolved', 'online recovery should close the alert')
  assert(result.body.metrics.offlineDevices === 0, 'recovered device should be online')
  assert(result.body.notifications.some((item) => item.type === 'device_recovered'), 'recovery notification expected')

  result = await request('POST', '/api/v1/agent/monitor/event', { deviceId: 'unknown-device' })
  assert(result.status === 404 && result.body.error.code === 'DEVICE_NOT_FOUND', 'unknown device should return 404')

  result = await request('POST', '/api/v1/agent/monitor/acknowledge', { alertId: 'unknown-alert' })
  assert(result.status === 404 && result.body.error.code === 'ALERT_NOT_FOUND', 'unknown alert should return 404')

  await request('POST', '/api/v1/agent/monitor/reset')
  result = await request('POST', '/api/v1/agent/monitor/heartbeat', {
    deviceId: 'device-C-001',
    status: 'online',
  })
  assert(result.status === 200, 'online heartbeat should be accepted')
  assert(result.body.devices.find((device) => device.deviceId === 'device-C-001').lastHeartbeatStatus === 'online', 'heartbeat status should be stored')

  result = await request('POST', '/api/v1/agent/monitor/advance', { minutes: 2 })
  assert(result.body.alerts.some((alert) => alert.source === 'heartbeat_timeout'), 'stale heartbeat should create an offline event')

  result = await request('POST', '/api/v1/agent/monitor/heartbeat', {
    deviceId: 'device-C-001',
    status: 'online',
  })
  assert(result.body.alerts.some((alert) => alert.status === 'resolved'), 'online heartbeat should recover an active alert')

  await request('POST', '/api/v1/agent/monitor/event', {
    deviceId: 'device-A-001',
    durationMinutes: 5,
  })
  const persistedCheck = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', "import { getMonitorOverview } from './src/agent/monitorLoop.js'; const state = await getMonitorOverview(); console.log(state.metrics.activeAlerts)"],
    {
      cwd: process.cwd(),
      env: { ...process.env, AGENT_MONITOR_STATE_PATH: process.env.AGENT_MONITOR_STATE_PATH },
      encoding: 'utf8',
    },
  )
  assert(persistedCheck.status === 0, 'monitor state should be readable after a process restart')
  assert(persistedCheck.stdout.trim() === '1', 'active alert should survive a process restart')

  await request('POST', '/api/v1/agent/monitor/reset')

  console.log('Passed: dedupe, five-minute notify, fifteen-minute escalation, acknowledgement, recovery, heartbeat timeout, persistence, and error branches.')
}

await main()

