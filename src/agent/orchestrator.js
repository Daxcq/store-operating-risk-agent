/**
 * 第六层：编排层 (Orchestration Layer)
 *
 * 职责：
 * 1. 使用官方 @langchain/langgraph 的 StateGraph 组装受控 Plan-and-Execute 状态图；
 * 2. 连接 7 个核心节点（InputGuard -> Planner -> ToolExecutor -> EvidenceVerifier -> Normal/DegradedSynthesizer -> OutputGuard）；
 * 3. 在 Planner 与 Synthesizer 节点接入第三方大模型 API（支持 KV Cache 静态前缀复用 + 确定性引擎无缝降级）；
 * 4. 导出符合 contracts/src/index.ts 契约的 runAgent(request) 函数。
 */

import { StateGraph, START, END } from '@langchain/langgraph'
import { AGENT_IDENTITY, AgentStateAnnotation } from './definition.js'
import { GRAPH_NODES, PLAN_EXECUTE_PHASES, routeAfterEvidenceVerifier } from './pattern.js'
import { validateAgentRequest, enforceOutputGuardrails } from './safety.js'
import { synthesizeNormalResponse, synthesizeDegradedResponse } from './components/synthesizer.js'
import {
  planWithThirdPartyLLMOrFallback,
  synthesizeWithThirdPartyLLMOrFallback,
} from './components/llmClient.js'
import {
  agentCheckpointer,
  agentLongTermStore,
  loadSessionMemory,
  saveSessionMemory,
} from './components/memoryManager.js'
import { executePlannedToolsMechanism, verifyEvidenceMechanism } from './mechanisms.js'
import { recordTraceEvent, getTraceById } from '../server/traceLogger.js'

/**
 * Node 1: 输入安全护栏节点
 */
async function inputGuardNode(state) {
  const { normalizedQuery, securityWarnings } = validateAgentRequest(state.request)
  recordTraceEvent(state.traceId, GRAPH_NODES.INPUT_GUARD, {
    query: normalizedQuery,
    securityWarnings,
  })
  return {
    request: { query: normalizedQuery },
    securityWarnings,
    phase: PLAN_EXECUTE_PHASES.GUARDED,
  }
}

/**
 * Node 2: 意图解析与白名单工具规划节点 (Plan - 支持第三方 LLM + KV Cache 静态前缀 + 多轮指代消解记忆)
 */
async function plannerNode(state) {
  const planResult = await planWithThirdPartyLLMOrFallback(
    state.request.query,
    {
      dataVersion: AGENT_IDENTITY.dataVersion,
    },
    state.messages,
    state.memoryContext,
  )

  const nextKvStats = [...(state.kvCacheStats || [])]
  if (planResult.cacheMetrics) {
    nextKvStats.push({ stage: 'planner', ...planResult.cacheMetrics })
  }

  const nextSecurityWarnings = [
    ...(state.securityWarnings || []),
    ...(planResult.contractViolations || []),
  ]

  recordTraceEvent(state.traceId, GRAPH_NODES.PLANNER, {
    intentType: planResult.intent.type,
    plannedTools: planResult.plannedTools.map((t) => t.toolName),
    contractViolations: planResult.contractViolations || [],
    usedLLM: planResult.usedLLM,
    kvCache: planResult.cacheMetrics,
    memoryTurnCount: state.memoryContext?.turnCount || 0,
  })

  return {
    intent: planResult.intent,
    plannedTools: planResult.plannedTools,
    messages: planResult.messages,
    kvCacheStats: nextKvStats,
    securityWarnings: nextSecurityWarnings,
    phase: PLAN_EXECUTE_PHASES.PLANNED,
  }
}

/**
 * Node 3: 白名单工具执行节点 (Execute - 自动追加 assistant tool_calls 与 tool(tool_call_id) 到消息末尾)
 */
async function toolExecutorNode(state) {
  const execUpdate = await executePlannedToolsMechanism(state)
  recordTraceEvent(state.traceId, GRAPH_NODES.TOOL_EXECUTOR, {
    toolCalls: execUpdate.toolCalls,
    findingsCount: execUpdate.findings.length,
    regionCount: execUpdate.regionComparison.length,
    messageCount: execUpdate.messages.length,
  })
  return {
    ...execUpdate,
    phase: PLAN_EXECUTE_PHASES.EXECUTED,
  }
}

/**
 * Node 4: 证据充分性校验与条件重规划节点 (Verify)
 */
async function evidenceVerifierNode(state) {
  const verifyUpdate = verifyEvidenceMechanism(state)
  recordTraceEvent(state.traceId, GRAPH_NODES.EVIDENCE_VERIFIER, {
    degraded: verifyUpdate.degraded,
    needsReplan: verifyUpdate.needsReplan,
    replanCount: verifyUpdate.replanCount ?? state.replanCount,
  })
  return {
    ...verifyUpdate,
    phase: PLAN_EXECUTE_PHASES.VERIFIED,
  }
}

/**
 * Node 5A: 正常模式受控总结节点 (Synthesize - 支持第三方 LLM + KV Cache 复用)
 */
