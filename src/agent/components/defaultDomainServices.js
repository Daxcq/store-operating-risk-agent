/**
 * 第三层（组件层 - 领域服务适配底座）：defaultDomainServices.js
 *
 * 职责：
 * 1. 提供与成员 B 契约完全一致的默认领域函数实现（基于长春市 5 店模拟数据与 docs/API_CONTRACT.md）；
 * 2. 支持依赖注入（registerDomainServices），当成员 B 的真实模块合入时可无缝切换；
 * 3. 严格遵守金额单位（人民币元）、评分范围（0..100）、无法估算回本周期返回 null 等契约规则。
 */

import { ApiContractError } from '../safety.js'

/**
 * 区域与门店基础模拟数据（对齐 docs/API_CONTRACT.md 与 src/main.jsx）
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
 * 区域别名映射（支持中文名或 storeId 映射）
 */
const REGION_ALIAS_MAP = {
  changchun: 'changchun',
  长春: 'changchun',
  长春市: 'changchun',
  chaoyang: 'chaoyang',
  朝阳: 'chaoyang',
  朝阳区: 'chaoyang',
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
  if (!raw) return 'changchun'
  const key = String(raw).trim().toLowerCase()
  return REGION_ALIAS_MAP[key] || REGION_ALIAS_MAP[raw] || null
}

/**
 * 1. getDashboardMetrics(filters?: DashboardFilters): Promise<DashboardMetrics>
 */
async function defaultGetDashboardMetrics(filters = {}) {
  const regionKey = normalizeRegionKey(filters.regionId)
  if (!regionKey) {
    throw new ApiContractError(404, 'REGION_NOT_FOUND', `未找到指定区域：${filters.regionId}`)
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
  let matched = [...AUDIT_FINDINGS_CATALOG]

  if (filters.regionId) {
    const regionKey = normalizeRegionKey(filters.regionId)
    if (!regionKey) {
      throw new ApiContractError(404, 'REGION_NOT_FOUND', `未找到指定区域：${filters.regionId}`)
    }
    if (regionKey !== 'changchun') {
      matched = matched.filter((f) => f.regionId === regionKey)
    }
  }

  if (filters.deviceId) {
    const targetDevice = String(filters.deviceId).trim()
    // 支持传 'A' 或 'device-A-001'
    const normalizedStore = targetDevice.replace(/^device-([A-Z])-\d+$/i, '$1').toUpperCase()
    const existsInCatalog =
      AUDIT_FINDINGS_CATALOG.some(
        (f) => f.deviceId.toLowerCase() === targetDevice.toLowerCase() || f.storeId === normalizedStore,
      ) || ['C', 'D', 'E', 'DEVICE-C-001', 'DEVICE-D-001', 'DEVICE-E-001'].includes(targetDevice.toUpperCase())

    if (!existsInCatalog) {
      throw new ApiContractError(404, 'DEVICE_NOT_FOUND', `未找到指定设备：${filters.deviceId}`)
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

/**
 * 3. compareRegions(regionIds?: string[]): Promise<RegionResult[]>
 */
async function defaultCompareRegions(regionIds) {
  const targetKeys =
    Array.isArray(regionIds) && regionIds.length > 0
      ? regionIds.map((id) => {
          const key = normalizeRegionKey(id)
          if (!key || key === 'changchun' || !REGION_CATALOG[key]) {
            throw new ApiContractError(404, 'REGION_NOT_FOUND', `未找到指定候选区域：${id}`)
          }
          return key
        })
      : ['chaoyang', 'nanguan']

  const uniqueKeys = Array.from(new Set(targetKeys))
  return uniqueKeys.map((key) => {
    const r = REGION_CATALOG[key]
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
  const key = normalizeRegionKey(regionId)
  if (!key || key === 'changchun' || !REGION_CATALOG[key]) {
    throw new ApiContractError(404, 'REGION_NOT_FOUND', `未找到指定区域：${regionId}`)
  }
  const r = REGION_CATALOG[key]
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

let activeDomainServices = {
  getDashboardMetrics: defaultGetDashboardMetrics,
  auditOperations: defaultAuditOperations,
  compareRegions: defaultCompareRegions,
  estimateRegionROI: defaultEstimateRegionROI,
  createTask: defaultCreateTask,
  verifyTask: defaultVerifyTask,
  writeReport: defaultWriteReport,
}

/**
 * 允许成员 B 注册真实领域服务实现（支持部分覆盖或全部覆盖）
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
  activeDomainServices = {
    getDashboardMetrics: defaultGetDashboardMetrics,
    auditOperations: defaultAuditOperations,
    compareRegions: defaultCompareRegions,
    estimateRegionROI: defaultEstimateRegionROI,
    createTask: defaultCreateTask,
    verifyTask: defaultVerifyTask,
    writeReport: defaultWriteReport,
  }
}

/**
 * 获取当前激活的领域服务集合
 */
export function getDomainServices() {
  return activeDomainServices
}
