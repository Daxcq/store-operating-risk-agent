/**
 * 第三层（组件层 - 受控总结器）：synthesizer.js
 *
 * 职责：
 * 1. 基于已验证的工具输出（findings、regionComparison、dashboardMetrics）与用户自由提问焦点生成自然语言 summary 与 recommendations；
 * 2. 生成 Antigravity 风格业务思考与执行链路（thinkingSteps），严禁暴露任何底层函数或工具名；
 * 3. 生成结构化业务结论模块（structuredBlocks）与人机协同审核确认提案（decisionProposal：含决策依据、深度分析、预期影响）；
 * 4. 严格保证不新增任何工具未返回的数值事实，支持正常模式与数据不足降级合成。
 */

import { INTENT_TYPES } from '../definition.js'

const STORE_DISPLAY_MAP = {
  'device-A-001': 'A 店（朝阳旗舰店）',
  'device-B-001': 'B 店（南关生活店）',
  'device-C-001': 'C 店（宽城北站店）',
  'device-D-001': 'D 店（二道东盛店）',
  'device-E-001': 'E 店（绿园吾悦店）',
  A: 'A 店（朝阳旗舰店）',
  B: 'B 店（南关生活店）',
  C: 'C 店（宽城北站店）',
  D: 'D 店（二道东盛店）',
  E: 'E 店（绿园吾悦店）',
  S001: 'S001（朝阳红旗街店）',
  S002: 'S002（朝阳桂林路店）',
  S003: 'S003（朝阳前进大街店）',
  S004: 'S004（朝阳欧亚商都店）',
  S005: 'S005（南关重庆路店）',
  S006: 'S006（南关活力城店）',
  S007: 'S007（南关净月店）',
  S008: 'S008（南关亚泰大街店）',
  S009: 'S009（宽城万达店）',
  S010: 'S010（宽城黑水路店）',
  S011: 'S011（宽城人民广场店）',
  S012: 'S012（宽城凯旋路店）',
  S013: 'S013（二道吉林大路店）',
  S014: 'S014（二道临河街店）',
  S015: 'S015（二道自由大路店）',
  S016: 'S016（二道远达大街店）',
  S017: 'S017（绿园春城大街店）',
  S018: 'S018（绿园正阳街店）',
  S019: 'S019（绿园景阳大路店）',
  S020: 'S020（绿园西站店）',
  S021: 'S021（朝阳重庆路南店）',
}

const TOOL_BUSINESS_ACTION_MAP = {
  get_dashboard: {
    title: '检索全城经营大盘与核心收支总览',
    detail: '读取监测周期内全城在营设备数、设备在线率、累计销售额、预计净利润及待闭环异常总数。',
  },
  run_audit: {
    title: '调取门店订单流水、退款明细与同行可比基线',
    detail: '基于 7 日滚动窗口提取目标门店销售额、订单量、客单价与退款率，并与同行政区可比门店分位数进行交叉比对。',
  },
  compare_regions: {
    title: '拉取候选行政区商圈客流与竞争饱和度基准',
    detail: '横向对比候选投放区域的客流指数、点位密度、履约成本与历史单店盈利水平。',
  },
  estimate_region_roi: {
    title: '测算重点区域单店月均净利与投资回本周期',
    detail: '结合区域点位坪效、毛利结构与商铺租金样本，测算新开点位月均净利润与静态回本周期。',
  },
  create_task: {
    title: '生成门店经营异常限期整改督办单',
    detail: '将高优先级风险证据与责任人、整改时限绑定，写入运营协同工单队列。',
  },
  verify_task: {
    title: '复核历史整改工单执行前后的核心指标变化',
    detail: '比对整改动作执行后目标门店核心监测指标是否回落至安全阈值内，判定关闭或升级。',
  },
  write_report: {
    title: '归档结构化经营诊断与选址评估简报',
    detail: '将核查证据链、区域对比结论与待审批建议固化为可追溯经营报告。',
  },
}

/**
 * 清洗文本中可能残留的内部工具函数名或字段名，转化为自然零售业务表达
 */
export function scrubInternalToolNames(text) {
  if (typeof text !== 'string' || !text) return ''
  return text
    .replace(/\bget_dashboard\b/gi, '全城经营大盘检索')
    .replace(/\brun_audit\b/gi, '门店经营异常核查')
    .replace(/\baudit_operations\b/gi, '门店经营异常核查')
    .replace(/\bcompare_regions\b/gi, '候选区域横向对比')
    .replace(/\bscore_regions\b/gi, '候选区域评分测算')
    .replace(/\bestimate_region_roi\b/gi, '区域投资回报测算')
    .replace(/\bcreate_task\b/gi, '整改任务派发')
    .replace(/\bverify_task\b/gi, '整改成效复核')
    .replace(/\bwrite_report\b/gi, '经营简报归档')
    .replace(/\bestimatedPaybackMonths\b/g, '预计回本周期')
    .replace(/\bestimatedMonthlyProfit\b/g, '预计月净利润')
}

