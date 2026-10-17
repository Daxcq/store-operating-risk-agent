/**
 * 第一层：定义层 (Definition Layer)
 *
 * 职责：
 * 1. 定义 Agent 的业务定位、能力边界与系统提示词契约；
 * 2. 定义 7 个白名单工具元数据及与成员 B 领域函数的映射关系；
 * 3. 定义官方 LangGraph 的全局状态 Schema (AgentStateAnnotation)。
 */

import { Annotation } from '@langchain/langgraph'

/**
 * Agent 身份与边界定义
 */
export const AGENT_IDENTITY = Object.freeze({
  name: 'LaisenRetailIntelligenceAgent',
  role: '受契约约束的无人零售经营决策与审计编排器 (Contract-First Domain Decision Orchestrator)',
  dataVersion: 'demo_v1',
  maxQueryLength: 2000,
  principles: [
    '规则引擎负责确定性计算与异常判定，Agent 仅负责意图解析、白名单工具编排与证据总结',
    '严禁自行编写 SQL、严禁自行心算比率、严禁修改风险等级或规则阈值',
    '严禁在 summary 或 recommendations 中编造工具返回结果之外的数值、事实或根因',
    '可比门店少于 3 家或关键字段缺失时，必须输出数据不足降级结论，不得给出确定性归因',
    '高风险经营动作必须转化为待人工确认的建议/行动卡，不得自动执行外部写操作',
  ],
})

/**
 * 白名单工具名称枚举（严格对齐 contracts/src/index.ts 的 AgentToolName）
 */
export const WHITELISTED_TOOL_NAMES = Object.freeze([
  'get_dashboard',
  'run_audit',
  'compare_regions',
  'estimate_region_roi',
  'create_task',
  'verify_task',
  'write_report',
])

/**
 * 白名单工具元数据及与成员 B 后端函数的固定映射关系
 */
export const TOOL_REGISTRY_META = Object.freeze({
  get_dashboard: {
    toolName: 'get_dashboard',
    domainFunction: 'getDashboardMetrics',
    mutatesState: false,
    description: '查询指定区域与时间窗口的经营驾驶舱核心指标摘要（销售额、利润、设备数、在线率、待处理异常数）',
  },
  run_audit: {
    toolName: 'run_audit',
    domainFunction: 'auditOperations',
    mutatesState: false,
    description: '按固定审计规则检测门店/设备经营异常，返回异常发现、严重程度、证据列表与处置建议',
  },
  compare_regions: {
    toolName: 'compare_regions',
    domainFunction: 'compareRegions',
    mutatesState: false,
    description: '横向比较多个候选区域或可比门店的评分、预计月利润、回本周期、理由与假设',
  },
  estimate_region_roi: {
    toolName: 'estimate_region_roi',
    domainFunction: 'estimateRegionROI',
    mutatesState: false,
    description: '针对单个目标区域进行投放评分与收益回本周期（ROI）测算',
  },
  create_task: {
    toolName: 'create_task',
    domainFunction: 'createTask',
    mutatesState: true,
    description: '根据已确认的行动卡创建经营核查任务（写操作，需人工确认或明确指令）',
  },
  verify_task: {
    toolName: 'verify_task',
    domainFunction: 'verifyTask',
    mutatesState: true,
    description: '根据下一周期复核指标（如 refund_rate）判定任务关闭（closed）或升级（escalated）',
  },
  write_report: {
    toolName: 'write_report',
    domainFunction: 'writeReport',
    mutatesState: true,
    description: '将已验证的结构化审计与区域对比结果持久化为可追溯报告',
  },
})

/**
 * 意图分类枚举
 */
export const INTENT_TYPES = Object.freeze({
  STORE_AUDIT: 'store_audit',             // 门店表现诊断与异常审计
  REGION_COMPARISON: 'region_comparison', // 区域投放对比与 ROI 测算
  DASHBOARD_OVERVIEW: 'dashboard_overview', // 全局经营驾驶舱概览
  COMPREHENSIVE: 'comprehensive',         // 综合经营分析（同时含审计+区域对标/大盘）
  TASK_VERIFICATION: 'task_verification', // 任务复核与闭环验证
  INSUFFICIENT_PROBE: 'insufficient_probe', // 明确的数据不足/缺失探测场景
})

/**
 * Agent 工具规划与防开放式裸答合同（约束复杂/开放问题下的规则解析与 LLM 原生 Tool Calling）
 * 核心铁律：
 * 1. 严禁 LLM 脱离工具进行开放式自由回答（disallowOpenEndedDirectAnswer = true）；
 * 2. 复杂开放问题只能被拆解为 7 个白名单工具的组合调用计划，所有结论必须来自工具返回的证据；
 * 3. 写操作工具（create_task / verify_task / write_report）必须有用户显式指令授权，严禁 LLM 擅自触发。
 */
