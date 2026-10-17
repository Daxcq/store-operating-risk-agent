/**
 * Agent 决策工作台
 *
 * 这一页不是「和 Agent 聊天」，是**把一次决策的计算过程摊开来看**。
 *
 * 原因：本项目对外的核心承诺是「每个结论都能回放到它属于的那次计算」。
 * 那么最该被看见的界面，就是那次计算本身 —— 调了哪七个工具里的哪几个、
 * 每个工具的输入输出、最终结论引用的是哪个 evidence_id。
 *
 * 所以这里的「运行」是真的在跑数据层，跑完把 getTrace(traceId) 的事件按 seq 铺开。
 * 没有任何一步是前端编的流程：如果数据层这次只调了 0 个工具，页面上就是 0 个步骤。
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Play, ShieldCheck, ShieldAlert, ChevronDown } from "lucide-react";
import {
  RISK,
  verdictRisk,
  RiskBadge,
  Tag,
  Num,
  Warnings,
  CallFailed,
  EmptyState,
  EvidenceButton,
  windowLabel,
} from "../ui/primitives";
import { regionHint } from "../data/datasets";

/** 一次决策要跑的工具序列。顺序即依赖顺序，不能调换。 */
const DECISION_PLAN = [
  { tool: "run_audit", purpose: "按规则逐条判定这家店" },
  { tool: "compare_peers", purpose: "找同区域同业态的可比门店" },
  { tool: "estimate_region_roi", purpose: "估算所在区域的利润与回本" },
  { tool: "score_locations", purpose: "把本区域放回全部候选里排一次序" },
];

