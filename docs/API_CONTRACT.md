# 莱森购 Retail Intelligence Agent API Contract v0.1

## 1. 冻结说明

本文件是 A（React 前端）、B（经营数据与规则）、C（Agent、API、集成）的共享接口契约。

- 状态：**冻结 v0.1**。
- 本轮目标：支持一天内完成的前后端并行开发和 Demo 集成。
- 变更规则：后续只能由 A/B/C 共同确认后修改版本；破坏性修改必须升级主版本。
- 共享类型位置：`contracts/src/index.ts`。
- 当前仓库没有 TypeScript 后端；类型文件先作为无依赖共享包，后端建立后直接引用。

## 2. 通用约定

### 2.1 传输格式

- HTTP API 使用 JSON。
- 请求和响应编码为 UTF-8。
- 金额单位统一为人民币元，使用 JSON number，不带 `¥` 符号。
- 评分范围为 `0` 到 `100`，包含边界。
- 日期使用 `YYYY-MM-DD`；本契约不要求时间戳。
- 数组字段始终返回数组，不用 `null` 表示空数组。
- 只有明确允许的字段返回 `null`；无法合理估算回本周期时，`estimatedPaybackMonths` 返回 `null`。
- 当前版本不要求分页、鉴权和多租户字段；后续增加时不得改变本文件定义的业务字段含义。

### 2.2 统一错误

所有失败响应使用：

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "可理解的错误说明"
  }
}
```

推荐 HTTP 状态码：

| 状态码 | 使用场景 |
|---:|---|
| `400` | 参数缺失或格式错误 |
| `404` | 指定设备、区域或资源不存在 |
| `422` | 参数格式正确，但业务上无法计算 |
| `500` | 服务内部错误 |

错误 `code` 使用大写下划线格式，例如 `INVALID_QUERY`、`REGION_NOT_FOUND`、`INSUFFICIENT_DATA`、`INTERNAL_ERROR`。

## 3. 共享类型

以下定义与 `contracts/src/index.ts` 保持一致。字段名、枚举值和空值规则不得由单个分工自行改写。

### 3.1 AuditFinding

| 字段 | 类型 | 必填 | 规则 |
|---|---|---:|---|
| `id` | `string` | 是 | 异常发现的稳定标识 |
| `deviceId` | `string` | 是 | 设备标识 |
| `severity` | `'high' \| 'medium' \| 'low'` | 是 | 只允许三个枚举值 |
| `title` | `string` | 是 | 简短异常标题 |
| `evidence` | `string[]` | 是 | 证据描述；无证据时返回 `[]` |
| `recommendation` | `string` | 是 | 建议动作，不等同于已执行 |

### 3.2 AuditResult

```ts
interface AuditResult {
  summary: string
  findings: AuditFinding[]
}
```

`findings` 没有异常时返回空数组，不返回 `null`。

### 3.3 RegionResult

| 字段 | 类型 | 必填 | 规则 |
|---|---|---:|---|
| `regionId` | `string` | 是 | 区域标识 |
| `name` | `string` | 是 | 区域名称 |
| `score` | `number` | 是 | `0 <= score <= 100` |
| `estimatedMonthlyProfit` | `number` | 是 | 人民币元/月，可为负数 |
| `estimatedPaybackMonths` | `number \| null` | 是 | 月数；无法合理估算时为 `null` |
| `reasons` | `string[]` | 是 | 评分或收益的主要理由 |
| `assumptions` | `string[]` | 是 | 计算假设；无假设时返回 `[]` |

### 3.4 AgentRequest

```ts
interface AgentRequest {
  query: string
}
```

`query` 必填且必须是非空字符串。Demo 建议限制为不超过 2,000 个字符。

### 3.5 AgentResponse

| 字段 | 类型 | 必填 | 规则 |
|---|---|---:|---|
| `summary` | `string` | 是 | 基于工具结果的简要结论 |
| `findings` | `AuditFinding[]` | 是 | 没有异常时为 `[]` |
| `regionComparison` | `RegionResult[]` | 是 | 没有区域比较时为 `[]` |
| `recommendations` | `string[]` | 是 | 建议列表，没有建议时为 `[]` |
| `toolCalls` | `AgentToolCall[]` | 是 | 实际尝试的工具调用 |
| `assumptions` | `string[]` | 是 | 结论依赖的假设，没有假设时为 `[]` |

```ts
interface AgentToolCall {
  toolName: string
  status: 'success' | 'error'
}
```

Agent 不得在 `summary` 或 `recommendations` 中新增工具结果不存在的数值事实。

## 4. 后端函数契约

函数名必须保持以下拼写和参数形式。返回值使用共享类型。

```ts
getDashboardMetrics(filters?: DashboardFilters): Promise<DashboardMetrics>
auditOperations(filters?: AuditFilters): Promise<AuditResult>
compareRegions(regionIds?: string[]): Promise<RegionResult[]>
estimateRegionROI(regionId: string): Promise<RegionResult>
runAgent(query: string): Promise<AgentResponse>
```

### 4.1 filters

```ts
interface DashboardFilters {
  regionId?: string
  from?: string // YYYY-MM-DD
  to?: string   // YYYY-MM-DD
}

