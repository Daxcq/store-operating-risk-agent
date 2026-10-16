/**
 * 成员 C 七层 Agent 架构 + 第三方 API + 《上下文与 KV Cache 约束》10 轮缓存命中全链路验证脚本
 */

import { createHash } from 'node:crypto'
import {
  AGENT_IDENTITY,
  WHITELISTED_TOOL_NAMES,
  AGENT_PATTERN_META,
  STATIC_PREFIX_FINGERPRINT,
  verifyStaticPrefixIntegrity,
  configureLLMClient,
  getLLMConfig,
  normalizeBaseUrl,
  normalizeModelName,
  runAgent,
  createAgentSession,
  retrieveRelevantLongTermMemory,
  compactMessagesIfNeeded,
  handleApiRequest,
  enforceOutputGuardrails,
  getRecentTraces,
} from '../src/agent/index.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

async function main() {
  console.log('=== 1. 开始验证成员 C 七层 Agent 架构 (Official @langchain/langgraph) ===')

  // 验证阶跃星辰 StepFun Step-Plan 默认配置与规范化映射
  assert(
    normalizeBaseUrl('https://platform.stepfun.com/step-plan') === 'https://api.stepfun.com/step_plan/v1',
    'https://platform.stepfun.com/step-plan 必须自动映射为 https://api.stepfun.com/step_plan/v1',
  )
  assert(
    normalizeModelName('stepfun5 preview') === 'step-5-preview',
    'stepfun5 preview 必须自动映射为 step-5-preview',
  )
  const initialCfg = getLLMConfig()
  assert(initialCfg.baseUrl === 'https://api.stepfun.com/step_plan/v1', '默认 BaseURL 应为阶跃星辰 Step-Plan 接口')
  assert(initialCfg.model === 'step-5-preview', '默认模型应为 step-5-preview')

  // 第一阶段使用确定性引擎快速校验全部契约分支
  configureLLMClient({ apiKey: '', customFetch: null })

  // 1. 验证定义层与模式层
  assert(AGENT_IDENTITY.dataVersion === 'demo_v1', '数据版本必须为 demo_v1')
  assert(WHITELISTED_TOOL_NAMES.length === 7, '白名单工具必须严格为 7 个')
  assert(AGENT_PATTERN_META.framework === '@langchain/langgraph', '框架载体必须为 @langchain/langgraph')
  assert(verifyStaticPrefixIntegrity(), 'KV Cache 静态前缀 SHA-256 初始完整性校验必须通过')

  // 2. 验证编排层 & 组件层：区域投放对比场景（对齐 docs/API_CONTRACT.md 5.4）
  const regionRes = await runAgent({
    query: '比较朝阳区和南关区的投放收益，并说明主要风险',
  })
  assert(typeof regionRes.summary === 'string' && regionRes.summary.includes('朝阳区'), '区域对比 summary 应包含朝阳区结论')
  assert(Array.isArray(regionRes.regionComparison) && regionRes.regionComparison.length === 2, '应返回朝阳区与南关区 2 条区域对比')
  assert(regionRes.regionComparison[0].regionId === 'chaoyang', '第一候选区域应为 chaoyang')
  assert(regionRes.regionComparison[1].estimatedPaybackMonths === null, '南关区缺少完整租金数据时 estimatedPaybackMonths 必须为 null')
  assert(
    regionRes.toolCalls.some((t) => t.toolName === 'compare_regions' && t.status === 'success'),
    '应记录 compare_regions 成功调用',
  )
  assert(
    regionRes.toolCalls.some((t) => t.toolName === 'estimate_region_roi' && t.status === 'success'),
    '应记录 estimate_region_roi 成功调用',
  )

  // 3. 验证门店异常审计场景（“为什么 A 店最近表现差，先改什么？”）
  const storeARes = await runAgent({
    query: '为什么 A 店最近表现差，先改什么？',
  })
  assert(storeARes.findings.length === 2, 'A 店应检出 2 条经营异常发现')
  assert(storeARes.findings[0].severity === 'high', '首条异常应为 high 风险')
  assert(storeARes.recommendations.length > 0, '应生成可复核的处置建议')

  // 4. 验证机制层：数据不足降级分支（对齐 contracts/fixtures/insufficient-data.json）
  const degradedRes = await runAgent({
    query: '当可比门店少于 3 家且数据不足时，评估 A 店表现',
  })
  assert(
    degradedRes.summary === '当前数据不足，无法对经营异常或区域收益作出确定判断。',
    '数据不足时必须触发降级 summary',
  )
  assert(degradedRes.findings.length === 0, '数据不足降级时 findings 必须为空数组')
  assert(
    degradedRes.toolCalls.every((c) => c.status === 'error'),
    '数据不足探测时工具状态应记录为 error',
  )

  // 5. 验证安全层：防数值幻觉拦截
  const guarded = enforceOutputGuardrails({
    summary: 'A 店昨日亏损 999999 元，退款率高达 88.8%。', // 含未授权幻觉数字
    findings: storeARes.findings,
    regionComparison: [],
    recommendations: ['建议罚款 50000 元'], // 含未授权幻觉数字
    toolCalls: [{ toolName: 'run_audit', status: 'success' }],
    assumptions: ['当前结果使用 demo_v1 模拟数据。'],
    fallbackSummary: '发现多个经营发现，其中高风险发现需要优先核查退款订单。',
    fallbackRecommendations: ['优先处理退款率异常，再复核订单数变化。'],
  })
  assert(
    !guarded.summary.includes('999999'),
    '安全层输出护栏必须拦截工具未返回的幻觉数字并回退到受控摘要',
  )
  assert(
    !guarded.recommendations.some((r) => r.includes('50000')),
    '安全层输出护栏必须拦截建议中的幻觉数字',
  )

  // 6. 验证工程层：4 个 HTTP API 端点与错误契约
  const dashHttp = await handleApiRequest({
    method: 'GET',
    url: '/api/v1/dashboard?regionId=changchun&from=2026-10-12&to=2026-10-18',
  })
  assert(dashHttp.status === 200 && dashHttp.body.salesAmount === 1054000, 'GET /api/v1/dashboard 响应校验通过')

  const auditHttp = await handleApiRequest({
    method: 'GET',
    url: '/api/v1/audit?deviceId=device-A-001&severity=high',
  })
  assert(auditHttp.status === 200 && auditHttp.body.findings.length === 1, 'GET /api/v1/audit 响应校验通过')

  const regionsHttp = await handleApiRequest({
    method: 'GET',
    url: '/api/v1/regions?regionIds=%20chaoyang%20,nanguan,chaoyang,',
  })
  assert(
    regionsHttp.status === 200 &&
      Array.isArray(regionsHttp.body) &&
      regionsHttp.body.length === 2 &&
      regionsHttp.body[0].regionId === 'chaoyang',
    'GET /api/v1/regions 逗号分隔去空格与保序去重校验通过',
  )

  const agentHttp = await handleApiRequest({
    method: 'POST',
    url: '/api/v1/agent/run',
    body: JSON.stringify({ query: '查看 B 店近期异常情况' }),
  })
  assert(
    agentHttp.status === 200 &&
      agentHttp.body.findings.length === 1 &&
      agentHttp.body.findings[0].deviceId === 'device-B-001',
    'POST /api/v1/agent/run 响应校验通过',
  )

  const errHttp = await handleApiRequest({
    method: 'POST',
    url: '/api/v1/agent/run',
    body: JSON.stringify({ query: '   ' }),
  })
  assert(
    errHttp.status === 400 && errHttp.body?.error?.code === 'INVALID_QUERY',
    '空 query 必须返回 400 INVALID_QUERY',
  )

  // 7. 验证第三方 LLM API 接入与《上下文与 KV Cache 约束》10 轮缓存命中测试
  console.log('\n=== 2. 开始验证第三方 API 接入与 10 轮 KV Cache 静态前缀单调命中 ===')
  // 模拟具备真实 KV Cache 前缀树匹配能力的第三方 API 服务端
  let cachedSerializedItems = []
  const roundStats = []

  configureLLMClient({
    provider: 'openai-compatible',
    apiKey: 'sk-test-kv-cache-key',
    baseUrl: 'https://mock-third-party-llm.local/v1',
    model: 'deepseek-chat',
    customFetch: async (_url, options) => {
      const reqBody = JSON.parse(options.body)

      // 严格审查规则 1~5：
      // 检查 tools + messages[0] 静态前缀哈希是否逐字节恒等
      const currentPrefixHash = createHash('sha256')
        .update(JSON.stringify({ system: reqBody.messages[0], tools: reqBody.tools }))
        .digest('hex')

      assert(
        currentPrefixHash === STATIC_PREFIX_FINGERPRINT,
        '请求中的 System Prompt + Tools 静态前缀与全局冻结指纹不一致！',
      )

      // 将 tools 定义与 messages 序列构造成服务端 Token 块数组，模拟真实最长公共前缀 (LCP) 匹配
      const currentItems = [
        { type: 'static_tools_and_system', raw: JSON.stringify({ tools: reqBody.tools, system: reqBody.messages[0] }), tokens: 680 },
        ...reqBody.messages.slice(1).map((m) => ({
          type: 'message',
          raw: JSON.stringify(m),
          tokens: 45,
        })),
      ]

      let matchedPrefixTokens = 0
      let i = 0
      while (
        i < cachedSerializedItems.length &&
        i < currentItems.length &&
        cachedSerializedItems[i].raw === currentItems[i].raw
      ) {
        matchedPrefixTokens += currentItems[i].tokens
        i++
      }

      // 断言历史前缀从未被篡改或滑动截断（i 必须等于上一轮已缓存的全部块数）
      assert(
        i === cachedSerializedItems.length,
        `KV Cache 前缀在第 ${i} 块处发生断裂！说明存在修改历史消息或重排行为`,
      )

      const totalTokens = currentItems.reduce((acc, item) => acc + item.tokens, 0)
      const cacheRead = matchedPrefixTokens
      const cacheCreation = totalTokens - matchedPrefixTokens

      // 更新服务端 KV Cache 缓存树
      cachedSerializedItems = currentItems

      // 判断当前请求是 Planner 阶段还是 Synthesizer 阶段（依据最后一条消息是否为 tool 角色）
      const lastMsg = reqBody.messages[reqBody.messages.length - 1]
      if (lastMsg && lastMsg.role === 'tool') {
        // 验证规则 3：tool 角色消息必须带 tool_call_id
        const toolMsgs = reqBody.messages.filter((m) => m.role === 'tool')
        toolMsgs.forEach((tm) => {
          assert(typeof tm.tool_call_id === 'string' && tm.tool_call_id.length > 0, 'tool 角色消息缺失 tool_call_id')
        })

        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: JSON.stringify({
                    summary: '发现 1 个高风险经营异常，建议优先核查退款记录。',
                    recommendations: ['抽查最近 20 笔退款订单并核对退款原因。'],
                  }),
                },
              },
            ],
            usage: {
              prompt_tokens: totalTokens,
              cache_creation_input_tokens: cacheCreation,
              cache_read_input_tokens: cacheRead,
            },
          }),
        }
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: `call_llm_r${reqBody.messages.length}`,
                    type: 'function',
                    function: {
                      name: 'run_audit',
                      arguments: JSON.stringify({ deviceId: 'device-A-001', severity: 'high' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: {
            prompt_tokens: totalTokens,
            cache_creation_input_tokens: cacheCreation,
            cache_read_input_tokens: cacheRead,
          },
        }),
      }
    },
  })

  const session = createAgentSession()

  for (let round = 1; round <= 10; round++) {
    const { kvCacheStats } = await session.run({
      query: `第 ${round} 轮核查：为什么 A 店最近表现差，先改什么？`,
    })
    const plannerStat = kvCacheStats.find((s) => s.stage === 'planner')
    const synthStat = kvCacheStats.find((s) => s.stage === 'synthesizer')

    roundStats.push({
      round,
      plannerCacheCreation: plannerStat.cacheCreationInputTokens,
      plannerCacheRead: plannerStat.cacheReadInputTokens,
      synthCacheCreation: synthStat.cacheCreationInputTokens,
      synthCacheRead: synthStat.cacheReadInputTokens,
    })

    console.log(
      `Round ${String(round).padStart(2, '0')} | Planner: creation=${plannerStat.cacheCreationInputTokens}, read=${plannerStat.cacheReadInputTokens} | Synthesizer: creation=${synthStat.cacheCreationInputTokens}, read=${synthStat.cacheReadInputTokens}`,
    )

    if (round >= 2) {
      const prevRound = roundStats[round - 2]
      assert(
        plannerStat.cacheReadInputTokens > prevRound.plannerCacheRead,
        `第 ${round} 轮 Planner cache_read (${plannerStat.cacheReadInputTokens}) 必须严格单调大于第 ${round - 1} 轮 (${prevRound.plannerCacheRead})`,
      )
    }
    assert(
      synthStat.cacheReadInputTokens > plannerStat.cacheReadInputTokens,
      `第 ${round} 轮内 Synthesizer 的 cache_read (${synthStat.cacheReadInputTokens}) 必须单调大于 Planner (${plannerStat.cacheReadInputTokens})`,
    )
  }

  // 恢复默认无 Mock 状态
  configureLLMClient({ apiKey: '', customFetch: null })

  // 8. 验证三层记忆系统（MemorySaver 会话指代消解 + InMemoryStore 跨会话长期记忆 + 规则 4/6 持久化压缩摘要）
  console.log('\n=== 3. 开始验证三层记忆系统（短期指代消解 + 跨会话长期记忆 + KV Cache 压缩复用） ===')

  // 8.1 会话级记忆与多轮指代消解（第 1 轮问 B 店，第 2 轮用“它”追问并创建整改任务）
  const turn1Res = await runAgent({
    query: '查看 B 店近期异常情况',
    sessionId: 'mem_session_b_store',
  })
  assert(
    turn1Res.findings.length === 1 && turn1Res.findings[0].deviceId === 'device-B-001',
    '第 1 轮应锁定 B 店 (device-B-001)',
  )

  const turn2Res = await runAgent({
    query: '那帮它创建一个整改任务', // 未提“B 店”，靠会话记忆槽位 lastDeviceId 指代消解
    sessionId: 'mem_session_b_store',
  })
  assert(
    turn2Res.findings.length === 1 && turn2Res.findings[0].deviceId === 'device-B-001',
    '第 2 轮追问“它”时必须通过短期会话记忆自动继承 B 店 (device-B-001)',
  )
  assert(
    turn2Res.toolCalls.some((c) => c.toolName === 'create_task' && c.status === 'success'),
    '第 2 轮应成功调用 create_task',
  )

  // 8.2 验证跨会话长期记忆 (InMemoryStore)
  const longTerm = await retrieveRelevantLongTermMemory({
    deviceId: 'device-B-001',
  })
  assert(
    longTerm.storeProfile && longTerm.storeProfile.deviceId === 'device-B-001',
    '官方 InMemoryStore 必须持久化保存 B 店的跨会话风险档案',
  )

  // 8.3 验证《上下文与 KV Cache 约束》规则 4 & 6：非滑动窗口的确定性摘要压缩与持久化复用
  const longMessages = session.getMessages()
  const compact1 = await compactMessagesIfNeeded(longMessages, {
    maxMessages: 10,
    compactChunkSize: 8,
  })
  const compact2 = await compactMessagesIfNeeded(longMessages, {
    maxMessages: 10,
    compactChunkSize: 8,
  })
  assert(compact1.compacted === true, '当消息数超过阈值时必须触发摘要压缩而非滑动窗口截断')
  assert(
    compact1.summaryText === compact2.summaryText && compact1.summaryHash === compact2.summaryHash,
    '规则 6：首次生成的压缩摘要必须持久化复用，再次恢复或压缩时逐字节完全相同',
  )
  console.log(`Memory Check | 指代消解继承: device-B-001 | 压缩摘要复用 Hash: ${compact1.summaryHash.slice(0, 12)}`)

  const traces = getRecentTraces()
  console.log(`\n✅ 全部 7 层架构 + 三层记忆系统 + 第三方 API + 10 轮 KV Cache 单调增长验收标准全部通过！（当前累计 Trace 数：${traces.length}）`)
}

await main()