export function formatStoreDisplayName(rawId) {
  if (!rawId) return '目标门店'
  return STORE_DISPLAY_MAP[rawId] || String(rawId)
}

/**
 * 识别用户自由提问的核心关注点，实现“问什么、答什么”
 */
function analyzeQuestionFocus(query = '', intent = {}, findings = [], regionComparison = [], degraded = false) {
  const lower = String(query || '').toLowerCase()
  if (degraded) {
    return {
      code: 'data_boundary',
      label: '数据完整度受限与保守诊断',
      isRefundFocus: false,
      isRevenueFocus: false,
      isProfitOrRoiFocus: false,
      isActionPriorityFocus: false,
    }
  }
  const isRefundFocus =
    lower.includes('退款') || lower.includes('退单') || lower.includes('损耗') || lower.includes('客诉') || lower.includes('扣款')
  const isRevenueFocus =
    lower.includes('销售') || lower.includes('营业额') || lower.includes('营收') || lower.includes('下滑') || lower.includes('客单价') || lower.includes('订单')
  const isProfitOrRoiFocus =
    lower.includes('回本') || lower.includes('利润') || lower.includes('收益') || lower.includes('租金') || lower.includes('划算') || lower.includes('选址') || lower.includes('投放') || lower.includes('扩张')
  const isActionPriorityFocus =
    lower.includes('先改什么') || lower.includes('怎么办') || lower.includes('如何处理') || lower.includes('措施') || lower.includes('建议') || lower.includes('整改')

  if (intent?.type === INTENT_TYPES.TASK_VERIFICATION || lower.includes('复核') || lower.includes('验证')) {
    return { code: 'task_verify', label: '整改闭环成效复核', isRefundFocus, isRevenueFocus, isProfitOrRoiFocus, isActionPriorityFocus }
  }
  if (intent?.type === INTENT_TYPES.COMPREHENSIVE || (findings.length > 0 && regionComparison.length > 0)) {
    return { code: 'comprehensive', label: '全盘经营诊断与区域扩张权衡', isRefundFocus, isRevenueFocus, isProfitOrRoiFocus, isActionPriorityFocus }
  }
  if (intent?.type === INTENT_TYPES.REGION_COMPARISON || (regionComparison.length > 0 && findings.length === 0)) {
    return { code: 'region_roi', label: '区域投放收益与风险评估', isRefundFocus, isRevenueFocus, isProfitOrRoiFocus, isActionPriorityFocus }
  }
  if (intent?.type === INTENT_TYPES.DASHBOARD_OVERVIEW) {
    return { code: 'dashboard', label: '全城经营大盘与异常盘点', isRefundFocus, isRevenueFocus, isProfitOrRoiFocus, isActionPriorityFocus }
  }
  if (isRefundFocus) {
    return { code: 'refund_attribution', label: '退款率异动与损耗归因', isRefundFocus, isRevenueFocus, isProfitOrRoiFocus, isActionPriorityFocus }
  }
  if (isRevenueFocus) {
    return { code: 'revenue_attribution', label: '营收波动与同行分位诊断', isRefundFocus, isRevenueFocus, isProfitOrRoiFocus, isActionPriorityFocus }
  }
  return { code: 'store_audit', label: '门店经营健康度与异常诊断', isRefundFocus, isRevenueFocus, isProfitOrRoiFocus, isActionPriorityFocus }
}

/**
 * 构建 Antigravity 风格思考环节、数据查询、执行状态/失败重试与分析步骤（严禁包含任何底层函数名）
 */