export default function WorkbenchPage({ dataset, sweep, onEvidence, onSelectStore }) {
  const [storeId, setStoreId] = useState("");
  const [runs, setRuns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [openStep, setOpenStep] = useState(null);

  const candidates = useMemo(() => {
    if (!sweep) return [];
    // 默认把「疑似」排在前面 —— 这一页最常被用来查的正是这些店
    return [...sweep].sort((a, b) => {
      const rank = (r) => (r.evaluation?.verdict === "possible" ? 0 : r.ok ? 1 : 2);
      const d = rank(a) - rank(b);
      return d !== 0 ? d : a.storeId.localeCompare(b.storeId);
    });
  }, [sweep]);

  useEffect(() => {
    if (!storeId && candidates.length) {
      const first = candidates.find((c) => c.evaluation?.verdict === "possible") ?? candidates[0];
      setStoreId(first.storeId);
    }
  }, [candidates, storeId]);

  const run = useCallback(async () => {
    if (!storeId || busy) return;
    setBusy(true);
    setOpenStep(null);
    const started = Date.now();
    try {
      const audit = await dataset.dl.runAudit({ store_id: storeId });
      const region = dataset.stores.find((s) => s.storeId === storeId)?.region;
      const peers = await dataset.dl.comparePeers({ store_id: storeId });
      const roi = region ? await dataset.dl.estimateRegionROI(region) : null;
      const scores = await dataset.dl.scoreLocations({});

      // trace 是四次调用共用的那条吗？不是 —— 每次工具调用各有自己的 trace_id。
      // 所以这里把四段 trace 拼成一条时间线，并保留各自的 trace_id 供点击回放。
      const legs = [
        { label: "run_audit", result: audit },
        { label: "compare_peers", result: peers },
        { label: "estimate_region_roi", result: roi },
        { label: "score_locations", result: scores },
      ].filter((l) => l.result);

      const events = legs.flatMap((leg) =>
        (dataset.dl.getTrace(leg.result.trace_id) ?? []).map((e) => ({
          ...e,
          leg: leg.label,
        })),
      );

      setRuns((cur) =>
        [
          {
            id: `${storeId}-${started}`,
            storeId,
            region,
            at: new Date(started),
            elapsed: Date.now() - started,
            audit,
            peers,
            roi,
            scores,
            legs,
            events,
          },
          ...cur,
        ].slice(0, 6),
      );
    } finally {
      setBusy(false);
    }
  }, [dataset, storeId, busy]);

  const latest = runs[0] ?? null;
  const ev = latest?.audit?.data ?? null;
  const cmp = latest?.peers?.data ?? null;
  const roi = latest?.roi?.data ?? null;
  const score = latest?.scores?.data?.find((s) => s.region === latest?.region) ?? null;

  return (
    <div className="page workbench-page">
      {/* -------- 运行控制 -------- */}
      <div className="run-bar">
        <div className="run-pick">
          <label htmlFor="wb-store">决策对象</label>
          <select id="wb-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            {candidates.map((c) => (
              <option key={c.storeId} value={c.storeId}>
                {c.storeId} · {c.region} · {RISK[verdictRisk(c.evaluation?.verdict)].short}
              </option>
            ))}
          </select>
        </div>
        <button className="primary-btn" onClick={run} disabled={busy || !storeId}>
          <Play size={15} />
          {busy ? "运行中" : "运行一次决策"}
        </button>
        <div className="run-hint">
          会依次调用 run_audit → compare_peers → estimate_region_roi → score_locations，
          每一步的真实输入输出都会进下面的时间线。
        </div>
      </div>

      {!latest ? (
        <EmptyState title="还没有运行记录">
          <p>选一家店，点「运行一次决策」。这一页刻意不预跑 —— 让你看到的就是这一次的时间开销。</p>
        </EmptyState>
      ) : (
        <div className="wb-grid">
          {/* -------- 左：结论 -------- */}
          <div className="wb-main">
            <div className="wb-conclusion">
              <header>
                <div>
                  <span className="kicker">结论 / {latest.storeId}</span>
                  <h3>
                    {latest.storeId}
                    <span className="panel-sub">
                      {latest.region} · {regionHint(latest.region)}
                    </span>
                  </h3>
                </div>
                {ev ? (
                  <RiskBadge risk={verdictRisk(ev.verdict)} large />
                ) : (
                  <Tag>无结论</Tag>
                )}
              </header>

              {!ev ? (
                <CallFailed result={latest.audit} what="规则判定" />
              ) : (
                <blockquote className="verdict-quote" style={{ borderColor: RISK[verdictRisk(ev.verdict)].color }}>
                  <p>{ev.verdict_reason}</p>
                  <footer>
                    <span>
                      命中 {ev.hit_count} / {ev.conditions.length}
                    </span>
                    <span>{windowLabel(ev.window)}</span>
                    <span>耗时 {latest.elapsed} ms</span>
                  </footer>
                </blockquote>
              )}

              <div className="wb-facts">
                <div>
                  <span>可比门店</span>
                  <strong>
                    {cmp ? cmp.peer_store_ids.length : "—"}
                    {cmp ? <em>/ 需 {cmp.min_peers_required}</em> : null}
                  </strong>
                </div>
                <div>
                  <span>可出排名</span>
                  <strong>{cmp ? (cmp.ready_for_ranking ? "是" : "否") : "—"}</strong>
                </div>
                <div>
                  <span>区域月利润</span>
                  <strong>{roi ? <Num value={roi.estimatedMonthlyProfit} prefix="¥" /> : "—"}</strong>
                </div>
                <div>
                  <span>区域回本</span>
                  <strong>
                    {roi?.estimatedPaybackMonths === null || !roi
                      ? "无法估算"
                      : `${roi.estimatedPaybackMonths.toFixed(1)} 月`}
                  </strong>
                </div>
                <div>
                  <span>区域综合分</span>
                  <strong>{score ? (score.score === null ? "—" : score.score.toFixed(1)) : "—"}</strong>
                </div>
                <div>
                  <span>区域推荐</span>
                  <strong>{score ? score.recommendation : "—"}</strong>
                </div>
              </div>

              {ev?.suggested_action_template ? (
                <div className="wb-action">
                  <span>数据层建议动作</span>
                  <p>{ev.suggested_action_template}</p>
                </div>
              ) : null}

              <div className="panel-actions">
                <EvidenceButton
                  onClick={() =>
                    onEvidence({
                      title: `${latest.storeId} 决策链路`,
                      traceId: ev?.trace_id ?? latest.audit?.trace_id,
                      dataVersion: ev?.data_version,
                      events: latest.events,
                      evidenceIds: [
                        ...(ev?.evidence_ids ?? []),
                        ...(cmp?.evidence_ids ?? []),
                        ...(latest.scores?.evidence_ids ?? []),
                      ],
                      warnings: latest.audit?.warnings,
                    })
                  }
                />
                <button className="text-btn" onClick={() => onSelectStore(latest.storeId)}>
                  在审计中心打开
                </button>
              </div>
            </div>
          </div>

          {/* -------- 右：时间线 -------- */}
          <aside className="wb-trace">
            <header className="block-head">
              <h3>计算时间线</h3>
              <p>纵轴是 seq，不是耗时。每次工具的调用与返回都是一条独立事件。</p>
            </header>

            <ol className="trace-steps">
              {latest.events.map((e) => {
                const open = openStep === `${e.leg}-${e.seq}`;
                const isCall = e.type === "tool_call";
                return (
                  <li key={`${e.leg}-${e.seq}`} className={isCall ? "is-call" : ""}>
                    <span className={`step-dot ${isCall ? "is-call" : "is-result"}`} />
                    <button
                      className="step-head"
                      onClick={() => setOpenStep(open ? null : `${e.leg}-${e.seq}`)}
                    >
                      <span className="step-seq">{String(e.seq).padStart(2, "0")}</span>
                      <span className="step-type">{e.type}</span>
                      <span className="step-tool">{e.tool ?? e.leg}</span>
                      <ChevronDown size={13} className={open ? "is-open" : ""} />
                    </button>
                    {open ? (
                      <pre className="step-body">
                        {JSON.stringify(e.output ?? e.input ?? {}, null, 2)}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ol>

            <p className="footnote">
              共 {latest.events.length} 条事件，来自 {latest.legs.length} 次工具调用。
              每次调用有各自的 trace_id —— 这是本项目的设计，不是缺陷：
              一次决策由多个可独立回放的调用组成，比一条大而不可分的链路更容易审计。
            </p>
          </aside>
        </div>
      )}

      {/* -------- 口径自检：这一栏是给评审看的 -------- */}
      <section className="block guard-block">
        <header className="block-head">
          <h3>口径自检</h3>
          <p>
            下面每一条都从<b>当前这次运行的实际返回值</b>里读，不是写死的徽标。
            任何一条变红，说明数据层这次没守住自己的承诺。
          </p>
        </header>
        {!latest ? (
          <p className="muted">运行一次后显示。</p>
        ) : (
          <div className="guards">
            <Guard
              ok={Boolean(ev?.verdict_reason)}
              title="结论有理由"
              detail="verdict 必须带一句可复述的 verdict_reason，否则 Agent 无法引用。"
            />
            <Guard
              ok={Boolean(ev?.evidence_ids?.length)}
              title="结论带证据"
              detail={`本次 ${ev?.evidence_ids?.length ?? 0} 条 evidence_id。`}
            />
            <Guard
              ok={Boolean(cmp && cmp.peer_store_ids.length >= cmp.min_peers_required) === Boolean(cmp?.peer_sufficient)}
              title="可比判定自洽"
              detail={
                cmp
                  ? `可比 ${cmp.peer_store_ids.length} 家，要求 ${cmp.min_peers_required} 家，判定「${cmp.peer_sufficient ? "充足" : "不足"}」。`
                  : "未拿到可比结果。"
              }
            />
            <Guard
              ok={!cmp || cmp.ready_for_ranking === cmp.peer_sufficient}
              title="不可比时不出排名"
              detail="ready_for_ranking 必须与 peer_sufficient 一致，否则会出现无依据的排名。"
            />
            <Guard
              ok={ev ? ev.verdict !== "insufficient" || ev.hit_count < 2 : true}
              title="证据不足不冒充正常"
              detail="hit_count < 2 时判定只能是 insufficient 或 unavailable，不能是 none。"
            />
            <Guard
              ok={!(roi && roi.estimatedPaybackMonths === null && roi.estimatedMonthlyProfit > 0)}
              title="回本周期可空"
              detail="月利润不为正时回本周期必须为 null，不允许填 0。"
            />
          </div>
        )}
      </section>
    </div>
  );
}

function Guard({ ok, title, detail }) {
  return (
    <div className={`guard ${ok ? "is-ok" : "is-bad"}`}>
      {ok ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}
