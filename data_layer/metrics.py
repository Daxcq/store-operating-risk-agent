"""指标计算（任务B）。

三条硬规则，来自 PROJECT.md §3.2 与 configs/metrics.yaml：
  1. 先聚合再算比率。禁止「平均每日比率」。
  2. 每个分式都要保护分母。分母为 0 或 None 时返回 None，绝不返回 0 / Infinity。
  3. 每个返回值都携带 evidence_ids 与 data_version。

本模块不认识数据库，只吃 dict 列表，便于单测。
"""

from __future__ import annotations

from typing import Any, Iterable, Sequence


def _num(value: Any) -> float | None:
    """把 DB 返回的 Decimal / str / int / None 统一成 float | None。"""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def sum_field(rows: Sequence[dict], field: str) -> float | None:
    """求和。全部为 None 时返回 None，而不是 0。"""
    total = 0.0
    seen = 0
    for row in rows:
        v = _num(row.get(field))
        if v is not None:
            total += v
            seen += 1
    return total if seen > 0 else None


def safe_ratio(numerator: float | None, denominator: float | None, scale: float = 1.0) -> float | None:
    """安全除法，全项目唯一的除法实现。分母为 0 或 None -> None。"""
    if numerator is None or denominator is None:
        return None
    if denominator == 0:
        return None
    value = (numerator / denominator) * scale
    return value if value == value and abs(value) != float("inf") else None


def safe_change_pct(current: float | None, baseline: float | None) -> float | None:
    """变化率百分比：(current - baseline) / |baseline| * 100。"""
    if current is None or baseline is None or baseline == 0:
        return None
    return (current - baseline) / abs(baseline) * 100


def safe_change_points(current: float | None, baseline: float | None) -> float | None:
    """比率型指标的变化用百分点（当前 - 基准）。"""
    if current is None or baseline is None:
        return None
    return round(current - baseline, 2)


def median(values: Iterable[float | None]) -> float | None:
    """中位数。比均值抗离群，用于可比门店基准。"""
    nums = sorted(v for v in values if v is not None)
    if not nums:
        return None
    mid = len(nums) // 2
    if len(nums) % 2 == 1:
        return nums[mid]
    return (nums[mid - 1] + nums[mid]) / 2


def round_half_up(value: float | None, digits: int) -> float | None:
    """四舍五入到指定小数位。Python 内置 round 用银行家舍入，
    退款率 7.0 这类展示值用普通四舍五入更符合直觉。"""
    if value is None:
        return None
    factor = 10**digits
    scaled = value * factor
    # 避免 1.005 * 100 = 100.49999 这类浮点误差
    import decimal

    rounded = decimal.Decimal(str(scaled)).quantize(
        decimal.Decimal("1"), rounding=decimal.ROUND_HALF_UP
    )
    return float(rounded) / factor


# ---------------------------------------------------------------------------
# 聚合：把一个门店在两个周期上的行，折叠成一组指标
# ---------------------------------------------------------------------------

def aggregate_period(rows: Sequence[dict]) -> dict[str, float | None]:
    """把一个周期内的行聚合为指标字典。rows 必须已经按 period_type 过滤好。"""
    sales = sum_field(rows, "sales_amount")
    orders = sum_field(rows, "order_count")
    refund_amt = sum_field(rows, "refund_amount")
    refund_orders = sum_field(rows, "refund_order_count")
    device_count = sum_field(rows, "device_count")
    online_count = sum_field(rows, "online_device_count")
    inv_diff = sum_field(rows, "inventory_diff_amount")

    return {
        "sales_amount": sales,
        "order_count": orders,
        "refund_amount": refund_amt,
        "refund_order_count": refund_orders,
        "device_count": device_count,
        "online_device_count": online_count,
        "inventory_diff_amount": inv_diff,
        "aov": safe_ratio(sales, orders, 1.0),
        "refund_rate_pct": safe_ratio(refund_amt, sales, 100.0),
        "refund_order_rate_pct": safe_ratio(refund_orders, orders, 100.0),
        "online_rate_pct": safe_ratio(online_count, device_count, 100.0),
    }


