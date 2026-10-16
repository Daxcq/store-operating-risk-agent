# 门店经营风险侦察 Agent

## 1. 项目定位

### 一句话

一个面向区域经理和风控人员的 Agent：持续读取门店经营流水，发现多指标异常，和同区域门店做对标，自动收集证据并生成可核查的风险报告与优化建议。

### 要解决的问题

普通看板需要人自己盯数字、找原因、写结论。本项目把这条链路固定下来：

```text
门店数据 -> 指标计算 -> 异常规则 -> 风险事件 -> 自动调查 -> 风险报告
```

风险事件确认后，再进入一条轻量的优化闭环：

```text
异常门店 -> 同区域对标 -> 差距拆解 -> 优先级建议 -> 复核结果
```

Agent 只负责理解用户问题和把已判定的结果讲清楚；指标计算、规则判定和证据记录由服务端完成。

## 2. 一天内锁定的场景

### 场景名称

**A 店经营异常核查**

### 使用者

区域经理或风控人员。

### 触发方式

系统每次加载一批门店日汇总数据后运行规则；也支持用户输入：

> “检查 A 店最近 7 天是否存在经营异常，并生成风险报告。”

### 演示故事

最近 7 天，A 店销售额比前 7 天下降 28%，退款率升至 7%，客单价下降 15%；同区域其他门店没有类似变化。

系统命中 3 条规则，创建一个风险事件，自动整理相关指标和订单摘要，输出：

> A 店可能存在经营异常。当前证据支持“销售下滑、退款偏高、客单价下降”，但不能仅凭经营数据确认具体根因。建议优先抽查退款订单并核对促销记录。

## 3. MVP 成功标准

一天结束时，必须能用一份固定样例数据完整跑通：

1. 载入门店日汇总数据；
2. 计算 6 个指标中的至少 5 个；
3. 对 A 店执行 3 条异常规则；
4. 在 0/1/2/3 条规则命中时给出不同结论；
5. 自动生成 JSON 和可读 Markdown 风险报告；
6. 报告中每个数字都能通过 trace 找回输入行和计算过程。

## 4. 明确范围

### 一天内做

- 单区域、5 家门店、最近 14 天的 CSV 或 JSON 数据；
- 指标：销售额、订单数、客单价、退款额、退款率、销售额周环比；
- 维度：门店、日期；
- 同区域对标：以其他门店的中位数作为基准，计算 A 店的指标差距和排名；
- 一条风险定义：至少命中 2 条规则即为“可能存在经营异常”；
- 自动调查：整理指标证据、同区域对照和待核查项；
- 对标优化：根据最大差距指标生成 1-2 条待核查、可执行的优化建议；
- 报告：风险等级、命中规则、证据、可能原因、建议动作、数据边界；
- trace：记录数据版本、查询参数、指标结果、规则版本和报告版本。

### 一天内不做

- 库存、会员复购、营销归因和销量预测；
- 多区域、多租户和复杂权限；
- 跨行业、跨区域和动态权重的复杂对标模型；
- 多数据源实时同步和消息队列；
- 自动改价、自动排班或自动投放等执行型优化；
- 自动认定责任、自动处罚或自动冻结资金；
- 让大模型自由写 SQL 或自由设定阈值；
- 仅凭销售数据断言“欺诈”“舞弊”或具体根因。

## 5. 数据契约

### 输入文件

建议文件：`data/store_sales_daily.csv`。

字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `date` | date | 业务日期 |
| `region` | string | 区域 |
| `store_id` | string | 门店 ID |
| `sales_amount` | decimal | 已确认口径的销售额 |
| `order_count` | integer | 有效订单数 |
| `refund_amount` | decimal | 退款额 |
| `refund_order_count` | integer | 发生退款的订单数 |
| `data_version` | string | 数据批次或文件版本 |

MVP 假设：销售额已扣退款，排除员工单和测试单；数据按“门店 × 日”汇总且不重复。真实口径未确认前，必须在报告中标记为假设。

### 报告范围

```yaml
region: East
stores: [A, B, C, D, E]
window: 2026-10-12/2026-10-18
baseline: previous_7_days
```

所有计算必须带上这个范围；越过范围的查询直接拒绝并写入 trace。

## 6. 指标定义

所有指标先聚合原始金额和数量，再计算比率，禁止对每日比率求平均。

```text
sales_amount = SUM(sales_amount)
order_count = SUM(order_count)
aov = sales_amount / NULLIF(order_count, 0)
refund_amount = SUM(refund_amount)
refund_rate = refund_amount / NULLIF(sales_amount, 0) * 100
sales_change_pct = (current_sales - baseline_sales) / baseline_sales * 100
```

