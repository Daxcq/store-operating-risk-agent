/**
 * 第三层（组件层）& 第四层（机制层支撑）：记忆管理组件 (Memory Manager)
 *
 * 架构职责：
 * 1. 集成官方 @langchain/langgraph 的三层记忆体系：
 *    - 短期工作记忆 (Working Memory)  : 单轮图状态 AgentStateAnnotation
 *    - 会话线程记忆 (Thread Memory)   : 官方 MemorySaver Checkpointer (按 thread_id / sessionId 持久化多轮状态与消息轨迹)
 *    - 跨会话长期记忆 (Long-Term Store): 官方 InMemoryStore (按 namespace 存储门店风险档案、已创建整改任务、历史审计报告)
 * 2. 严格遵守《上下文与 KV Cache 约束》：
 *    - 规则 1 & 2：检索出的长期记忆与指代消解上下文，绝不拼接进 System Prompt，仅追加到当前轮次末尾 user 消息；
 *    - 规则 4：严禁使用滑动窗口 (.slice(-N)) 截断历史消息！当消息轨迹超过阈值时，采用摘要压缩 (Compaction)；
 *    - 规则 6：历史消息或工具结果被压缩成的摘要字符串，首次生成后持久化缓存在 Store 中，后续轮次与会话恢复时逐字节复用同一份摘要字符串。
 */

import { MemorySaver, InMemoryStore } from '@langchain/langgraph'
import { createHash } from 'node:crypto'

// 官方 LangGraph 线程级短期记忆检查点保存器 (Checkpointer)
export const agentCheckpointer = new MemorySaver()

// 官方 LangGraph 跨线程长期记忆存储 (BaseStore)
export const agentLongTermStore = new InMemoryStore()

// 长期记忆命名空间常量
export const MEMORY_NAMESPACES = Object.freeze({
  SESSION_STATE: ['retail_agent', 'sessions'],       // 会话级实体槽位与追加式消息轨迹
  STORE_PROFILES: ['retail_agent', 'store_profiles'], // 门店历史异常与风险档案（跨会话）
  TASKS: ['retail_agent', 'tasks'],                   // 已创建的整改任务记录（跨会话）
  REPORTS: ['retail_agent', 'reports'],               // 已持久化的经营报告（跨会话）
  COMPACTIONS: ['retail_agent', 'compactions'],       // 持久化复用的历史压缩摘要（规则 6）
})

/**
 * 默认的会话级焦点实体槽位（用于多轮对话指代消解，如“它”、“这家店”、“刚才的区域”、“刚才的任务”）
 */
export function createInitialMemoryContext() {
  return {
    lastDeviceId: null,
    lastRegionIds: [],
    lastTaskId: null,
    lastIntentType: null,
    turnCount: 0,
  }
}

/**
 * 读取指定 sessionId 的会话记忆快照（含追加式消息历史与焦点实体槽位）
 */
export async function loadSessionMemory(sessionId) {
  if (!sessionId) {
    return {
      messages: [],
      memoryContext: createInitialMemoryContext(),
    }
  }

  const item = await agentLongTermStore.get(MEMORY_NAMESPACES.SESSION_STATE, sessionId)
  if (!item || !item.value) {
    return {
      messages: [],
      memoryContext: createInitialMemoryContext(),
    }
  }

  return {
    messages: Array.isArray(item.value.messages) ? item.value.messages : [],
    memoryContext: {
      ...createInitialMemoryContext(),
      ...(item.value.memoryContext || {}),
    },
  }
}

/**
 * 保存指定 sessionId 的会话记忆快照
 */
export async function saveSessionMemory(sessionId, { messages, memoryContext }) {
  if (!sessionId) return
  await agentLongTermStore.put(MEMORY_NAMESPACES.SESSION_STATE, sessionId, {
    messages: Array.isArray(messages) ? messages : [],
    memoryContext: memoryContext || createInitialMemoryContext(),
    updatedAt: 'demo_v1',
  })
}

/**
 * 从当轮执行结果中提取并更新焦点实体槽位（支持多轮指代消解）
 */
export function updateMemoryContextFromTurn(prevContext, { intent, findings, regionComparison, createdTasks }) {
  const base = prevContext || createInitialMemoryContext()
  const nextDeviceId =
    intent?.filters?.deviceId ||
    (Array.isArray(findings) && findings.length > 0 ? findings[0].deviceId : null) ||
    base.lastDeviceId

  const nextRegionIds =
    Array.isArray(intent?.filters?.regionIds) && intent.filters.regionIds.length > 0
      ? intent.filters.regionIds
      : Array.isArray(regionComparison) && regionComparison.length > 0
        ? regionComparison.map((r) => r.regionId)
        : base.lastRegionIds

  const nextTaskId =
    Array.isArray(createdTasks) && createdTasks.length > 0
      ? createdTasks[createdTasks.length - 1].taskId
      : intent?.filters?.taskId || base.lastTaskId

  return {
    lastDeviceId: nextDeviceId,
    lastRegionIds: nextRegionIds,
    lastTaskId: nextTaskId,
    lastIntentType: intent?.type || base.lastIntentType,
    turnCount: (base.turnCount || 0) + 1,
  }
}

