/**
 * 成员 C 七层 Agent 架构 + 第三方 API + 《上下文与 KV Cache 约束》10 轮缓存命中全链路验证脚本
 */

import { createHash } from 'node:crypto'
import {
  AGENT_IDENTITY,
  WHITELISTED_TOOL_NAMES,
  AGENT_PATTERN_META,
  AGENT_PLANNING_CONTRACT,
  STATIC_PREFIX_FINGERPRINT,
  verifyStaticPrefixIntegrity,
  configureLLMClient,
  getLLMConfig,
  normalizeBaseUrl,
  normalizeModelName,
  parseIntentAndPlanTools,
  enforceToolPlanContract,
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

  // 9. 验证复杂开放式问题解析 + 《Agent 工具规划合同》（enforceToolPlanContract 五大条款）
  console.log('\n=== 4. 开始验证复杂开放问题受控拆解与《Agent 工具规划合同》五大条款拦截 ===')
  assert(
    AGENT_PLANNING_CONTRACT.disallowOpenEndedDirectAnswer === true,
    '定义层必须声明 disallowOpenEndedDirectAnswer = true，严禁开放式无工具裸答',
  )

  const complexOpenQuery = '全面盘点目前整体生意状况，排查高风险门店，并看看下一步往朝阳区还是南关区扩张更划算？'
  const complexPlan = parseIntentAndPlanTools(complexOpenQuery)
  const complexToolNames = complexPlan.plannedTools.map((t) => t.toolName)
  assert(
    complexPlan.intent.type === 'comprehensive' &&
      complexPlan.intent.contractFlags.isComplexOpenQuery === true,
    '跨维度开放式提问必须识别为 comprehensive 且标记 isComplexOpenQuery',
  )
  assert(
    complexToolNames.includes('get_dashboard') &&
      complexToolNames.includes('run_audit') &&
      complexToolNames.includes('compare_regions') &&
      complexToolNames.includes('estimate_region_roi'),
    '复杂开放问题必须自动拆解并组合 get_dashboard + run_audit + compare_regions + estimate_region_roi 四类证据工具',
  )

  // 9.1 检验合同条款 1~4：拦截非白名单工具、拦截未授权写操作、中文参数名归一化、拓扑排序
  const contractTest1 = enforceToolPlanContract({
    candidateTools: [
      { id: 'c1', toolName: 'execute_raw_sql', args: { sql: 'SELECT * FROM stores' } }, // 非白名单工具
      { id: 'c2', toolName: 'create_task', args: { action: '擅自建单' } }, // 用户未授权写操作
      { id: 'c3', toolName: 'estimate_region_roi', args: { regionId: '朝阳区' } }, // 中文区域名需归一为 chaoyang
      { id: 'c4', toolName: 'run_audit', args: { deviceId: 'A店', severity: 'invalid_level' } }, // 中文门店名需归一为 device-A-001，非法 severity 需修正
    ],
    deterministicPlan: complexPlan,
    messageIndex: 2,
  })
  assert(
    !contractTest1.plannedTools.some((t) => t.toolName === 'execute_raw_sql'),
    '合同条款 1：必须拦截非白名单工具 execute_raw_sql',
  )
  assert(
    !contractTest1.plannedTools.some((t) => t.toolName === 'create_task'),
    '合同条款 2：用户未明确要求建单时，必须拦截 LLM 擅自规划的写操作 create_task',
  )
  const sanitizedAudit = contractTest1.plannedTools.find((t) => t.toolName === 'run_audit')
  const sanitizedRoi = contractTest1.plannedTools.find((t) => t.toolName === 'estimate_region_roi')
  assert(
    sanitizedAudit.args.deviceId === 'device-A-001' && sanitizedAudit.args.severity === 'high',
    '合同条款 3：必须将中文“A店”归一为 device-A-001 并剔除非法枚举值',
  )
  assert(
    sanitizedRoi.args.regionId === 'chaoyang',
    '合同条款 3：必须将中文“朝阳区”归一为契约 ID chaoyang',
  )

  // 9.2 检验合同条款 5：禁止 LLM 开放式无工具裸答（candidateTools 为空时强制挂载白名单证据工具）
  const contractTest2 = enforceToolPlanContract({
    candidateTools: [],
    deterministicPlan: parseIntentAndPlanTools('目前公司整体生意怎么看，给我个下一步建议'),
    messageIndex: 2,
  })
  assert(
    contractTest2.plannedTools.length >= 3 &&
      contractTest2.contractViolations.some((v) => v.includes('开放式无工具裸答')),
    '合同条款 5：当 LLM 返回 0 个工具企图开放式裸答时，必须强制拦截并挂载白名单证据采集工具',
  )
  console.log(
    `Contract Check | 复杂问题组合工具: [${contractTest1.plannedTools.map((t) => t.toolName).join(', ')}] | 拦截违规项: ${contractTest1.contractViolations.length + contractTest2.contractViolations.length} 项`,
  )

  // 10. 验证成员 B 确定性数据层（createDataLayer）与 4 套验收样例（S006/S005/S001/S004）全链路联调
  console.log('\n=== 5. 开始验证成员 B 确定性数据层 (CSV + 规则引擎 + 区域评分) 与 Agent 全链路联调 ===')
  const { getRealDataLayer } = await import('../src/agent/index.js')
  const { FIXTURES } = await import('../src/fixtures/index.ts')
  const dl = getRealDataLayer()
  assert(Boolean(dl), '成员 B 真实数据层实例 getRealDataLayer() 必须成功加载 CSV 并完成初始化')

  // 10.1 逐一核对成员 B 4 套确定性验收样例（normal / insufficient / possible / unavailable）
  for (const fx of FIXTURES) {
    const storeId = fx.subject.store_id
    const auditOut = await dl.runAudit({
      store_id: storeId,
      window: fx.window,
    })
    assert(auditOut.data !== null, `Fixture [${fx.id}] (${storeId}) 必须返回有效 RuleEvaluation`)
    assert(
      auditOut.data.verdict === fx.expected.verdict,
      `Fixture [${fx.id}] (${storeId}) verdict 应为 ${fx.expected.verdict}，实际为 ${auditOut.data.verdict}`,
    )
    assert(
      auditOut.data.risk_level === fx.expected.risk_level,
      `Fixture [${fx.id}] (${storeId}) risk_level 应为 ${fx.expected.risk_level}，实际为 ${auditOut.data.risk_level}`,
    )
    const actualHits = auditOut.data.hit_ids
    assert(
      JSON.stringify(actualHits) === JSON.stringify(fx.expected.hit_ids),
      `Fixture [${fx.id}] (${storeId}) 命中规则应为 ${JSON.stringify(fx.expected.hit_ids)}，实际为 ${JSON.stringify(actualHits)}`,
    )
    const peerOut = await dl.comparePeers({
      store_id: storeId,
      window: fx.window,
    })
    assert(peerOut.data !== null, `Fixture [${fx.id}] (${storeId}) 必须返回有效 PeerComparison`)
    for (const expectedMp of fx.expected.metric_peers) {
      const actualMp = peerOut.data.metrics.find((m) => m.metric_code === expectedMp.metric)
      assert(
        actualMp &&
          actualMp.peer_count === expectedMp.usable &&
          actualMp.peer_sufficient === expectedMp.sufficient &&
          JSON.stringify(actualMp.dropped_for_this_metric) === JSON.stringify(expectedMp.dropped),
        `Fixture [${fx.id}] (${storeId}) 指标 ${expectedMp.metric} 逐项可比门店数/剔除门店必须与 expected.metric_peers 一致`,
      )
    }
  }

  // 10.2 验证 Agent 对成员 B 4 套典型门店的端到端诊断响应
  // (a) S006 (南关活力城店) -> 正常无异常 (verdict: none)
  const s006Res = await runAgent({ query: '查看 S006 门店近期经营情况' })
  assert(s006Res.findings.length === 0, 'S006 为正常门店，findings 必须为空数组')

  // (b) S005 (南关重庆路店) -> 单指标波动证据不足 (verdict: insufficient)
  const s005Res = await runAgent({ query: '审计 S005 门店近期异常' })
  assert(
    s005Res.findings.length === 1 && s005Res.findings[0].severity === 'medium',
    'S005 仅单条退款率规则命中，应映射为 1 条 medium 风险发现且不升级为高优异常',
  )

  // (c) S001 (朝阳红旗街店) -> 多指标共振疑似异常 (verdict: possible)
  const s001Res = await runAgent({ query: '为什么 S001 最近表现差，先改什么？' })
  assert(
    s001Res.findings.length === 3 &&
      s001Res.findings.filter((f) => f.severity === 'high').length === 2 &&
      s001Res.findings.filter((f) => f.severity === 'medium').length === 1,
    'S001 命中 3 条规则（销售额 high / 退款率 high / 客单价 medium），应映射为 3 条发现并包含同行分位证据',
  )
  assert(
    s001Res.findings[0].evidence.some((e) => e.includes('同行中位数')),
    'S001 审计证据链必须包含成员 B 基准对比服务生成的同行中位数与排名说明',
  )

  // (d) S004 (朝阳欧亚商都店) -> 关键指标缺失不可判断 (verdict: unavailable)
  const s004Res = await runAgent({ query: '核查 S004 门店经营异常' })
  assert(s004Res.findings.length === 0, 'S004 数据缺失不可判断时 findings 必须为空')
  assert(
    s004Res.recommendations.length === 0,
    'S004 数据缺失不可判断时不得给出建议动作（对齐成员 B 验收铁律 #4）',
  )

  // 10.3 验证长春市真实区域对比与 ROI 测算（compare_regions + estimate_region_roi）
  const ccRegionsRes = await runAgent({
    query: '比较朝阳区和二道区的投放收益，并说明主要风险',
  })
  assert(
    ccRegionsRes.regionComparison.length === 2 &&
      ccRegionsRes.regionComparison.some((r) => r.regionId === 'erdao') &&
      ccRegionsRes.regionComparison.some((r) => r.regionId === 'chaoyang'),
    '长春区域对比应返回成员 B 数据层计算的 erdao 与 chaoyang 评分及回本周期',
  )
  console.log(
    `DataLayer Check | S006=none, S005=insufficient(1), S001=possible(3), S004=unavailable(0) | 二道区评分=${ccRegionsRes.regionComparison.find((r) => r.regionId === 'erdao')?.score}`,
  )

  // 11. 验证 Agent 检测台 (Inspection Workbench) 诊断接口
  const inspectMetaRes = await handleApiRequest({
    method: 'GET',
    url: '/api/v1/agent/inspect?sessionId=session_wb_test',
  })
  assert(
    inspectMetaRes.status === 200 &&
      inspectMetaRes.body.kvCache.integrityPassed === true &&
      inspectMetaRes.body.whitelistedTools.length === 7,
    'GET /api/v1/agent/inspect 应返回 7 个白名单工具元信息与 KV Cache 静态前缀完整性校验状态',
  )

  const inspectRunRes = await handleApiRequest({
    method: 'POST',
    url: '/api/v1/agent/inspect/run',
    body: JSON.stringify({
      query: '为什么 S001 最近表现差，先改什么？',
      sessionId: 'session_wb_test',
      engineMode: 'kv-sim',
    }),
  })
  assert(
    inspectRunRes.status === 200 &&
      inspectRunRes.body.response.findings.length === 3 &&
      Array.isArray(inspectRunRes.body.trace?.events) &&
      inspectRunRes.body.kvCacheStats.length >= 1,
    'POST /api/v1/agent/inspect/run 应返回完整契约响应、LangGraph 节点级 Trace 与 KV Cache 统计',
  )

  const inspectContractRes = await handleApiRequest({
    method: 'POST',
    url: '/api/v1/agent/inspect/contract-test',
  })
  assert(
    inspectContractRes.status === 200 &&
      inspectContractRes.body.results.length === 3 &&
      inspectContractRes.body.results.every((r) => r.passed),
    'POST /api/v1/agent/inspect/contract-test 五大规划合同对抗压测必须全部通过',
  )

  const traces = getRecentTraces()
  console.log(`\n✅ 全部 7 层架构 + 成员 B 确定性数据层 + 三层记忆系统 + 第三方 API + Agent 规划合同 + Agent 检测台 + 10 轮 KV Cache 单调增长验收标准全部通过！（当前累计 Trace 数：${traces.length}）`)
}

await main()


