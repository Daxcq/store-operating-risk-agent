/**
 * 第四层：机制层 (Mechanism Layer)
 *
 * 职责：
 * 1. 受控工具执行与状态追踪机制（记录 AgentToolCall[]：{ toolName, status: 'success' | 'error' }）；
 * 2. 严格遵守《上下文与 KV Cache 约束》规则 2 & 3：
 *    工具执行过程以 append-only 方式追加 assistant(tool_calls) 与 tool(tool_call_id) 标准消息到对话尾部，绝不修改历史前缀；
 * 3. 证据锚定与假设透传机制（自动聚合区域假设、数据口径假设、安全告警说明）；
 * 4. 证据充分性校验、单次有界重规划（Bounded Re-plan）与优雅降级触发机制。
 */

import { AGENT_IDENTITY, INTENT_TYPES } from './definition.js'
import { AGENT_PATTERN_META } from './pattern.js'
import { buildLangChainTools, isWhitelistedTool } from './components/toolAdapter.js'
import {
  appendAssistantToolCallsMessage,
  appendToolResultMessage,
} from './components/contextBuilder.js'
import {
  updateMemoryContextFromTurn,
  recordLongTermMemories,
} from './components/memoryManager.js'

/**
 * 执行当前计划中的白名单工具队列，并聚合结构化结果、更新短期实体记忆槽位、写入长期记忆与 KV Cache 友好的 tool 角色消息轨迹
 */
export async function executePlannedToolsMechanism(state) {
  const tools = buildLangChainTools()
  const planned = Array.isArray(state.plannedTools) ? state.plannedTools : []

  const toolCalls = [...(state.toolCalls || [])]
  let findings = [...(state.findings || [])]
  let auditSummary = state.auditSummary || ''
  let regionComparison = [...(state.regionComparison || [])]
  let dashboardMetrics = state.dashboardMetrics || null
  const createdTasks = [...(state.createdTasks || [])]
  const reports = []
  const assumptionsSet = new Set(state.assumptions || [])
  let messages = Array.isArray(state.messages) ? state.messages : []

  const validPlanned = planned
    .filter((item) => item && isWhitelistedTool(item.toolName))
    .map((item, idx) => ({
      id: item.id || `call_${toolCalls.length + idx + 1}`,
      toolName: item.toolName,
      args: item.args || {},
    }))

  // 规则 2 & 3：先在消息末尾追加一条 assistant tool_calls 消息
  if (validPlanned.length > 0 && messages.length > 0) {
    messages = appendAssistantToolCallsMessage(messages, validPlanned)
  }

  for (const item of validPlanned) {
    const { id: toolCallId, toolName, args } = item
    const lcTool = tools[toolName]
    try {
      const result = await lcTool.invoke(args)
      toolCalls.push({ toolName, status: 'success' })

      if (toolName === 'get_dashboard' && result) {
        dashboardMetrics = result
      } else if (toolName === 'run_audit' && result) {
        auditSummary = result.summary || auditSummary
        if (Array.isArray(result.findings)) {
          findings = result.findings
        }
      } else if (toolName === 'compare_regions' && Array.isArray(result)) {
        regionComparison = result
      } else if (toolName === 'estimate_region_roi' && result) {
        const existsIdx = regionComparison.findIndex((r) => r.regionId === result.regionId)
        if (existsIdx >= 0) {
          regionComparison[existsIdx] = result
        } else {
          regionComparison.push(result)
        }
      } else if (toolName === 'create_task' && result) {
        createdTasks.push(result)
      } else if (toolName === 'write_report' && result) {
        reports.push(result)
      }

      // 规则 3：工具执行结果必须用 tool 角色加 tool_call_id 追加到末尾
      if (messages.length > 0) {
        messages = appendToolResultMessage(messages, {
          toolCallId,
          toolName,
          resultPayload: result,
        })
      }
    } catch (err) {
      toolCalls.push({ toolName, status: 'error' })
      if (messages.length > 0) {
        messages = appendToolResultMessage(messages, {
          toolCallId,
          toolName,
          resultPayload: { error: err?.message || 'TOOL_EXECUTION_FAILED' },
        })
      }
    }
  }

  // 更新短期焦点实体槽位（支持下一轮指代消解）
  const nextMemoryContext = updateMemoryContextFromTurn(state.memoryContext, {
    intent: state.intent,
    findings,
    regionComparison,
    createdTasks,
  })

  // 将门店异常、创建的任务、生成的报告同步写入官方 InMemoryStore 跨会话长期记忆
  await recordLongTermMemories({
    findings,
    createdTasks,
    reports,
  })

  return {
    toolCalls,
    findings,
    auditSummary,
    regionComparison,
    dashboardMetrics,
    createdTasks,
    memoryContext: nextMemoryContext,
    assumptions: Array.from(assumptionsSet),
    messages,
    // 清空已执行的计划队列
    plannedTools: [],
    needsReplan: false,
  }
}

/**
 * 证据校验、假设透传与单次补充重规划机制
 */
export function verifyEvidenceMechanism(state) {
  const { intent, toolCalls, findings, regionComparison, replanCount, securityWarnings } = state
  const assumptions = new Set(state.assumptions || [])

  // 1. 检查是否存在工具执行失败或显式数据不足探测
  const hasErrorCall = toolCalls.some((c) => c.status === 'error')
  if (hasErrorCall || intent?.forceInsufficient) {
    assumptions.add('可比对象少于 3 个或关键字段缺失。')
    return {
      degraded: true,
      degradedReason: 'INSUFFICIENT_DATA_OR_TOOL_ERROR',
      needsReplan: false,
      assumptions: Array.from(assumptions),
    }
  }

  // 2. 有界单次重规划机制（Bounded Re-plan）：
  const hasHighFinding = findings.some((f) => f.severity === 'high')
  const alreadyCompared = toolCalls.some((c) => c.toolName === 'compare_regions')
  if (
    hasHighFinding &&
    !alreadyCompared &&
    replanCount < AGENT_PATTERN_META.maxReplanIterations &&
    intent?.type === INTENT_TYPES.COMPREHENSIVE
  ) {
    return {
      needsReplan: true,
      replanCount: replanCount + 1,
      plannedTools: [
        {
          id: `call_replan_${replanCount + 1}`,
          toolName: 'compare_regions',
          args: { regionIds: ['chaoyang', 'nanguan'] },
        },
      ],
    }
  }

  // 3. 正常场景下的假设透传机制
  if (intent?.type === INTENT_TYPES.REGION_COMPARISON) {
    assumptions.add(`当前结果使用 ${AGENT_IDENTITY.dataVersion} 模拟数据。`)
  } else if (findings.length === 0) {
    assumptions.add(`使用 ${AGENT_IDENTITY.dataVersion} 模拟数据。`)
  } else if (findings.length === 1) {
    assumptions.add(`销售额和订单数口径已按 ${AGENT_IDENTITY.dataVersion} 固定。`)
  } else {
    assumptions.add('同类设备数量不少于 3 台。')
    assumptions.add(`当前结果使用 ${AGENT_IDENTITY.dataVersion} 模拟数据。`)
  }

  if (Array.isArray(securityWarnings) && securityWarnings.length > 0) {
    securityWarnings.forEach((w) => assumptions.add(w))
  }

  const cleanedRegions =
    intent?.type === INTENT_TYPES.STORE_AUDIT ? [] : regionComparison

  return {
    degraded: false,
    needsReplan: false,
    regionComparison: cleanedRegions,
    assumptions: Array.from(assumptions),
  }
}
