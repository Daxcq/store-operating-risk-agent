/**
 * 任务B 数据层对外契约
 *
 * 边界约定：
 *   - 本文件由 B 拥有。A 的前端、C 的 Agent 工具、D 的测试都只依赖这里导出的类型和函数签名。
 *   - 要改这里的字段，先在这里改，再通知 A/C/D。不要各自复制一份类型。
 *   - 类型不依赖任何运行时库，纯 TS，方便 Node 与浏览器共用。
 *
 * 与 docs/API_CONTRACT.md 的关系（2026-10-17 契约升级后新增）：
 *   共享类型权威位置是 contracts/src/index.ts，那份文件定义 A/C/D 共用的顶层形状
 *   （AuditFinding / AuditResult / RegionResult / AgentResponse ...）。
 *   本文件是它在「数据层」这一侧的展开：更细的指标、证据、规则、评分类型。
 *   两边字段名必须逐字一致，不允许出现 snake_case 与 camelCase 的同一个概念。
 *   映射关系见文件末尾的「与 API_CONTRACT.md 的字段对照」。
 *
 * 三条贯穿全项目的硬规则，落实在类型里：
 *   1. 每个数字都必须能回到 evidence_id 和 trace_id  -> MetricResult.evidence_ids 非可选
 *   2. 数据不够时必须返回明确状态，不得输出确定性结论 -> MetricStatus / RuleVerdict
 *   3. 指标/规则/评分由纯代码完成，LLM 不参与计算     -> 本文件不含任何 LLM 相关类型
 */

// ============================================================
// 1. 基础枚举
// ============================================================

/** 指标编码。与 configs/metrics.yaml 的 code 一一对应，改动必须同步。 */
export type MetricCode =
  | "sales_amount"
  | "order_count"
  | "refund_amount"
  | "refund_rate"
  | "refund_order_rate"
  | "aov"
  | "online_rate"
  | "inventory_diff_amount";

/** 变化率编码。与 configs/metrics.yaml 的 changes 一一对应。 */
export type ChangeCode =
  | "sales_change_pct"
  | "order_change_pct"
  | "refund_rate_change_pct"
  | "aov_change_pct"
  | "online_rate_change_pct";

/** 单位。percent_point 只用于比率型指标之间的差，避免把百分点说成百分比。 */
export type MetricUnit = "currency" | "count" | "percent" | "percent_point";

/**
 * 指标状态。这是数据层最重要的一组值。
 * insufficient 与 unavailable 的区别是全项目的关键：
 *   insufficient -> 能算出来，但按规则不足以支撑结论（比如只命中 1 条规则、可比门店只有 1 家）
 *   unavailable  -> 算不出来（窗口天数不够、关键字段整片空缺）
 * 前端和 Agent 必须区别对待，不得把 insufficient 显示成「正常」。
 */
export type MetricStatus = "ok" | "insufficient" | "unavailable";

/** 审计时间窗口 */
export interface Window {
  from: string; // ISO date, inclusive
  to: string;   // ISO date, inclusive
}

// ============================================================
// 2. 证据与追踪
// ============================================================

/** 证据类型 */
export type EvidenceKind =
  | "metric"      // 一个指标结果
  | "rule"        // 一条规则命中
  | "peer"        // 一组可比门店
  | "score"       // 一个评分分项
  | "raw_row";    // 原始数据行

/**
 * 证据。报告里每一个数字都要挂到一个 Evidence 上。
 * 没有 evidence_id 的数字禁止出现在报告里（PROJECT.md 4.2 范围原则）。
 */
export interface Evidence {
  evidence_id: string;
  kind: EvidenceKind;
  /** 人类可读的一句话，Agent 可以直接引用，不用自己编 */
  summary: string;
  /** 计算这个证据时实际用到的输入快照，用于复盘 */
  inputs: Record<string, unknown>;
  /** 公式的字符串形式，便于报告里展示"怎么算的" */
  formula?: string;
  metric_code?: MetricCode;
  rule_id?: string;
  store_id?: string;
  window?: Window;
  data_version: string;
  trace_id: string;
  created_at: string;
}

/** 追踪事件。trace 覆盖全链路，支持「问题 -> 工具调用 -> 数据版本 -> 任务」回放。 */
export type TraceEventType =
  | "agent_run_start"
  | "intent_parsed"
  | "tool_call"
  | "tool_result"
  | "rule_evaluated"
  | "degraded"
  | "task_created"
  | "task_verified"
  | "report_written";

export interface TraceEvent {
  trace_id: string;
  seq: number;
  type: TraceEventType;
  at: string;
  /** 工具名，如 run_audit / compare_peers */
  tool?: string;
  input?: unknown;
  output?: unknown;
  data_version: string;
  model?: string;      // 模型版本也入 trace，便于换模型后对比
  note?: string;
}

