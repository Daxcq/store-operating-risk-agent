/**
 * 智能审计中心
 *
 * 这一页是「为什么」的页面。驾驶舱只告诉你哪家店值得看，这里要把判定拆开：
 *   条件逐条给 actual / threshold / op，不命中也要列出来并显示实值；
 *   证据不足要说清是缺哪一段数据，而不是笼统说「数据不足」；
 *   可比门店不足时排名一律不显示 —— 契约明确禁止在不可比的情况下出排名。
 *
 * 三种 verdict 在列表里的排序不是按门店号，而是按「需要人处理的紧迫度」：
 * possible -> insufficient -> unavailable -> none。
 * 证据不足排在正常之前，理由同 primitives.jsx：它是待办，不是结尾。
 */

import React, { useEffect, useMemo, useState } from "react";
import { Search, ChevronRight } from "lucide-react";
import {
  RISK,
  verdictRisk,
  RiskBadge,
  Num,
  Delta,
  Tag,
  Warnings,
  CallFailed,
  EmptyState,
  EvidenceButton,
  money,
  percent,
  windowLabel,
} from "../ui/primitives";
import { regionHint } from "../data/datasets";

const VERDICT_ORDER = { possible: 0, insufficient: 1, unavailable: 2, none: 3 };

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "possible", label: "疑似异常" },
  { key: "insufficient", label: "证据不足" },
  { key: "none", label: "正常" },
  { key: "unavailable", label: "无法判断" },
];

/** 单位渲染：金额、百分比、计数各有各的写法，不能统一 toFixed(1) */
function fmtByUnit(value, unit) {
  if (value === null || value === undefined) return "—";
  switch (unit) {
    case "currency":
      return money(value);
    case "percent":
      return `${value.toFixed(1)}%`;
    case "percent_point":
      return `${value > 0 ? "+" : ""}${value.toFixed(1)}pt`;
    case "count":
      return value.toLocaleString("zh-CN");
    default:
      return value.toFixed(2);
  }
}

const OP_LABEL = { "<=": "≤", ">=": "≥", "<": "<", ">": ">", "==": "=" };

