/**
 * 可比门店与基准 (任务B)
 *
 * 职责：给定一家门店，找出「真正可比」的对象，算出中位数、排名和差距。
 *
 * 三条纪律：
 *   1. 可比性必须显式判定，不能"同区域就算可比"。业态档口不同（standard vs compact）
 *      混在一起比，得出的一定是错的结论。
 *   2. 被剔除的门店必须记录原因。报告里要能回答"为什么只有 3 家可比"。
 *   3. 可比门店不足时，绝不出排名 —— 只有 2 家店的排名没有统计意义。
 *
 * 【2026-10-17 重要修正：可比性是「逐指标」的，不是「逐门店」的】
 *
 * 原先的实现用一次全局数据质量判定来决定一家门店能不能进可比池：
 *   assessQuality(该店当前窗口) === "unavailable"  ->  整店剔除
 *
 * 这个口径是错的，而且错得很贵。反例就在本 Demo 里：
 *   S004 的 refund_amount / refund_order_count 自 2026-10-06 起整片断报，
 *   空值率 7/21 = 33% > 20%  ->  整店被判 unavailable  ->  从朝阳区可比池剔除。
 *   朝阳区标准档本来只有 S001~S004 + S021，剔掉自己和 S004 就只剩 3 家；
 *   再有任何一家窗口内缺数，可比数就掉到 3 以下，S001 会从 possible 降级成
 *   insufficient —— 主线演示当场翻车。
 *
 * 而 S004 的销售额和订单数是**完整的**。它对「销售变化率」是合格的可比对象，
 * 只是不能参与「退款率」对比。把「某字段缺」当成「整家店不可用」，是把
 * 数据质量问题错误地放大成了可比性质问题。
 *
 * 所以现在分成两层：
 *   第一层 基础准入（逐门店）：同区域 + 同业态 + 非被审主体。
 *         这一层只回答"这两家店在业务上是不是一类店"。
 *   第二层 逐指标可用（逐指标）：该指标在本店这条上算得出数值。
 *         这一层回答"这条数据是不是能拿来比"。
 * 剔除记录也分两处：基础准入剔除进 excluded，逐指标剔除进
 * metrics[].dropped_for_this_metric。两者语义不同，不能混在一处。
 */

import type {
  PeerComparison,
  MetricCode,
  ChangeCode,
  MetricResult,
  Window,
  Evidence,
} from "../../contracts/b/index";
import type { RawRow } from "./data_loader";
import { sliceStore, median } from "./data_loader";
import { computeMetrics } from "./metric_service";

export const MIN_PEERS = 3;

/**
 * 判定「区域性波动」时使用的门禁指标。
 *
 * 为什么不是「所有指标都达标才算达标」：区域性问题本质上是一个**销售**现象。
 * 如果要求退款率、客单价也各有 3 家可比，那么任何一家门店的某个次要字段断报
 * 都会把可比性判否，结论会被数据采集质量而不是经营状况牵着走。
 * 销售变化率是规则里权重最高、也最不依赖易缺字段的一条，用它做门禁。
 * 其余指标的逐项可比性依然如实输出（metric_peer_sufficient），
 * 前端可以照实展示"退款率这一项可比门店只有 2 家，不出排名"。
 */
export const PEER_GATE_METRIC = "sales_change_pct";

/** 门店档案。真实系统里来自主数据，Demo 里由 CSV 推导。 */
export interface StoreProfile {
  store_id: string;
  region: string;
  grade: string;
}

/** 从原始行推导门店档案（区域与业态由数据本身决定） */
export function deriveProfiles(rows: RawRow[]): Map<string, StoreProfile> {
  const map = new Map<string, StoreProfile>();
  for (const r of rows) {
    if (!map.has(r.store_id)) {
      map.set(r.store_id, {
        store_id: r.store_id,
        region: r.region,
        // Demo 里业态由 store_id 段位与区域推断：西城区为 compact 档口
        grade: r.region === "西城区" ? "compact" : "standard",
      });
    }
  }
  return map;
}

/** 默认对比的指标组合 */
export const DEFAULT_PEER_METRICS: (MetricCode | ChangeCode)[] = [
  "sales_amount",
  "sales_change_pct",
  "refund_rate",
  "aov",
  "aov_change_pct",
];

/** 退款类指标排名方向相反：值越低越好 */
const LOWER_IS_BETTER: ReadonlySet<string> = new Set(["refund_rate", "refund_order_rate"]);

