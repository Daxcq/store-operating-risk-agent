/**
 * 指标计算 (任务B)
 *
 * 职责：把干净的行变成 MetricResult，并顺手产出 Evidence。
 * 不判断异常，不解释原因 —— 那是 rule_engine 和老 Agent 的事。
 *
 * 口径纪律（PROJECT.md 3.2）：
 *   - 先 SUM 聚合，再算比率。绝对不允许「每日比率求平均」。
 *   - 每个除法走 safeRatio，分母为 0 返回 null + unavailable，不返回 0。
 *   - 销售变化率如果只报一个数，会被追问是"订单少了"还是"单价低了"，
 *     所以这里始终同时产出 order_change_pct 和 aov_change_pct，供报告做二因素拆解。
 */

import type {
  MetricCode,
  ChangeCode,
  MetricResult,
  MetricStatus,
  MetricUnit,
  Window,
  Evidence,
} from "../../contracts/b/index.ts";
import type { RawRow } from "./data_loader.ts";
import {
  sumField,
  safeRatio,
  safeChangePct,
  safeChangePoints,
  assessQuality,
  shiftWindow,
} from "./data_loader.ts";

/** 指标定义表。与 configs/metrics.yaml 对应，代码里只放计算所需的部分。 */
const METRIC_DEFS: {
  code: MetricCode;
  unit: MetricUnit;
  precision: number;
  label: string;
  /** 计算函数。返回 null 表示算不出来。 */
  compute: (rows: RawRow[]) => number | null;
}[] = [
  {
    code: "sales_amount",
    unit: "currency",
    precision: 2,
    label: "销售金额",
    compute: (r) => sumField(r, "sales_amount"),
  },
  {
    code: "order_count",
    unit: "count",
    precision: 0,
    label: "有效订单数",
    compute: (r) => sumField(r, "order_count"),
  },
  {
    code: "refund_amount",
    unit: "currency",
    precision: 2,
    label: "退款金额",
    compute: (r) => sumField(r, "refund_amount"),
  },
  {
    code: "refund_rate",
    unit: "percent",
    precision: 2,
    label: "退款率",
    // 先聚合再算比率：SUM(退款) / SUM(销售) * 100
    compute: (r) => safeRatio(sumField(r, "refund_amount"), sumField(r, "sales_amount"), 100),
  },
  {
    code: "refund_order_rate",
    unit: "percent",
    precision: 2,
    label: "退款单率",
    compute: (r) =>
      safeRatio(sumField(r, "refund_order_count"), sumField(r, "order_count"), 100),
  },
  {
    code: "aov",
    unit: "currency",
    precision: 2,
    label: "客单价",
    compute: (r) => safeRatio(sumField(r, "sales_amount"), sumField(r, "order_count"), 1),
  },
  {
    code: "online_rate",
    unit: "percent",
    precision: 2,
    label: "在线率",
    compute: (r) =>
      safeRatio(sumField(r, "online_device_count"), sumField(r, "device_count"), 100),
  },
  {
    code: "inventory_diff_amount",
    unit: "currency",
    precision: 2,
    label: "盘点差异金额",
    compute: (r) => sumField(r, "inventory_diff_amount"),
  },
];

/** 哪些指标是比率型（变化率用百分点而不是百分比） */
const RATIO_METRICS: ReadonlySet<string> = new Set([
  "refund_rate",
  "refund_order_rate",
  "online_rate",
]);