export const AGENT_PLANNING_CONTRACT = Object.freeze({
  maxToolsPerTurn: 5,
  disallowOpenEndedDirectAnswer: true,
  topologicalOrder: Object.freeze([
    'get_dashboard',
    'run_audit',
    'compare_regions',
    'estimate_region_roi',
    'verify_task',
    'create_task',
    'write_report',
  ]),
  writeToolsRequiringExplicitIntent: Object.freeze([
    'create_task',
    'verify_task',
    'write_report',
  ]),
  validRegionIds: Object.freeze([
    'changchun',
    'chaoyang',
    'haidian',
    'xicheng',
    'dongcheng',
    'fengtai',
    'nanguan',
    'kuancheng',
    'erdao',
    'luyuan',
  ]),
  validDeviceIds: Object.freeze([
    'device-A-001',
    'device-B-001',
    'device-C-001',
    'device-D-001',
    'device-E-001',
    'S001',
    'S002',
    'S003',
    'S004',
    'S005',
    'S006',
    'S007',
    'S008',
    'S009',
    'S010',
    'S011',
    'S012',
    'S013',
    'S014',
    'S015',
    'S016',
    'S017',
    'S018',
    'S019',
    'S020',
    'S021',
  ]),
  validSeverities: Object.freeze(['high', 'medium', 'low']),
  validVerifyScenarios: Object.freeze(['improved-task', 'unresolved-task']),
})

/**
 * 系统提示词契约（供接入真实 LLM 时作为 System Message 注入）
 */
export const SYSTEM_PROMPT_CONTRACT = `你是莱森购 Retail Intelligence Agent（无人零售经营智能决策顾问）。
你的任务是针对用户的自由文本提问，基于真实业务数据与分析引擎给出高度相关、结构化、可审核落地的专业经营结论。

你必须严格遵守以下 5 条核心铁律：
1. 【脱敏与业务化表达（严禁暴露底层函数）】：
   在任何面向用户的文本、思考过程、分析步骤、建议或卡片中，绝对禁止出现内部工具或函数名称（如 get_dashboard, run_audit, compare_regions, estimate_region_roi, create_task, verify_task, write_report, audit_operations, score_regions 等），也禁止出现代码变量名（如 estimatedPaybackMonths）。所有数据获取动作必须转化为零售业务语言（如“检索全城经营大盘指标”、“调取门店近期订单与退款流水”、“拉取候选区域商圈点位与成本基准”、“测算区域投资回本周期”）。
2. 【强问题相关性（问什么、答什么）】：
   直接回应用户的具体提问焦点（如针对具体门店诊断、针对退款率/客单价/销售额波动归因、针对特定区域对比、或针对经营整改优先级），严禁输出与提问无关的泛化套话。
3. 【零数值幻觉与数据边界诚实】：
   所有指标、排名、风险等级、预期月利润与回本周期必须 100% 来源于已执行的业务数据查询结果，严禁编造任何未返回的数值或主观臆测根因。当可比样本少于 3 家或关键字段缺失（如租金数据缺失导致回本周期未知）时，必须明确声明数据限制，不得强行下达确定性结论。
4. 【Antigravity 风格思考与执行链路】：
   输出清晰的执行步骤（thinkingSteps），涵盖：意图拆解（thinking）、数据查询（query）、分析步骤（analysis），以及在发生数据受限或二次补充对标时的执行状态与重试说明（retry）。
5. 【结构化输出与人机协同决策（Human-in-the-Loop）】：
   收到工具执行结果并生成最终回复时，必须输出纯 JSON 对象，结构如下：
   {
     "summary": "针对用户提问的一句话核心结论（仅使用已验证的数据，严禁包含工具函数名）",
     "thinkingSteps": [
       {"phase": "thinking" | "query" | "analysis" | "retry", "title": "业务动作标题", "detail": "具体说明", "status": "completed" | "retried" | "degraded"}
     ],
     "structuredBlocks": {
       "questionFocus": "问题聚焦维度",
       "directAnswer": "针对用户问题的直接解答",
       "keyMetrics": [{"label": "指标名", "value": "指标值", "tone": "neutral" | "good" | "warn" | "danger", "hint": "对比说明"}]
     },
     "decisionProposal": {
       "requiresApproval": true,
       "proposalType": "region_deployment" | "store_rectification" | "task_verification" | "data_completion",
       "title": "待确认的经营方案或整改动作标题",
       "targetEntity": "作用对象（区域或门店名称）",
       "decisionBasis": ["决策依据1（引用具体指标与同行分位证据）", "决策依据2"],
       "analysis": "深度归因与方案可行性分析（说明数据支撑与风险边界）",
       "expectedImpact": "采纳该方案后的预期经营收益、回本周期或风险收敛效果",
       "recommendedAction": "具体待执行的落地动作",
       "ownerRole": "建议责任角色",
       "dueHours": 24,
       "primaryActionLabel": "确认采纳方案",
       "secondaryActionLabel": "暂缓执行"
     },
     "recommendations": ["可执行建议1", "可执行建议2"]
   }`