export default function AuditPage({ dataset, sweep, selectedStore, onSelectStore, onEvidence }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [peerResult, setPeerResult] = useState(null);
  const [peerStatus, setPeerStatus] = useState("idle");

  const rows = useMemo(() => {
    if (!sweep) return [];
    const q = query.trim().toLowerCase();
    return [...sweep]
      .filter((r) => {
        if (filter !== "all") {
          const v = r.ok ? r.evaluation?.verdict : "unavailable";
          if (v !== filter) return false;
        }
        if (!q) return true;
        return r.storeId.toLowerCase().includes(q) || r.region.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const av = a.ok ? (a.evaluation?.verdict ?? "unavailable") : "unavailable";
        const bv = b.ok ? (b.evaluation?.verdict ?? "unavailable") : "unavailable";
        const d = VERDICT_ORDER[av] - VERDICT_ORDER[bv];
        return d !== 0 ? d : a.storeId.localeCompare(b.storeId);
      });
  }, [sweep, filter, query]);

  const active = useMemo(() => {
    if (!selectedStore) return null;
    return sweep?.find((s) => s.storeId === selectedStore) ?? null;
  }, [sweep, selectedStore]);

  // 选中门店变化时拉可比门店。这里每次只拉一家，与驾驶舱的全量扫描不同 ——
  // 全量扫描是成本问题，明细页多跑一次是必要的，因为要拿到 excluded 与逐指标明细。
  useEffect(() => {
    if (!active) {
      setPeerResult(null);
      setPeerStatus("idle");
      return;
    }
    let alive = true;
    setPeerStatus("loading");
    (async () => {
      const r = await dataset.dl.comparePeers({ store_id: active.storeId });
      if (!alive) return;
      setPeerResult(r);
      setPeerStatus(r.status === "failed" ? "failed" : "done");
    })();
    return () => {
      alive = false;
    };
  }, [dataset.dl, active]);

  const counts = useMemo(() => {
    const c = { possible: 0, insufficient: 0, none: 0, unavailable: 0 };
    for (const r of sweep ?? []) {
      const v = r.ok ? (r.evaluation?.verdict ?? "unavailable") : "unavailable";
      if (c[v] !== undefined) c[v] += 1;
    }
    return c;
  }, [sweep]);

  return (
    <div className="page audit-page">
      <div className="audit-layout">
        {/* -------- 门店列表 -------- */}
        <div className="audit-list">
          <div className="list-tools">
            <div className="search-box">
              <Search size={14} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="门店号或区域"
                aria-label="搜索门店"
              />
            </div>
            <div className="seg is-tight">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={filter === f.key ? "is-on" : ""}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  {f.key !== "all" ? <em>{counts[f.key] ?? 0}</em> : null}
                </button>
              ))}
            </div>
          </div>

          {!sweep ? (
            <EmptyState title="正在逐店审计" />
          ) : rows.length === 0 ? (
            <EmptyState title="没有匹配的门店">换一个筛选条件试试。</EmptyState>
          ) : (
            <ul className="store-list">
              {rows.map((r) => {
                const risk = !r.ok ? "unavailable" : verdictRisk(r.evaluation?.verdict);
                const meta = RISK[risk];
                const ev = r.evaluation;
                return (
                  <li key={r.storeId}>
                    <button
                      className={`store-row ${selectedStore === r.storeId ? "is-active" : ""}`}
                      onClick={() => onSelectStore(r.storeId)}
                    >
                      <span className="row-bar" style={{ background: meta.color }} />
                      <span className="row-id">{r.storeId}</span>
                      <span className="row-region">
                        {r.region}
                        <em>{r.grade}</em>
                      </span>
                      <span className="row-hits">
                        {ev ? (
                          <>
                            <b style={{ color: meta.color }}>
                              {ev.hit_count}/{ev.conditions.length}
                            </b>
                            <em>命中</em>
                          </>
                        ) : (
                          <em className="muted">无结论</em>
                        )}
                      </span>
                      <span className="row-status" style={{ color: meta.color }}>
                        {meta.short}
                      </span>
                      <ChevronRight size={14} className="row-caret" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* -------- 明细 -------- */}
        <div className="audit-detail">
          {!active ? (
            <div className="panel-placeholder">从左边选一家门店。</div>
          ) : !active.ok ? (
            <CallFailed
              result={active.result}
              what={`${active.storeId} 的审计`}
            />
          ) : (
            <StoreDetail
              row={active}
              peerResult={peerResult}
              peerStatus={peerStatus}
              onEvidence={onEvidence}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function StoreDetail({ row, peerResult, peerStatus, onEvidence }) {
  const ev = row.evaluation;
  const risk = verdictRisk(ev.verdict);
  const meta = RISK[risk];
  const cmp = peerResult?.data ?? null;

  return (
    <div className="panel">
      <header className="panel-head">
        <div>
          <span className="kicker">
            {ev.definition} / {ev.decision}
          </span>
          <h3>
            {ev.subject.store_id}
            <span className="panel-sub">
              {ev.subject.region} · {ev.subject.grade}
            </span>
          </h3>
        </div>
        <RiskBadge risk={risk} large />
      </header>

      {/* 结论一句话。这句话是数据层给的，前端不改写 —— 措辞一旦在这里被润色，
          就再也回不到证据链上了。 */}
      <blockquote className="verdict-quote" style={{ borderColor: meta.color }}>
        <p>{ev.verdict_reason}</p>
        <footer>
          <span>判定窗口 {windowLabel(ev.window)}</span>
          <span>
            命中 {ev.hit_count} 条，阈值要求 ≥ 2 条（{ev.decision}）
          </span>
        </footer>
      </blockquote>

      {/* -------- 条件逐条 -------- */}
      <section className="panel-section">
        <h4>
          规则条件
          <span className="muted">未命中项也列出实值，方便判断「差多少」</span>
        </h4>
        <table className="cond-table">
          <thead>
            <tr>
              <th>条件</th>
              <th>实际</th>
              <th>判据</th>
              <th>严重度</th>
              <th>证据</th>
            </tr>
          </thead>
          <tbody>
            {ev.conditions.map((c) => (
              <tr key={c.id} className={c.skipped ? "is-skipped" : c.hit ? "is-hit" : ""}>
                <td>
                  <span className={`cond-mark ${c.skipped ? "is-skip" : c.hit ? "is-hit" : ""}`}>
                    {c.skipped ? "?" : c.hit ? "✓" : "·"}
                  </span>
                  {c.display_name}
                  <code className="cond-id">{c.id}</code>
                </td>
                <td className="is-num">{fmtByUnit(c.actual, c.unit)}</td>
                <td className="is-rule">
                  {OP_LABEL[c.op] ?? c.op} {fmtByUnit(c.threshold, c.unit)}
                </td>
                <td>
                  <Tag
                    color={c.severity === "high" ? "#C0392B" : c.severity === "medium" ? "#B98314" : "#5D6D7E"}
                    wash={c.severity === "high" ? "#F8E7E4" : c.severity === "medium" ? "#F7EFDD" : "#EDEFF2"}
                  >
                    {c.severity === "high" ? "高" : c.severity === "medium" ? "中" : "低"}
                  </Tag>
                </td>
                <td>
                  {c.skipped ? (
                    <span className="skip-note" title={c.skip_reason}>
                      {c.skip_reason ?? "数据缺失，未能判断"}
                    </span>
                  ) : c.evidence_id ? (
                    <code className="ev-id">{c.evidence_id}</code>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* -------- 可比门店 -------- */}
      <section className="panel-section">
        <h4>
          可比门店对比
          <span className="muted">同区域 · 同业态 · 排除本店</span>
        </h4>

        {peerStatus === "loading" ? (
          <EmptyState title="正在挑选可比门店" />
        ) : peerStatus === "failed" ? (
          <CallFailed result={peerResult} what="可比门店对比" />
        ) : !cmp ? (
          <EmptyState title="没有可比结果" />
        ) : (
          <>
            <div className="peer-summary">
              <div>
                <span>可比门店</span>
                <strong>
                  {cmp.peer_store_ids.length}
                  <em>/ 要求 {cmp.min_peers_required}</em>
                </strong>
              </div>
              <div>
                <span>整体可比性</span>
                <strong style={{ color: cmp.peer_sufficient ? "#4C7C99" : "#B98314" }}>
                  {cmp.peer_sufficient ? "充足" : "不足"}
                </strong>
              </div>
              <div>
                <span>可出排名</span>
                <strong style={{ color: cmp.ready_for_ranking ? "#4C7C99" : "#8A96A3" }}>
                  {cmp.ready_for_ranking ? "是" : "否"}
                </strong>
              </div>
              <div>
                <span>可比门店</span>
                <div className="peer-ids">
                  {cmp.peer_store_ids.length
                    ? cmp.peer_store_ids.map((id) => <code key={id}>{id}</code>)
                    : "—"}
                </div>
              </div>
            </div>

            {peerResult.warnings?.length ? <Warnings items={peerResult.warnings} /> : null}

            <table className="peer-table">
              <thead>
                <tr>
                  <th>指标</th>
                  <th>本店</th>
                  <th>可比中位</th>
                  <th>区间</th>
                  <th>偏离</th>
                  <th>排名</th>
                  <th>可比数</th>
                </tr>
              </thead>
              <tbody>
                {cmp.metrics.map((m) => {
                  // 偏离只对百分比类指标有意义；金额类指标之间做差不直观，
                  // 所以这里只在中位存在时给出绝对差的方向，不做「好/坏」着色 ——
                  // 方向好坏取决于指标本身，前端不该替它下判断。
                  const dev =
                    m.subject_value !== null && m.peer_median !== null
                      ? m.subject_value - m.peer_median
                      : null;
                  return (
                    <tr key={m.metric_code}>
                      <td>
                        {m.metric_code}
                        <em className="muted"> {m.unit === "percent" ? "%" : m.unit === "currency" ? "¥" : ""}</em>
                      </td>
                      <td className="is-num">{fmtByUnit(m.subject_value, m.unit)}</td>
                      <td className="is-num">{fmtByUnit(m.peer_median, m.unit)}</td>
                      <td className="is-num is-range">
                        {fmtByUnit(m.peer_min, m.unit)} ~ {fmtByUnit(m.peer_max, m.unit)}
                      </td>
                      <td className="is-num">
                        {dev === null ? (
                          "—"
                        ) : (
                          <span className={dev < 0 ? "is-down" : dev > 0 ? "is-up" : ""}>
                            {fmtByUnit(dev, m.unit === "currency" ? "currency" : m.unit)}
                          </span>
                        )}
                      </td>
                      <td className="is-num">
                        {m.peer_sufficient && m.rank !== null ? (
                          <>
                            {m.rank}
                            <em className="muted">/{m.peer_count}</em>
                          </>
                        ) : (
                          <span
                            className="muted"
                            title="该指标可比门店不足，契约规定不得展示排名"
                          >
                            不出排名
                          </span>
                        )}
                      </td>
                      <td className="is-num">
                        {m.peer_count}
                        {m.dropped_for_this_metric.length ? (
                          <em
                            className="muted"
                            title={`因本指标缺数被排除：${m.dropped_for_this_metric.join("、")}`}
                          >
                            {" "}
                            剔 {m.dropped_for_this_metric.length}
                          </em>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {cmp.excluded.length ? (
              <details className="excluded">
                <summary>被排除的门店（{cmp.excluded.length}）</summary>
                <ul>
                  {cmp.excluded.map((e) => (
                    <li key={e.store_id}>
                      <code>{e.store_id}</code>
                      {e.reason}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            <p className="footnote">
              同一家门店的退款数据可能断报，但它对销售指标依然合格 ——
              所以可比性是<b>逐指标</b>判断的，不是「整体剔除」。
            </p>
          </>
        )}
      </section>

      {/* -------- 建议动作 -------- */}
      {ev.suggested_action_template ? (
        <section className="panel-section">
          <h4>
            建议动作
            <span className="muted">数据层给出的模板，Agent 只能引用或改写</span>
          </h4>
          <p className="action-template">{ev.suggested_action_template}</p>
          {ev.recommend_escalate ? (
            <Tag color="#C0392B" wash="#F8E7E4">
              建议升级人工复核
            </Tag>
          ) : null}
        </section>
      ) : null}

      <div className="panel-actions">
        <EvidenceButton
          onClick={() =>
            onEvidence({
              title: `${ev.subject.store_id} ${ev.definition}`,
              traceId: ev.trace_id,
              dataVersion: ev.data_version,
              evidenceIds: [...ev.evidence_ids, ...(cmp?.evidence_ids ?? [])],
              warnings: peerResult?.warnings,
            })
          }
        />
      </div>

      <p className="disclaimer">
        判定基于当前规则版本 {ev.definition} 与窗口 {windowLabel(ev.window)} 内的可比数据。
        「证据不足」不等于正常，「无法判断」不等于没有问题。
      </p>
    </div>
  );
}
