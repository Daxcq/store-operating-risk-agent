/**
 * 数据读取与校验 (任务B)
 *
 * 职责边界：只负责把 CSV 变成干净的内存表，并如实报告数据质量问题。
 * 不做任何业务判断，不算指标，不猜缺失值。
 *
 * 三条硬规则：
 *   1. 不填补缺失值。缺就是缺，补一个 0 出来会让下游把"没上报"读成"没退款"。
 *   2. 先聚合再算比率。比率绝不由每日比率平均而来（PROJECT.md 3.2）。
 *   3. 原始行不做覆盖或修正，只标记质量。审计现场要能回放原始数据。
 */

import type { Window, MetricStatus } from "../../contracts/b/index.ts";

/** 原始行。数值型字段用 number | null，null 表示未上报。 */
export interface RawRow {
  date: string;
  region: string;
  store_id: string;
  device_count: number | null;
  online_device_count: number | null;
  sales_amount: number | null;
  order_count: number | null;
  refund_amount: number | null;
  refund_order_count: number | null;
  inventory_diff_amount: number | null;
  data_version: string;
}

/** 关键字段，空值率按这些字段统计 */
const KEY_FIELDS = ["sales_amount", "order_count", "refund_amount"] as const;
type KeyField = (typeof KEY_FIELDS)[number];

export interface DataQuality {
  window: Window;
  /** 窗口内日历天数 */
  calendar_days: number;
  /** 窗口内有记录的天数 */
  recorded_days: number;
  /** 其中关键字段齐全的天数 —— 判定可用性的依据 */
  valid_days: number;
  null_ratio: number;
  status: MetricStatus;
  /** 哪些字段有问题，给报告用 */
  issues: { field: string; null_days: number; from?: string }[];
}

/** 解析 CSV。空字符串一律转为 null，绝不转 0。 */
export function parseCsv(text: string): RawRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());

  const num = (v: string | undefined): number | null => {
    if (v === undefined) return null;
    const t = v.trim();
    if (t === "" || t === "NULL" || t === "null" || t === "NA") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const get = (key: string) => {
      const idx = header.indexOf(key);
      return idx === -1 ? undefined : cells[idx];
    };
    return {
      date: (get("date") ?? "").trim(),
      region: (get("region") ?? "").trim(),
      store_id: (get("store_id") ?? "").trim(),
      device_count: num(get("device_count")),
      online_device_count: num(get("online_device_count")),
      sales_amount: num(get("sales_amount")),
      order_count: num(get("order_count")),
      refund_amount: num(get("refund_amount")),
      refund_order_count: num(get("refund_order_count")),
      inventory_diff_amount: num(get("inventory_diff_amount")),
      data_version: (get("data_version") ?? "unknown").trim(),
    };
  });
}

/** 两个 ISO 日期之间的天数（含首尾） */
function dayCount(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86400000) + 1;
}

export function inWindow(row: RawRow, w: Window): boolean {
  return row.date >= w.from && row.date <= w.to;
}

/** 取某门店在窗口内的行，按日期排序 */
export function sliceStore(rows: RawRow[], storeId: string, w: Window): RawRow[] {
  return rows
    .filter((r) => r.store_id === storeId && inWindow(r, w))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 取某区域在窗口内的行 */
export function sliceRegion(rows: RawRow[], region: string, w: Window): RawRow[] {
  return rows.filter((r) => r.region === region && inWindow(r, w));
}

/**
 * 数据质量评估。
 * 这里决定 verdict_order 里第一优先级的那一档：能不能算。
 * 门槛值来自 configs/thresholds.yaml 的 data_quality，默认同值。
 */
export function assessQuality(
  rows: RawRow[],
  w: Window,
  opts: { minWindowDays?: number; maxNullRatio?: number } = {},
): DataQuality {
  const minWindowDays = opts.minWindowDays ?? 5;
  const maxNullRatio = opts.maxNullRatio ?? 0.2;

  const calendarDays = dayCount(w.from, w.to);
  const recordedDays = rows.length;

  // 逐字段统计空值天数，并记录最早缺失日，便于报告说清"从哪天开始缺"
  const issues: DataQuality["issues"] = [];
  let totalNullCells = 0;
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1));

  for (const field of KEY_FIELDS) {
    let nullDays = 0;
    let from: string | undefined;
    for (const r of sorted) {
      if ((r[field as KeyField] as number | null) === null) {
        nullDays += 1;
        if (from === undefined) from = r.date;
      }
    }
    totalNullCells += nullDays;
    if (nullDays > 0) issues.push({ field, null_days: nullDays, from });
  }

  // 关键字段齐全的天数
  const validDays = sorted.filter((r) =>
    KEY_FIELDS.every((f) => (r[f as KeyField] as number | null) !== null),
  ).length;

  const nullRatio = recordedDays === 0 ? 1 : totalNullCells / (recordedDays * KEY_FIELDS.length);

  let status: MetricStatus = "ok";
  if (recordedDays === 0 || validDays < minWindowDays) {
    status = "unavailable";
  } else if (nullRatio > maxNullRatio) {
    // 关键字段大面积缺失 —— 即使还能算出部分指标，也不允许下确定性结论
    status = "unavailable";
  }

  return {
    window: w,
    calendar_days: calendarDays,
    recorded_days: recordedDays,
    valid_days: validDays,
    null_ratio: Number(nullRatio.toFixed(4)),
    status,
    issues,
  };
}

/** 汇总求和：跳过 null，返回 null 表示"一个都没上报" */
export function sumField(rows: RawRow[], field: keyof RawRow): number | null {
  let acc = 0;
  let seen = 0;
  for (const r of rows) {
    const v = r[field];
    if (typeof v === "number" && Number.isFinite(v)) {
      acc += v;
      seen += 1;
    }
  }
  return seen === 0 ? null : acc;
}

/**
 * 安全除法。分母为 0 或 null 时返回 null，绝不用 0 代替。
 * 这是全项目唯一允许出现的除法实现，metric_service 必须走这里。
 */
export function safeRatio(
  numerator: number | null,
  denominator: number | null,
  scale = 1,
): number | null {
  if (numerator === null || denominator === null) return null;
  if (denominator === 0) return null;
  const v = (numerator / denominator) * scale;
  return Number.isFinite(v) ? v : null;
}

/** 变化率百分比：(当前 - 基准) / |基准| * 100 */
export function safeChangePct(current: number | null, baseline: number | null): number | null {
  if (current === null || baseline === null) return null;
  if (baseline === 0) return null;
  const v = ((current - baseline) / Math.abs(baseline)) * 100;
  return Number.isFinite(v) ? v : null;
}

/** 比率型指标的变化用百分点：当前 - 基准 */
export function safeChangePoints(current: number | null, baseline: number | null): number | null {
  if (current === null || baseline === null) return null;
  return Number((current - baseline).toFixed(2));
}

/** 取中位数。用于可比门店对比，比均值抗离群。 */
export function median(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return null;
  nums.sort((a, b) => a - b);
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 1 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/** 往前后推 n 天的窗口，用于生成基准窗口 */
export function shiftWindow(w: Window, days: number): Window {
  const shift = (iso: string, delta: number) => {
    const t = Date.parse(`${iso}T00:00:00Z`) + delta * 86400000;
    return new Date(t).toISOString().slice(0, 10);
  };
  return { from: shift(w.from, days), to: shift(w.to, days) };
}
