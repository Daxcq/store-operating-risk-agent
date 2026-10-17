"""离线测试夹具（与 supabase/init.sql 的种子数据逐字段一致）。

用途：不连 Supabase 也能验证四个契约函数。verify_local.py 用它构造
一个假的 Repository，因此 metrics / rule_engine / wiki / domain_services
四层全部走真实代码路径，只有网络访问被替换掉。

⚠️ 这份数据必须和 supabase/init.sql 手动保持一致。改了一边就要改另一边。
   未来接真实数据库时，本文件可整体删除，verify_local.py 换成冒烟测试。
"""

from __future__ import annotations

DATA_VERSION = "demo_v1"

# ---- store_operations_daily：10 行 = 5 店 × 2 周期 --------------------------
# 字段名与表列名完全一致，直接喂给 SupabaseRepository 的返回形状。
STORE_OPERATIONS_DAILY: list[dict] = [
    # A 店（朝阳区，高风险：退款率 7.0%，订单 -31.0%）
    {"id": 1, "biz_date": "2026-10-18", "region_id": "chaoyang", "store_id": "A",
     "device_id": "device-A-001", "device_count": 10, "online_device_count": 10,
     "sales_amount": 172000.00, "order_count": 2140, "refund_amount": 12040.00,
     "refund_order_count": 150, "inventory_diff_amount": -1200.00,
     "period_type": "current_7d", "data_version": DATA_VERSION},
    {"id": 2, "biz_date": "2026-10-11", "region_id": "chaoyang", "store_id": "A",
     "device_id": "device-A-001", "device_count": 10, "online_device_count": 10,
     "sales_amount": 238889.00, "order_count": 3101, "refund_amount": 5016.67,
     "refund_order_count": 65, "inventory_diff_amount": -300.00,
     "period_type": "baseline_7d", "data_version": DATA_VERSION},
    # B 店（南关区，中风险：退款率 3.4%，订单 -9.0%）
    {"id": 3, "biz_date": "2026-10-18", "region_id": "nanguan", "store_id": "B",
     "device_id": "device-B-001", "device_count": 8, "online_device_count": 7,
     "sales_amount": 198000.00, "order_count": 2580, "refund_amount": 6732.00,
     "refund_order_count": 88, "inventory_diff_amount": -450.00,
     "period_type": "current_7d", "data_version": DATA_VERSION},
    {"id": 4, "biz_date": "2026-10-11", "region_id": "nanguan", "store_id": "B",
     "device_id": "device-B-001", "device_count": 8, "online_device_count": 8,
     "sales_amount": 217582.00, "order_count": 2835, "refund_amount": 4569.22,
     "refund_order_count": 60, "inventory_diff_amount": -200.00,
     "period_type": "baseline_7d", "data_version": DATA_VERSION},
    # C 店（宽城区，正常：退款率 1.8%，订单 +4.0%）
    {"id": 5, "biz_date": "2026-10-18", "region_id": "kuancheng", "store_id": "C",
     "device_id": "device-C-001", "device_count": 9, "online_device_count": 9,
     "sales_amount": 224000.00, "order_count": 2910, "refund_amount": 4032.00,
     "refund_order_count": 52, "inventory_diff_amount": -80.00,
     "period_type": "current_7d", "data_version": DATA_VERSION},
    {"id": 6, "biz_date": "2026-10-11", "region_id": "kuancheng", "store_id": "C",
     "device_id": "device-C-001", "device_count": 9, "online_device_count": 9,
     "sales_amount": 211321.00, "order_count": 2798, "refund_amount": 4437.74,
     "refund_order_count": 58, "inventory_diff_amount": -100.00,
     "period_type": "baseline_7d", "data_version": DATA_VERSION},
    # D 店（二道区，正常：退款率 2.0%，是同城中位数 2.1% 的锚点）
    {"id": 7, "biz_date": "2026-10-18", "region_id": "erdao", "store_id": "D",
     "device_id": "device-D-001", "device_count": 8, "online_device_count": 8,
     "sales_amount": 211000.00, "order_count": 2730, "refund_amount": 4431.00,
     "refund_order_count": 57, "inventory_diff_amount": -110.00,
     "period_type": "current_7d", "data_version": DATA_VERSION},
    {"id": 8, "biz_date": "2026-10-11", "region_id": "erdao", "store_id": "D",
     "device_id": "device-D-001", "device_count": 8, "online_device_count": 8,
     "sales_amount": 206863.00, "order_count": 2703, "refund_amount": 4344.12,
     "refund_order_count": 56, "inventory_diff_amount": -90.00,
     "period_type": "baseline_7d", "data_version": DATA_VERSION},
    # E 店（绿园区，订单 -14.0% —— 命中 order_drop_watch，但不在契约快照里）
    {"id": 9, "biz_date": "2026-10-18", "region_id": "luyuan", "store_id": "E",
     "device_id": "device-E-001", "device_count": 7, "online_device_count": 6,
     "sales_amount": 249000.00, "order_count": 2460, "refund_amount": 6723.00,
     "refund_order_count": 66, "inventory_diff_amount": -260.00,
     "period_type": "current_7d", "data_version": DATA_VERSION},
    {"id": 10, "biz_date": "2026-10-11", "region_id": "luyuan", "store_id": "E",
     "device_id": "device-E-001", "device_count": 7, "online_device_count": 7,
     "sales_amount": 262000.00, "order_count": 2860, "refund_amount": 5502.00,
     "refund_order_count": 60, "inventory_diff_amount": -150.00,
     "period_type": "baseline_7d", "data_version": DATA_VERSION},
]

