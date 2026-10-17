-- ============================================================================
-- 莱森购 Retail Intelligence Agent —— Supabase (PostgreSQL) 一键初始化
-- 来源：docs/DATABASE_AND_WIKI_SPEC.md §2
--
-- 使用方法：
--   方式 A（Supabase 后台）：SQL Editor -> New query -> 全文粘贴 -> Run
--   方式 B（命令行）：psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/init.sql
--   方式 C（本目录脚本）：python supabase/deploy.py       # 需先配置 .env
--
-- 本脚本是幂等的：可重复执行。注意 DROP TABLE ... CASCADE 会清空这 4 张表，
-- 不要在有真实业务数据的库上执行。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. 扩展
--    pgvector：knowledge_wiki.embedding 列依赖它。
--    若该实例不支持 vector 扩展（部分自建 Postgres），把第 0 节和第 3 节的
--    embedding 列一并注释掉，其余功能不受影响。
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- 1. 门店日经营事实表 (store_operations_daily)
--    对齐 PROJECT.md §3.1
--
--    ⚠️ 口径说明（重要）：本表的种子数据是「每店每周期一行」的聚合切片，
--    不是真正的逐日流水。period_type 区分当前窗口与基准窗口。
--    因此 /api/v1/dashboard 的 from/to 参数在本 Demo 数据下不起过滤作用，
--    只做校验。接真实日粒度数据时，把 period_type 派生为按日期区间计算即可。
-- ---------------------------------------------------------------------------
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_period_type CHECK (period_type IN ('current_7d', 'baseline_7d')),
    CONSTRAINT chk_online_le_total CHECK (online_device_count <= device_count),
    CONSTRAINT uq_store_period UNIQUE (store_id, period_type, data_version)
);

CREATE INDEX idx_store_daily_region_period ON store_operations_daily (region_id, period_type, biz_date);
CREATE INDEX idx_store_daily_device_period ON store_operations_daily (device_id, period_type);

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
    -- C 店 (宽城区 - 正常：退款率 1.8%，订单较前周期 +4.0%)
    ('2026-10-18', 'kuancheng', 'C', 'device-C-001',  9,  9, 224000.00, 2910,  4032.00,  52,   -80.00, 'current_7d',  'demo_v1'),
    ('2026-10-11', 'kuancheng', 'C', 'device-C-001',  9,  9, 211321.00, 2798,  4437.74,  58,  -100.00, 'baseline_7d', 'demo_v1'),
    -- D 店 (二道区 - 正常：退款率 2.0%，同城退款率中位数锚点 2.1%)
    ('2026-10-18', 'erdao',     'D', 'device-D-001',  8,  8, 211000.00, 2730,  4431.00,  57,  -110.00, 'current_7d',  'demo_v1'),
    ('2026-10-11', 'erdao',     'D', 'device-D-001',  8,  8, 206863.00, 2703,  4344.12,  56,   -90.00, 'baseline_7d', 'demo_v1'),
    -- E 店 (绿园区 - 观察：销售额 249,000 以对齐全市总销售额 1,054,000 元)
    --    ⚠️ 订单 2860 -> 2460 = -14.0%，落在 (-20%, -5%] 区间，按规则命中 medium，
    --       但 PROJECT.md / API_CONTRACT.md 的 3 条 finding 快照里没有 E 店。
    --       见 docs/DEPLOYMENT.md §5「已知契约不一致」。
    ('2026-10-18', 'luyuan',    'E', 'device-E-001',  7,  6, 249000.00, 2460,  6723.00,  66,  -260.00, 'current_7d',  'demo_v1'),
    ('2026-10-11', 'luyuan',    'E', 'device-E-001',  7,  7, 262000.00, 2860,  5502.00,  60,  -150.00, 'baseline_7d', 'demo_v1')
