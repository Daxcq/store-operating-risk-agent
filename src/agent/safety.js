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

import {
  AGENT_IDENTITY,
  WHITELISTED_TOOL_NAMES,
  AGENT_PLANNING_CONTRACT,
  INTENT_TYPES,
} from './definition.js'
import {
  normalizeRegionIdAlias,
  normalizeDeviceIdAlias,
} from './components/intentParser.js'

const VALID_SEVERITIES = new Set(AGENT_PLANNING_CONTRACT.validSeverities)
const VALID_VERIFY_SCENARIOS = new Set(AGENT_PLANNING_CONTRACT.validVerifyScenarios)
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
function collectAllowedNumbers(findings, regionComparison, dashboardMetrics, assumptions = []) {
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

  if (Array.isArray(assumptions)) {
    assumptions.forEach(extractFromText)
  }
  return allowed
}

/**
 * 检查文本中是否包含未出现在证据池中的幻觉数字
 */
export function hasHallucinatedNumbers(text, findings, regionComparison, dashboardMetrics, assumptions = []) {
  if (typeof text !== 'string' || !text) return false
  const allowed = collectAllowedNumbers(findings, regionComparison, dashboardMetrics, assumptions)
  // 移除类似 device-A-001、S001、ev_*、trace_* 或 demo_v1 等标识符后再提取纯数值
  const scrubbed = text
    .replace(/device-[A-Za-z0-9-]+/g, '')
    .replace(/\bS0\d{2}\b/gi, '')
    .replace(/finding-[A-Za-z0-9-]+/g, '')
    .replace(/ev_[A-Za-z0-9_\u4e00-\u9fa5-]+/g, '')
    .replace(/trace_[A-Za-z0-9_-]+/g, '')
    .replace(/demo_v\d+/g, '')
    .replace(/\d{4}-\d{2}-\d{2}/g, '')
    .replace(/\d{2}-\d{2}/g, '')
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

  if (hasHallucinatedNumbers(finalSummary, safeFindings, safeRegions, dashboardMetrics, safeAssumptions)) {
    finalSummary = fallbackSummary || '已基于白名单工具完成经营数据核查，请参考下方证据与区域对比明细。'
  }

  let finalRecommendations = Array.isArray(recommendations)
    ? recommendations.filter((r) => typeof r === 'string' && r.trim().length > 0)
    : []

  if (
    finalRecommendations.some((rec) =>
      hasHallucinatedNumbers(rec, safeFindings, safeRegions, dashboardMetrics, safeAssumptions),
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

/**
 * 清洗并规范化单个工具调用的入参（将 LLM 生成的中文区域/门店名映射为契约 ID，剔除非法枚举值）
 */
function sanitizeSingleToolArgs(toolName, rawArgs = {}, deterministicPlan = {}) {
  const args = rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {}
  const fallbackFilters = deterministicPlan?.intent?.filters || {}
  const fallbackRegions = Array.isArray(deterministicPlan?.intent?.regionIds)
    ? deterministicPlan.intent.regionIds
    : []

  if (toolName === 'get_dashboard') {
    const cleaned = {}
    const normRegion = normalizeRegionIdAlias(args.regionId) || fallbackFilters.regionId
    if (normRegion) cleaned.regionId = normRegion
    if (DATE_REGEX.test(String(args.from || '')) && DATE_REGEX.test(String(args.to || '')) && args.from <= args.to) {
      cleaned.from = args.from
      cleaned.to = args.to
    }
    return cleaned
  }

  if (toolName === 'run_audit') {
    const cleaned = {}
    const normDevice = normalizeDeviceIdAlias(args.deviceId) || fallbackFilters.deviceId
    const normRegion = normalizeRegionIdAlias(args.regionId) || fallbackFilters.regionId
    if (normDevice) cleaned.deviceId = normDevice
    if (normRegion && !normDevice) cleaned.regionId = normRegion
    if (VALID_SEVERITIES.has(args.severity)) {
      cleaned.severity = args.severity
    } else if (fallbackFilters.severity) {
      cleaned.severity = fallbackFilters.severity
    }
    if (DATE_REGEX.test(String(args.from || '')) && DATE_REGEX.test(String(args.to || '')) && args.from <= args.to) {
      cleaned.from = args.from
      cleaned.to = args.to
    }
    if (args._simulateInsufficient) {
      cleaned._simulateInsufficient = true
    }
    return cleaned
  }

  if (toolName === 'compare_regions') {
    const rawList = Array.isArray(args.regionIds) ? args.regionIds : []
    const normalizedList = Array.from(
      new Set(
        rawList
          .map((r) => normalizeRegionIdAlias(r))
          .filter((r) => r && r !== 'changchun'),
      ),
    )
    const finalRegions =
      normalizedList.length > 0
        ? normalizedList
        : fallbackRegions.length > 0
          ? fallbackRegions
          : ['chaoyang', 'nanguan']
    const cleaned = { regionIds: finalRegions }
    if (args._simulateInsufficient) {
      cleaned._simulateInsufficient = true
    }
    return cleaned
  }

  if (toolName === 'estimate_region_roi') {
    const normRegion =
      normalizeRegionIdAlias(args.regionId) ||
      fallbackRegions[0] ||
      fallbackFilters.regionId ||
      'chaoyang'
    return {
      regionId: normRegion === 'changchun' ? 'chaoyang' : normRegion,
    }
  }

  if (toolName === 'create_task') {
    return {
      ownerRole:
        typeof args.ownerRole === 'string' && args.ownerRole.trim()
          ? args.ownerRole.trim()
          : '区域经理',
      dueHours:
        Number.isFinite(Number(args.dueHours)) && Number(args.dueHours) > 0
          ? Number(args.dueHours)
          : 24,
      action:
        typeof args.action === 'string' && args.action.trim()
          ? args.action.trim()
          : '抽查最近 20 笔退款订单并核对退款原因。',
    }
  }

  if (toolName === 'verify_task') {
    return {
      scenario: VALID_VERIFY_SCENARIOS.has(args.scenario) ? args.scenario : 'improved-task',
    }
  }

  if (toolName === 'write_report') {
    return {
      summary:
        typeof args.summary === 'string' && args.summary.trim()
          ? args.summary.trim()
          : '自动生成的经营审计与对标报告',
    }
  }

  return args
}

/**
 * Agent 工具规划合同校验器（约束复杂/开放问题下的 LLM 原生 tool_calls 与规则计划融合）
 *
 * 五大合同铁律：
 * 1. 工具白名单合同：严禁调用 7 个白名单之外的任何工具；
 * 2. 写操作显式授权合同：create_task / verify_task / write_report 若无用户明确指令，强制拦截；
 * 3. 参数枚举与别名归一化合同：自动将中文名（如“朝阳区”、“A店”）转为契约 ID，剔除越界枚举；
 * 4. 证据前置与伴随工具合同：写操作前必须有只读调查工具，复杂开放问题自动合并多维证据工具；
 * 5. 禁止开放式无工具裸答合同：若 LLM 试图不调工具直接自由回答（0 个合法工具），强制回退受控工具计划。
 */
export function enforceToolPlanContract({
  candidateTools = [],
  deterministicPlan = {},
  messageIndex = 1,
}) {
  const contractViolations = []
  const contractFlags = deterministicPlan?.intent?.contractFlags || {}
  const fallbackTools = Array.isArray(deterministicPlan?.plannedTools)
    ? deterministicPlan.plannedTools
    : [{ toolName: 'run_audit', args: {} }]

  const WRITE_TOOLS = new Set(AGENT_PLANNING_CONTRACT.writeToolsRequiringExplicitIntent)
  const READ_TOOLS = new Set(['get_dashboard', 'run_audit', 'compare_regions', 'estimate_region_roi'])

  const approvedMap = new Map()

  for (const rawCall of Array.isArray(candidateTools) ? candidateTools : []) {
    const toolName = rawCall?.toolName
    if (!toolName || !VALID_TOOL_NAMES.has(toolName)) {
      contractViolations.push(`拦截非白名单工具调用: ${String(toolName || 'unknown')}`)
      continue
    }

    // 条款 2：写操作显式授权校验
    if (toolName === 'create_task' && !contractFlags.allowCreateTask) {
      contractViolations.push('拦截未获用户显式授权的写操作: create_task')
      continue
    }
    if (toolName === 'verify_task' && !contractFlags.allowVerifyTask) {
      contractViolations.push('拦截未获用户显式授权的写操作: verify_task')
      continue
    }
    if (toolName === 'write_report' && !contractFlags.allowWriteReport) {
      contractViolations.push('拦截未获用户显式授权的写操作: write_report')
      continue
    }

    // 条款 3：参数归一化与消毒
    const cleanArgs = sanitizeSingleToolArgs(toolName, rawCall.args, deterministicPlan)
    if (!approvedMap.has(toolName)) {
      approvedMap.set(toolName, {
        id: rawCall.id || `call_contract_${messageIndex}_${approvedMap.size + 1}`,
        toolName,
        args: cleanArgs,
      })
    }
  }

  // 条款 5：禁止开放式无工具裸答（若 LLM 未选出任何合法工具，强制回退至受控规则计划）
  if (approvedMap.size === 0) {
    if (Array.isArray(candidateTools) && candidateTools.length === 0) {
      contractViolations.push('拦截 LLM 开放式无工具裸答企图，已按合同强制挂载白名单证据采集工具')
    }
    for (const reqTool of fallbackTools) {
      if (VALID_TOOL_NAMES.has(reqTool.toolName) && !approvedMap.has(reqTool.toolName)) {
        approvedMap.set(reqTool.toolName, {
          id: `call_plan_${messageIndex}_${approvedMap.size + 1}`,
          toolName: reqTool.toolName,
          args: sanitizeSingleToolArgs(reqTool.toolName, reqTool.args, deterministicPlan),
        })
      }
    }
  } else {
    // 条款 4：伴随工具与复杂开放问题多维证据补齐
    for (const reqTool of fallbackTools) {
      if (!approvedMap.has(reqTool.toolName)) {
        approvedMap.set(reqTool.toolName, {
          id: `call_comp_${messageIndex}_${approvedMap.size + 1}`,
          toolName: reqTool.toolName,
          args: sanitizeSingleToolArgs(reqTool.toolName, reqTool.args, deterministicPlan),
        })
      }
    }

    // 若包含 compare_regions 且未模拟数据不足，确保配对 estimate_region_roi
    if (
      approvedMap.has('compare_regions') &&
      !approvedMap.has('estimate_region_roi') &&
      !deterministicPlan?.intent?.forceInsufficient &&
      !deterministicPlan?.intent?.targetStoreId
    ) {
      const compareCall = approvedMap.get('compare_regions')
      const primaryRegion = compareCall?.args?.regionIds?.[0] || 'chaoyang'
      approvedMap.set('estimate_region_roi', {
        id: `call_comp_${messageIndex}_${approvedMap.size + 1}`,
        toolName: 'estimate_region_roi',
        args: { regionId: primaryRegion },
      })
    }

    // 写操作前置只读证据校验：严禁无只读证据空建任务或空写报告
    const hasWriteTool = Array.from(approvedMap.keys()).some((k) => WRITE_TOOLS.has(k))
    const hasReadTool = Array.from(approvedMap.keys()).some((k) => READ_TOOLS.has(k))
    if (hasWriteTool && !hasReadTool) {
      contractViolations.push('检测到写操作缺少前置只读证据，已按合同自动补齐 run_audit')
      approvedMap.set('run_audit', {
        id: `call_guard_${messageIndex}_${approvedMap.size + 1}`,
        toolName: 'run_audit',
        args: sanitizeSingleToolArgs('run_audit', {}, deterministicPlan),
      })
    }
  }

  // 按合同规定的拓扑顺序排序，并限制单轮最大工具数
  const orderIndex = new Map(
    AGENT_PLANNING_CONTRACT.topologicalOrder.map((name, idx) => [name, idx]),
  )
  const orderedTools = Array.from(approvedMap.values())
    .sort((a, b) => (orderIndex.get(a.toolName) ?? 99) - (orderIndex.get(b.toolName) ?? 99))
    .slice(0, AGENT_PLANNING_CONTRACT.maxToolsPerTurn)

  // 根据最终合同审批通过的工具组合推断规范意图类型
  const finalNames = new Set(orderedTools.map((t) => t.toolName))
  let resolvedIntentType = deterministicPlan?.intent?.type || INTENT_TYPES.STORE_AUDIT
  if (deterministicPlan?.intent?.forceInsufficient) {
    resolvedIntentType = INTENT_TYPES.INSUFFICIENT_PROBE
  } else if (finalNames.has('verify_task')) {
    resolvedIntentType = INTENT_TYPES.TASK_VERIFICATION
  } else if (finalNames.has('compare_regions') && finalNames.has('run_audit')) {
    resolvedIntentType = INTENT_TYPES.COMPREHENSIVE
  } else if (finalNames.has('compare_regions') && !finalNames.has('run_audit')) {
    resolvedIntentType = INTENT_TYPES.REGION_COMPARISON
  } else if (finalNames.has('get_dashboard') && !finalNames.has('compare_regions')) {
    resolvedIntentType = INTENT_TYPES.DASHBOARD_OVERVIEW
  }

  return {
    plannedTools: orderedTools,
    resolvedIntentType,
    contractViolations,
  }
}
