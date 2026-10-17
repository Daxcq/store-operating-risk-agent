# 莱森购 Retail Intelligence Agent：Supabase (PostgreSQL) 数据库与结构化 Wiki 规范

## 1. B 与 C 的分工边界（谁做什么？）

为了确保团队协作效率最高且严格遵循 [docs/API_CONTRACT.md](./API_CONTRACT.md)，Supabase 数据库部分的职责按以下边界切分：

| 任务模块 | 负责角色 | 具体工作内容 |
| :--- | :---: | :--- |
| **1. 云端建表与初始数据灌入** | **B 或 C 均可**<br/>*(10 秒完成)* | 直接复制本文档第 2 节的完整 SQL 脚本，在 **Supabase SQL Editor** 中点击 `Run` 一键创建 4 张表及全量种子数据。 |
| **2. 经营数据聚合、规则判定与 Wiki 挂载** | **成员 B (主力)**<br/>*(Python 数据层)* | 使用 Python (`supabase-py` 或 `psycopg2`) 读取前 3 张表（`store_operations_daily`、`region_market_inputs`、`knowledge_wiki`），动态计算指标、命中异常规则、拼装 SOP 与商圈档案，对外提供 `getDashboardMetrics`、`auditOperations`、`compareRegions`、`estimateRegionROI` 四个标准契约输出。 |
| **3. 服务桥接、断网兜底与任务/Trace 落库** | **成员 C**<br/>*(Node / LangGraph)* | 在 [`defaultDomainServices.js`](../src/agent/components/defaultDomainServices.js) 中接入 B 的接口（保留本地内存数据作为云端超时 Fallback），并将 `create_task` / `verify_task` / [`traceLogger.js`](../src/server/traceLogger.js) 关联到第 4 张表 `tasks_and_traces`。 |

---

## 2. Supabase SQL Editor 一键初始化脚本（含 DDL + 种子数据）

> **使用方法**：打开 Supabase 项目后台 $\to$ 左侧菜单点击 **SQL Editor** $\to$ 新建 Query $\to$ 完整复制下方 SQL 代码块并点击 **Run**。