interface AuditFilters extends DashboardFilters {
  deviceId?: string
  severity?: 'high' | 'medium' | 'low'
}
```

所有 filter 字段可省略。省略时使用 Demo 默认区域和默认观察窗口。`from` 与 `to` 必须同时提供，且 `from <= to`。

### 4.2 DashboardMetrics

当前接口只冻结返回类型为 `Record<string, number>`，具体指标键由 B 在实现中登记并同步给 A/C；不得把金额格式化为字符串。

## 5. HTTP API

### 5.1 GET `/api/dashboard`

调用 `getDashboardMetrics(filters?)`。

请求示例：

```http
GET /api/dashboard?regionId=changchun&from=2026-10-12&to=2026-10-18
```

成功响应示例：

```json
{
  "salesAmount": 1054000,
  "estimatedProfit": 218000,
  "deviceCount": 42,
  "onlineRate": 0.952,
  "openFindingCount": 3
}
```

数值单位由指标名称决定：金额为人民币元，`onlineRate` 为 `0` 到 `1` 的比例，计数为非负整数。未知指标不返回 `null`，应省略或返回错误。

### 5.2 GET `/api/audit`

调用 `auditOperations(filters?)`。

请求示例：

```http
GET /api/audit?deviceId=device-A-001&severity=high
```

成功响应示例：

```json
{
  "summary": "发现 1 个高风险经营异常，建议优先核查退款记录。",
  "findings": [
    {
      "id": "finding-001",
      "deviceId": "device-A-001",
      "severity": "high",
      "title": "退款率高于同类设备",
      "evidence": ["近 7 天退款率 7.0%，同类中位数 2.1%。"],
      "recommendation": "抽查最近 20 笔退款订单并核对退款原因。"
    }
  ]
}
```

### 5.3 GET `/api/regions`

调用 `compareRegions(regionIds?)`，省略 `regionIds` 时比较默认候选区域。

请求示例：

```http
GET /api/regions?regionIds=chaoyang,nanguan
```

成功响应示例：

```json
[
  {
    "regionId": "chaoyang",
    "name": "朝阳区",
    "score": 86.5,
    "estimatedMonthlyProfit": 42800,
    "estimatedPaybackMonths": 8.4,
    "reasons": ["客流稳定", "竞品密度可控"],
    "assumptions": ["按近 30 天模拟客流估算", "设备投入按 360000 元计算"]
  },
  {
    "regionId": "nanguan",
    "name": "南关区",
    "score": 71.0,
    "estimatedMonthlyProfit": 26500,
    "estimatedPaybackMonths": null,
    "reasons": ["租金较高"],
    "assumptions": ["缺少完整租金数据，回本周期不做合理估算"]
  }
]
```

`score` 必须在 `0` 到 `100`；`estimatedMonthlyProfit` 为人民币元/月；无法合理估算回本周期时必须为 `null`，不能使用 `0`、空字符串或负数代替。

### 5.4 POST `/api/agent/run`

调用 `runAgent(query)`。

请求示例：

```http
POST /api/agent/run
Content-Type: application/json

{
  "query": "比较朝阳区和南关区的投放收益，并说明主要风险"
}
```

成功响应示例：

```json
{
  "summary": "朝阳区当前评分更高，预计月利润也更高；南关区的主要不确定性是租金数据不足。",
  "findings": [],
  "regionComparison": [
    {
      "regionId": "chaoyang",
      "name": "朝阳区",
      "score": 86.5,
      "estimatedMonthlyProfit": 42800,
      "estimatedPaybackMonths": 8.4,
      "reasons": ["客流稳定", "竞品密度可控"],
      "assumptions": ["按近 30 天模拟客流估算"]
    }
  ],
  "recommendations": ["优先对朝阳区进行现场核查，再决定投放。"],
  "toolCalls": [
    { "toolName": "compareRegions", "status": "success" },
    { "toolName": "estimateRegionROI", "status": "success" }
  ],
  "assumptions": ["当前结果使用 demo_v1 模拟数据。"]
}
```

失败响应示例：

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": {
    "code": "INVALID_QUERY",
    "message": "query 不能为空。"
  }
}
```

## 6. 分工交接

### A：React 前端

- 从 `contracts/src/index.ts` 引用 `AuditFinding`、`AuditResult`、`RegionResult`、`AgentRequest` 和 `AgentResponse`。
- 只调用四个 HTTP 路径，不在前端复制指标计算、评分或异常规则。
- 按约定处理空数组、`estimatedPaybackMonths: null` 和统一错误结构。
- Agent 页面用 `summary`、`findings`、`regionComparison`、`recommendations`、`toolCalls`、`assumptions` 渲染结果。

### B：经营数据、审计规则、区域评分、收益计算

- 实现 `getDashboardMetrics`、`auditOperations`、`compareRegions`、`estimateRegionROI`。
- 返回共享类型，金额使用人民币元，评分限定为 `0..100`。
- 无法合理估算回本周期时返回 `null`，不要用 `0` 代替。
- 审计结果必须返回固定的 severity 枚举和字符串证据；空结果返回空数组。
- 负责登记 Dashboard 指标键，并将键名和单位同步给 A/C。

### C：Agent、API、系统集成

- 实现 `runAgent(query)` 以及四个 HTTP 路由的适配。
- POST `/api/agent/run` 只接受 `{ "query": string }`。
- Agent 只能编排 B 的函数或等价白名单工具，不自行计算业务指标。
- API 失败统一返回 `{ error: { code, message } }`。
- 不修改共享字段、枚举和空值规则；需要变更时先更新本文件和共享类型，并通知 A/B。

## 7. 冻结后的修改规则

契约变更必须同时更新：

1. `contracts/src/index.ts`；
2. 本文档的字段表和示例；
3. 受影响分工的实现和验证；
4. 版本记录和团队确认。

未完成上述同步前，不得在单个分支中私自增加字段、改变枚举或更换 `null` 规则。
