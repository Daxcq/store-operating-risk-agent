import React, { useEffect, useState } from 'react'
import { BellRing, Check, Clock3, RotateCcw, Siren, Wifi, WifiOff, Zap } from 'lucide-react'

const STATUS_LABELS = {
  detected: '已检测',
  alerted: '已提醒',
  acknowledged: '已确认',
  escalated: '已升级',
  resolved: '已恢复',
}

const STATUS_TONES = {
  detected: 'neutral',
  alerted: 'warning',
  acknowledged: 'info',
  escalated: 'danger',
  resolved: 'success',
}

function timeLabel(value) {
  if (!value) return '--'
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status || '待处理'
}

export function AgentLoopPanel() {
  const [overview, setOverview] = useState(null)
  const [selectedDevice, setSelectedDevice] = useState('device-B-001')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const fetchOverview = async () => {
    try {
      const response = await fetch('/api/v1/agent/monitor')
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error?.message || '监控状态读取失败')
      setOverview(data)
      setError(null)
    } catch (err) {
      setError(err?.message || '监控状态读取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchOverview()
    const timer = window.setInterval(fetchOverview, 5000)
    return () => window.clearInterval(timer)
  }, [])

  const callLoop = async (path, payload = {}) => {
    setBusy(true)
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error?.message || '监控动作执行失败')
      setOverview(data)
      setError(null)
    } catch (err) {
      setError(err?.message || '监控动作执行失败')
    } finally {
      setBusy(false)
    }
  }

  if (loading && !overview) {
    return <div className="loop-empty">正在连接 Agent 监控 Loop…</div>
  }

  const metrics = overview?.metrics || {}
  const alerts = overview?.alerts || []
  const devices = overview?.devices || []
  const trace = overview?.trace || []
  const notifications = overview?.notifications || []
  const notificationChannels = overview?.notificationChannels || {}

  return (
    <div className="loop-root">
      <div className="loop-header">
        <div>
          <span className="eyebrow">AGENT LOOP // EVENT-DRIVEN OPERATIONS</span>
          <h4>主动监控与行动闭环</h4>
          <p>设备事件进入后，Agent 会自动补充审计证据、提醒负责人、按 SLA 升级，并在恢复时结案。</p>
        </div>
        <div className="loop-live-state">
          <span className="loop-live-dot" />
          <strong>Heartbeat 在线</strong>
          <small>{timeLabel(overview?.now)} · 5 秒刷新</small>
        </div>
      </div>

      <div className="loop-metrics">
        <div className="loop-metric-card">
          <span>监控设备</span>
          <strong>{metrics.monitoredDevices || 0}</strong>
          <small>设备心跳事件源</small>
        </div>
        <div className="loop-metric-card warning">
          <span>当前离线</span>
          <strong>{metrics.offlineDevices || 0}</strong>
          <small>检测到离线状态</small>
        </div>
        <div className="loop-metric-card danger">
          <span>未闭环告警</span>
          <strong>{metrics.unacknowledgedAlerts || 0}</strong>
          <small>等待确认或处理</small>
        </div>
        <div className="loop-metric-card info">
          <span>已发送通知</span>
          <strong>{metrics.notificationsSent || 0}</strong>
          <small>站内通知记录</small>
        </div>
      </div>

      <div className="loop-control-card">
        <div className="loop-control-copy">
          <span className="section-label">事件模拟器</span>
          <strong>让 Agent 进入下一次循环</strong>
          <small>离线事件即时提醒 · 未确认 {overview?.thresholds?.escalateAfterMinutes ?? 15} 分钟后升级</small>
        </div>
        <select
          aria-label="选择要模拟的设备"
          value={selectedDevice}
          onChange={(event) => setSelectedDevice(event.target.value)}
          disabled={busy}
        >
          {devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.storeName} · {device.deviceId}
            </option>
          ))}
        </select>
        <div className="loop-action-row">
          <button type="button" className="primary-button" onClick={() => callLoop('/api/v1/agent/monitor/event', { deviceId: selectedDevice, durationMinutes: 0 })} disabled={busy}>
            <WifiOff size={15} /> 模拟离线
          </button>
          <button type="button" className="outline-button" onClick={() => callLoop('/api/v1/agent/monitor/event', { deviceId: selectedDevice, durationMinutes: 6 })} disabled={busy}>
            <BellRing size={15} /> 进入提醒阈值
          </button>
          <button type="button" className="outline-button" onClick={() => callLoop('/api/v1/agent/monitor/event', { deviceId: selectedDevice, durationMinutes: 16 })} disabled={busy}>
            <Siren size={15} /> 进入升级阈值
          </button>
          <button type="button" className="secondary-button" onClick={() => callLoop('/api/v1/agent/monitor/advance', { minutes: 5 })} disabled={busy || !alerts.some((alert) => alert.status !== 'resolved')}>
            <Clock3 size={15} /> 推进 5 分钟
          </button>
          <button type="button" className="secondary-button" onClick={() => callLoop('/api/v1/agent/monitor/reset')} disabled={busy}>
            <RotateCcw size={15} /> 重置演示
          </button>
        </div>
        {error && <div className="loop-error">{error}</div>}
        <div className="loop-channel-status">
          <span className="section-label">通知渠道</span>
          <span className="loop-channel-chip active">站内通知</span>
          <span className={`loop-channel-chip ${notificationChannels.qqEmail?.configured ? 'active' : ''}`}>
            QQ 邮箱 {notificationChannels.qqEmail?.configured ? `已连接 · ${notificationChannels.qqEmail.recipient}` : '未配置'}
          </span>
          {notificationChannels.webhook && <span className="loop-channel-chip active">Webhook 已连接</span>}
        </div>
      </div>

      <div className="loop-grid">
        <section className="loop-section">
          <div className="loop-section-head">
            <div>
              <span className="section-label">ACTIVE EVENTS</span>
              <h5>设备事件与告警状态</h5>
            </div>
            <span className="wb-badge info">{alerts.length} 条事件</span>
          </div>
          {alerts.length === 0 ? (
            <div className="loop-empty compact">暂无活动事件，先模拟一台设备离线。</div>
          ) : (
            <div className="loop-alert-list">
              {alerts.map((alert) => (
                <article key={alert.alertId} className={`loop-alert-card ${STATUS_TONES[alert.status] || 'neutral'}`}>
                  <div className="loop-alert-topline">
                    <div className="loop-alert-title">
                      {alert.status === 'resolved' ? <Wifi size={16} /> : <WifiOff size={16} />}
                      <strong>{alert.storeName}</strong>
                      <span className="wb-mono">{alert.deviceId}</span>
                    </div>
                    <span className={`loop-status ${STATUS_TONES[alert.status] || 'neutral'}`}>
                      {statusLabel(alert.status)} · {alert.severity}
                    </span>
                  </div>
                  <div className="loop-alert-meta">
                    <span>离线 {alert.durationMinutes} 分钟</span>
                    <span>负责人：{alert.owner}</span>
                    <span>事件：{timeLabel(alert.detectedAt)}</span>
                  </div>
                  <p className="loop-alert-summary">
                    {alert.agentSummary || (alert.agentStatus === 'running'
                      ? 'Agent 正在补充设备经营影响和审计证据…'
                      : '等待 Agent 补充经营影响核查。')}
                  </p>
                  {alert.agentRecommendations?.length > 0 && (
                    <div className="loop-recommendation">建议：{alert.agentRecommendations[0]}</div>
                  )}
                  <div className="loop-alert-actions">
                    {alert.status !== 'resolved' && !alert.acknowledgedAt && (
                      <button type="button" className="outline-button" onClick={() => callLoop('/api/v1/agent/monitor/acknowledge', { alertId: alert.alertId })} disabled={busy}>
                        <Check size={14} /> 确认告警
                      </button>
                    )}
                    {alert.status !== 'resolved' && (
                      <button type="button" className="primary-button" onClick={() => callLoop('/api/v1/agent/monitor/recover', { alertId: alert.alertId })} disabled={busy}>
                        <Wifi size={14} /> 模拟恢复
                      </button>
                    )}
                    {alert.agentTraceId && <span className="wb-mono">Agent trace: {alert.agentTraceId}</span>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="loop-section loop-side-section">
          <div className="loop-section-head">
            <div>
              <span className="section-label">LOOP TRACE</span>
              <h5>循环动作轨迹</h5>
            </div>
            <Zap size={16} className="loop-zap" />
          </div>
          <div className="loop-trace-list">
            {trace.length === 0 ? (
              <div className="loop-empty compact">事件进入后显示 detect → notify → audit → escalate / resolve。</div>
            ) : (
              trace.slice(0, 12).map((event) => (
                <div key={event.id} className="loop-trace-item">
                  <span className="loop-trace-dot" />
                  <div>
                    <strong>{event.node}</strong>
                    <small>{event.deviceId} · {timeLabel(event.at)}</small>
                    {event.detail?.recipient && <span>{event.detail.recipient}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="loop-notification-head">
            <span className="section-label">NOTIFICATIONS</span>
            <span className="wb-mono">{notifications.length} sent</span>
          </div>
          <div className="loop-notification-list">
            {notifications.slice(0, 5).map((item) => (
              <div key={item.notificationId} className="loop-notification-item">
                <BellRing size={14} />
                <div><strong>{item.recipient}</strong><span>{item.message}</span><small>{item.channel}{item.emailStatus ? ` · 邮件${item.emailStatus === 'delivered' ? '已发送' : item.emailStatus}` : ''}</small></div>
                <small>{timeLabel(item.at)}</small>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

