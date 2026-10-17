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
  { id: 'changchun', patterns: ['长春市', '长春', 'changchun', '全市'] },
  { id: 'chaoyang', patterns: ['朝阳区', '朝阳', 'chaoyang'] },
  { id: 'nanguan', patterns: ['南关区', '南关', 'nanguan'] },
  { id: 'kuancheng', patterns: ['宽城区', '宽城', 'kuancheng'] },
  { id: 'erdao', patterns: ['二道区', '二道', 'erdao'] },
  { id: 'luyuan', patterns: ['绿园区', '绿园', 'luyuan'] },
  { id: 'haidian', patterns: ['海淀区', '海淀', 'haidian'] },
  { id: 'xicheng', patterns: ['西城区', '西城', 'xicheng'] },
  { id: 'dongcheng', patterns: ['东城区', '东城', 'dongcheng'] },
  { id: 'fengtai', patterns: ['丰台区', '丰台', 'fengtai'] },
]

const STORE_KEYWORDS = [
  { storeId: 'A', deviceId: 'device-A-001', regionId: 'chaoyang', patterns: ['a店', 'a 店', '朝阳旗舰店', 'device-a-001'] },
  { storeId: 'B', deviceId: 'device-B-001', regionId: 'nanguan', patterns: ['b店', 'b 店', '南关生活店', 'device-b-001'] },
  { storeId: 'C', deviceId: 'device-C-001', regionId: 'kuancheng', patterns: ['c店', 'c 店', '宽城北站店', 'device-c-001'] },
  { storeId: 'D', deviceId: 'device-D-001', regionId: 'erdao', patterns: ['d店', 'd 店', '二道东盛店', 'device-d-001'] },
  { storeId: 'E', deviceId: 'device-E-001', regionId: 'luyuan', patterns: ['e店', 'e 店', '绿园吾悦店', 'device-e-001'] },
  { storeId: 'S001', deviceId: 'S001', regionId: 'chaoyang', patterns: ['s001', '朝阳红旗街店'] },
  { storeId: 'S002', deviceId: 'S002', regionId: 'chaoyang', patterns: ['s002', '朝阳桂林路店'] },
  { storeId: 'S003', deviceId: 'S003', regionId: 'chaoyang', patterns: ['s003', '朝阳前进大街店'] },
  { storeId: 'S004', deviceId: 'S004', regionId: 'chaoyang', patterns: ['s004', '朝阳欧亚商都店'] },
  { storeId: 'S021', deviceId: 'S021', regionId: 'chaoyang', patterns: ['s021', '朝阳重庆路南店'] },
  { storeId: 'S005', deviceId: 'S005', regionId: 'nanguan', patterns: ['s005', '南关重庆路店'] },
  { storeId: 'S006', deviceId: 'S006', regionId: 'nanguan', patterns: ['s006', '南关活力城店'] },
  { storeId: 'S007', deviceId: 'S007', regionId: 'nanguan', patterns: ['s007', '南关净月店'] },
  { storeId: 'S008', deviceId: 'S008', regionId: 'nanguan', patterns: ['s008', '南关亚泰大街店'] },
  { storeId: 'S009', deviceId: 'S009', regionId: 'kuancheng', patterns: ['s009', '宽城万达店'] },
  { storeId: 'S010', deviceId: 'S010', regionId: 'kuancheng', patterns: ['s010', '宽城黑水路店'] },
  { storeId: 'S011', deviceId: 'S011', regionId: 'kuancheng', patterns: ['s011', '宽城人民广场店'] },
  { storeId: 'S012', deviceId: 'S012', regionId: 'kuancheng', patterns: ['s012', '宽城凯旋路店'] },
  { storeId: 'S013', deviceId: 'S013', regionId: 'erdao', patterns: ['s013', '二道吉林大路店'] },
  { storeId: 'S014', deviceId: 'S014', regionId: 'erdao', patterns: ['s014', '二道临河街店'] },
  { storeId: 'S015', deviceId: 'S015', regionId: 'erdao', patterns: ['s015', '二道自由大路店'] },
  { storeId: 'S016', deviceId: 'S016', regionId: 'erdao', patterns: ['s016', '二道远达大街店'] },
  { storeId: 'S017', deviceId: 'S017', regionId: 'luyuan', patterns: ['s017', '绿园春城大街店'] },
  { storeId: 'S018', deviceId: 'S018', regionId: 'luyuan', patterns: ['s018', '绿园正阳街店'] },
  { storeId: 'S019', deviceId: 'S019', regionId: 'luyuan', patterns: ['s019', '绿园景阳大路店'] },
  { storeId: 'S020', deviceId: 'S020', regionId: 'luyuan', patterns: ['s020', '绿园西站店'] },
]