export interface ComputeContext {
  storeId?: string;
  region?: string;
  grade?: string;
  window: Window;
  /**
   * 【2026-10-17 修正：补回 dataVersion / traceId】
   * 本文件下面每一处 Evidence 都写了 data_version: ctx.dataVersion、
   * trace_id: ctx.traceId，MetricResult 也照抄这两项，但这个接口原先
   * 根本没声明它们 —— 属性访问在 TS 里会直接报错；即便靠 as any 绕过，
   * 运行时拿到的也是 undefined，于是「每个数字都能沿 evidence_id ->
   * trace_id 追回它所属的那次计算」这条硬规则在所有指标证据上同时失效，
   * 而且是静默失效：字段存在、类型看着对、值永远是 undefined。
   * 设为可选是为了不打断既有调用方，但 pipeline 的每一处调用都已显式传入。
   */
  dataVersion?: string;
  traceId?: string;
  /**
   * 基准窗口。**必须由调用方传入**，与它实际切片 baseRows 用的窗口是同一个。
   *
   * 【2026-10-17 修正】原先这里没有这个字段，代码里三处写死 shiftWindow(ctx.window, -7)。
   * 只要调用方传进来的 baseRows 不是「前 7 天」，算出来的数值和标称的基准窗口就对不上：
   * getDashboardMetrics 传的是等长前一段（shiftWindow(window, -dayCount)），
   * 窗口不是 7 天时，evidence 里记的基准日期与实际取数日期不一致 ——
   * 数字本身是对的，但它挂在错误的日期上，复盘时会被当成另一组数。
   *
   * 不传时按历史习惯退回「前 7 天」。保留这个默认值是为了不破坏已有调用，
   * 但新代码应当显式传，让「标称窗口 = 实际取数窗口」在类型上就成立。
   */
  baselineWindow?: Window;
}

/** 确定性 evidence_id：同样的输入永远得到同样的 ID，便于对拍与回放。 */
function mkEvidenceId(kind: string, code: string, scope: string, from: string): string {
  return `ev_${kind}_${code}_${scope}_${from.replace(/-/g, "")}`;
}

function scopeKey(ctx: ComputeContext): string {
  return ctx.storeId ?? ctx.region ?? "all";
}

function round(v: number | null, precision: number): number | null {
  if (v === null) return null;
  const p = Math.pow(10, precision);
  return Math.round(v * p) / p;
}

/**
 * 计算单个作用域下的一整套指标。
 *
 * @param rows   该作用域在「当前窗口」内的原始行（已切片）
 * @param baseRows 同一作用域在「基准窗口」内的原始行，用来算变化率
 */
