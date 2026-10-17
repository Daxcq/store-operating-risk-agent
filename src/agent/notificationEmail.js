import nodemailer from 'nodemailer'

let transport = null
let transportKey = ''

export function getEmailNotificationConfig() {
  const user = String(process.env.QQ_SMTP_USER || '').trim()
  const authCode = String(process.env.QQ_SMTP_AUTH_CODE || '').trim()
  const recipients = String(process.env.AGENT_NOTIFY_EMAIL_TO || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  return {
    host: process.env.QQ_SMTP_HOST || 'smtp.qq.com',
    port: Number(process.env.QQ_SMTP_PORT || 465),
    secure: String(process.env.QQ_SMTP_SECURE || 'true').toLowerCase() !== 'false',
    user,
    authCode,
    recipients,
  }
}

export function isEmailNotificationConfigured() {
  const config = getEmailNotificationConfig()
  return Boolean(config.user && config.authCode && config.recipients.length > 0)
}

function getTransport(config) {
  const nextKey = `${config.host}:${config.port}:${config.secure}:${config.user}:${config.authCode}`
  if (!transport || transportKey !== nextKey) {
    transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.authCode,
      },
    })
    transportKey = nextKey
  }
  return transport
}

function subjectFor(type) {
  if (type === 'offline_alert') return '[莱森购] 设备离线提醒'
  if (type === 'offline_escalation') return '[莱森购] 设备离线升级督办'
  if (type === 'device_recovered') return '[莱森购] 设备已恢复在线'
  return '[莱森购] Agent 运营通知'
}

export async function sendNotificationEmail(notification) {
  const config = getEmailNotificationConfig()
  if (!isEmailNotificationConfigured()) {
    return { configured: false, status: 'skipped' }
  }

  const info = await getTransport(config).sendMail({
    from: `莱森购 Agent <${config.user}>`,
    to: config.recipients.join(', '),
    subject: subjectFor(notification.type),
    text: [
      notification.message,
      '',
      `告警 ID: ${notification.alertId}`,
      `通知类型: ${notification.type}`,
      `发生时间: ${notification.at}`,
      '来源: Laisen Retail Agent Monitor Loop',
    ].join('\n'),
  })

  return {
    configured: true,
    status: 'delivered',
    messageId: info.messageId || null,
    recipients: config.recipients,
  }
}

