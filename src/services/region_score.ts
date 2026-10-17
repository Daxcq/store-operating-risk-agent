/**
 * 区域评分与排名 (任务B)
 *
 * 职责：把「哪个区域值得投」变成一个可复盘的数字。
 *
 * 三条纪律：
 *   1. 权重和归一化基准必须来自 configs/scoring.yaml，不接受运行时传参，也不接受 LLM 指定。
 *      否则同一份数据今天算 72 分明天算 65 分，这个功能就没有可信度。
 *   2. 分项缺失时不让缺失值参与计算，按剩余权重重归一化，并降 confidence。
 *      直接拿 0 顶替缺失分项是错的 —— 0 分意味着"极差"，而不是"不知道"。
 *   3. 分数只用于排序。它不是投资结论，输出必须带 disclaimer。
 */

import type { LocationScore, ScoreComponent, Window, Evidence } from "../../contracts/b/index";
import type { RawRow } from "./data_loader";
import { sliceStore, median } from "./data_loader";
import { computeMetrics } from "./metric_service";
import type { StoreProfile } from "./benchmark_service";

/** 成本输入。来自 data/region_cost_input.csv，属外部数据适配器。 */
export interface CostInput {
  region: string;
  grade: string;
  monthly_rent_amount: number | null;
  monthly_labor_cost_amount: number | null;
  same_grade_store_count_within_radius: number | null;
}

/** 权重版本，必须随输出一起记录 */
export const WEIGHTS_VERSION = "demo_v1";

/** 权重表。与 configs/scoring.yaml 的 score.weights 对应。 */
const WEIGHTS = {
  demand_score: 0.35,
  competition_score: 0.25,
  margin_score: 0.25,
  cost_score: 0.15,
} as const;

/** 归一化范围，与 configs/scoring.yaml 一致 */
const RANGES = {
  same_grade_store_count_within_radius: { min: 1, max: 8 },
  /**
   * 月总成本（租金 + 人力）的 minmax 区间。
   *
   * yaml 里写的是 0~120000，那是「租金」的口径；这里归一化的对象是
   * 「租金 + 人力」，两者相加后 Demo 实际落在 6.8 万 ~ 21.4 万。
   * 照搬 0~120000 的话，除 C5（原丰台区）外每家都会顶到 100 分，
   * cost_score 变成常数，等于这一项白占 15% 权重却什么也没区分。
   * 区间上下界按 Demo 实际取值范围设定，改动必须同步 yaml 的注释。
   */
  total_cost: { min: 40000, max: 230000 },
  /**
   * 退款率（毛利代理口径）的 minmax 区间，单位百分点。
   *
   * 原来是 minmax(v, 0, max(10, v*2), true)，那个 max 依赖被归一化的值本身，
   * 于是任何 v > 5 的输入都被映射成同一个数（50），
   * 5.4% 和 6.6% 拿到一样的分数 —— 而这正是本 Demo 里唯一需要区分的区间。
   * 改成固定区间后，退款率每变动 1 个百分点，分数就真的变动 12.5 分。
   */
  refund_rate_as_margin_proxy: { min: 0, max: 8 },
} as const;

/** 推荐阈值，与 configs/scoring.yaml 一致 */
const THRESHOLDS = { recommend: 65, watch: 45 } as const;

/**
 * ROI 估算假设，与 configs/scoring.yaml 的 roi 段一一对应。
 *
 * 这里刻意不做成运行时参数：ROI 是唯一带商业假设的输出，
 * 一旦可以从外部传参，同一份数据就能算出两个回本周期，这个数就没人信了。
 * 要改假设，改 yaml 和这里，两处必须同步（D 的测试会卡这一点）。
 */
const ROI = {
  version: "demo_v1",
  /** 商品毛利率假设 */
  grossMarginRatio: 0.30,
  /** 单台设备一次性投入（设备 + 安装 + 首批铺货），人民币 */
  capexPerDevice: 32000,
  /** 折旧年限，仅用于展示口径 */
  depreciationYears: 5,
  /** 人力按租金的固定比例估算（无人零售人力主要在补货与运维） */
  laborCostRatioToRent: 0.35,
  /** 7 天窗口折算成月的天数 */
  daysPerMonth: 30.44,
} as const;

/** 解析成本 CSV。空值是 null，不是 0。 */
export function parseCostCsv(text: string): CostInput[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const num = (v: string | undefined): number | null => {
    if (v === undefined || v.trim() === "") return null;
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  };
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const g = (k: string) => {
      const i = header.indexOf(k);
      return i === -1 ? undefined : cells[i];
    };
    return {
      region: (g("region") ?? "").trim(),
      grade: (g("grade") ?? "").trim(),
      monthly_rent_amount: num(g("monthly_rent_amount")),
      monthly_labor_cost_amount: num(g("monthly_labor_cost_amount")),
      same_grade_store_count_within_radius: num(g("same_grade_store_count_within_radius")),
    };
  });
}

