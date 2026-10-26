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
  STATIC_SYSTEM_MESSAGE,
  verifyStaticPrefixIntegrity,
} from './contextBuilder.js'
import { parseIntentAndPlanTools } from './intentParser.js'
import { synthesizeNormalResponse, scrubInternalToolNames } from './synthesizer.js'
import { enforceToolPlanContract } from '../safety.js'

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
  timeoutMs: Number(process.env.LLM_TIMEOUT_MS) || 15000,
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
    timeoutMs: runtimeLLMConfig.timeoutMs || 15000,
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
/**
 * 构建符合本地回复标准与实测数据基线的提示词锚点（确保真实 AI 大模型实时生成时 100% 遵循本地口径与零编造规范）
 */
export function buildLocalStandardGroundingPrompt({
  query = '',
  isConversational = false,
  localBaseline = {},
}) {
  const refSummary =
    localBaseline?.structuredBlocks?.directAnswer ||
    localBaseline?.summary ||
    localBaseline?.draftSummary ||
    ''
  const refRecs =
    localBaseline?.recommendations ||
    localBaseline?.draftRecommendations ||
    []

  if (isConversational) {
    return [
      `【用户当前提问】\n${query}`,
      `\n【莱森地平线（Laisen Horizon）本地业务标准与参考要点】\n${refSummary}`,
      `\n【本地回复标准（必须严格遵守）】`,
      `1. 你的身份是「莱森地平线（Laisen Horizon）无人零售与智能云值守经营顾问（ライセン・ホライゾン）」，覆盖长春市 5 大行政区（朝阳区、南关区、宽城区、二道区、绿园区）共 26 家无人零售与智能云值守门店（A~E 核心样本店 + S001~S021 实测门店）。`,
      `2. 本地核心业务准则：门店异常审计遵循 store_anomaly_v1（销售额周环比 <= -18%、退款率 >= 4.5% 且高于同区同行中位数 2 个百分点、客单价周环比 <= -12%）；区域选址遵循 region_score_v1 四维模型（需求 35%、竞争 25%、毛利 25%、成本 15%）；夜间云值守采用 24h AI 视觉防损与 35-40-25 黄金商品配比（35% 刚需引流、40% 高毛利即食夜宵、25% 趋势网红新品）。`,
      `3. 输出格式规范：请用实时、自然、专业且有温度的中文直接回答用户。若涉及经营咨询、方法论或实操建议，请结合上方【本地业务标准与参考要点】采用清晰的「1）... 2）... 3）...」分点结构作答，总字数控制在 120~240 字之间；若为简短日常问候，控制在 80~150 字之间。`,
      `4. 严禁输出 JSON 包装、严禁输出 Markdown 标题符号（#）、严禁暴露任何内部工具函数名称（如 run_audit、compare_regions 等）。直接输出面向用户的正文。`,
    ].join('\n')
  }

  const keyMetricsText = Array.isArray(localBaseline?.structuredBlocks?.keyMetrics)
    ? localBaseline.structuredBlocks.keyMetrics.map((m) => `${m.label}: ${m.value}`).join(' | ')
    : ''
  const diagnosisText = Array.isArray(localBaseline?.structuredBlocks?.diagnosisItems)
    ? localBaseline.structuredBlocks.diagnosisItems.map((d) => `${d.title}: ${d.detail}`).join('；')
    : ''
  const findingsText = Array.isArray(localBaseline?.findings)
    ? localBaseline.findings
        .map((f) => `[${f.severity}] ${f.title}（证据：${(f.evidence || []).join('，')}；建议：${f.recommendation}）`)
        .join('；')
    : ''
  const regionText = Array.isArray(localBaseline?.regionComparison)
    ? localBaseline.regionComparison
        .map(
          (r) =>
            `${r.name}(${r.regionId}) 综合分=${r.score}, 预估月净利=${r.estimatedMonthlyProfit}, 回本周期=${r.estimatedPaybackMonths ?? '缺失'}个月, 依据=${(r.reasons || []).join('，')}`,
        )
        .join('；')
    : ''

  return [
    `【用户当前提问】\n${query}`,
    `\n【本地实测核验基线（唯一合法数据源）】`,
    `- 标准核心结论基线：${refSummary}`,
    keyMetricsText ? `- 关键实测指标：${keyMetricsText}` : '',
    diagnosisText ? `- 归因拆解明细：${diagnosisText}` : '',
    findingsText ? `- 实测异常证据：${findingsText}` : '',
    regionText ? `- 区域对比实测：${regionText}` : '',
    refRecs.length > 0 ? `- 标准行动建议：${refRecs.join('；')}` : '',
    `\n【本地结构化回复标准（必须严格遵守）】`,
    `1. 请基于上方【本地实测核验基线】，针对用户提问实时生成一段精炼、权威的中文核心业务结论（Direct Answer）。`,
    `2. 铁律（零数值编造）：你输出的每一个数字、百分比、金额、门店编号（如 A店、B店、S001、S005）、区域名称与回本周期，必须 100% 来源于【本地实测核验基线】，严禁自行编造、推算或修改任何未在基线中出现的数字！`,
    `3. 结构标准：请严格贴合【本地实测核验基线】已提供的指标作答（基线中有的指标如实引用，基线中未出现的维度无需提及），包含核心诊断定性或选址排序结论、关键实测证据指标对比，以及最高优先级的落地整改或投放动作。`,
    `4. 纯文本直出：字数控制在 100~200 字之间，直接输出一段连贯专业的中文结论正文，严禁输出 JSON 包装、严禁包含 Markdown 代码块或标题符号（#）、严禁暴露任何内部工具函数名（如 run_audit、compare_regions、get_dashboard 等）。`,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * 真实第三方 AI 大模型实时流式生成接口（SSE Token Streaming + 本地回复标准锚定）
 */
export async function streamThirdPartyLLM({
  query = '',
  isConversational = false,
  localBaseline = {},
  onDelta,
}) {
  if (!verifyStaticPrefixIntegrity() || !isLLMConfigured()) {
    return { ok: false, usedLLM: false, text: '' }
  }

  const cfg = getLLMConfig()
  const groundingPrompt = buildLocalStandardGroundingPrompt({
    query,
    isConversational,
    localBaseline,
  })

  const messages = [
    STATIC_SYSTEM_MESSAGE,
    {
      role: 'user',
      content: groundingPrompt,
    },
  ]

  const basePayload = buildLLMRequestPayload({
    messages,
    model: cfg.model,
    provider: cfg.provider,
    temperature: isConversational ? 0.3 : 0.1,
    toolChoice: 'none',
  })
  const payload = {
    ...basePayload,
    stream: true,
  }

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
          Accept: 'text/event-stream',
          'x-api-key': cfg.apiKey,
          'anthropic-version': '2023-06-01',
        }
      : {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${cfg.apiKey}`,
        }

  const controller = new AbortController()
  const initialTimeoutMs = Math.max(Number(cfg.timeoutMs) || 15000, 30000)
  let timer = setTimeout(() => controller.abort(), initialTimeoutMs)
  const resetActivityTimer = (ms = 18000) => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(), ms)
  }

  let accumulated = ''
  let pendingSegment = ''
  const emittedChunks = []

  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!res.ok) {
      return { ok: false, usedLLM: false, text: '' }
    }

    const contentType = String(res.headers?.get?.('content-type') || '')
    // 若上游返回非流式 JSON，自动拆分并流式回调
    if (!res.body || !contentType.includes('text/event-stream')) {
      const data = await res.json()
      const fullContent = scrubInternalToolNames(
        String(data?.choices?.[0]?.message?.content || data?.content?.[0]?.text || '').trim(),
      )
      if (!fullContent) {
        return { ok: false, usedLLM: false, text: '' }
      }
      const clauses = fullContent.split(/(?<=[。！？；，、：\n.!?;,:])/).filter(Boolean)
      const emitted = []
      let acc = ''
      for (const piece of clauses) {
        emitted.push(piece)
        acc += piece
        if (onDelta) {
          await onDelta(piece, acc, [...emitted])
        }
      }
      return {
        ok: true,
        usedLLM: true,
        model: cfg.model,
        text: fullContent,
        chunks: emitted,
      }
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let sseBuffer = ''

    const flushSegment = async (force = false) => {
      if (!pendingSegment) return
      if (
        force ||
        pendingSegment.length >= 6 ||
        /[。！？；，、：\n.!?;,:]/.test(pendingSegment)
      ) {
        const cleanPiece = scrubInternalToolNames(pendingSegment)
        pendingSegment = ''
        if (cleanPiece) {
          emittedChunks.push(cleanPiece)
          accumulated += cleanPiece
          if (onDelta) {
            await onDelta(cleanPiece, accumulated, [...emittedChunks])
          }
        }
      }
    }

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      resetActivityTimer(18000)
      sseBuffer += decoder.decode(value, { stream: true })

      const lines = sseBuffer.split('\n')
      sseBuffer = lines.pop() || ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line || !line.startsWith('data:')) continue
        const dataPayload = line.slice(5).trim()
        if (!dataPayload || dataPayload === '[DONE]') continue

        try {
          const parsed = JSON.parse(dataPayload)
          const token =
            parsed?.choices?.[0]?.delta?.content ??
            parsed?.delta?.text ??
            ''
          if (typeof token === 'string' && token.length > 0) {
            pendingSegment += token
            await flushSegment(false)
          }
        } catch {
          // 忽略非标准分片
        }
      }
    }

    await flushSegment(true)
    const finalClean = scrubInternalToolNames(accumulated.trim())
    if (!finalClean) {
      return { ok: false, usedLLM: false, text: '' }
    }

    return {
      ok: true,
      usedLLM: true,
      model: cfg.model,
      text: finalClean,
      chunks: emittedChunks,
    }
  } catch {
    if (pendingSegment) {
      const cleanTail = scrubInternalToolNames(pendingSegment)
      pendingSegment = ''
      if (cleanTail) {
        emittedChunks.push(cleanTail)
        accumulated += cleanTail
        if (onDelta) {
          try {
            await onDelta(cleanTail, accumulated, [...emittedChunks])
          } catch {
            // ignore callback err
          }
        }
      }
    }
    const partialClean = scrubInternalToolNames(accumulated.trim())
    if (partialClean.length >= 16) {
      return {
        ok: true,
        usedLLM: true,
        model: cfg.model,
        text: partialClean,
        chunks: emittedChunks,
      }
    }
    return { ok: false, usedLLM: false, text: '' }
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
  options = {},
) {
  const initialMessages = initOrAppendSessionMessages(query, runtimeMeta, existingMessages)
  const deterministicPlan = parseIntentAndPlanTools(query, memoryContext)

  // 如果是日常寒暄、显式探测数据不足场景，或未配置第三方 API Key，走确定性规则但保持标准 messages 结构
  if (
    options.engineMode === 'deterministic' ||
    options.engineMode === 'quick' ||
    deterministicPlan.intent.type === INTENT_TYPES.CONVERSATIONAL ||
    deterministicPlan.intent.forceInsufficient ||
    !isLLMConfigured()
  ) {
    const plannedWithIds = deterministicPlan.plannedTools.map((t, idx) => ({
      id: `call_plan_${initialMessages.length}_${idx + 1}`,
      toolName: t.toolName,
      args: t.args,
    }))
    return {
      intent: deterministicPlan.intent,
      plannedTools: plannedWithIds,
      contractViolations: [],
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

    // 核心合同门禁：将 LLM 原生 tool_calls 送入《Agent 工具规划合同校验器》
    // 1. 拦截非白名单工具；2. 拦截未获授权写操作；3. 归一化中文/别名参数；4. 补齐伴随证据；5. 严禁开放式无工具裸答
    const contractOutcome = enforceToolPlanContract({
      candidateTools: llmResult.toolCalls,
      deterministicPlan,
      messageIndex: initialMessages.length,
    })

    return {
      intent: {
        ...deterministicPlan.intent,
        type: contractOutcome.resolvedIntentType,
      },
      plannedTools: contractOutcome.plannedTools,
      contractViolations: contractOutcome.contractViolations,
      messages: initialMessages,
      cacheMetrics: llmResult.cacheMetrics,
      usedLLM: true,
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
    contractViolations: [],
    messages: initialMessages,
    cacheMetrics: null,
    usedLLM: false,
  }
}

/**
 * 第三阶段（Synthesize）：基于末尾追加的 tool 结果，调用第三方 LLM 生成总结与建议（失败或幻觉时自动回退）
 */
export async function synthesizeWithThirdPartyLLMOrFallback(state, options = {}) {
  const deterministicSynth = synthesizeNormalResponse(state)
  if (
    (state?.intent?.type === INTENT_TYPES.CONVERSATIONAL && typeof getLLMConfig().customFetch === 'function') ||
    options.engineMode === 'deterministic' ||
    options.engineMode === 'quick' ||
    !isLLMConfigured() ||
    !Array.isArray(state.messages) ||
    state.messages.length === 0
  ) {
    const nextMessages =
      state?.intent?.type === INTENT_TYPES.CONVERSATIONAL &&
      Array.isArray(state.messages) &&
      state.messages.length > 0
        ? appendAssistantTextMessage(state.messages, deterministicSynth.draftSummary)
        : state.messages
    return {
      ...deterministicSynth,
      messages: nextMessages,
      cacheMetrics: null,
      usedLLM: false,
    }
  }

  try {
    // 严格遵守规则 2 & 3：直接在已追加 tool(tool_call_id) 的消息轨迹上发起总结调用，绝不修改前缀或插入额外消息
    const llmResult = await callThirdPartyLLM({
      messages:
        typeof getLLMConfig().customFetch === 'function'
          ? state.messages
          : [
              STATIC_SYSTEM_MESSAGE,
              {
                role: 'user',
                content: buildLocalStandardGroundingPrompt({
                  query: state?.request?.query || '',
                  isConversational: state?.intent?.type === INTENT_TYPES.CONVERSATIONAL,
                  localBaseline: deterministicSynth,
                }),
              },
            ],
      toolChoice: 'none',
    })

    const rawText = String(llmResult.content || '').trim()
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        if (typeof parsed.summary === 'string' && parsed.summary.trim().length > 0) {
          const completedMessages = appendAssistantTextMessage(state.messages, rawText)
          const cleanSummary = scrubInternalToolNames(parsed.summary.trim())
          const cleanRecs = Array.isArray(parsed.recommendations)
            ? parsed.recommendations.map(scrubInternalToolNames).filter(Boolean)
            : deterministicSynth.draftRecommendations

          const mergedThinkingSteps =
            Array.isArray(parsed.thinkingSteps) && parsed.thinkingSteps.length >= 2
              ? parsed.thinkingSteps.map((step) => ({
                  phase: ['thinking', 'query', 'analysis', 'retry'].includes(step.phase)
                    ? step.phase
                    : 'analysis',
                  phaseLabel:
                    step.phase === 'thinking'
                      ? '思考环节'
                      : step.phase === 'query'
                        ? '数据查询'
                        : step.phase === 'retry'
                          ? '执行状态与重试'
                          : '分析步骤',
                  title: scrubInternalToolNames(step.title || '执行业务核查步骤'),
                  detail: scrubInternalToolNames(step.detail || ''),
                  status: ['completed', 'retried', 'degraded'].includes(step.status)
                    ? step.status
                    : 'completed',
                }))
              : deterministicSynth.draftThinkingSteps

          const mergedStructuredBlocks = {
            ...deterministicSynth.draftStructuredBlocks,
            ...(parsed.structuredBlocks && typeof parsed.structuredBlocks === 'object'
              ? {
                  questionFocus:
                    scrubInternalToolNames(parsed.structuredBlocks.questionFocus) ||
                    deterministicSynth.draftStructuredBlocks?.questionFocus,
                  directAnswer:
                    scrubInternalToolNames(parsed.structuredBlocks.directAnswer) ||
                    cleanSummary,
                }
              : {
                  directAnswer: cleanSummary,
                }),
          }

          const mergedDecisionProposal =
            parsed.decisionProposal && typeof parsed.decisionProposal === 'object'
              ? {
                  ...deterministicSynth.draftDecisionProposal,
                  title:
                    scrubInternalToolNames(parsed.decisionProposal.title) ||
                    deterministicSynth.draftDecisionProposal?.title,
                  decisionBasis:
                    Array.isArray(parsed.decisionProposal.decisionBasis) &&
                    parsed.decisionProposal.decisionBasis.length > 0
                      ? parsed.decisionProposal.decisionBasis.map(scrubInternalToolNames)
                      : deterministicSynth.draftDecisionProposal?.decisionBasis,
                  analysis:
                    scrubInternalToolNames(parsed.decisionProposal.analysis) ||
                    deterministicSynth.draftDecisionProposal?.analysis,
                  expectedImpact:
                    scrubInternalToolNames(parsed.decisionProposal.expectedImpact) ||
                    deterministicSynth.draftDecisionProposal?.expectedImpact,
                  recommendedAction:
                    scrubInternalToolNames(parsed.decisionProposal.recommendedAction) ||
                    deterministicSynth.draftDecisionProposal?.recommendedAction,
                }
              : deterministicSynth.draftDecisionProposal

          return {
            draftSummary: cleanSummary,
            draftRecommendations: cleanRecs,
            draftThinkingSteps: mergedThinkingSteps,
            draftStructuredBlocks: mergedStructuredBlocks,
            draftDecisionProposal: mergedDecisionProposal,
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
      ...deterministicSynth,
      draftSummary: rawText
        ? scrubInternalToolNames(rawText.replace(/\s+/g, ' ').trim())
        : deterministicSynth.draftSummary,
      draftStructuredBlocks:
        rawText && deterministicSynth.draftStructuredBlocks
          ? {
              ...deterministicSynth.draftStructuredBlocks,
              directAnswer: scrubInternalToolNames(rawText.replace(/\s+/g, ' ').trim()),
            }
          : deterministicSynth.draftStructuredBlocks,
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