# ---- region_market_inputs：5 行 ---------------------------------------------
REGION_MARKET_INPUTS: list[dict] = [
    {"region_id": "chaoyang", "name": "朝阳区", "demand_score": 92.0,
     "competition_score": 88.0, "margin_score": 86.0, "cost_score": 46.7,
     "estimated_monthly_profit": 42800.00, "estimated_period_profit": 36100.00,
     "capex_investment": 359520.00, "has_complete_cost_data": True,
     "data_version": DATA_VERSION},
    {"region_id": "nanguan", "name": "南关区", "demand_score": 84.0,
     "competition_score": 74.0, "margin_score": 78.0, "cost_score": 84.0,
     "estimated_monthly_profit": 26500.00, "estimated_period_profit": 41500.00,
     "capex_investment": None, "has_complete_cost_data": False,
     "data_version": DATA_VERSION},
    {"region_id": "kuancheng", "name": "宽城区", "demand_score": 88.0,
     "competition_score": 82.0, "margin_score": 84.0, "cost_score": 50.0,
     "estimated_monthly_profit": 38200.00, "estimated_period_profit": 49200.00,
     "capex_investment": 359080.00, "has_complete_cost_data": True,
     "data_version": DATA_VERSION},
    {"region_id": "erdao", "name": "二道区", "demand_score": 83.0,
     "competition_score": 80.0, "margin_score": 81.0, "cost_score": 48.0,
     "estimated_monthly_profit": 33600.00, "estimated_period_profit": 44300.00,
     "capex_investment": 359520.00, "has_complete_cost_data": True,
     "data_version": DATA_VERSION},
    {"region_id": "luyuan", "name": "绿园区", "demand_score": 80.0,
     "competition_score": 76.0, "margin_score": 78.0, "cost_score": 55.3,
     "estimated_monthly_profit": 29400.00, "estimated_period_profit": 46900.00,
     "capex_investment": 358680.00, "has_complete_cost_data": True,
     "data_version": DATA_VERSION},
]

# ---- knowledge_wiki：11 行 --------------------------------------------------
REGION_PROFILES: dict[str, dict] = {
    "chaoyang": {
        "title": "长春市朝阳区（红旗街商圈）投放档案",
        "reasons": ["客流稳定", "竞品密度可控"],
        "assumptions": ["按近 30 天模拟客流估算", "设备投入按 360000 元计算"],
    },
    "nanguan": {
        "title": "长春市南关区（重庆路商圈）投放档案",
        "reasons": ["租金较高"],
        "assumptions": ["缺少完整租金数据，回本周期不做合理估算"],
    },
    "kuancheng": {
        "title": "长春市宽城区（北站商圈）投放档案",
        "reasons": ["北站交通枢纽客流充沛", "退款率低于同城中位数"],
        "assumptions": ["按近 30 天模拟客流估算", "设备投入按 360000 元计算"],
    },
    "erdao": {
        "title": "长春市二道区（东盛大街商圈）投放档案",
        "reasons": ["社区商圈复购稳定", "履约成本适中"],
        "assumptions": ["按近 30 天模拟客流估算", "设备投入按 360000 元计算"],
    },
    "luyuan": {
        "title": "长春市绿园区（吾悦广场商圈）投放档案",
        "reasons": ["商业综合体周末客流集中", "工作日夜间时段订单偏弱"],
        "assumptions": ["按近 30 天模拟客流估算", "设备投入按 360000 元计算"],
    },
}

