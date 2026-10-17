/**
 * 数据层 HTTP 客户端（任务C 的桥接层）。
 *
 * 职责边界：
 *   - 本文件只做「HTTP 调用 + 形状适配 + 超时兜底」，不含任何业务计算。
 *     所有数字都来自 Python 数据层（任务B），这里绝不二次加工。
 *   - Python 侧不可用时（未启动 / 超时 / 报错），返回 null 让上层走内存兜底，
 *     保证前端在没起 Python 的机器上依然能打开。
 *
 * 配置（环境变量）：
 *   DATA_LAYER_URL      默认 http://127.0.0.1:8787
 *   DATA_LAYER_TIMEOUT  默认 3500ms。超时后立即回退，不让页面等
 *   DATA_LAYER_ENABLED  设为 '0' 可强制关闭桥接，只走内存实现
 */

const DEFAULT_BASE_URL = 'http://127.0.0.1:8787'
const DEFAULT_TIMEOUT_MS = 3500

function baseUrl() {
  return (process.env.DATA_LAYER_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

function timeoutMs() {
  const raw = Number(process.env.DATA_LAYER_TIMEOUT)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS
}

export function isDataLayerEnabled() {
  return process.env.DATA_LAYER_ENABLED !== '0'
}

/**
 * 带超时的 JSON 请求。用 AbortController 而不是 Promise.race——
 * race 会让被抛弃的请求继续占用连接，批量调用时容易堆积。
 */
async function request(path, { method = 'GET', body, timeout } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout ?? timeoutMs())
  const url = `${baseUrl()}${path}`

  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })

    const text = await response.text()
    let payload = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      throw new Error(`数据层返回了非 JSON 内容：${text.slice(0, 200)}`)
    }

    if (!response.ok) {
      const code = payload?.error?.code || `HTTP_${response.status}`
      const message = payload?.error?.message || '数据层返回错误'
      const error = new Error(message)
      error.code = code
      error.status = response.status
      throw error
    }

    return payload
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 统一包装：把「数据层不可用」和「数据层明确拒绝」分开处理。
 *
 *   - 不可用（连接被拒 / 超时 / 返回非 JSON）→ 记 warn，返回 fallback，
 *     页面降级到内存快照，用户看到的还是能用的界面。
 *   - 明确拒绝（HTTP 4xx，带 error.code）→ 原样抛出去。
 *     这类响应是 Python 数据层的权威判断，比如 REGION_NOT_FOUND、
 *     INSUFFICIENT_DATA。如果在这里吞掉并换成内存快照，就会出现
 *     「查一个不存在的区域，却返回了一份看起来正常的旧数据」——
 *     这种静默错误比白屏更危险。
 */
async function safeCall(label, fn, fallback = null) {
  if (!isDataLayerEnabled()) return fallback
  try {
    return await fn()
  } catch (error) {
    if (typeof error.status === 'number' && error.status >= 400 && error.status < 500) {
      throw error
    }
    const reason = error.name === 'AbortError' ? `超时(${timeoutMs()}ms)` : error.message
    console.warn(`[dataLayerClient] ${label} 失败，回退内存实现：${reason}`)
    return fallback
  }
}

// ---------------------------------------------------------------------------
// 形状适配
//
// 前端 defaultDomainServices.js 读的字段名和冻结契约完全一致
// （salesAmount / estimatedProfit / estimatedMonthlyProfit /
//  estimatedPaybackMonths），因此这里不需要改名字，只做两件事：
//   1. 裁掉契约之外的扩展字段，避免前端依赖内部实现
//   2. 把 null 语义补成显式标志位，方便 UI 区分「未估算」和「算出来是 0」
// ---------------------------------------------------------------------------

/** DashboardMetrics 的冻结字段，一个不多一个不少。 */
const DASHBOARD_FIELDS = [
  'salesAmount',
  'estimatedProfit',
  'deviceCount',
  'onlineRate',
  'openFindingCount',
]

export function adaptDashboard(payload) {
  if (!payload) return null
  const result = {}
  for (const field of DASHBOARD_FIELDS) {
    result[field] = payload[field] ?? null
  }
  // openFindingCount 的口径可能被后端配置改变，带上数据版本便于排查
  result.dataVersion = payload.dataVersion ?? null
  return result
}

/** RegionResult 的冻结字段。 */
const REGION_FIELDS = [
  'regionId',
  'name',
  'score',
  'estimatedMonthlyProfit',
  'estimatedPaybackMonths',
  'reasons',
  'assumptions',
]

export function adaptRegion(region) {
  if (!region) return null
  const result = {}
  for (const field of REGION_FIELDS) {
    result[field] = region[field] ?? null
  }
  result.reasons = region.reasons || []
  result.assumptions = region.assumptions || []
  // null 回本周期有两种成因：成本数据缺失，或投入金额缺失。
  // 前端要分别给出提示文案时，读这两个标志位。
  result.paybackAvailable = region.estimatedPaybackMonths !== null
  result.paybackStatus = region.paybackStatus || (result.paybackAvailable ? 'ok' : 'unavailable')
  return result
}

export function adaptRegionComparison(payload) {
  if (!payload) return null
  const regions = Array.isArray(payload.regions) ? payload.regions.map(adaptRegion) : []
  return { regions, count: regions.length }
}

