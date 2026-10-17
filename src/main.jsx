/**
 * 应用外壳。
 *
 * 职责只有四件，全部围绕一个原则：**数据层的失败必须在界面上可见**。
 *
 *   1. 载入两份 CSV，失败就把原因和下一步操作直接印在页面上（不显示空图表）
 *   2. 全店审计扫描一次，五个页面共用同一批 trace_id（详见 datasets.js）
 *   3. 五页切换 + 一个全局证据抽屉
 *   4. 页面外壳的「口径条」：窗口、数据版本、门店数、加载状态
 *
 * 为什么外壳不放业务状态：五个页面各有各的筛选，任何共享状态都会让
 * 「驾驶舱选了 C1，切到审计中心发现还在 C1」这类误会发生。共享的只有
 * 数据集、扫描结果、当前选中门店这三样 —— 它们确实需要跨页一致。
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  ShieldAlert,
  Radar,
  Bot,
  ListChecks,
  Database,
  Loader2,
  PackageX,
} from "lucide-react";

import { loadDataset, sweepPortfolio } from "./data/datasets";
import { EvidenceDrawer, windowLabel } from "./ui/primitives";
import DashboardPage from "./pages/Dashboard";
import AuditPage from "./pages/Audit";
import RegionsPage from "./pages/Regions";
import WorkbenchPage from "./pages/Workbench";
import ActionsPage from "./pages/Actions";
import "./styles.css";

const PAGES = [
  {
    key: "dashboard",
    name: "经营驾驶舱",
    icon: LayoutDashboard,
    lead: "21 家店现在什么样，先看哪儿",
    blurb: "规模指标 · 日序列 · 判定格阵",
  },
  {
    key: "audit",
    name: "智能审计中心",
    icon: ShieldAlert,
    lead: "判定凭什么成立",
    blurb: "条件逐条 · 可比门店 · 证据链",
  },
  {
    key: "regions",
    name: "区域投放决策",
    icon: Radar,
    lead: "往哪儿投，比一比",
    blurb: "星图总览 · 分项拆解 · 区域比对",
  },
  {
    key: "workbench",
    name: "Agent 决策工作台",
    icon: Bot,
    lead: "把一次决策摊开看",
    blurb: "工具调用 · 计算时间线 · 口径自检",
  },
  {
    key: "actions",
    name: "经营行动中心",
    icon: ListChecks,
    lead: "结论变成待办",
    blurb: "按严重度排序 · 推进状态",
  },
];

function App() {
  const [boot, setBoot] = useState({ phase: "loading" });
  const [page, setPage] = useState("dashboard");
  const [sweep, setSweep] = useState(null);
  const [sweepError, setSweepError] = useState(null);
  const [selectedStore, setSelectedStore] = useState(null);
  const [drawer, setDrawer] = useState(null);

  // --- 载入并扫描 ---
  useEffect(() => {
    let alive = true;
    (async () => {
      const ds = await loadDataset();
      if (!alive) return;
      if (!ds.ok) {
        setBoot({ phase: "no-data", reason: ds.reason, detail: ds.detail });
        return;
      }
      setBoot({ phase: "sweeping", dataset: ds });
      try {
        const results = await sweepPortfolio(ds.dl, ds.stores);
        if (!alive) return;
        setSweep(results);
        setBoot({ phase: "ready", dataset: ds });
      } catch (error) {
        if (!alive) return;
        setSweepError(`全店审计扫描失败：${error?.message ?? error}`);
        setBoot({ phase: "ready", dataset: ds });
        setSweep([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const openEvidence = useCallback((payload) => setDrawer(payload), []);

  const dataset = boot.dataset ?? null;
  const active = PAGES.find((p) => p.key === page) ?? PAGES[0];

  const pageProps = useMemo(
    () => ({
      dataset,
      sweep,
      window: dataset?.window,
      selectedStore,
      onSelectStore: (id) => {
        setSelectedStore(id);
        if (page !== "audit") setPage("audit");
      },
      onEvidence: openEvidence,
    }),
    [dataset, sweep, selectedStore, page, openEvidence],
  );

  // ------------------------------------------------------------------ 无数据
  if (boot.phase === "no-data") {
    return (
      <div className="boot-screen">
        <div className="boot-card">
          <PackageX size={26} />
          <h1>数据文件还没有生成</h1>
          <p className="boot-lead">
            这个前端不含任何写死的数字。五个页面全部由 <code>data/</code> 下的两份 CSV 驱动，
            文件不在，就没有可显示的内容 —— 这是刻意的，防止演示时把假的当成真的。
          </p>
          <pre className="boot-cmd">python data/_generate.py</pre>
          <p className="boot-detail">{boot.detail}</p>
          <ul className="boot-steps">
            <li>
              在仓库根目录运行上面这条命令，会按固定随机种子生成 21 店 × 42 天的
              <code> store_operations_daily.csv</code>。
            </li>
            <li>
              再确认 <code>data/region_cost_input.csv</code> 存在（这个文件是提交进仓库的，不需要生成）。
            </li>
            <li>刷新本页即可。生成器是确定性的，同一份脚本跑出来的异常门店永远是 S001 与 S005。</li>
          </ul>
        </div>
      </div>
    );
  }

  const loading = boot.phase === "loading" || boot.phase === "sweeping";

  return (
    <div className="app">
      {/* -------- 左侧图标栏 -------- */}
      <nav className="rail" aria-label="主导航">
        <div className="rail-mark" title="莱森购 · 经营风险侦察">
          莱
        </div>
        {PAGES.map((p) => {
          const Icon = p.icon;
          return (
            <button
              key={p.key}
              className={`rail-btn ${page === p.key ? "is-on" : ""}`}
              onClick={() => setPage(p.key)}
              aria-current={page === p.key ? "page" : undefined}
              title={p.name}
            >
              <Icon size={19} />
              <span className="rail-tip">{p.name}</span>
            </button>
          );
        })}
        <div className="rail-foot" title="数据来源">
          <Database size={16} />
        </div>
      </nav>

      {/* -------- 主体 -------- */}
      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{active.name}</h1>
            <p>{active.lead}</p>
          </div>

          <div className="topbar-meta">
            <MetaItem label="窗口" value={windowLabel(dataset?.window)} />
            <MetaItem label="数据版本" value="demo_v1" mono />
            <MetaItem label="门店" value={dataset ? `${dataset.stores.length} 家` : "—"} />
            <MetaItem
              label="扫描"
              value={
                boot.phase === "sweeping" ? (
                  <span className="inline-busy">
                    <Loader2 size={12} className="spin" />
                    进行中
                  </span>
                ) : sweep ? (
                  `${sweep.filter((s) => s.evaluation?.verdict === "possible").length} 疑似 / ${sweep.length} 已审`
                ) : (
                  "—"
                )
              }
            />
          </div>
        </header>

        {sweepError ? <div className="banner is-error">{sweepError}</div> : null}

        <main className="content">
          {loading && page !== "regions" ? (
            <div className="boot-inline">
              <Loader2 size={16} className="spin" />
              <span>
                正在载入 {dataset?.rowCount?.toLocaleString("zh-CN") ?? ""} 行门店日数据并逐店审计…
              </span>
            </div>
          ) : null}

          {page === "dashboard" ? <DashboardPage {...pageProps} /> : null}
          {page === "audit" ? <AuditPage {...pageProps} /> : null}
          {page === "regions" ? <RegionsPage {...pageProps} /> : null}
          {page === "workbench" ? <WorkbenchPage {...pageProps} /> : null}
          {page === "actions" ? <ActionsPage {...pageProps} /> : null}
        </main>

        <footer className="footbar">
          <span>
            {active.blurb} · 数据 {dataset?.opsPath ?? "—"}（{dataset?.rowCount?.toLocaleString("zh-CN") ?? 0} 行）
            + {dataset?.costPath ?? "—"}
          </span>
          <span className="footbar-right">
            每个数字都可沿 evidence_id → trace_id 回放到所属计算 · 估值口径为假设，非观测值
          </span>
        </footer>
      </div>

      <EvidenceDrawer
        open={Boolean(drawer)}
        onClose={() => setDrawer(null)}
        title={drawer?.title ?? ""}
        traceId={drawer?.traceId}
        dataVersion={drawer?.dataVersion}
        events={drawer?.events}
        evidenceIds={drawer?.evidenceIds}
        warnings={drawer?.warnings}
      />
    </div>
  );
}

function MetaItem({ label, value, mono = false }) {
  return (
    <div className="meta-item">
      <span>{label}</span>
      <strong className={mono ? "is-mono" : ""}>{value}</strong>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
