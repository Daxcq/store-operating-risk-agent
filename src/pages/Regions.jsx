/**
 * 区域投放决策页 —— 星图总览 + 点选比对
 *
 * 这个页面是整套前端唯一「用力」的地方，其余四页保持克制。
 * 理由：投放决策本身是一个**方位 + 距离**问题（往哪投、投多远够得着推荐线），
 * 用坐标轴或表格都不如直接摆成一张星图来得直觉。
 *
 * 星图的编码规则（不是装饰，每一项都对应数据层的一个字段）：
 *   角度 —— 区域方位，固定映射，**只是示意**，不是真实地理方位（界面上要写明）
 *   半径 —— 综合得分（LocationScore.score）。越靠内越好，所以外圈是坏消息
 *   同心环 —— 两条阈值线：65 分「推荐线」、45 分「观察线」，
 *            来自 configs/scoring.yaml 的 recommend_threshold / watch_threshold
 *   颜色 —— recommendation 四档，与 RECOMMENDATION 一一对应
 *   节点大小 —— 选中态放大，其余等大（不用大小编码第三维，避免误读）
 *
 * 交互（用户明确要的那条）：
 *   点一次  -> 选中该区，展开分项与 ROI（业务逻辑）
 *   再点一次 -> 进入比对模式，把它当基准，再点其他区可加入对比组
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import {
  RECOMMENDATION,
  CONFIDENCE,
  RiskBadge,
  Num,
  money,
  moneyCompact,
  windowLabel,
} from "../ui/primitives";

// ---------------------------------------------------------------------------
// 几何常量
// ---------------------------------------------------------------------------

const VIEW = 900;
const CX = 450;
const CY = 450;

/** 满分落到这个半径，零分落到外缘 */
const R_BEST = 64;
const R_WORST = 372;

/** 与 region_score.ts 的 THRESHOLDS 对应。写死在这里是为了画环，
 *  真实结论仍以数据层返回的 recommendation 为准，不由这两条线推导。 */
const RECOMMEND_THRESHOLD = 65;
const WATCH_THRESHOLD = 45;

/**
 * 区域方位角（度，逆时针为正）。
 * C1 在右上、C2 在偏上、C3 在右下、C4 在左下、C5 在偏下，
 * 刻意排成不等距，避免读起来像一朵规则的梅花。
 */
const ANGLE_BY_REGION = { C1: -72, C2: -8, C3: 62, C4: 141, C5: 216 };

function radiusForScore(score) {
  const s = score === null || score === undefined ? 0 : Math.max(0, Math.min(100, score));
  return R_BEST + ((100 - s) / 100) * (R_WORST - R_BEST);
}

function polar(angleDeg, r) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY - r * Math.sin(rad) };
}

function angleFor(region, index) {
  if (Object.prototype.hasOwnProperty.call(ANGLE_BY_REGION, region)) {
    return ANGLE_BY_REGION[region];
  }
  return (360 / 5) * index;
}

/** 标签的锚点与偏移方向：按节点在圆心的哪一侧决定文字往哪边甩 */
function labelAnchor(dx) {
  if (dx > 26) return "start";
  if (dx < -26) return "end";
  return "middle";
}

// ---------------------------------------------------------------------------
// 主页面
// ---------------------------------------------------------------------------