KNOWLEDGE_WIKI: list[dict] = [
    {
        "wiki_id": "wiki_rule_anomaly_v1",
        "category": "semantic_rule",
        "target_key": "store_anomaly_v1",
        "title": "门店经营异常判定规则 v1",
        "severity": None,
        "content_md": "先按观察窗口 SUM 聚合再计算比率。可比门店少于 3 家时返回 insufficient。",
        "structured_payload": {
            "min_peer_count": 3,
            "peer_median_refund_rate_pct": 2.1,
            "rules": {
                "refund_high": {"metric": "refund_rate_pct", "op": ">=", "threshold": 5.0, "severity": "high"},
                "order_drop_severe": {"metric": "order_change_pct", "op": "<=", "threshold": -20.0, "severity": "low"},
                "order_drop_watch": {"metric": "order_change_pct", "op": "<=", "threshold": -5.0, "severity": "medium"},
            },
        },
        "data_version": DATA_VERSION,
    },
    {
        "wiki_id": "wiki_rule_scoring_v1",
        "category": "semantic_rule",
        "target_key": "region_scoring_v1",
        "title": "区域投放多维加权评分公式 v1",
        "severity": None,
        "content_md": "score = w1*demand + w2*competition + w3*margin - w4*cost，裁剪至 0..100。",
        "structured_payload": {
            "weights": {
                "w1_demand": 0.45,
                "w2_competition": 0.25,
                "w3_margin": 0.35,
                "w4_cost": 0.15,
            }
        },
        "data_version": DATA_VERSION,
    },
    {
        "wiki_id": "wiki_sop_refund_high",
        "category": "sop_playbook",
        "target_key": "refund_high",
        "title": "退款率高于同类设备",
        "severity": "high",
        "content_md": "当门店近 7 天退款率 >= 5.0% 且显著高于同城可比中位数时触发高风险审计项。",
        "structured_payload": {
            "finding_id": "finding-001",
            "evidence_template": "近 7 天退款率 {refund_rate}%，同类中位数 {peer_median_refund_rate}%。",
            "recommendation": "抽查最近 20 笔退款订单并核对退款原因。",
            "owner_role": "区域经理",
            "due_hours": 24,
            "verify_metric": "refund_rate",
            "verify_target": "回落至同类中位数 + 2 个百分点以内",
        },
        "data_version": DATA_VERSION,
    },
    {
        "wiki_id": "wiki_sop_order_drop_severe",
        "category": "sop_playbook",
        "target_key": "order_drop_severe",
        "title": "订单数低于观察窗口基准",
        "severity": "low",
        "content_md": "当门店近 7 天订单数较前周期下降超过 20% 时触发订单结构核查。",
        "structured_payload": {
            "finding_id": "finding-002",
            "evidence_template": "近 7 天订单数较前周期下降 {abs_order_change_pct}%。",
            "recommendation": "核对客流、营业时段和商品结构。",
        },
        "data_version": DATA_VERSION,
    },
    {
        "wiki_id": "wiki_sop_order_drop_watch",
        "category": "sop_playbook",
        "target_key": "order_drop_watch",
        "title": "订单数低于观察窗口基准",
        "severity": "medium",
        "content_md": "当门店近 7 天订单数较前周期下降 5%~20% 时触发常规关注核查。",
        "structured_payload": {
            "finding_id": "finding-003",
            "evidence_template": "近 7 天订单数较前周期下降 {abs_order_change_pct}%。",
            "recommendation": "核对客流、营业时段和近期促销记录。",
        },
        "data_version": DATA_VERSION,
    },
]

for _region_id, _profile in REGION_PROFILES.items():
    KNOWLEDGE_WIKI.append(
        {
            "wiki_id": f"wiki_region_{_region_id}",
            "category": "region_profile",
            "target_key": _region_id,
            "title": _profile["title"],
            "severity": None,
            "content_md": _profile["assumptions"][0],
            "structured_payload": {
                "reasons": _profile["reasons"],
                "assumptions": _profile["assumptions"],
            },
            "data_version": DATA_VERSION,
        }
    )

del _region_id, _profile


# ---- historical_case：历史案例词条 -----------------------------------------
# 必须与 supabase/init.sql 里那条 case 完全一致：离线自检（tools/verify_local.py）
# 用的就是这份夹具，两边数字对不上会出现「离线全绿、连库报错」这种最难查的偏差。
KNOWLEDGE_WIKI.append(
    {
        "wiki_id": "wiki_case_chaoyang_refund_2026q2",
        "category": "historical_case",
        "target_key": "refund_high",
        "title": "案例：朝阳区 A 店退款率异常（2026 Q2）",
        "severity": "high",
        "content_md": (
            "上一季度同类症状：退款率由 2.3% 升至 6.8%，退款集中在 22:00-02:00 的夜间时段，"
            "排查后确认为一批临期乳制品未及时下架。下架处理后退款率 5 天内回落至 2.6%。"
        ),
        "structured_payload": {
            "case_id": "case_2026q2_chaoyang_refund",
            "region_id": "chaoyang",
            "store_id": "A",
            "occurred_period": "2026Q2",
            "symptom": "refund_rate_pct 显著高于同类中位数",
            "peak_refund_rate_pct": 6.8,
            "baseline_refund_rate_pct": 2.3,
            "root_cause": "临期乳制品未及时下架",
            "resolution": "下架临期批次并加严保质期巡检",
            "days_to_recover": 5,
            "recovered_refund_rate_pct": 2.6,
            "keywords": ["夜间时段", "临期商品", "乳制品", "保质期巡检"],
        },
        "data_version": DATA_VERSION,
    }
)


