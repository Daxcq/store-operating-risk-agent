/**
 * 第三层 & 第四层（上下文与 KV Cache 约束组装器）：contextBuilder.js
 *
 * 严格遵守《上下文与 KV Cache 约束》六大铁律：
 * 1. 静态前缀一经确定，永不修改（SYSTEM_PROMPT_CONTRACT + 固定顺序 7 个工具 JSON Schema 深度冻结，零运行时变量插值）；
 * 2. 动态信息一律追加到末尾（query、data_version、观察窗口、工具结果全部以新消息追加在尾部）；
 * 3. 严格使用标准 API 消息格式（仅使用 system / user / assistant / tool 四种 role + 顶层 tools 字段，工具结果必须携带 tool_call_id）；
 * 4. 禁止滑动窗口截断历史（无 slice(-N) 逻辑，保持前缀一致性）；
 * 5. 缓存边界之前只放全局共享内容（跨用户、跨会话字节级一致）；
 * 6. 支持提取并验证缓存命中指标（cache_creation_input_tokens / cache_read_input_tokens / cached_tokens）。
 */

import { createHash } from 'node:crypto'
import { SYSTEM_PROMPT_CONTRACT } from '../definition.js'

/**
 * 深度冻结工具函数，防止任何运行时代码意外篡改静态前缀对象
 */
function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj)
    for (const key of Object.keys(obj)) {
      deepFreeze(obj[key])
    }
  }
  return obj
}

/**
 * 固定顺序、不可变的 7 个白名单工具标准 JSON Schema（跨所有请求字节级恒等，严禁动态排序或插值）
 */