/**
 * 写入跨会话长期记忆（门店异常档案、整改任务、审计报告）
 */
export async function recordLongTermMemories({ findings = [], createdTasks = [], reports = [] }) {
  // 1. 记录门店风险档案
  for (const finding of findings) {
    if (finding.deviceId) {
      const existing = await agentLongTermStore.get(MEMORY_NAMESPACES.STORE_PROFILES, finding.deviceId)
      const prevFindings = existing?.value?.findings || []
      const merged = [
        ...prevFindings.filter((f) => f.findingId !== finding.findingId),
        finding,
      ]
      await agentLongTermStore.put(MEMORY_NAMESPACES.STORE_PROFILES, finding.deviceId, {
        deviceId: finding.deviceId,
        lastSeverity: finding.severity,
        findings: merged,
      })
    }
  }

  // 2. 记录已创建的整改任务
  for (const task of createdTasks) {
    if (task.taskId) {
      await agentLongTermStore.put(MEMORY_NAMESPACES.TASKS, task.taskId, task)
    }
  }

  // 3. 记录已生成的报告
  for (const report of reports) {
    if (report.reportId) {
      await agentLongTermStore.put(MEMORY_NAMESPACES.REPORTS, report.reportId, report)
    }
  }
}

/**
 * 检索与当前焦点实体关联的跨会话长期记忆快照（用于追加到对话最末端，绝不污染静态前缀）
 */
export async function retrieveRelevantLongTermMemory({ deviceId, taskId }) {
  const result = {
    storeProfile: null,
    taskRecord: null,
  }

  if (deviceId) {
    const profileItem = await agentLongTermStore.get(MEMORY_NAMESPACES.STORE_PROFILES, deviceId)
    if (profileItem?.value) {
      result.storeProfile = profileItem.value
    }
  }

  if (taskId) {
    const taskItem = await agentLongTermStore.get(MEMORY_NAMESPACES.TASKS, taskId)
    if (taskItem?.value) {
      result.taskRecord = taskItem.value
    }
  }

  return result
}

/**
 * 严格遵循《上下文与 KV Cache 约束》规则 4 与规则 6 的历史上下文压缩器 (Compactor)：
 * - 规则 4：禁止用“只保留最近 N 条消息”的滑动窗口控制长度；用压缩/摘要实现。
 * - 规则 6：摘要字符串首次生成后必须持久化复用，会话恢复时也使用完全相同的字符串。
 *
 * @param {Array} messages 当前完整消息数组（messages[0] 为静态 system 消息）
 * @param {object} options
 * @param {number} [options.maxMessages=40] 触发压缩的消息数高水位线
 * @param {number} [options.compactChunkSize=20] 每次归档压缩的前序动态消息条数
 */
export async function compactMessagesIfNeeded(messages, { maxMessages = 40, compactChunkSize = 20 } = {}) {
  if (!Array.isArray(messages) || messages.length <= maxMessages) {
    return {
      compacted: false,
      messages,
      summaryHash: null,
    }
  }

  // messages[0] 永远是不可变的 STATIC_SYSTEM_MESSAGE
  const systemMessage = messages[0]
  const chunkToCompact = messages.slice(1, 1 + compactChunkSize)
  const tailMessages = messages.slice(1 + compactChunkSize)

  // 计算被压缩分片的确定性哈希，满足规则 6“首次生成后持久化复用完全相同的字符串”
  const chunkHash = createHash('sha256')
    .update(JSON.stringify(chunkToCompact))
    .digest('hex')

  const cachedCompaction = await agentLongTermStore.get(MEMORY_NAMESPACES.COMPACTIONS, chunkHash)
  let summaryText = cachedCompaction?.value?.summaryText

  if (!summaryText) {
    // 生成确定性、无时间戳的压缩摘要字符串，并持久化到 Store
    const userQueries = chunkToCompact
      .filter((m) => m.role === 'user')
      .map((m) => String(m.content).split('\n')[0].trim())
    const toolNames = chunkToCompact
      .filter((m) => m.role === 'assistant' && Array.isArray(m.tool_calls))
      .flatMap((m) => m.tool_calls.map((tc) => tc.function?.name))

    summaryText = `[历史会话归档摘要 #${chunkHash.slice(0, 8)}] 已完成 ${userQueries.length} 轮历史问询（${userQueries.join('；')}），累计调用工具：${Array.from(new Set(toolNames)).join(', ') || '无'}。`

    await agentLongTermStore.put(MEMORY_NAMESPACES.COMPACTIONS, chunkHash, {
      chunkHash,
      summaryText,
    })
  }

  const summaryMessage = Object.freeze({
    role: 'user',
    content: summaryText,
  })

  return {
    compacted: true,
    messages: [systemMessage, summaryMessage, ...tailMessages],
    summaryHash: chunkHash,
    summaryText,
  }
}
