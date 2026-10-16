/**
 * 第五层：安全层 (Safety & Guardrails Layer)
 *
 * 职责：
 * 1. 输入护栏 (Input Guardrails)：请求体、query 长度、日期窗口、枚举参数与防越权注入校验；
 * 2. 统一错误构造：严格遵循 docs/API_CONTRACT.md 的 { error: { code, message } } 与 HTTP 状态码；
 * 3. 输出护栏与防幻觉校验 (Output & Anti-Hallucination Guardrails)：
 *    - 强制契约 Schema 归一化（非 null 数组、score 0..100、estimatedPaybackMonths null 规则）；
 *    - 数值事实核查（防止总结与建议中出现工具未返回的幻觉数字）。
 */

import { AGENT_IDENTITY, WHITELISTED_TOOL_NAMES } from './definition.js'

const VALID_SEVERITIES = new Set(['high', 'medium', 'low'])
const VALID_TOOL_NAMES = new Set(WHITELISTED_TOOL_NAMES)
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

/**
 * 提示词注入与越权操作检测正则（拦截直接写 SQL、篡改阈值、跳过确认直接改价等指令）
 */
const PRIVILEGE_ESCALATION_PATTERNS = [
  /DROP\s+TABLE|DELETE\s+FROM|UPDATE\s+\w+\s+SET|INSERT\s+INTO/i,
  /修改阈值|篡改规则|忽略所有规则|绕过白名单|直接改价|自动关店/i,
]

/**
 * 标准 API 契约错误类
 */
export class ApiContractError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'ApiContractError'
    this.status = status
    this.code = code
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
      },
    }
  }
}

/**
 * 校验 AgentRequest 输入护栏
 */
export function validateAgentRequest(request) {
  if (!request || typeof request !== 'object') {
    throw new ApiContractError(400, 'INVALID_QUERY', '请求体必须为 JSON 对象。')
  }
  if (typeof request.query !== 'string' || request.query.trim().length === 0) {
    throw new ApiContractError(400, 'INVALID_QUERY', 'query 不能为空。')
  }
  const trimmed = request.query.trim()
  if (trimmed.length > AGENT_IDENTITY.maxQueryLength) {
    throw new ApiContractError(
      400,
      'INVALID_QUERY',
      `query 长度不能超过 ${AGENT_IDENTITY.maxQueryLength} 个字符。`,
    )
  }

  const securityWarnings = []
  for (const pattern of PRIVILEGE_ESCALATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      securityWarnings.push('检测到潜在越权或修改规则指令，已按安全策略限制在只读白名单工具内执行。')
      break
    }
  }

  return {
    normalizedQuery: trimmed,
    securityWarnings,
  }
}

/**
 * 校验 DashboardFilters (regionId, from, to)
 */
export function validateDashboardFilters(filters = {}) {
  if (!filters || typeof filters !== 'object') return {}
  const { regionId, from, to } = filters

  if ((from && !to) || (!from && to)) {
    throw new ApiContractError(400, 'INVALID_QUERY', 'from 与 to 参数必须同时提供。')
  }
  if (from && to) {
    if (!DATE_REGEX.test(from) || !DATE_REGEX.test(to)) {
      throw new ApiContractError(400, 'INVALID_QUERY', '日期格式必须为 YYYY-MM-DD。')
    }
    if (from > to) {
      throw new ApiContractError(400, 'INVALID_QUERY', '起始日期 from 不能晚于结束日期 to。')
    }
  }

  const cleaned = {}
  if (typeof regionId === 'string' && regionId.trim()) {
    cleaned.regionId = regionId.trim()
  }
  if (from && to) {
    cleaned.from = from
    cleaned.to = to
  }
  return cleaned
}

/**
 * 校验 AuditFilters (继承 DashboardFilters + deviceId, severity)
 */
export function validateAuditFilters(filters = {}) {
  const base = validateDashboardFilters(filters)
  const { deviceId, severity } = filters || {}

  if (severity !== undefined && severity !== '') {
    if (!VALID_SEVERITIES.has(severity)) {
      throw new ApiContractError(
        400,
        'INVALID_QUERY',
        "severity 参数无效，只允许 'high' | 'medium' | 'low'。",
      )
    }
    base.severity = severity
  }

  if (typeof deviceId === 'string' && deviceId.trim()) {
    base.deviceId = deviceId.trim()
  }
  return base
}

/**
 * 解析并规范化 regionIds 查询参数（逗号分隔 -> 去空格、去空串、保序去重）
 */
export function parseRegionIdsParam(rawRegionIds) {
  if (rawRegionIds === undefined || rawRegionIds === null) return undefined
  const rawList = Array.isArray(rawRegionIds)
    ? rawRegionIds
    : typeof rawRegionIds === 'string'
      ? rawRegionIds.split(',')
      : []

  const seen = new Set()
  const result = []
  for (const item of rawList) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result.length > 0 ? result : undefined
}

/**
 * 提取结构化结果中所有合法的数值集合（用于防幻觉核查）
 */