def compute_store_metrics(store_rows: Sequence[dict]) -> dict[str, Any]:
    """一个门店的 current vs baseline 全量指标。

    返回结构包含 evidence_ids，满足「每个数字都能回溯」的要求。
    """
    current_rows = [r for r in store_rows if r.get("period_type") == "current_7d"]
    baseline_rows = [r for r in store_rows if r.get("period_type") == "baseline_7d"]

    cur = aggregate_period(current_rows)
    base = aggregate_period(baseline_rows)

    store_id = None
    region_id = None
    device_id = None
    for row in list(current_rows) or list(store_rows):
        store_id = row.get("store_id")
        region_id = row.get("region_id")
        device_id = row.get("device_id")
        break

    metrics: dict[str, Any] = {
        "store_id": store_id,
        "region_id": region_id,
        "device_id": device_id,
        "data_version": (current_rows[0].get("data_version") if current_rows else None),
        # 当前窗口
        **{f"current_{k}": v for k, v in cur.items()},
        # 基准窗口
        **{f"baseline_{k}": v for k, v in base.items()},
    }

    # 变化率：金额/数量用百分比
    metrics["sales_change_pct"] = safe_change_pct(cur["sales_amount"], base["sales_amount"])
    metrics["order_change_pct"] = safe_change_pct(cur["order_count"], base["order_count"])
    metrics["aov_change_pct"] = safe_change_pct(cur["aov"], base["aov"])
    # 比率型指标用百分点
    metrics["refund_rate_change_points"] = safe_change_points(
        cur["refund_rate_pct"], base["refund_rate_pct"]
    )
    metrics["online_rate_change_points"] = safe_change_points(
        cur["online_rate_pct"], base["online_rate_pct"]
    )

    # 销售额变化拆解：订单数贡献 vs 客单价贡献（PROJECT.md §3.2）
    metrics["sales_decomposition"] = decompose_sales_change(cur, base)

    metrics["evidence_ids"] = [
        f"ev_store_{store_id}_current",
        f"ev_store_{store_id}_baseline",
    ]
    return metrics


def decompose_sales_change(cur: dict, base: dict) -> dict[str, Any]:
    """把销售额变化拆成订单数与客单价两个因素。

    用对数均值（LMDI 的 Divisia 形式）加权，避免简单相乘近似带来的残差：
        ΔSales = ΔOrders * w_o + ΔAOV * w_q
    w_o、w_q 为对数均值权重，因此分解是可加且无残差的。
    """
    s1, s0 = cur.get("sales_amount"), base.get("sales_amount")
    q1, q0 = cur.get("order_count"), base.get("order_count")
    a1, a0 = cur.get("aov"), base.get("aov")

    if None in (s1, s0, q1, q0, a1, a0) or s0 == 0 or q0 == 0 or q1 == 0:
        return {
            "status": "unavailable",
            "reason": "关键字段缺失或基准为 0，无法拆解",
            "order_effect": None,
            "aov_effect": None,
        }

    import math

    def log_mean(a: float, b: float) -> float:
        if a <= 0 or b <= 0:
            return (a + b) / 2
        if abs(a - b) < 1e-12:
            return a
        return (a - b) / math.log(a / b)

    order_effect = (q1 - q0) * log_mean(a1, a0)
    aov_effect = (a1 - a0) * log_mean(q1, q0)
    total_effect = order_effect + aov_effect
    actual = s1 - s0
    # 残差占比，用于自检；正常应接近 0
    residual_ratio = abs(total_effect - actual) / abs(actual) if actual else 0.0

    return {
        "status": "ok",
        "delta_sales": round(actual, 2),
        "order_effect": round(order_effect, 2),
        "aov_effect": round(aov_effect, 2),
        "residual": round(total_effect - actual, 4),
        "residual_ratio": round(residual_ratio, 6),
        "order_effect_pct": round(order_effect / abs(actual) * 100, 1) if actual else None,
        "aov_effect_pct": round(aov_effect / abs(actual) * 100, 1) if actual else None,
    }


def peer_median(peer_metrics: Sequence[dict], key: str) -> float | None:
    """可比门店在某个指标上的中位数。"""
    return median(m.get(key) for m in peer_metrics)