/** min-max 归一化到 0~100 */
function minmax(v: number | null, min: number, max: number, lowerIsBetter: boolean): number | null {
  if (v === null) return null;
  if (max <= min) return null;
  const clamped = Math.min(Math.max(v, min), max);
  const n = ((clamped - min) / (max - min)) * 100;
  return lowerIsBetter ? 100 - n : n;
}

/** 百分位归一化：在该分组内本值的百分位（0~100） */
function percentileRank(values: (number | null)[], v: number | null): number | null {
  const nums = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (v === null || nums.length < 2) return null;
  const below = nums.filter((x) => x < v).length;
  const equal = nums.filter((x) => x === v).length;
  // 用平均秩处理并列
  return Number((((below + equal / 2) / nums.length) * 100).toFixed(2));
}

/** ROI 估算的输入。全部允许 null —— 缺数据时要能说出缺哪一项，而不是回退成 0。 */
export interface RegionROIInput {
  /**
   * 窗口内的**日均**销售额。
   *
   * 【2026-10-17 修正】这个字段原先叫 salesMedian，注释写「窗口内销售额中位数」，
   * 于是 computeRegionROI 里又除了一个 windowDays 想把它折成日均 ——
   * 但传进来的本来就是「逐日中位数的中位数」，单位已经是元/天。
   * 7 天窗口被除了两次，月销售额被低估 7 倍（乘 4.35 而不是 30.44），
   * 结果是每个区域都算出亏损、回本周期全是 null。
   * 字段名现在直接写明单位，让这种二次折算在类型层就说不过去。
   */
  dailySales: number | null;
  /**
   * 窗口内实际覆盖的天数。**只用于数据充分性说明，不参与折算**
   * —— 折算靠 ROI.daysPerMonth，不是靠窗口长度。
   */
  coveredDays: number;
  /** 该区域该业态的设备台数，用于算总投入 */
  deviceCount: number | null;
  /** 月租金。null = 数据缺失 */
  rent: number | null;
  /** 月人力。null = 数据缺失，此时按租金比例估算 */
  labor: number | null;
}

export interface RegionROI {
  /** 预估月利润。可以是负数（亏损要如实为负），null 表示算不出来 */
  monthlyProfit: number | null;
  /** 预估回本周期（月）。月利润 <= 0 或投入缺失时为 null */
  paybackMonths: number | null;
  reasons: string[];
  assumptions: string[];
}

/**
 * 区域 ROI 估算。
 *
 * 抽成独立函数是因为它有两个入口：区域评分的批量打分，
 * 和 API 契约里的 estimateRegionROI（单区域查询）。
 * 两处必须走同一份口径，否则界面上同一区域会出现两个回本周期。
 *
 * 这里有两种「空」要分清楚，是整个函数最难的地方：
 *   monthlyProfit === null  —— 算不出来（缺销售或缺成本）
 *   monthlyProfit < 0       —— 算出来了，而且是亏损。这个数必须留着，
 *                              不能被当成「没有值」抹掉。
 * 回本周期只有在前者之外、且利润为正时才有意义。
 * 利润为负时说「回本周期 -3.2 个月」看着精确，其实什么都不是；
 * 契约要求这种时候返回 null，不允许用 0 或负数凑数。
 */