function collectAllowedNumbers(findings, regionComparison, dashboardMetrics) {
  const allowed = new Set([0, 1, 2, 3, 7, 20, 24, 30, 48]) // 常见窗口/抽样常数
  const extractFromText = (text) => {
    if (typeof text !== 'string') return
    const matches = text.match(/-?\d+(\.\d+)?/g)
    if (matches) {
      matches.forEach((m) => allowed.add(Number(m)))
    }
  }

  findings.forEach((f) => {
    extractFromText(f.title)
    extractFromText(f.recommendation)
    if (Array.isArray(f.evidence)) f.evidence.forEach(extractFromText)
  })
  allowed.add(findings.length)

  regionComparison.forEach((r) => {
    if (Number.isFinite(r.score)) allowed.add(Number(r.score))
    if (Number.isFinite(r.estimatedMonthlyProfit)) allowed.add(Number(r.estimatedMonthlyProfit))
    if (Number.isFinite(r.estimatedPaybackMonths)) allowed.add(Number(r.estimatedPaybackMonths))
    if (Array.isArray(r.reasons)) r.reasons.forEach(extractFromText)
    if (Array.isArray(r.assumptions)) r.assumptions.forEach(extractFromText)
  })
  allowed.add(regionComparison.length)

  if (dashboardMetrics && typeof dashboardMetrics === 'object') {
    Object.values(dashboardMetrics).forEach((val) => {
      if (Number.isFinite(val)) {
        allowed.add(Number(val))
        allowed.add(Number((val * 100).toFixed(1)))
      }
    })
  }
  return allowed
}

/**
 * 检查文本中是否包含未出现在证据池中的幻觉数字
 */
export function hasHallucinatedNumbers(text, findings, regionComparison, dashboardMetrics) {
  if (typeof text !== 'string' || !text) return false
  const allowed = collectAllowedNumbers(findings, regionComparison, dashboardMetrics)
  // 移除类似 device-A-001 或 demo_v1 等标识符后再提取纯数值
  const scrubbed = text
    .replace(/device-[A-Za-z0-9-]+/g, '')
    .replace(/finding-[A-Za-z0-9-]+/g, '')
    .replace(/demo_v\d+/g, '')
    .replace(/\d{4}-\d{2}-\d{2}/g, '')
  const numbersInText = scrubbed.match(/-?\d+(\.\d+)?/g)
  if (!numbersInText) return false

  for (const rawNum of numbersInText) {
    const num = Number(rawNum)
    if (!allowed.has(num)) {
      return true
    }
  }
  return false
}

/**
 * 输出护栏：强制归一化并校验 AgentResponse 严格符合 contracts/src/index.ts
 */
export function enforceOutputGuardrails({
  summary,
  findings,
  regionComparison,
  recommendations,
  toolCalls,
  assumptions,
  fallbackSummary,
  fallbackRecommendations,
  dashboardMetrics,
}) {
  const safeFindings = Array.isArray(findings)
    ? findings.map((f, idx) => ({
        id: typeof f.id === 'string' && f.id ? f.id : `finding-auto-${idx + 1}`,
        deviceId: typeof f.deviceId === 'string' && f.deviceId ? f.deviceId : 'device-unknown',
        severity: VALID_SEVERITIES.has(f.severity) ? f.severity : 'medium',
        title: typeof f.title === 'string' && f.title ? f.title : '未命名经营异常',
        evidence: Array.isArray(f.evidence)
          ? f.evidence.filter((e) => typeof e === 'string' && e.length > 0)
          : [],
        recommendation:
          typeof f.recommendation === 'string' && f.recommendation
            ? f.recommendation
            : '建议人工核查该设备近期经营记录。',
      }))
    : []

  const safeRegions = Array.isArray(regionComparison)
    ? regionComparison.map((r) => ({
        regionId: String(r.regionId || 'unknown'),
        name: String(r.name || '未知区域'),
        score: Math.min(100, Math.max(0, Number.isFinite(r.score) ? Number(r.score) : 0)),
        estimatedMonthlyProfit: Number.isFinite(r.estimatedMonthlyProfit)
          ? Number(r.estimatedMonthlyProfit)
          : 0,
        estimatedPaybackMonths:
          r.estimatedPaybackMonths === null
            ? null
            : Number.isFinite(r.estimatedPaybackMonths) && r.estimatedPaybackMonths >= 0
              ? Number(r.estimatedPaybackMonths)
              : null,
        reasons: Array.isArray(r.reasons)
          ? r.reasons.filter((item) => typeof item === 'string' && item.length > 0)
          : [],
        assumptions: Array.isArray(r.assumptions)
          ? r.assumptions.filter((item) => typeof item === 'string' && item.length > 0)
          : [],
      }))
    : []

  const safeToolCalls = Array.isArray(toolCalls)
    ? toolCalls
        .filter((call) => call && VALID_TOOL_NAMES.has(call.toolName))
        .map((call) => ({
          toolName: call.toolName,
          status: call.status === 'error' ? 'error' : 'success',
        }))
    : []

  const safeAssumptions = Array.isArray(assumptions)
    ? Array.from(new Set(assumptions.filter((a) => typeof a === 'string' && a.trim().length > 0)))
    : ['当前结果使用 demo_v1 模拟数据。']

  // 防幻觉核查：如果 summary 或 recommendations 出现未授权数字，自动回退到受控模板结果
  let finalSummary =
    typeof summary === 'string' && summary.trim().length > 0
      ? summary.trim()
      : fallbackSummary || '已完成经营数据分析。'

  if (hasHallucinatedNumbers(finalSummary, safeFindings, safeRegions, dashboardMetrics)) {
    finalSummary = fallbackSummary || '已基于白名单工具完成经营数据核查，请参考下方证据与区域对比明细。'
  }

  let finalRecommendations = Array.isArray(recommendations)
    ? recommendations.filter((r) => typeof r === 'string' && r.trim().length > 0)
    : []

  if (
    finalRecommendations.some((rec) =>
      hasHallucinatedNumbers(rec, safeFindings, safeRegions, dashboardMetrics),
    )
  ) {
    finalRecommendations = Array.isArray(fallbackRecommendations) ? fallbackRecommendations : []
  }

  return {
    summary: finalSummary,
    findings: safeFindings,
    regionComparison: safeRegions,
    recommendations: finalRecommendations,
    toolCalls: safeToolCalls,
    assumptions: safeAssumptions,
  }
}
