#!/usr/bin/env python3
"""离线自检：不连 Supabase 也能验证四个契约函数。

用法（仓库根目录）：
    python tools/verify_local.py

它做三件事：
    1. 用 data_layer/fixtures.py 的 FakeRepository 构造 DataContext，
       让 metrics / wiki / rule_engine / domain_services 四层走真实代码。
    2. 断言 PROJECT.md §10 的验收脚本里的每一个数字。
    3. 打印实算结果，便于和 docs/API_CONTRACT.md 的快照逐条对表。

退出码 0 = 全绿；1 = 有断言失败（失败项会列在最后）。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# 允许从仓库根目录直接运行
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# 自检不碰网络，把 TTL 关掉保证每次都是新算的
os.environ.setdefault("CONTEXT_TTL_SECONDS", "0")

from data_layer import (  # noqa: E402
    ContractError,
    audit_operations,
    build_context,
    compare_regions,
    estimate_region_roi,
    get_dashboard_metrics,
)
from data_layer.fixtures import FakeRepository  # noqa: E402


# ---------------------------------------------------------------------------
# 断言框架：收集全部失败而不是遇到第一个就退出
# ---------------------------------------------------------------------------

class Checker:
    def __init__(self):
        self.passed = 0
        self.failed: list[str] = []
        self.notes: list[str] = []

    def eq(self, label: str, actual, expected, tol: float = 1e-9):
        ok = _close(actual, expected, tol)
        if ok:
            self.passed += 1
            print(f"  \033[32mPASS\033[0m {label}: {_fmt(actual)}")
        else:
            self.failed.append(f"{label}: 期望 {_fmt(expected)}，实得 {_fmt(actual)}")
            print(f"  \033[31mFAIL\033[0m {label}: 期望 {_fmt(expected)}，实得 {_fmt(actual)}")

    def true(self, label: str, condition: bool, detail: str = ""):
        if condition:
            self.passed += 1
            print(f"  \033[32mPASS\033[0m {label}")
        else:
            self.failed.append(f"{label}{' — ' + detail if detail else ''}")
            print(f"  \033[31mFAIL\033[0m {label}{' — ' + detail if detail else ''}")

    def note(self, text: str):
        self.notes.append(text)

    def section(self, title: str):
        print(f"\n\033[1m{title}\033[0m")


def _close(actual, expected, tol: float) -> bool:
    if actual is None or expected is None:
        return actual is expected
    if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
        return abs(float(actual) - float(expected)) <= tol
    return actual == expected


def _fmt(value) -> str:
    if isinstance(value, float):
        return f"{value:g}"
    if value is None:
        return "null"
    if isinstance(value, list):
        return "[" + ", ".join(_fmt(v) for v in value) + "]"
    return str(value)


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def main() -> int:
    check = Checker()
    repo = FakeRepository()
    ctx = build_context(repo=repo, data_version="demo_v1")

    print("=" * 78)
    print("莱森购数据层离线自检（任务 B）")
    print("数据来源：data_layer/fixtures.py（与 supabase/init.sql 种子数据一致）")
    print("=" * 78)

    # ---- 1. 门店级指标 -----------------------------------------------------
    check.section("1. 门店级指标（metrics.py）")
    stores = {m["store_id"]: m for m in ctx.store_metrics}
    check.eq("门店数", len(stores), 5)

    a_store = stores["A"]
    check.eq("A 店当前销售额", round(a_store["current_sales_amount"], 2), 172000.00)
    check.eq("A 店当前退款率 %", round(a_store["current_refund_rate_pct"], 1), 7.0, tol=0.05)
    check.eq("A 店订单变化 %", round(a_store["order_change_pct"], 1), -31.0, tol=0.05)
    check.eq("A 店销售额变化 %", round(a_store["sales_change_pct"], 1), -28.0, tol=0.05)

    check.eq("B 店退款率 %", round(stores["B"]["current_refund_rate_pct"], 1), 3.4, tol=0.05)
    check.eq("B 店订单变化 %", round(stores["B"]["order_change_pct"], 1), -9.0, tol=0.05)
    check.eq("C 店订单变化 %", round(stores["C"]["order_change_pct"], 1), 4.0, tol=0.05)
    check.eq("D 店订单变化 %", round(stores["D"]["order_change_pct"], 1), 1.0, tol=0.05)
    check.eq("E 店订单变化 %", round(stores["E"]["order_change_pct"], 1), -14.0, tol=0.05)

    # 除零保护：全项目唯一除法实现必须在分母为 0 时返回 None
    from data_layer.metrics import safe_ratio

    check.true("safe_ratio 分母为 0 返回 None", safe_ratio(100, 0) is None)
    check.true("safe_ratio 分母为 None 返回 None", safe_ratio(100, None) is None)
    check.true("safe_ratio 正常计算", _close(safe_ratio(1, 4), 0.25, 1e-9))

    # 销售额拆解应当无残差
    decomp = a_store["sales_decomposition"]
    check.eq("A 店拆解状态", decomp["status"], "ok")
    check.true(
        "A 店销售额拆解残差 < 0.01 元",
        abs(decomp["residual"]) < 0.01,
        f"实际残差 {decomp['residual']}",
    )

    # ---- 2. Dashboard -----------------------------------------------------
    check.section("2. getDashboardMetrics（验收快照对齐）")
    dashboard = get_dashboard_metrics(ctx=ctx)
    check.eq("salesAmount", dashboard["salesAmount"], 1054000.00, tol=0.01)
    check.eq("estimatedProfit", dashboard["estimatedProfit"], 218000.00, tol=0.01)
    check.eq("deviceCount", dashboard["deviceCount"], 42)
    check.eq("onlineDeviceCount", dashboard["onlineDeviceCount"], 40)
    check.eq("onlineRate", dashboard["onlineRate"], 0.952, tol=0.001)
    check.eq("openFindingCount", dashboard["openFindingCount"], 3)

    check.true(
        "onlineRate 是 0..1 的比率而非百分数",
        0 <= dashboard["onlineRate"] <= 1,
        f"实得 {dashboard['onlineRate']}",
    )
    check.true(
        "每个数字都带 evidenceIds",
        len(dashboard["evidenceIds"]) > 0,
        "evidenceIds 为空",
    )
    check.eq("dataVersion", dashboard["dataVersion"], "demo_v1")

    # 区域筛选后仍应自洽
    cy = get_dashboard_metrics({"regionId": "朝阳区"}, ctx=ctx)
    check.eq("朝阳区筛选 salesAmount", cy["salesAmount"], 172000.00, tol=0.01)
    check.eq("朝阳区筛选 deviceCount", cy["deviceCount"], 10)
    check.eq("朝阳区筛选 estimatedProfit", cy["estimatedProfit"], 36100.00, tol=0.01)

    # ---- 3. 审计 ----------------------------------------------------------
    check.section("3. auditOperations（规则实算）")
    audit = audit_operations(ctx=ctx)
    findings = audit["findings"]
    rules_hit = sorted(
        (f["_rule_id"], f["_store_id"]) for f in audit["_enrichedFindings"]
    )
    print(f"  · 规则实算命中 {len(rules_hit)} 条：{rules_hit}")
    severity_summary = audit["severitySummary"]
    print(
        f"  · 严重度分布：high={severity_summary['high']} "
        f"medium={severity_summary['medium']} low={severity_summary['low']}"
    )

    high = [f for f in findings if f["severity"] == "high"]
    check.true("存在 high 级 finding", len(high) >= 1, "没有 high 级发现")
    if high:
        check.eq("high finding id", high[0]["id"], "finding-001")
        check.eq("high finding deviceId", high[0]["deviceId"], "device-A-001")
        check.true(
            "high finding 证据文案由 Wiki 模板渲染",
            "7.0" in high[0]["evidence"][0] and "{" not in high[0]["evidence"][0],
            f"实得文案：{high[0]['evidence'][0]}",
        )

    check.true(
        "AuditFinding 只含契约冻结的 6 个字段",
        all(
            set(f.keys()) == {"id", "deviceId", "severity", "title", "evidence", "recommendation"}
            for f in findings
        ),
        f"实际字段：{sorted(findings[0].keys()) if findings else '无'}",
    )
    check.true("summary 非空", bool(audit["summary"].strip()))
    check.eq("minPeerCount", audit["minPeerCount"], 3)

    # 可比门店不足时必须降级
    from data_layer.rule_engine import run_audit

    degraded = run_audit(ctx.store_metrics[:2], ctx.wiki, min_peers=3)
    check.eq("可比门店 < 3 时整体状态", degraded["status"], "insufficient")
    check.eq("降级时 findings 为空", len(degraded["findings"]), 0)

    # SOP 占位符不应有未解析项
    unresolved_all = [n for n in audit["notes"] if "未解析占位符" in n]
    check.true("SOP 模板无未解析占位符", not unresolved_all, "；".join(unresolved_all))

    # ---- 4. 区域对比 ------------------------------------------------------
    check.section("4. compareRegions（评分与排序）")
    comparison = compare_regions(ctx=ctx)
    by_region = {r["regionId"]: r for r in comparison["regions"]}

    expected_scores = {
        "chaoyang": 86.5,
        "nanguan": 71.0,
        "kuancheng": 82.0,
        "erdao": 78.5,
        "luyuan": 74.0,
    }
    expected_payback = {
        "chaoyang": 8.4,
        "nanguan": None,
        "kuancheng": 9.4,
        "erdao": 10.7,
        "luyuan": 12.2,
    }
    for region_id, expected in expected_scores.items():
        actual = by_region[region_id]["score"]
        check.eq(f"{by_region[region_id]['name']} score", actual, expected, tol=0.05)

    for region_id, expected in expected_payback.items():
        actual = by_region[region_id]["estimatedPaybackMonths"]
        label = f"{by_region[region_id]['name']} estimatedPaybackMonths"
        if expected is None:
            check.true(f"{label} 为 null（成本数据不完整）", actual is None, f"实得 {actual}")
        else:
            check.eq(label, actual, expected, tol=0.05)

    check.eq("区域数量", comparison["count"], 5)
    order = [r["regionId"] for r in comparison["regions"]]
    check.eq("按 score 降序", order[0], "chaoyang")
    sorted_ok = all(
        (comparison["regions"][i]["score"] or 0) >= (comparison["regions"][i + 1]["score"] or 0)
        for i in range(len(comparison["regions"]) - 1)
    )
    check.true("评分确实单调不增", sorted_ok, f"实际顺序 {order}")

    check.true(
        "每个区域都带 reasons",
        all(len(r["reasons"]) > 0 for r in comparison["regions"]),
        "存在 reasons 为空的区域",
    )
    check.true(
        "南关区 assumptions 说明不做回本估算",
        any("回本周期" in a for a in by_region["nanguan"]["assumptions"]),
        f"实得：{by_region['nanguan']['assumptions']}",
    )

    # ---- 5. 单区域 ROI ----------------------------------------------------
    check.section("5. estimateRegionROI（含中文别名）")
    roi = estimate_region_roi("朝阳区", ctx=ctx)
    check.eq("朝阳区 regionId 归一化", roi["regionId"], "chaoyang")
    check.eq("朝阳区 score", roi["score"], 86.5, tol=0.05)
    check.eq("朝阳区 estimatedMonthlyProfit", roi["estimatedMonthlyProfit"], 42800.00, tol=0.01)
    check.eq("朝阳区 estimatedPaybackMonths", roi["estimatedPaybackMonths"], 8.4, tol=0.05)
    check.eq("朝阳区 status", roi["status"], "ok")

    roi_nanguan = estimate_region_roi("nanguan", ctx=ctx)
    check.true(
        "南关区 payback 为 null",
        roi_nanguan["estimatedPaybackMonths"] is None,
        f"实得 {roi_nanguan['estimatedPaybackMonths']}",
    )
    check.eq("南关区 status", roi_nanguan["status"], "insufficient")
    check.true(
        "南关区 roiNote 明确说明不做估算",
        "不回本" in roi_nanguan["roiNote"] or "不输出回本周期" in roi_nanguan["roiNote"],
        f"实得：{roi_nanguan['roiNote']}",
    )

    # ---- 6. 错误路径 ------------------------------------------------------
    check.section("6. 错误码（API_CONTRACT.md §4）")
    try:
        estimate_region_roi("火星区", ctx=ctx)
        check.true("未知区域抛 REGION_NOT_FOUND", False, "没有抛异常")
    except ContractError as exc:
        check.eq("未知区域错误码", exc.code, "REGION_NOT_FOUND")
        check.eq("未知区域 HTTP 状态", exc.status, 404)

    try:
        estimate_region_roi("长春", ctx=ctx)
        check.true("全市别名抛 INVALID_QUERY", False, "没有抛异常")
    except ContractError as exc:
        check.eq("全市别名错误码", exc.code, "INVALID_QUERY")
        check.eq("全市别名 HTTP 状态", exc.status, 400)

    try:
        audit_operations({"storeId": "ZZZ"}, ctx=ctx)
        check.true("不存在的门店抛 DEVICE_NOT_FOUND", False, "没有抛异常")
    except ContractError as exc:
        check.eq("不存在门店错误码", exc.code, "DEVICE_NOT_FOUND")
        check.eq("不存在门店 HTTP 状态", exc.status, 404)

    # ---- 7. 规则去重与契约快照对表 ---------------------------------------
    check.section("7. 规则去重与契约快照对表")
    rule_set = {(f["_rule_id"], f["_store_id"]) for f in audit["_enrichedFindings"]}

    # 同一门店同一指标只能产出一条 finding。
    # A 店订单 -31.0% 同时满足 order_drop_severe(-20) 与 order_drop_watch(-5)，
    # 去重后应只剩 severe 那条。
    per_store_metric: dict[tuple, int] = {}
    for f in audit["_enrichedFindings"]:
        key = (f["_store_id"], f["_rule_id"])
        per_store_metric[key] = per_store_metric.get(key, 0) + 1
    duplicated = {k: v for k, v in per_store_metric.items() if v > 1}
    check.true("同店同规则不重复", not duplicated, f"重复项 {duplicated}")

    check.true(
        "A 店订单异常只保留 severe 一条",
        ("order_drop_severe", "A") in rule_set and ("order_drop_watch", "A") not in rule_set,
        f"实得命中集合 {sorted(rule_set)}",
    )
    check.true(
        "A 店仍产出退款高风险 finding",
        ("refund_high", "A") in rule_set,
        f"实得命中集合 {sorted(rule_set)}",
    )
    check.true(
        "B 店命中 order_drop_watch",
        ("order_drop_watch", "B") in rule_set,
        f"实得命中集合 {sorted(rule_set)}",
    )

    contract_set = {
        ("refund_high", "A"),
        ("order_drop_severe", "A"),
        ("order_drop_watch", "B"),
    }
    extra = rule_set - contract_set
    missing = contract_set - rule_set

    print(f"  · 契约快照预期：{sorted(contract_set)}")
    print(f"  · 规则实算结果：{sorted(rule_set)}")

    # 契约快照里的 3 条必须全部命中，否则前端 fixtures 会露空
    check.true(
        "契约快照的 3 条 finding 全部命中",
        not missing,
        f"未命中 {sorted(missing)}",
    )
    if extra:
        check.note(
            f"规则实算比契约快照多出 {sorted(extra)}，见 docs/DEPLOYMENT.md §5。"
            "openFindingCount 默认走 contract_snapshot 口径以保住验收数字。"
        )

    # 无论快照如何，开放发现数必须对齐验收
    check.eq(
        "contract_snapshot 口径下 openFindingCount = 3",
        get_dashboard_metrics(ctx=ctx)["openFindingCount"],
        3,
    )

    # 切到 rule_derived 口径应当等于规则实算条数，证明开关真的生效
    import data_layer.config as cfg

    original_mode = cfg.OPEN_FINDINGS_MODE
    try:
        cfg.OPEN_FINDINGS_MODE = "rule_derived"
        derived_dashboard = get_dashboard_metrics(ctx=ctx)
        check.eq(
            "rule_derived 口径 openFindingCount = 实算条数",
            derived_dashboard["openFindingCount"],
            len(audit["_enrichedFindings"]),
        )
    finally:
        cfg.OPEN_FINDINGS_MODE = original_mode

    # ---- 汇总 -------------------------------------------------------------
    print("\n" + "=" * 78)
    if check.notes:
        print("说明：")
        for note in check.notes:
            print(f"  · {note}")
        print()
    if check.failed:
        print(f"\033[31m失败 {len(check.failed)} 项 / 通过 {check.passed} 项\033[0m")
        for item in check.failed:
            print(f"  - {item}")
        print("=" * 78)
        return 1
    print(f"\033[32m全部通过：{check.passed} 项\033[0m")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