export default function RegionsPage({ dl, window: win, onEvidence }) {
  const [scores, setScores] = useState(null);
  const [scoresResult, setScoresResult] = useState(null);
  const [comparisons, setComparisons] = useState(null);

  const [mode, setMode] = useState("detail");
  const [selected, setSelected] = useState(null);
  const [refRegion, setRefRegion] = useState(null);
  const [participants, setParticipants] = useState([]);

  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);

  const dragRef = useRef(null);
  const stageRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  // --- 取数 ---
  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await dl.scoreLocations({});
      if (!alive) return;
      setScoresResult(r);
      setScores(r.data ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [dl]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await dl.compareRegions();
      if (!alive) return;
      setComparisons(r.data ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [dl]);

  /**
   * 一个区域可能有多个业态档口（C3 是 compact，其余是 standard）。
   * 与 pipeline 里 compareRegions 的处理保持一致：同区域取得分最高的一档作代表，
   * 否则星图上会出现同一个区域两个点，而比对表里只有一行 —— 两边对不上。
   */
  const placed = useMemo(() => {
    if (!scores) return [];
    const best = new Map();
    for (const s of scores) {
      const prev = best.get(s.region);
      if (!prev || (s.score ?? -1) > (prev.score ?? -1)) best.set(s.region, s);
    }
    return [...best.values()]
      .sort((a, b) => (a.region < b.region ? -1 : 1))
      .map((s, i) => {
        const angle = angleFor(s.region, i) + rotation;
        const baseR = radiusForScore(s.score);
        const r = baseR * zoom;
        return { ...s, angle, baseR, r, ...polar(angle, r) };
      });
  }, [scores, zoom, rotation]);

  // 默认选中第一个区域
  useEffect(() => {
    if (!selected && placed.length > 0) setSelected(placed[0].region);
  }, [placed, selected]);

  const selectedNode = placed.find((n) => n.region === selected) ?? null;
  const byRegion = useMemo(() => {
    const m = new Map();
    for (const n of placed) m.set(n.region, n);
    return m;
  }, [placed]);

  // --- 交互 ---

  function handleNodeClick(region) {
    if (mode === "detail") {
      if (region === selected) {
        // 再点一次 —— 这正是用户要的那条：进入比对
        setMode("compare");
        setRefRegion(region);
        setParticipants([region]);
      } else {
        setSelected(region);
      }
      return;
    }
    // 比对模式
    if (region === refRegion) {
      setMode("detail");
      setParticipants([]);
      setSelected(region);
      return;
    }
    setSelected(region);
    setParticipants((cur) =>
      cur.includes(region) ? cur.filter((r) => r !== region) : [...cur, region],
    );
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, rotation };
    setDragging(true);
    stageRef.current?.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const next = d.rotation + (e.clientX - d.x) * 0.32;
    setRotation(Math.max(-180, Math.min(180, next)));
  }

  function onPointerUp(e) {
    dragRef.current = null;
    setDragging(false);
    stageRef.current?.releasePointerCapture?.(e.pointerId);
  }

  /**
   * 滚轮缩放必须用原生监听器，不能用 React 的 onWheel。
   *
   * React 17 起把事件委托挂到 root 上，而浏览器对 root 级的 wheel 监听默认
   * 是 passive 的，preventDefault() 会被忽略并打印警告 —— 结果是滚轮既缩放了
   * 星图、又把整页滚走了。所以这里手动 addEventListener 并显式 passive: false。
   */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const handler = (e) => {
      // 触控板的惯性事件 deltaY 极小，不拦，否则轻微滑动就缩放
      if (Math.abs(e.deltaY) < 2) return;
      e.preventDefault();
      setZoom((z) => Math.max(0.72, Math.min(1.9, z - e.deltaY * 0.0012)));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  function resetView() {
    setRotation(0);
    setZoom(1);
  }

  // --- 渲染 ---

  if (scoresResult === null || scores === null) {
    return (
      <div className="page">
        <div className="state-block is-empty">
          <Crosshair size={18} />
          <div>
            <strong>正在计算区域评分</strong>
            <p>评分要对全量门店跑指标、可比与 ROI 估算，第一次加载需要一点时间。</p>
          </div>
        </div>
      </div>
    );
  }

  if (scoresResult.status === "failed") {
    return (
      <div className="page">
        <div className="state-block is-failed">
          <Crosshair size={18} />
          <div>
            <strong>区域评分没有算出来</strong>
            <p>{scoresResult.warnings?.[0] ?? "数据层没有返回结果"}</p>
          </div>
        </div>
      </div>
    );
  }

  const ringRecommend = radiusForScore(RECOMMEND_THRESHOLD) * zoom;
  const ringWatch = radiusForScore(WATCH_THRESHOLD) * zoom;
  const outer = R_WORST * zoom;

  return (
    <div className="page region-page">
      <div className="region-layout">
        {/* ---------------- 星图 ---------------- */}
        <div className="star-stage">
          <div className="stage-head">
            <div>
              <h3>投放星图</h3>
              <p className="stage-sub">
                半径 = 综合得分，越靠内越好 · 弧线为 65 推荐线与 45 观察线 · 方位为示意，非地理方位
              </p>
            </div>
            <div className="stage-tools">
              <button
                className="icon-btn"
                onClick={() => setZoom((z) => Math.max(0.72, z - 0.12))}
                title="缩小"
              >
                <ZoomOut size={15} />
              </button>
              <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
              <button
                className="icon-btn"
                onClick={() => setZoom((z) => Math.min(1.9, z + 0.12))}
                title="放大"
              >
                <ZoomIn size={15} />
              </button>
              <button className="icon-btn" onClick={resetView} title="重置视角">
                <RotateCcw size={15} />
              </button>
            </div>
          </div>

          <svg
            ref={stageRef}
            className={`star-map ${dragging ? "is-dragging" : ""}`}
            viewBox={`0 0 ${VIEW} ${VIEW}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            role="application"
            aria-label="区域投放星图，可拖动旋转、滚轮缩放"
          >
            {/* 温度场：三层极淡的底色，从内到外由冷转暖 */}
            <circle cx={CX} cy={CY} r={outer} fill="#F8E7E4" opacity="0.34" />
            <circle cx={CX} cy={CY} r={ringWatch} fill="#F7EFDD" opacity="0.42" />
            <circle cx={CX} cy={CY} r={ringRecommend} fill="#E8EEF3" opacity="0.62" />

            {/* 辐射网格：12 根细线，只作方位参照 */}
            {Array.from({ length: 12 }).map((_, i) => {
              const a = i * 30;
              const p = polar(a, outer);
              return (
                <line
                  key={a}
                  x1={CX}
                  y1={CY}
                  x2={p.x}
                  y2={p.y}
                  stroke="#D5DBE2"
                  strokeWidth="1"
                  opacity="0.7"
                />
              );
            })}

            {/* 阈值环 */}
            <circle
              cx={CX}
              cy={CY}
              r={ringRecommend}
              fill="none"
              stroke="#4C7C99"
              strokeWidth="1.4"
              strokeDasharray="1 5"
              opacity="0.9"
            />
            <circle
              cx={CX}
              cy={CY}
              r={ringWatch}
              fill="none"
              stroke="#B98314"
              strokeWidth="1.4"
              strokeDasharray="6 6"
              opacity="0.75"
            />
            <circle cx={CX} cy={CY} r={outer} fill="none" stroke="#D5DBE2" strokeWidth="1" />

            {/* 环上的刻度数字 */}
            <g className="ring-labels">
              <text x={CX + 10} y={CY - ringRecommend + 4} fill="#4C7C99">
                65 · 推荐线
              </text>
              <text x={CX + 10} y={CY - ringWatch + 4} fill="#B98314">
                45 · 观察线
              </text>
              <text x={CX + 10} y={CY - outer + 12} fill="#8A96A3">
                0 分
              </text>
            </g>

            {/* 圆心：最优位 */}
            <circle cx={CX} cy={CY} r="3" fill="#0F1B26" />
            <text className="hub-label" x={CX} y={CY + 20} textAnchor="middle">
              最优
            </text>

            {/* 比对连线：基准 -> 每个参与区 */}
            {mode === "compare" && refRegion
              ? participants
                  .filter((r) => r !== refRegion)
                  .map((r) => {
                    const a = byRegion.get(refRegion);
                    const b = byRegion.get(r);
                    if (!a || !b) return null;
                    const mx = (a.x + b.x) / 2;
                    const my = (a.y + b.y) / 2;
                    const dScore =
                      b.score !== null && a.score !== null ? b.score - a.score : null;
                    return (
                      <g key={`${refRegion}-${r}`} className="compare-link">
                        <line
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke="#0F1B26"
                          strokeWidth="1.2"
                          strokeDasharray="4 4"
                          opacity="0.5"
                        />
                        <rect
                          x={mx - 25}
                          y={my - 11}
                          width="50"
                          height="20"
                          rx="2"
                          fill="#F2F4F7"
                          stroke="#D5DBE2"
                        />
                        <text x={mx} y={my + 3} textAnchor="middle" className="link-delta">
                          {dScore === null ? "—" : `${dScore > 0 ? "+" : ""}${dScore.toFixed(1)}`}
                        </text>
                      </g>
                    );
                  })
              : null}

            {/* 节点 */}
            {placed.map((n) => {
              const isSelected = n.region === selected;
              const isRef = n.region === refRegion;
              const inCompare = participants.includes(n.region);
              const meta = RECOMMENDATION[n.recommendation] ?? RECOMMENDATION["数据不足"];
              const size = isSelected ? 13 : 9.5;
              const anchor = labelAnchor(n.x - CX);
              const labelPos = polar(n.angle, n.r + (isSelected ? 26 : 21));
              return (
                <g
                  key={n.region}
                  className={`node ${isSelected ? "is-selected" : ""} ${isRef ? "is-ref" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNodeClick(n.region);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleNodeClick(n.region);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${n.region}，综合得分 ${n.score ?? "无法计算"}，${n.recommendation}`}
                >
                  {inCompare && !isRef ? (
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={size + 9}
                      fill="none"
                      stroke="#0F1B26"
                      strokeWidth="1"
                      strokeDasharray="2 3"
                      opacity="0.55"
                    />
                  ) : null}
                  {isSelected ? (
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={size + 7}
                      fill="none"
                      stroke={meta.color}
                      strokeWidth="1.2"
                      opacity="0.5"
                    />
                  ) : null}
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={size}
                    fill={meta.color}
                    stroke="#F2F4F7"
                    strokeWidth="2.5"
                  />
                  <text
                    className="node-label"
                    x={labelPos.x}
                    y={labelPos.y - 2}
                    textAnchor={anchor}
                    fill="#0F1B26"
                  >
                    {n.region}
                    <tspan className="node-score" dx="5" fill={meta.color}>
                      {n.score === null ? "—" : n.score.toFixed(1)}
                    </tspan>
                  </text>
                  <text
                    className="node-sub"
                    x={labelPos.x}
                    y={labelPos.y + 13}
                    textAnchor={anchor}
                  >
                    {n.grade}
                    {n.rank ? ` · 第 ${n.rank}` : ""}
                  </text>
                </g>
              );
            })}
          </svg>

          <div className="stage-foot">
            <div className="legend">
              {Object.entries(RECOMMENDATION).map(([label, m]) => (
                <span key={label} className="legend-item">
                  <i style={{ background: m.color }} />
                  {label}
                </span>
              ))}
            </div>
            <p className="stage-hint">
              拖动旋转 · 滚轮缩放 · 点一次看分项 · <b>再点一次进入比对</b>
            </p>
          </div>
        </div>

        {/* ---------------- 右栏：分项 / 比对 ---------------- */}
        <aside className="region-aside">
          {mode === "detail" ? (
            <DetailPanel
              node={selectedNode}
              comparison={comparisons?.find((c) => c.name === selectedNode?.region)}
              window={win}
              onEnterCompare={() => {
                if (!selectedNode) return;
                setMode("compare");
                setRefRegion(selectedNode.region);
                setParticipants([selectedNode.region]);
              }}
              onEvidence={onEvidence}
            />
          ) : (
            <ComparePanel
              refRegion={refRegion}
              participants={participants}
              byRegion={byRegion}
              comparisons={comparisons}
              onToggle={handleNodeClick}
              onExit={() => {
                setMode("detail");
                setParticipants([]);
              }}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 分项面板（第一次点击）
// ---------------------------------------------------------------------------

function DetailPanel({ node, comparison, window: win, onEnterCompare, onEvidence }) {
  if (!node) return <div className="panel-placeholder">点一个区域开始。</div>;

  const conf = CONFIDENCE[node.confidence] ?? CONFIDENCE.low;

  return (
    <div className="panel">
      <header className="panel-head">
        <div>
          <span className="kicker">区域分项 / {node.grade}</span>
          <h3>
            {node.region}
            <span className="panel-score">
              {node.score === null ? "—" : node.score.toFixed(1)}
            </span>
          </h3>
        </div>
        <RiskBadge
          risk={
            node.recommendation === "推荐"
              ? "normal"
              : node.recommendation === "不建议"
                ? "possible"
                : node.recommendation === "数据不足"
                  ? "unavailable"
                  : "watch"
          }
          large
        />
      </header>

      <div className="panel-facts">
        <div>
          <span>推荐结论</span>
          <strong style={{ color: (RECOMMENDATION[node.recommendation] ?? {}).color }}>
            {node.recommendation}
          </strong>
        </div>
        <div>
          <span>门店数</span>
          <strong>{node.store_count}</strong>
        </div>
        <div>
          <span>月利润（中位）</span>
          <strong>{money(node.estimated_monthly_profit)}</strong>
        </div>
        <div>
          <span>回本周期</span>
          <strong>
            {node.estimated_payback_months === null
              ? "无法估算"
              : `${node.estimated_payback_months.toFixed(1)} 个月`}
          </strong>
        </div>
      </div>

      <section className="panel-section">
        <h4>
          加权分项
          <span className="muted">
            权重和 = 1 · 成本项为负担值，越高越差
          </span>
        </h4>
        <div className="components">
          {node.components.map((c) => {
            const isCost = c.code === "cost_score";
            return (
              <div className="component" key={c.code}>
                <div className="component-top">
                  <span>{c.display_name}</span>
                  <span className="component-values">
                    <Num value={c.value} digits={1} />
                    <em>× {c.weight.toFixed(2)}</em>
                  </span>
                </div>
                <div className="bar-track">
                  {c.value === null ? (
                    <span className="bar-null" title="该分项数据缺失，未参与加权" />
                  ) : (
                    <span
                      className={`bar-fill ${isCost ? "is-burden" : ""}`}
                      style={{ width: `${Math.max(2, Math.min(100, c.value))}%` }}
                    />
                  )}
                </div>
                <div className="component-foot">
                  <span>
                    {c.value === null
                      ? "数据缺失，总分已按剩余权重重归一化"
                      : `贡献 ${c.contribution === null ? "—" : c.contribution.toFixed(2)} 分`}
                  </span>
                  <code>{c.evidence_id}</code>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {node.reasons.length ? (
        <section className="panel-section">
          <h4>为什么是这个分</h4>
          <ul className="reason-list">
            {node.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {node.assumptions.length ? (
        <section className="panel-section">
          <h4>
            估算假设
            <span className="muted">这些是假设，不是观测值</span>
          </h4>
          <ul className="assumption-list">
            {node.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="panel-note">
        <span>
          可信度：<b style={{ color: conf.color }}>{conf.label}</b>
        </span>
        <span>权重版本 {node.weights_version}</span>
        <span>窗口 {windowLabel(win)}</span>
      </div>

      <p className="disclaimer">{node.disclaimer}</p>

      <div className="panel-actions">
        <button className="primary-btn" onClick={onEnterCompare}>
          <Crosshair size={15} />
          以 {node.region} 为基准比对
        </button>
        <button
          className="text-btn"
          onClick={() =>
            onEvidence({
              title: `${node.region} ${node.grade} 区域评分`,
              traceId: node.trace_id,
              dataVersion: node.data_version,
              evidenceIds: node.evidence_ids,
            })
          }
        >
          查看证据
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 比对面板（第二次点击）
// ---------------------------------------------------------------------------

const COMPARE_ROWS = [
  { key: "score", label: "综合得分", higherIsBetter: true, kind: "score" },
  { key: "demand_score", label: "需求强度", higherIsBetter: true, kind: "component" },
  { key: "competition_score", label: "竞争压力", higherIsBetter: true, kind: "component" },
  { key: "margin_score", label: "毛利空间", higherIsBetter: true, kind: "component" },
  { key: "cost_score", label: "运营成本负担", higherIsBetter: false, kind: "component" },
  { key: "profit", label: "月利润（中位）", higherIsBetter: true, kind: "money" },
  { key: "payback", label: "回本周期", higherIsBetter: false, kind: "months" },
  { key: "stores", label: "门店数", higherIsBetter: null, kind: "count" },
];

function valueOf(node, row, profitByRegion) {
  if (!node) return null;
  if (row.kind === "score") return node.score;
  if (row.kind === "stores") return node.store_count;
  if (row.kind === "profit") {
    const c = profitByRegion.get(node.region);
    return c ? c.estimatedMonthlyProfit : node.estimated_monthly_profit;
  }
  if (row.kind === "payback") {
    const c = profitByRegion.get(node.region);
    return c ? c.estimatedPaybackMonths : node.estimated_payback_months;
  }
  const comp = node.components.find((x) => x.code === row.key);
  return comp ? comp.value : null;
}

function formatCell(row, v) {
  if (v === null || v === undefined) return "—";
  if (row.kind === "money") return moneyCompact(v);
  if (row.kind === "months") return `${v.toFixed(1)} 月`;
  if (row.kind === "count") return String(v);
  return v.toFixed(1);
}

function ComparePanel({ refRegion, participants, byRegion, comparisons, onToggle, onExit }) {
  const profitByRegion = useMemo(() => {
    const m = new Map();
    for (const c of comparisons ?? []) m.set(c.name, c);
    return m;
  }, [comparisons]);

  const refNode = byRegion.get(refRegion);
  const others = participants.filter((r) => r !== refRegion);
  const available = [...byRegion.keys()].filter((r) => !participants.includes(r));

  if (!refNode) return null;

  return (
    <div className="panel">
      <header className="panel-head">
        <div>
          <span className="kicker">基准比对 / 点亮的区域</span>
          <h3>
            以 {refRegion} 为基准
            <span className="panel-score">
              {refNode.score === null ? "—" : refNode.score.toFixed(1)}
            </span>
          </h3>
        </div>
        <button className="text-btn" onClick={onExit}>
          退出比对
        </button>
      </header>

      {others.length === 0 ? (
        <div className="compare-empty">
          <p>
            在星图上再点亮一个区域即可开始比对。差值为<b>相对基准</b>的绝对变化，
            不是百分比 —— 分项本身已经是 0~100 的得分，再算百分比没有意义。
          </p>
          {available.length ? (
            <div className="compare-add">
              <span>可加入：</span>
              {available.map((r) => (
                <button key={r} className="chip-btn" onClick={() => onToggle(r)}>
                  {r}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="compare-table-wrap">
            <table className="compare-table">
              <thead>
                <tr>
                  <th className="row-label">指标</th>
                  <th className="is-ref">
                    {refRegion}
                    <em>基准</em>
                  </th>
                  {others.map((r) => (
                    <th key={r}>
                      {r}
                      <button
                        className="chip-remove"
                        onClick={() => onToggle(r)}
                        title={`移出 ${r}`}
                      >
                        ×
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((row) => {
                  const refVal = valueOf(refNode, row, profitByRegion);
                  return (
                    <tr key={row.key}>
                      <th className="row-label">{row.label}</th>
                      <td className="is-ref">{formatCell(row, refVal)}</td>
                      {others.map((r) => {
                        const node = byRegion.get(r);
                        const v = valueOf(node, row, profitByRegion);
                        const delta =
                          v !== null && refVal !== null && typeof v === "number" && typeof refVal === "number"
                            ? v - refVal
                            : null;
                        const better =
                          delta === null || row.higherIsBetter === null
                            ? null
                            : row.higherIsBetter
                              ? delta > 0
                              : delta < 0;
                        const tone =
                          delta === null || Math.abs(delta) < 0.05
                            ? ""
                            : better
                              ? "is-better"
                              : "is-worse";
                        return (
                          <td key={r} className={tone}>
                            <span className="cell-main">{formatCell(row, v)}</span>
                            {delta !== null && Math.abs(delta) >= 0.05 ? (
                              <span className="cell-delta">
                                {delta > 0 ? "+" : ""}
                                {row.kind === "money"
                                  ? moneyCompact(delta).replace("¥", "¥")
                                  : row.kind === "months"
                                    ? `${delta.toFixed(1)} 月`
                                    : row.kind === "count"
                                      ? delta.toFixed(0)
                                      : delta.toFixed(1)}
                              </span>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="compare-verdict">
            {(() => {
              const best = others
                .map((r) => ({ region: r, node: byRegion.get(r) }))
                .filter((x) => x.node && x.node.score !== null)
                .sort((a, b) => b.node.score - a.node.score)[0];
              if (!best) return null;
              const gap =
                refNode.score !== null && best.node.score !== null
                  ? best.node.score - refNode.score
                  : null;
              return (
                <p>
                  {gap !== null && gap > 0 ? (
                    <>
                      入选区域里 <b>{best.region}</b> 综合分高出基准{" "}
                      <b>{gap.toFixed(1)} 分</b>，差异主要来自
                      {best.node.components
                        .map((c) => {
                          const rc = refNode.components.find((x) => x.code === c.code);
                          const d = c.value !== null && rc && rc.value !== null ? c.value - rc.value : null;
                          return { name: c.display_name, d, cost: c.code === "cost_score" };
                        })
                        .filter((x) => x.d !== null && Math.abs(x.d) >= 3)
                        .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
                        .slice(0, 2)
                        .map((x) => `${x.name} ${x.d > 0 ? "+" : ""}${x.d.toFixed(1)}`)
                        .join("、") || "分项差异均在 3 分以内"}
                      。
                    </>
                  ) : (
                    <>
                      入选区域里没有综合分高于基准的，<b>{refRegion}</b> 仍是当前最优候选；
                      这不等于可以直接投放，仍需看下面的假设与免责说明。
                    </>
                  )}
                </p>
              );
            })()}
          </div>

          {available.length ? (
            <div className="compare-add">
              <span>可加入：</span>
              {available.map((r) => (
                <button key={r} className="chip-btn" onClick={() => onToggle(r)}>
                  {r}
                </button>
              ))}
            </div>
          ) : null}

          <p className="disclaimer">
            差值取绝对值变化。综合分为加权结果，单项领先不代表整体更优，结论请结合假设与成本口径一起看。
          </p>
        </>
      )}
    </div>
  );
}
