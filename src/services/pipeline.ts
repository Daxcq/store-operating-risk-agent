/**
 * 数据层入口 (任务B)
 *
 * 这是 B 对 A / C / D 的唯一出口，对应 contracts/b/index.ts 的 DataLayerApi。
 *
 * 出口设计成一个函数而不是散装模块，是为了守住范围原则：
 *   规则（computeMetrics / rule_engine / region_score）负责「判断」，
 *   Agent 负责「调度和表达」。
 * Agent 不碰 SQL、不读全量原始数据、不自己算阈值，它只能调这四个函数。
 */

import type {
  AuditInput,
  DataLayerApi,
  DashboardFilters,
  DashboardMetrics,
  MetricResult,
  RegionResult,
  RuleEvaluation,
  PeerComparison,
  LocationScore,
  ToolCallResult,
  Window,
  Evidence,
  TraceEvent,
} from "../../contracts/b/index";
import { toRatio } from "../../contracts/b/index";
import type { RawRow } from "./data_loader";
import {
  parseCsv,
  sliceStore,
  sliceRegion,
  assessQuality,
  shiftWindow,
  median,
} from "./data_loader";
import { computeMetrics, decomposeSalesChange } from "./metric_service";
import { evaluateStoreRule, evaluateRegion } from "./rule_engine";
import {
  comparePeers,
  deriveProfiles,
  DEFAULT_PEER_METRICS,
  buildMetricsMemoKey,
} from "./benchmark_service";
import {
  scoreLocations,
  parseCostCsv,
  aggregateRegionROI,
} from "./region_score";
import type { StoreROI, UnestimableStore } from "./region_score";
import { toRegionId, toRegionName } from "./region_code";

/** 默认审计窗口：最近 7 个完整业务日 */
export const DEFAULT_WINDOW: Window = { from: "2026-10-06", to: "2026-10-12" };
export const DEFAULT_DATA_VERSION = "demo_v1";

/** 简易 trace 收集器。真实系统写入 trace_event 表，Demo 里在内存累积后返回。 */
class TraceCollector {
  private events: TraceEvent[] = [];
  constructor(
    private traceId: string,
    private dataVersion: string,
  ) {}

  push(type: TraceEvent["type"], payload: Partial<TraceEvent> = {}) {
    this.events.push({
      trace_id: this.traceId,
      seq: this.events.length + 1,
      type,
      at: new Date().toISOString(),
      data_version: this.dataVersion,
      ...payload,
    });
  }

  all(): TraceEvent[] {
    return this.events;
  }
}

export interface PipelineOptions {
  /** 主数据 CSV 文本。浏览器侧用 fetch 拿，Node 侧用 fs 读。 */
  csvText: string;
  /** 成本输入 CSV 文本，区域评分用 */
  costCsvText?: string;
  /** 调用方传入的 trace_id，不传则自动生成 */
  traceId?: string;
  /** 可注入的时间，便于测试固定输出 */
  now?: () => number;
}

/** 生成 trace_id。Demo 里用时间戳 + 计数，真实系统应由网关下发。 */
function newTraceId(): string {
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 1e6).toString(36);
  return `trace_${t}${r}`;
}

/**
 * 组装数据层。返回 DataLayerApi 的四个函数。
 *
 * 用法：
 *   const dl = createDataLayer({ csvText, costCsvText });
 *   const r = await dl.runAudit({ store_id: "S001" });
 */