/**
 * 官方 LangGraph 全局状态定义 (AgentStateAnnotation)
 * 贯穿受控 Plan-and-Execute 状态图的所有节点
 */
export const AgentStateAnnotation = Annotation.Root({
  // 追踪 ID
  traceId: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => '',
  }),
  // 原始请求
  request: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => ({ query: '' }),
  }),
  // 当前执行引擎：主工作台默认 quick，检测台可显式使用 auto 或 kv-sim。
  engineMode: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => 'auto',
  }),
  // 当前所处状态机阶段
  phase: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => 'INIT',
  }),
  // 解析出的结构化意图与过滤参数
  intent: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => ({
      type: INTENT_TYPES.STORE_AUDIT,
      filters: {},
      regionIds: [],
      targetStoreId: null,
      forceInsufficient: false,
    }),
  }),
  // 规划待执行的工具队列：[{ toolName, args }]
  plannedTools: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => [],
  }),
  // 已完成的重规划轮数（限制最多 1 次补充调用，杜绝无限循环）
  replanCount: Annotation({
    reducer: (prev, next) => (typeof next === 'number' ? next : prev),
    default: () => 0,
  }),
  // 标记是否需要触发单次补充工具调用
  needsReplan: Annotation({
    reducer: (prev, next) => Boolean(next),
    default: () => false,
  }),
  // 实际执行的工具调用记录（严格对应 AgentResponse.toolCalls）
  toolCalls: Annotation({
    reducer: (prev, next) => (Array.isArray(next) ? next : prev),
    default: () => [],
  }),
  // 仪表盘指标结果（若调用了 get_dashboard）
  dashboardMetrics: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => null,
  }),
  // 审计异常发现集合（严格对应 AgentResponse.findings）
  findings: Annotation({
    reducer: (prev, next) => (Array.isArray(next) ? next : prev),
    default: () => [],
  }),
  // 审计原始摘要与四值判定结论（none | insufficient | possible | unavailable）
  auditSummary: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => '',
  }),
  auditVerdict: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => null,
  }),
  // 区域对标与 ROI 结果集合（严格对应 AgentResponse.regionComparison）
  regionComparison: Annotation({
    reducer: (prev, next) => (Array.isArray(next) ? next : prev),
    default: () => [],
  }),
  // 聚合的假设列表（严格对应 AgentResponse.assumptions）
  assumptions: Annotation({
    reducer: (prev, next) => (Array.isArray(next) ? next : prev),
    default: () => [],
  }),
  // 是否处于数据不足或工具失败的降级模式
  degraded: Annotation({
    reducer: (prev, next) => Boolean(next),
    default: () => false,
  }),
  // 降级原因说明
  degradedReason: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => '',
  }),
  // 安全护栏警告记录
  securityWarnings: Annotation({
    reducer: (prev, next) => (Array.isArray(next) ? next : prev),
    default: () => [],
  }),
  // 生成的总结与建议草稿
  draftSummary: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => '',
  }),
  draftRecommendations: Annotation({
    reducer: (prev, next) => (Array.isArray(next) ? next : prev),
    default: () => [],
  }),
  // 生成的 Antigravity 风格业务思考与执行链路步骤（严禁暴露内部工具函数名）
  draftThinkingSteps: Annotation({
    reducer: (prev, next) => (Array.isArray(next) ? next : prev),
    default: () => [],
  }),
  // 生成的结构化业务结论模块
  draftStructuredBlocks: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => null,
  }),
  // 生成的人机协同待确认决策提案（含决策依据、深度分析、预期影响）
  draftDecisionProposal: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => null,
  }),
  // 最终经过输出护栏校验的 AgentResponse
  response: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => null,
  }),
  // 符合《上下文与 KV Cache 约束》的 Append-Only 标准 API 消息轨迹（system / user / assistant / tool）
  messages: Annotation({
    reducer: (prev, next) => (Array.isArray(next) ? next : prev),
    default: () => [],
  }),
  // 第三方 LLM 调用的 KV Cache 命中统计记录
  kvCacheStats: Annotation({
    reducer: (prev, next) => (Array.isArray(next) ? next : prev),
    default: () => [],
  }),
  // 会话线程 ID（对应 LangGraph Checkpointer 的 thread_id）
  sessionId: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => null,
  }),
  // 短期会话焦点实体槽位（支持多轮对话指代消解：lastDeviceId, lastRegionIds, lastTaskId, turnCount）
  memoryContext: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => ({
      lastDeviceId: null,
      lastRegionIds: [],
      lastTaskId: null,
      lastIntentType: null,
      turnCount: 0,
    }),
  }),
  // 本轮创建的整改任务集合（用于同步写入跨会话长期记忆 InMemoryStore）
  createdTasks: Annotation({
    reducer: (prev, next) => (Array.isArray(next) ? next : prev),
    default: () => [],
  }),
})

