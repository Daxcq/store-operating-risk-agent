/**
 * 第三层 & 第七层（第三方大模型 API 适配器）：llmClient.js
 *
 * 职责：
 * 1. 统一接入第三方大模型 API（支持 OpenAI 兼容接口：DeepSeek / 通义千问 / 智谱 / Moonshot / OpenAI / OneAPI，以及 Anthropic 原生接口）；
 * 2. 严格通过 contextBuilder.js 组装请求，保证静态前缀（System Prompt + 7 个 Tool Schema）跨轮次、跨会话 100% 命中 KV Cache；
 * 3. 自动采集每次调用的 KV Cache 命中指标（cache_read_input_tokens / cache_creation_input_tokens / cached_tokens）；
 * 4. 实现“真实第三方 API + 确定性引擎”双擎无缝切换（未配置 Key 或网络异常时自动平滑降级）。
 */

import { WHITELISTED_TOOL_NAMES, INTENT_TYPES } from '../definition.js'
import {
  initOrAppendSessionMessages,
  appendUserMessage,
  appendAssistantTextMessage,
  buildLLMRequestPayload,
  extractKvCacheMetrics,
  verifyStaticPrefixIntegrity,
} from './contextBuilder.js'
import { parseIntentAndPlanTools } from './intentParser.js'
import { synthesizeNormalResponse } from './synthesizer.js'

const VALID_TOOLS = new Set(WHITELISTED_TOOL_NAMES)

/**
 * 规范化第三方 API BaseURL：
 * 自动将阶跃星辰控制台地址 https://platform.stepfun.com/step-plan 映射为 OpenAI 兼容网关地址 https://api.stepfun.com/step_plan/v1
 */
export function normalizeBaseUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim().replace(/\/+$/, '')
  if (
    !trimmed ||
    trimmed === 'https://platform.stepfun.com/step-plan' ||
    trimmed === 'https://platform.stepfun.com/step_plan'
  ) {
    return 'https://api.stepfun.com/step_plan/v1'
  }
  return trimmed
}

/**
 * 规范化第三方模型名称：
 * 自动将 "stepfun5 preview" / "step5 preview" 映射为阶跃星辰官方模型 ID "step-5-preview"
 */
export function normalizeModelName(rawModel) {
  const trimmed = String(rawModel || '').trim()
  const lower = trimmed.toLowerCase().replace(/\s+/g, '-')
  if (
    !trimmed ||
    lower === 'stepfun5-preview' ||
    lower === 'stepfun-5-preview' ||
    lower === 'step5-preview'
  ) {
    return 'step-5-preview'
  }
  return trimmed
}

let runtimeLLMConfig = {
  provider: process.env.LLM_PROVIDER || 'openai-compatible', // 'openai-compatible' | 'anthropic'
  apiKey:
    process.env.LLM_API_KEY ??
    '3lz093nq8zbClyisHW9pqj9trmVPo5mBsDGZLlfrv76iUFYn5OUolMNNX9CNc83AT',
  baseUrl: normalizeBaseUrl(
    process.env.LLM_BASE_URL || 'https://platform.stepfun.com/step-plan',
  ),
  model: normalizeModelName(process.env.LLM_MODEL || 'stepfun5 preview'),
  timeoutMs: Number(process.env.LLM_TIMEOUT_MS) || 45000,
  customFetch: null, // 支持测试注入 Mock Fetch 验证多轮 KV Cache 命中
}

/**
 * 动态配置或更新第三方 API 参数
 */
export function configureLLMClient(overrides = {}) {
  const next = {
    ...runtimeLLMConfig,
    ...overrides,
  }
  if (overrides.baseUrl !== undefined) {
    next.baseUrl = normalizeBaseUrl(overrides.baseUrl)
  }
  if (overrides.model !== undefined) {
    next.model = normalizeModelName(overrides.model)
  }
  runtimeLLMConfig = next
}

/**
 * 获取当前第三方 API 配置
 */
export function getLLMConfig() {
  return {
    provider: runtimeLLMConfig.provider || process.env.LLM_PROVIDER || 'openai-compatible',
    apiKey:
      runtimeLLMConfig.apiKey !== undefined
        ? runtimeLLMConfig.apiKey
        : process.env.LLM_API_KEY || '',
    baseUrl: normalizeBaseUrl(
      runtimeLLMConfig.baseUrl || process.env.LLM_BASE_URL || 'https://platform.stepfun.com/step-plan',
    ),
    model: normalizeModelName(
      runtimeLLMConfig.model || process.env.LLM_MODEL || 'stepfun5 preview',
    ),
    timeoutMs: runtimeLLMConfig.timeoutMs || 45000,
    customFetch: runtimeLLMConfig.customFetch,
  }
}

