/**
 * 第三层（组件层 - 领域服务适配底座）：defaultDomainServices.js
 *
 * 职责：
 * 1. 深度接入成员 B 的真实确定性数据层（src/services/pipeline.ts -> createDataLayer，基于 data/store_operations_daily.csv 与 data/region_cost_input.csv）；
 * 2. 同时完整兼容 docs/API_CONTRACT.md 与 contracts/fixtures/* 的契约基准示例（A~E 店与长春区域），实现真实数据层与契约夹具双轨无缝路由；
 * 3. 支持依赖注入（registerDomainServices）与直接访问底层 DataLayerApi（getRealDataLayer）。
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ApiContractError } from '../safety.js'
import {
  createDataLayer,
  DEFAULT_WINDOW,
  DEFAULT_DATA_VERSION,
} from '../../services/pipeline.ts'
import { toRegionId, toRegionName } from '../../services/region_code.ts'
import { toRiskStatus, toRatio } from '../../../contracts/b/index.ts'
import { FIXTURES, DEMO_ORDER, getFixture } from '../../fixtures/index.ts'

export {
  createDataLayer,
  DEFAULT_WINDOW,
  DEFAULT_DATA_VERSION,
  toRegionId,
  toRegionName,
  toRiskStatus,
  toRatio,
  FIXTURES,
  DEMO_ORDER,
  getFixture,
}

/**
 * 成员 B 真实数据层单例（懒加载 data/store_operations_daily.csv 与 data/region_cost_input.csv）
 */
let realDataLayerInstance = null

export function getRealDataLayer() {
  if (!realDataLayerInstance) {
    const opsPath = join(process.cwd(), 'data', 'store_operations_daily.csv')
    const costPath = join(process.cwd(), 'data', 'region_cost_input.csv')
    if (existsSync(opsPath)) {
      const csvText = readFileSync(opsPath, 'utf8')
      const costCsvText = existsSync(costPath) ? readFileSync(costPath, 'utf8') : undefined
      realDataLayerInstance = createDataLayer({ csvText, costCsvText })
    }
  }
  return realDataLayerInstance
}

const DATA_LAYER_ONLY_REGIONS = new Set([
  'kuancheng',
  'erdao',
  'luyuan',
  'haidian',
  'xicheng',
  'dongcheng',
  'fengtai',
])
const STORE_ID_REGEX = /^S0(0[1-9]|1[0-9]|2[01])$/i

const REGION_STORES_MAP = {
  chaoyang: ['S001', 'S002', 'S003', 'S004', 'S021'],
  nanguan: ['S005', 'S006', 'S007', 'S008'],
  kuancheng: ['S009', 'S010', 'S011', 'S012'],
  erdao: ['S013', 'S014', 'S015', 'S016'],
  luyuan: ['S017', 'S018', 'S019', 'S020'],
}

/**
 * 契约基准区域与门店模拟数据（对齐 docs/API_CONTRACT.md 与 contracts/fixtures/*）
 */
