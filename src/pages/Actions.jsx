/**
 * 经营行动中心
 *
 * 这一页把判定变成待办。关键的设计约束是**不许凭空发明动作**：
 * 每条行动的理由和动作类型都来自规则引擎的 suggested_action_template 与
 * verdict_reason，前端只做三件事 —— 排序、归类、记录人在界面上的推进状态。
 *
 * 关于状态的诚实说明：本仓库没有任务持久化后端（supabase/init.sql 里也没有
 * 行动表），所以「处理中 / 已闭环」只存在于当前会话的内存里，刷新即失效。
 * 界面上必须把这句话写出来，否则用户会以为自己的操作被保存了。
 * 这也是为什么第一列不用「待办」而用「待派发」——它在系统里还不存在。
 */

import React, { useMemo, useState } from "react";
import { ArrowRight, RotateCcw, AlertTriangle } from "lucide-react";
import {
  RISK,
  verdictRisk,
  RiskBadge,
  Tag,
  EmptyState,
  windowLabel,
} from "../ui/primitives";
import { regionHint } from "../data/datasets";

const LANES = [
  {
    key: "open",
    title: "待派发",
    hint: "由判定自动生成，系统里还没有这条任务",
  },
  {
    key: "doing",
    title: "处理中",
    hint: "本会话内的推进，未持久化",
  },
  {
    key: "done",
    title: "已闭环",
    hint: "本会话内的推进，未持久化",
  },
];

/**
 * 优先级：先把「疑似」里命中高严重度条件的挑出来，再看缺口大小。
 *
 * 为什么不用「分数越高越优先」这种简单排序：命中两条中等条件的店，
 * 和命中一条高严重度条件的店，处置成本完全不同 —— 后者更可能是一个
 * 单点故障（比如设备离线），前者更像趋势性下滑，需要观察而不是立刻动手。
 */
function severityOf(row) {
  const conditions = row.evaluation?.conditions ?? [];
  const hits = conditions.filter((c) => c.hit);
  const weights = { high: 3, medium: 2, low: 1 };
  const score = hits.reduce((s, c) => s + (weights[c.severity] ?? 1), 0);
  return {
    score,
    highHits: hits.filter((c) => c.severity === "high").length,
    hits,
  };
}

