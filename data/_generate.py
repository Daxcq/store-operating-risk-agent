# -*- coding: utf-8 -*-
"""
数据底座生成器 (任务B / 数据层) —— 【北京套 / 参照数据集】

用法：
    python data/_generate.py

产出：
    data/store_operations_daily.csv   主数据，21 家门店 x 42 天 = 882 行

【这套数据和长春套的关系】
  本项目的主线数据集是长春五区（朝阳/南关/宽城/二道/绿园，5 店 10 行），
  落在 supabase/init.sql 与 data_layer/fixtures.py，前端的 src/main.jsx 也用它。
  本文件生成的是另一套 21 家门店 / 42 天的参照数据，用来承担
  「四类场景 + 逐指标可比性 + 数据断报」这些口径压力测试 ——
  它比长春套大得多，也更适合做回归。

  两套数据曾经共用「朝阳区 / 海淀区 / 西城区 / 东城区 / 丰台区」这五个区名，
  结果同一个「朝阳区」在两套里是不同城市的不同商圈，区域 slug 会互相覆盖。
  现已把这五个区名改成中性代号：
      朝阳区 -> C1    海淀区 -> C2    西城区 -> C3
      东城区 -> C4    丰台区 -> C5
  改的只是名字，数值、叙事、可比池结构一律没动，_verify.py 的期望值照旧成立。
  长春套的五个区名保持原样。

设计说明：
  1. 唯一的真值来源。CSV 由本脚本确定性生成，同一种子在任何机器上结果一致，
    满足项目「同一数据版本下指标可重复计算」的要求。
  2. 不用 random 模块，自己写 LCG，避免 Python 版本差异导致数字漂移。
  3. 四类场景直接编码在生成规则里：
       S001 -> 命中 3 条（possible，主线演示）
       S005 -> 命中 1 条（insufficient，只触发退款率）
       S006 -> 全部正常（none，假阳性防线）
       S004 -> 退款字段半途断报（unavailable，数据缺失）
  4. 门店 A 的叙事：设备老化导致在线率下降，销售下滑，客单价下滑，退款率抬升。
     订单数基本不变 —— 这样报告里「销售变化拆解」才有话说。
  5. S021 是后加的，不承担任何异常叙事，唯一作用是给 C1 标准档的可比池留出余量。
     详见下方 STORES 里的可比池注释 —— 这不是凑数，是让主线结论不压在 min_peers 临界值上。
  6. 门店编号沿用 S001~S021，与长春套的 A~E 不冲突；两套数据靠 data_version 区分。
"""

import csv
import os
from datetime import date, timedelta

SEED = 20261017
END = date(2026, 10, 12)
DAYS = 42
START = END - timedelta(days=DAYS - 1)
DATA_VERSION = "demo_v1"

OUT_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "store_operations_daily.csv")

# 区域代号 -> 这是什么地方（只给读代码的人看，不参与任何计算）
#   注意：C1~C5 是中性代号，不再映射到任何真实行政区。
REGION_LABELS = {
    "C1": "参照区一（原朝阳区，主线门店所在区）",
    "C2": "参照区二（原海淀区）",
    "C3": "参照区三（原西城区，本套里唯一的 compact 档口）",
    "C4": "参照区四（原东城区）",
    "C5": "参照区五（原丰台区，成本最低）",
}

# 门店 -> (区域, 业态, 基准日销, 基准订单数)
STORES = {
    "S001": ("C1", "standard", 52000.0, 420),  # 主角
    "S002": ("C1", "standard", 48500.0, 390),  # 可比
    "S003": ("C1", "standard", 51200.0, 410),  # 可比
    "S004": ("C1", "standard", 44600.0, 365),  # 可比（仅销售/订单可用），退款字段后期缺失
    "S021": ("C1", "standard", 49800.0, 401),  # 可比（补足可比池，避免卡在临界值）
    "S005": ("C2", "standard", 47800.0, 388),  # 只命中退款率
    "S006": ("C2", "standard", 50500.0, 402),  # 正常
    "S007": ("C2", "standard", 46200.0, 372),
    "S008": ("C2", "standard", 49900.0, 398),
    "S009": ("C3", "compact", 31400.0, 262),   # 不同业态，不可比
    "S010": ("C3", "compact", 29800.0, 248),
    "S011": ("C3", "compact", 32600.0, 271),
    "S012": ("C3", "compact", 30900.0, 255),
    "S013": ("C4", "standard", 53400.0, 428),
    "S014": ("C4", "standard", 47100.0, 379),
    "S015": ("C4", "standard", 52300.0, 416),
    "S016": ("C4", "standard", 48900.0, 391),
    "S017": ("C5", "standard", 38700.0, 318),
    "S018": ("C5", "standard", 40200.0, 329),
    "S019": ("C5", "standard", 37600.0, 305),
    "S020": ("C5", "standard", 39400.0, 322),
}

# C1 标准档的可比池设计（这是整套 Demo 最吃紧的地方）：
#   S001 的销售类可比门店 = S002, S003, S004, S021  -> 4 家，达标
#   S001 的退款类可比门店 = S002, S003, S021        -> 3 家，刚好达标（S004 缺退款字段）
# 之所以要 S021 这一家，是为了让可比数不压在 min_peers 的临界值上：
# 只要窗口差一天或扰动换一个种子，临界值就会翻，主线结论跟着翻，演示会很难看。