### 对标指标

对标只在同一区域、同一观察窗口内进行，默认排除数据不完整的门店。

```text
peer_median(metric) = MEDIAN(metric of comparable stores)
gap_pct(metric) = (store_metric - peer_median) / peer_median * 100
peer_rank(metric) = rank of store among comparable stores
```

MVP 只输出中位数、差距百分比和排名，不引入复杂加权评分。对销售额这类规模指标，报告同时展示订单数和客单价，避免把“规模差异”误判成“经营效率差异”。

指标需要包含：`id`、中文名、别名、公式、时间窗口、数据源、口径说明、状态。只有 `approved` 指标可被查询；`draft` 指标只能进入待确认清单。

## 7. 异常规则

阈值放在配置文件，不写死在 Agent 提示词中。以下是演示阈值，正式使用前需业务确认。

```yaml
definition: store_anomaly_v1
decision: at_least_2
conditions:
  - id: sales_drop
    test: sales_change_pct <= -20
  - id: refund_high
    test: refund_rate >= 5
  - id: aov_drop
    test: aov_change_pct <= -10
```

判定结果固定为：

- `none`：命中 0 条；
- `insufficient`：命中 1 条，证据不足，不下风险结论；
- `possible`：命中至少 2 条，可能存在经营异常，进入调查流程；
- `unavailable`：关键数据缺失、基准为 0 或数据批次不完整，不能判定。

规则引擎是纯代码，不调用大模型。

## 8. Agent 协作流程

### 8.1 服务端状态机

```text
RECEIVED
  -> SCOPE_VALIDATED
  -> METRICS_COMPUTED
  -> RULES_JUDGED
  -> INVESTIGATION_BUILT
  -> REPORT_GENERATED
```

任一步缺少结果，后续步骤不得执行。相同门店、规则和数据窗口重复运行时复用结果，并保留运行 ID。

### 8.2 各模块职责

| 模块 | 负责 | 不负责 |
|---|---|---|
| `data_loader` | 读取、校验和版本化输入数据 | 推断字段含义 |
| `metric_service` | 按指标契约计算数值 | 修改业务口径 |
| `rule_engine` | 判断条件和证据是否足够 | 解释根因 |
| `investigator` | 汇总对照数据、异常指标和待查项 | 编造外部事实 |
| `benchmark_service` | 计算同区域基准、差距和排名 | 把相关性当成因果关系 |
| `agent` | 把结构化结果转为自然语言 | 自由写 SQL、改阈值、改判定 |
| `report_writer` | 输出 JSON/Markdown 报告 | 覆盖原始证据 |
| `trace_logger` | 记录全过程 | 只记录最终摘要 |

### 8.3 Agent 输入限制

报告生成模型只能看到 `judgement` 和 `investigation` JSON，不直接看到未经处理的全量数据。提示词要求：

- 不新增 JSON 中不存在的数字；
- 区分“事实”“可能原因”和“待核实事项”；
- 命中不足时使用固定的证据不足表述；
- 任何结论都带证据 ID。

## 9. 自动调查内容

当 `verdict=possible` 时，自动生成以下调查包：

1. **时间对照**：最近 7 天与前 7 天的指标变化；
2. **同区域对照**：A 店与其他门店的销售变化和退款率；
3. **异常拆解**：销售额下降来自订单数下降、客单价下降，还是两者同时发生；
4. **退款摘要**：退款金额、退款订单数、退款率变化；
5. **待核查假设**：异常退款、客流变化、促销结束、数据延迟；
6. **下一步动作**：抽查退款订单、核对促销记录、确认数据批次。

“异常退款”等只作为待核查假设，不作为已证实根因。

### 9.1 对标优化

调查完成后，`benchmark_service` 生成一份可解释的差距清单：

| 对标项 | 计算 | 用途 |
|---|---|---|
| 退款率差距 | A 店退款率 - 区域门店中位数 | 判断是否优先查退款 |
| 客单价差距 | A 店客单价 - 区域门店中位数 | 判断是否需要查商品结构或促销 |
| 销售额变化差距 | A 店销售变化 - 区域门店销售变化中位数 | 区分单店问题和区域性波动 |

建议生成遵循固定映射，不由模型自由发明：

- 退款率显著高于区域中位数：优先抽查退款订单和退款原因；
- 客单价显著低于区域中位数：核对商品结构、折扣和促销记录；
- 只有 A 店销售额下降、区域中位数稳定：优先检查门店运营和数据完整性；
- 全区域同步下降：标记为区域性波动，不把问题归因于单店。