export interface CompareInput {
  storeId: string;
  window: Window;
  baselineWindow: Window;
  rows: RawRow[];
  profiles: Map<string, StoreProfile>;
  /** 当期被审计为异常主体的门店，默认不作为可比对象 */
  excludeFromPeers?: string[];
  metricCodes?: (MetricCode | ChangeCode)[];
  /**
   * 跨调用复用的指标缓存（可选）。
   *
   * 为什么需要它：getDashboardMetrics 要为每一家门店各调一次 comparePeers，
   * 而每家店的候选池基本就是同一个区域同一业态的那几家 —— 21 家店跑下来，
   * 同一家门店的 computeMetrics 会被重复算十几遍（每家店 2 个窗口 x 全量切片）。
   * 传同一个 Map 进来就能把这块从 O(门店数²) 压回 O(门店数)。
   *
   * 键由 buildMetricsMemoKey 生成，已包含窗口与基准窗口，
   * 所以窗口不同的两次调用不会互相污染；不传就是原先的逐次重算行为。
   */
  metricsMemo?: Map<string, MetricResult[]>;
}

/**
 * 指标缓存的键。
 *
 * 必须把 window / baselineWindow / traceId 都编进键里：
 *   - 窗口不同的两次调用算出的是不同的数，只按 storeId 缓存会串数据；
 *   - traceId 编进键是为了让**每次调用都拿到自己那条 trace 的指标**。
 *     带 traceId 的 MetricResult 是要进 evidence 的，若跨 trace 复用，
 *     报告里就会出现「本次调用的证据指向别的调用算出来的数」，
 *     审计线断掉——这正是 pipeline.ts 的 scoresCache 犯过的错。
 */
export function buildMetricsMemoKey(sid: string, window: Window, baselineWindow: Window, traceId: string): string {
  return `${sid}|${window.from}~${window.to}|${baselineWindow.from}~${baselineWindow.to}|${traceId}`;
}

export interface CompareOutput {
  comparison: PeerComparison;
  evidence: Evidence[];
  peerIds: string[];
  /**
   * 逐指标可比门店是否达标，供 rule_engine 读门禁指标。
   * 与 comparison.metric_peer_sufficient 是同一份数据，这里是省掉一次解构。
   */
  metricSufficient: Record<string, boolean>;
}