export function computeRegionROI(input: RegionROIInput): RegionROI {
  const { dailySales, coveredDays, deviceCount, rent, labor } = input;

  const reasons: string[] = [];
  const assumptions: string[] = [
    `商品毛利率按 ${(ROI.grossMarginRatio * 100).toFixed(0)}% 估算（假设，非数据实测）`,
    `单台设备一次性投入按 ${ROI.capexPerDevice} 元估算（含设备、安装与首批铺货）`,
    `人力成本按租金的 ${(ROI.laborCostRatioToRent * 100).toFixed(0)}% 估算（无独立人力数据源）`,
    `日销售额按 ${ROI.daysPerMonth} 天/月折算为月度口径（窗口天数不参与折算）`,
    // 口径声明放在这里，是因为「中位数」发生在 aggregateRegionROI，而不是本函数。
    // 本函数算的是一家店；说成「本函数基于中位数」会让复盘的人以为它已经在做区域汇总。
    `本函数逐店估算：区域口径由调用方（aggregateRegionROI）对各门店结果取中位数，非全量门店加总`,
  ];

  const effectiveLabor = labor ?? (rent === null ? null : rent * ROI.laborCostRatioToRent);

  let monthlyProfit: number | null = null;

  if (dailySales === null || coveredDays === 0) {
    reasons.push("窗口销售数据缺失，无法估算月利润。");
  } else if (rent === null && effectiveLabor === null) {
    reasons.push("区域成本（租金与人力）缺失，无法估算月利润。");
  } else {
    // 入参已经是日均值，直接乘月天数。这里再除一次窗口天数就是重复折算，
    // 会把月销售额低估约 7 倍，并让所有区域都算成亏损。
    const monthlySales = dailySales * ROI.daysPerMonth;
    const grossProfit = monthlySales * ROI.grossMarginRatio;
    monthlyProfit = grossProfit - (rent ?? 0) - (effectiveLabor ?? 0);

    reasons.push(
      `按窗口日均销售 ${dailySales.toFixed(0)} 元（窗口实际覆盖 ${coveredDays} 天）折算，` +
        `月销售额约 ${monthlySales.toFixed(0)} 元；` +
        `毛利约 ${grossProfit.toFixed(0)} 元，扣除月租金 ${rent ?? 0} 元与人力 ${(effectiveLabor ?? 0).toFixed(0)} 元后，` +
        `月利润约 ${monthlyProfit.toFixed(0)} 元。`,
    );
    if (rent === null) reasons.push("租金数据缺失，该口径下按 0 计，利润估算偏高。");
  }

  let paybackMonths: number | null = null;
  if (monthlyProfit !== null && monthlyProfit > 0 && deviceCount) {
    paybackMonths = Number(((deviceCount * ROI.capexPerDevice) / monthlyProfit).toFixed(1));
    reasons.push(
      `按 ${deviceCount} 台设备、总投入约 ${deviceCount * ROI.capexPerDevice} 元计算，` +
        `预计 ${paybackMonths} 个月回本。`,
    );
  } else if (monthlyProfit !== null && monthlyProfit <= 0) {
    reasons.push("月利润不为正，回本周期在数学上无意义，返回 null 而不是负数或 0。");
  } else if (monthlyProfit === null) {
    reasons.push("月利润无法估算，回本周期同样无法给出。");
  } else {
    reasons.push("设备数量缺失，无法计算总投入与回本周期。");
  }

  return {
    monthlyProfit: monthlyProfit === null ? null : Number(monthlyProfit.toFixed(2)),
    paybackMonths,
    reasons,
    assumptions,
  };
}

/** ROI 假设参数，供 evidence 快照与报告展示使用 */
export const ROI_ASSUMPTIONS = ROI;

/** 单个门店的 ROI 估算结果，除利润与回本周期外带上中位数所需的成本明细 */
export interface StoreROI extends RegionROI {
  store_id: string;
  region: string;
  grade: string;
  device_count: number;
}

/** 算不出月利润的门店，连同它属于哪个区域一起记下来，便于区域口径剔除并说明 */
export interface UnestimableStore {
  store_id: string;
  region: string;
  grade: string;
  detail: string;
}

/**
 * 逐门店估算，再按区域汇总。
 *
 * 为什么不在区域-业态这一层直接估算：契约里 RegionResult.estimatedMonthlyProfit
 * 是「必填的 number」。用组中位数去估，组里只要缺一天销售数据或者缺成本，
 * 整组就变成 null，而这个字段不接受 null —— 适配层就只能在「抛错」和
 * 「拿 0 冒充」之间选，两个都不能接受。
 *
 * 改成逐门店之后，「某家店算不出来」只会让那一家退出中位数，
 * 不会让整个区域失去估算值。这也更符合业务口径：
 * 区域特征本来就是「典型门店长什么样」，中位数门店的利润比加总利润更能代表它。
 *
 * 【单位提醒】传给 computeRegionROI 的销售额是**日均值**（逐日销售额取中位数），
 * 不是窗口加总。窗口加总除以天数也能得到日均，但缺报的日子会让两者不等价，
 * 所以这里刻意用「逐日中位数」这条路，并且把 coveredDays 单独传下去只做说明用。
 */
export function computeStoreROIs(input: {
  rows: RawRow[];
  profiles: Map<string, StoreProfile>;
  costInputs: CostInput[];
  window: Window;
}): { stores: StoreROI[]; unestimable: UnestimableStore[] } {
  const { rows, profiles, costInputs, window } = input;

  const all = [...profiles.values()].sort((a, b) => a.store_id.localeCompare(b.store_id));
  const stores: StoreROI[] = [];
  const unestimable: UnestimableStore[] = [];

  for (const p of all) {
    const win = sliceStore(rows, p.store_id, window);
    const salesVals = win
      .map((r) => r.sales_amount)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const deviceVals = win
      .map((r) => r.device_count)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

    // device_count 是快照字段，同一门店窗口内应恒定，取最大而不是求和
    const deviceCount = deviceVals.length ? Math.max(...deviceVals) : null;
    const cost = costInputs.find((c) => c.region === p.region && c.grade === p.grade);

    const roi = computeRegionROI({
      // 逐日销售额的中位数 = 这家店「典型一天」的销售额，单位是元/天。
      // 直接把日销售额乘以 daysPerMonth 得到月销售额，不再除以窗口天数。
      dailySales: salesVals.length ? median(salesVals) : null,
      // 窗口实际覆盖的天数，而不是窗口名义长度：缺报的日子不该被算进日均
      coveredDays: salesVals.length,
      deviceCount,
      rent: cost?.monthly_rent_amount ?? null,
      labor: cost?.monthly_labor_cost_amount ?? null,
    });

    if (roi.monthlyProfit === null) {
      unestimable.push({
        store_id: p.store_id,
        region: p.region,
        grade: p.grade,
        detail: roi.reasons.join(" ") || "缺少销售或成本数据",
      });
      continue;
    }

    stores.push({
      ...roi,
      store_id: p.store_id,
      region: p.region,
      grade: p.grade,
      device_count: deviceCount ?? 0,
    });
  }

  return { stores, unestimable };
}

