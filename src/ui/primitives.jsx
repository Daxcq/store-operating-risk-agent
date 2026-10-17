/**
 * 共享 UI 原子件。
 *
 * 这个文件存在的理由只有一个：**四种判定状态的措辞和颜色只允许在一处定义**。
 * 规则引擎的四值 (none/insufficient/possible/unavailable) 是这个项目的核心，
 * 如果每个页面各自写一遍「证据不足」的文案和色值，迟早会出现
 * A 页把 insufficient 画成灰、B 页画成绿的漂移 —— 而把「证据不足」
 * 画成绿色正是本项目最要避免的假阴性。
 */

import React from "react";
import { AlertTriangle, ChevronRight, CircleDashed, Info, X } from "lucide-react";

// ---------------------------------------------------------------------------
// 判定语言
// ---------------------------------------------------------------------------

/**
 * 风险温度阶梯，不是红绿灯。
 *
 * 四个色值按「离结论有多远」排布：
 *   霜蓝 运行正常      —— 有结论，且结论是好的
 *   赭   证据不足/观察 —— 有信号，但还不够下结论（最容易被误读成绿色的一档）
 *   朱   疑似异常      —— 有结论，且结论是坏的
 *   灰   无法判断      —— 没有结论，数据缺失（去饱和，因为「不知道」不刺眼，但它必须在场）
 */
export const RISK = {
  normal: { label: "运行正常", color: "#4C7C99", wash: "#E8EEF3", short: "正常" },
  watch: { label: "证据不足 · 待观察", color: "#B98314", wash: "#F7EFDD", short: "观察" },
  possible: { label: "疑似异常", color: "#C0392B", wash: "#F8E7E4", short: "疑似" },
  unavailable: { label: "无法判断", color: "#8A96A3", wash: "#EDEFF2", short: "缺数" },
};

/** RuleVerdict -> 展示档位。insufficient 故意并入 watch，理由见上文。 */
export function verdictRisk(verdict) {
  switch (verdict) {
    case "none":
      return "normal";
    case "insufficient":
      return "watch";
    case "possible":
      return "possible";
    case "unavailable":
      return "unavailable";
    default:
      return "unavailable";
  }
}

/** 区域推荐四档，与 LocationScore.recommendation 逐字对应 */
export const RECOMMENDATION = {
  推荐: { color: "#4C7C99", wash: "#E8EEF3" },
  继续调研: { color: "#B98314", wash: "#F7EFDD" },
  不建议: { color: "#C0392B", wash: "#F8E7E4" },
  数据不足: { color: "#8A96A3", wash: "#EDEFF2" },
};

/** 可信度三档 */
export const CONFIDENCE = {
  full: { label: "分项齐全", color: "#5D6D7E" },
  degraded: { label: "分项缺失，已按剩余权重重归一化", color: "#B98314" },
  low: { label: "可信度低", color: "#C0392B" },
};

// ---------------------------------------------------------------------------
// 基础排版件
// ---------------------------------------------------------------------------

/**
 * 页面外壳。每一页是一张「纸」：顶部一条细线，左边标题，右边实时口径。
 * 不用卡片阴影，不用圆角卡片矩阵 —— 这里的结构靠细划分割，不靠容器。
 */
export function Sheet({ title, kicker, meta, children, actions }) {
  return (
    <section className="sheet">
      <header className="sheet-head">
        <div className="sheet-title">
          <span className="kicker">{kicker}</span>
          <h2>{title}</h2>
        </div>
        <div className="sheet-meta">{meta}</div>
        {actions ? <div className="sheet-actions">{actions}</div> : null}
      </header>
      <div className="sheet-body">{children}</div>
    </section>
  );
}

/** 口径标签：等宽、小号、贴在最需要解释的数字旁边 */
export function Unit({ children }) {
  return <span className="unit">{children}</span>;
}

/**
 * 数值。null 一律渲染成破折号，绝不画成 0。
 * 这是数据层「分母为 0 或缺失返回 null」规则在界面上的最后一环：
 * 前面所有层都守住了 null，界面把它格式化成 0 就前功尽弃。
 */
export function Num({ value, digits = 0, prefix = "", suffix = "", scale = null }) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span className="num is-null" title="该值无法计算或数据缺失，不是 0">—</span>;
  }
  const v = scale ? value * scale : value;
  const text = v.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return (
    <span className="num">
      {prefix}
      {text}
      {suffix}
    </span>
  );
}

/** 变化率。方向色只表达「变好/变坏」，不表达「异常」。 */
export function Delta({ value, digits = 1, unit = "%", neutral = false }) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span className="num is-null">—</span>;
  }
  const tone = neutral ? "" : value < 0 ? "is-down" : value > 0 ? "is-up" : "";
  return (
    <span className={`num delta ${tone}`}>
      {value > 0 ? "+" : ""}
      {value.toFixed(digits)}
      {unit}
    </span>
  );
}

/** 判定徽标 */
export function RiskBadge({ risk, large = false }) {
  const meta = RISK[risk] ?? RISK.unavailable;
  return (
    <span
      className={`risk-badge ${large ? "is-large" : ""}`}
      style={{ color: meta.color, background: meta.wash }}
    >
      <span className="risk-dot" style={{ background: meta.color }} />
      {meta.label}
    </span>
  );
}

