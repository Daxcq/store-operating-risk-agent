"""四个契约函数（任务B）。

对应 docs/API_CONTRACT.md 冻结的 4 个后端函数，以及 src/agent/definition.js
里 TOOL_REGISTRY_META 的 domainFunction 映射：

    getDashboardMetrics(filters?)  <- get_dashboard
    auditOperations(filters?)      <- run_audit
    compareRegions(regionIds?)     <- compare_regions
    estimateRegionROI(regionId)    <- estimate_region_roi

分工铁律（TECHNICAL_ARCHITECTURE.md §6）：
    所有计算都在这里做完，LLM 只能解析意图、编排工具、组织语言。
    因此本模块返回的每个数字都是终值，不留给模型二次加工。

口径自检（对齐 PROJECT.md §10 验收脚本）：
    salesAmount      = 1054000   Σ current_7d.sales_amount
    estimatedProfit  = 218000    Σ region_market_inputs.estimated_period_profit
    deviceCount      = 42        Σ current_7d.device_count
    onlineRate       = 0.952     40/42，比率型 0..1，不是百分数
    openFindingCount = 3         口径由 config.OPEN_FINDINGS_MODE 控制
    A 店退款率        = 7.0%      12040/172000*100
    南关区 payback    = null      capex 缺失且 has_complete_cost_data = FALSE
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Sequence

from . import config
from .metrics import (
    compute_store_metrics,
    round_half_up,
    safe_ratio,
    sum_field,
)
from .repository import RepositoryError, SupabaseRepository, get_repository
from .rule_engine import (
    build_audit_summary,
    resolve_open_finding_count,
    run_audit,
    to_contract_finding,
)
from .wiki import WikiIndex, load_wiki


# ---------------------------------------------------------------------------
# 错误类型：与 API_CONTRACT.md §4 的错误码一一对应
# ---------------------------------------------------------------------------

ERROR_STATUS = {
    "INVALID_QUERY": 400,
    "REGION_NOT_FOUND": 404,
    "DEVICE_NOT_FOUND": 404,
    "INSUFFICIENT_DATA": 422,
    "INTERNAL_ERROR": 500,
}


class ContractError(RuntimeError):
    """带错误码和 HTTP 状态的契约异常。api 层直接照搬成错误信封。"""

    def __init__(self, code: str, message: str, status: int | None = None):
        super().__init__(message)
        self.code = code if code in ERROR_STATUS else "INTERNAL_ERROR"
        self.message = message
        self.status = status or ERROR_STATUS[self.code]

    def to_envelope(self) -> dict:
        """{error: {code, message}} —— 冻结形状，不要加字段。"""
        return {"error": {"code": self.code, "message": self.message}}


# ---------------------------------------------------------------------------
# 区域别名：前端/Agent 用中文提问，库里存的是拼音 id
# ---------------------------------------------------------------------------

REGION_ALIASES: dict[str, str] = {
    "chaoyang": "chaoyang", "朝阳": "chaoyang", "朝阳区": "chaoyang",
    "nanguan": "nanguan", "南关": "nanguan", "南关区": "nanguan",
    "kuancheng": "kuancheng", "宽城": "kuancheng", "宽城区": "kuancheng",
    "erdao": "erdao", "二道": "erdao", "二道区": "erdao",
    "luyuan": "luyuan", "绿园": "luyuan", "绿园区": "luyuan",
}

# 全市聚合的别名。compareRegions 传它相当于「不限定区域」。
CITY_ALIASES = {"长春", "长春市", "changchun", "all", "全市", "所有区域"}


def normalize_region_id(raw: str | None) -> str | None:
    """把用户输入的区域名归一化成 region_id。支持 '朝阳区'、'chaoyang'。"""
    if raw is None:
        return None
    key = str(raw).strip().lower()
    if not key:
        return None
    return REGION_ALIASES.get(key) or REGION_ALIASES.get(str(raw).strip())


def is_city_alias(raw: str | None) -> bool:
    if raw is None:
        return False
    return str(raw).strip().lower() in CITY_ALIASES


# ---------------------------------------------------------------------------
# 数据上下文：一次取数，四个函数共用
# ---------------------------------------------------------------------------

@dataclass
class DataContext:
    """把库里的行折叠成四个函数直接可用的形状。

    构造一次成本 = 3 个 SELECT。Agent 一轮里可能调多个工具，
    所以默认走进程级缓存（TTL 由 config.CONTEXT_TTL_SECONDS 控制）。
    """

    data_version: str
    store_metrics: list[dict] = field(default_factory=list)
    region_inputs: dict[str, dict] = field(default_factory=dict)
    wiki: WikiIndex | None = None
    raw_store_rows: list[dict] = field(default_factory=list)

    # -- 便捷访问 -----------------------------------------------------------

    def stores(self, region_ids: Sequence[str] | None = None) -> list[dict]:
        if not region_ids:
            return list(self.store_metrics)
        wanted = set(region_ids)
        return [m for m in self.store_metrics if m.get("region_id") in wanted]

    def region(self, region_id: str) -> dict | None:
        return self.region_inputs.get(region_id)

    def region_name(self, region_id: str) -> str:
        row = self.region_inputs.get(region_id)
        return (row or {}).get("name") or region_id


def build_context(
    repo: SupabaseRepository | None = None,
    data_version: str | None = None,
) -> DataContext:
    """从 Supabase 读全量 Demo 数据并算好门店级指标。

    Demo 数据只有 10 行门店行 + 5 行区域行 + 11 行 Wiki，
    一次全取比按需过滤更简单，也避免 PostgREST 多轮往返。
    """
    repo = repo or get_repository()
    version = data_version or config.DATA_VERSION

    raw_rows = repo.fetch_store_operations(version)
    region_rows = repo.fetch_region_inputs(version)
    wiki = load_wiki(repo, version)

    # 按 store_id 分组后计算指标。compute_store_metrics 认识 period_type。
    by_store: dict[str, list[dict]] = {}
    for row in raw_rows:
        by_store.setdefault(str(row.get("store_id")), []).append(row)

    store_metrics = [compute_store_metrics(rows) for _, rows in sorted(by_store.items())]

    return DataContext(
        data_version=version,
        store_metrics=store_metrics,
        region_inputs={str(r.get("region_id")): r for r in region_rows},
        wiki=wiki,
        raw_store_rows=raw_rows,
    )


# --- 进程级缓存 -------------------------------------------------------------
# 目的：Agent 一轮可能连续调 3~4 个工具，避免重复三次全表读。
# 不做长 TTL，Demo 数据在人工改库后应尽快生效。

_context_cache: dict[str, tuple[float, DataContext]] = {}


def get_context(force: bool = False, data_version: str | None = None) -> DataContext:
    import time

    version = data_version or config.DATA_VERSION
    ttl = config.CONTEXT_TTL_SECONDS
    now = time.monotonic()
    cached = _context_cache.get(version)
    if not force and ttl > 0 and cached and (now - cached[0]) < ttl:
        return cached[1]
    ctx = build_context(data_version=version)
    _context_cache[version] = (now, ctx)
    return ctx


def clear_context_cache() -> None:
    _context_cache.clear()


# ===========================================================================
# 1. getDashboardMetrics
# ===========================================================================

def get_dashboard_metrics(
    filters: dict | None = None,
    ctx: DataContext | None = None,
) -> dict:
    """看板总览指标。

    filters: {regionId?, storeId?, deviceId?, from?, to?}
    返回冻结形状 DashboardMetrics + 扩展字段（evidenceIds / dataVersion）。

    注意比率口径：onlineRate 是 0..1 的小数（40/42 = 0.952），
    不是百分数。前端乘 100 展示。
    """
    ctx = ctx or get_context()
    filters = filters or {}

    region_ids = _resolve_filter_regions(filters, ctx)
    store_id = _clean(filters.get("storeId") or filters.get("store_id"))
    device_id = _clean(filters.get("deviceId") or filters.get("device_id"))

    selected = ctx.stores(region_ids)
    if store_id:
        selected = [m for m in selected if m.get("store_id") == store_id]
    if device_id:
        selected = [m for m in selected if m.get("device_id") == device_id]

    if not selected:
        if store_id or device_id:
            raise ContractError(
                "DEVICE_NOT_FOUND",
                f"未找到匹配门店。storeId={store_id or '-'} deviceId={device_id or '-'}",
            )
        raise ContractError("INVALID_QUERY", "筛选条件下没有任何门店数据。")

    # 先聚合再算比率：SUM 销售额、SUM 设备数，最后才做除法。
    sales_amount = sum_field(
        [{"v": m.get("current_sales_amount")} for m in selected], "v"
    )
    device_count = sum_field(
        [{"v": m.get("current_device_count")} for m in selected], "v"
    )
    online_count = sum_field(
        [{"v": m.get("current_online_device_count")} for m in selected], "v"
    )

    # 利润：用区域侧的周期利润口径，与门店当前窗口对齐。
    # 未做区域筛选时 Σ estimated_period_profit = 218000，正好等于验收快照。
    covered_regions = sorted({m.get("region_id") for m in selected if m.get("region_id")})
    estimated_profit = sum_field(
        [{"v": (ctx.region(r) or {}).get("estimated_period_profit")} for r in covered_regions],
        "v",
    )

    online_rate = safe_ratio(online_count, device_count, 1.0)

    # 未结发现数：跑一遍规则拿真实命中，再按口径开关折算。
    audit = run_audit(selected, ctx.wiki, ctx.wiki.min_peer_count())
    open_finding_count = resolve_open_finding_count(audit["findings"])

    evidence_ids = [f"ev_store_{m.get('store_id')}_current" for m in selected]
    evidence_ids.append("ev_region_inputs")
    evidence_ids.append("ev_wiki_anomaly_v1")

    return {
        # --- 冻结字段 ---
        "salesAmount": _round2(sales_amount),
        "estimatedProfit": _round2(estimated_profit),
        "deviceCount": int(device_count) if device_count is not None else None,
        "onlineRate": round_half_up(online_rate, 3),
        "openFindingCount": open_finding_count,
        # --- 扩展字段（前端已按这些名字读取）---
        "storeCount": len(selected),
        "regionIds": covered_regions,
        "onlineDeviceCount": int(online_count) if online_count is not None else None,
        "salesChangePct": _round1(_weighted_sales_change(selected)),
        "evidenceIds": evidence_ids,
        "dataVersion": ctx.data_version,
    }


def _weighted_sales_change(stores: Sequence[dict]) -> float | None:
    """按销售额加权的整体变化率。

    正确做法是「先聚合当前、再聚合基准、最后算变化率」，
    绝不对各店的变化率取平均——那样小店会和大店同等权重。
    """
    cur = sum_field([{"v": m.get("current_sales_amount")} for m in stores], "v")
    base = sum_field([{"v": m.get("baseline_sales_amount")} for m in stores], "v")
    if cur is None or base is None or base == 0:
        return None
    return (cur - base) / abs(base) * 100


# ===========================================================================
# 2. auditOperations
# ===========================================================================

AUDIT_SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}


def audit_operations(
    filters: dict | None = None,
    ctx: DataContext | None = None,
) -> dict:
    """经营审计：跑 store_anomaly_v1 规则，返回 AuditResult。

    filters: {regionId?, storeId?, deviceId?, severity?}

    证据不足时（可比门店 < min_peer_count）返回 status='insufficient'
    和空 findings，而不是编一个结论出来。
    """
    ctx = ctx or get_context()
    filters = filters or {}

    region_ids = _resolve_filter_regions(filters, ctx)
    store_id = _clean(filters.get("storeId") or filters.get("store_id"))
    device_id = _clean(filters.get("deviceId") or filters.get("device_id"))

    selected = ctx.stores(region_ids)
    if store_id:
        selected = [m for m in selected if m.get("store_id") == store_id]
    if device_id:
        selected = [m for m in selected if m.get("device_id") == device_id]

    if not selected:
        raise ContractError(
            "DEVICE_NOT_FOUND",
            f"未找到匹配门店。storeId={store_id or '-'} deviceId={device_id or '-'}",
        )

    # 审计的可比池必须用「全量门店」，否则筛了区域后可比数从 4 降到 0，
    # 会永远 insufficient。筛选只作用于「要看哪些店的结论」。
    audit = run_audit(ctx.store_metrics, ctx.wiki, ctx.wiki.min_peer_count())
    wanted = {m.get("store_id") for m in selected}
    findings = [f for f in audit["findings"] if f.get("_store_id") in wanted]

    severity_filter = _clean(filters.get("severity"))
    if severity_filter:
        if severity_filter not in AUDIT_SEVERITY_RANK:
            raise ContractError(
                "INVALID_QUERY",
                f"severity 只能是 high/medium/low，收到：{severity_filter}",
            )
        findings = [f for f in findings if f.get("severity") == severity_filter]

    findings.sort(key=lambda f: (AUDIT_SEVERITY_RANK.get(f.get("severity"), 9), f.get("_store_id") or ""))

    # 筛选后的状态重算：没有命中就是 none；但若全部门店都 insufficient 要如实上抛。
    selected_statuses = [
        r["status"] for r in audit["per_store"] if r.get("store_id") in wanted
    ]
    if selected_statuses and all(s == "insufficient" for s in selected_statuses):
        status = "insufficient"
    elif selected_statuses and all(s == "unavailable" for s in selected_statuses):
        status = "unavailable"
    else:
        status = "possible" if findings else "none"

    return {
        # --- 冻结字段 ---
        "summary": build_audit_summary(findings) if findings else _empty_summary(status, severity_filter),
        "findings": [to_contract_finding(f) for f in findings],
        # --- 扩展字段 ---
        "status": status,
        "severitySummary": _severity_summary(audit["findings"]),
        "peerStats": _merge_peer_stats(audit["per_store"], wanted),
        "notes": [n for n in audit["notes"] if _note_in_scope(n, wanted)],
        "minPeerCount": audit["min_peer_count"],
        # 完整 finding（含 rule_id / wiki_id / owner_role）供 create_task 落库用，
        # 用下划线前缀标明「不是 HTTP 契约的一部分」。
        "_enrichedFindings": findings,
        "evidenceIds": sorted({e for f in findings for e in f.get("_evidence_ids", [])}),
        "dataVersion": ctx.data_version,
    }


def _empty_summary(status: str, severity_filter: str | None) -> str:
    if severity_filter:
        return f"当前筛选条件下没有 {severity_filter} 级别的问题。"
    if status == "insufficient":
        return "可比门店数量不足，当前无法输出确定性审计结论。"
    if status == "unavailable":
        return "关键经营字段缺失，当前无法完成审计判定。"
    return "当前经营数据未发现需要升级的异常。"


def _severity_summary(findings: Sequence[dict]) -> dict:
    summary = {"high": 0, "medium": 0, "low": 0, "total": len(findings)}
    for finding in findings:
        key = finding.get("severity")
        if key in summary:
            summary[key] += 1
    return summary


def _merge_peer_stats(per_store: Sequence[dict], wanted: set) -> dict:
    for entry in per_store:
        if entry.get("store_id") in wanted:
            return entry.get("peer_stats") or {}
    return {}


def _note_in_scope(note: str, wanted: set) -> bool:
    """只保留与选中门店相关的说明，避免用户筛了 A 店却看到 E 店的提示。"""
    return any(str(s) in note for s in wanted)


# ===========================================================================
# 3. compareRegions
# ===========================================================================

def _scoring_weights(ctx: DataContext) -> dict:
    """权重来自 Wiki 的 region_scoring_v1，不写死在代码里。

    改 Wiki 词条 = 改评分，不用发版。缺词条时退回契约里写死的默认权重，
    并在 assumptions 里说明「使用了内置默认值」。
    """
    weights = ctx.wiki.scoring_weights() or {}
    return {
        "w1_demand": float(weights.get("w1_demand", 0.45)),
        "w2_competition": float(weights.get("w2_competition", 0.25)),
        "w3_margin": float(weights.get("w3_margin", 0.35)),
        "w4_cost": float(weights.get("w4_cost", 0.15)),
        "from_wiki": bool(weights),
    }


def score_region(region_row: dict, weights: dict) -> float | None:
    """score = w1*demand + w2*competition + w3*margin - w4*cost，裁剪到 0..100。

    成本是减项：成本分越高代表成本越低（分数语义是「越好越高」）。
    """
    nums = [
        _to_float(region_row.get("demand_score")),
        _to_float(region_row.get("competition_score")),
        _to_float(region_row.get("margin_score")),
        _to_float(region_row.get("cost_score")),
    ]
    if any(n is None for n in nums):
        return None
    demand, competition, margin, cost = nums
    raw = (
        weights["w1_demand"] * demand
        + weights["w2_competition"] * competition
        + weights["w3_margin"] * margin
        - weights["w4_cost"] * cost
    )
    return max(0.0, min(100.0, raw))


def compute_payback_months(region_row: dict) -> float | None:
    """回本周期（月）= 投入 / 月利润。

    两个前置条件缺一不可：
      1. has_complete_cost_data = TRUE —— 成本数据不完整就不该给数字
      2. capex_investment 非 NULL 且月利润 > 0
    任一不满足返回 None。南关区就是这一路的样本（验收要求 payback = null）。
    """
    if not region_row.get("has_complete_cost_data"):
        return None
    capex = _to_float(region_row.get("capex_investment"))
    monthly = _to_float(region_row.get("estimated_monthly_profit"))
    ratio = safe_ratio(capex, monthly, 1.0)
    if ratio is None or ratio <= 0:
        return None
    return round_half_up(ratio, 1)


def compare_regions(
    region_ids: Sequence[str] | None = None,
    ctx: DataContext | None = None,
) -> dict:
    """多区域横向对比。

    region_ids 为空 / 传 'all' / 传 '长春' 时比较全部区域。
    返回按 score 降序的 RegionResult 列表。
    """
    ctx = ctx or get_context()

    resolved = _resolve_region_list(region_ids, ctx)
    weights = _scoring_weights(ctx)

    results = []
    for region_id in resolved:
        row = ctx.region(region_id)
        if not row:
            continue
        results.append(_build_region_result(region_id, row, ctx, weights))

    if not results:
        raise ContractError("REGION_NOT_FOUND", "未找到任何可比区域。")

    results.sort(key=lambda r: (r["score"] is None, -(r["score"] or 0)))

    assumptions = _comparison_assumptions(weights, ctx)
    return {
        # --- 冻结字段：RegionResult[] ---
        "regions": results,
        # --- 扩展字段 ---
        "count": len(results),
        "assumptions": assumptions,
        "scoringWeights": {k: v for k, v in weights.items() if k != "from_wiki"},
        "evidenceIds": ["ev_region_inputs", "ev_wiki_scoring_v1"],
        "dataVersion": ctx.data_version,
    }


def _build_region_result(region_id: str, row: dict, ctx: DataContext, weights: dict) -> dict:
    score = score_region(row, weights)
    payback = compute_payback_months(row)
    profile = ctx.wiki.region_profile(region_id)

    reasons = list(profile.get("reasons", []))
    assumptions = list(profile.get("assumptions", []))

    if score is None:
        reasons = reasons + ["评分所需的市场分项数据不完整"]
    if payback is None:
        assumptions = assumptions + ["缺少完整的成本/投入数据，回本周期不做估算"]

    stores = ctx.stores([region_id])
    return {
        # --- 冻结字段 ---
        "regionId": region_id,
        "name": row.get("name") or region_id,
        "score": round_half_up(score, 1),
        "estimatedMonthlyProfit": _round2(_to_float(row.get("estimated_monthly_profit"))),
        "estimatedPaybackMonths": payback,
        "reasons": reasons,
        "assumptions": assumptions,
        # --- 扩展字段 ---
        "capexInvestment": _round2(_to_float(row.get("capex_investment"))),
        "estimatedPeriodProfit": _round2(_to_float(row.get("estimated_period_profit"))),
        "hasCompleteCostData": bool(row.get("has_complete_cost_data")),
        "paybackStatus": "ok" if payback is not None else "unavailable",
        "salesAmount": _round2(sum_field([{"v": m.get("current_sales_amount")} for m in stores], "v")),
        "deviceCount": int(sum_field([{"v": m.get("current_device_count")} for m in stores], "v") or 0),
        "onlineDeviceCount": int(sum_field([{"v": m.get("current_online_device_count")} for m in stores], "v") or 0),
        "storeIds": [m.get("store_id") for m in stores],
        "wikiId": profile.get("wiki_id"),
        "evidenceIds": ["ev_region_inputs", f"ev_region_{region_id}"],
    }


def _comparison_assumptions(weights: dict, ctx: DataContext) -> list[str]:
    assumptions = [
        "评分权重取自 knowledge_wiki 的 region_scoring_v1 词条。"
        if weights.get("from_wiki")
        else "未读到 region_scoring_v1 词条，评分使用契约内置默认权重。",
        "定性理由与假设取自 knowledge_wiki 的 region_profile 词条。",
    ]
    if any(not r.get("has_complete_cost_data") for r in ctx.region_inputs.values()):
        assumptions.append("部分区域成本数据不完整，其回本周期返回 null 而非估算值。")
    return assumptions


# ===========================================================================
# 4. estimateRegionROI
# ===========================================================================

def estimate_region_roi(
    region_id: str,
    ctx: DataContext | None = None,
) -> dict:
    """单区域投放 ROI 测算。

    region_id 接受 'chaoyang' / '朝阳区' / '长春' 等写法。
    返回 RegionResult 的超集：多了 capexInvestment、paybackStatus、
    以及一条机器可读的 roiNote 供 Agent 直接引用。

    关键约束：成本数据不全时 estimatedPaybackMonths = null，
    并明确告知「不做估算」，绝不用其他区域的投入去顶替。
    """
    ctx = ctx or get_context()

    raw = _clean(region_id)
    if not raw:
        raise ContractError("INVALID_QUERY", "regionId 不能为空。")
    if is_city_alias(raw):
        raise ContractError(
            "INVALID_QUERY",
            "estimateRegionROI 需要具体区域，不能是全市聚合。"
            "如需全市对比请改用 compareRegions。",
        )

    resolved = normalize_region_id(raw)
    if resolved is None:
        known = "、".join(ctx.region_inputs.keys()) or "chaoyang、nanguan、kuancheng、erdao、luyuan"
        raise ContractError(
            "REGION_NOT_FOUND",
            f"未知区域：{raw}。可用区域：{known}（也支持中文别名，如「朝阳区」）。",
        )

    row = ctx.region(resolved)
    if not row:
        raise ContractError(
            "REGION_NOT_FOUND",
            f"区域 {resolved} 在 region_market_inputs 中不存在。",
        )

    weights = _scoring_weights(ctx)
    result = _build_region_result(resolved, row, ctx, weights)

    payback = result["estimatedPaybackMonths"]
    monthly = result["estimatedMonthlyProfit"]
    capex = result["capexInvestment"]

    if payback is None:
        if not result["hasCompleteCostData"]:
            roi_note = (
                f"{result['name']}缺少完整的成本/长租合同数据，"
                "不输出回本周期估算。建议先补录租金与设备投入明细。"
            )
        else:
            roi_note = f"{result['name']}的设备投入金额缺失，无法计算回本周期。"
    else:
        roi_note = (
            f"{result['name']}预计月利润 {_fmt_money(monthly)} 元，"
            f"投入 {_fmt_money(capex)} 元，回本周期约 {payback} 个月。"
        )

    return {
        **result,
        "roiNote": roi_note,
        "assumptions": result["assumptions"] + [
            "回本周期 = 设备投入 / 预计月利润，未折现、未计入季节性波动。",
        ],
        "status": "insufficient" if payback is None else "ok",
        "dataVersion": ctx.data_version,
    }


# ---------------------------------------------------------------------------
# 内部工具
# ---------------------------------------------------------------------------

def _clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _to_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def _round2(value: float | None) -> float | None:
    return round_half_up(value, 2)


def _round1(value: float | None) -> float | None:
    return round_half_up(value, 1)


def _fmt_money(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value:,.0f}"


def _resolve_filter_regions(filters: dict, ctx: DataContext) -> list[str] | None:
    """把 filters.regionId 解析成 region_id 列表。None 表示不筛。"""
    raw = filters.get("regionId") or filters.get("region_id")
    if raw is None or is_city_alias(raw):
        return None
    if isinstance(raw, (list, tuple, set)):
        resolved = [normalize_region_id(r) for r in raw]
        cleaned = [r for r in resolved if r]
        if not cleaned:
            raise ContractError("INVALID_QUERY", f"无法识别的区域：{raw}")
        return cleaned
    resolved = normalize_region_id(raw)
    if resolved is None:
        raise ContractError(
            "REGION_NOT_FOUND",
            f"未知区域：{raw}。可用区域：{ '、'.join(ctx.region_inputs.keys()) }。",
        )
    return [resolved]


def _resolve_region_list(region_ids: Sequence[str] | None, ctx: DataContext) -> list[str]:
    """compareRegions 的区域入参解析。None / 全市 -> 全部区域。"""
    if region_ids is None:
        return list(ctx.region_inputs.keys())
    if isinstance(region_ids, str):
        if is_city_alias(region_ids):
            return list(ctx.region_inputs.keys())
        region_ids = [region_ids]

    cleaned: list[str] = []
    unknown: list[str] = []
    for raw in region_ids:
        if is_city_alias(raw):
            return list(ctx.region_inputs.keys())
        resolved = normalize_region_id(raw)
        if resolved is None:
            unknown.append(str(raw))
        elif resolved not in cleaned:
            cleaned.append(resolved)

    if unknown:
        raise ContractError(
            "REGION_NOT_FOUND",
            f"未知区域：{'、'.join(unknown)}。可用区域：{ '、'.join(ctx.region_inputs.keys()) }。",
        )
    return cleaned or list(ctx.region_inputs.keys())


__all__ = [
    "ContractError",
    "DataContext",
    "build_context",
    "get_context",
    "clear_context_cache",
    "get_dashboard_metrics",
    "audit_operations",
    "compare_regions",
    "estimate_region_roi",
    "score_region",
    "compute_payback_months",
    "normalize_region_id",
    "is_city_alias",
    "REGION_ALIASES",
    "ERROR_STATUS",
]