export interface RegionAggregate {
  region: string;
  /** 区域内可估算门店的中位数月利润。null = 该区域一家都算不出来 */
  monthlyProfit: number | null;
  /** 区域内可估算门店数 */
  estimatedStoreCount: number;
  /** 区域内门店总数（含算不出来的） */
  storeCount: number;
  deviceCount: number;
  paybackMonths: number | null;
  reasons: string[];
  assumptions: string[];
}

/**
 * 把逐门店估算汇总成区域口径。
 *
 * 中位数而不是加总：加总会被门店数量放大，5 家店的区域天然比 3 家店的区域
 * 「利润高」，这会让区域对比变成门店数量对比。中位数回答的是
 * 「这个区域的典型门店赚多少」，才是投放决策真正要问的。
 */
export function aggregateRegionROI(
  region: string,
  stores: StoreROI[],
  unestimable: UnestimableStore[] = [],
): RegionAggregate {
  const mine = stores.filter((s) => s.region === region);
  const dropped = unestimable.filter((u) => u.region === region);
  // 区域设备总数：只用于展示「这个区域一共有多少台设备」。
  // 它**不参与回本周期**——回本周期按逐门店各自投入算，见下面 perStorePayback。
  // 一旦有人把这里改成回本周期的分子，就会退回「门店越多回本越慢」的错误口径。
  const deviceCount = mine.reduce((a, s) => a + s.device_count, 0);
  const reasons: string[] = [];
  const assumptions = mine.length
    ? mine[0].assumptions
    : computeRegionROI({
        dailySales: null,
        coveredDays: 0,
        deviceCount: null,
        rent: null,
        labor: null,
      }).assumptions;

  const profits = mine.map((s) => s.monthlyProfit as number);
  const monthlyProfit = profits.length ? Number(median(profits).toFixed(2)) : null;

  if (monthlyProfit === null) {
    reasons.push(`${region} 内没有可估算的门店（销售或成本数据缺失），无法给出区域月利润。`);
  } else {
    reasons.push(
      `按 ${region} 内 ${profits.length} 家可估算门店的月利润中位数 ${monthlyProfit.toFixed(0)} 元作为区域口径（逐店估算，非区域加总）。`,
    );
  }
  if (dropped.length) {
    reasons.push(
      `${dropped.length} 家门店因数据缺失未纳入中位数：${dropped.map((d) => d.store_id).join("、")}。`,
    );
  }

  //
  // 回本周期取「逐门店回本周期」的中位数，不是「区域总投入 / 典型门店利润」。
  //
  // 【2026-10-17 修正】原来的写法把区域里所有门店的设备数加总当分子，
  // 却用中位数门店的利润当分母，两个口径不是同一件事：
  // 同样赚钱的两家店，5 家店区域的回本周期会比 3 家店区域长 67%，
  // 回本周期于是退化成了一次门店数量比较 —— 这正是本函数注释里说要避免的。
  // 正确的做法是每店各算各的（该店设备数 x 单台造价 / 该店月利润），再取中位数，
  // 得到的才是「这个区域的典型门店多久回本」。
  //
  const perStorePayback = mine
    .filter((s) => s.monthlyProfit !== null && (s.monthlyProfit as number) > 0 && s.device_count > 0)
    .map((s) => (s.device_count * ROI.capexPerDevice) / (s.monthlyProfit as number));

  const profitsPositive = mine.filter((s) => (s.monthlyProfit as number) > 0).length;

  let paybackMonths: number | null = null;
  if (perStorePayback.length > 0) {
    paybackMonths = Number(median(perStorePayback)!.toFixed(1));
    reasons.push(
      `逐门店计算回本周期后取中位数：${perStorePayback.length} 家可回本门店，` +
        `典型门店预计 ${paybackMonths} 个月回本（每店按自身设备数与自身月利润计算，不跨店加总投入）。`,
    );
    if (profitsPositive < mine.length) {
      reasons.push(
        `${mine.length - profitsPositive} 家门店月利润不为正，其回本周期在数学上无意义，已排除在中位数之外。`,
      );
    }
  } else if (monthlyProfit !== null && monthlyProfit <= 0) {
    reasons.push("区域典型门店月利润不为正，回本周期无意义，返回 null。");
  }

  return {
    region,
    monthlyProfit,
    estimatedStoreCount: profits.length,
    // 分母含被剔除的门店，否则「几家店被剔了」在界面上看不出来
    storeCount: mine.length + dropped.length,
    deviceCount,
    paybackMonths,
    reasons,
    assumptions,
  };
}