export function computeMetrics(
  rows: RawRow[],
  baseRows: RawRow[],
  ctx: ComputeContext,
): { results: MetricResult[]; evidence: Evidence[] } {
  const results: MetricResult[] = [];
  const evidence: Evidence[] = [];
  const scope = scopeKey(ctx);
  // 基准窗口只在这里解析一次，下面所有标注都复用它，
  // 免得多处各写一遍 shiftWindow(...) 后彼此漂移
  const baselineWindow = ctx.baselineWindow ?? shiftWindow(ctx.window, -7);
  const quality = assessQuality(rows, ctx.window);
  const baseQuality = assessQuality(baseRows, baselineWindow);

  //
  // 1. 水平值
  //
  const level = new Map<MetricCode, number | null>();
  for (const def of METRIC_DEFS) {
    let value: number | null = null;
    let status: MetricStatus = quality.status === "unavailable" ? "unavailable" : "ok";

    try {
      value = round(def.compute(rows), def.precision);
    } catch {
      value = null;
      status = "unavailable";
    }

    // 算不出值就是 unavailable；能算但窗口天数不足则降级为 insufficient
    if (value === null) {
      status = "unavailable";
    } else if (quality.status !== "unavailable" && quality.valid_days < quality.calendar_days) {
      status = baseQuality.status === "unavailable" ? "insufficient" : status;
    }

    level.set(def.code, value);

    const eid = mkEvidenceId("metric", def.code, scope, ctx.window.from);
    evidence.push({
      evidence_id: eid,
      kind: "metric",
      summary: `${scope} ${def.label} = ${value === null ? "无法计算（数据缺失）" : value}`,
      inputs: {
        window: ctx.window,
        valid_days: quality.valid_days,
        null_ratio: quality.null_ratio,
      },
      formula:
        def.code === "refund_rate"
          ? "SUM(refund_amount) / SUM(sales_amount) * 100"
          : def.code === "aov"
            ? "SUM(sales_amount) / SUM(order_count)"
            : undefined,
      metric_code: def.code,
      store_id: ctx.storeId,
      window: ctx.window,
      data_version: ctx.dataVersion,
      trace_id: ctx.traceId,
      created_at: new Date().toISOString(),
    });

    results.push({
      metric_code: def.code,
      value,
      unit: def.unit,
      status,
      scope: { store_id: ctx.storeId, region: ctx.region, grade: ctx.grade },
      window: ctx.window,
      valid_days: quality.valid_days,
      null_ratio: quality.null_ratio,
      evidence_ids: [eid],
      data_version: ctx.dataVersion,
      trace_id: ctx.traceId,
    });
  }

  //
  // 2. 变化率
  //
  // 基准窗口取不到时降级为前一自然周，并打标，让报告能说明"对比基准不理想"
  const hasBaseline = baseRows.length > 0 && baseQuality.valid_days >= 1;

  const changeDefs: {
    code: ChangeCode;
    basedOn: MetricCode;
    label: string;
    asPoints: boolean;
  }[] = [
    { code: "sales_change_pct", basedOn: "sales_amount", label: "销售变化", asPoints: false },
    { code: "order_change_pct", basedOn: "order_count", label: "订单数变化", asPoints: false },
    {
      code: "refund_rate_change_pct",
      basedOn: "refund_rate",
      label: "退款率变化",
      asPoints: true,
    },
    { code: "aov_change_pct", basedOn: "aov", label: "客单价变化", asPoints: false },
    {
      code: "online_rate_change_pct",
      basedOn: "online_rate",
      label: "在线率变化",
      asPoints: true,
    },
  ];

  for (const cd of changeDefs) {
    const def = METRIC_DEFS.find((d) => d.code === cd.basedOn)!;
    const cur = level.get(cd.basedOn) ?? null;

    let baseVal: number | null = null;
    try {
      baseVal = round(def.compute(baseRows), def.precision);
    } catch {
      baseVal = null;
    }

    const usePoints = cd.asPoints || RATIO_METRICS.has(cd.basedOn);
    const value = usePoints ? safeChangePoints(cur, baseVal) : round(safeChangePct(cur, baseVal), 2);

    let status: MetricStatus = "ok";
    if (value === null) status = "unavailable";
    else if (!hasBaseline) status = "insufficient";

    const eid = mkEvidenceId("metric", cd.code, scope, ctx.window.from);
    evidence.push({
      evidence_id: eid,
      kind: "metric",
      summary:
        `${scope} ${cd.label} = ${value === null ? "无法计算" : `${value}${usePoints ? " 百分点" : "%"}`}` +
        `（当前 ${cur ?? "缺失"} vs 基准 ${baseVal ?? "缺失"}）`,
      inputs: {
        current: cur,
        baseline: baseVal,
        baseline_window: baselineWindow,
      },
      formula: usePoints ? "current - baseline" : "(current - baseline) / |baseline| * 100",
      metric_code: cd.code,
      store_id: ctx.storeId,
      window: ctx.window,
      data_version: ctx.dataVersion,
      trace_id: ctx.traceId,
      created_at: new Date().toISOString(),
    });

    results.push({
      metric_code: cd.code,
      value,
      unit: usePoints ? "percent_point" : "percent",
      status,
      scope: { store_id: ctx.storeId, region: ctx.region, grade: ctx.grade },
      window: ctx.window,
      baseline_window: baselineWindow,
      valid_days: quality.valid_days,
      null_ratio: quality.null_ratio,
      baseline_fallback: !hasBaseline,
      evidence_ids: [eid],
      data_version: ctx.dataVersion,
      trace_id: ctx.traceId,
    });
  }

  return { results, evidence };
}

/** 便捷取值。rule_engine 用它按 code 读结果，避免到处写 find。 */
export function pick(results: MetricResult[], code: MetricCode | ChangeCode): MetricResult | undefined {
  return results.find((r) => r.metric_code === code);
}