async function normalSynthesizerNode(state) {
  const synth = await synthesizeWithThirdPartyLLMOrFallback(state)
  const nextKvStats = [...(state.kvCacheStats || [])]
  if (synth.cacheMetrics) {
    nextKvStats.push({ stage: 'synthesizer', ...synth.cacheMetrics })
  }

  recordTraceEvent(state.traceId, GRAPH_NODES.NORMAL_SYNTHESIZER, {
    summary: synth.draftSummary,
    usedLLM: synth.usedLLM,
    kvCache: synth.cacheMetrics,
  })

  return {
    draftSummary: synth.draftSummary,
    draftRecommendations: synth.draftRecommendations,
    messages: synth.messages || state.messages,
    kvCacheStats: nextKvStats,
    phase: PLAN_EXECUTE_PHASES.SYNTHESIZED,
  }
}

/**
 * Node 5B: 降级模式受控总结节点 (Synthesize - Degraded)
 */
async function degradedSynthesizerNode(state) {
  const synth = synthesizeDegradedResponse(state)
  recordTraceEvent(state.traceId, GRAPH_NODES.DEGRADED_SYNTHESIZER, {
    summary: synth.draftSummary,
    degradedReason: state.degradedReason,
  })
  return {
    ...synth,
    phase: PLAN_EXECUTE_PHASES.SYNTHESIZED,
  }
}

/**
 * Node 6: 输出安全护栏与防幻觉校验节点 (Output Guard + 会话记忆持久化)
 */
async function outputGuardNode(state) {
  const fallback = state.degraded
    ? synthesizeDegradedResponse(state)
    : synthesizeNormalResponse(state)

  const verifiedResponse = enforceOutputGuardrails({
    summary: state.draftSummary,
    findings: state.findings,
    regionComparison: state.regionComparison,
    recommendations: state.draftRecommendations,
    toolCalls: state.toolCalls,
    assumptions: state.assumptions,
    fallbackSummary: fallback.draftSummary,
    fallbackRecommendations: fallback.draftRecommendations,
    dashboardMetrics: state.dashboardMetrics,
  })

  if (state.sessionId) {
    await saveSessionMemory(state.sessionId, {
      messages: state.messages,
      memoryContext: state.memoryContext,
    })
  }

  recordTraceEvent(state.traceId, GRAPH_NODES.OUTPUT_GUARD, {
    status: 'completed',
    toolCallsCount: verifiedResponse.toolCalls.length,
    kvCacheStats: state.kvCacheStats,
    sessionId: state.sessionId,
  })

  return {
    response: verifiedResponse,
    phase: PLAN_EXECUTE_PHASES.COMPLETED,
  }
}

/**
 * 构建并编译官方 LangGraph StateGraph 实例（挂载官方 MemorySaver Checkpointer 与 InMemoryStore）
 */
export function createRetailAgentGraph() {
  const workflow = new StateGraph(AgentStateAnnotation)
    .addNode(GRAPH_NODES.INPUT_GUARD, inputGuardNode)
    .addNode(GRAPH_NODES.PLANNER, plannerNode)
    .addNode(GRAPH_NODES.TOOL_EXECUTOR, toolExecutorNode)
    .addNode(GRAPH_NODES.EVIDENCE_VERIFIER, evidenceVerifierNode)
    .addNode(GRAPH_NODES.NORMAL_SYNTHESIZER, normalSynthesizerNode)
    .addNode(GRAPH_NODES.DEGRADED_SYNTHESIZER, degradedSynthesizerNode)
    .addNode(GRAPH_NODES.OUTPUT_GUARD, outputGuardNode)
    .addEdge(START, GRAPH_NODES.INPUT_GUARD)
    .addEdge(GRAPH_NODES.INPUT_GUARD, GRAPH_NODES.PLANNER)
    .addEdge(GRAPH_NODES.PLANNER, GRAPH_NODES.TOOL_EXECUTOR)
    .addEdge(GRAPH_NODES.TOOL_EXECUTOR, GRAPH_NODES.EVIDENCE_VERIFIER)
    .addConditionalEdges(GRAPH_NODES.EVIDENCE_VERIFIER, routeAfterEvidenceVerifier, {
      [GRAPH_NODES.TOOL_EXECUTOR]: GRAPH_NODES.TOOL_EXECUTOR,
      [GRAPH_NODES.DEGRADED_SYNTHESIZER]: GRAPH_NODES.DEGRADED_SYNTHESIZER,
      [GRAPH_NODES.NORMAL_SYNTHESIZER]: GRAPH_NODES.NORMAL_SYNTHESIZER,
    })
    .addEdge(GRAPH_NODES.NORMAL_SYNTHESIZER, GRAPH_NODES.OUTPUT_GUARD)
    .addEdge(GRAPH_NODES.DEGRADED_SYNTHESIZER, GRAPH_NODES.OUTPUT_GUARD)
    .addEdge(GRAPH_NODES.OUTPUT_GUARD, END)

  return workflow.compile({
    checkpointer: agentCheckpointer,
    store: agentLongTermStore,
  })
}

// 缓存编译后的单例状态图
let compiledGraph = null