export interface ScoreInput {
  window: Window;
  baselineWindow: Window;
  rows: RawRow[];
  profiles: Map<string, StoreProfile>;
  costInputs: CostInput[];
  dataVersion: string;
  traceId: string;
}

/**
 * 计算所有区域的评分。
 * 排名是全局排名（跨区域），same_grade 的店在各自业态档口内做需求百分位。
 */
export function scoreLocations(input: ScoreInput): {
  scores: LocationScore[];
  evidence: Evidence[];
  /** 逐门店 ROI，随评分一并返回，避免调用方（pipeline）为汇总再算一遍 */
  roiStores: StoreROI[];
  roiUnestimable: UnestimableStore[];
} {
  const { window, baselineWindow, rows, profiles, costInputs, dataVersion, traceId } = input;

  const evidence: Evidence[] = [];

  // ---- 0. 逐门店 ROI 估算（第 5 步按区域取中位数用）----
  // 放在最前面是因为它只依赖原始行与成本表，跟后面的归一化无关，
  // 提前算完可以让第 5 步直接取用，不必在中途再回头读一遍全量数据。
  const { stores: roiStores, unestimable: roiUnestimable } = computeStoreROIs({
    rows,
    profiles,
    costInputs,
    window,
  });

  // ---- 1. 按 区域 x 业态 分组，先算各组的经营指标 ----
  const groups = new Map<string, string[]>(); // key -> store ids
  for (const [sid, p] of profiles) {
    const key = `${p.region}|${p.grade}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(sid);
  }

  interface GroupStat {
    key: string;
    region: string;
    grade: string;
    storeIds: string[];
    salesMedian: number | null;
    aovMedian: number | null;
    refundRateMedian: number | null;
    /** 该组的设备总数，ROI 估算用 */
    deviceCount: number | null;
    /** 7 天窗口内的实际天数，折算月销售额用 */
    windowDays: number;
  }

  const stats: GroupStat[] = [];
  for (const [key, storeIds] of groups) {
    const [region, grade] = key.split("|");
    const salesVals: (number | null)[] = [];
    const aovVals: (number | null)[] = [];
    const refundVals: (number | null)[] = [];
    const deviceVals: (number | null)[] = [];
    let windowDays = 0;

    for (const sid of storeIds) {
      const curRows = sliceStore(rows, sid, window);
      const res = computeMetrics(
        curRows,
        sliceStore(rows, sid, baselineWindow),
        { storeId: sid, region, grade, window, baselineWindow, dataVersion, traceId },
      ).results;
      salesVals.push(res.find((m) => m.metric_code === "sales_amount")?.value ?? null);
      aovVals.push(res.find((m) => m.metric_code === "aov")?.value ?? null);
      refundVals.push(res.find((m) => m.metric_code === "refund_rate")?.value ?? null);
      // 设备数取窗口内的最大值：device_count 是快照字段，不随天数累加
      const devs = curRows
        .map((r) => r.device_count)
        .filter((v): v is number => typeof v === "number");
      deviceVals.push(devs.length ? Math.max(...devs) : null);
      windowDays = Math.max(windowDays, curRows.length);
    }

    stats.push({
      key,
      region,
      grade,
      storeIds,
      salesMedian: median(salesVals),
      aovMedian: median(aovVals),
      refundRateMedian: median(refundVals),
      // 该组设备总数。只要有任意一家店报得出设备数就求和，全缺则为 null。
      deviceCount: deviceVals.some((v) => v !== null)
        ? deviceVals.reduce((a, b) => a + (b ?? 0), 0)
        : null,
      windowDays,
    });
  }

  // ---- 2. 逐个 区域x业态 算分 ----
  const scores: LocationScore[] = [];

  for (const s of stats) {
    const cost = costInputs.find((c) => c.region === s.region && c.grade === s.grade);
    const components: ScoreComponent[] = [];

    // --- demand_score：同业态档口内的销售百分位 ---
    const demand = percentileRank(
      stats.filter((x) => x.grade === s.grade).map((x) => x.salesMedian),
      s.salesMedian,
    );
    components.push({
      code: "demand_score",
      display_name: "需求强度",
      value: demand,
      weight: WEIGHTS.demand_score,
      contribution: null,
      inputs_snapshot: { sales_amount_median: s.salesMedian, aov_median: s.aovMedian },
      evidence_id: `ev_score_demand_${s.region}_${s.grade}`,
    });

    // --- competition_score：同档口密度，越低越好 ---
    const competition = minmax(
      cost?.same_grade_store_count_within_radius ?? null,
      RANGES.same_grade_store_count_within_radius.min,
      RANGES.same_grade_store_count_within_radius.max,
      true,
    );
    components.push({
      code: "competition_score",
      display_name: "竞争压力",
      value: competition,
      weight: WEIGHTS.competition_score,
      contribution: null,
      inputs_snapshot: {
        same_grade_store_count_within_radius: cost?.same_grade_store_count_within_radius ?? null,
      },
      evidence_id: `ev_score_competition_${s.region}_${s.grade}`,
    });

    // --- margin_score：以「退款率越低毛利越好」代理，成本数据缺失时退回 null ---
    // 注意：这里用的是代理指标。真实毛利需要商品成本数据，Demo 没有，
    // 所以必须标明这是代理口径，报告里不能把它说成真实毛利率。
    const margin =
      cost && (cost.monthly_rent_amount === null || cost.monthly_labor_cost_amount === null)
        ? null
        : minmax(
            s.refundRateMedian,
            RANGES.refund_rate_as_margin_proxy.min,
            RANGES.refund_rate_as_margin_proxy.max,
            true,
          );
    components.push({
      code: "margin_score",
      display_name: "毛利空间",
      value: margin,
      weight: WEIGHTS.margin_score,
      contribution: null,
      inputs_snapshot: {
        refund_rate_median: s.refundRateMedian,
        note: "Demo 以退款率作为毛利代理口径，非真实毛利",
      },
      evidence_id: `ev_score_margin_${s.region}_${s.grade}`,
    });

    // --- cost_score：租金 + 人力。这里取的是「成本负担」而不是「成本表现」---
    //
    // 【2026-10-17 修正】分子分母要按同一个方向解释，之前这里错了两次叠加：
    //   minmax(..., lowerIsBetter=true) 已经让最便宜的区域拿到 100，
    //   下方加权求和时又把这一项「减去」，最便宜的区域于是被罚得最重，
    //   整个成本项的作用方向是反的。
    // 现在统一：cost_score 定义为**成本负担**，0 分 = 最便宜，100 分 = 最贵，
    // 因此它在总分里是**减项**（与 scoring.yaml 的 - w4*cost_score 一致）。
    // 这样「成本越低总分越高」是算出来的，不是靠方向取反凑出来的。
    const totalCost =
      cost && cost.monthly_rent_amount !== null && cost.monthly_labor_cost_amount !== null
        ? cost.monthly_rent_amount + cost.monthly_labor_cost_amount
        : null;
    const costBurden = minmax(totalCost, RANGES.total_cost.min, RANGES.total_cost.max, false);
    components.push({
      code: "cost_score",
      display_name: "运营成本",
      value: costBurden,
      weight: WEIGHTS.cost_score,
      contribution: null,
      inputs_snapshot: {
        total_cost: totalCost,
        rent: cost?.monthly_rent_amount ?? null,
        labor: cost?.monthly_labor_cost_amount ?? null,
        direction: "0=成本最低，100=成本最高；该分项在总分中作减项",
      },
      evidence_id: `ev_score_cost_${s.region}_${s.grade}`,
    });

    // ---- 3. 加权求和。缺失分项按剩余权重重归一化，不用 0 顶替 ----
    //
    // 【2026-10-17 修正】原来是 raw = 加项 - 减项，再 (raw + 100) / 2 映射回 0~100。
    // 那个映射把分数硬压成半尺度：加项满打满算 85、减项最多 15，
    // raw 的实际取值区间约 [-15, 85]，除以 2 之后所有区域都挤在 42~67 之间，
    // 于是 scoring.yaml 里的 recommend_threshold: 65 几乎不可能达到 ——
    // 阈值写在配置里，却因为分数被人为压缩而永远触发不了。
    //
    // 改成直接对分项做加权平均：四个分项都按 0~100 定义（cost_score 是负担，
    // 作减项），结果天然落在 0~100，阈值就是它字面上的意思。
    // 分母用 Σw = 1.0，所以四个分项齐全时分数 = Σ(w_i * value_i)。
    //
    // 【2026-10-17 修正：补回 available / availableWeight 的定义】
    // 下面的加权求和引用了 available 与 availableWeight，但这两个变量
    // 在本文件里从未声明 —— 走到这里会直接抛 ReferenceError，
    // scoreLocations 一行都跑不完，区域评分/区域对比/区域 ROI 全部不可用。
    //
    // 语义按上面那段注释的原意补：**只有算得出值的分项参与**，
    // 分母是这些分项的实际权重之和，而不是写死的 Σw = 1.0。
    // 这样某个分项缺失时（例如成本表里查不到该区域该档次）分数是
    // 「按剩余权重重归一化」的结果，而不是被缺失项悄悄拉低 ——
    // 用 0 顶替缺失分项会让一个数据缺失的区域看起来像最差的区域。
    // 同时把 confidence 的档位（全分项 / ≥2 项 / 更少）挂在这同一个 available 上，
    // 保证「可信度」和「实际参与计算的分项数」说的是同一件事。
    const available = components.filter(
      (c): c is ScoreComponent & { value: number } => c.value !== null,
    );
    const availableWeight = available.reduce((acc, c) => acc + c.weight, 0);

    let score: number | null = null;
    let confidence: LocationScore["confidence"];

    if (availableWeight > 0) {
      const raw = available.reduce((acc, c) => {
        const w = c.weight / availableWeight;
        const term = c.value! * w;
        // cost_score 是成本负担，在总分里作减项，其余三项作加项
        return c.code === "cost_score" ? acc - term : acc + term;
      }, 0);
      score = Number(Math.min(100, Math.max(0, raw)).toFixed(2));
    }

    if (available.length === components.length) confidence = "full";
    else if (available.length >= 2) confidence = "degraded";
    else confidence = "low";

    if (score === null) confidence = "low";

    // contribution 必须带符号，且与上面进入总分的符号一致，
    // 否则「各分项贡献之和 = 总分」这个可复盘性要求就不成立
    //（原来 cost 项在总分里被减掉，contribution 却是正的，四项加起来对不上分数）。
    for (const c of components) {
      c.contribution =
        score === null || c.value === null || availableWeight === 0
          ? null
          : Number(
              (((c.code === "cost_score" ? -1 : 1) * c.value * c.weight) / availableWeight).toFixed(
                2,
              ),
            );
    }

    const recommendation: LocationScore["recommendation"] =
      score === null
        ? "数据不足"
        : confidence === "low"
          ? "数据不足"
          : score >= THRESHOLDS.recommend
            ? "推荐"
            : score >= THRESHOLDS.watch
              ? "继续调研"
              : "不建议";

    const eid = `ev_score_${s.region}_${s.grade}_${window.from.replace(/-/g, "")}`;
    evidence.push({
      evidence_id: eid,
      kind: "score",
      summary:
        `${s.region}${s.grade} 综合得分 ${score ?? "无法计算"}（可信度 ${confidence}），` +
        `建议：${recommendation}。门店数 ${s.storeIds.length}，窗口 ${window.from}~${window.to}。`,
      inputs: {
        weights: WEIGHTS,
        weights_version: WEIGHTS_VERSION,
        components: components.map((c) => ({ code: c.code, value: c.value, weight: c.weight })),
        store_ids: s.storeIds,
        window,
      },
      formula:
        "score = (w1*demand + w2*competition + w3*margin - w4*cost) / (w1+w2+w3+w4)，" +
        "各分项均为 0~100；cost_score 为成本负担（0=最低成本），作减项；" +
        "分项缺失时按剩余权重重归一化，缺项不计 0 分",
      store_id: undefined,
      window,
      data_version: dataVersion,
      trace_id: traceId,
      created_at: new Date().toISOString(),
    });

    scores.push({
      region: s.region,
      grade: s.grade,
      score,
      confidence,
      components,
      rank: null, // 下一步统一排名
      store_count: s.storeIds.length,
      // ROI 四项先占位，第 5 步统一填充。占位用 null 而不是 0：
      // 0 是一个合法的利润数字，用它表示"还没算"会让下游分不清。
      estimated_monthly_profit: null,
      estimated_payback_months: null,
      reasons: [],
      assumptions: [],
      recommendation,
      weights_version: WEIGHTS_VERSION,
      disclaimer:
        "评分基于当前可比数据集与当前权重版本，仅用于排序与继续调研的优先级参考，不构成投资建议。",
      evidence_ids: [eid],
      data_version: dataVersion,
      trace_id: traceId,
    });
  }

  // ---- 4. 排名。门店数不足的组不参与排名，避免用 1 家店的名次冒充结论 ----
  const rankable = scores.filter((s) => s.score !== null && s.store_count >= 2);
  rankable.sort((a, b) => b.score! - a.score!);
  rankable.forEach((s, i) => {
    s.rank = i + 1;
  });

  //
  //
  // ---- 5. ROI 估算（月度利润与回本周期）----
  //
  // 这一段的输出全部是**估算**，不是从数据里读出来的事实。
  // 所以每条都必须带 reasons（怎么算的）与 assumptions（假设了什么），
  // 并且严格区分两种「没有」：
  //   月利润 = null  ->  成本数据缺失，算不出来
  //   月利润为负数   ->  算出来了，是亏损（这是有用的信息，不能抹掉）
  // 回本周期在月利润 <= 0 时必须是 null：负利润下"回本"在数学上无解，
  // 硬算出来的是一个负数月份，看起来像个精确的数字，实际毫无意义。
  //
  // 【口径来源】这里不再自己按「区域-业态组的中位数」估一遍，
  // 而是复用 computeStoreROIs 的逐门店估算再取中位数（见 aggregateRegionROI）。
  // 原因是同一份数据里绝不能出现两个回本周期：区域对比页是按门店估的，
  // 评分页如果按组中位数估，两边只要有一家店缺成本就会给出不同的数，
  // 而这种不一致在界面上完全看不出来。
  //
  // 【已知的口径边界，必须让下游看见】
  // 上面三个分项（需求/竞争/毛利）是「区域 x 业态」粒度，而 ROI 是「区域」粒度：
  // aggregateRegionROI 收录的是该区域**所有业态**可估算门店的中位数。
  // 这不是疏忽，是因为契约里的 RegionResult.estimatedMonthlyProfit 是区域级字段，
  // 若此处改成按业态估，同一个区域就会出现两个回本周期，正是本节要避免的。
  // 代价是：当某区域同时存在 standard 与 compact 门店时，
  // 该区域两个业态的评分行会带上同一个区域级 ROI。
  // Demo 数据里尚未出现这种区域（只有 C3 即原西城区是 compact，其余四区均为 standard），
  // 真要跨业态比较成本时，应改用 estimateRegionROI 并显式带业态参数。
  //
  const roiByRegion = new Map<string, RegionAggregate>();
  for (const s of scores) {
    if (roiByRegion.has(s.region)) continue;
    roiByRegion.set(s.region, aggregateRegionROI(s.region, roiStores, roiUnestimable));
  }

  for (const s of scores) {
    const stat = stats.find((x) => x.region === s.region && x.grade === s.grade);
    const cost = costInputs.find((c) => c.region === s.region && c.grade === s.grade);
    const eid = `ev_roi_${s.region}_${s.grade}_${window.from.replace(/-/g, "")}`;

    const agg = roiByRegion.get(s.region)!;

    s.estimated_monthly_profit = agg.monthlyProfit;
    s.estimated_payback_months = agg.paybackMonths;
    s.reasons = agg.reasons;
    s.assumptions = agg.assumptions;
    s.evidence_ids.push(eid);

    evidence.push({
      evidence_id: eid,
      kind: "score",
      summary:
        `${s.region}${s.grade} 预估月利润 ` +
        `${agg.monthlyProfit === null ? "无法估算" : `${agg.monthlyProfit.toFixed(0)} 元`}，` +
        `回本周期 ${agg.paybackMonths === null ? "无法估算（利润不为正或成本缺失）" : `${agg.paybackMonths} 个月`}。` +
        `假设：毛利率 ${(ROI.grossMarginRatio * 100).toFixed(0)}%、单台设备 ${ROI.capexPerDevice} 元。`,
      inputs: {
        // 注意这个字段和 ROI 口径无关：它是「7 天窗口内的销售额加总，逐店取中位数」，
        // 给需求强度百分位用的快照。ROI 用的是另一套输入（逐店日均销售额），
        // 字段名保留 group_ 前缀就是为了不让两者看起来像同一个东西。
        group_sales_median_7d: stat?.salesMedian ?? null,
        group_window_days: stat?.windowDays ?? 0,
        rent: cost?.monthly_rent_amount ?? null,
        labor: cost?.monthly_labor_cost_amount ?? null,
        device_count: agg.deviceCount,
        estimated_store_count: agg.estimatedStoreCount,
        unestimable_stores: roiUnestimable
          .filter((u) => u.region === s.region)
          .map((u) => u.store_id),
        roi_assumptions: ROI,
      },
      formula:
        "单店月利润 = 该店窗口日均销售额 * 30.44 * 毛利率 - 月租金 - 人力；" +
        "区域月利润 = 各门店月利润的中位数；" +
        "区域回本周期 = median(各店「该店设备数 * 单台造价 / 该店月利润」)，" +
        "负利润门店不参与该中位数，无正利润门店时返回 null（不跨店加总投入）",
      window,
      data_version: dataVersion,
      trace_id: traceId,
      created_at: new Date().toISOString(),
    });
  }

  return { scores, evidence, roiStores, roiUnestimable };
}

/** 按区域汇总评分（同一区域下多业态取加权平均） */
export function summarizeByRegion(scores: LocationScore[]): LocationScore[] {
  return scores.sort((a, b) => {
    if (a.rank === null && b.rank === null) return a.region.localeCompare(b.region);
    if (a.rank === null) return 1;
    if (b.rank === null) return -1;
    return a.rank - b.rank;
  });
}
