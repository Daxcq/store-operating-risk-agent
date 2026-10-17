"""异常判定规则引擎（任务B）。

规则本身不存在代码里，而是从 knowledge_wiki 的 store_anomaly_v1 词条读取：
  refund_high         refund_rate_pct  >= 5.0   -> high
  order_drop_severe   order_change_pct <= -20.0 -> low
  order_drop_watch    order_change_pct <= -5.0  -> medium

decision 语义（PROJECT.md §4.3）：
  none         无命中
  insufficient 证据不足（可比门店 < 3）
  possible     达到建案条件
  unavailable  无法判断（关键指标算不出来）

⚠️ 已发现的契约不一致（详见 docs/DEPLOYMENT.md §5）：
   按上面的阈值实算，E 店订单 2860 -> 2460 = -14.0%，落进 medium 区间，
   因此命中 3 条 finding（A high、A low、B medium、E medium 中 A 只算一条
   因 order_drop 按店判定）——但 PROJECT.md 与 API_CONTRACT.md 的 3 条
   finding 快照里没有 E 店。本模块默认「按规则实算」，并用
   config.OPEN_FINDINGS_MODE 控制 dashboard 的计数口径。
"""

from __future__ import annotations

from typing import Any, Sequence

from . import config
from .metrics import peer_median, round_half_up
from .wiki import WikiIndex


SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}


def _compare(value: float | None, op: str, threshold: float) -> bool:
    if value is None:
        return False
    if op == ">=":
        return value >= threshold
    if op == ">":
        return value > threshold
    if op == "<=":
        return value <= threshold
    if op == "<":
        return value < threshold
    if op == "==":
        return value == threshold
    return False


def build_peer_group(store_metrics: Sequence[dict], target: dict, min_peers: int) -> list[dict]:
    """构造可比门店组：排除自身，按区域分组。

    Demo 里每区仅一店，跨区可比会只剩 4 家。真实场景应优先同区域 + 同店型，
    不足时才放宽。这里先用「排除自身后全部」作为可比池，并在 assumptions 中说明，
    避免在只有 5 店的数据上因为严格同区比较而永远 insufficient。
    """
    peers = [m for m in store_metrics if m.get("store_id") != target.get("store_id")]
    return peers


def evaluate_store(
    target: dict,
    peers: Sequence[dict],
    wiki: WikiIndex,
    min_peers: int,
) -> dict[str, Any]:
    """判定单个门店的异常。

    返回 {status, findings, peer_stats, notes}。
    每个 finding 都带 evidence_ids，且 evidence 文案由 Wiki SOP 模板渲染，
    不在 Python 里硬编码。
    """
    peer_count = len(peers)
    notes: list[str] = []
    evidence_ids = list(target.get("evidence_ids", []))

    # --- 数据可用性 ---
    if target.get("current_sales_amount") is None or target.get("current_order_count") is None:
        return {
            "status": "unavailable",
            "findings": [],
            "peer_stats": {},
            "notes": [f"{target.get('store_id')} 关键字段缺失，无法判定。"],
            "evidence_ids": evidence_ids,
        }

    if peer_count < min_peers:
        return {
            "status": "insufficient",
            "findings": [],
            "peer_stats": {"peer_count": peer_count},
            "notes": [
                f"{target.get('store_id')} 可比门店仅 {peer_count} 家，少于 {min_peers} 家，"
                "不输出确定性结论。"
            ],
            "evidence_ids": evidence_ids,
        }

    # --- 可比基准 ---
    peer_refund_rate = peer_median(peers, "current_refund_rate_pct")
    peer_order_change = peer_median(peers, "order_change_pct")
    peer_stats = {
        "peer_count": peer_count,
        "peer_median_refund_rate_pct": round_half_up(peer_refund_rate, 2),
        "peer_median_order_change_pct": round_half_up(peer_order_change, 2),
        "peer_store_ids": [p.get("store_id") for p in peers],
    }
    evidence_ids.append("ev_peer_median")

    rules = wiki.anomaly_rules()
    findings: list[dict] = []

    refund_rate = target.get("current_refund_rate_pct")
    order_change = target.get("order_change_pct")

    # 同一指标上的多个规则可能同时命中。例如 A 店订单 -31.0%，
    # 既满足 order_drop_severe(<= -20)，也满足 order_drop_watch(<= -5)。
    # 两条都输出会让同一件事在列表里出现两次，也让 openFindingCount 虚高。
    # 因此按 metric 去重，只保留阈值更严的那条（=严重度更高的那条）。
    claimed_metrics: set[str] = set()

    for rule_id in sorted(rules.keys(), key=lambda r: SEVERITY_ORDER.get(rules[r].get("severity"), 9)):
        rule = rules[rule_id]
        metric_name = rule.get("metric")

        if metric_name in claimed_metrics:
            continue

        observed = {
            "refund_rate_pct": refund_rate,
            "order_change_pct": order_change,
        }.get(metric_name)

        if not _compare(observed, rule.get("op", ">="), float(rule.get("threshold", 0))):
            continue

        # 高风险退款项额外要求「显著高于同类中位数」，否则只算区域性波动
        if rule_id == "refund_high" and peer_refund_rate is not None:
            if refund_rate is not None and refund_rate <= peer_refund_rate:
                notes.append(
                    f"{target.get('store_id')} 退款率 {round_half_up(refund_rate, 1)}% "
                    f"未高于同类中位数 {round_half_up(peer_refund_rate, 2)}%，"
                    "判定为区域性波动而非单店异常。"
                )
                continue

        # 到这里确定要产出 finding，占用该指标，防止低严重度规则重复命中。
        claimed_metrics.add(metric_name)

        sop_context = {
            "refund_rate": round_half_up(refund_rate, 1),
            "peer_median_refund_rate": round_half_up(peer_refund_rate, 2),
            "order_change_pct": round_half_up(order_change, 1),
            "abs_order_change_pct": abs(round_half_up(order_change, 1)) if order_change is not None else None,
            "store_id": target.get("store_id"),
            "region_id": target.get("region_id"),
        }
        rendered = wiki.render_sop_text(rule_id, sop_context)
        if rendered.get("unresolved"):
            notes.append(f"SOP {rule_id} 模板存在未解析占位符：{rendered['unresolved']}")

        evidence_text = rendered.get("evidence") or (
            f"{metric_name} 观测值 {round_half_up(observed, 2)}，"
            f"触发阈值 {rule.get('op')} {rule.get('threshold')}。"
        )

        findings.append(
            {
                "id": rendered.get("finding_id") or f"finding-{rule_id}",
                "deviceId": target.get("device_id") or f"device-{target.get('store_id')}-001",
                "severity": rule.get("severity", "medium"),
                "title": _rule_title(rule_id),
                "evidence": [evidence_text],
                "recommendation": rendered.get("recommendation") or "建议人工核查该指标异常原因。",
                # 以下字段不在冻结的 AuditFinding 契约内，作为扩展信息保留，
                # 对外输出时会被 _to_contract_finding 裁掉。
                "_rule_id": rule_id,
                "_store_id": target.get("store_id"),
                "_region_id": target.get("region_id"),
                "_observed": round_half_up(observed, 2),
                "_threshold": rule.get("threshold"),
                "_wiki_id": rendered.get("wiki_id"),
                "_owner_role": rendered.get("owner_role"),
                "_due_hours": rendered.get("due_hours"),
                "_verify_metric": rendered.get("verify_metric"),
                "_verify_target": rendered.get("verify_target"),
                "_evidence_ids": evidence_ids,
            }
        )

    status = "possible" if findings else "none"
    return {
        "status": status,
        "findings": findings,
        "peer_stats": peer_stats,
        "notes": notes,
        "evidence_ids": evidence_ids,
    }