export function createDataLayer(opts: PipelineOptions): DataLayerApi & {
  getTrace(traceId: string): TraceEvent[];
} {
  const allRows: RawRow[] = parseCsv(opts.csvText);
  const profiles = deriveProfiles(allRows);
  const costInputs = opts.costCsvText ? parseCostCsv(opts.costCsvText) : [];
  const traceStore = new Map<string, TraceEvent[]>();

  /** 统一的工具结果包装：每个返回值都带 evidence_ids / data_version / warnings */
  function wrap<T>(
    toolCallId: string,
    data: T | null,
    evidenceIds: string[],
    warnings: string[],
    traceId: string,
    ok: boolean,
  ): ToolCallResult<T> {
    return {
      tool_call_id: toolCallId,
      status: ok ? (warnings.length ? "degraded" : "succeeded") : "failed",
      data,
      evidence_ids: evidenceIds,
      data_version: DEFAULT_DATA_VERSION,
      trace_id: traceId,
      warnings,
    };
  }

  function resolveWindow(input: AuditInput): Window {
    return input.window ?? DEFAULT_WINDOW;
  }

  /** 找出数据里的全部区域 */
  function allRegions(): string[] {
    return [...new Set(allRows.map((r) => r.region))].sort();
  }

  /** 窗口的自然天数（含首尾），用于推导等长基准窗口 */
  function dayCount(w: Window): number {
    const d = (s: string) => Date.parse(`${s}T00:00:00Z`);
    const ms = d(w.to) - d(w.from);
    return Number.isFinite(ms) ? Math.round(ms / 86400000) + 1 : 0;
  }

  /**
   * 从指标结果里取一个值，供证据快照使用。
   * 缺失一律返回 null —— 不要在这里回退成 0，快照里的 0 会被当成真实观测值。
   */
  function pickMetric(
    results: MetricResult[],
    code: MetricResult["metric_code"],
  ): number | null {
    return results.find((m) => m.metric_code === code)?.value ?? null;
  }

  /**
   * 评分与 ROI 的惰性缓存。
   *
   * 区域评分要跑全量门店的指标计算，一次约 21 家 x 2 窗口，
   * 而 getDashboardMetrics / compareRegions / estimateRegionROI 都要用它。
   * 同一个 dataLayer 实例内结果不变（数据是加载时固定的），所以算一次存下来。
   *
   * 【2026-10-17 修正：trace_id 不能再跟着缓存走】
   *
   * 原来的注释写「缓存键带上 traceId 只是为了审计」，但那句话和代码不符，
   * 而且掩盖了一个真问题：scoreLocations 只被真实执行**一次**，
   * 那次执行收到的 traceId 会被原样烙进所有 LocationScore 和 Evidence。
   * 于是第一个调用方之后的所有调用方（compare_regions / estimate_region_roi /
   * get_dashboard_metrics）拿到的证据上写的都是**别人**的 trace_id ——
   * 契约要求的「每个数字都能沿 evidence_id -> trace_id 追回它所属的那次计算」
   * 在这条动线上是断的，而且断得很隐蔽：字段有值、格式正确、就是追错地方。
   *
   * 修法：计算本身与调用方无关，所以用中立的 CACHE_TRACE_ID 执行一次，
   * 返回时按调用方重盖 trace_id（只影响 score/evidence 的溯源字段，
   * evidence_id 是确定性的，不含 traceId，所以跨调用保持一致）。
   */
  const CACHE_TRACE_ID = "trace_score_cache";
  let scoresCache: ReturnType<typeof scoreLocations> | null = null;

  /** 把缓存里的溯源字段换成调用方自己的 trace_id（浅拷贝，不动缓存本体） */
  function restamp(
    cached: ReturnType<typeof scoreLocations>,
    traceId: string,
  ): ReturnType<typeof scoreLocations> {
    if (traceId === CACHE_TRACE_ID) return cached;
    return {
      ...cached,
      scores: cached.scores.map((s) => ({ ...s, trace_id: traceId })),
      evidence: cached.evidence.map((e) => ({ ...e, trace_id: traceId })),
    };
  }

  function ensureScores(traceId: string): ReturnType<typeof scoreLocations> {
    if (!scoresCache) {
      scoresCache = scoreLocations({
        window: DEFAULT_WINDOW,
        baselineWindow: shiftWindow(DEFAULT_WINDOW, -7),
        rows: allRows,
        profiles,
        costInputs,
        dataVersion: DEFAULT_DATA_VERSION,
        traceId: CACHE_TRACE_ID,
      });
    }
    return restamp(scoresCache, traceId);
  }

  /** 逐门店 ROI。评分调用顺带产出，这里只做取用。
   *  ROI 数据本身不带 trace_id，不存在重盖问题，所以直接读缓存。 */
  function roiStoresOf(): { stores: StoreROI[]; unestimable: UnestimableStore[] } {
    const s = scoresCache;
    return { stores: s?.roiStores ?? [], unestimable: s?.roiUnestimable ?? [] };
  }

  /** 评分那条动线里，一个区域可能拆成多个档口，逐档产生的 evidence_id 长这样 */
  function roiEvidenceIds(region: string, scores: LocationScore[]): string[] {
    const stamp = DEFAULT_WINDOW.from.replace(/-/g, "");
    return scores
      .filter((s) => s.region === region)
      .map((s) => `ev_roi_${region}_${s.grade}_${stamp}`);
  }

  /** LocationScore(snake_case) -> RegionResult(camelCase)。转换只允许在这里发生。 */
  function toRegionResult(s: LocationScore): RegionResult {
    const { stores, unestimable } = roiStoresOf();
    const agg = aggregateRegionROI(s.region, stores, unestimable);
    return {
      regionId: toRegionId(s.region) ?? s.region,
      name: s.region,
      // LocationScore.score 可空，RegionResult.score 是必填 0..100。
      // 空分只可能出现在置信度最低的情况下，用 0 并在 reasons 里交代，
      // 比在适配层编一个中间值更容易被发现。
      score: s.score ?? 0,
      // 契约里这个字段是必填 number，不接受 null。
      // 真的一家店都估不出来时给 0 并在 reasons 里说清楚 ——
      // 与其在适配层编一个数，不如给 0 加上一句「无法估算」的说明，
      // 让看的人知道这个 0 不是「不赚钱」的意思。
      estimatedMonthlyProfit: agg.monthlyProfit ?? 0,
      estimatedPaybackMonths: agg.paybackMonths,
      reasons: [
        ...agg.reasons,
        ...(agg.monthlyProfit === null
          ? ["该区域月利润无法估算，上面的 0 是占位，不代表不赚钱，请勿据此下结论。"]
          : []),
        ...s.reasons,
      ],
      assumptions: agg.assumptions.length ? agg.assumptions : s.assumptions,
    };
  }

  // ============================================================
  // 工具 1: get_dashboard —— 查询经营摘要（不改变状态）
  // ============================================================
  async function getDashboard(
    input: AuditInput,
  ): Promise<ToolCallResult<MetricResult[]>> {
    const traceId = opts.traceId ?? newTraceId();
    const tr = new TraceCollector(traceId, DEFAULT_DATA_VERSION);
    const window = resolveWindow(input);
    const baseline = shiftWindow(window, -7);
    const warnings: string[] = [];

    tr.push("tool_call", { tool: "get_dashboard", input: { ...input, window } });

    let results: MetricResult[] = [];
    let evidence: Evidence[] = [];

    if (input.store_id) {
      const sid = input.store_id;
      const p = profiles.get(sid);
      if (!p) {
        tr.push("degraded", { note: `未找到门店 ${sid}` });
        traceStore.set(traceId, tr.all());
        return wrap<MetricResult[]>("call_dashboard", null, [], [`未找到门店 ${sid}`], traceId, false);
      }
      const rows = sliceStore(allRows, sid, window);
      const out = computeMetrics(rows, sliceStore(allRows, sid, baseline), {
        storeId: sid,
        region: p.region,
        grade: p.grade,
        window,
        baselineWindow: baseline,
        dataVersion: DEFAULT_DATA_VERSION,
        traceId,
      });
      results = out.results;
      evidence = out.evidence;

      const q = assessQuality(rows, window);
      if (q.status === "unavailable") {
        warnings.push(
          `门店 ${sid} 当前窗口数据不可用（有效天数 ${q.valid_days}/${q.calendar_days}），部分指标返回 null。`,
        );
      }
    } else {
      // 区域或全局视图
      const region = input.region;
      const rows = region ? sliceRegion(allRows, region, window) : allRows.filter((r) => r.date >= window.from && r.date <= window.to);
      const targetStores = region
        ? [...profiles.values()].filter((p) => p.region === region)
        : [...profiles.values()];
      const grade = targetStores.length ? targetStores[0].grade : "standard";

      const out = computeMetrics(
        rows,
        region
          ? sliceRegion(allRows, region, baseline)
          : allRows.filter((r) => r.date >= baseline.from && r.date <= baseline.to),
        {
          region,
          grade,
          window,
          baselineWindow: baseline,
          dataVersion: DEFAULT_DATA_VERSION,
          traceId,
        },
      );
      results = out.results;
      evidence = out.evidence;
    }

    const scope = input.store_id ?? input.region ?? "全部区域";
    tr.push("tool_result", {
      tool: "get_dashboard",
      output: { scope, metric_count: results.length, warnings },
    });
    traceStore.set(traceId, tr.all());

    return wrap(
      "call_dashboard",
      results,
      evidence.map((e) => e.evidence_id),
      warnings,
      traceId,
      true,
    );
  }

  // ============================================================
  // 工具 2: run_audit —— 按固定规则执行审计（不改变状态）
  // ============================================================
  async function runAudit(input: AuditInput): Promise<ToolCallResult<RuleEvaluation>> {
    const traceId = opts.traceId ?? newTraceId();
    const tr = new TraceCollector(traceId, DEFAULT_DATA_VERSION);
    const window = resolveWindow(input);
    const baseline = shiftWindow(window, -7);
    const warnings: string[] = [];

    tr.push("tool_call", { tool: "run_audit", input: { ...input, window } });

    const sid = input.store_id;
    if (!sid) {
      tr.push("degraded", { note: "run_audit 需要 store_id" });
      traceStore.set(traceId, tr.all());
      return wrap<RuleEvaluation>(
        "call_audit",
        null,
        [],
        ["run_audit 必须指定 store_id，区域级判定请先用 get_dashboard 再逐店审计。"],
        traceId,
        false,
      );
    }

    const p = profiles.get(sid);
    if (!p) {
      traceStore.set(traceId, tr.all());
      return wrap<RuleEvaluation>("call_audit", null, [], [`未找到门店 ${sid}`], traceId, false);
    }

    // 1) 算指标
    const curRows = sliceStore(allRows, sid, window);
    const baseRows = sliceStore(allRows, sid, baseline);
    const dec = computeMetrics(curRows, baseRows, {
      storeId: sid,
      region: p.region,
      grade: p.grade,
      window,
      baselineWindow: baseline,
      dataVersion: DEFAULT_DATA_VERSION,
      traceId,
    });

    // 2) 可比门店（判定 peerSufficient，直接影响 verdict）
    //    排除当期已在审计中的主体，避免同类异常互相做基准
    const cmp = comparePeers({
      storeId: sid,
      window,
      baselineWindow: baseline,
      rows: allRows,
      profiles,
      excludeFromPeers: [],
      metricCodes: DEFAULT_PEER_METRICS,
      dataVersion: DEFAULT_DATA_VERSION,
      traceId,
    });

    // 3) 规则判定
    const { evaluation, evidence } = evaluateStoreRule({
      storeId: sid,
      region: p.region,
      grade: p.grade,
      window,
      results: dec.results,
      quality: assessQuality(curRows, window),
      peerSufficient: cmp.comparison.peer_sufficient,
      peerCount: cmp.peerIds.length,
      // 必须逐指标往下传：可比性是按指标判的，不是按门店。
      // 少了这一行，规则引擎会退回「销售口径可比门店一家都不够」
      // 的整店口径，S001 会从 possible 掉成 insufficient。
      metricPeerSufficient: cmp.metricSufficient,
      dataVersion: DEFAULT_DATA_VERSION,
      traceId,
    });

    // 4) 二因素拆解作为附加证据（回应「为什么变了」，但仍不是归因）
    const decomp = decomposeSalesChange(dec.results);
    if (decomp.order_effect_pct !== null) {
      evidence.push({
        evidence_id: `ev_decomp_${sid}_${window.from.replace(/-/g, "")}`,
        kind: "metric",
        summary: `销售变化拆解：订单数效应 ${decomp.order_effect_pct}%，客单价效应 ${decomp.aov_effect_pct}%。${decomp.note}`,
        inputs: {
          // 两项效应之和应当等于 sales_change_pct。放在这里是为了让 D 的校验脚本
          //（和任何复盘的人）能直接对拍，不必自己重算交叉项。
          order_effect_pct: decomp.order_effect_pct,
          aov_effect_pct: decomp.aov_effect_pct,
          total_effect_pct: decomp.total_effect_pct,
          // 原始变化率一并留存，交叉项分摊对不对由它来兜底
          order_change_pct: pickMetric(dec.results, "order_change_pct"),
          aov_change_pct: pickMetric(dec.results, "aov_change_pct"),
          sales_change_pct: pickMetric(dec.results, "sales_change_pct"),
        },
        formula:
          "销售额变化 = (1+订单数变化)x(1+客单价变化)-1 = o + a + o*a；" +
          "交叉项 o*a 按各半分摊到两项，故 order_effect + aov_effect 恒等于销售变化率",
        store_id: sid,
        window,
        data_version: DEFAULT_DATA_VERSION,
        trace_id: traceId,
        created_at: new Date().toISOString(),
      });
      evaluation.evidence_ids.push(`ev_decomp_${sid}_${window.from.replace(/-/g, "")}`);
    }

    if (evaluation.verdict !== "possible") {
      warnings.push(evaluation.verdict_reason);
    }
    if (!cmp.comparison.peer_sufficient) {
      warnings.push(
        `可比门店仅 ${cmp.peerIds.length} 家（要求 ${cmp.comparison.min_peers_required} 家），排名不可用。`,
      );
    }

    tr.push("rule_evaluated", {
      tool: "run_audit",
      output: {
        store_id: sid,
        verdict: evaluation.verdict,
        hit_count: evaluation.hit_count,
        hit_ids: evaluation.hit_ids,
      },
    });
    tr.push("tool_result", {
      tool: "run_audit",
      output: { evidence_count: evidence.length, warnings },
    });
    traceStore.set(traceId, tr.all());

    return wrap(
      "call_audit",
      evaluation,
      [...evaluation.evidence_ids, ...evidence.map((e) => e.evidence_id)],
      warnings,
      traceId,
      true,
    );
  }

  // ============================================================
  // 工具 3: get_dashboard_metrics —— 首页驾驶舱（不改变状态）
  //
  // 与工具 1 的区别：工具 1 返回逐指标的 MetricResult[]，是给审计和报告用的；
  // 这里返回契约冻结的 DashboardMetrics 五个字段，是给首页直接渲染用的。
  // 两者共用同一份 computeMetrics，不重复实现口径。
  //
  // 【口径说明】工具 1 的销售额/设备数是「加总」（整个区域的值），
  // 这里的 estimatedProfit 是「中位数」（典型门店的值）。
  // 两者刻意不同：销售额问的是「这个区域做了多少生意」，
  // 月利润问的是「在这里开一家店能赚多少」。
  // 如果都加总，5 家店的区域利润天然高于 3 家店的区域，
  // 区域对比就退化成门店数量对比了。
  // ============================================================
  async function getDashboardMetrics(
    filters?: DashboardFilters,
  ): Promise<ToolCallResult<DashboardMetrics>> {
    const traceId = opts.traceId ?? newTraceId();
    const tr = new TraceCollector(traceId, DEFAULT_DATA_VERSION);
    const warnings: string[] = [];

    const from = filters?.from ?? DEFAULT_WINDOW.from;
    const to = filters?.to ?? DEFAULT_WINDOW.to;
    const window: Window = { from, to };

    tr.push("tool_call", { tool: "get_dashboard", input: { ...filters, window } });

    // 参数校验：from > to 当参数错误处理，不要静默返回空
    if (from > to) {
      tr.push("degraded", { note: `窗口起点晚于终点：${from} > ${to}` });
      traceStore.set(traceId, tr.all());
      return wrap<DashboardMetrics>(
        "call_dashboard_metrics",
        null,
        [],
        [`窗口起止不合法：from=${from} 晚于 to=${to}。`],
        traceId,
        false,
      );
    }

    let regionName: string | undefined;
    if (filters?.regionId !== undefined && filters.regionId.trim() !== "") {
      const resolved = toRegionName(filters.regionId);
      if (resolved === null) {
        tr.push("degraded", { note: `未登记的区域标识：${filters.regionId}` });
        traceStore.set(traceId, tr.all());
        return wrap<DashboardMetrics>(
          "call_dashboard_metrics",
          null,
          [],
          [`未知区域：${filters.regionId}（可用：${allRegions().join("、")}）。`],
          traceId,
          false,
        );
      }
      regionName = resolved;
    }

    const scoped = allRows.filter(
      (r) =>
        r.date >= window.from &&
        r.date <= window.to &&
        (regionName === undefined || r.region === regionName),
    );

    const storeIds = [...new Set(scoped.map((r) => r.store_id))].sort();
    if (storeIds.length === 0) {
      traceStore.set(traceId, tr.all());
      const scope = regionName ?? "全部区域";
      return wrap<DashboardMetrics>(
        "call_dashboard_metrics",
        null,
        [],
        [`${scope} 在 ${from} ~ ${to} 没有任何数据。`],
        traceId,
        false,
      );
    }

    // 销售额：先加总再算其他，绝不做「每日比率求平均」
    let salesSum = 0;
    let missingSalesDays = 0;
    for (const r of scoped) {
      if (typeof r.sales_amount === "number" && Number.isFinite(r.sales_amount)) {
        salesSum += r.sales_amount;
      } else {
        missingSalesDays += 1;
      }
    }

    // 设备数：device_count 是快照字段，逐店取窗口内最大值后再加总，
    // 直接 SUM 会把设备数乘以天数（21 家店 7 天会算出 7 倍的设备数）
    let deviceCount = 0;
    let onlineDeviceDays = 0;
    let deviceDays = 0;
    let missingDeviceStores = 0;
    for (const sid of storeIds) {
      const rows = scoped.filter((r) => r.store_id === sid);
      const devices = rows
        .map((r) => r.device_count)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (devices.length === 0) {
        missingDeviceStores += 1;
        continue;
      }
      deviceCount += Math.max(...devices);
      for (const r of rows) {
        if (typeof r.device_count === "number" && Number.isFinite(r.device_count)) {
          deviceDays += r.device_count;
          if (typeof r.online_device_count === "number" && Number.isFinite(r.online_device_count)) {
            onlineDeviceDays += r.online_device_count;
          }
        }
      }
    }

    // 契约里 onlineRate 是必填的 0..1 数字，没有「未知」这个取值。
    // 所以设备数据整片缺失时不能拿 0 顶上（0% 在线率和「不知道」是两回事），
    // 只能让这次调用明确失败。
    if (deviceDays === 0) {
      tr.push("degraded", { note: "所选范围内没有任何设备数记录，onlineRate 无法计算" });
      traceStore.set(traceId, tr.all());
      return wrap<DashboardMetrics>(
        "call_dashboard_metrics",
        null,
        [],
        [
          `${regionName ?? "全部区域"} 在 ${from} ~ ${to} 没有任何设备数记录，` +
            `在线率无法计算。不要把它读作 0%。`,
        ],
        traceId,
        false,
      );
    }

    // onlineRate 是 0..1，内部 online_rate 是 0..100，必须在边界转换
    const onlineRate = toRatio((onlineDeviceDays / deviceDays) * 100) as number;

    // 未决发现数：判定为 possible 的门店数。
    // 用 possible 而不是 watch —— watch 里混着「证据不足」，
    // 那不是发现，是还没有结论。把它算进未决数会虚报工作量。
    //
    // 【性能】这一圈原来是 O(门店数 x 可比门店数 x 指标数)：
    // 每家店调一次 comparePeers，而 benchmark 里为「本店 + 候选池」各算一遍指标，
    // 但候选池在同一区域内高度重叠 —— 21 家店跑完，同一家店的 computeMetrics
    // 被重复算十几遍。下面把一份 memo 传进每一轮，跨调用复用同窗口同 trace 的指标，
    // 复杂度降到 O(门店数)。缓存键含 window 与 baselineWindow，
    // 这里每轮 base 都相同（同一个 window 推出的），所以命中率是满的。
    let openFindingCount = 0;
    const notEstimable: string[] = [];
    const sweepMetricsMemo = new Map<string, MetricResult[]>();
    const sweepBase = shiftWindow(window, -(dayCount(window) || 7));
    for (const sid of storeIds) {
      const p = profiles.get(sid);
      if (!p) continue;
      const cur = sliceStore(allRows, sid, window);
      // 基准窗口取等长的前一段。dayCount 理论上不会是 0（窗口已校验过），
      // 真出现 0 的话退回 7 天，不要让基准窗口和当期完全重合
      // —— 那样变化率恒为 0，会静默地把所有门店判成正常。
      const base = sweepBase;
      const dec = computeMetrics(cur, sliceStore(allRows, sid, base), {
        storeId: sid,
        region: p.region,
        grade: p.grade,
        window,
        baselineWindow: base,
        dataVersion: DEFAULT_DATA_VERSION,
        traceId,
      });
      const cmp = comparePeers({
        storeId: sid,
        window,
        baselineWindow: base,
        rows: allRows,
        profiles,
        excludeFromPeers: [],
        metricCodes: DEFAULT_PEER_METRICS,
        metricsMemo: sweepMetricsMemo,
        dataVersion: DEFAULT_DATA_VERSION,
        traceId,
      });
      const { evaluation } = evaluateStoreRule({
        storeId: sid,
        region: p.region,
        grade: p.grade,
        window,
        results: dec.results,
        quality: assessQuality(cur, window),
        peerSufficient: cmp.comparison.peer_sufficient,
        peerCount: cmp.peerIds.length,
        metricPeerSufficient: cmp.metricSufficient,
        dataVersion: DEFAULT_DATA_VERSION,
        traceId,
      });
      if (evaluation.verdict === "possible") openFindingCount += 1;
    }
    tr.push("audit_swept", {
      tool: "get_dashboard",
      output: { stores_audited: storeIds.length, open_findings: openFindingCount },
    });

    // 月利润：区域口径取中位数；全局视图按各区域典型门店的中位数再取中位数，
    // 而不是把各区域利润相加（同样是避免变成门店数量对比）
    ensureScores(traceId);
    const { stores: roiStores, unestimable: roiUnestimable } = roiStoresOf();
    const inScopeRegions = [...new Set(scoped.map((r) => r.region))].sort();
    const aggs = inScopeRegions.map((rn) => aggregateRegionROI(rn, roiStores, roiUnestimable));
    for (const a of aggs) {
      if (a.monthlyProfit === null) notEstimable.push(a.region);
    }

    let estimatedProfit = 0;
    if (aggs.length > 0) {
      const profits = aggs
        .map((a) => a.monthlyProfit)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      estimatedProfit = profits.length ? Number(median(profits).toFixed(2)) : 0;
    }

    if (missingSalesDays > 0) {
      warnings.push(
        `有 ${missingSalesDays} 条门店日记录缺少销售额，已按 0 计入加总，实际销售额可能更高。`,
      );
    }
    if (missingDeviceStores > 0) {
      warnings.push(`有 ${missingDeviceStores} 家门店缺设备数，未计入设备总数与在线率。`);
    }
    if (notEstimable.length > 0) {
      warnings.push(
        `以下区域成本或销售数据缺失，月利润无法估算，未纳入本指标的统计：${notEstimable.join("、")}。`,
      );
    }

    // 契约冻结字段：金额不得格式化为字符串、计数不得为负、onlineRate 必须在 0..1
    const data: DashboardMetrics = {
      salesAmount: Number(salesSum.toFixed(2)),
      estimatedProfit,
      deviceCount,
      onlineRate,
      openFindingCount,
    };

    tr.push("tool_result", {
      tool: "get_dashboard",
      output: { scope: regionName ?? "全部区域", ...data, warnings },
    });
    traceStore.set(traceId, tr.all());

    return wrap("call_dashboard_metrics", data, [], warnings, traceId, true);
  }

  /**
   * 解析区域入参。契约规定 regionIds 里的空字符串按「未提供」处理，
   * 重复项去重且保留首次出现的顺序（前端传 chaoyang,haidian,chaoyang
   * 时表格顺序不能跳）。
   */
  function resolveRegions(
    regionIds?: string[],
  ): { ok: true; names: string[] } | { ok: false; unknown: string[] } {
    if (regionIds === undefined) return { ok: true, names: allRegions() };
    const cleaned = regionIds.map((s) => s.trim()).filter((s) => s !== "");
    if (cleaned.length === 0) return { ok: true, names: allRegions() };

    const names: string[] = [];
    const unknown: string[] = [];
    for (const raw of cleaned) {
      const resolved = toRegionName(raw);
      if (resolved === null) {
        if (!unknown.includes(raw)) unknown.push(raw);
        continue;
      }
      if (!names.includes(resolved)) names.push(resolved);
    }
    if (unknown.length) return { ok: false, unknown };
    return { ok: true, names };
  }

  // ============================================================
  // 工具 4: compare_regions —— 区域对比（不改变状态）
  //
  // 返回的是契约的 RegionResult[]，字段名与内部 LocationScore 不同。
  // 转换集中在 toRegionResult 里，这个函数只负责选区域、排序、挑证据。
  // ============================================================
  async function compareRegions(
    regionIds?: string[],
  ): Promise<ToolCallResult<RegionResult[]>> {
    const traceId = opts.traceId ?? newTraceId();
    const tr = new TraceCollector(traceId, DEFAULT_DATA_VERSION);
    const warnings: string[] = [];

    tr.push("tool_call", { tool: "compare_regions", input: { regionIds } });

    const resolved = resolveRegions(regionIds);
    if (!resolved.ok) {
      traceStore.set(traceId, tr.all());
      return wrap<RegionResult[]>(
        "call_compare_regions",
        null,
        [],
        [`未知区域标识：${resolved.unknown.join("、")}（可用：${allRegions().join("、")}）。`],
        traceId,
        false,
      );
    }

    if (costInputs.length === 0) {
      traceStore.set(traceId, tr.all());
      return wrap<RegionResult[]>(
        "call_compare_regions",
        null,
        [],
        ["缺少成本输入数据（region_cost_input.csv），ROI 无法估算，区域对比不可用。"],
        traceId,
        false,
      );
    }

    const scored = ensureScores(traceId);
    // 一个区域可能有多个业态档口（LocationScore 是按区域 x 业态出的），
    // 区域对比只取该区域得分最高的一档作为代表，避免同一区域出现两行。
    // score 可能为 null（分项缺失导致降级），null 排最后，不参与「最高分」竞争。
    const byRegion = new Map<string, LocationScore>();
    for (const s of scored.scores) {
      if (!resolved.names.includes(s.region)) continue;
      const prev = byRegion.get(s.region);
      if (!prev || (s.score ?? -1) > (prev.score ?? -1)) byRegion.set(s.region, s);
    }

    const missing = resolved.names.filter((n) => !byRegion.has(n));
    if (missing.length) {
      warnings.push(`以下区域在评分结果中没有可用的业态档口：${missing.join("、")}。`);
    }

    const out = [...byRegion.values()]
      .map(toRegionResult)
      .sort((a, b) => b.score - a.score);

    // 同一区域多档口被合并时要说清楚，否则 A 的对表格和 B 的明细对不上要扯皮
    const multi = resolved.names.filter(
      (n) => scored.scores.filter((s) => s.region === n).length > 1,
    );
    if (multi.length) {
      warnings.push(
        `以下区域有多个业态档口，对比表中各取得分最高的那一档：${multi.join("、")}。完整分档请用 score_locations。`,
      );
    }

    tr.push("tool_result", {
      tool: "compare_regions",
      output: { count: out.length, order: out.map((r) => r.regionId), warnings },
    });
    traceStore.set(traceId, tr.all());

    // 证据 ID 必须指向真实存在的 evidence：评分那条动线是按
    // 「区域 x 业态」逐档产出 ev_roi_* 的，所以这里也要逐档列出来，
    // 而不是拼一个看起来对、实际查不到的 ID。
    const publicEvidence = [
      ...new Set(resolved.names.flatMap((n) => roiEvidenceIds(n, scored.scores))),
    ];

    return wrap("call_compare_regions", out, publicEvidence, warnings, traceId, true);
  }

  // ============================================================
  // 工具 5: estimate_region_roi —— 单区域 ROI（不改变状态）
  //
  // 只认一个区域，返回 RegionResult 而不是数组。
  // 与工具 4 共用 toRegionResult，同一区域的回本周期在
  // 单查和列表里必须是同一个数，否则界面上会自相矛盾。
  // ============================================================
  async function estimateRegionROI(
    regionId: string,
  ): Promise<ToolCallResult<RegionResult>> {
    const traceId = opts.traceId ?? newTraceId();
    const tr = new TraceCollector(traceId, DEFAULT_DATA_VERSION);
    const warnings: string[] = [];

    tr.push("tool_call", { tool: "estimate_region_roi", input: { regionId } });

    const resolved = resolveRegions([regionId]);
    if (!resolved.ok) {
      traceStore.set(traceId, tr.all());
      return wrap<RegionResult>(
        "call_region_roi",
        null,
        [],
        [`未知区域：${regionId}（可用：${allRegions().join("、")}）。`],
        traceId,
        false,
      );
    }
    const regionName = resolved.names[0];

    if (costInputs.length === 0) {
      traceStore.set(traceId, tr.all());
      return wrap<RegionResult>(
        "call_region_roi",
        null,
        [],
        [`缺少成本输入数据（region_cost_input.csv），${regionName} 的 ROI 无法估算。`],
        traceId,
        false,
      );
    }

    const scored = ensureScores(traceId);
    const candidates = scored.scores.filter((s) => s.region === regionName);
    if (candidates.length === 0) {
      traceStore.set(traceId, tr.all());
      return wrap<RegionResult>(
        "call_region_roi",
        null,
        [],
        [`${regionName} 没有可用的业态档口评分，无法估算 ROI。`],
        traceId,
        false,
      );
    }

    const best = candidates.reduce((a, b) => ((b.score ?? -1) > (a.score ?? -1) ? b : a));
    const result = toRegionResult(best);

    // scoreLocations 直接回传逐门店 ROI，不包一层 roi 对象 —— 写错成
    // scored.roi.stores 会在类型检查里就报出来，这里留个记号免得再犯。
    const agg = aggregateRegionROI(regionName, scored.roiStores, scored.roiUnestimable);
    if (agg.monthlyProfit === null) {
      warnings.push(
        `${regionName} 内没有一家门店可估算月利润，estimatedMonthlyProfit 以 0 占位，` +
          `这不代表该区域不赚钱，而是数据不足以估算，请勿据此下结论。`,
      );
    }
    if (result.estimatedPaybackMonths === null) {
      warnings.push(`${regionName} 的回本周期无法估算（月利润不为正或设备/成本数据缺失）。`);
    }
    if (candidates.length > 1) {
      warnings.push(
        `${regionName} 有 ${candidates.length} 个业态档口，本结果取得分最高的「${best.grade}」档。`,
      );
    }

    tr.push("tool_result", {
      tool: "estimate_region_roi",
      output: {
        regionId: result.regionId,
        monthly_profit: result.estimatedMonthlyProfit,
        payback_months: result.estimatedPaybackMonths,
        warnings,
      },
    });
    traceStore.set(traceId, tr.all());

    return wrap(
      "call_region_roi",
      result,
      [`ev_roi_${regionName}_${best.grade}_${DEFAULT_WINDOW.from.replace(/-/g, "")}`],
      warnings,
      traceId,
      true,
    );
  }

  // ============================================================
  // 工具 6: compare_peers —— 可比门店对比（不改变状态）
  // ============================================================
  async function comparePeersTool(
    input: AuditInput & { metric_codes?: (typeof DEFAULT_PEER_METRICS)[number][] },
  ): Promise<ToolCallResult<PeerComparison>> {
    const traceId = opts.traceId ?? newTraceId();
    const tr = new TraceCollector(traceId, DEFAULT_DATA_VERSION);
    const window = resolveWindow(input);
    const baseline = shiftWindow(window, -7);
    const warnings: string[] = [];

    tr.push("tool_call", { tool: "compare_peers", input: { ...input, window } });

    const sid = input.store_id;
    if (!sid || !profiles.has(sid)) {
      traceStore.set(traceId, tr.all());
      return wrap<PeerComparison>(
        "call_peers",
        null,
        [],
        [`compare_peers 需要有效的 store_id，收到：${sid ?? "空"}`],
        traceId,
        false,
      );
    }

    const { comparison, evidence } = comparePeers({
      storeId: sid,
      window,
      baselineWindow: baseline,
      rows: allRows,
      profiles,
      excludeFromPeers: [],
      metricCodes: input.metric_codes ?? DEFAULT_PEER_METRICS,
      dataVersion: DEFAULT_DATA_VERSION,
      traceId,
    });

    if (!comparison.peer_sufficient) {
      warnings.push(
        `可比门店 ${comparison.peer_store_ids.length} 家，少于要求的 ${comparison.min_peers_required} 家，` +
          `不出排名、不出确定性建议。被排除的门店：` +
          comparison.excluded.map((e) => `${e.store_id}（${e.reason}）`).join("；"),
      );
    }

    tr.push("tool_result", {
      tool: "compare_peers",
      output: {
        peer_count: comparison.peer_store_ids.length,
        ready_for_ranking: comparison.ready_for_ranking,
      },
    });
    traceStore.set(traceId, tr.all());

    return wrap(
      "call_peers",
      comparison,
      comparison.evidence_ids,
      warnings,
      traceId,
      true,
    );
  }

  // ============================================================
  // 工具 4: score_locations —— 区域评分（不改变状态）
  // ============================================================
  async function scoreLocationsTool(input: {
    grade?: string;
    weights_version?: string;
  }): Promise<ToolCallResult<LocationScore[]>> {
    const traceId = opts.traceId ?? newTraceId();
    const tr = new TraceCollector(traceId, DEFAULT_DATA_VERSION);
    const warnings: string[] = [];

    tr.push("tool_call", { tool: "score_locations", input });

    if (costInputs.length === 0) {
      traceStore.set(traceId, tr.all());
      return wrap<LocationScore[]>(
        "call_score",
        null,
        [],
        ["缺少成本输入数据（region_cost_input.csv），无法计算区域评分。"],
        traceId,
        false,
      );
    }

    const { scores, evidence } = scoreLocations({
      window: DEFAULT_WINDOW,
      baselineWindow: shiftWindow(DEFAULT_WINDOW, -7),
      rows: allRows,
      profiles,
      costInputs,
      dataVersion: DEFAULT_DATA_VERSION,
      traceId,
    });

    let out = scores;
    if (input.grade) out = out.filter((s) => s.grade === input.grade);

    const degraded = out.filter((s) => s.confidence !== "full");
    if (degraded.length) {
      warnings.push(
        `以下分组存在分项缺失，已按剩余权重重归一化并降低可信度：` +
          degraded.map((s) => `${s.region}${s.grade}(${s.confidence})`).join("、"),
      );
    }

    out = out.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));

    tr.push("tool_result", {
      tool: "score_locations",
      output: { count: out.length, top: out[0] ? `${out[0].region}${out[0].grade}` : null },
    });
    traceStore.set(traceId, tr.all());

    return wrap(
      "call_score",
      out,
      evidence.map((e) => e.evidence_id),
      warnings,
      traceId,
      true,
    );
  }

  return {
    getDashboard,
    getDashboardMetrics,
    runAudit,
    comparePeers: comparePeersTool,
    compareRegions,
    estimateRegionROI,
    scoreLocations: scoreLocationsTool,
    getTrace: (traceId: string) => traceStore.get(traceId) ?? [],
  };
}

export { deriveProfiles, DEFAULT_PEER_METRICS };
