/**
 * 异常规则引擎 (任务B)
 *
 * 只做一件事：读指标结果 -> 逐条比对阈值 -> 输出 RuleVerdict。
 * 不做归因，不生成建议动作的最终文案，不调用大模型。
 *
 * 判定顺序是刻意的，不能调换（configs/thresholds.yaml 的 verdict_order）：
 *   1. unavailable   数据能不能用
 *   2. insufficient  数据够算但不够下结论
 *   3. possible      命中够多且可比门店充足
 *   4. none          确认无异常
 *
 * 为什么顺序不能反：如果把「数据缺失」排到最后，它会被当成「没有命中」而落到 none，
 * 前端就会显示绿色「正常」。这是本项目最危险的假阴性，必须挡在最前面。
 */

import type {
  RuleConditionDef,
  RuleConditionResult,
  RuleEvaluation,
  RuleVerdict,
  MetricResult,
  MetricCode,
  ChangeCode,
  Evidence,
  Window,
  RuleConditionId,
} from "../../contracts/b/index.ts";
import { pick } from "./metric_service.ts";
import type { DataQuality } from "./data_loader.ts";

/** 规则定义。与 configs/thresholds.yaml 的 store_rule.conditions 一一对应。 */
export const STORE_RULE_CONDITIONS: RuleConditionDef[] = [
  {
    id: "sales_drop",
    display_name: "销售下滑",
    metric: "sales_change_pct",
    op: "<=",
    threshold: -20,
    unit: "percent",
    severity: "high",
    description: "当前 7 日销售金额较前 7 日下降 20% 及以上。",
  },
  {
    id: "refund_high",
    display_name: "退款率偏高",
    metric: "refund_rate",
    op: ">=",
    threshold: 5,
    unit: "percent",
    severity: "high",
    description: "当前 7 日退款率 5% 及以上。",
  },
  {
    id: "aov_drop",
    display_name: "客单价下滑",
    metric: "aov_change_pct",
    op: "<=",
    threshold: -10,
    unit: "percent",
    severity: "medium",
    description: "当前 7 日客单价较前 7 日下降 10% 及以上。",
  },
];

export const STORE_RULE_DEFINITION = "store_anomaly_v1";
export const STORE_RULE_DECISION = "at_least_2";
const MIN_PEERS = 3;

function compare(actual: number, op: RuleConditionDef["op"], threshold: number): boolean {
  switch (op) {
    case "<=":
      return actual <= threshold;
    case ">=":
      return actual >= threshold;
    case "<":
      return actual < threshold;
    case ">":
      return actual > threshold;
  }
}

export interface EvaluateInput {
  storeId: string;
  region: string;
  grade: string;
  window: Window;
  /** 本店当前窗口指标（含变化率） */
  results: MetricResult[];
  /** 本店当前窗口数据质量 */
  quality: DataQuality;
  /**
   * 门禁指标（销售变化率）的可比门店是否充足。
   * 由 benchmark_service 按 PEER_GATE_METRIC 判定后传入。
   */
  peerSufficient: boolean;
  /** 门禁指标口径下的可比门店数 */
  peerCount: number;
  /**
   * 逐指标的可比门店是否达标（benchmark_service 的 metric_peer_sufficient）。
   *
   * 为什么规则引擎需要知道这个：命中「退款率偏高」却说不出"区域里别的店退款率多少"，
   * 是站不住的 —— 退款率天然受季节和品类结构影响。所以只要有一条**命中**的规则
   * 在自己这一项上没有足够可比门店，就不能给 possible，只能给 insufficient。
   * 反过来，没命中的规则不需要可比门店，不该拖累结论。
   */
  metricPeerSufficient?: Record<string, boolean>;
  dataVersion: string;
  traceId: string;
}

/** 规则条件 -> 可比性用哪个指标口径判定。 */
const CONDITION_PEER_METRIC: Record<RuleConditionId, string> = {
  // 销售下滑与客单价下滑同源，都看销售变化率的可比门店
  sales_drop: "sales_change_pct",
  aov_drop: "sales_change_pct",
  refund_high: "refund_rate",
};

/**
 * 执行门店级规则判定。
 */
