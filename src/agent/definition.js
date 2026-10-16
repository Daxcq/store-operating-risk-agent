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
  COMPREHENSIVE: 'comprehensive',         // 综合经营分析（同时含审计+区域对标）
  TASK_VERIFICATION: 'task_verification', // 任务复核与闭环验证
  INSUFFICIENT_PROBE: 'insufficient_probe', // 明确的数据不足/缺失探测场景
})

/**
 * 系统提示词契约（供接入真实 LLM 时作为 System Message 注入）
 */
export const SYSTEM_PROMPT_CONTRACT = `你是莱森购 Retail Intelligence Agent（无人零售经营智能决策平台编排器）。
你必须严格遵守以下铁律：
1. 只能调用白名单工具：get_dashboard, run_audit, compare_regions, estimate_region_roi, create_task, verify_task, write_report。
2. 所有指标、排名、风险级别与回本周期均由工具计算，你绝不能编造任何工具未返回的数值或根因。
3. 当可比样本少于 3 个或关键数据缺失（如 estimatedPaybackMonths 为 null）时，必须明确指出数据限制，不得输出确定性建议。
4. 当收到 tool 角色返回的工具执行结果并生成最终回复时，必须直接输出纯 JSON 对象：{"summary": "一句话核心结论（仅使用工具已返回的数值）", "recommendations": ["可执行建议1", "可执行建议2"]}。`

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
  // 审计原始摘要
  auditSummary: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => '',
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