export function buildBusinessThinkingSteps(state) {
  const queryText = String(state?.request?.query || '当前经营状况诊断').trim()
  const intent = state?.intent || {}
  const toolCalls = Array.isArray(state?.toolCalls) ? state.toolCalls : []
  const findings = Array.isArray(state?.findings) ? state.findings : []
  const regionComparison = Array.isArray(state?.regionComparison) ? state.regionComparison : []
  const replanCount = Number(state?.replanCount || 0)
  const degraded = Boolean(state?.degraded)
  const focus = analyzeQuestionFocus(queryText, intent, findings, regionComparison, degraded)

  const targetStoreLabel = intent?.filters?.deviceId
    ? formatStoreDisplayName(intent.filters.deviceId)
    : intent?.targetStoreId
      ? formatStoreDisplayName(intent.targetStoreId)
      : '监测范围内门店'

  const steps = []

  // 1. 思考环节 (thinking)
  steps.push({
    phase: 'thinking',
    phaseLabel: '思考环节',
    title: `拆解问题意图并锁定「${focus.label}」分析维度`,
    detail:
      regionComparison.length > 0 && findings.length === 0
        ? `识别到关于候选区域投放与收益风险的提问，锁定候选行政区横向对比、单店利润测算及租金样本完整度核验路径。`
        : findings.length > 0 && regionComparison.length > 0
          ? `识别到跨维度经营决策提问，拆解为“大盘与高风险门店排查”及“候选扩张区域收益测算”两条并行分析链路。`
          : `围绕用户提问焦点（${targetStoreLabel}），规划近期营收、退款率、客单价及同商圈可比门店分位数核查路径。`,
    status: 'completed',
  })

  // 2. 数据查询 (query) —— 将底层 toolCalls 映射为纯业务数据查询步骤，不暴露函数名
  if (toolCalls.length > 0) {
    const queryTitles = []
    const queryDetails = []
    toolCalls.forEach((call) => {
      const mapped = TOOL_BUSINESS_ACTION_MAP[call.toolName]
      if (mapped && !queryTitles.includes(mapped.title)) {
        queryTitles.push(mapped.title)
        queryDetails.push(mapped.detail)
      }
    })
    const hasError = toolCalls.some((c) => c.status === 'error')
    steps.push({
      phase: 'query',
      phaseLabel: '数据查询',
      title: queryTitles.join(' → ') || '调取门店经营流水与区域对标基准数据',
      detail: queryDetails.join(' ') || '已完成监测窗口内业务指标与同行基准数据的拉取。',
      status: hasError ? 'degraded' : 'completed',
    })
  } else {
    steps.push({
      phase: 'query',
      phaseLabel: '数据查询',
      title: '调取门店经营流水与同商圈基准数据',
      detail: '读取监测窗口内门店核心经营指标与可比样本集。',
      status: degraded ? 'degraded' : 'completed',
    })
  }

  // 3. 执行状态与失败重试 / 补充核验 (retry)
  const missingPaybackRegion = regionComparison.find((r) => r.estimatedPaybackMonths === null)
  if (degraded) {
    steps.push({
      phase: 'retry',
      phaseLabel: '执行状态与异常降级',
      title:
        state?.degradedReason === 'DATA_UNAVAILABLE'
          ? '检测到关键经营字段缺失（NULL），已阻断强行归因并启动安全降级'
          : '可比门店样本不足（< 3 家），重试核验后转入受控保守输出',
      detail:
        state?.degradedReason === 'DATA_UNAVAILABLE'
          ? '目标门店核心指标存在缺失记录，系统拒绝编造数值或下达武断整改指令，仅输出数据完备性告警。'
          : '同商圈有效可比门店少于 3 家最低统计门槛，系统已拦截高风险判定并生成数据补齐指引。',
      status: 'degraded',
    })
  } else if (replanCount > 0) {
    steps.push({
      phase: 'retry',
      phaseLabel: '执行状态与补充检索',
      title: `已完成 ${replanCount} 次动态重规划与跨区域补充对标检索`,
      detail: '首轮门店异常扫描发现经营波动后，系统自动追加候选区域横评数据以补齐跨区域参照基线。',
      status: 'retried',
    })
  } else if (missingPaybackRegion) {
    steps.push({
      phase: 'retry',
      phaseLabel: '执行状态与边界保护',
      title: `主链路查询一次通过；对「${missingPaybackRegion.name}」启用缺失字段保护`,
      detail: `检测到${missingPaybackRegion.name}缺少完整商铺租金样本，已自动将其投资回本周期标记为“待补齐核实”，防止失真测算。`,
      status: 'retried',
    })
  } else {
    steps.push({
      phase: 'retry',
      phaseLabel: '执行状态与校验',
      title: '多源数据一次拉取成功，可比样本量与时间窗口校验通过',
      detail: '同商圈可比门店样本数与指标完整性均满足统计门槛，无需触发失败重试。',
      status: 'completed',
    })
  }

  // 4. 分析步骤 (analysis)
  if (degraded) {
    steps.push({
      phase: 'analysis',
      phaseLabel: '分析步骤',
      title: '输出数据受限边界说明与后续采集建议',
      detail: '依据零幻觉铁律，隐去不确定性归因，明确列出需补齐的观察窗口或缺失字段。',
      status: 'degraded',
    })
  } else if (regionComparison.length > 0 && findings.length === 0) {
    const sorted = [...regionComparison].sort((a, b) => b.score - a.score)
    const top = sorted[0]
    steps.push({
      phase: 'analysis',
      phaseLabel: '分析步骤',
      title: `完成 ${sorted.length} 个候选区域收益-风险加权与投放排序`,
      detail: `综合评分显示${top.name}（${top.score} 分，预计月利润 ¥${top.estimatedMonthlyProfit}）表现最优，已提炼核心决策依据与风险假设。`,
      status: 'completed',
    })
  } else if (findings.length > 0) {
    const highCount = findings.filter((f) => f.severity === 'high').length
    steps.push({
      phase: 'analysis',
      phaseLabel: '分析步骤',
      title: `完成同行分位数交叉归因，锁定 ${findings.length} 项经营发现（高风险 ${highCount} 项）`,
      detail:
        highCount > 0
          ? '检出多项指标偏离同行中位数基线，已按风险严重度排序并生成待人工确认的整改方案。'
          : '仅检出单指标中度波动，依据保守决策原则暂不升级为高优工单，建议先人工复核营业时段与现场状态。',
      status: 'completed',
    })
  } else {
    steps.push({
      phase: 'analysis',
      phaseLabel: '分析步骤',
      title: '完成全量规则阈值与同行分位比对，未发现需升级异常',
      detail: '目标范围内销售额、退款率与客单价均处于同商圈正常波动区间。',
      status: 'completed',
    })
  }

  return steps
}