ON CONFLICT (store_id, period_type, data_version) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. 区域投放与 ROI 测算参数表 (region_market_inputs)
--    用于确定性计算 compareRegions 与 estimateRegionROI
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS region_market_inputs CASCADE;
CREATE TABLE region_market_inputs (
    region_id TEXT PRIMARY KEY,              -- chaoyang | nanguan | kuancheng | erdao | luyuan
    name TEXT NOT NULL,
    demand_score NUMERIC(5, 2) NOT NULL CHECK (demand_score BETWEEN 0 AND 100),
    competition_score NUMERIC(5, 2) NOT NULL CHECK (competition_score BETWEEN 0 AND 100),
    margin_score NUMERIC(5, 2) NOT NULL CHECK (margin_score BETWEEN 0 AND 100),
    cost_score NUMERIC(5, 2) NOT NULL CHECK (cost_score BETWEEN 0 AND 100),
    estimated_monthly_profit NUMERIC(12, 2) NOT NULL,
    estimated_period_profit NUMERIC(12, 2) NOT NULL,
    capex_investment NUMERIC(12, 2),         -- 缺失时为 NULL -> payback 必须返回 null
    has_complete_cost_data BOOLEAN NOT NULL DEFAULT TRUE,
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
    ('luyuan',    '绿园区', 80.0, 76.0, 78.0, 55.3, 29400.00, 46900.00, 358680.00, TRUE)
ON CONFLICT (region_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. 结构化 Wiki 与语义规则表 (knowledge_wiki)
--    同时承载：semantic_rule / sop_playbook / region_profile / historical_case
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS knowledge_wiki CASCADE;
CREATE TABLE knowledge_wiki (
    wiki_id TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK (category IN ('semantic_rule', 'sop_playbook', 'region_profile', 'historical_case')),
    target_key TEXT NOT NULL,                -- 精确挂载键：'refund_high' | 'chaoyang' | 'region_scoring_v1'
    title TEXT NOT NULL,
    severity TEXT CHECK (severity IN ('high', 'medium', 'low')),
    content_md TEXT NOT NULL,
    structured_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    embedding vector(1536),                  -- 预留：仅 historical_case 语义检索使用
    data_version TEXT NOT NULL DEFAULT 'demo_v1',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wiki_category_target ON knowledge_wiki (category, target_key);
-- 同一 (category, target_key, data_version) 只应有一条生效词条
CREATE UNIQUE INDEX uq_wiki_category_target_version
    ON knowledge_wiki (category, target_key, data_version);

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
    -- (B) 异常处置标准 SOP 词条（finding_id 与 API_CONTRACT.md fixtures 对齐）
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
    ),
    -- (D) 历史案例。四类词条里的 historical_case 不是摆设：
    --     它是 embedding 列唯一的真实用途（语义检索相似历史事件），
    --     也是新发现判级时的参照——「上次同样症状最后是什么原因」。
    (
        'wiki_case_chaoyang_refund_2026q2',
        'historical_case',
        'refund_high',
        '案例：朝阳区 A 店退款率异常（2026 Q2）',
        'high',
        '上一季度同类症状：退款率由 2.3% 升至 6.8%，退款集中在 22:00-02:00 的夜间时段，'
        || '排查后确认为一批临期乳制品未及时下架。下架处理后退款率 5 天内回落至 2.6%。',
        '{
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
          "keywords": ["夜间时段", "临期商品", "乳制品", "保质期巡检"]
        }'::jsonb
    )
ON CONFLICT (wiki_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. 任务状态机与审计追踪表 (tasks_and_traces)
--    支撑 create_task / verify_task / trace 持久化
-- ---------------------------------------------------------------------------
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

CREATE INDEX idx_tasks_status ON tasks_and_traces (status, updated_at DESC);
CREATE INDEX idx_tasks_trace ON tasks_and_traces (trace_id);

-- 状态机单向迁移守卫：closed / escalated 为终态，不可回退
CREATE OR REPLACE FUNCTION enforce_task_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IN ('closed', 'escalated') AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'TASK_TERMINAL_STATE: 任务 % 已处于终态 %，不允许迁移到 %',
            OLD.task_id, OLD.status, NEW.status;
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_task_status_transition
    BEFORE UPDATE ON tasks_and_traces
    FOR EACH ROW EXECUTE FUNCTION enforce_task_status_transition();

INSERT INTO tasks_and_traces (
    task_id, trace_id, source_finding_id, device_id,
    problem, action, owner_role, due_hours, verify_metric, verify_target, status
) VALUES (
    'task_001', 'trace_20261018_A', 'finding-001', 'device-A-001',
    '退款率高于同类门店中位数', '抽查最近 20 笔退款订单并核对退款原因',
    '区域经理', 24, 'refund_rate', '回落至同类中位数 + 2 个百分点以内', 'open'
)
ON CONFLICT (task_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Agent Trace 事件表（追溯要求：问题 -> 工具调用 -> 数据版本 -> 结果）
--    DATABASE_AND_WIKI_SPEC.md 只定义了 tasks_and_traces 一张表来承载 trace，
--    但 agent_run 需要的多事件时序无法塞进单行。这里补一张从表，
--    tasks_and_traces 仍可作为「主表」按 trace_id 关联。不需要可整节删除。
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS trace_events CASCADE;
CREATE TABLE trace_events (
    id BIGSERIAL PRIMARY KEY,
    trace_id TEXT NOT NULL,
    node_name TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    data_version TEXT NOT NULL DEFAULT 'demo_v1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trace_events_trace ON trace_events (trace_id, id);

-- ---------------------------------------------------------------------------
-- 6. 建库后自检：应返回 10 行 / 5 行 / 11 行 / 1 行 / 0 行
-- ---------------------------------------------------------------------------
-- SELECT 'store_operations_daily' AS tbl, COUNT(*) FROM store_operations_daily
-- UNION ALL SELECT 'region_market_inputs', COUNT(*) FROM region_market_inputs
-- UNION ALL SELECT 'knowledge_wiki', COUNT(*) FROM knowledge_wiki
-- UNION ALL SELECT 'tasks_and_traces', COUNT(*) FROM tasks_and_traces
-- UNION ALL SELECT 'trace_events', COUNT(*) FROM trace_events;