// ============================================================
// 3. 指标结果
// ============================================================

export interface MetricResult {
  metric_code: MetricCode | ChangeCode;
  /** null 表示算不出来。永远不要用 0 代表缺失。 */
  value: number | null;
  unit: MetricUnit;
  status: MetricStatus;
  scope: {
    store_id?: string;
    region?: string;
    grade?: string;
  };
  window: Window;
  /** 变化率的对比基准窗口，比率型指标用它标明对比对象 */
  baseline_window?: Window;
  /** 计算实际用到的有效天数，用于解释为什么是 unavailable */
  valid_days: number;
  /** 缺失/空值比例，0~1 */
  null_ratio: number;
  /** 基准取不到时的降级标记，报告里必须体现 */
  baseline_fallback?: boolean;
  evidence_ids: string[];
  data_version: string;
  trace_id: string;
}

// ============================================================
// 4. 规则与判定
// ============================================================

export type RuleConditionId = "sales_drop" | "refund_high" | "aov_drop";
export type CompareOp = "<=" | ">=" | "<" | ">";

export interface RuleConditionDef {
  id: RuleConditionId;
  display_name: string;
  metric: MetricCode | ChangeCode;
  op: CompareOp;
  threshold: number;
  unit: MetricUnit;
  severity: "high" | "medium" | "low";
  description: string;
}

export interface RuleConditionResult {
  id: RuleConditionId;
  display_name: string;
  hit: boolean;
  /** 命中时带上实际值和阈值，报告里可以直接说"7.4% > 5%" */
  actual: number | null;
  threshold: number;
  op: CompareOp;
  unit: MetricUnit;
  severity: "high" | "medium" | "low";
  /** 因为数据问题没能判断的规则，不是"没命中" */
  skipped?: boolean;
  skip_reason?: string;
  evidence_id?: string;
}

/**
 * 规则判定结论。这四值直接决定 UI 的颜色和 Agent 的措辞。
 *   none         正常
 *   insufficient 证据不足（能算，但不够下结论）
 *   possible     疑似异常（命中 >= 2 条且可比门店充足）
 *   unavailable  无法判断（数据缺失）
 */
export type RuleVerdict = "none" | "insufficient" | "possible" | "unavailable";

/**
 * 门店/区域整体风险状态。这是 shared contract（contracts/src/index.ts）里的类型，
 * 顶层 UI 与 AgentResponse 用它，不用 RuleVerdict。
 *
 * 注意它只有四个值，没有 insufficient —— 所以映射必须显式写明，不能默认落 normal：
 *   RuleVerdict.none         -> RiskStatus.normal
 *   RuleVerdict.insufficient -> RiskStatus.watch     （证据不足，必须可被追问）
 *   RuleVerdict.possible     -> RiskStatus.possible
 *   RuleVerdict.unavailable  -> RiskStatus.unavailable
 *
 * 为什么 insufficient 映到 watch 而不是 normal：insufficient 的含义是「能算但不够下结论」。
 * 把它画成正常的绿色，就是本项目最要避免的假阴性。watch 至少会让它出现在待观察列表里。
 */
export type RiskStatus = "normal" | "watch" | "possible" | "unavailable";

/** 单个发现的严重程度。描述「一条审计发现有多严重」；风险状态描述「实体整体如何」。 */
export type AuditSeverity = "high" | "medium" | "low";

export interface RuleEvaluation {
  definition: string;          // store_anomaly_v1
  decision: string;            // at_least_2
  subject: { store_id: string; region: string; grade: string };
  window: Window;
  verdict: RuleVerdict;
  risk_level: "normal" | "watch" | "high" | "unknown";
  conditions: RuleConditionResult[];
  hit_count: number;
  /** 命中项的名称列表，供前端直接渲染标签 */
  hit_ids: RuleConditionId[];
  /** 为什么是这个 verdict，一句话，给 Agent 引用 */
  verdict_reason: string;
  /** 数据层给出的建议动作模板，Agent 只能引用和改写，不能发明新的动作类型 */
  suggested_action_template?: string;
  recommend_escalate: boolean;
  evidence_ids: string[];
  data_version: string;
  trace_id: string;
}

// ============================================================
// 5. 可比门店
// ============================================================