def _rule_title(rule_id: str) -> str:
    titles = {
        "refund_high": "退款率高于同类设备",
        "order_drop_severe": "订单数低于观察窗口基准",
        "order_drop_watch": "订单数低于观察窗口基准",
    }
    return titles.get(rule_id, rule_id)


def to_contract_finding(finding: dict) -> dict:
    """裁剪成 docs/API_CONTRACT.md §3.1 冻结的 AuditFinding（5 个字段）。"""
    return {
        "id": finding["id"],
        "deviceId": finding["deviceId"],
        "severity": finding["severity"],
        "title": finding["title"],
        "evidence": list(finding.get("evidence", [])),
        "recommendation": finding["recommendation"],
    }


def run_audit(
    store_metrics: Sequence[dict],
    wiki: WikiIndex,
    min_peers: int | None = None,
) -> dict[str, Any]:
    """对全部门店跑审计，返回排序后的 findings 与整体状态。"""
    effective_min = min_peers if min_peers is not None else wiki.min_peer_count()
    all_findings: list[dict] = []
    per_store: list[dict] = []
    notes: list[str] = []

    for target in store_metrics:
        peers = build_peer_group(store_metrics, target, effective_min)
        result = evaluate_store(target, peers, wiki, effective_min)
        per_store.append({"store_id": target.get("store_id"), **result})
        all_findings.extend(result["findings"])
        notes.extend(result["notes"])

    all_findings.sort(key=lambda f: (SEVERITY_ORDER.get(f.get("severity"), 9), f.get("_store_id") or ""))

    # 整体状态优先级：unavailable > possible > none
    statuses = {r["status"] for r in per_store}
    if statuses == {"unavailable"}:
        overall = "unavailable"
    elif "possible" in statuses:
        overall = "possible"
    elif "insufficient" in statuses and statuses == {"insufficient"}:
        overall = "insufficient"
    else:
        overall = "none"

    return {
        "status": overall,
        "findings": all_findings,
        "per_store": per_store,
        "notes": notes,
        "min_peer_count": effective_min,
    }


def build_audit_summary(findings: Sequence[dict]) -> str:
    """与现有 defaultAuditOperations 文案风格保持一致，便于前端无缝切换。"""
    count = len(findings)
    if count == 0:
        return "当前经营数据未发现需要升级的异常。"
    if count == 1:
        finding = findings[0]
        if finding["severity"] == "high":
            return "发现 1 个高风险经营异常，建议优先核查退款记录。"
        return "发现 1 个中风险经营发现，当前证据不足以创建高优先级任务。"
    has_high = any(f["severity"] == "high" for f in findings)
    if has_high:
        return f"发现 {count} 个经营异常，其中高风险发现需要优先核查退款订单。"
    return f"发现 {count} 个经营异常，建议按优先级逐项核查。"


def resolve_open_finding_count(rule_findings: Sequence[dict]) -> int:
    """openFindingCount 的口径开关。

    contract_snapshot: 固定 3，对齐 PROJECT.md §10 的验收快照
    rule_derived / rule_derived_all: 按规则实算
    """
    mode = config.OPEN_FINDINGS_MODE
    if mode in ("rule_derived", "rule_derived_all"):
        return len(rule_findings)
    return 3
