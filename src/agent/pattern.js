/**
 * 第二层：模式层 (Pattern Layer)
 *
 * 职责：
 * 1. 定义“基于官方 LangGraph 状态图的受控 Plan-and-Execute 模式”；
 * 2. 定义状态流转阶段（Phase）、有界重规划上限（MAX_REPLAN_ITERATIONS = 1）与条件路由策略；
 * 3. 定义“LLM + 确定性规则”双擎驱动模式配置。
 */

export const AGENT_PATTERN_META = Object.freeze({
  patternName: 'Constrained-Plan-And-Execute-StateGraph',
  framework: '@langchain/langgraph',
  maxReplanIterations: 1,
  minComparablePeers: 3,
  executionEngines: ['deterministic', 'llm-hybrid'],
})

/**
 * 状态图节点名称常量
 */
export const GRAPH_NODES = Object.freeze({
  INPUT_GUARD: 'input_guard',
  PLANNER: 'planner',
  TOOL_EXECUTOR: 'tool_executor',
  EVIDENCE_VERIFIER: 'evidence_verifier',
  NORMAL_SYNTHESIZER: 'normal_synthesizer',
  DEGRADED_SYNTHESIZER: 'degraded_synthesizer',
  OUTPUT_GUARD: 'output_guard',
})

/**
 * 受控 Plan-and-Execute 阶段枚举
 */
export const PLAN_EXECUTE_PHASES = Object.freeze({
  INIT: 'INIT',
  GUARDED: 'GUARDED',
  PLANNED: 'PLANNED',
  EXECUTED: 'EXECUTED',
  VERIFIED: 'VERIFIED',
  SYNTHESIZED: 'SYNTHESIZED',
  COMPLETED: 'COMPLETED',
})

/**
 * Evidence Verifier 之后的条件边路由函数（LangGraph Conditional Edge）
 *
 * 决策逻辑：
 * 1. 若发现高风险门店异常但尚未拉取区域对标，且重规划次数 < 1，则回跳 TOOL_EXECUTOR 补充执行（有界 Re-plan）；
 * 2. 若触发数据不足（可比对象 < 3、工具调用失败、或显式探测不足），路由至 DEGRADED_SYNTHESIZER；
 * 3. 否则路由至 NORMAL_SYNTHESIZER。
 */
export function routeAfterEvidenceVerifier(state) {
  if (state.needsReplan && state.replanCount <= AGENT_PATTERN_META.maxReplanIterations) {
    return GRAPH_NODES.TOOL_EXECUTOR
  }
  if (state.degraded) {
    return GRAPH_NODES.DEGRADED_SYNTHESIZER
  }
  return GRAPH_NODES.NORMAL_SYNTHESIZER
}