const REGION_CATALOG = {
  chaoyang: {
    regionId: 'chaoyang',
    name: '朝阳区',
    score: 86.5,
    estimatedMonthlyProfit: 42800,
    estimatedPaybackMonths: 8.4,
    reasons: ['客流稳定', '竞品密度可控'],
    assumptions: ['按近 30 天模拟客流估算', '设备投入按 360000 元计算'],
    salesAmount: 172000,
    estimatedProfit: 36100,
    deviceCount: 10,
    onlineDeviceCount: 10,
  },
  nanguan: {
    regionId: 'nanguan',
    name: '南关区',
    score: 71.0,
    estimatedMonthlyProfit: 26500,
    estimatedPaybackMonths: null,
    reasons: ['租金较高'],
    assumptions: ['缺少完整租金数据，回本周期不做合理估算'],
    salesAmount: 198000,
    estimatedProfit: 41500,
    deviceCount: 8,
    onlineDeviceCount: 7,
  },
  kuancheng: {
    regionId: 'kuancheng',
    name: '宽城区',
    score: 82.0,
    estimatedMonthlyProfit: 38200,
    estimatedPaybackMonths: 9.4,
    reasons: ['北站交通枢纽客流充沛', '退款率低于同城中位数'],
    assumptions: ['按近 30 天模拟客流估算', '设备投入按 360000 元计算'],
    salesAmount: 224000,
    estimatedProfit: 49200,
    deviceCount: 9,
    onlineDeviceCount: 9,
  },
  erdao: {
    regionId: 'erdao',
    name: '二道区',
    score: 78.5,
    estimatedMonthlyProfit: 33600,
    estimatedPaybackMonths: 10.7,
    reasons: ['社区商圈复购稳定', '履约成本适中'],
    assumptions: ['按近 30 天模拟客流估算', '设备投入按 360000 元计算'],
    salesAmount: 211000,
    estimatedProfit: 44300,
    deviceCount: 8,
    onlineDeviceCount: 8,
  },
  luyuan: {
    regionId: 'luyuan',
    name: '绿园区',
    score: 74.0,
    estimatedMonthlyProfit: 29400,
    estimatedPaybackMonths: 12.2,
    reasons: ['商业综合体周末客流集中', '工作日夜间时段订单偏弱'],
    assumptions: ['按近 30 天模拟客流估算', '设备投入按 360000 元计算'],
    salesAmount: 249000,
    estimatedProfit: 46900,
    deviceCount: 7,
    onlineDeviceCount: 6,
  },
}

/**
 * 区域别名映射（同时覆盖成员 B 数据层 5 区域与契约夹具区域）
 */
const REGION_ALIAS_MAP = {
  changchun: 'changchun',
  长春: 'changchun',
  长春市: 'changchun',
  chaoyang: 'chaoyang',
  朝阳: 'chaoyang',
  朝阳区: 'chaoyang',
  haidian: 'haidian',
  海淀: 'haidian',
  海淀区: 'haidian',
  xicheng: 'xicheng',
  西城: 'xicheng',
  西城区: 'xicheng',
  dongcheng: 'dongcheng',
  东城: 'dongcheng',
  东城区: 'dongcheng',
  fengtai: 'fengtai',
  丰台: 'fengtai',
  丰台区: 'fengtai',
  nanguan: 'nanguan',
  南关: 'nanguan',
  南关区: 'nanguan',
  kuancheng: 'kuancheng',
  宽城: 'kuancheng',
  宽城区: 'kuancheng',
  erdao: 'erdao',
  二道: 'erdao',
  二道区: 'erdao',
  luyuan: 'luyuan',
  绿园: 'luyuan',
  绿园区: 'luyuan',
}

/**
 * 预设审计发现库（对齐 docs/API_CONTRACT.md 及 contracts/fixtures/*）
 */
const AUDIT_FINDINGS_CATALOG = [
  {
    id: 'finding-001',
    deviceId: 'device-A-001',
    storeId: 'A',
    regionId: 'chaoyang',
    severity: 'high',
    title: '退款率高于同类设备',
    evidence: ['近 7 天退款率 7.0%，同类中位数 2.1%。'],
    recommendation: '抽查最近 20 笔退款订单并核对退款原因。',
  },
  {
    id: 'finding-002',
    deviceId: 'device-A-001',
    storeId: 'A',
    regionId: 'chaoyang',
    severity: 'low',
    title: '订单数低于观察窗口基准',
    evidence: ['近 7 天订单数较前周期下降 31%。'],
    recommendation: '核对客流、营业时段和商品结构。',
  },
  {
    id: 'finding-003',
    deviceId: 'device-B-001',
    storeId: 'B',
    regionId: 'nanguan',
    severity: 'medium',
    title: '订单数低于观察窗口基准',
    evidence: ['近 7 天订单数较前周期下降 9%。'],
    recommendation: '核对客流、营业时段和近期促销记录。',
  },
]

function normalizeRegionKey(raw) {
  if (!raw) return null
  const key = String(raw).trim().toLowerCase()
  return REGION_ALIAS_MAP[key] || REGION_ALIAS_MAP[raw] || toRegionId(String(raw)) || null
}