export interface PeerComparison {
  subject_store_id: string;
  window: Window;
  /** 实际参与对比的门店，已按准入条件过滤 */
  peer_store_ids: string[];
  /** 因为不满足准入条件被剔除的，必须说明原因 */
  excluded: { store_id: string; reason: string }[];
  /**
   * 整体可比门店是否充足。
   * 取值口径是「用于判定区域性波动的那个指标（销售变化率）」的可比门店数，
   * 因为区域性问题本质上是一个销售现象。见 metric_peer_sufficient。
   */
  peer_sufficient: boolean;
  min_peers_required: number;
  /**
   * 逐指标的可比门店数是否达标。
   * 必须逐指标判断：一家门店可能销售数据完整、退款字段却断报了
   * （本 Demo 的 S004 就是这种），它对销售变化率依然是合格的可比对象，
   * 只是不能参与退款率对比。用全局数据质量一刀切，会把这类门店整体剔除，
   * 导致可比门店数虚低、进而把本来能下的结论降级成 insufficient。
   */
  metric_peer_sufficient: Record<string, boolean>;
  /** 本店 / 中位数 / 排名，三者一起给出，避免只报排名造成误导 */
  metrics: {
    metric_code: MetricCode | ChangeCode;
    unit: MetricUnit;
    subject_value: number | null;
    peer_median: number | null;
    peer_min: number | null;
    peer_max: number | null;
    /** 排名，1 = 最好（销售类为最高，退款类为最低，方向由 metric 决定） */
    rank: number | null;
    /** 该指标下真正可用的可比门店数（已剔除本指标算不出来的门店） */
    peer_count: number;
    /** 该指标可比门店是否达到 min_peers_required；false 时 rank 必为 null */
    peer_sufficient: boolean;
    /** 因本指标数值缺失而被排除的可比门店 */
    dropped_for_this_metric: string[];
  }[];
  /** 不可比时前端与 Agent 都不得展示排名 */
  ready_for_ranking: boolean;
  evidence_ids: string[];
  data_version: string;
  trace_id: string;
}

// ============================================================
// 6. 区域评分
// ============================================================

export interface ScoreComponent {
  code: "demand_score" | "competition_score" | "margin_score" | "cost_score";
  display_name: string;
  /** null 表示该分项数据缺失，总分需要按剩余权重重算 */
  value: number | null;
  weight: number;
  contribution: number | null;
  inputs_snapshot: Record<string, number | null>;
  evidence_id: string;
}

export interface LocationScore {
  region: string;
  grade: string;
  score: number | null;
  confidence: "full" | "degraded" | "low";
  components: ScoreComponent[];
  rank: number | null;
  store_count: number;
  /**
   * 预估月利润（人民币/月）。可为负数 —— 亏损区域必须能如实反映为负数，
   * 不允许截断成 0，也不允许用 0 表示"算不出来"。
   */
  estimated_monthly_profit: number | null;
  /**
   * 预估回本周期（月）。
   * 无法合理估算时返回 null（例如月利润 <= 0 时回本周期在数学上无意义）。
   * 契约明确禁止用 0、空字符串或负数代替 null。
   */
  estimated_payback_months: number | null;
  /** 该评分/估算的主要理由，供 UI 与 Agent 直接引用 */
  reasons: string[];
  /** 本次估算所依据的假设，必须显式暴露，不允许隐式化 */
  assumptions: string[];
  /** 三选一，对应 configs/scoring.yaml 的推荐阈值 */
  recommendation: "推荐" | "继续调研" | "不建议" | "数据不足";
  weights_version: string;
  disclaimer: string;
  evidence_ids: string[];
  data_version: string;
  trace_id: string;
}

// ============================================================
// 7. 数据层对外函数签名（A / C / D 都按这个调用）
// ============================================================

export interface AuditInput {
  store_id?: string;
  region?: string;
  window?: Window;
  /** 不传则用 configs/metrics.yaml 的 current_default */
  data_version?: string;
}

export interface ToolCallResult<T = unknown> {
  tool_call_id: string;
  status: "succeeded" | "degraded" | "failed";
  data: T | null;
  evidence_ids: string[];
  data_version: string;
  trace_id: string;
  warnings: string[];
}

/**
 * 统一的区域结果形状，与 contracts/src/index.ts 的 RegionResult 一一对应。
 * 字段名必须逐字一致，否则 A 的前端只能再包一层转换，两边就会漂移。
 */
export interface RegionResult {
  regionId: string;
  name: string;
  /** 0..100 */
  score: number;
  /** 人民币/月，可为负数 */
  estimatedMonthlyProfit: number;
  /** 无法合理估算时为 null */
  estimatedPaybackMonths: number | null;
  reasons: string[];
  assumptions: string[];
}

/** DashboardMetrics：注意 onlineRate 是 0..1 的比例，不是 0..100 的百分数。 */
export interface DashboardMetrics {
  salesAmount: number;
  estimatedProfit: number;
  deviceCount: number;
  /** 0..1 */
  onlineRate: number;
  openFindingCount: number;
}