/**
 * 将中文区域名或别名规范化为标准契约 regionId（供规则解析与 LLM 规划合同校验共同使用）
 */
export function normalizeRegionIdAlias(rawRegion) {
  if (typeof rawRegion !== 'string' || !rawRegion.trim()) return null
  const lower = rawRegion.trim().toLowerCase()
  for (const item of REGION_KEYWORDS) {
    if (item.id === lower || item.patterns.some((p) => lower.includes(p))) {
      return item.id
    }
  }
  return null
}

/**
 * 将中文门店名或设备别名规范化为标准契约 deviceId（供规则解析与 LLM 规划合同校验共同使用）
 */
export function normalizeDeviceIdAlias(rawDevice) {
  if (typeof rawDevice !== 'string' || !rawDevice.trim()) return null
  const lower = rawDevice.trim().toLowerCase()
  for (const store of STORE_KEYWORDS) {
    if (store.deviceId.toLowerCase() === lower || store.patterns.some((p) => lower.includes(p))) {
      return store.deviceId
    }
  }
  return null
}

/**
 * 解析自然语言 query 并生成初始工具调用计划（支持基于 memoryContext 的多轮指代消解与复杂开放复合问题拆解）
 */
export function parseIntentAndPlanTools(query, memoryContext = null) {
  const lower = String(query || '').toLowerCase()

  // 1. 提取涉及的区域列表（不含全城默认 changchun，除非专门查询大盘）
  const matchedRegions = []
  for (const item of REGION_KEYWORDS) {
    if (item.id === 'changchun') continue
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

  // 5. 判定各业务维度意图与复杂开放式提问特征
  const isRegionTopic =
    matchedRegions.length >= 2 ||
    lower.includes('投放') ||
    lower.includes('选址') ||
    lower.includes('扩张') ||
    lower.includes('开店') ||
    lower.includes('回本') ||
    lower.includes('收益') ||
    lower.includes('区域比较') ||
    lower.includes('比较朝阳') ||
    lower.includes('哪个区') ||
    lower.includes('roi')

  const isAuditTopic =
    Boolean(matchedStore) ||
    lower.includes('为什么') ||
    lower.includes('表现差') ||
    lower.includes('异常') ||
    lower.includes('隐患') ||
    lower.includes('问题') ||
    lower.includes('亏损') ||
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
    lower.includes('整体经营') ||
    lower.includes('整体生意') ||
    lower.includes('全面盘点') ||
    lower.includes('经营状况')

  const isVerifyTopic =
    lower.includes('复核') || lower.includes('关闭任务') || lower.includes('升级任务') || lower.includes('验证任务') || lower.includes('验证')

  const isCreateTaskTopic =
    lower.includes('创建任务') || lower.includes('生成任务') || lower.includes('派单') || lower.includes('整改任务') || lower.includes('建个工单')

  const isWriteReportTopic =
    lower.includes('生成报告') || lower.includes('保存报告') || lower.includes('写报告') || lower.includes('输出报告')

  // 判断是否明确指向门店/设备审计（区分“区域投放风险”与“门店经营异常审计”）
  const hasExplicitAuditTarget =
    Boolean(matchedStore) ||
    lower.includes('门店') ||
    lower.includes('设备') ||
    lower.includes('审计') ||
    lower.includes('排查') ||
    lower.includes('退款') ||
    lower.includes('表现差') ||
    lower.includes('高风险')

  // 判断是否为跨维度复合问题或开放式战略诊断问题
  const matchedTopicCount = [isDashboardTopic, isAuditTopic, isRegionTopic, isVerifyTopic].filter(Boolean).length
  const hasOpenStrategyCue =
    matchedTopicCount === 0 ||
    lower.includes('怎么看') ||
    lower.includes('全面') ||
    lower.includes('下一步') ||
    lower.includes('综合建议') ||
    lower.includes('战略')
  const isOpenStrategyQuestion = hasOpenStrategyCue || matchedTopicCount >= 2

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
  } else if (isRegionTopic && !hasExplicitAuditTarget && !isDashboardTopic && !hasOpenStrategyCue) {
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
  } else if (isDashboardTopic && !hasExplicitAuditTarget && !isRegionTopic && !hasOpenStrategyCue) {
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
    // 门店审计、跨维度复合问题或开放式综合经营诊断
    const isMultiDimension =
      (isRegionTopic && hasExplicitAuditTarget) ||
      (isDashboardTopic && isRegionTopic) ||
      hasOpenStrategyCue
    intentType = isMultiDimension ? INTENT_TYPES.COMPREHENSIVE : INTENT_TYPES.STORE_AUDIT

    if (isDashboardTopic || hasOpenStrategyCue) {
      plannedTools.push({
        toolName: 'get_dashboard',
        args: filters.regionId ? { regionId: filters.regionId } : {},
      })
    }

    plannedTools.push({
      toolName: 'run_audit',
      args: filters,
    })

    // 如果问题同时提到“同类”、“相比”、“对标”、区域投放对比，或属于开放式全局战略诊断问题，组合规划 compare_regions (+ estimate_region_roi)
    if (
      lower.includes('同类') ||
      lower.includes('相比') ||
      lower.includes('对标') ||
      lower.includes('比较') ||
      isRegionTopic ||
      hasOpenStrategyCue
    ) {
      const isBeijingCsvStore = Boolean(matchedStore && /^S0\d{2}$/i.test(matchedStore.deviceId))
      const fallbackSecondRegion = isBeijingCsvStore
        ? matchedStore.regionId === 'chaoyang'
          ? 'haidian'
          : 'chaoyang'
        : 'nanguan'
      const regionIds =
        matchedRegions.length >= 2
          ? matchedRegions
          : matchedStore
            ? [matchedStore.regionId, fallbackSecondRegion]
            : matchedRegions.length === 1
              ? [matchedRegions[0], ['haidian', 'xicheng', 'dongcheng', 'fengtai'].includes(matchedRegions[0]) ? 'chaoyang' : 'nanguan']
              : ['chaoyang', 'nanguan']
      const uniqueRegionIds = Array.from(new Set(regionIds))
      plannedTools.push({
        toolName: 'compare_regions',
        args: { regionIds: uniqueRegionIds },
      })
      if ((isRegionTopic && !matchedStore) || hasOpenStrategyCue) {
        plannedTools.push({
          toolName: 'estimate_region_roi',
          args: { regionId: uniqueRegionIds[0] },
        })
      }
    }
  }

  // 若用户明确要求创建任务或保存报告，追加对应受控写工具
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
      contractFlags: {
        allowCreateTask: isCreateTaskTopic && !forceInsufficient,
        allowVerifyTask: isVerifyTopic && !forceInsufficient,
        allowWriteReport: isWriteReportTopic && !forceInsufficient,
        isComplexOpenQuery: isOpenStrategyQuestion,
        matchedTopicCount,
      },
    },
    plannedTools,
  }
}