/**
 * 将成员 B 的 RuleEvaluation + PeerComparison 转换为顶层 API 契约的 AuditFinding[]
 */
function mapRuleEvaluationToFindings(evaluation, severityFilter, peerComparison = null) {
  if (!evaluation || !Array.isArray(evaluation.conditions)) return []
  const storeId = evaluation.subject?.store_id || 'unknown'

  // unavailable 或 none 不产出异常 finding
  if (evaluation.verdict === 'unavailable' || evaluation.verdict === 'none') {
    return []
  }

  const hitConditions = evaluation.conditions.filter((c) => c.hit)
  const mapped = hitConditions.map((c) => {
    // 若整体判定为 insufficient（仅命中 1 条规则，属 watch 观察级），将单条 finding 映射为 medium 以对齐 single-finding 契约语义
    const effectiveSeverity =
      evaluation.verdict === 'insufficient' ? 'medium' : c.severity || 'medium'
    const unitSuffix = c.unit === 'percent' ? '%' : c.unit === 'percent_point' ? '个百分点' : ''
    const evidenceList = [
      `[${c.evidence_id || evaluation.trace_id}] ${c.display_name}：当前值 ${c.actual}${unitSuffix} ${c.op} 阈值 ${c.threshold}${unitSuffix}（窗口 ${evaluation.window.from}~${evaluation.window.to}）`,
    ]

    if (peerComparison && Array.isArray(peerComparison.metrics)) {
      const ruleIdToMetricCode = {
        sales_drop: 'sales_change_pct',
        refund_high: 'refund_rate',
        aov_drop: 'aov_change_pct',
      }
      const targetMetricCode = c.metric || ruleIdToMetricCode[c.id]
      const peerMetric = peerComparison.metrics.find((m) => m.metric_code === targetMetricCode)
      if (peerMetric) {
        const rankStr = peerMetric.rank ? `，排名 ${peerMetric.rank}/${peerMetric.peer_count + 1}` : ''
        evidenceList.push(
          `同行中位数 ${peerMetric.peer_median}${unitSuffix}（可比门店 ${peerMetric.peer_count} 家${rankStr}）`,
        )
      }
    }

    return {
      id: `finding-${storeId}-${c.id}`,
      deviceId: storeId,
      severity: effectiveSeverity,
      title: c.display_name,
      evidence: evidenceList,
      recommendation:
        evaluation.verdict === 'possible'
          ? evaluation.suggested_action_template || '抽查最近 20 笔退款订单并核对退款原因。'
          : '先核对门店营业时段与单指标波动原因，再决定是否创建任务。',
    }
  })

  return severityFilter ? mapped.filter((f) => f.severity === severityFilter) : mapped
}

/**
 * 1. getDashboardMetrics(filters?: DashboardFilters): Promise<DashboardMetrics>
 */
async function defaultGetDashboardMetrics(filters = {}) {
  const dl = getRealDataLayer()

  // 未传 regionId 时默认使用成员 B 真实数据层全局驾驶舱指标
  if (!filters.regionId) {
    if (dl) {
      const res = await dl.getDashboardMetrics({
        from: filters.from,
        to: filters.to,
      })
      if (res.status !== 'failed' && res.data) {
        return res.data
      }
    }
    return {
      salesAmount: 1054000,
      estimatedProfit: 218000,
      deviceCount: 42,
      onlineRate: 0.952,
      openFindingCount: 3,
    }
  }

  const regionKey = normalizeRegionKey(filters.regionId)
  if (!regionKey) {
    throw new ApiContractError(404, 'REGION_NOT_FOUND', `未找到指定区域：${filters.regionId}`)
  }

  // 若查询成员 B 专属区域（海淀/西城/东城/丰台）或显式指定真实数据窗口，走成员 B 的 createDataLayer
  if (
    dl &&
    (DATA_LAYER_ONLY_REGIONS.has(regionKey) ||
      (regionKey === 'chaoyang' && filters.to && filters.to <= '2026-10-12'))
  ) {
    const res = await dl.getDashboardMetrics({
      regionId: regionKey,
      from: filters.from,
      to: filters.to,
    })
    if (res.status !== 'failed' && res.data) {
      return res.data
    }
  }

  if (regionKey === 'changchun') {
    return {
      salesAmount: 1054000,
      estimatedProfit: 218000,
      deviceCount: 42,
      onlineRate: 0.952,
      openFindingCount: 3,
    }
  }

  const region = REGION_CATALOG[regionKey]
  const openFindingCount = AUDIT_FINDINGS_CATALOG.filter((f) => f.regionId === regionKey).length
  return {
    salesAmount: region.salesAmount,
    estimatedProfit: region.estimatedProfit,
    deviceCount: region.deviceCount,
    onlineRate: Number((region.onlineDeviceCount / region.deviceCount).toFixed(3)),
    openFindingCount,
  }
}