```sql
-- ============================================================================
-- 0. 开启 pgvector 扩展（供后续历史案例混合检索扩展使用）
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- 1. 门店日经营事实表 (store_operations_daily)
--    对齐 PROJECT.md §3.1，存储长春 5 家门店在当前窗口与前周期基准的经营流水
-- ============================================================================
DROP TABLE IF EXISTS store_operations_daily CASCADE;
CREATE TABLE store_operations_daily (
    id BIGSERIAL PRIMARY KEY,
    biz_date DATE NOT NULL,
    region_id TEXT NOT NULL,                 -- chaoyang | nanguan | kuancheng | erdao | luyuan
    store_id TEXT NOT NULL,                  -- A | B | C | D | E
    device_id TEXT NOT NULL,                 -- device-A-001 .. device-E-001
    device_count INTEGER NOT NULL CHECK (device_count >= 0),
    online_device_count INTEGER NOT NULL CHECK (online_device_count >= 0),
    sales_amount NUMERIC(12, 2) NOT NULL,    -- 人民币元
    order_count INTEGER NOT NULL CHECK (order_count >= 0),
    refund_amount NUMERIC(12, 2) NOT NULL,   -- 人民币元
    refund_order_count INTEGER NOT NULL CHECK (refund_order_count >= 0),
    inventory_diff_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    period_type TEXT NOT NULL DEFAULT 'current_7d', -- 'current_7d' | 'baseline_7d'
    data_version TEXT NOT NULL DEFAULT 'demo_v1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_store_daily_region_period ON store_operations_daily (region_id, period_type, biz_date);
CREATE INDEX idx_store_daily_device_period ON store_operations_daily (device_id, period_type);

-- 灌入长春 5 店模拟聚合切片数据（严格对齐 API_CONTRACT.md 与 fixtures 数值）
INSERT INTO store_operations_daily (
    biz_date, region_id, store_id, device_id,
    device_count, online_device_count,
    sales_amount, order_count, refund_amount, refund_order_count,
    inventory_diff_amount, period_type, data_version
) VALUES
    -- A 店 (朝阳区 - 高风险：退款率 7.0%，订单较前周期下降 31%)
    ('2026-10-18', 'chaoyang',  'A', 'device-A-001', 10, 10, 172000.00, 2140, 12040.00, 150, -1200.00, 'current_7d',  'demo_v1'),
    ('2026-10-11', 'chaoyang',  'A', 'device-A-001', 10, 10, 238889.00, 3101,  5016.67,  65,  -300.00, 'baseline_7d', 'demo_v1'),
    -- B 店 (南关区 - 中风险观察：订单较前周期下降 9%，退款率 3.4%)
    ('2026-10-18', 'nanguan',   'B', 'device-B-001',  8,  7, 198000.00, 2580,  6732.00,  88,  -450.00, 'current_7d',  'demo_v1'),
    ('2026-10-11', 'nanguan',   'B', 'device-B-001',  8,  8, 217582.00, 2835,  4569.22,  60,  -200.00, 'baseline_7d', 'demo_v1'),
    -- C 店 (宽城区 - 正常：退款率 1.8%)
    ('2026-10-18', 'kuancheng', 'C', 'device-C-001',  9,  9, 224000.00, 2910,  4032.00,  52,   -80.00, 'current_7d',  'demo_v1'),
    ('2026-10-11', 'kuancheng', 'C', 'device-C-001',  9,  9, 211321.00, 2798,  4437.74,  58,  -100.00, 'baseline_7d', 'demo_v1'),
    -- D 店 (二道区 - 正常：退款率 2.0%，同城退款率中位数锚点 2.1%)
    ('2026-10-18', 'erdao',     'D', 'device-D-001',  8,  8, 211000.00, 2730,  4431.00,  57,  -110.00, 'current_7d',  'demo_v1'),
    ('2026-10-11', 'erdao',     'D', 'device-D-001',  8,  8, 206863.00, 2703,  4344.12,  56,   -90.00, 'baseline_7d', 'demo_v1'),
    -- E 店 (绿园区 - 观察：销售额 249,000 以对齐全市总销售额 1,054,000 元)
    ('2026-10-18', 'luyuan',    'E', 'device-E-001',  7,  6, 249000.00, 2460,  6723.00,  66,  -260.00, 'current_7d',  'demo_v1'),
    ('2026-10-11', 'luyuan',    'E', 'device-E-001',  7,  7, 262000.00, 2860,  5502.00,  60,  -150.00, 'baseline_7d', 'demo_v1');

-- ============================================================================
-- 2. 区域投放与 ROI 测算参数表 (region_market_inputs)
--    用于确定性计算 compareRegions 与 estimateRegionROI
-- ============================================================================
DROP TABLE IF EXISTS region_market_inputs CASCADE;
CREATE TABLE region_market_inputs (
    region_id TEXT PRIMARY KEY,              -- chaoyang | nanguan | kuancheng | erdao | luyuan
    name TEXT NOT NULL,
    demand_score NUMERIC(5, 2) NOT NULL,     -- 客流与需求分 (0..100)
    competition_score NUMERIC(5, 2) NOT NULL,-- 竞品环境分 (0..100)
    margin_score NUMERIC(5, 2) NOT NULL,     -- 毛利空间分 (0..100)
    cost_score NUMERIC(5, 2) NOT NULL,       -- 租金与成本压力分 (0..100)
    estimated_monthly_profit NUMERIC(12, 2) NOT NULL, -- 预计月利润（元）
    estimated_period_profit NUMERIC(12, 2) NOT NULL,  -- 当前观察期经营利润（元，用于 Dashboard 汇总 218,000）
    capex_investment NUMERIC(12, 2),         -- 设备总投入（元，缺失时为 NULL）
    has_complete_cost_data BOOLEAN NOT NULL DEFAULT TRUE, -- FALSE 时 estimatedPaybackMonths 必须返回 null
    data_version TEXT NOT NULL DEFAULT 'demo_v1'
);

INSERT INTO region_market_inputs (
    region_id, name,
    demand_score, competition_score, margin_score, cost_score,
    estimated_monthly_profit, estimated_period_profit, capex_investment, has_complete_cost_data
) VALUES
    ('chaoyang',  '朝阳区', 92.0, 88.0, 86.0, 46.7, 42800.00, 36100.00, 359520.00, TRUE),
    ('nanguan',   '南关区', 84.0, 74.0, 78.0, 84.0, 26500.00, 41500.00, NULL,      FALSE),
    ('kuancheng', '宽城区', 88.0, 82.0, 84.0, 50.0, 38200.00, 49200.00, 359080.00, TRUE),
    ('erdao',     '二道区', 83.0, 80.0, 81.0, 48.0, 33600.00, 44300.00, 359520.00, TRUE),
    ('luyuan',    '绿园区', 80.0, 76.0, 78.0, 55.3, 29400.00, 46900.00, 358680.00, TRUE);

-- ============================================================================
-- 3. 结构化 Wiki 与语义规则表 (knowledge_wiki)
--    同时承载：语义层规则 (semantic_rule)、异常 SOP (sop_playbook)、
--    商圈定性档案 (region_profile) 与历史复盘案例 (historical_case)
-- ============================================================================
DROP TABLE IF EXISTS knowledge_wiki CASCADE;
CREATE TABLE knowledge_wiki (
    wiki_id TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK (category IN ('semantic_rule', 'sop_playbook', 'region_profile', 'historical_case')),
    target_key TEXT NOT NULL,                -- 精确挂载键：如 'refund_high' | 'chaoyang' | 'region_scoring_v1'
    title TEXT NOT NULL,
    severity TEXT CHECK (severity IN ('high', 'medium', 'low')),
    content_md TEXT NOT NULL,
    structured_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    embedding vector(1536),                  -- 预留 pgvector 向量列（仅 historical_case 语义检索时使用）
    data_version TEXT NOT NULL DEFAULT 'demo_v1',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wiki_category_target ON knowledge_wiki (category, target_key);

INSERT INTO knowledge_wiki (wiki_id, category, target_key, title, severity, content_md, structured_payload) VALUES
    -- (A) 语义层规则与权重字典
    (
        'wiki_rule_anomaly_v1',
        'semantic_rule',
        'store_anomaly_v1',
        '门店经营异常判定规则 v1',
        NULL,
        '先按观察窗口 SUM 聚合再计算比率。可比门店少于 3 家时返回 insufficient。',
        '{
          "min_peer_count": 3,
          "peer_median_refund_rate_pct": 2.1,
          "rules": {
            "refund_high": { "metric": "refund_rate_pct", "op": ">=", "threshold": 5.0, "severity": "high" },
            "order_drop_severe": { "metric": "order_change_pct", "op": "<=", "threshold": -20.0, "severity": "low" },
            "order_drop_watch": { "metric": "order_change_pct", "op": "<=", "threshold": -5.0, "severity": "medium" }
          }
        }'::jsonb
    ),
    (
        'wiki_rule_scoring_v1',
        'semantic_rule',
        'region_scoring_v1',
        '区域投放多维加权评分公式 v1',
        NULL,
        'score = w1*demand + w2*competition + w3*margin - w4*cost，裁剪至 0..100。',
        '{
          "weights": {
            "w1_demand": 0.45,
            "w2_competition": 0.25,
            "w3_margin": 0.35,
            "w4_cost": 0.15
          }
        }'::jsonb
    ),
    -- (B) 异常处置标准 SOP 词条
    (
        'wiki_sop_refund_high',
        'sop_playbook',
        'refund_high',
        '退款率高于同类设备',
        'high',
        '当门店近 7 天退款率 >= 5.0% 且显著高于同城可比中位数时触发高风险审计项。',
        '{
          "finding_id": "finding-001",
          "evidence_template": "近 7 天退款率 {refund_rate}%，同类中位数 {peer_median_refund_rate}%。",
          "recommendation": "抽查最近 20 笔退款订单并核对退款原因。",
          "owner_role": "区域经理",
          "due_hours": 24,
          "verify_metric": "refund_rate",
          "verify_target": "回落至同类中位数 + 2 个百分点以内"
        }'::jsonb
    ),
    (
        'wiki_sop_order_drop_severe',
        'sop_playbook',
        'order_drop_severe',
        '订单数低于观察窗口基准',
        'low',
        '当门店近 7 天订单数较前周期下降超过 20% 时触发订单结构核查。',
        '{
          "finding_id": "finding-002",
          "evidence_template": "近 7 天订单数较前周期下降 {abs_order_change_pct}%。",
          "recommendation": "核对客流、营业时段和商品结构。"
        }'::jsonb
    ),
    (
        'wiki_sop_order_drop_watch',
        'sop_playbook',
        'order_drop_watch',
        '订单数低于观察窗口基准',
        'medium',
        '当门店近 7 天订单数较前周期下降 5%~20% 时触发常规关注核查。',
        '{
          "finding_id": "finding-003",
          "evidence_template": "近 7 天订单数较前周期下降 {abs_order_change_pct}%。",
          "recommendation": "核对客流、营业时段和近期促销记录。"
        }'::jsonb
    ),
    -- (C) 长春 5 区商圈定性档案
    (
        'wiki_region_chaoyang',
        'region_profile',
        'chaoyang',
        '长春市朝阳区（红旗街商圈）投放档案',
        NULL,
        '朝阳区商业成熟度高，客流稳定且竞品密度可控，成本数据完整。',
        '{
          "reasons": ["客流稳定", "竞品密度可控"],
          "assumptions": ["按近 30 天模拟客流估算", "设备投入按 360000 元计算"]
        }'::jsonb
    ),
    (
        'wiki_region_nanguan',
        'region_profile',
        'nanguan',
        '长春市南关区（重庆路商圈）投放档案',
        NULL,
        '南关区核心地段租金较高，且目前缺少完整长租合同数据，不做回本周期估算。',
        '{
          "reasons": ["租金较高"],
          "assumptions": ["缺少完整租金数据，回本周期不做合理估算"]
        }'::jsonb
    ),
    (
        'wiki_region_kuancheng',
        'region_profile',
        'kuancheng',
        '长春市宽城区（北站商圈）投放档案',
        NULL,
        '宽城区依托北站交通枢纽客流充沛，退款率低于同城中位数。',
        '{
          "reasons": ["北站交通枢纽客流充沛", "退款率低于同城中位数"],
          "assumptions": ["按近 30 天模拟客流估算", "设备投入按 360000 元计算"]
        }'::jsonb
    ),
    (
        'wiki_region_erdao',
        'region_profile',
        'erdao',
        '长春市二道区（东盛大街商圈）投放档案',
        NULL,
        '二道区社区商圈复购稳定，履约成本适中。',
        '{
          "reasons": ["社区商圈复购稳定", "履约成本适中"],
          "assumptions": ["按近 30 天模拟客流估算", "设备投入按 360000 元计算"]
        }'::jsonb
    ),
    (
        'wiki_region_luyuan',
        'region_profile',
        'luyuan',
        '长春市绿园区（吾悦广场商圈）投放档案',
        NULL,
        '绿园区商业综合体周末客流集中，工作日夜间时段订单偏弱。',
        '{
          "reasons": ["商业综合体周末客流集中", "工作日夜间时段订单偏弱"],
          "assumptions": ["按近 30 天模拟客流估算", "设备投入按 360000 元计算"]
        }'::jsonb
    );

-- ============================================================================
-- 4. 任务状态机与审计追踪表 (tasks_and_traces)
--    支撑 create_task、verify_task 以及 Agent 运行 Trace 持久化
-- ============================================================================
DROP TABLE IF EXISTS tasks_and_traces CASCADE;
CREATE TABLE tasks_and_traces (
    task_id TEXT PRIMARY KEY,
    trace_id TEXT,
    source_finding_id TEXT,
    device_id TEXT,
    problem TEXT NOT NULL,
    action TEXT NOT NULL,
    owner_role TEXT NOT NULL DEFAULT '区域经理',
    due_hours INTEGER NOT NULL DEFAULT 24,
    verify_metric TEXT NOT NULL DEFAULT 'refund_rate',
    verify_target TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'investigating', 'verifying', 'closed', 'escalated')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO tasks_and_traces (
    task_id, trace_id, source_finding_id, device_id,
    problem, action, owner_role, due_hours, verify_metric, verify_target, status
) VALUES (
    'task_001', 'trace_20261018_A', 'finding-001', 'device-A-001',
    '退款率高于同类门店中位数', '抽查最近 20 笔退款订单并核对退款原因',
    '区域经理', 24, 'refund_rate', '回落至同类中位数 + 2 个百分点以内', 'open'
);
```