/**
 * 销售变化的二因素拆解：把金额变化拆成「订单数效应」和「客单价效应」。
 * 这是报告里"为什么变了"的第一层回答，但也只是拆解，不是归因 ——
 * 谁导致的订单数下降，仍需人工核查，禁止直接下结论。
 *
 * 【2026-10-17 修正】原来的实现是 (orderChg/100)*100，也就是把入参原样返回，
 * 两项加起来 (orderChg + aovChg) 并不等于销售变化 —— 一个叫「拆解」的函数
 * 给出的两个数加起来对不上被拆解的那个量，报告里一旦并列展示就会露馅。
 *
 * 现在的口径：设 o = 订单数变化率、a = 客单价变化率（均为小数），则
 *   销售额变化率 = (1+o)(1+a) - 1 = o + a + o*a
 * 交叉项 o*a 不属于任何单一因素，按各半对称分摊：
 *   订单数效应 = o + o*a/2
 *   客单价效应 = a + o*a/2
 * 两者之和恒等于 o + a + o*a，即**恒等于销售变化率**（与 sales_change_pct 一致，
 * 前提是三个指标都算得出来；有一个为 null 时本函数直接返回 null 不做凑数）。
 * 这是数学分解，不是归因：它只说"变化有多少来自单量、多少来自单价"，
 * 不解释为什么单量会变。
 */
export function decomposeSalesChange(results: MetricResult[]): {
  order_effect_pct: number | null;
  aov_effect_pct: number | null;
  /** 两项之和，应当等于 sales_change_pct；不等说明三个指标口径不一致，必须查 */
  total_effect_pct: number | null;
  note: string;
} {
  const orderChg = pick(results, "order_change_pct")?.value ?? null;
  const aovChg = pick(results, "aov_change_pct")?.value ?? null;
  const salesChg = pick(results, "sales_change_pct")?.value ?? null;

  if (orderChg === null || aovChg === null) {
    return {
      order_effect_pct: null,
      aov_effect_pct: null,
      total_effect_pct: null,
      note: "订单数或客单价缺失，无法拆解销售变化。该店此部分只呈现销售变化本身。",
    };
  }

  const o = orderChg / 100;
  const a = aovChg / 100;
  const cross = 0.5 * o * a;

  const orderEffect = (o + cross) * 100;
  const aovEffect = (a + cross) * 100;
  const totalEffect = orderEffect + aovEffect;

  // 主导因素按「效应绝对值」判，而不是按原始变化率判：
  // 订单数 -3% 配客单价 -30% 时，主导的显然是客单价，但原始变化率
  // 一旦被交叉项放大就可能翻转判断，取效应值更稳妥。
  const dominant = Math.abs(orderEffect) >= Math.abs(aovEffect) ? "订单数" : "客单价";

  // 自检：分解之和与销售变化率对不上，就把话说清楚，不要假装一致。
  // 三者理论上恒等（都来自同一份 SUM），差异只可能来自精度取整。
  let check = "";
  if (salesChg !== null) {
    const gap = Math.abs(totalEffect - salesChg);
    check =
      gap <= 0.05
        ? `两项之和 ${totalEffect.toFixed(2)}% 与销售变化率 ${salesChg}% 一致。`
        : `注意：两项之和 ${totalEffect.toFixed(2)}% 与销售变化率 ${salesChg}% 相差 ${gap.toFixed(2)} 个百分点，需核查口径。`;
  }

  return {
    order_effect_pct: Number(orderEffect.toFixed(2)),
    aov_effect_pct: Number(aovEffect.toFixed(2)),
    total_effect_pct: Number(totalEffect.toFixed(2)),
    note:
      `销售变化主要由${dominant}变化贡献。` +
      `拆解口径：(1+订单数变化)x(1+客单价变化)-1，交叉项按各半分摊，两项之和等于销售变化率。${check}` +
      `此为数据拆解，具体原因需人工核查，不作为归因结论。`,
  };
}