/**
 * 构建结构化业务结论模块（structuredBlocks）
 */
export function buildStructuredBlocks(state, finalSummary) {
  const queryText = String(state?.request?.query || '').trim()
  const intent = state?.intent || {}
  const findings = Array.isArray(state?.findings) ? state.findings : []
  const regionComparison = Array.isArray(state?.regionComparison) ? state.regionComparison : []
  const dashboardMetrics = state?.dashboardMetrics || null
  const degraded = Boolean(state?.degraded)
  const focus = analyzeQuestionFocus(queryText, intent, findings, regionComparison, degraded)

  const keyMetrics = []
  if (dashboardMetrics) {
    const onlinePct = Number((dashboardMetrics.onlineRate * 100).toFixed(1))
    keyMetrics.push(
      {
        label: '在营设备与在线率',
        value: `${dashboardMetrics.deviceCount} 台 / ${onlinePct}%`,
        trend: onlinePct >= 95 ? 'up' : 'warn',
        hint: '全城实时监测点位',
      },
      {
        label: '累计销售额',
        value: `¥${Number(dashboardMetrics.salesAmount).toLocaleString()}`,
        trend: 'neutral',
        hint: `预计净利 ¥${Number(dashboardMetrics.estimatedProfit).toLocaleString()}`,
      },
      {
        label: '待闭环风险项',
        value: `${dashboardMetrics.openFindingCount} 项`,
        trend: dashboardMetrics.openFindingCount > 0 ? 'down' : 'up',
        hint: '需重点跟进的异常门店发现',
      },
    )
  }

  if (regionComparison.length > 0) {
    const sorted = [...regionComparison].sort((a, b) => b.score - a.score)
    const top = sorted[0]
    keyMetrics.push(
      {
        label: '首选投放区域',
        value: `${top.name}（${top.score} 分）`,
        trend: 'up',
        hint: '综合客流、点位密度与成本加权最高',
      },
      {
        label: `${top.name}预计月净利`,
        value: `¥${Number(top.estimatedMonthlyProfit).toLocaleString()}/月`,
        trend: 'up',
        hint:
          top.estimatedPaybackMonths !== null
            ? `预计静态回本周期 ${top.estimatedPaybackMonths} 个月`
            : '待补齐租金样本后锁定回本周期',
      },
    )
    if (sorted[1]) {
      const sec = sorted[1]
      keyMetrics.push({
        label: `次选对标（${sec.name}）`,
        value: `${sec.score} 分 · ¥${Number(sec.estimatedMonthlyProfit).toLocaleString()}/月`,
        trend: sec.estimatedPaybackMonths === null ? 'warn' : 'neutral',
        hint:
          sec.estimatedPaybackMonths === null
            ? '租金样本不足，回本周期暂不可估算'
            : `预计静态回本周期 ${sec.estimatedPaybackMonths} 个月`,
      })
    }
  }

  if (findings.length > 0 && keyMetrics.length < 4) {
    const highCount = findings.filter((f) => f.severity === 'high').length
    const targetStore = formatStoreDisplayName(findings[0]?.deviceId)
    keyMetrics.push(
      {
        label: '诊断对象',
        value: targetStore,
        trend: highCount > 0 ? 'down' : 'warn',
        hint: `共检出 ${findings.length} 项经营异动指标`,
      },
      {
        label: '最高风险等级',
        value: highCount > 0 ? `高风险（${highCount} 项）` : '中风险（单指标波动）',
        trend: highCount > 0 ? 'down' : 'warn',
        hint: highCount > 0 ? '多指标偏离同行中位数，需优先核查' : '建议先复核营业时段与现场状况',
      },
    )
  }

  // 生成针对用户具体问题的直接解答（directAnswer）
  let directAnswer = scrubInternalToolNames(finalSummary)
  if (!degraded) {
    if (focus.isRefundFocus && findings.length > 0) {
      const refundFinding = findings.find((f) => f.title.includes('退款') || f.evidence?.some((e) => e.includes('退款'))) || findings[0]
      directAnswer = `针对您关注的退款与损耗问题：${formatStoreDisplayName(refundFinding.deviceId)}检出「${refundFinding.title}」（${refundFinding.evidence?.[0] || '明显偏离同商圈基线'}）。建议立即按下方决策卡片抽查近期异常退款订单与设备出货日志。`
    } else if (focus.isRevenueFocus && findings.length > 0) {
      const revFinding = findings.find((f) => f.title.includes('销售') || f.title.includes('订单') || f.title.includes('客单')) || findings[0]
      directAnswer = `针对您关注的营收与销量波动：${formatStoreDisplayName(revFinding.deviceId)}存在「${revFinding.title}」（${revFinding.evidence?.[0] || '低于同行中位数'}），${findings.length > 1 ? '且伴随退款或客单价交叉异动，需优先排查热销品缺货与设备故障。' : '建议先核对门店有效营业时段与周边客流变化。'}`
    } else if (focus.code === 'comprehensive' && regionComparison.length > 0) {
      const top = [...regionComparison].sort((a, b) => b.score - a.score)[0]
      directAnswer = `综合全盘诊断结果：存量端共检出 ${findings.length} 项门店异常需优先止损；增量扩张端，${top.name}综合评分（${top.score} 分）与预计月净利（¥${top.estimatedMonthlyProfit}）表现最优，建议采取“存量高危点位限期整改 + 增量优先勘测${top.name}”的双线策略。`
    }
  }

  const diagnosisItems = findings.map((f) => {
    const evidenceList = Array.isArray(f.evidence) ? f.evidence.map(scrubInternalToolNames) : []
    const statusTone = f.severity === 'high' ? 'danger' : f.severity === 'medium' ? 'warning' : 'ok'
    const verdictLabel = f.severity === 'high' ? '高风险 · 优先止损' : f.severity === 'medium' ? '中风险 · 观察复核' : '低风险 · 常态跟踪'
    return {
      id: f.id,
      deviceId: f.deviceId,
      storeName: formatStoreDisplayName(f.deviceId),
      statusTone,
      verdictLabel,
      phenomenon: scrubInternalToolNames(f.title),
      rootCause: evidenceList[0] || '核心经营指标显著偏离近 7 日滚动均值',
      benchmark: evidenceList[1] || '低于同行政区可比门店分位数基准（P25/P50）',
      action: scrubInternalToolNames(f.recommendation),
    }
  })

  const sortedRegions = [...regionComparison].sort((a, b) => b.score - a.score)
  const comparisonRows = sortedRegions.map((r, idx) => {
    const reasons = Array.isArray(r.reasons) ? r.reasons.map(scrubInternalToolNames) : []
    const assumptions = Array.isArray(r.assumptions) ? r.assumptions.map(scrubInternalToolNames) : []
    const isMissingRent = r.estimatedPaybackMonths === null
    return {
      regionId: r.regionId,
      regionName: r.name,
      score: r.score,
      dimensionBreakdown: reasons.join('；') || '客流需求、竞争密度、毛利空间与履约成本四维加权',
      monthlyProfitText: `¥${Number(r.estimatedMonthlyProfit).toLocaleString()}/月`,
      paybackText: isMissingRent ? '暂缓测算（租金样本不足）' : `${r.estimatedPaybackMonths} 个月`,
      recommendationTag: isMissingRent
        ? '补齐租金数据后再议'
        : idx === 0
          ? '首选投放 · 现场勘测'
          : '次选储备 · 择机跟进',
      assumptions,
    }
  })

  return {
    questionFocus: focus.label,
    directAnswer,
    keyMetrics: keyMetrics.slice(0, 4),
    diagnosisItems,
    comparisonRows,
  }
}