export const STATIC_TOOLS_SCHEMA = deepFreeze([
  {
    type: 'function',
    function: {
      name: 'get_dashboard',
      description: '查询指定区域与时间窗口的经营驾驶舱核心指标摘要（销售额、利润、设备数、在线率、待处理异常数）',
      parameters: {
        type: 'object',
        properties: {
          regionId: { type: 'string', description: '区域标识，如 changchun, chaoyang, nanguan' },
          from: { type: 'string', description: '起始日期 YYYY-MM-DD' },
          to: { type: 'string', description: '结束日期 YYYY-MM-DD' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_audit',
      description: '按固定审计规则检测门店/设备经营异常，返回异常发现、严重程度、证据列表与处置建议',
      parameters: {
        type: 'object',
        properties: {
          regionId: { type: 'string', description: '区域标识' },
          from: { type: 'string', description: '起始日期 YYYY-MM-DD' },
          to: { type: 'string', description: '结束日期 YYYY-MM-DD' },
          deviceId: { type: 'string', description: '设备标识，如 device-A-001' },
          severity: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
            description: '异常严重程度过滤',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_regions',
      description: '横向比较多个候选区域或可比门店的评分、预计月利润、回本周期、理由与假设',
      parameters: {
        type: 'object',
        properties: {
          regionIds: {
            type: 'array',
            items: { type: 'string' },
            description: '候选区域 ID 数组，如 ["chaoyang", "nanguan"]',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'estimate_region_roi',
      description: '针对单个目标区域进行投放评分与收益回本周期（ROI）测算',
      parameters: {
        type: 'object',
        properties: {
          regionId: { type: 'string', description: '目标区域 ID，如 chaoyang' },
        },
        required: ['regionId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: '根据已确认的行动卡创建经营核查任务（写操作，需人工确认或明确指令）',
      parameters: {
        type: 'object',
        properties: {
          ownerRole: { type: 'string', description: '负责人角色，如 区域经理' },
          dueHours: { type: 'number', description: '截止小时数，如 24' },
          action: { type: 'string', description: '具体核查动作描述' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'verify_task',
      description: '根据下一周期复核指标（如 refund_rate）判定任务关闭（closed）或升级（escalated）',
      parameters: {
        type: 'object',
        properties: {
          scenario: {
            type: 'string',
            enum: ['improved-task', 'unresolved-task'],
            description: '复核场景标识',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_report',
      description: '将已验证的结构化审计与区域对比结果持久化为可追溯报告',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: '报告核心结论摘要' },
        },
        additionalProperties: false,
      },
    },
  },
])

/**
 * 不可变的静态 System 消息对象（缓存边界之前的首条消息，永不修改）
 */
export const STATIC_SYSTEM_MESSAGE = deepFreeze({
  role: 'system',
  content: SYSTEM_PROMPT_CONTRACT,
})

/**
 * 预计算的静态前缀 SHA-256 指纹（用于运行时自检静态前缀是否被意外改动）
 */
export const STATIC_PREFIX_FINGERPRINT = createHash('sha256')
  .update(JSON.stringify({ system: STATIC_SYSTEM_MESSAGE, tools: STATIC_TOOLS_SCHEMA }))
  .digest('hex')

const ALLOWED_ROLES = new Set(['system', 'user', 'assistant', 'tool'])

/**
 * 初始化符合 KV Cache 规范的对话轨迹：
 * - 首条固定为不可变的 STATIC_SYSTEM_MESSAGE；
 * - 用户问题与动态运行时上下文（如 data_version、观察窗口）追加在末尾的 user 消息中。
 */
export function createInitialMessages(query, runtimeMeta = {}) {
  const dynamicTailLines = [String(query || '').trim()]

  // 动态运行时属性一律放在末尾 user 消息尾部，绝不污染 system prompt
  const metaParts = []
  if (runtimeMeta.dataVersion) metaParts.push(`data_version=${runtimeMeta.dataVersion}`)
  if (runtimeMeta.window) metaParts.push(`window=${runtimeMeta.window}`)
  if (runtimeMeta.regionScope) metaParts.push(`region_scope=${runtimeMeta.regionScope}`)
  if (metaParts.length > 0) {
    dynamicTailLines.push(`\n[Runtime Status: ${metaParts.join(', ')}]`)
  }

  return Object.freeze([
    STATIC_SYSTEM_MESSAGE,
    Object.freeze({
      role: 'user',
      content: dynamicTailLines.join(''),
    }),
  ])
}

/**
 * 向消息历史尾部追加 assistant 的 tool_calls 消息（Append-Only，返回全新冻结数组，不修改原数组）
 */
export function appendAssistantToolCallsMessage(existingMessages, toolCallsWithIds) {
  const formattedCalls = toolCallsWithIds.map((item) =>
    Object.freeze({
      id: item.id,
      type: 'function',
      function: Object.freeze({
        name: item.toolName,
        arguments: JSON.stringify(item.args || {}),
      }),
    }),
  )

  return Object.freeze([
    ...existingMessages,
    Object.freeze({
      role: 'assistant',
      content: null,
      tool_calls: Object.freeze(formattedCalls),
    }),
  ])
}

/**
 * 向消息历史尾部追加标准 tool 角色消息（必须带 tool_call_id，严禁降级为 user 消息）
 */
export function appendToolResultMessage(existingMessages, { toolCallId, toolName, resultPayload }) {
  if (!toolCallId || typeof toolCallId !== 'string') {
    throw new Error('KV Cache 契约违规：tool 消息必须携带合法的 tool_call_id')
  }
  const serialized =
    typeof resultPayload === 'string' ? resultPayload : JSON.stringify(resultPayload)

  return Object.freeze([
    ...existingMessages,
    Object.freeze({
      role: 'tool',
      tool_call_id: toolCallId,
      name: toolName,
      content: serialized,
    }),
  ])
}

/**
 * 向消息历史尾部追加新的 user 消息（如触发最终结构化总结指令或下一轮用户提问）
 */
export function appendUserMessage(existingMessages, content) {
  return Object.freeze([
    ...existingMessages,
    Object.freeze({
      role: 'user',
      content: String(content || ''),
    }),
  ])
}

/**
 * 向消息历史尾部追加 assistant 文本回复消息（Append-Only，用于多轮会话保持前缀连续单调增长）
 */
export function appendAssistantTextMessage(existingMessages, content) {
  return Object.freeze([
    ...existingMessages,
    Object.freeze({
      role: 'assistant',
      content: String(content || ''),
    }),
  ])
}

/**
 * 初始化或延续符合 KV Cache 规范的会话消息列表：
 * - 若传入已有 historyMessages，绝不修改前缀与已有消息，仅在末尾追加新 user 消息；
 * - 若无历史消息，则创建 [STATIC_SYSTEM_MESSAGE, userMessage]。
 */
export function initOrAppendSessionMessages(query, runtimeMeta = {}, historyMessages = null) {
  if (Array.isArray(historyMessages) && historyMessages.length >= 2) {
    const dynamicTailLines = [String(query || '').trim()]
    if (runtimeMeta.dataVersion) {
      dynamicTailLines.push(`\n[Runtime Status: data_version=${runtimeMeta.dataVersion}]`)
    }
    return appendUserMessage(historyMessages, dynamicTailLines.join(''))
  }
  return createInitialMessages(query, runtimeMeta)
}

/**
 * 组装发往第三方 API 的完整请求负载（支持 OpenAI 兼容格式与 Anthropic 显式缓存断点格式）
 */
export function buildLLMRequestPayload({
  messages,
  model = 'deepseek-chat',
  provider = 'openai-compatible',
  temperature = 0,
  toolChoice = 'auto',
}) {
  // 校验所有消息角色合法，且首条必须是未篡改的静态 system 消息
  if (!Array.isArray(messages) || messages.length < 2) {
    throw new Error('KV Cache 契约违规：messages 至少需要包含静态 system 消息与 1 条动态消息')
  }
  if (
    messages[0].role !== 'system' ||
    messages[0].content !== STATIC_SYSTEM_MESSAGE.content
  ) {
    throw new Error('KV Cache 契约违规：messages[0] 静态系统提示词前缀被修改！')
  }

  for (const msg of messages) {
    if (!ALLOWED_ROLES.has(msg.role)) {
      throw new Error(`KV Cache 契约违规：非法消息角色 ${msg.role}`)
    }
    if (msg.role === 'tool' && !msg.tool_call_id) {
      throw new Error('KV Cache 契约违规：tool 角色消息缺失 tool_call_id')
    }
  }

  if (provider === 'anthropic') {
    // Anthropic 格式：在静态 system 与最后一个静态 tool 定义上标记显式缓存断点 cache_control
    const anthropicTools = STATIC_TOOLS_SCHEMA.map((t, idx) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
      ...(idx === STATIC_TOOLS_SCHEMA.length - 1
        ? { cache_control: { type: 'ephemeral' } }
        : {}),
    }))

    const anthropicSystem = [
      {
        type: 'text',
        text: STATIC_SYSTEM_MESSAGE.content,
        cache_control: { type: 'ephemeral' },
      },
    ]

    const anthropicMessages = messages.slice(1).map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: m.tool_call_id,
              content: m.content,
            },
          ],
        }
      }
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        return {
          role: 'assistant',
          content: m.tool_calls.map((tc) => ({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || '{}'),
          })),
        }
      }
      return {
        role: m.role,
        content: m.content,
      }
    })

    return {
      model,
      temperature,
      max_tokens: 1024,
      system: anthropicSystem,
      tools: anthropicTools,
      messages: anthropicMessages,
    }
  }

  // 默认：OpenAI / DeepSeek / 通义千问 / 硅基流动 / OneAPI 标准格式
  return {
    model,
    temperature,
    tools: STATIC_TOOLS_SCHEMA,
    tool_choice: toolChoice,
    messages,
  }
}

/**
 * 从第三方 LLM 响应中提取 KV Cache 命中统计指标
 * 同时兼容：
 * - Anthropic: cache_creation_input_tokens / cache_read_input_tokens
 * - DeepSeek : prompt_cache_miss_tokens / prompt_cache_hit_tokens
 * - OpenAI   : usage.prompt_tokens_details.cached_tokens
 */
export function extractKvCacheMetrics(rawResponse = {}) {
  const usage = rawResponse?.usage || {}
  const cacheReadInputTokens =
    usage.cache_read_input_tokens ??
    usage.prompt_cache_hit_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    0

  const explicitCreation =
    usage.cache_creation_input_tokens ??
    usage.prompt_cache_miss_tokens

  const totalInputTokens =
    usage.input_tokens ??
    usage.prompt_tokens ??
    (explicitCreation ?? 0) + cacheReadInputTokens

  const cacheCreationInputTokens =
    explicitCreation !== undefined
      ? explicitCreation
      : Math.max(0, totalInputTokens - cacheReadInputTokens)

  return {
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalInputTokens,
    cacheHitRate:
      totalInputTokens > 0
        ? Number((cacheReadInputTokens / totalInputTokens).toFixed(4))
        : 0,
  }
}

/**
 * 验证当前静态前缀是否与初始指纹 100% 字节一致
 */
export function verifyStaticPrefixIntegrity() {
  const currentHash = createHash('sha256')
    .update(JSON.stringify({ system: STATIC_SYSTEM_MESSAGE, tools: STATIC_TOOLS_SCHEMA }))
    .digest('hex')
  return currentHash === STATIC_PREFIX_FINGERPRINT
}