export function evaluateStoreRule(input: EvaluateInput): {
  evaluation: RuleEvaluation;
  evidence: Evidence[];
} {
  const {
    storeId,
    region,
    grade,
    window,
    results,
    quality,
    peerSufficient,
    peerCount,
    metricPeerSufficient,
    dataVersion,
    traceId,
  } = input;

  const evidence: Evidence[] = [];
  const conditions: RuleConditionResult[] = [];

  for (const def of STORE_RULE_CONDITIONS) {
    const metric = pick(results, def.metric as MetricCode | ChangeCode);
    const actual = metric?.value ?? null;

    // 指标算不出来 -> 这条规则是「没判断」，不是「没命中」
    if (actual === null || metric?.status === "unavailable") {
      conditions.push({
        id: def.id,
        display_name: def.display_name,
        hit: false,
        actual: null,
        threshold: def.threshold,
        op: def.op,
        unit: def.unit,
        severity: def.severity,
        skipped: true,
        skip_reason:
          metric?.status === "unavailable"
            ? `指标 ${def.metric} 因数据缺失无法计算`
            : `指标 ${def.metric} 缺失`,
      });
      continue;
    }

    const hit = compare(actual, def.op, def.threshold);
    const evidenceId = `ev_rule_${def.id}_${storeId}_${window.from.replace(/-/g, "")}`;

    evidence.push({
      evidence_id: evidenceId,
      kind: "rule",
      summary: hit
        ? `${storeId} 命中「${def.display_name}」：${def.metric} = ${actual}，${def.op} ${def.threshold}`
        : `${storeId} 未命中「${def.display_name}」：${def.metric} = ${actual}，未达到 ${def.op} ${def.threshold}`,
      inputs: {
        metric: def.metric,
        actual,
        op: def.op,
        threshold: def.threshold,
        window,
      },
      rule_id: def.id,
      store_id: storeId,
      window,
      data_version: dataVersion,
      trace_id: traceId,
      created_at: new Date().toISOString(),
    });

    conditions.push({
      id: def.id,
      display_name: def.display_name,
      hit,
      actual,
      threshold: def.threshold,
      op: def.op,
      unit: def.unit,
      severity: def.severity,
      evidence_id: evidenceId,
    });
  }

  const hitIds = conditions.filter((c) => c.hit).map((c) => c.id) as RuleConditionId[];
  const hitCount = hitIds.length;
  const skippedCount = conditions.filter((c) => c.skipped).length;

  // 有没有哪条**命中**的规则，在自己这一项上没有足够可比门店。
  // 只看命中项：没命中的规则本来就不需要可比对象来支撑，不该拖累结论。
  const hitsWithoutPeers =
    metricPeerSufficient === undefined
      ? []
      : hitIds.filter((id) => metricPeerSufficient[CONDITION_PEER_METRIC[id]] === false);

  //
  // 按 verdict_order 判定，顺序即优先级
  //
  let verdict: RuleVerdict;
  let riskLevel: RuleEvaluation["risk_level"];
  let verdictReason: string;

  if (quality.status === "unavailable") {
    // 第一优先级：数据不能用。哪怕命中了很多条，也只能说无法判断。
    verdict = "unavailable";
    riskLevel = "unknown";
    const issueText = quality.issues
      .map((i) => `${i.field} 自 ${i.from ?? "窗口起始"} 起缺失（${i.null_days} 天）`)
      .join("；");
    verdictReason =
      `当前窗口有效天数 ${quality.valid_days}/${quality.calendar_days}，` +
      `关键字段空值率 ${(quality.null_ratio * 100).toFixed(1)}%，` +
      (issueText ? `问题字段：${issueText}。` : "") +
      `数据不足以支撑任何结论，本店本期判定为无法判断。`;
  } else if (skippedCount > 0 && hitCount === 0) {
    // 有规则没能判断，且没有命中的 -> 也不能说正常
    verdict = "insufficient";
    riskLevel = "watch";
    verdictReason = `有 ${skippedCount} 条规则因数据缺失未能判断，无法确认是否存在异常。`;
  } else if (hitCount >= 2 && hitsWithoutPeers.length > 0) {
    // 命中够多，但其中某条命中项连自己这一项的可比门店都不够 -> 不下确定性结论
    verdict = "insufficient";
    riskLevel = "watch";
    verdictReason =
      `命中 ${hitCount} 条规则（${hitIds.join("、")}），` +
      `但「${hitsWithoutPeers.join("、")}」缺少足够的可比门店，` +
      `无法排除区域性波动，本店本期判定为证据不足。`;
  } else if (hitCount >= 2 && !peerSufficient) {
    // 兜底：调用方没传逐指标可比性时，退回门禁指标的单一口径
    verdict = "insufficient";
    riskLevel = "watch";
    verdictReason =
      `命中 ${hitCount} 条规则（${hitIds.join("、")}），` +
      `但可比门店仅 ${peerCount} 家，少于要求的 ${MIN_PEERS} 家，` +
      `无法排除区域性波动，本店本期判定为证据不足。`;
  } else if (hitCount >= 2) {
    verdict = "possible";
    riskLevel = hitCount >= 3 ? "high" : "watch";
    verdictReason =
      `命中 ${hitCount} 条规则（${hitIds.join("、")}），` +
      `且各命中项的可比门店均达到要求（销售口径 ${peerCount} 家），` +
      `已达到「至少 2 条」的判定门槛。此为疑似异常，具体原因待核查。`;
  } else if (hitCount === 1) {
    verdict = "insufficient";
    riskLevel = "watch";
    verdictReason =
      `仅命中 1 条规则（${hitIds[0]}），未达到「至少 2 条」的判定门槛，` +
      `不足以支撑异常结论，但已记录待观察。`;
  } else {
    verdict = "none";
    riskLevel = "normal";
    verdictReason = `三条规则均未命中，各项指标处于常规波动范围内。`;
  }

  // 建议动作模板：只在这里生成，Agent 只能引用改写，不能发明新的动作类型
  let suggestedAction: string | undefined;
  if (verdict === "possible") {
    if (hitIds.includes("refund_high")) {
      suggestedAction = "抽查最近 20 笔退款订单并核对退款原因分布";
    } else if (hitIds.includes("sales_drop")) {
      suggestedAction = "核查最近 7 日设备在线情况与到店客流，确认是否为设备故障或客流变化";
    }
  }

  // 升级条件（configs/thresholds.yaml 的 escalation）
  const refundRate = pick(results, "refund_rate")?.value ?? null;
  const salesChg = pick(results, "sales_change_pct")?.value ?? null;
  const recommendEscalate =
    verdict === "possible" &&
    (hitCount >= 3 ||
      (refundRate !== null && refundRate >= 8) ||
      (salesChg !== null && salesChg <= -40));

  const evaluation: RuleEvaluation = {
    definition: STORE_RULE_DEFINITION,
    decision: STORE_RULE_DECISION,
    subject: { store_id: storeId, region, grade },
    window,
    verdict,
    risk_level: riskLevel,
    conditions,
    hit_count: hitCount,
    hit_ids: hitIds,
    verdict_reason: verdictReason,
    suggested_action_template: suggestedAction,
    recommend_escalate: recommendEscalate,
    evidence_ids: evidence.map((e) => e.evidence_id),
    data_version: dataVersion,
    trace_id: traceId,
  };

  return { evaluation, evidence };
}