/**
 * 判断是否已配置可用的第三方 API Key 或自定义 Fetch
 */
export function isLLMConfigured() {
  const cfg = getLLMConfig()
  return Boolean((cfg.apiKey && cfg.apiKey.trim().length > 0) || typeof cfg.customFetch === 'function')
}

/**
 * 底层调用第三方 LLM API（严格遵守 KV Cache 静态前缀与标准 role 格式）
 */
export async function callThirdPartyLLM({ messages, toolChoice = 'auto' }) {
  if (!verifyStaticPrefixIntegrity()) {
    throw new Error('KV Cache 静态前缀完整性校验失败：禁止修改系统提示词或工具列表定义')
  }

  const cfg = getLLMConfig()
  const payload = buildLLMRequestPayload({
    messages,
    model: cfg.model,
    provider: cfg.provider,
    temperature: 0,
    toolChoice,
  })

  const fetchImpl = cfg.customFetch || globalThis.fetch
  const cleanBase = cfg.baseUrl.replace(/\/+$/, '')
  const endpoint =
    cfg.provider === 'anthropic'
      ? `${cleanBase}/messages`
      : `${cleanBase}/chat/completions`

  const headers =
    cfg.provider === 'anthropic'
      ? {
          'Content-Type': 'application/json',
          'x-api-key': cfg.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',
        }
      : {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)

  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Third-party LLM HTTP ${res.status}: ${errText.slice(0, 200)}`)
    }

    const data = await res.json()
    const cacheMetrics = extractKvCacheMetrics(data)

    // 解析 Anthropic 响应
    if (cfg.provider === 'anthropic') {
      const blocks = Array.isArray(data.content) ? data.content : []
      const textBlock = blocks.find((b) => b.type === 'text')
      const toolBlocks = blocks.filter((b) => b.type === 'tool_use')
      return {
        content: textBlock ? textBlock.text : '',
        toolCalls: toolBlocks.map((tb, idx) => ({
          id: tb.id || `call_${idx + 1}`,
          toolName: tb.name,
          args: tb.input || {},
        })),
        cacheMetrics,
      }
    }

    // 解析 OpenAI 兼容响应
    const choice = data?.choices?.[0]?.message || {}
    const rawToolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : []
    const parsedToolCalls = rawToolCalls.map((tc, idx) => {
      let args = {}
      try {
        args =
          typeof tc.function?.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function?.arguments || {}
      } catch {
        args = {}
      }
      return {
        id: tc.id || `call_${idx + 1}`,
        toolName: tc.function?.name,
        args,
      }
    })

    return {
      content: choice.content || '',
      toolCalls: parsedToolCalls,
      cacheMetrics,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 第一阶段（Plan）：使用第三方 LLM 或确定性规则规划白名单工具
 */
export async function planWithThirdPartyLLMOrFallback(
  query,
  runtimeMeta = {},
  existingMessages = null,
  memoryContext = null,
) {
  const initialMessages = initOrAppendSessionMessages(query, runtimeMeta, existingMessages)
  const deterministicPlan = parseIntentAndPlanTools(query, memoryContext)

  // 如果是显式探测数据不足场景，或未配置第三方 API Key，走确定性规则但保持标准 messages 结构
  if (deterministicPlan.intent.forceInsufficient || !isLLMConfigured()) {
    const plannedWithIds = deterministicPlan.plannedTools.map((t, idx) => ({
      id: `call_plan_${initialMessages.length}_${idx + 1}`,
      toolName: t.toolName,
      args: t.args,
    }))
    return {
      intent: deterministicPlan.intent,
      plannedTools: plannedWithIds,
      messages: initialMessages,
      cacheMetrics: null,
      usedLLM: false,
    }
  }

  try {
    const llmResult = await callThirdPartyLLM({
      messages: initialMessages,
      toolChoice: 'auto',
    })

    const validCalls = llmResult.toolCalls.filter((tc) => VALID_TOOLS.has(tc.toolName))
    if (validCalls.length > 0) {
      const hasRegionCompare = validCalls.some(
        (c) => c.toolName === 'compare_regions' || c.toolName === 'estimate_region_roi',
      )
      const hasAudit = validCalls.some((c) => c.toolName === 'run_audit')
      const hasDash = validCalls.some((c) => c.toolName === 'get_dashboard')

      let inferredType = deterministicPlan.intent.type
      if (hasRegionCompare && !hasAudit) inferredType = INTENT_TYPES.REGION_COMPARISON
      else if (hasDash && !hasAudit && !hasRegionCompare) inferredType = INTENT_TYPES.DASHBOARD_OVERVIEW
      else if (hasRegionCompare && hasAudit) inferredType = INTENT_TYPES.COMPREHENSIVE

      // 补齐契约要求的伴随工具（例如 compare_regions 伴随 estimate_region_roi）
      const existingNames = new Set(validCalls.map((c) => c.toolName))
      const mergedCalls = [...validCalls]
      for (const reqTool of deterministicPlan.plannedTools) {
        if (!existingNames.has(reqTool.toolName)) {
          mergedCalls.push({
            id: `call_comp_${initialMessages.length}_${mergedCalls.length + 1}`,
            toolName: reqTool.toolName,
            args: reqTool.args,
          })
          existingNames.add(reqTool.toolName)
        }
      }

      return {
        intent: {
          ...deterministicPlan.intent,
          type: inferredType,
        },
        plannedTools: mergedCalls,
        messages: initialMessages,
        cacheMetrics: llmResult.cacheMetrics,
        usedLLM: true,
      }
    }
  } catch {
    // 第三方 API 超时或报错时平滑回退到确定性规划器
  }

  const fallbackPlanned = deterministicPlan.plannedTools.map((t, idx) => ({
    id: `call_plan_${initialMessages.length}_${idx + 1}`,
    toolName: t.toolName,
    args: t.args,
  }))
  return {
    intent: deterministicPlan.intent,
    plannedTools: fallbackPlanned,
    messages: initialMessages,
    cacheMetrics: null,
    usedLLM: false,
  }
}

/**
 * 第三阶段（Synthesize）：基于末尾追加的 tool 结果，调用第三方 LLM 生成总结与建议（失败或幻觉时自动回退）
 */
export async function synthesizeWithThirdPartyLLMOrFallback(state) {
  const deterministicSynth = synthesizeNormalResponse(state)
  if (!isLLMConfigured() || !Array.isArray(state.messages) || state.messages.length === 0) {
    return {
      ...deterministicSynth,
      cacheMetrics: null,
      usedLLM: false,
    }
  }

  try {
    // 严格遵守规则 2 & 3：直接在已追加 tool(tool_call_id) 的消息轨迹上发起总结调用，绝不修改前缀或插入额外消息
    const llmResult = await callThirdPartyLLM({
      messages: state.messages,
      toolChoice: 'none',
    })

    const rawText = String(llmResult.content || '').trim()
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        if (typeof parsed.summary === 'string' && parsed.summary.trim().length > 0) {
          const completedMessages = appendAssistantTextMessage(state.messages, rawText)
          return {
            draftSummary: parsed.summary.trim(),
            draftRecommendations: Array.isArray(parsed.recommendations)
              ? parsed.recommendations
              : deterministicSynth.draftRecommendations,
            messages: completedMessages,
            cacheMetrics: llmResult.cacheMetrics,
            usedLLM: true,
          }
        }
      } catch {
        // JSON 解析异常时继续使用下方文本提取或确定性兜底，但保留 cacheMetrics
      }
    }

    const assistantReplyText =
      rawText ||
      JSON.stringify({
        summary: deterministicSynth.draftSummary,
        recommendations: deterministicSynth.draftRecommendations,
      })
    const completedMessages = appendAssistantTextMessage(state.messages, assistantReplyText)

    return {
      draftSummary: rawText ? rawText.split('\n')[0].trim() : deterministicSynth.draftSummary,
      draftRecommendations: deterministicSynth.draftRecommendations,
      messages: completedMessages,
      cacheMetrics: llmResult.cacheMetrics,
      usedLLM: true,
    }
  } catch {
    // 解析失败或网络错误时平滑回退
  }

  return {
    ...deterministicSynth,
    cacheMetrics: null,
    usedLLM: false,
  }
}