# ---------- 确定性随机 ----------
def _lcg(n):
    x = (n * 1103515245 + 12345) & 0x7FFFFFFF
    x ^= x >> 16
    x = (x * 2246822519) & 0x7FFFFFFF
    x ^= x >> 13
    return x & 0x7FFFFFFF


def rnd(key, i):
    """返回 [0,1)。key 为字符串，i 为序号。"""
    h = 0
    for ch in key:
        h = (h * 131 + ord(ch)) & 0x7FFFFFFF
    return _lcg(h * 7919 + i * 104729 + SEED) / 0x7FFFFFFF


def wobble(key, i, amp):
    """[-amp, +amp] 的确定性扰动，左右各取一半，均值接近 0。"""
    return (rnd(key, i) * 2.0 - 1.0) * amp


# ---------- 场景参数（改这里就能调剧情强度） ----------
SCENARIO = {
    # 销售保留比例 / 订单保留比例 / 退款率下限 上限 / 在线率下限 上限
    "S001_trigger": {"from": date(2026, 10, 6), "ramp": (0.36, 0.72, 1.00),
                     "sales_keep": (0.80, 0.68, 0.62), "order_keep": 0.97,
                     "refund_rate": (3.8, 5.4, 6.6), "online_rate": (0.80, 0.74, 0.68)},
    "S005_trigger": {"from": date(2026, 10, 6), "ramp": (1.00,),
                     "sales_keep": (1.00,), "order_keep": 1.00,
                     "refund_rate": (6.3,), "online_rate": (None,)},
}

S004_REFUND_MISSING_FROM = date(2026, 10, 6)

HEADER = [
    "date", "region", "store_id", "device_count", "online_device_count",
    "sales_amount", "order_count", "refund_amount", "refund_order_count",
    "inventory_diff_amount", "data_version",
]


def ramp_pick(vals, day_index, from_date, d):
    """按距触发日的天数在 vals 中做台阶式插值，越晚影响越大。"""
    if d < from_date:
        return None
    k = (d - from_date).days
    if len(vals) == 1:
        return vals[0]
    pos = min(k / max(1, len(vals) - 1), 1.0)
    seg = pos * (len(vals) - 1)
    lo = int(seg)
    hi = min(lo + 1, len(vals) - 1)
    return vals[lo] + (vals[hi] - vals[lo]) * (seg - lo)


def build_rows():
    rows = []
    for sid in sorted(STORES):
        region, grade, base_sales, base_orders = STORES[sid]
        devices = int(round(base_orders / 9.2))
        for i in range(DAYS):
            d = START + timedelta(days=i)

            # --- 常规波动 ---
            sales = base_sales * (1.0 + wobble(sid + "s", i, 0.045))
            orders = base_orders * (1.0 + wobble(sid + "o", i, 0.035))
            refund_rate = 1.9 + 0.6 * rnd(sid + "r", i)          # 1.9% ~ 2.5%
            online_rate = 0.86 + 0.04 * rnd(sid + "d", i)        # 86% ~ 90%
            inventory_diff = sales * (0.0025 + 0.002 * rnd(sid + "v", i))

            # --- 场景：S001 设备老化，三项同时恶化 ---
            cfg = SCENARIO.get(sid + "_trigger")
            if cfg:
                sales_keep = ramp_pick(cfg["sales_keep"], i, cfg["from"], d)
                if sales_keep is not None:
                    sales *= sales_keep
                    orders *= cfg["order_keep"]

                rr = ramp_pick(cfg["refund_rate"], i, cfg["from"], d)
                if rr is not None:
                    refund_rate = rr

                orate = ramp_pick(cfg["online_rate"], i, cfg["from"], d)
                if orate is not None:
                    online_rate = orate

            refund_amount = sales * refund_rate / 100.0
            refund_orders = max(1, int(round(orders * refund_rate / 100.0)))
            online = int(round(devices * online_rate))

            # --- 场景：S004 退款字段断报（空字符串，不是 0） ---
            refund_out = f"{refund_amount:.2f}"
            refund_cnt_out = str(refund_orders)
            if sid == "S004" and d >= S004_REFUND_MISSING_FROM:
                refund_out = ""
                refund_cnt_out = ""

            rows.append({
                "date": d.isoformat(),
                "region": region,
                "store_id": sid,
                "device_count": devices,
                "online_device_count": online,
                "sales_amount": f"{sales:.2f}",
                "order_count": int(round(orders)),
                "refund_amount": refund_out,
                "refund_order_count": refund_cnt_out,
                "inventory_diff_amount": f"{inventory_diff:.2f}",
                "data_version": DATA_VERSION,
            })
    return rows


def main():
    rows = build_rows()
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=HEADER)
        w.writeheader()
        w.writerows(rows)

    # S004 的退款字段留空，方便人眼核对
    print(f"[ok] {OUT_CSV}")
    print(f"     行数 {len(rows)}  门店 {len(STORES)} 家  区间 {START} ~ {END}  版本 {DATA_VERSION}")
    print(f"     区域以中性代号标注：{', '.join(sorted(REGION_LABELS))}（不与长春套共用区名）")
    print(f"     S004 自 {S004_REFUND_MISSING_FROM} 起 refund_amount 留空")


if __name__ == "__main__":
    main()