/**
 * 区域级判定：区分「区域性问题」和「单店问题」。
 *
 * 这是很容易做错的地方。区域内一家店暴跌，不代表这个区域在恶化。
 * 所以这里同时看：命中门店占比 + 区域内部离散度。离散度大 -> 是单店问题。
 */
export interface RegionRollupInput {
  region: string;
  window: Window;
  storeEvaluations: RuleEvaluation[];
  /** 各店销售变化率，用于算离散度 */
  storeSalesChange: { store_id: string; value: number | null }[];
  dataVersion: string;
  traceId: string;
}

export interface RegionRollup {
  region: string;
  window: Window;
  store_count: number;
  possible_count: number;
  unavailable_count: number;
  possible_share: number;
  /** 变异系数，衡量区域内部离散度 */
  cv: number | null;
  label: "区域性波动" | "单店问题" | "区域平稳" | "数据不足";
  conclusion_allowed: boolean;
  reason: string;
  data_version: string;
  trace_id: string;
}

export function evaluateRegion(input: RegionRollupInput): RegionRollup {
  const { region, window, storeEvaluations, storeSalesChange, dataVersion, traceId } = input;

  const storeCount = storeEvaluations.length;
  const possibleCount = storeEvaluations.filter((e) => e.verdict === "possible").length;
  const unavailableCount = storeEvaluations.filter((e) => e.verdict === "unavailable").length;
  const possibleShare = storeCount === 0 ? 0 : (possibleCount / storeCount) * 100;

  // 离散度：变异系数 CV = 标准差 / |均值|
  const vals = storeSalesChange
    .map((s) => s.value)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  let cv: number | null = null;
  if (vals.length >= 2) {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (Math.abs(mean) > 1e-9) {
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      cv = Number(((Math.sqrt(variance) / Math.abs(mean)) * 100).toFixed(2));
    }
  }

  let label: RegionRollup["label"];
  let conclusionAllowed = true;
  let reason: string;

  if (storeCount < 2) {
    label = "数据不足";
    conclusionAllowed = false;
    reason = `${region} 窗口内有效门店仅 ${storeCount} 家，不足 2 家，不给区域级结论。`;
  } else if (unavailableCount / storeCount > 0.5) {
    label = "数据不足";
    conclusionAllowed = false;
    reason =
      `${region} 有 ${unavailableCount}/${storeCount} 家门店数据不可用，` +
      `区域结论可能严重偏离，本期不做区域判定。`;
  } else if (possibleShare >= 40 && (cv === null || cv < 25)) {
    label = "区域性波动";
    reason =
      `${region} 命中疑似异常的门店占比 ${possibleShare.toFixed(1)}%（≥40%），` +
      `且店间离散度 ${cv === null ? "无法计算" : `${cv}%（<25%）`}，` +
      `异常在区域内普遍出现，倾向区域性因素。此判断仅为待核查假设。`;
  } else if (possibleCount > 0) {
    label = "单店问题";
    reason =
      `${region} 命中疑似异常的门店占比 ${possibleShare.toFixed(1)}%（<40%），` +
      (cv !== null && cv >= 25
        ? `且店间离散度 ${cv}%（≥25%），`
        : "") +
      `异常集中在个别门店，不构成区域性问题。`;
  } else {
    label = "区域平稳";
    reason = `${region} 无门店命中异常规则，区域经营平稳。`;
  }

  return {
    region,
    window,
    store_count: storeCount,
    possible_count: possibleCount,
    unavailable_count: unavailableCount,
    possible_share: Number(possibleShare.toFixed(2)),
    cv,
    label,
    conclusion_allowed: conclusionAllowed,
    reason,
    data_version: dataVersion,
    trace_id: traceId,
  };
}