/** 通用小标签 */
export function Tag({ children, color = "#5D6D7E", wash = "#EDEFF2" }) {
  return (
    <span className="tag" style={{ color, background: wash }}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 状态件：加载 / 降级 / 失败 / 空
// ---------------------------------------------------------------------------

/**
 * ToolCallResult 的统一呈现。
 *
 * 三种 status 的语义差别必须在界面上看得出来，否则「失败」会被当成「没有异常」：
 *   succeeded —— 不出现
 *   degraded  —— 结论可能不完整，用赭色提示，但不拦住页面
 *   failed    —— 这一块没有数据，明确说没有，不留空白
 */
export function Warnings({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className="warnings">
      {items.map((w, i) => (
        <li key={i}>
          <Info size={13} />
          <span>{w}</span>
        </li>
      ))}
    </ul>
  );
}

export function CallFailed({ result, what }) {
  const reason = result?.warnings?.[0] ?? "数据层没有返回结果";
  return (
    <div className="state-block is-failed">
      <AlertTriangle size={16} />
      <div>
        <strong>{what}没有完成</strong>
        <p>{reason}</p>
      </div>
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="state-block is-empty">
      <CircleDashed size={18} />
      <div>
        <strong>{title}</strong>
        {children ? <p>{children}</p> : null}
      </div>
    </div>
  );
}

/** 骨架屏。加载中不要显示 0，也不要显示上一页的旧数字。 */
export function Skeleton({ rows = 3 }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <span key={i} style={{ width: `${88 - i * 12}%` }} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 证据抽屉
// ---------------------------------------------------------------------------

/**
 * 证据抽屉。
 *
 * 这个项目对外承诺「每一个数字都能沿 evidence_id -> trace_id 追回它所属的那次计算」，
 * 所以界面上任何一处结论都必须能打开这个抽屉。抽屉里只展示**确实来自数据层**的东西：
 * 证据编号、trace 事件、数据版本、警告。算出来的东西（比如「建议怎么做」）
 * 一律放在抽屉外面，避免把推断混进证据链。
 */
export function EvidenceDrawer({ open, onClose, title, traceId, dataVersion, events, evidenceIds, warnings }) {
  if (!open) return null;
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <span className="kicker">证据链 / TRACE</span>
            <h3>{title}</h3>
          </div>
          <button className="icon-btn" onClick={onClose} title="关闭">
            <X size={17} />
          </button>
        </header>

        <div className="drawer-ids">
          <div>
            <span>trace_id</span>
            <code>{traceId ?? "—"}</code>
          </div>
          <div>
            <span>data_version</span>
            <code>{dataVersion ?? "—"}</code>
          </div>
        </div>

        {warnings && warnings.length ? (
          <section className="drawer-section">
            <h4>数据层提示</h4>
            <Warnings items={warnings} />
          </section>
        ) : null}

        <section className="drawer-section">
          <h4>计算链路 {events && events.length ? `(${events.length})` : ""}</h4>
          {events && events.length ? (
            <ol className="trace-list">
              {events.map((ev) => (
                <li key={ev.seq}>
                  <span className="trace-seq">{String(ev.seq).padStart(2, "0")}</span>
                  <div>
                    <strong>{ev.type}</strong>
                    {ev.tool ? <em>{ev.tool}</em> : null}
                    <pre>{JSON.stringify(ev.output ?? ev.note ?? ev.input ?? {}, null, 2)}</pre>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">本次调用没有可回放的 trace 事件。</p>
          )}
        </section>

        {evidenceIds && evidenceIds.length ? (
          <section className="drawer-section">
            <h4>证据编号 ({evidenceIds.length})</h4>
            <div className="evidence-chips">
              {evidenceIds.map((id) => (
                <code key={id}>{id}</code>
              ))}
            </div>
          </section>
        ) : null}

        <footer className="drawer-foot">
          <p>
            链路上的每个编号都可以在数据层按 id 取回原始输入快照。本抽屉只展示数据层给出的内容，
            不含任何推断。
          </p>
        </footer>
      </aside>
    </div>
  );
}

/** 可点击的「查看证据」按钮，统一文案 */
export function EvidenceButton({ onClick, disabled = false }) {
  return (
    <button className="text-btn" onClick={onClick} disabled={disabled}>
      查看证据
      <ChevronRight size={13} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// 数值格式化
// ---------------------------------------------------------------------------

/** 人民币，整数带千分位 */
export function money(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `¥${value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** 紧凑人民币：12.5 万 / 3,200 */
export function moneyCompact(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 100000000) return `¥${(value / 100000000).toFixed(2)} 亿`;
  if (abs >= 10000) return `¥${(value / 10000).toFixed(1)} 万`;
  return `¥${Math.round(value).toLocaleString("zh-CN")}`;
}

/** 比例 0..1 -> "92.4%" */
export function percent(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/** 日期窗口 "2026-10-06 → 10-12" */
export function windowLabel(w) {
  if (!w) return "—";
  const short = (d) => d.slice(5);
  return `${w.from} → ${short(w.to)}`;
}