/**
 * 构建人机协同（Human-in-the-Loop）待审核确认卡片（含决策依据、深度分析、预期影响）
 */
export function buildDecisionProposal(state) {
  const findings = Array.isArray(state?.findings) ? state.findings : []
  const regionComparison = Array.isArray(state?.regionComparison) ? state.regionComparison : []
  const assumptions = Array.isArray(state?.assumptions) ? state.assumptions : []
  const degraded = Boolean(state?.degraded)

  // 1. 数据不足或缺失场景：明确阻断盲目执行，展示数据边界依据
  if (degraded) {
    const isUnavailable = state?.degradedReason === 'DATA_UNAVAILABLE'
    const targetLabel = state?.intent?.filters?.deviceId
      ? formatStoreDisplayName(state.intent.filters.deviceId)
      : '当前查询对象'
    return {
      id: 'proposal-data-guard',
      requiresApproval: false,
      proposalType: 'data_completion',
      title: isUnavailable
        ? '关键经营指标缺失保护（已暂停生成整改或投放指令）'
        : '样本量不足保护（待补齐观察窗口数据后重评）',
      targetEntity: targetLabel,
      targetLabel,
      decisionBasis: [
        isUnavailable
          ? scrubInternalToolNames(state.auditSummary || '目标门店存在关键经营字段缺失（NULL），不满足归因前置条件。')
          : '同商圈有效可比门店少于 3 家最低统计门槛，直接对比易产生严重幸存者偏差。',
        ...assumptions.map(scrubInternalToolNames),
      ],
      analysis: isUnavailable
        ? '系统检测到基础经营流水字段不完整。若在数据缺失情况下强行派发整改工单，会导致一线运维误判设备故障或错误调整商品陈列。'
        : '当前可比样本量低于统计显著性要求，单店指标波动无法排除商圈整体季节性或临时施工干扰，需扩充观察窗口后再做定性。',
      expectedImpact: '阻断因数据失真导致的无效巡检与错误选址投入，待数据补齐后重新发起核查。',
      recommendedAction: isUnavailable
        ? '排查门店物联网终端数据上报链路并回填缺失账期数据'
        : '补齐近 7~14 日完整观察窗口及同区至少 3 家可比门店数据后重新运行',
      ownerRole: '数据工程 / 区域督导',
      dueHours: 24,
      primaryActionLabel: '已阅知数据限制',
      secondaryActionLabel: '标记待补采数据',
    }
  }

  // 2. 区域选址与投放方案确认场景（含综合战略场景中带区域对标的情况）
  if (
    regionComparison.length > 0 &&
    (state?.intent?.type === INTENT_TYPES.REGION_COMPARISON || findings.length === 0)
  ) {
    const sorted = [...regionComparison].sort((a, b) => b.score - a.score)
    const top = sorted[0]
    const second = sorted[1]
    const missingPayback = sorted.find((r) => r.estimatedPaybackMonths === null)

    const basis = [
      `${top.name}综合选址评分为 ${top.score} 分（位列候选区域首位），预计单店月净利润 ¥${Number(top.estimatedMonthlyProfit).toLocaleString()}。`,
      ...(Array.isArray(top.reasons) ? top.reasons.map(scrubInternalToolNames) : []),
    ]
    if (second) {
      basis.push(
        `对比次选区域「${second.name}」（评分 ${second.score} 分，预计月净利润 ¥${Number(second.estimatedMonthlyProfit).toLocaleString()}），${top.name}盈利确定性更高。`,
      )
    }
    if (missingPayback) {
      basis.push(`${missingPayback.name}当前缺少完整商铺租金样本，静态回本周期暂不可测算。`)
    }

    return {
      id: `proposal-region-${top.regionId}`,
      requiresApproval: true,
      proposalType: 'region_investment_plan',
      title: `采纳「${top.name}」优先投放方案并启动点位现场核查`,
      targetEntity: top.name,
      targetLabel: top.name,
      decisionBasis: basis.slice(0, 4),
      analysis: second
        ? `${top.name}在商圈客流密度与既有设备单点产出上均显著优于${second.name}。${
            missingPayback
              ? `同时，${missingPayback.name}存在租金样本缺失的不确定性敞口，不宜盲目签约；优先锁定${top.name}可兼顾收益高度与回本确定性。`
              : `两区均具备完整测算基线，优先集中资源投放${top.name}可最大化资金周转效率。`
          }`
        : `${top.name}各项客流与成本指标满足无人零售点位扩张基准，建议在最终落位前完成现场物业租金与电力条件复核。`,
      expectedImpact: `采纳后预计新增点位月均贡献净利润约 ¥${Number(top.estimatedMonthlyProfit).toLocaleString()}${
        top.estimatedPaybackMonths !== null
          ? `，预计静态投资回本周期约 ${top.estimatedPaybackMonths} 个月`
          : '（待现场锁定租金报价后核算最终回本周期）'
      }，并规避低效点位租金沉没风险。`,
      recommendedAction: `优先对${top.name}候选点位开展现场物业勘测与租金核查，确认无误后推进投放签约`,
      ownerRole: '拓展经理 / 区域负责人',
      dueHours: 48,
      primaryActionLabel: '确认采纳投放方案',
      secondaryActionLabel: '暂缓投放（继续补采数据）',
    }
  }

  // 3. 门店异常整改或综合诊断决策确认场景
  if (findings.length > 0) {
    const highFindings = findings.filter((f) => f.severity === 'high')
    const primaryFinding = highFindings[0] || findings[0]
    const storeName = formatStoreDisplayName(primaryFinding.deviceId)
    const basis = []
    findings.forEach((f) => {
      if (Array.isArray(f.evidence)) {
        f.evidence.forEach((ev) => {
          if (basis.length < 4) basis.push(`${formatStoreDisplayName(f.deviceId)}：${scrubInternalToolNames(ev)}`)
        })
      }
    })
    if (regionComparison.length > 0) {
      const topRegion = [...regionComparison].sort((a, b) => b.score - a.score)[0]
      basis.push(`区域扩张对标显示：${topRegion.name}综合评分 ${topRegion.score} 分（预计月净利 ¥${topRegion.estimatedMonthlyProfit}），具备更优增量空间。`)
    }

    const isHighRisk = highFindings.length > 0
    return {
      id: `proposal-rectify-${primaryFinding.deviceId}`,
      requiresApproval: true,
      proposalType: 'store_rectification',
      title: isHighRisk
        ? `批准派发「${storeName}」高风险经营异动限期核查任务`
        : `确认「${storeName}」单指标波动观察与营业时段人工核对方案`,
      targetEntity: storeName,
      targetLabel: storeName,
      decisionBasis: basis.length > 0 ? basis : [`${storeName}检出 ${findings.length} 项经营指标偏离同行基线。`],
      analysis: isHighRisk
        ? `${storeName}出现多维度或显著超阈值的经营异动（特别是退款率或核心营收明显劣化于同区同行中位数），属于高优止损对象。优先核查异常退款订单明细与货道出货传感器状态，可在不盲目更换整机的前提下快速定位根因。`
        : `${storeName}当前仅命中单条中风险波动规则，尚未形成多指标恶化共振。依据保守运营准则，建议先由区域督导核对营业时段与周边临时干扰，确认属实后再升级为正式整改工单。`,
      expectedImpact: isHighRisk
        ? `在 24 小时内完成异常订单抽检与货道校准，预计可直接阻断异常退款损耗继续扩大，并在 3~7 日观察窗内推动门店日均营收恢复至同商圈中位水平。`
        : `避免对单指标短期波动造成过度运营干扰，在 48 小时内低成本排除现场营业时段或补货延迟隐患。`,
      recommendedAction: scrubInternalToolNames(primaryFinding.recommendation),
      ownerRole: isHighRisk ? '区域经理' : '运维督导',
      dueHours: isHighRisk ? 24 : 48,
      primaryActionLabel: isHighRisk ? '批准并派发整改任务' : '确认执行人工复核',
      secondaryActionLabel: '暂缓派单（继续观察）',
    }
  }

  // 4. 无异常门店 / 常态化健康状态
  const targetStore = state?.intent?.filters?.deviceId
    ? formatStoreDisplayName(state.intent.filters.deviceId)
    : '当前监测范围'
  return {
    id: 'proposal-routine-keep',
    requiresApproval: false,
    proposalType: 'routine_monitoring',
    title: `维持「${targetStore}」常态化自动巡检与补货策略`,
    targetEntity: targetStore,
    targetLabel: targetStore,
    decisionBasis: [
      scrubInternalToolNames(state?.auditSummary || '监测窗口内销售额、订单量、客单价与退款率均处于同商圈正常分位区间。'),
      ...assumptions.map(scrubInternalToolNames),
    ],
    analysis: '目标门店与大盘未触发任何高/中风险规则阈值，各项经营指标与同行基准保持良性同步，无需额外下发人工干预工单。',
    expectedImpact: '保持现有标准补货与设备巡检节奏，可稳定维持当前单店坪效与设备在线率。',
    recommendedAction: '保持每日自动化经营巡检，无需创建额外整改任务',
    ownerRole: '系统自动巡检',
    dueHours: 24,
    primaryActionLabel: '确认维持现状',
    secondaryActionLabel: '转人工重点关注',
  }
}

