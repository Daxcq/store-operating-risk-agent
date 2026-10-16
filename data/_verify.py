# -*- coding: utf-8 -*-
"""
对拍验证 (任务B)

目的：用一份独立于 TS 实现的 Python 脚本，重算同一份 CSV，检查 4 个 fixture 的期望是否成立。
这不是「自己验自己」——实现是 TS，验证是 Python，口径都来自 configs/，两边独立写。
TS 那边算错，这里会打架。

跑法：python data/_verify.py
"""

import csv
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(HERE, "store_operations_daily.csv")

CURRENT = ("2026-10-06", "2026-10-12")
BASELINE = ("2026-09-29", "2026-10-05")

THRESHOLDS = {"sales_drop": -20.0, "refund_high": 5.0, "aov_drop": -10.0}
MIN_PEERS = 3

GRADE = lambda region: "compact" if region == "西城区" else "standard"
KEY_FIELDS = ("sales_amount", "order_count", "refund_amount")


def load():
    with open(CSV_PATH, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        for k in ("device_count", "online_device_count", "order_count", "refund_order_count"):
            r[k] = int(r[k]) if r[k] != "" else None
        for k in ("sales_amount", "refund_amount", "inventory_diff_amount"):
            r[k] = float(r[k]) if r[k] != "" else None
    return rows


def win(rows, sid, w):
    return [r for r in rows if r["store_id"] == sid and w[0] <= r["date"] <= w[1]]


def s(rows, field):
    vals = [r[field] for r in rows if r[field] is not None]
    return sum(vals) if vals else None


def ratio(a, b, scale=1.0):
    if a is None or b is None or b == 0:
        return None
    return a / b * scale


def pct(cur, base):
    if cur is None or base is None or base == 0:
        return None
    return (cur - base) / abs(base) * 100


def metrics(rows, sid, w):
    r = win(rows, sid, w)
    sales = s(r, "sales_amount")
    orders = s(r, "order_count")
    refund = s(r, "refund_amount")
    return {
        "sales_amount": sales,
        "order_count": orders,
        "refund_amount": refund,
        "refund_rate": ratio(refund, sales, 100),
        "aov": ratio(sales, orders, 1),
    }


def quality(rows, sid, w):
    r = win(rows, sid, w)
    if not r:
        return {"valid_days": 0, "null_ratio": 1.0, "status": "unavailable"}
    nulls = sum(1 for row in r for f in KEY_FIELDS if row[f] is None)
    valid = sum(1 for row in r if all(row[f] is not None for f in KEY_FIELDS))
    nr = nulls / (len(r) * len(KEY_FIELDS))
    status = "unavailable" if (valid < 5 or nr > 0.2) else "ok"
    return {"valid_days": valid, "null_ratio": nr, "status": status}


def peers(rows, sid, w):
    """基础准入（逐门店）：同区域 + 同业态。

    注意这里**不再**按整店数据质量剔除。
    可比性是逐指标的：S004 的退款字段断报，但销售和订单是完整的，
    它对销售变化率依然可比，只是不能参与退款率对比。
    用全局质量一刀切会把可比数压到临界值以下，把该下的结论压成 insufficient。
    """
    all_ids = sorted({r["store_id"] for r in rows})
    me = next(r for r in rows if r["store_id"] == sid)
    keep, drop = [], []
    for o in all_ids:
        if o == sid:
            continue
        row = next(x for x in rows if x["store_id"] == o)
        if row["region"] != me["region"]:
            drop.append((o, "区域不同"))
            continue
        if GRADE(row["region"]) != GRADE(me["region"]):
            drop.append((o, "业态档口不同"))
            continue
        keep.append(o)
    return keep, drop


CONDITION_PEER_METRIC = {
    "sales_drop": "sales_change_pct",
    "aov_drop": "sales_change_pct",
    "refund_high": "refund_rate",
}


def metric_peers(rows, sid, o, w, code):
    """该可比门店在本指标上是否可用（本指标算得出数值）。"""
    m = metrics(rows, o, w)
    return m.get(code) is not None


def evaluate(rows, sid):
    cur = metrics(rows, sid, CURRENT)
    base = metrics(rows, sid, BASELINE)
    q = quality(rows, sid, CURRENT)
    peer_ids, dropped = peers(rows, sid, CURRENT)

    # 本店的变化率，用于逐指标可比性判定
    cur_sales_chg = pct(cur["sales_amount"], base["sales_amount"])
    cur_aov_chg = pct(cur["aov"], base["aov"])
    subject_metric_values = {
        "sales_change_pct": cur_sales_chg,
        "refund_rate": cur["refund_rate"],
        "aov_change_pct": cur_aov_chg,
    }

    # 逐指标：可比门店中本指标有值的家数
    metric_sufficient = {}
    metric_dropped = {}
    for code in ("sales_change_pct", "refund_rate", "aov_change_pct"):
        dropped_here = [o for o in peer_ids if not metric_peers(rows, sid, o, CURRENT, code)]
        usable = len(peer_ids) - len(dropped_here)
        metric_dropped[code] = dropped_here
        metric_sufficient[code] = usable >= MIN_PEERS

    conds = {}
    conds["sales_drop"] = (cur_sales_chg, THRESHOLDS["sales_drop"], "<=")
    conds["refund_high"] = (cur["refund_rate"], THRESHOLDS["refund_high"], ">=")
    conds["aov_drop"] = (cur_aov_chg, THRESHOLDS["aov_drop"], "<=")

    hits = []
    for k, (actual, thr, op) in conds.items():
        if actual is None:
            continue
        if (op == "<=" and actual <= thr) or (op == ">=" and actual >= thr):
            hits.append(k)

    # 只算「命中项」里可比门店不够的
    hits_without_peers = [h for h in hits if not metric_sufficient[CONDITION_PEER_METRIC[h]]]
    gate_sufficient = metric_sufficient["sales_change_pct"]

    if q["status"] == "unavailable":
        verdict, risk = "unavailable", "unknown"
    elif len(hits) >= 2 and hits_without_peers:
        verdict, risk = "insufficient", "watch"
    elif len(hits) >= 2 and not gate_sufficient:
        verdict, risk = "insufficient", "watch"
    elif len(hits) >= 2:
        verdict, risk = "possible", "high" if len(hits) >= 3 else "watch"
    elif len(hits) == 1:
        verdict, risk = "insufficient", "watch"
    else:
        verdict, risk = "none", "normal"

    return {
        "cur": cur, "base": base, "q": q, "hits": hits,
        "verdict": verdict, "risk": risk,
        "peer_count": len(peer_ids), "peer_ids": peer_ids, "dropped": dropped,
        "metric_sufficient": metric_sufficient,
        "metric_dropped": metric_dropped,
        "hits_without_peers": hits_without_peers,
    }


EXPECT = {
    "S006": ("none", [], "normal"),
    "S005": ("insufficient", ["refund_high"], "watch"),
    "S001": ("possible", ["sales_drop", "refund_high", "aov_drop"], "high"),
    "S004": ("unavailable", [], "unknown"),
}


def main():
    rows = load()
    print(f"数据行数 {len(rows)}，门店 {len({r['store_id'] for r in rows})} 家\n")
    print(f"{'门店':<9}{'销售变化%':>10}{'退款率%':>9}{'客单价变化%':>12}{'命中':>6}  {'判定':<13}{'可比':>4}")
    print("-" * 72)

    failures = []
    for sid in ("S006", "S005", "S001", "S004", "S002", "S003"):
        e = evaluate(rows, sid)
        sales_chg = pct(e["cur"]["sales_amount"], e["base"]["sales_amount"])
        aov_chg = pct(e["cur"]["aov"], e["base"]["aov"])
        rr = e["cur"]["refund_rate"]
        fmt = lambda v, n=2: "N/A" if v is None else f"{v:.{n}f}"
        print(
            f"{sid:<9}{fmt(sales_chg):>10}{fmt(rr):>9}{fmt(aov_chg):>12}"
            f"{len(e['hits']):>6}  {e['verdict']:<13}{e['peer_count']:>4}"
        )

        if sid in EXPECT:
            exp_verdict, exp_hits, exp_risk = EXPECT[sid]
            if e["verdict"] != exp_verdict:
                failures.append(f"{sid} verdict 期望 {exp_verdict}，实际 {e['verdict']}")
            if sorted(e["hits"]) != sorted(exp_hits):
                failures.append(f"{sid} 命中项 期望 {exp_hits}，实际 {e['hits']}")
            if e["risk"] != exp_risk:
                failures.append(f"{sid} risk_level 期望 {exp_risk}，实际 {e['risk']}")

    print()
    # S004 必须因为数据缺失判定为 unavailable，绝不能是 none
    e4 = evaluate(rows, "S004")
    print(f"S004 退款字段空值率 {e4['q']['null_ratio']*100:.1f}%，有效天数 {e4['q']['valid_days']}/7")
    print(f"S004 退款率 = {e4['cur']['refund_rate']}  (必须是 None，不能是 0)")
    if e4["cur"]["refund_rate"] is not None:
        failures.append("S004 退款率应为 None，出现了数值 —— 缺失被当成 0 了")

    # 逐指标可比性：这是本次修复的核心，必须逐项打出来
    e1 = evaluate(rows, "S001")
    print(f"\nS001 基础准入可比门店 {e1['peer_ids']}")
    print(f"     排除 {len(e1['dropped'])} 家（仅区域/业态不符），示例：{e1['dropped'][:3]}")
    print("     逐指标可比门店数：")
    for code, ok in e1["metric_sufficient"].items():
        usable = e1["peer_count"] - len(e1["metric_dropped"][code])
        flag = "达标" if ok else "不足"
        extra = f"  排除 {e1['metric_dropped'][code]}" if e1["metric_dropped"][code] else ""
        print(f"       {code:<18}{usable:>3} 家  {flag}{extra}")

    # S004 必须「退款项不够、销售项够」—— 这正是它存在的意义
    print()
    if "S004" in e1["metric_dropped"]["refund_rate"]:
        print("S004 未计入退款率可比（退款字段断报）—— 符合预期")
    else:
        failures.append("S004 应因退款字段缺失被排除在退款率可比之外，实际未排除")
    if "S004" in e1["metric_dropped"]["sales_change_pct"]:
        failures.append(
            "S004 的销售/订单数据是完整的，不应被排除在销售变化率可比之外 "
            "—— 逐指标可比性没生效，退化成了整店剔除"
        )
    else:
        print("S004 仍计入销售变化率可比 —— 符合预期（逐指标可比性生效）")

    print()
    if failures:
        print("=== 未通过 ===")
        for f in failures:
            print(" x", f)
        sys.exit(1)
    print("=== 全部通过：4 个 fixture 期望结果与实现一致（逐指标可比性口径） ===")


if __name__ == "__main__":
    main()
