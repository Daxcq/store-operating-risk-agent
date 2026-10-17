/**
 * 经营驾驶舱
 *
 * 这一页只回答一个问题：**这 21 家店现在什么样，我该先看哪儿。**
 *
 * 三个区块，全部来自数据层，没有一个是前端编的：
 *   1) 五个规模指标 —— getDashboardMetrics 的原样输出
 *   2) 42 天日销售额序列 —— 直接用解析后的 CSV 行，不经过任何聚合（聚合会抹掉 S001 的斜坡）
 *   3) 门店格阵 —— runAudit 的判定结果，一店一格，按区域分簇
 *
 * 序列为什么必须画出来：S001 的异常是从 2026-10-06 开始按 3 天渐进下滑的，
 * 只给一个「本期 -37%」的数字会让人以为是某天突然崩的。趋势线在这里不是装饰，
 * 它是「这次判定凭什么成立」的一部分。
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  RISK,
  verdictRisk,
  Num,
  Delta,
  Warnings,
  CallFailed,
  EmptyState,
  moneyCompact,
  percent,
  windowLabel,
} from "../ui/primitives";
import { regionHint } from "../data/datasets";

const RANGE_PRESETS = [
  { key: "7", label: "近 7 天", from: "2026-10-06", to: "2026-10-12" },
  { key: "14", label: "近 14 天", from: "2026-09-29", to: "2026-10-12" },
  { key: "42", label: "全量 42 天", from: "2026-09-01", to: "2026-10-12" },
];

export default function DashboardPage({ dataset, sweep, onSelectStore, onEvidence }) {
  const [regionId, setRegionId] = useState("");
  const [rangeKey, setRangeKey] = useState("7");
  const [metrics, setMetrics] = useState(null);
  const [result, setResult] = useState(null);

  const preset = RANGE_PRESETS.find((r) => r.key === rangeKey) ?? RANGE_PRESETS[0];

  useEffect(() => {
    let alive = true;
    setResult(null);
    (async () => {
      const r = await dataset.dl.getDashboardMetrics({
        regionId: regionId || undefined,
        from: preset.from,
        to: preset.to,
      });
      if (!alive) return;
      setResult(r);
      setMetrics(r.data);
    })();
    return () => {
      alive = false;
    };
  }, [dataset.dl, regionId, preset.from, preset.to]);

  // --- 日序列：直接按天加总，不取平均 ---
  const series = useMemo(() => {
    const byDay = new Map();
    for (const r of dataset.rows) {
      if (r.date < preset.from || r.date > preset.to) continue;
      const cur = byDay.get(r.date) ?? { total: 0, missing: 0, count: 0 };
      if (typeof r.sales_amount === "number" && Number.isFinite(r.sales_amount)) {
        cur.total += r.sales_amount;
        cur.count += 1;
      } else {
        cur.missing += 1;
      }
      byDay.set(r.date, cur);
    }
    return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, v]) => ({ date, total: v.count > 0 ? v.total : null, missing: v.missing }));
  }, [dataset.rows, preset.from, preset.to]);

  // --- 门店格阵：按区域分组 ---
  const clusters = useMemo(() => {
    if (!sweep) return [];
    const allowed = regionId ? new Set(dataset.stores.filter((s) => s.region === regionId).map((s) => s.storeId)) : null;
    const byRegion = new Map();
    for (const row of sweep) {
      if (allowed && !allowed.has(row.storeId)) continue;
      if (!byRegion.has(row.region)) byRegion.set(row.region, []);
      byRegion.get(row.region).push(row);
    }
    return [...byRegion.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([region, stores]) => ({
        region,
        stores: stores.sort((x, y) => x.storeId.localeCompare(y.storeId)),
        possible: stores.filter((s) => s.evaluation?.verdict === "possible").length,
        watch: stores.filter((s) => s.evaluation?.verdict === "insufficient").length,
        unavailable: stores.filter((s) => !s.ok || s.evaluation?.verdict === "unavailable").length,
      }));
  }, [sweep, regionId, dataset.stores]);

  const regionCodes = [...new Set(dataset.stores.map((s) => s.region))].sort();

  return (
    <div className="page">
      {/* ---------------- 口径控制 ---------------- */}
      <div className="control-bar">
        <div className="control-group">
          <span className="control-label">区域</span>
          <div className="seg">
            <button
              className={regionId === "" ? "is-on" : ""}
              onClick={() => setRegionId("")}
            >
              全域
            </button>
            {regionCodes.map((r) => (
              <button
                key={r}
                className={regionId === r ? "is-on" : ""}
                onClick={() => setRegionId(r)}
                title={regionHint(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="control-group">
          <span className="control-label">窗口</span>
          <div className="seg">
            {RANGE_PRESETS.map((r) => (
              <button
                key={r.key}
                className={rangeKey === r.key ? "is-on" : ""}
                onClick={() => setRangeKey(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="control-note">
          {regionId ? `${regionId} · ${regionHint(regionId)}` : "全域 21 店"} · {windowLabel({ from: preset.from, to: preset.to })}
        </div>
      </div>

      {/* ---------------- 规模指标 ---------------- */}
      {result && result.status === "failed" ? (
        <CallFailed result={result} what="规模指标" />
      ) : (
        <div className="metric-strip">
          <MetricCell
            label="销售额"
            value={metrics ? <Num value={metrics.salesAmount} prefix="¥" /> : "—"}
            sub={metrics ? `${preset.label}合计 · 先加总再算比率` : "计算中"}
          />
          <MetricCell
            label="月利润估算"
            value={metrics ? moneyCompact(metrics.estimatedProfit) : "—"}
            sub="区域中位数的中位数 · 非加总"
            tone="assumption"
          />
          <MetricCell
            label="在营设备"
            value={metrics ? <Num value={metrics.deviceCount} suffix=" 台" /> : "—"}
            sub="逐店取窗口内最大值后加总"
          />
          <MetricCell
            label="设备在线率"
            value={metrics ? percent(metrics.onlineRate) : "—"}
            sub="设备天数加权，非门店平均"
          />
          <MetricCell
            label="未决发现"
            value={metrics ? <Num value={metrics.openFindingCount} suffix=" 家" /> : "—"}
            sub="仅计「疑似异常」，不含证据不足"
            tone="alert"
          />
        </div>
      )}

      {result?.warnings?.length ? <Warnings items={result.warnings} /> : null}

      {/* ---------------- 日序列 ---------------- */}
      <section className="block">
        <header className="block-head">
          <h3>日销售额与判定窗口</h3>
          <p>
            每根竖线是一天，<b>不含任何平滑</b>。窗口外的日子画成浅色，用来判断「这次下滑是从哪天开始的」。
          </p>
        </header>
        <DailySeries series={series} preset={preset} />
      </section>

      {/* ---------------- 门店格阵 ---------------- */}
      <section className="block">
        <header className="block-head">
          <h3>门店判定格阵</h3>
          <p>
            一格一店，按区域分簇。颜色是判定结果，不是经营好坏；
            <b>「证据不足」既不是绿也不是红</b>，它是还没有结论。
          </p>
        </header>

        {!sweep ? (
          <EmptyState title="正在逐店审计">每家店都要跑指标、可比与规则，21 家店需要一点时间。</EmptyState>
        ) : clusters.length === 0 ? (
          <EmptyState title="该区域没有门店" />
        ) : (
          <div className="clusters">
            {clusters.map((c) => (
              <div className="cluster" key={c.region}>
                <div className="cluster-head">
                  <span className="cluster-name">{c.region}</span>
                  <span className="cluster-sub">{regionHint(c.region) || "—"}</span>
                  <span className="cluster-tally">
                    {c.possible > 0 ? <em className="t-possible">{c.possible} 疑似</em> : null}
                    {c.watch > 0 ? <em className="t-watch">{c.watch} 观察</em> : null}
                    {c.unavailable > 0 ? <em className="t-unavailable">{c.unavailable} 缺数</em> : null}
                    {c.possible === 0 && c.watch === 0 && c.unavailable === 0 ? (
                      <em className="t-normal">{c.stores.length} 正常</em>
                    ) : null}
                  </span>
                </div>
                <div className="cell-row">
                  {c.stores.map((s) => {
                    const risk = !s.ok
                      ? "unavailable"
                      : verdictRisk(s.evaluation?.verdict);
                    const meta = RISK[risk];
                    return (
                      <button
                        key={s.storeId}
                        className={`store-cell risk-${risk}`}
                        style={{ borderColor: meta.color, color: meta.color, background: meta.wash }}
                        onClick={() => onSelectStore(s.storeId)}
                        title={`${s.storeId} · ${s.grade} · ${meta.label}`}
                      >
                        <span className="cell-glyph" aria-hidden="true">
                          {risk === "normal"
                            ? "●"
                            : risk === "watch"
                              ? "◐"
                              : risk === "possible"
                                ? "▲"
                                : "○"}
                        </span>
                        <span className="cell-id">{s.storeId.replace(/^S0*/, "")}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="footnote">
        月利润为估算：毛利率 30%、单台设备造价 ¥32,000、人力按租金 35% 折算，
        这些是假设而非观测值，详见区域内分项页与 configs/scoring.yaml 的 roi 段。
      </p>
    </div>
  );
}

function MetricCell({ label, value, sub, tone }) {
  return (
    <div className={`metric-cell ${tone ? `is-${tone}` : ""}`}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <span className="metric-sub">{sub}</span>
    </div>
  );
}

/**
 * 日序列柱图。
 *
 * 用 SVG 手绘而不是引图表库：这里只需要「按天高度 + 窗口高亮 + 悬停读数」，
 * 引一个 200KB 的图表库为了三件事不划算，而且图表库默认会做圆角、渐变、
 * 动画入场，全都不是这一页要的语气。
 */
function DailySeries({ series, preset }) {
  const [hover, setHover] = useState(null);
  if (series.length === 0) return <EmptyState title="窗口内没有日记录" />;

  const W = 1000;
  const H = 220;
  const PAD_L = 64;
  const PAD_R = 16;
  const PAD_T = 14;
  const PAD_B = 30;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const max = Math.max(...series.map((d) => d.total ?? 0), 1);
  // 纵轴向上取整到「好看」的刻度，避免出现 137,482 这样的轴上限
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const axisMax = Math.ceil(max / step) * step;

  const bw = innerW / series.length;
  const barW = Math.max(2, bw * 0.56);

  const y = (v) => PAD_T + innerH - (v / axisMax) * innerH;
  const x = (i) => PAD_L + bw * i + bw / 2;

  const inWindow = (d) => d.date >= preset.from && d.date <= preset.to;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => axisMax * f);

  return (
    <div className="series-wrap">
      <svg className="series" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="日销售额序列">
        {/* 网格与纵轴 */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y(t)}
              y2={y(t)}
              stroke="#D5DBE2"
              strokeWidth="1"
              opacity={t === 0 ? 1 : 0.55}
            />
            <text x={PAD_L - 10} y={y(t) + 4} textAnchor="end" className="axis-label">
              {t === 0 ? "0" : moneyCompact(t)}
            </text>
          </g>
        ))}

        {/* 柱 */}
        {series.map((d, i) => {
          const active = inWindow(d);
          const top = d.total === null ? PAD_T + innerH : y(d.total);
          const h = PAD_T + innerH - top;
          return (
            <g key={d.date}>
              {d.total === null ? (
                <line
                  x1={x(i)}
                  x2={x(i)}
                  y1={PAD_T + innerH - 8}
                  y2={PAD_T + innerH}
                  stroke="#8A96A3"
                  strokeWidth={barW}
                  strokeDasharray="1 3"
                />
              ) : (
                <rect
                  x={x(i) - barW / 2}
                  y={top}
                  width={barW}
                  height={Math.max(1, h)}
                  fill={active ? "#0F1B26" : "#B9C3CD"}
                />
              )}
              <rect
                x={PAD_L + bw * i}
                y={PAD_T}
                width={bw}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover(d)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}

        {/* 窗口起止标记 */}
        <line
          x1={PAD_L + bw * series.findIndex((d) => d.date === preset.from)}
          x2={PAD_L + bw * series.findIndex((d) => d.date === preset.from)}
          y1={PAD_T - 6}
          y2={PAD_T + innerH}
          stroke="#4C7C99"
          strokeWidth="1.2"
        />
        <line
          x1={PAD_L + bw * (series.findIndex((d) => d.date === preset.to) + 1)}
          x2={PAD_L + bw * (series.findIndex((d) => d.date === preset.to) + 1)}
          y1={PAD_T - 6}
          y2={PAD_T + innerH}
          stroke="#4C7C99"
          strokeWidth="1.2"
        />

        {/* 横轴：只标首、窗口起点、末，避免拥挤 */}
        {[0, series.findIndex((d) => d.date === preset.from), series.length - 1]
          .filter((i, idx, arr) => i >= 0 && arr.indexOf(i) === idx)
          .map((i) => (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="axis-label">
              {series[i].date.slice(5)}
            </text>
          ))}
      </svg>

      <div className="series-readout">
        {hover ? (
          <>
            <span>{hover.date}</span>
            <strong>{hover.total === null ? "数据缺失" : moneyCompact(hover.total)}</strong>
            {hover.missing > 0 ? <em>{hover.missing} 条记录缺销售额，未计入</em> : null}
          </>
        ) : (
          <span className="muted">
            深色 = 判定窗口（{preset.from} → {preset.to}），浅色 = 窗口外参照日
          </span>
        )}
      </div>
    </div>
  );
}