# ---- tasks_and_traces：1 行种子任务 ----------------------------------------
TASKS_AND_TRACES: list[dict] = [
    {
        "task_id": "task_001",
        "trace_id": "trace_20261018_A",
        "source_finding_id": "finding-001",
        "device_id": "device-A-001",
        "problem": "退款率高于同类门店中位数",
        "action": "抽查最近 20 笔退款订单并核对退款原因",
        "owner_role": "区域经理",
        "due_hours": 24,
        "verify_metric": "refund_rate",
        "verify_target": "回落至同类中位数 + 2 个百分点以内",
        "status": "open",
    }
]


class FakeRepository:
    """内存版 Repository，接口与 SupabaseRepository 一致。

    注意：这里刻意不继承 SupabaseRepository，只做鸭子类型。
    domain_services 只依赖 4 个读方法 + 若干写方法，替换实现无需改上层。
    """

    def __init__(self, data_version: str = DATA_VERSION):
        self.data_version = data_version
        self.store_operations = [dict(r) for r in STORE_OPERATIONS_DAILY]
        self.region_inputs = [dict(r) for r in REGION_MARKET_INPUTS]
        self.wiki_rows = [dict(r) for r in KNOWLEDGE_WIKI]
        self.tasks: list[dict] = [dict(r) for r in TASKS_AND_TRACES]
        self.trace_events: list[dict] = []

    # -- 读 -----------------------------------------------------------------

    def fetch_store_operations(self, data_version: str | None = None) -> list[dict]:
        version = data_version or self.data_version
        rows = [r for r in self.store_operations if r["data_version"] == version]
        return sorted(rows, key=lambda r: (r["store_id"], r["period_type"]))

    def fetch_region_inputs(self, data_version: str | None = None) -> list[dict]:
        version = data_version or self.data_version
        return sorted(
            (r for r in self.region_inputs if r["data_version"] == version),
            key=lambda r: r["region_id"],
        )

    def fetch_wiki(
        self,
        category: str | None = None,
        target_key: str | None = None,
        data_version: str | None = None,
    ) -> list[dict]:
        version = data_version or self.data_version
        rows = [r for r in self.wiki_rows if r["data_version"] == version]
        if category:
            rows = [r for r in rows if r["category"] == category]
        if target_key:
            rows = [r for r in rows if r["target_key"] == target_key]
        return sorted(rows, key=lambda r: (r["category"], r["target_key"]))

    # -- 写（供 C 层桥接测试用）---------------------------------------------

    def insert_task(self, payload: dict) -> dict:
        self.tasks.append(dict(payload))
        return dict(payload)

    def update_task_status(self, task_id: str, status: str) -> dict | None:
        for task in self.tasks:
            if task["task_id"] == task_id:
                if task["status"] in ("closed", "escalated") and status != task["status"]:
                    raise RuntimeError(
                        f"TASK_TERMINAL_STATE: 任务 {task_id} 已处于终态 {task['status']}"
                    )
                task["status"] = status
                return dict(task)
        return None

    def fetch_task(self, task_id: str) -> dict | None:
        for task in self.tasks:
            if task["task_id"] == task_id:
                return dict(task)
        return None

    def insert_trace_event(
        self,
        trace_id: str,
        node_name: str,
        payload: dict,
        data_version: str | None = None,
    ) -> None:
        self.trace_events.append(
            {
                "trace_id": trace_id,
                "node_name": node_name,
                "payload": payload or {},
                "data_version": data_version or self.data_version,
            }
        )

    def fetch_trace_events(self, trace_id: str) -> list[dict]:
        return [e for e in self.trace_events if e["trace_id"] == trace_id]

    def healthcheck(self) -> dict:
        return {
            "store_operations_daily": len(self.store_operations),
            "region_market_inputs": len(self.region_inputs),
            "knowledge_wiki": len(self.wiki_rows),
            "tasks_and_traces": len(self.tasks),
            "trace_events": len(self.trace_events),
        }


__all__ = [
    "DATA_VERSION",
    "STORE_OPERATIONS_DAILY",
    "REGION_MARKET_INPUTS",
    "KNOWLEDGE_WIKI",
    "REGION_PROFILES",
    "TASKS_AND_TRACES",
    "FakeRepository",
]
