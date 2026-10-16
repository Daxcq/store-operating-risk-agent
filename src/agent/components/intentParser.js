/**
 * 第三层（组件层 - 意图与参数解析器）：intentParser.js
 *
 * 职责：
 * 1. 从自然语言 query 中识别业务意图类型（INTENT_TYPES）；
 * 2. 提取结构化过滤参数（deviceId、regionId、regionIds、severity、from/to）；
 * 3. 生成受控 Plan-and-Execute 第一阶段的初始白名单工具执行计划（plannedTools）。
 */

import { INTENT_TYPES } from '../definition.js'

const REGION_KEYWORDS = [
  { id: 'chaoyang', patterns: ['朝阳区', '朝阳', 'chaoyang'] },
  { id: 'nanguan', patterns: ['南关区', '南关', 'nanguan'] },
  { id: 'kuancheng', patterns: ['宽城区', '宽城', 'kuancheng'] },
  { id: 'erdao', patterns: ['二道区', '二道', 'erdao'] },
  { id: 'luyuan', patterns: ['绿园区', '绿园', 'luyuan'] },
]

const STORE_KEYWORDS = [
  { storeId: 'A', deviceId: 'device-A-001', regionId: 'chaoyang', patterns: ['a店', 'a 店', '朝阳旗舰店', 'device-a-001'] },
  { storeId: 'B', deviceId: 'device-B-001', regionId: 'nanguan', patterns: ['b店', 'b 店', '南关生活店', 'device-b-001'] },
  { storeId: 'C', deviceId: 'device-C-001', regionId: 'kuancheng', patterns: ['c店', 'c 店', '宽城北站店', 'device-c-001'] },
  { storeId: 'D', deviceId: 'device-D-001', regionId: 'erdao', patterns: ['d店', 'd 店', '二道东盛店', 'device-d-001'] },
  { storeId: 'E', deviceId: 'device-E-001', regionId: 'luyuan', patterns: ['e店', 'e 店', '绿园吾悦店', 'device-e-001'] },
]

/**
 * 解析自然语言 query 并生成初始工具调用计划（支持基于 memoryContext 的多轮指代消解与上下文继承）
 */