每条建议必须绑定 `gap_evidence_id`，并标注为“建议核查”，不能写成已证实原因。

## 10. 风险报告格式

文件：`reports/{event_id}.md` 和 `reports/{event_id}.json`。

```json
{
  "event_id": "evt_20261018_A_001",
  "risk_type": "store_operating_anomaly",
  "risk_level": "medium",
  "subject": {"store_id": "A", "region": "East"},
  "window": {"current": "2026-10-12/2026-10-18", "baseline": "previous_7_days"},
  "verdict": "possible",
  "hit_conditions": ["sales_drop", "refund_high", "aov_drop"],
  "facts": [
    {"metric": "sales_change_pct", "value": -28, "unit": "%", "evidence_id": "ev_001"},
    {"metric": "refund_rate", "value": 7, "unit": "%", "evidence_id": "ev_002"},
    {"metric": "aov_change_pct", "value": -15, "unit": "%", "evidence_id": "ev_003"}
  ],
  "hypotheses": ["refund anomaly", "traffic decline", "promotion change"],
  "benchmark": {
    "peer_count": 4,
    "refund_rate_peer_median": 2.1,
    "refund_rate_gap_pct": 233.3,
    "aov_peer_median": 86.5,
    "aov_gap_pct": -15.0,
    "evidence_id": "ev_peer_001"
  },
  "optimization_actions": [
    {"priority": 1, "action": "sample refund orders", "reason": "refund rate is above peer median", "evidence_id": "ev_peer_001"},
    {"priority": 2, "action": "verify promotion and product mix", "reason": "aov is below peer median", "evidence_id": "ev_peer_001"}
  ],
  "recommended_checks": ["sample refund orders", "verify promotion records"],
  "limitations": ["sales data cannot prove root cause"],
  "trace_id": "trace_20261018_001"
}
```

## 11. 建议代码结构

```text
AGENTS.md
README.md
configs/
  thresholds.yaml
contracts/
  metrics.yaml
  report_scope.yaml
  risk_definition.yaml
  report.schema.json
data/
  store_sales_daily.csv
tools/
  data_loader.py
  metrics.py
  trace.py
agent/
  pipeline.py
  rule_engine.py
  investigator.py
  benchmark.py
  report_writer.py
reports/
eval/
  cases.yaml
  run_eval.py
```

如果已有项目框架，沿用现有目录；以上目录只表达职责边界，不要求为了目录而重构工程。

## 12. 一天执行计划

### 上午：契约和数据闭环

- 确认销售额、退款和订单的口径；未确认项写成假设；
- 准备 5 家门店、14 天样例数据，包含正常、只命中 1 条、命中 3 条、数据缺失 4 种 fixture；
- 冻结指标、范围、规则和报告 schema；
- 实现数据读取、指标计算和 trace。

验收：能打印 A 店当前窗口与基准窗口的 5 个指标，且手算结果一致。

### 下午：风控闭环和演示

- 实现纯代码规则判定；
- 实现自动调查摘要和结构化报告；
- 实现同区域中位数对标、差距拆解和固定建议映射；
- 接入 Agent 生成自然语言摘要；
- 跑评测并完成 5 分钟演示。

验收：四种 fixture 的 verdict 正确，报告数字都有 evidence ID，报告包含同区域对标差距和至少一条可解释建议，库外指标和缺失数据不会被编造。

## 13. 路演演示脚本

1. 输入：“检查 A 店最近 7 天是否存在经营异常。”
2. 展示指标计算：销售额 -28%、退款率 7%、客单价 -15%。
3. 展示规则：命中 3/3，风险状态为 `possible`。
4. 展示调查：同区域门店没有同步下降，系统列出退款订单和促销记录核查建议。
5. 展示对标优化：A 店退款率高于区域中位数，系统把“抽查退款订单”排为第一优先级。
6. 打开风险报告：事实、对标差距、优化建议、证据链接、trace ID 和限制条件。
7. 切换到“只命中销售额下降”的 fixture，展示“证据不足，不下结论”。

路演重点是“发现异常后自动完成调查准备”，而不是图表数量。

## 14. 后续扩展

- 接入真实数仓或实时事件流；
- 增加库存、会员和营销数据；
- 增加企业级权限、审批和告警通知；
- 将同一套契约替换为链上资金池指标：净流出、流动性下降、地址集中度和大户撤资；
- 在有额外证据后再做根因关联，不把模型猜测当作事实。