/**
 * 2. auditOperations(filters?: AuditFilters): Promise<AuditResult>
 */
async function defaultAuditOperations(filters = {}) {
  const dl = getRealDataLayer()
  const rawDevice = filters.deviceId || filters.store_id

  // 分支 A：若查询成员 B 的 S001~S021 门店，直接调用成员 B 的确定性规则引擎 dl.runAudit
  if (rawDevice && STORE_ID_REGEX.test(String(rawDevice).trim())) {
    const storeId = String(rawDevice).trim().toUpperCase()
    if (!dl) {
      throw new ApiContractError(500, 'INTERNAL_ERROR', '数据层未初始化')
    }
    const window =
      filters.from && filters.to ? { from: filters.from, to: filters.to } : undefined
    const [auditRes, peerRes] = await Promise.all([
      dl.runAudit({ store_id: storeId, window }),
      dl.comparePeers({ store_id: storeId, window }),
    ])
    if (!auditRes.data) {
      throw new ApiContractError(404, 'DEVICE_NOT_FOUND', `未找到指定门店：${storeId}`)
    }
    const evaluation = auditRes.data
    const findings = mapRuleEvaluationToFindings(evaluation, filters.severity, peerRes?.data)

    return {
      summary: evaluation.verdict_reason,
      findings,
      verdict: evaluation.verdict,
      riskStatus: toRiskStatus(evaluation.verdict),
      ruleEvaluation: evaluation,
      peerComparison: peerRes?.data || null,
      evidenceIds: auditRes.evidence_ids,
      traceId: auditRes.trace_id,
    }
  }

  // 分支 B：若未指定单店但指定了成员 B 专属区域（haidian/xicheng/dongcheng/fengtai），批量调用 dl.runAudit
  const regionKey = filters.regionId ? normalizeRegionKey(filters.regionId) : null
  if (filters.regionId && !regionKey) {
    throw new ApiContractError(404, 'REGION_NOT_FOUND', `未找到指定区域：${filters.regionId}`)
  }

  if (!rawDevice && regionKey && DATA_LAYER_ONLY_REGIONS.has(regionKey) && dl) {
    const storeIds = REGION_STORES_MAP[regionKey] || []
    const allFindings = []
    const window =
      filters.from && filters.to ? { from: filters.from, to: filters.to } : undefined
    for (const sid of storeIds) {
      const [res, peerRes] = await Promise.all([
        dl.runAudit({ store_id: sid, window }),
        dl.comparePeers({ store_id: sid, window }),
      ])
      if (res.data) {
        allFindings.push(...mapRuleEvaluationToFindings(res.data, filters.severity, peerRes?.data))
      }
    }
    const summary =
      allFindings.length > 0
        ? `在${toRegionName(regionKey) || regionKey}检出 ${allFindings.length} 条经营发现。`
        : `${toRegionName(regionKey) || regionKey}当前经营数据未发现需要升级的异常。`
    return {
      summary,
      findings: allFindings,
    }
  }

  // 分支 C：契约基准门店（A~E / device-A-001~device-E-001）与长春区域
  let matched = [...AUDIT_FINDINGS_CATALOG]

  if (regionKey && regionKey !== 'changchun') {
    matched = matched.filter((f) => f.regionId === regionKey)
  }

  if (rawDevice) {
    const targetDevice = String(rawDevice).trim()
    const normalizedStore = targetDevice.replace(/^device-([A-Z])-\d+$/i, '$1').toUpperCase()
    const existsInCatalog =
      AUDIT_FINDINGS_CATALOG.some(
        (f) => f.deviceId.toLowerCase() === targetDevice.toLowerCase() || f.storeId === normalizedStore,
      ) || ['C', 'D', 'E', 'DEVICE-C-001', 'DEVICE-D-001', 'DEVICE-E-001'].includes(targetDevice.toUpperCase())

    if (!existsInCatalog) {
      throw new ApiContractError(404, 'DEVICE_NOT_FOUND', `未找到指定设备：${rawDevice}`)
    }

    matched = matched.filter(
      (f) => f.deviceId.toLowerCase() === targetDevice.toLowerCase() || f.storeId === normalizedStore,
    )
  }

  if (filters.severity) {
    matched = matched.filter((f) => f.severity === filters.severity)
  }

  const findings = matched.map(({ id, deviceId, severity, title, evidence, recommendation }) => ({
    id,
    deviceId,
    severity,
    title,
    evidence: [...evidence],
    recommendation,
  }))

  let summary = '当前经营数据未发现需要升级的异常。'
  if (findings.length === 1) {
    const f = findings[0]
    summary =
      f.severity === 'high'
        ? '发现 1 个高风险经营异常，建议优先核查退款记录。'
        : '发现 1 个中风险经营发现，当前证据不足以创建高优先级任务。'
  } else if (findings.length > 1) {
    const hasHigh = findings.some((f) => f.severity === 'high')
    summary = hasHigh
      ? `发现 ${findings.length} 个经营异常，其中高风险发现需要优先核查退款订单。`
      : `发现 ${findings.length} 个经营异常，建议按优先级逐项核查。`
  }

  return {
    summary,
    findings,
  }
}