export function getCompiledAgentGraph() {
  if (!compiledGraph) {
    compiledGraph = createRetailAgentGraph()
  }
  return compiledGraph
}

/**
 * 契约规定的顶层 Agent 入口函数：
 * runAgent(request: AgentRequest, options?: { sessionId?: string }): Promise<AgentResponse>
 * - 当传入 request.sessionId 或 options.sessionId 时，自动启用跨轮次会话记忆与指代消解；
 * - 未传 sessionId 时默认使用单次隔离 thread_id，保证无状态契约调用互不污染。
 */
export async function runAgent(request, options = {}) {
  const traceId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const sessionId = request?.sessionId || options?.sessionId || null
  const threadId = sessionId || traceId
  const graph = getCompiledAgentGraph()

  const priorMemory = sessionId
    ? await loadSessionMemory(sessionId)
    : { messages: [], memoryContext: undefined }

  const finalState = await graph.invoke(
    {
      traceId,
      sessionId,
      request,
      messages: priorMemory.messages,
      memoryContext: priorMemory.memoryContext,
      // 重置当轮瞬态执行槽位，避免上一轮 findings 混入当轮响应
      toolCalls: [],
      findings: [],
      regionComparison: [],
      assumptions: [],
      kvCacheStats: [],
      replanCount: 0,
      needsReplan: false,
      degraded: false,
    },
    {
      configurable: { thread_id: threadId },
    },
  )
  return finalState.response
}

/**
 * 供 Agent 检测台 (Inspection Workbench) 调用的全链路诊断执行入口：
 * - 底层运行同一份官方 LangGraph StateGraph；
 * - 除返回标准契约 AgentResponse 外，同步返回节点级 Trace、KV Cache Token 指标、标准消息轨迹、会话记忆槽位与合同拦截告警。
 */
export async function runAgentWithDiagnostics(request, options = {}) {
  const startedAt = Date.now()
  const traceId = `trace_${startedAt}_${Math.random().toString(36).slice(2, 7)}`
  const sessionId = request?.sessionId || options?.sessionId || null
  const threadId = sessionId || traceId
  const graph = getCompiledAgentGraph()

  const priorMemory = sessionId
    ? await loadSessionMemory(sessionId)
    : { messages: [], memoryContext: undefined }

  const finalState = await graph.invoke(
    {
      traceId,
      sessionId,
      request,
      messages: priorMemory.messages,
      memoryContext: priorMemory.memoryContext,
      toolCalls: [],
      findings: [],
      regionComparison: [],
      assumptions: [],
      kvCacheStats: [],
      replanCount: 0,
      needsReplan: false,
      degraded: false,
    },
    {
      configurable: { thread_id: threadId },
    },
  )

  const latencyMs = Date.now() - startedAt
  return {
    traceId,
    sessionId,
    latencyMs,
    response: finalState.response,
    intent: finalState.intent,
    plannedTools: finalState.plannedTools || [],
    securityWarnings: finalState.securityWarnings || [],
    kvCacheStats: finalState.kvCacheStats || [],
    messages: finalState.messages || [],
    memoryContext: finalState.memoryContext || null,
    degraded: Boolean(finalState.degraded),
    degradedReason: finalState.degradedReason || '',
    trace: getTraceById(traceId),
  }
}

/**
 * 创建遵循《上下文与 KV Cache 约束》的多轮对话 Session：
 * - 底层绑定唯一 sessionId 与官方 LangGraph Checkpointer thread_id；
 * - 静态前缀（System + 7 个固定顺序 Tools）始终只出现在 messages[0] 之前或首条；
 * - 每轮对话的新消息严格以 Append-only 方式追加到历史轨迹末尾，绝不滑动窗口截断或重排；
 * - 支持跨轮次焦点实体记忆（lastDeviceId / lastRegionIds / lastTaskId）与指代消解。
 */
export function createAgentSession(customSessionId = null) {
  const sessionId =
    customSessionId || `session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  let sessionMessages = []
  let latestMemoryContext = null

  return {
    sessionId,
    async run(request) {
      const traceId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const graph = getCompiledAgentGraph()
      const priorMemory = await loadSessionMemory(sessionId)
      const baseMessages =
        sessionMessages.length > 0 ? sessionMessages : priorMemory.messages
      const baseMemoryContext = latestMemoryContext || priorMemory.memoryContext

      const finalState = await graph.invoke(
        {
          traceId,
          sessionId,
          request,
          messages: baseMessages,
          memoryContext: baseMemoryContext,
          toolCalls: [],
          findings: [],
          regionComparison: [],
          assumptions: [],
          kvCacheStats: [],
          replanCount: 0,
          needsReplan: false,
          degraded: false,
        },
        {
          configurable: { thread_id: sessionId },
        },
      )
      sessionMessages = finalState.messages || sessionMessages
      latestMemoryContext = finalState.memoryContext || latestMemoryContext
      return {
        response: finalState.response,
        kvCacheStats: finalState.kvCacheStats || [],
        messages: sessionMessages,
        memoryContext: latestMemoryContext,
      }
    },
    getMessages() {
      return sessionMessages
    },
    getMemoryContext() {
      return latestMemoryContext
    },
  }
}