export interface DashboardFilters {
  regionId?: string;
  from?: string;
  to?: string;
}

export interface AuditFilters extends DashboardFilters {
  deviceId?: string;
  severity?: AuditSeverity;
}

/**
 * C 的 Agent 只会通过这七个白名单函数碰数据，不下 SQL、不读全量原始数据。
 * 返回值统一包一层 ToolCallResult，让 Agent 拿到 warnings 和降级信息。
 *
 * 方法名与 Agent 工具名的对应（工具名是契约里写死的，不能改）：
 *   getDashboardMetrics -> get_dashboard
 *   auditOperations     -> run_audit
 *   comparePeers       -> compare_peers（逐门店）
 *   compareRegions     -> compare_regions
 *   estimateRegionROI  -> estimate_region_roi
 *   scoreLocations     -> 供 create_task / verify_task / write_report 的落地页使用
 * create_task / verify_task / write_report 不在这里，它们会改状态，归 C 管，
 * 且必须经用户确认才允许执行。
 */
export interface DataLayerApi {
  /** 看板概览。返回指标骨架，不返回任何结论。 */
  getDashboard(input: AuditInput): Promise<ToolCallResult<MetricResult[]>>;
  /** DashboardMetrics 形状的概览，供首页驾驶舱直接用。 */
  getDashboardMetrics(filters?: DashboardFilters): Promise<ToolCallResult<DashboardMetrics>>;
  /** 执行规则审计，产出 verdict 与证据。 */
  runAudit(input: AuditInput): Promise<ToolCallResult<RuleEvaluation>>;
  /** 可比门店对比（逐门店，按指标逐项判定可比性）。 */
  comparePeers(input: AuditInput & { metric_codes?: (MetricCode | ChangeCode)[] }):
    Promise<ToolCallResult<PeerComparison>>;
  /** 区域对比，返回 RegionResult[]。 */
  compareRegions(regionIds?: string[]): Promise<ToolCallResult<RegionResult[]>>;
  /** 单区域 ROI 估算，返回 RegionResult。 */
  estimateRegionROI(regionId: string): Promise<ToolCallResult<RegionResult>>;
  /** 区域评分与排名（多区域，含分项与置信度）。 */
  scoreLocations(input: { grade?: string; weights_version?: string }):
    Promise<ToolCallResult<LocationScore[]>>;
}

// ============================================================
// 8. 与 API_CONTRACT.md 的字段对照
// ============================================================

/**
 * 这份表是为了防止两边字段名漂移。左边是本文件（数据层内部，snake_case），
 * 右边是共享契约（跨端，camelCase）。转换只允许发生在 API 边界层，
 * 不允许在数据层内部混用两套写法。
 *
 *   本文件                          contracts/src/index.ts
 *   ------------------------------  ------------------------------
 *   MetricResult.metric_code        （内部）
 *   MetricResult.value              DashboardMetrics.salesAmount 等
 *   RuleVerdict                     RiskStatus           （经 toRiskStatus 映射）
 *   RuleConditionResult.severity    AuditSeverity
 *   LocationScore.region            RegionResult.regionId
 *   LocationScore.estimated_monthly_profit  RegionResult.estimatedMonthlyProfit
 *   LocationScore.estimated_payback_months  RegionResult.estimatedPaybackMonths
 *   LocationScore.reasons           RegionResult.reasons
 *   LocationScore.assumptions       RegionResult.assumptions
 *   online_rate（0..100）            onlineRate（0..1，除以 100）
 */

/**
 * RuleVerdict -> RiskStatus。
 *
 * 这个函数存在的唯一理由：共享契约的 RiskStatus 没有 insufficient 这一档。
 * 如果不显式映射，实现者很容易顺手写成 `verdict === "possible" ? "possible" : "normal"`，
 * 那样「证据不足」和「数据缺失」都会被画成正常的绿色 —— 正是本项目要避免的假阴性。
 * 所以这里把每一档都写死，不留默认分支。
 */
export function toRiskStatus(verdict: RuleVerdict): RiskStatus {
  switch (verdict) {
    case "none":
      return "normal";
    case "insufficient":
      return "watch";
    case "possible":
      return "possible";
    case "unavailable":
      return "unavailable";
  }
}

/**
 * 百分比 -> 0..1 比例。仅用于契约边界（online_rate 等）。
 * null 保持 null，绝不用 0 代替缺失。
 */
export function toRatio(percentValue: number | null): number | null {
  return percentValue === null ? null : Number((percentValue / 100).toFixed(4));
}