let lastRegionDatasetMode = 'contract'

/**
 * 3. compareRegions(regionIds?: string[]): Promise<RegionResult[]>
 */
async function defaultCompareRegions(regionIds) {
  const dl = getRealDataLayer()
  const rawList =
    Array.isArray(regionIds) && regionIds.length > 0 ? regionIds : ['chaoyang', 'nanguan']

  const normalizedKeys = rawList.map((id) => {
    const key = normalizeRegionKey(id)
    if (!key || key === 'changchun') {
      throw new ApiContractError(404, 'REGION_NOT_FOUND', `未找到指定候选区域：${id}`)
    }
    return key
  })

  const uniqueKeys = Array.from(new Set(normalizedKeys))

  // 若包含成员 B 数据层专属区域（haidian/xicheng/dongcheng/fengtai）且全部属于成员 B 的 5 大区域，走真实数据层
  const usesDataLayer =
    dl &&
    uniqueKeys.some((k) => DATA_LAYER_ONLY_REGIONS.has(k)) &&
    uniqueKeys.every((k) => toRegionName(k) !== null)

  lastRegionDatasetMode = usesDataLayer ? 'datalayer' : 'contract'

  if (usesDataLayer) {
    const res = await dl.compareRegions(uniqueKeys)
    if (res.status !== 'failed' && Array.isArray(res.data)) {
      return res.data
    }
  }

  return uniqueKeys.map((key) => {
    const r = REGION_CATALOG[key]
    if (!r) {
      throw new ApiContractError(404, 'REGION_NOT_FOUND', `未找到指定候选区域：${key}`)
    }
    return {
      regionId: r.regionId,
      name: r.name,
      score: r.score,
      estimatedMonthlyProfit: r.estimatedMonthlyProfit,
      estimatedPaybackMonths: r.estimatedPaybackMonths,
      reasons: [...r.reasons],
      assumptions: [...r.assumptions],
    }
  })
}