---

## 3. 成员 B（Python）连接 Supabase 的最小代码模板

B 同学只需要安装 `pip install supabase`，用以下方式读取上面建好的表并返回标准契约 JSON：

```python
import os
from supabase import create_client, Client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_ANON_KEY"]
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def estimate_region_roi(region_id: str) -> dict:
    # 1. 查 region_market_inputs 定量参数
    reg_res = supabase.table("region_market_inputs").select("*").eq("region_id", region_id).execute()
    if not reg_res.data:
        raise ValueError(f"REGION_NOT_FOUND: {region_id}")
    r = reg_res.data[0]

    # 2. 查 knowledge_wiki 里的评分权重语义规则
    rule_res = (
        supabase.table("knowledge_wiki")
        .select("structured_payload")
        .eq("category", "semantic_rule")
        .eq("target_key", "region_scoring_v1")
        .single()
        .execute()
    )
    w = rule_res.data["structured_payload"]["weights"]

    raw_score = (
        w["w1_demand"] * float(r["demand_score"])
        + w["w2_competition"] * float(r["competition_score"])
        + w["w3_margin"] * float(r["margin_score"])
        - w["w4_cost"] * float(r["cost_score"])
    )
    score = round(min(100.0, max(0.0, raw_score)), 1)

    # 严格遵守契约：无法合理估算回本周期时返回 None (JSON null)
    monthly_profit = float(r["estimated_monthly_profit"])
    if not r["has_complete_cost_data"] or r["capex_investment"] is None or monthly_profit <= 0:
        payback_months = None
    else:
        payback_months = round(float(r["capex_investment"]) / monthly_profit, 1)

    # 3. 查 knowledge_wiki 里的商圈定性档案 (reasons & assumptions)
    wiki_res = (
        supabase.table("knowledge_wiki")
        .select("structured_payload")
        .eq("category", "region_profile")
        .eq("target_key", region_id)
        .single()
        .execute()
    )
    payload = wiki_res.data["structured_payload"] if wiki_res.data else {}

    return {
        "regionId": r["region_id"],
        "name": r["name"],
        "score": score,
        "estimatedMonthlyProfit": monthly_profit,
        "estimatedPaybackMonths": payback_months,
        "reasons": payload.get("reasons", []),
        "assumptions": payload.get("assumptions", []),
    }
```
