/**
 * 第三层（组件层 - 受控总结器）：synthesizer.js
 *
 * 职责：
 * 1. 基于已验证的工具输出（findings、regionComparison、dashboardMetrics）生成自然语言 summary 与 recommendations；
 * 2. 严格保证不新增任何工具未返回的数值事实；
 * 3. 提供正常模式合成（synthesizeNormalResponse）与数据不足降级合成（synthesizeDegradedResponse）。
 */

import { INTENT_TYPES } from '../definition.js'

/**
 * 正常证据充足场景下的受控总结器
 */
export function synthesizeNormalResponse(state) {
  const { intent, findings, regionComparison, dashboardMetrics, auditSummary } = state
  const recommendations = []
  let summary = ''

  // 1. 区域投放对比主场景（如“比较朝阳区和南关区的投放收益，并说明主要风险”）
  if (intent?.type === INTENT_TYPES.REGION_COMPARISON && regionComparison.length > 0) {
    const sorted = [...regionComparison].sort((a, b) => b.score - a.score)
    const top = sorted[0]
    const second = sorted[1]
    const hasMissingPayback = sorted.find((r) => r.estimatedPaybackMonths === null)

    if (second && hasMissingPayback) {
      summary = `${top.name}当前评分更高，预计月利润也更高；${hasMissingPayback.name}的主要不确定性是租金数据不足。`
    } else if (second) {
      summary = `${top.name}当前评分（${top.score}）高于${second.name}（${second.score}），预计月利润为 ${top.estimatedMonthlyProfit} 元。`
    } else {
      summary = `${top.name}当前评分为 ${top.score}，预计月利润为 ${top.estimatedMonthlyProfit} 元。`
    }

    recommendations.push(`优先对${top.name}进行现场核查，再决定投放。`)
    if (hasMissingPayback) {
      recommendations.push(`补齐${hasMissingPayback.name}完整租金数据后再测算回本周期。`)
    }
    return {
      draftSummary: summary,
      draftRecommendations: recommendations,
    }
  }

  // 2. 驾驶舱全局概览场景
  if (intent?.type === INTENT_TYPES.DASHBOARD_OVERVIEW && dashboardMetrics) {
    const onlinePct = Number((dashboardMetrics.onlineRate * 100).toFixed(1))
    summary = `当前监测范围内共有 ${dashboardMetrics.deviceCount} 台设备，在线率 ${onlinePct}%，累计销售额 ${dashboardMetrics.salesAmount} 元，预计利润 ${dashboardMetrics.estimatedProfit} 元，待处理异常 ${dashboardMetrics.openFindingCount} 条。`
    if (findings.length > 0) {
      findings.forEach((f) => {
        if (f.recommendation && !recommendations.includes(f.recommendation)) {
          recommendations.push(f.recommendation)
        }
      })
    }
    return {
      draftSummary: summary,
      draftRecommendations: recommendations,
    }
  }

  // 3. 门店异常审计 / 综合诊断场景
  if (findings.length === 0) {
    summary = auditSummary || '当前经营数据未发现需要升级的异常。'
  } else if (findings.length === 1) {
    const only = findings[0]
    if (only.severity === 'high') {
      summary = '发现 1 个高风险经营异常，建议优先核查退款记录。'
      recommendations.push(only.recommendation)
    } else {
      summary = '发现 1 个中风险经营发现，当前证据不足以创建高优先级任务。'
      recommendations.push('先核对门店营业时段，再决定是否创建任务。')
    }
  } else {
    const hasHigh = findings.some((f) => f.severity === 'high')
    summary = hasHigh
      ? '发现多个经营发现，其中高风险发现需要优先核查退款订单。'
      : auditSummary || `发现 ${findings.length} 个经营异常，建议按优先级逐项核查。`

    if (hasHigh) {
      recommendations.push('优先处理退款率异常，再复核订单数变化。')
    }
    findings.forEach((f) => {
      if (f.recommendation && !recommendations.includes(f.recommendation)) {
        recommendations.push(f.recommendation)
      }
    })
  }

  return {
    draftSummary: summary,
    draftRecommendations: recommendations,
  }
}

/**
 * 数据不足或工具失败时的降级总结器（严格对齐 contracts/fixtures/insufficient-data.json）
 */
export function synthesizeDegradedResponse(state) {
  return {
    draftSummary: '当前数据不足，无法对经营异常或区域收益作出确定判断。',
    draftRecommendations: ['补齐观察窗口数据后重新运行。'],
    findings: [],
    regionComparison: [],
  }
}