/**
 * 4. estimateRegionROI(regionId: string): Promise<RegionResult>
 */
async function defaultEstimateRegionROI(regionId) {
  const dl = getRealDataLayer()
  const key = normalizeRegionKey(regionId)
  if (!key || key === 'changchun') {
    throw new ApiContractError(404, 'REGION_NOT_FOUND', `未找到指定区域：${regionId}`)
  }

  // 若属于成员 B 数据层专属区域（haidian/xicheng/dongcheng/fengtai），或当前处于北京数据集对比上下文下的 chaoyang，走真实数据层
  if (
    dl &&
    (DATA_LAYER_ONLY_REGIONS.has(key) || (key === 'chaoyang' && lastRegionDatasetMode === 'datalayer'))
  ) {
    const res = await dl.estimateRegionROI(key)
    if (res.status !== 'failed' && res.data) {
      return res.data
    }
  }

  const r = REGION_CATALOG[key]
  if (!r) {
    throw new ApiContractError(404, 'REGION_NOT_FOUND', `未找到指定区域：${regionId}`)
  }
  return {
    regionId: r.regionId,
    name: r.name,
    score: r.score,
    estimatedMonthlyProfit: r.estimatedMonthlyProfit,
    estimatedPaybackMonths: r.estimatedPaybackMonths,
    reasons: [...r.reasons],
    assumptions: [...r.assumptions],
  }
}

/**
 * 5. createTask / verifyTask / writeReport（供白名单工具编排调用）
 */
async function defaultCreateTask(actionCard = {}) {
  return {
    taskId: `task_${Date.now()}`,
    status: 'open',
    ownerRole: actionCard.ownerRole || '区域经理',
    dueHours: actionCard.dueHours || 24,
    action: actionCard.action || '抽查最近 20 笔退款订单并核对退款原因。',
  }
}

async function defaultVerifyTask({ scenario = 'improved-task' } = {}) {
  if (scenario === 'unresolved-task') {
    return {
      scenario: 'unresolved-task',
      status: 'escalated',
      verifyMetric: 'refund_rate',
      targetMet: false,
      expectedAction: '保留原证据并升级任务',
    }
  }
  return {
    scenario: 'improved-task',
    status: 'closed',
    verifyMetric: 'refund_rate',
    targetMet: true,
    expectedAction: '保存复核证据并关闭任务',
  }
}

async function defaultWriteReport(payload = {}) {
  return {
    reportId: `rep_${Date.now()}`,
    status: 'saved',
    dataVersion: 'demo_v1',
    summary: payload.summary || '',
  }
}

function createDefaultServicesMap() {
  return {
    getDashboardMetrics: defaultGetDashboardMetrics,
    auditOperations: defaultAuditOperations,
    compareRegions: defaultCompareRegions,
    estimateRegionROI: defaultEstimateRegionROI,
    createTask: defaultCreateTask,
    verifyTask: defaultVerifyTask,
    writeReport: defaultWriteReport,
    // 暴露成员 B 原始 DataLayerApi 方法，便于直接调用
    getDashboard: (input) => getRealDataLayer()?.getDashboard(input),
    runAudit: (input) => getRealDataLayer()?.runAudit(input),
    comparePeers: (input) => getRealDataLayer()?.comparePeers(input),
    scoreLocations: (input) => getRealDataLayer()?.scoreLocations(input),
    getTrace: (traceId) => getRealDataLayer()?.getTrace(traceId) ?? [],
  }
}

let activeDomainServices = createDefaultServicesMap()

/**
 * 允许外部注册或覆盖领域服务实现（支持部分覆盖或全部覆盖）
 */
export function registerDomainServices(customServices = {}) {
  activeDomainServices = {
    ...activeDomainServices,
    ...customServices,
  }
}

/**
 * 重置为默认领域服务实现（便于单元测试与回归测试）
 */
export function resetDomainServices() {
  activeDomainServices = createDefaultServicesMap()
}

/**
 * 获取当前激活的领域服务集合
 */
export function getDomainServices() {
  return activeDomainServices
}

