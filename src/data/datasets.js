/**
 * 前端数据接入层。
 *
 * 为什么浏览器里直接跑 B 的 TS 模块，而不是走 src/server/dataLayerClient.js：
 *   那条链路的目标是 http://127.0.0.1:8787 的 Python 数据层。
 *   本仓库里没有那个服务（data_layer/ 是另一套周期快照实现，端口与契约都不同），
 *   所以前端如果依赖它，就是「先起一个不存在的服务再打开页面」。
 *   改成在浏览器里直接 import ../services/pipeline 的 createDataLayer，
 *   喂两份 CSV 文本进去，口径与 Node 侧跑的是同一份代码，不存在两套算法。
 *
 * 数据文件位置：
 *   data/store_operations_daily.csv  —— 21 店 x 42 天，参照数据集（C1~C5）
 *   data/region_cost_input.csv       —— 区域成本输入，评分与 ROI 用
 *
 * 这两个文件由 python data/_generate.py 生成。文件不在时**不编造数据**，
 * 返回 { ok:false }，由页面显示明确的操作指引。
 */

import { createDataLayer, deriveProfiles, DEFAULT_WINDOW } from "../services/pipeline";
import { parseCsv } from "../services/data_loader";

const OPS_PATHS = ["/data/store_operations_daily.csv", "./data/store_operations_daily.csv"];
const COST_PATHS = ["/data/region_cost_input.csv", "./data/region_cost_input.csv"];

/**
 * 依次尝试若干路径，返回第一份看起来像 CSV 的文本。
 *
 * 【为什么必须检查 '<'】
 * Vite dev server 对不存在的路径会回落到 index.html 并返回 200。
 * 如果只看 response.ok，会把一整页 HTML 当成 CSV 去 parseCsv，
 * 结果是「解析出 0 行数据」，页面上表现为所有指标都是 unavailable ——
 * 一个「文件缺失」被误诊成「数据全空」，排查起来非常费劲。
 * 所以这里显式拒绝以 '<' 开头的内容。
 */
async function readFirstAvailable(paths) {
  for (const path of paths) {
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) continue;
      const text = await res.text();
      const head = text.trimStart();
      if (!head || head.startsWith("<")) continue;
      return { text, path };
    } catch {
      // 网络层失败就换下一条路径，不中断
    }
  }
  return null;
}

function countDataRows(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  return Math.max(0, lines.length - 1);
}

/**
 * 载入数据集。
 *
 * @returns {Promise<
 *   | { ok: true, dl, rows, profiles, costs, opsPath, costPath, rowCount, window, stores }
 *   | { ok: false, reason: string, detail: string }
 * >}
 */
export async function loadDataset() {
  const ops = await readFirstAvailable(OPS_PATHS);
  if (!ops) {
    return {
      ok: false,
      reason: "ops-missing",
      detail:
        "找不到 data/store_operations_daily.csv。这份文件是由脚本确定性生成的，仓库里不提交生成结果。",
    };
  }

  const cost = await readFirstAvailable(COST_PATHS);
  if (!cost) {
    return {
      ok: false,
      reason: "cost-missing",
      detail:
        "缺少 data/region_cost_input.csv。区域评分与 ROI 全部依赖它，没有成本输入就没有分数，本页不显示推测值。",
    };
  }

  const rows = parseCsv(ops.text);
  if (rows.length === 0) {
    return {
      ok: false,
      reason: "ops-empty",
      detail: "data/store_operations_daily.csv 存在但解析出 0 行，请重新运行生成脚本。",
    };
  }

  const dl = createDataLayer({ csvText: ops.text, costCsvText: cost.text });
  const profiles = deriveProfiles(rows);

  const stores = [...profiles.entries()]
    .map(([storeId, p]) => ({ storeId, region: p.region, grade: p.grade }))
    .sort((a, b) => a.storeId.localeCompare(b.storeId));

  return {
    ok: true,
    dl,
    rows,
    profiles,
    costs: parseCsv(cost.text),
    opsPath: ops.path,
    costPath: cost.path,
    rowCount: countDataRows(ops.text),
    window: DEFAULT_WINDOW,
    stores,
  };
}

/**
 * 全店审计扫描。
 *
 * 21 家店逐店跑 run_audit，每家的结论都带自己的 evidence_ids 与 trace_id。
 * 放在这里一次算完、由 main.jsx 传给各页，是为了避免「驾驶舱算一遍、
 * 审计中心再算一遍」—— 两遍不仅慢，更要紧的是两次计算的 trace_id 不同，
 * 用户在两页看到的同一个门店会挂着两个溯源编号，会被当成数据不一致。
 *
 * 失败的门店不静默丢弃：记下 reason 一起返回，页面上要能看到
 * 「这家店没审成」而不是凭空少一行。
 */
export async function sweepPortfolio(dl, stores) {
  const results = [];
  for (const s of stores) {
    try {
      const r = await dl.runAudit({ store_id: s.storeId });
      results.push({
        ...s,
        result: r,
        evaluation: r.data,
        ok: r.status !== "failed" && r.data !== null,
        reason: r.data === null ? (r.warnings[0] ?? "审计未返回结论") : null,
      });
    } catch (error) {
      results.push({
        ...s,
        result: null,
        evaluation: null,
        ok: false,
        reason: `审计调用异常：${error?.message ?? error}`,
      });
    }
  }
  return results;
}

/**
 * 区域代号的中文副标题。
 *
 * ⚠️ 纯展示用，不参与任何计算。必须与 data/_generate.py 的 REGION_LABELS 保持一致，
 * 改一边就要改另一边。C1~C5 是中性代号，刻意不映射回任何真实行政区 ——
 * 这样它们不会和长春主线（朝阳/南关/宽城/二道/绿园）的商圈档案混淆。
 */
export const REGION_HINTS = {
  C1: "参照区一 · 主线门店所在区",
  C2: "参照区二",
  C3: "参照区三 · 本套唯一 compact 档口",
  C4: "参照区四",
  C5: "参照区五 · 成本最低",
};

/** 区域代号 -> 中文副标题，认不出来返回空串而不是代号本身 */
export function regionHint(code) {
  return REGION_HINTS[code] ?? "";
}

/** 把三档可信度翻成中文 */
export const CONFIDENCE_LABEL = {
  full: "分项齐全",
  degraded: "分项缺失·已重归一化",
  low: "可信度低",
};