/** AuditFinding 的冻结字段。 */
const FINDING_FIELDS = ['id', 'deviceId', 'severity', 'title', 'evidence', 'recommendation']

export function adaptFinding(finding) {
  if (!finding) return null
  const result = {}
  for (const field of FINDING_FIELDS) {
    result[field] = finding[field] ?? null
  }
  result.evidence = finding.evidence || []
  return result
}

export function adaptAudit(payload) {
  if (!payload) return null
  const findings = Array.isArray(payload.findings) ? payload.findings.map(adaptFinding) : []
  return {
    summary: payload.summary || '',
    findings,
    // status 让 Node 侧能区分「确实没问题」和「证据不足不敢下结论」
    status: payload.status || (findings.length ? 'possible' : 'none'),
    notes: payload.notes || [],
  }
}

// ---------------------------------------------------------------------------
// 四个契约函数（与 Python 侧同名同参）
// ---------------------------------------------------------------------------

function toQueryString(filters = {}) {
  const params = new URLSearchParams()
  const map = {
    regionId: filters.regionId,
    storeId: filters.storeId,
    deviceId: filters.deviceId,
    severity: filters.severity,
    from: filters.from,
    to: filters.to,
  }
  for (const [key, value] of Object.entries(map)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value))
    }
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

export async function getDashboardMetrics(filters = {}) {
  return safeCall(
    'getDashboardMetrics',
    async () => adaptDashboard(await request(`/api/v1/dashboard${toQueryString(filters)}`)),
  )
}

export async function auditOperations(filters = {}) {
  return safeCall('auditOperations', async () =>
    adaptAudit(await request(`/api/v1/audit${toQueryString(filters)}`)),
  )
}

export async function compareRegions(regionIds) {
  return safeCall('compareRegions', async () => {
    let path = '/api/v1/regions'
    if (Array.isArray(regionIds) && regionIds.length > 0) {
      path += `?regionIds=${encodeURIComponent(regionIds.join(','))}`
    }
    return adaptRegionComparison(await request(path))
  })
}

export async function estimateRegionROI(regionId) {
  return safeCall('estimateRegionROI', async () => {
    // 走独立的 /api/v1/roi 而不是复用 compareRegions：
    // 前者多返回 roiNote 和 status（成本数据缺失时是 'insufficient'），
    // 而且它按 regionId 精确匹配，不受中文别名归一化的影响。
    const payload = await request(`/api/v1/roi?regionId=${encodeURIComponent(regionId)}`)
    return adaptRegion(payload)
  })
}

// ---------------------------------------------------------------------------
// 任务与 trace（对应 Agent 工具 create_task / verify_task）
//
// 这些调用失败时【不返回 null 兜底】。原因：
//   - 四个查询函数失败可以退回内存快照，用户看到的是旧数据，页面还活着；
//   - 但「任务已创建」是不能编的。写失败就必须如实报告失败，
//     否则用户以为单子派出去了，实际库里什么都没有。
// 因此这里让异常向上抛，由 registration 层决定如何提示。
// ---------------------------------------------------------------------------

function taskApiError(error, action) {
  if (error.code === 'INVALID_QUERY' && /TASK_TERMINAL_STATE/.test(error.message)) {
    return new Error(`任务已结束，无法再${action}。`)
  }
  return error
}

export async function createTask({ findingId, finding, actionCard, traceId } = {}) {
  try {
    const payload = await request('/api/v1/tasks', {
      method: 'POST',
      body: { findingId, finding, actionCard, traceId },
    })
    return payload?.task ?? null
  } catch (error) {
    throw taskApiError(error, '创建任务')
  }
}

export async function updateTaskStatus(taskId, status) {
  try {
    const payload = await request(`/api/v1/tasks/${encodeURIComponent(taskId)}/status`, {
      method: 'POST',
      body: { status },
    })
    return payload?.task ?? null
  } catch (error) {
    throw taskApiError(error, '变更状态')
  }
}

export async function verifyTask({ taskId, targetMet, evidence } = {}) {
  try {
    const payload = await request(`/api/v1/tasks/${encodeURIComponent(taskId)}/verify`, {
      method: 'POST',
      body: { targetMet, evidence },
    })
    return payload?.task ?? null
  } catch (error) {
    throw taskApiError(error, '复核任务')
  }
}

/**
 * 落一条 trace 事件。失败只 warn 不抛——
 * 链路日志丢一条不影响业务，但绝不能因为它让整轮 Agent 挂掉。
 */
export async function writeTraceEvent({ traceId, nodeName, payload } = {}) {
  return safeCall(
    'writeTraceEvent',
    async () => request('/api/v1/traces', { method: 'POST', body: { traceId, nodeName, payload } }),
    null,
  )
}

/** 健康检查：Node 启动时探一次，决定是否启用桥接。 */
export async function checkDataLayerHealth(timeout = 1200) {
  if (!isDataLayerEnabled()) return { ok: false, reason: 'disabled' }
  try {
    const payload = await request('/healthz', { timeout })
    return { ok: true, ...payload }
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'timeout' : error.message
    return { ok: false, reason }
  }
}

export const DATA_LAYER_CONFIG = { baseUrl, timeoutMs }