export function comparePeers(input: CompareInput): CompareOutput {
  const {
    storeId,
    window,
    baselineWindow,
    rows,
    profiles,
    excludeFromPeers = [],
    metricCodes = DEFAULT_PEER_METRICS,
    dataVersion,
    traceId,
    metricsMemo,
  } = input;

  const subject = profiles.get(storeId);
  if (!subject) {
    throw new Error(`unknown store: ${storeId}`);
  }

  const evidence: Evidence[] = [];
  const excluded: { store_id: string; reason: string }[] = [];

  //
  // ---- 1. 基础准入（逐门店）----
  //
  // 只看业务可比性，不看数据完整性。数据完整性交给下面第二层逐指标处理。
  // 指标值算不出来时，computeMetrics 自己会给出 null，那家店自然进不了
  // 该指标的可用集合，不需要在这一层提前整店枪毙。
  //
  const candidates: string[] = [];
  for (const [sid, p] of profiles) {
    if (sid === storeId) continue;

    if (p.region !== subject.region) {
      excluded.push({ store_id: sid, reason: `区域不同（${p.region}）` });
      continue;
    }
    if (p.grade !== subject.grade) {
      excluded.push({ store_id: sid, reason: `业态档口不同（${p.grade}）` });
      continue;
    }
    if (excludeFromPeers.includes(sid)) {
      excluded.push({ store_id: sid, reason: "当期被审计为异常主体，不作为基准" });
      continue;
    }

    candidates.push(sid);
  }

  //
  // ---- 2. 预算好每家的指标 ----
  //
  // 每个候选门店只算一次，后面所有指标复用。原先在指标循环里重复调用
  // computeMetrics 是 O(指标数 x 门店数) 次全量重算，既慢又容易在重构时
  // 出现两处口径不一致。
  //
  const metricsOf = (sid: string, region: string, grade: string): MetricResult[] => {
    const key = buildMetricsMemoKey(sid, window, baselineWindow, traceId);
    const hit = metricsMemo?.get(key);
    if (hit) return hit;

    const out = computeMetrics(
      sliceStore(rows, sid, window),
      sliceStore(rows, sid, baselineWindow),
      {
        storeId: sid,
        region,
        grade,
        window,
        // 显式把基准窗口传下去，不要再让 computeMetrics 自己 shiftWindow(window, -7)。
        // 传 null 的后果不是报错，而是变 rate 悄悄用另一个窗口算 —— 最难查的那类 bug。
        baselineWindow,
        dataVersion,
        traceId,
      },
    ).results;

    metricsMemo?.set(key, out);
    return out;
  };

  const subjectMetrics = metricsOf(storeId, subject.region, subject.grade);
  const peerMetrics = new Map<string, MetricResult[]>();
  for (const sid of candidates) {
    peerMetrics.set(sid, metricsOf(sid, subject.region, subject.grade));
  }

  const valueOf = (list: MetricResult[], code: MetricCode | ChangeCode): number | null =>
    list.find((m) => m.metric_code === code)?.value ?? null;

  //
  // ---- 3. 逐指标计算。每个指标只在该指标算得出数值的门店上比较 ----
  //
  const comparisons: PeerComparison["metrics"] = [];
  const metricSufficient: Record<string, boolean> = {};

  for (const code of metricCodes) {
    const subjectValue = valueOf(subjectMetrics, code);
    const unit = subjectMetrics.find((m) => m.metric_code === code)?.unit ?? "count";

    // 逐指标可用性：本指标在这家店算得出数值，才算这家店在本指标上可比
    const usable: { store_id: string; value: number }[] = [];
    const droppedForThisMetric: string[] = [];

    for (const sid of candidates) {
      const v = valueOf(peerMetrics.get(sid)!, code);
      if (typeof v === "number" && Number.isFinite(v)) {
        usable.push({ store_id: sid, value: v });
      } else {
        droppedForThisMetric.push(sid);
      }
    }

    const values = usable.map((p) => p.value);
    const med = median(values);
    const sufficient = usable.length >= MIN_PEERS;
    metricSufficient[code] = sufficient;

    // 排名：本店在「本店 + 本指标可用可比门店」中的位置。
    // 不足 MIN_PEERS 时不出排名，这是统计意义问题，不是展示偏好问题。
    let rank: number | null = null;
    if (subjectValue !== null && sufficient) {
      const lowerBetter = LOWER_IS_BETTER.has(code);
      const all = [...values, subjectValue].sort((a, b) => (lowerBetter ? a - b : b - a));
      rank = all.indexOf(subjectValue) + 1;
    }

    comparisons.push({
      metric_code: code,
      unit,
      subject_value: subjectValue,
      peer_median: med === null ? null : Number(med.toFixed(2)),
      peer_min: values.length ? Math.min(...values) : null,
      peer_max: values.length ? Math.max(...values) : null,
      rank,
      peer_count: usable.length,
      peer_sufficient: sufficient,
      dropped_for_this_metric: droppedForThisMetric,
    });

    const eid = `ev_peer_${code}_${storeId}_${window.from.replace(/-/g, "")}`;
    evidence.push({
      evidence_id: eid,
      kind: "peer",
      summary:
        `${subject.region}${subject.grade} 可比组（${usable.length} 家）中，` +
        `${storeId} 的 ${code} = ${subjectValue ?? "缺失"}，` +
        `可比门店中位数 = ${med === null ? "无法计算" : med.toFixed(2)}` +
        (rank
          ? `，排名 ${rank}/${usable.length + 1}`
          : sufficient
            ? "，本店该项缺失，不出排名"
            : `，可比门店仅 ${usable.length} 家（< ${MIN_PEERS}），样本不足不出排名`) +
        (droppedForThisMetric.length
          ? `。本项排除 ${droppedForThisMetric.join("、")}（该项数值缺失）`
          : ""),
      inputs: {
        subject_value: subjectValue,
        peers: usable,
        peer_median: med,
        peer_count: usable.length,
        peer_sufficient: sufficient,
        dropped_for_this_metric: droppedForThisMetric,
        gate_metric: PEER_GATE_METRIC,
        window,
      },
      formula: "peer_median = median(可比门店同指标值)",
      metric_code: code as MetricCode,
      store_id: storeId,
      window,
      data_version: dataVersion,
      trace_id: traceId,
      created_at: new Date().toISOString(),
    });
  }

  //
  // ---- 4. 门禁：能否下「疑似异常」这种确定性结论 ----
  //
  const peerSufficient = metricSufficient[PEER_GATE_METRIC] ?? false;

  const comparison: PeerComparison = {
    subject_store_id: storeId,
    window,
    peer_store_ids: candidates,
    excluded,
    peer_sufficient: peerSufficient,
    min_peers_required: MIN_PEERS,
    metric_peer_sufficient: metricSufficient,
    metrics: comparisons,
    // 可比门店不足时，前端和 Agent 都不得展示排名
    ready_for_ranking: peerSufficient,
    evidence_ids: evidence.map((e) => e.evidence_id),
    data_version: dataVersion,
    trace_id: traceId,
  };

  return { comparison, evidence, peerIds: candidates, metricSufficient };
}