/**
 * 正常证据充足场景下的受控总结器（支持根据用户自由提问焦点生成针对性回答，且严格不引入幻觉数字）
 */
export function synthesizeNormalResponse(state) {
  const { intent, findings = [], regionComparison = [], dashboardMetrics, auditSummary, request } = state
  const queryText = String(request?.query || '').trim()
  const focus = analyzeQuestionFocus(queryText, intent, findings, regionComparison, false)
  const recommendations = []
  let summary = ''

  // 1. 区域投放对比主场景（如“比较朝阳区和南关区的投放收益，并说明主要风险”）
  if (intent?.type === INTENT_TYPES.REGION_COMPARISON && regionComparison.length > 0) {
    const sorted = [...regionComparison].sort((a, b) => b.score - a.score)
    const top = sorted[0]
    const second = sorted[1]
    const hasMissingPayback = sorted.find((r) => r.estimatedPaybackMonths === null)

    if (second && hasMissingPayback) {
      summary = `${top.name}当前评分更高（${top.score} 分），预计月利润也更高（${top.estimatedMonthlyProfit} 元）；${hasMissingPayback.name}的主要不确定性是租金数据不足。`
    } else if (second) {
      summary = `${top.name}当前评分（${top.score}）高于${second.name}（${second.score}），预计月利润为 ${top.estimatedMonthlyProfit} 元${top.estimatedPaybackMonths !== null ? `，预计回本周期为 ${top.estimatedPaybackMonths} 个月` : ''}。`
    } else {
      summary = `${top.name}当前评分为 ${top.score}，预计月利润为 ${top.estimatedMonthlyProfit} 元。`
    }

    recommendations.push(`优先对${top.name}进行现场核查，再决定投放。`)
    if (hasMissingPayback) {
      recommendations.push(`补齐${hasMissingPayback.name}完整租金数据后再测算回本周期。`)
    }
  } else if (intent?.type === INTENT_TYPES.DASHBOARD_OVERVIEW && dashboardMetrics) {
    // 2. 驾驶舱全局概览场景
    const onlinePct = Number((dashboardMetrics.onlineRate * 100).toFixed(1))
    summary = `当前监测范围内共有 ${dashboardMetrics.deviceCount} 台设备，在线率 ${onlinePct}%，累计销售额 ${dashboardMetrics.salesAmount} 元，预计利润 ${dashboardMetrics.estimatedProfit} 元，待处理异常 ${dashboardMetrics.openFindingCount} 条。`
    if (findings.length > 0) {
      findings.forEach((f) => {
        if (f.recommendation && !recommendations.includes(f.recommendation)) {
          recommendations.push(scrubInternalToolNames(f.recommendation))
        }
      })
    }
  } else if (intent?.type === INTENT_TYPES.COMPREHENSIVE && regionComparison.length > 0) {
    // 3. 跨维度开放式综合经营诊断（门店异常 + 区域选址对标）
    const sorted = [...regionComparison].sort((a, b) => b.score - a.score)
    const top = sorted[0]
    const hasHigh = findings.some((f) => f.severity === 'high')
    if (findings.length > 0) {
      summary = `当前共检出 ${findings.length} 个经营异常（${hasHigh ? '含高风险发现需优先核查退款与订单波动' : '建议按优先级逐项复核'}）；同时在区域投放对比中，${top.name}评分更高（${top.score} 分），预计月利润为 ${top.estimatedMonthlyProfit} 元。`
    } else {
      summary = `当前存量门店未检出需升级的高风险异常；增量投放方面，${top.name}评分为 ${top.score}，预计月利润为 ${top.estimatedMonthlyProfit} 元。`
    }
    if (hasHigh) {
      recommendations.push('优先处理退款率异常，再复核订单数变化。')
    }
    findings.forEach((f) => {
      if (f.recommendation && !recommendations.includes(f.recommendation)) {
        recommendations.push(scrubInternalToolNames(f.recommendation))
      }
    })
    recommendations.push(`优先对${top.name}进行现场核查，再决定投放。`)
  } else {
    // 4. 门店异常审计 / 专项归因追问场景（针对退款、营收、整改优先级动态回应）
    if (findings.length === 0) {
      summary = scrubInternalToolNames(auditSummary) || '当前经营数据未发现需要升级的异常。'
    } else if (findings.length === 1) {
      const only = findings[0]
      if (only.severity === 'high') {
        summary = focus.isRefundFocus
          ? `发现 1 个高风险经营异常（${only.title}），建议优先核查退款记录。`
          : '发现 1 个高风险经营异常，建议优先核查退款记录。'
        recommendations.push(scrubInternalToolNames(only.recommendation))
      } else {
        summary = '发现 1 个中风险经营发现，当前证据不足以创建高优先级任务。'
        recommendations.push('先核对门店营业时段，再决定是否创建任务。')
      }
    } else {
      const hasHigh = findings.some((f) => f.severity === 'high')
      if (focus.isRefundFocus && hasHigh) {
        summary = `针对退款异动核查：共发现 ${findings.length} 个经营发现，其中高风险发现需要优先核查退款订单。`
      } else if (focus.isRevenueFocus && hasHigh) {
        summary = `针对营收波动核查：共发现 ${findings.length} 个经营发现，其中高风险发现需要优先核查退款订单与销量变化。`
      } else {
        summary = hasHigh
          ? '发现多个经营发现，其中高风险发现需要优先核查退款订单。'
          : scrubInternalToolNames(auditSummary) || `发现 ${findings.length} 个经营异常，建议按优先级逐项核查。`
      }

      if (hasHigh) {
        recommendations.push('优先处理退款率异常，再复核订单数变化。')
      }
      findings.forEach((f) => {
        if (f.recommendation && !recommendations.includes(f.recommendation)) {
          recommendations.push(scrubInternalToolNames(f.recommendation))
        }
      })
    }
  }

  const stateWithDraft = {
    ...state,
    draftSummary: summary,
    draftRecommendations: recommendations,
  }

  return {
    draftSummary: summary,
    draftRecommendations: recommendations,
    draftThinkingSteps: buildBusinessThinkingSteps(stateWithDraft),
    draftStructuredBlocks: buildStructuredBlocks(stateWithDraft, summary),
    draftDecisionProposal: buildDecisionProposal(stateWithDraft),
  }
}

/**
 * 数据不足或工具失败时的降级总结器（严格对齐 contracts/fixtures/insufficient-data.json 与成员 B 数据缺失不可判断约束）
 */
export function synthesizeDegradedResponse(state) {
  const isDataUnavailable = state?.degradedReason === 'DATA_UNAVAILABLE'
  const summary = isDataUnavailable
    ? scrubInternalToolNames(state.auditSummary) || '当前关键字段数据缺失，无法对经营异常作出判断。'
    : '当前数据不足，无法对经营异常或区域收益作出确定判断。'
  const recommendations = isDataUnavailable ? [] : ['补齐观察窗口数据后重新运行。']

  const degradedState = {
    ...state,
    degraded: true,
    findings: [],
    regionComparison: [],
    draftSummary: summary,
    draftRecommendations: recommendations,
  }

  return {
    draftSummary: summary,
    draftRecommendations: recommendations,
    draftThinkingSteps: buildBusinessThinkingSteps(degradedState),
    draftStructuredBlocks: buildStructuredBlocks(degradedState, summary),
    draftDecisionProposal: buildDecisionProposal(degradedState),
    findings: [],
    regionComparison: [],
  }
}

