/**
 * 第七层（工程层 - 可观测性与 Trace 审计日志）：traceLogger.js
 *
 * 职责：
 * 1. 记录每次 Agent Run 在 LangGraph 各节点中的流转轨迹、输入参数、工具调用及数据版本；
 * 2. 支持按 traceId 回放完整执行链路，满足 PROJECT.md 与 TECHNICAL_ARCHITECTURE.md 的可追溯要求。
 * 3. Node 运行时异步发送到 Python 数据层；持久化失败时保留内存日志。
 */

import { AGENT_IDENTITY } from '../agent/definition.js'

const MAX_TRACE_HISTORY = 100
const traceStore = new Map()

function isNodeRuntime() {
  return typeof window === 'undefined'
    && typeof process !== 'undefined'
    && Boolean(process.versions?.node)
}

async function persistTraceEvent(traceId, nodeName, payload) {
  if (!isNodeRuntime() || process.env.DATA_LAYER_ENABLED === '0') return
  try {
    const { writeTraceEvent } = await import('./dataLayerClient.js')
    await writeTraceEvent({ traceId, nodeName, payload })
  } catch (error) {
    console.warn('[trace] 持久化失败，已保留内存日志：', error.message)
  }
}

/**
 * 记录单个状态图节点的执行事件
 */
export function recordTraceEvent(traceId, nodeName, payload = {}) {
  if (!traceId) return
  if (!traceStore.has(traceId)) {
    if (traceStore.size >= MAX_TRACE_HISTORY) {
      const oldestKey = traceStore.keys().next().value
      traceStore.delete(oldestKey)
    }
    traceStore.set(traceId, {
      traceId,
      dataVersion: AGENT_IDENTITY.dataVersion,
      createdAt: new Date().toISOString(),
      events: [],
    })
  }
  const trace = traceStore.get(traceId)
  trace.events.push({
    node: nodeName,
    timestamp: new Date().toISOString(),
    ...payload,
  })
  void persistTraceEvent(traceId, nodeName, payload)
}

/**
 * 获取指定 traceId 的完整追踪记录
 */
export function getTraceById(traceId) {
  return traceStore.get(traceId) || null
}

/**
 * 获取最近的 Trace 列表
 */
export function getRecentTraces(limit = 20) {
  return Array.from(traceStore.values()).slice(-limit)
}

/**
 * 清空 Trace 缓存（测试用）
 */
export function clearTraces() {
  traceStore.clear()
}