export function parseIntentAndPlanTools(query, memoryContext = null) {
  const lower = String(query || '').toLowerCase()

  // 1. 提取涉及的区域列表
  const matchedRegions = []
  for (const item of REGION_KEYWORDS) {
    if (item.patterns.some((p) => lower.includes(p))) {
      matchedRegions.push(item.id)
    }
  }

  // 2. 提取涉及的门店/设备
  let matchedStore = null
  for (const store of STORE_KEYWORDS) {
    if (store.patterns.some((p) => lower.includes(p))) {
      matchedStore = store
      break
    }
  }

  // 2.1 多轮对话指代消解（如“它”、“这家店”、“该门店”、“刚才那家”或未显式指名但存在上一轮焦点门店）
  if (!matchedStore && memoryContext?.lastDeviceId) {
    const inheritedStore = STORE_KEYWORDS.find((s) => s.deviceId === memoryContext.lastDeviceId)
    if (inheritedStore && matchedRegions.length === 0) {
      matchedStore = inheritedStore
    }
  }

  if (matchedRegions.length === 0 && Array.isArray(memoryContext?.lastRegionIds) && memoryContext.lastRegionIds.length > 0) {
    if (lower.includes('这些区域') || lower.includes('那两个区') || lower.includes('刚才的区域')) {
      matchedRegions.push(...memoryContext.lastRegionIds)
    }
  }

  // 3. 提取风险严重度过滤词
  let severity
  if (lower.includes('高风险') || lower.includes('严重') || lower.includes('high')) {
    severity = 'high'
  } else if (lower.includes('中风险') || lower.includes('medium')) {
    severity = 'medium'
  } else if (lower.includes('低风险') || lower.includes('low')) {
    severity = 'low'
  }

  // 4. 检测是否明确触发“数据不足/样本不足”场景探测
  const forceInsufficient =
    lower.includes('数据不足') ||
    lower.includes('少于3家') ||
    lower.includes('少于 3 家') ||
    lower.includes('样本不足') ||
    lower.includes('insufficient')

  // 5. 判定主意图类型与规划工具队列
  const isRegionTopic =
    matchedRegions.length >= 2 ||
    lower.includes('投放') ||
    lower.includes('选址') ||
    lower.includes('回本') ||
    lower.includes('收益') ||
    lower.includes('区域比较') ||
    lower.includes('比较朝阳') ||
    lower.includes('roi')

  const isAuditTopic =
    Boolean(matchedStore) ||
    lower.includes('为什么') ||
    lower.includes('表现差') ||
    lower.includes('异常') ||
    lower.includes('退款') ||
    lower.includes('审计') ||
    lower.includes('风险') ||
    lower.includes('先改什么')

  const isDashboardTopic =
    lower.includes('驾驶舱') ||
    lower.includes('全局') ||
    lower.includes('大盘') ||
    lower.includes('总览') ||
    lower.includes('在线率') ||
    lower.includes('整体经营')

  const isVerifyTopic =
    lower.includes('复核') || lower.includes('关闭任务') || lower.includes('升级任务') || lower.includes('验证任务') || lower.includes('验证')

  const isCreateTaskTopic =
    lower.includes('创建任务') || lower.includes('生成任务') || lower.includes('派单') || lower.includes('整改任务')

  const isWriteReportTopic = lower.includes('生成报告') || lower.includes('保存报告')

  const filters = {}
  if (matchedStore) {
    filters.deviceId = matchedStore.deviceId
  }
  if (severity) {
    filters.severity = severity
  }
  if (matchedRegions.length === 1 && !matchedStore) {
    filters.regionId = matchedRegions[0]
  }
  if (memoryContext?.lastTaskId) {
    filters.taskId = memoryContext.lastTaskId
  }

  const plannedTools = []
  let intentType = INTENT_TYPES.STORE_AUDIT

  if (forceInsufficient) {
    intentType = INTENT_TYPES.INSUFFICIENT_PROBE
    plannedTools.push(
      { toolName: 'run_audit', args: { ...filters, _simulateInsufficient: true } },
      { toolName: 'compare_regions', args: { regionIds: matchedRegions, _simulateInsufficient: true } },
    )
  } else if (isRegionTopic && !matchedStore) {
    intentType = INTENT_TYPES.REGION_COMPARISON
    const targetRegionIds = matchedRegions.length > 0 ? matchedRegions : ['chaoyang', 'nanguan']
    plannedTools.push({
      toolName: 'compare_regions',
      args: { regionIds: targetRegionIds },
    })
    // 对首位重点关注区域进一步调用 ROI 测算（契合 API_CONTRACT 5.4 示例）
    plannedTools.push({
      toolName: 'estimate_region_roi',
      args: { regionId: targetRegionIds[0] },
    })
  } else if (isDashboardTopic && !matchedStore && !isRegionTopic) {
    intentType = INTENT_TYPES.DASHBOARD_OVERVIEW
    plannedTools.push({
      toolName: 'get_dashboard',
      args: filters.regionId ? { regionId: filters.regionId } : {},
    })
    plannedTools.push({
      toolName: 'run_audit',
      args: filters,
    })
  } else if (isVerifyTopic) {
    intentType = INTENT_TYPES.TASK_VERIFICATION
    const unresolved = lower.includes('未改善') || lower.includes('未达标') || lower.includes('升级')
    plannedTools.push({
      toolName: 'run_audit',
      args: filters,
    })
    plannedTools.push({
      toolName: 'verify_task',
      args: { scenario: unresolved ? 'unresolved-task' : 'improved-task' },
    })
  } else {
    intentType = isRegionTopic && isAuditTopic ? INTENT_TYPES.COMPREHENSIVE : INTENT_TYPES.STORE_AUDIT
    plannedTools.push({
      toolName: 'run_audit',
      args: filters,
    })
    // 如果问题同时提到“同类”、“相比”、“对标”或区域对比，规划 compare_regions
    if (
      lower.includes('同类') ||
      lower.includes('相比') ||
      lower.includes('对标') ||
      lower.includes('比较') ||
      isRegionTopic
    ) {
      const regionIds =
        matchedRegions.length > 0
          ? matchedRegions
          : matchedStore
            ? [matchedStore.regionId, 'nanguan']
            : ['chaoyang', 'nanguan']
      plannedTools.push({
        toolName: 'compare_regions',
        args: { regionIds: Array.from(new Set(regionIds)) },
      })
    }
  }

  // 若用户明确要求创建任务或保存报告，追加对应受控工具
  if (isCreateTaskTopic && !forceInsufficient) {
    plannedTools.push({
      toolName: 'create_task',
      args: {
        ownerRole: '区域经理',
        dueHours: 24,
        action: '抽查最近 20 笔退款订单并核对退款原因。',
      },
    })
  }
  if (isWriteReportTopic && !forceInsufficient) {
    plannedTools.push({
      toolName: 'write_report',
      args: { summary: '自动生成的经营审计与对标报告' },
    })
  }

  return {
    intent: {
      type: intentType,
      filters,
      regionIds: matchedRegions,
      targetStoreId: matchedStore ? matchedStore.storeId : null,
      forceInsufficient,
    },
    plannedTools,
  }
}