export default function ActionsPage({ dataset, window: win, sweep, onSelectStore }) {
  const [status, setStatus] = useState({}); // storeId -> lane
  const [regionFilter, setRegionFilter] = useState("");

  /**
   * 只把「疑似」和「证据不足」变成行动。
   * 正常的店不进这一页 —— 把 21 家店全列成待办，等于没有待办。
   */
  const items = useMemo(() => {
    if (!sweep) return [];
    return sweep
      .filter((r) => r.ok && (r.evaluation?.verdict === "possible" || r.evaluation?.verdict === "insufficient"))
      .filter((r) => !regionFilter || r.region === regionFilter)
      .map((r) => {
        const sev = severityOf(r);
        return {
          ...r,
          sev,
          lane: status[r.storeId] ?? "open",
          action: r.evaluation?.suggested_action_template ?? null,
          reason: r.evaluation?.verdict_reason ?? "",
        };
      })
      .sort((a, b) => {
        const aPossible = a.evaluation?.verdict === "possible" ? 0 : 1;
        const bPossible = b.evaluation?.verdict === "possible" ? 0 : 1;
        if (aPossible !== bPossible) return aPossible - bPossible;
        if (b.sev.score !== a.sev.score) return b.sev.score - a.sev.score;
        return a.storeId.localeCompare(b.storeId);
      });
  }, [sweep, status, regionFilter]);

  const laneItems = (lane) => items.filter((i) => i.lane === lane);

  function advance(storeId) {
    setStatus((cur) => {
      const now = cur[storeId] ?? "open";
      const next = now === "open" ? "doing" : now === "doing" ? "done" : "open";
      return { ...cur, [storeId]: next };
    });
  }

  const regionCodes = [...new Set((sweep ?? []).map((s) => s.region))].sort();
  const possibleCount = items.filter((i) => i.evaluation?.verdict === "possible").length;

  return (
    <div className="page actions-page">
      <div className="control-bar">
        <div className="control-group">
          <span className="control-label">区域</span>
          <div className="seg">
            <button className={regionFilter === "" ? "is-on" : ""} onClick={() => setRegionFilter("")}>
              全部
            </button>
            {regionCodes.map((r) => (
              <button
                key={r}
                className={regionFilter === r ? "is-on" : ""}
                onClick={() => setRegionFilter(r)}
                title={regionHint(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="control-note">
          {items.length} 条行动 · 其中 {possibleCount} 条来自「疑似异常」 · 窗口 {windowLabel(win)}
        </div>
        <button
          className="text-btn"
          onClick={() => setStatus({})}
          disabled={Object.keys(status).length === 0}
        >
          <RotateCcw size={13} />
          重置推进状态
        </button>
      </div>

      <div className="persistence-warning">
        <AlertTriangle size={14} />
        <span>
          推进状态只保存在当前页面内存里，刷新即丢失 —— 本仓库没有行动表，不伪造持久化。
          判定与建议动作本身来自数据层，不会丢失。
        </span>
      </div>

      {!sweep ? (
        <EmptyState title="正在生成行动" />
      ) : items.length === 0 ? (
        <EmptyState title="当前没有需要派发的行动">
          所有门店都不在「疑似异常」或「证据不足」状态。注意这表示<b>没有发现</b>，
          不等于<b>一切正常</b> —— 无法判断的门店不在这一页。
        </EmptyState>
      ) : (
        <div className="lanes">
          {LANES.map((lane) => {
            const list = laneItems(lane.key);
            return (
              <div className="lane" key={lane.key}>
                <header className="lane-head">
                  <h3>
                    {lane.title}
                    <em>{list.length}</em>
                  </h3>
                  <p>{lane.hint}</p>
                </header>
                <div className="lane-body">
                  {list.length === 0 ? (
                    <div className="lane-empty">空</div>
                  ) : (
                    list.map((item) => {
                      const risk = verdictRisk(item.evaluation.verdict);
                      const meta = RISK[risk];
                      return (
                        <article
                          className={`action-card risk-${risk}`}
                          key={item.storeId}
                          style={{ borderLeftColor: meta.color }}
                        >
                          <header>
                            <button
                              className="card-store"
                              onClick={() => onSelectStore(item.storeId)}
                              title="打开审计明细"
                            >
                              {item.storeId}
                            </button>
                            <span className="card-region">
                              {item.region}
                              <em>{item.grade}</em>
                            </span>
                            <span className="card-sev" title={`命中权重 ${item.sev.score}`}>
                              {item.sev.highHits > 0 ? (
                                <Tag color="#C0392B" wash="#F8E7E4">
                                  {item.sev.highHits} 项高严重度
                                </Tag>
                              ) : (
                                <Tag>{item.sev.hits.length} 项命中</Tag>
                              )}
                            </span>
                          </header>

                          <p className="card-reason">{item.reason}</p>

                          {item.action ? (
                            <p className="card-action">
                              <ArrowRight size={12} />
                              {item.action}
                            </p>
                          ) : (
                            <p className="card-action is-none">数据层没有给出建议动作模板</p>
                          )}

                          <div className="card-cond">
                            {item.sev.hits.map((c) => (
                              <span key={c.id} className="cond-pill" title={`${c.id} ${c.op} ${c.threshold}`}>
                                {c.display_name}
                              </span>
                            ))}
                          </div>

                          <footer>
                            <RiskBadge risk={risk} />
                            <button className="card-advance" onClick={() => advance(item.storeId)}>
                              {item.lane === "open"
                                ? "开始处理"
                                : item.lane === "doing"
                                  ? "标记闭环"
                                  : "退回待派发"}
                            </button>
                          </footer>
                        </article>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="footnote">
        排序规则：先按判定（疑似在观察之前），再按命中条件的严重度权重之和。
        没有采用「分数高者优先」，因为一条高严重度单点故障的价值不等于两条中等趋势项之和。
      </p>
    </div>
  );
}
