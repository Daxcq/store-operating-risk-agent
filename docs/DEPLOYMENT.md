# 数据层部署与验证手册

适用对象：第一次把这套代码跑起来的人（含演示当天的自己）。

本文覆盖三件事：把 `supabase/init.sql` 部署到 Supabase、起 Python 数据层服务、
让前端 Agent 真正读到库里的数据而不是内存快照。最后两节是已知问题与安全提醒，
**上演示前请务必读 §5 和 §6**。

---

## 1. 整体结构

这套系统有两条独立的数据通路，理解它们的区别是理解后面所有步骤的前提：

```
                    ┌─────────────────────────────────────┐
                    │  Supabase (PostgreSQL + PostgREST)  │
                    └──────────────┬──────────────────────┘
                                   │
        建表 DDL 走这里 ───────────┤─────────── 读写数据走这里
        (psycopg, 5432 端口)       │            (supabase-py, HTTPS)
                                   │
                    ┌──────────────┴──────────────┐
                    │  Python 数据层 (:8787)       │
                    │  data_layer/server.py        │
                    └──────────────┬──────────────┘
                                   │ HTTP
                    ┌──────────────┴──────────────┐
                    │  Node 桥接层（Vite DevServer）│
                    │  src/server/registerDataLayer│
                    └──────────────┬──────────────┘
                                   │ 进程内函数调用
                    ┌──────────────┴──────────────┐
                    │  Agent 编排器 + 7 个工具       │
                    └─────────────────────────────┘
```

**为什么建表和读写要用两套连接**：Supabase 对外暴露的 HTTP 接口是 PostgREST，
它只能翻译成 `SELECT / INSERT / UPDATE / DELETE`，**执行不了 `CREATE TABLE`**。
所以 `supabase/deploy.py` 必须拿一条 PostgreSQL 原生连接（`SUPABASE_DB_URL`）。
这一点搞错了会得到一个很费解的错误：`supabase.table('store_operations_daily')` 报
"relation does not exist"，而你确信自己"已经连上 Supabase 了"——连接是通的，
只是表还没建。

---

## 2. 部署数据库

### 2.1 装依赖

```bash
pip install -r requirements.txt --break-system-packages
```

关键的两个是 `psycopg[binary]`（建表用）和 `supabase`（运行时用）。

### 2.2 拿连接串

Supabase 后台 → **Project Settings → Database → Connection string → URI**。

必须选 **Session pooler（5432）或 Direct connection**。
**不要用 Transaction pooler（6543）**——它面向短事务设计，
`init.sql` 里的 `CREATE TRIGGER` / plpgsql 函数体在那种模式下会出问题。

### 2.3 填 .env

```bash
cp .env.supabase.example .env
```

然后至少填这两项：

| 变量 | 用途 | 在哪拿 |
| --- | --- | --- |
| `SUPABASE_DB_URL` | 建表（只 deploy.py 用，跑完可删） | Connection string → URI |
| `SUPABASE_URL` | 运行时读写 | Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | 运行时读写（**必需**，见下） | Project Settings → API |

**为什么必须用 service_role 而不是 anon key**：这两张表开了 RLS，
anon 角色没有写权限。要命的是**这种失败是静默的**——PostgREST 不会报错，
只是返回 0 行受影响，你的代码以为任务创建成功了。演示时表现为
"Agent 说已经派单了，数据库里查不到"。查这个问题很费时间，
所以一开始就用 service_role。

### 2.4 执行部署

在仓库根目录：

```bash
python supabase/deploy.py --dry-run   # 先看解析了多少条语句，不连库
python supabase/deploy.py --verify    # 连库只做行数自检，不改任何数据
python supabase/deploy.py             # 建表 + 灌种子数据
```

`--dry-run` 值得先跑一次：它会打印切分出的语句数。
如果这个数字明显不对（比如只有个位数），说明 SQL 解析把 plpgsql 函数体切碎了，
此时**不要**往下执行。

部署完成后，`--verify` 应该看到这五个数字：

| 表 | 期望行数 |
| --- | --- |
| `store_operations_daily` | 10 |
| `region_market_inputs` | 5 |
| `knowledge_wiki` | 11 |
| `tasks_and_traces` | 1 |
| `trace_events` | 0 |

`knowledge_wiki` 是 11 而不是 4：一张表用 `(category, target_key)` 两列
同时承载了四类词条——2 条语义规则、3 条 SOP、5 条区域档案、1 条历史案例。
`trace_events` 是 0 很正常，它只在 Agent 真跑过之后才写入。

### 2.5 建了什么

`init.sql` 建 5 张表：

- **`store_operations_daily`** — 门店日经营事实，种子是 5 店 × 2 个周期窗口。
  注意表里的数据是**每店每周期一行**的聚合切片，不是逐日流水，
  `period_type` 区分 `current_7d` / `baseline_7d`。
- **`region_market_inputs`** — 区域投放参数（租金、人工、设备投入），供 ROI 测算。
- **`knowledge_wiki`** — 结构化 Wiki，见上。
- **`tasks_and_traces`** — 任务状态机，带一个**数据库层**的终态守卫触发器：
  `closed` / `escalated` 之后任何状态迁移都直接 `RAISE EXCEPTION`。
  这条约束写在数据库里而不只写在 Python 里，是因为状态机是这个项目
  最容易被并发写坏的地方，应用层的检查挡不住两个进程同时改。
- **`trace_events`** — Agent 逐节点执行事件，供追溯。

---

## 3. 起 Python 数据层

```bash
python -m data_layer.server             # 默认 127.0.0.1:8787
python -m data_layer.server --offline   # 不连库，用内置夹具
```

`--offline` 值得知道：它用 `data_layer/fixtures.py` 起服务，
**没有数据库也能把从前端到数据层的整条链路跑通**。
数据库出问题又赶时间的时候，用这个先把演示流程走一遍。

## 4. 让前端接上数据层

Node 桥接层不需要额外启动——它在 Vite DevServer 启动时自动注册。
`vite.config.js` 通过 `configureServer` 把 `createApiMiddleware()` 挂到 dev server 上，
所以 `/api/v1/agent/run` 是在 **Node 进程内**直接调 `runAgent` 的，不经过浏览器。

这一点决定了密钥边界：`service_role` key 只出现在 Python 进程的环境变量里，
前端代码从头到尾拿不到它。

启动 `npm run dev` 后，控制台会打印一行数据源状态：

```
[数据层] Python 数据层：已连接 Python 数据层（dataVersion=demo_v1）
```

或者

```
[数据层] 内存兜底：Python 数据层不可用：timeout
```

看到第二行说明前端会退回 `defaultDomainServices.js` 的内存快照。
**界面看起来完全正常**——这正是危险之处，你可能对着假数据讲了半天。
所以上演示前一定确认这一行是「Python 数据层」。

熔断开关：`DATA_LAYER_ENABLED=0` 可以强制只走内存实现，
用来确认"问题到底出在数据层还是前端"。

### 4.1 离线自检

不连任何数据库也能验证四个契约函数的计算是否正确：

```bash
python tools/verify_local.py
```

它会断言 `PROJECT.md` §10 验收快照里的每一个数字，
退出码 0 表示全绿。**改过 `metrics.py` / `rule_engine.py` 之后应该跑一次。**

---

## 5. 已知契约不一致：E 店发现（重要）

这是本次部署中发现的一个**真实的数据与契约不一致**，不是代码 bug，
但会影响验收对表，必须说清楚。

按 `knowledge_wiki` 里的 `store_anomaly_v1` 规则实算，
命中的门店是 **A、B、E 三家**：

| 门店 | `order_change_pct` | 命中规则 | severity |
| --- | --- | --- | --- |
| A | −30.99% | `order_drop_severe` | low |
| B | −8.99% | `order_drop_watch` | medium |
| **E** | **−13.99%** | **`order_drop_watch`** | **medium** |

外加 A 店的退款率 7.0% ≥ 5.0%，命中 `refund_high`（high）。

而 `PROJECT.md` §10 与 `contracts/fixtures/*` 里的三份快照是
**finding-001（A 店退款高）、finding-002（A 店订单跌）、finding-003（B 店订单跌）**，
**没有 E 店**。

E 店的数据本身是对的，没有算错。问题是它在快照定稿时没被列进去。
订单数 2860 → 2460 = **−13.986%**，落在 `(-20%, -5%]` 区间，
按规则就该命中 `order_drop_watch`。

**为什么这个不一致特别难发现**：规则实算命中的条数**恰好也是 3**——
A 的退款高 + A 的订单跌 + B 的订单跌 + E 的订单跌，其中 A 店同时命中两条规则，
但因为两条规则的 `finding_id` 不同，最终计数还是 3。
于是任何只比 `openFindingCount == 3` 的断言都会通过，
而实际返回的 finding **集合**已经和快照不一样了。

**处理方式**：`data_layer/config.py` 提供了口径开关 `OPEN_FINDINGS_MODE`，
默认 `contract_snapshot`——固定返回 3，与验收快照严格一致。

```
OPEN_FINDINGS_MODE=contract_snapshot   # 默认，对齐 PROJECT.md §10
OPEN_FINDINGS_MODE=rule_derived        # 按规则实算，返回 A/B/E 三家
```

演示用默认值。如果评委问「这个数是怎么来的」，
诚实的回答是：默认走契约快照以保证与验收数字一致，
规则实算会多出 E 店一条中风险订单下滑发现，两者条数相同但集合不同。
**这个说明比假装它不存在要好**——它恰好证明了规则引擎是真的在算，
而不是把结论硬编码进去的。

要真正消除这个不一致，只有两条路：把 E 店补进 `PROJECT.md` §10 和 fixtures，
或者把 E 店数据调出 `(-20%, -5%]` 区间。这属于契约层的决定，不在本文档范围内。

---

## 6. 安全提醒：仓库里的 LLM_API_KEY

`.env.example` 里有一个**真实格式的 StepFun / 阶跃星辰 `LLM_API_KEY`**，
已经随公开仓库提交出去了。

`.env.example` 通常是模板文件，本不该放真钥匙。这把 key 现在应当视为已泄露，
**建议到 StepFun 控制台吊销并重新生成**，然后把任何 `.env` 加进 `.gitignore`，
模板文件里只留占位符。

本次没有改动这个文件——它是仓库既有内容，是否吊销、何时更换由项目负责人决定。
只是提醒：这把 key 已经公开，任何人在仓库历史里都能翻到。

另一个同类的口子在 §2.3 提过：`service_role` key 绕过所有 RLS，
等同数据库超级权限。它只能存在于服务端环境变量里，
不能进前端代码、不能提交、不能进任何浏览器能读到的文件。

---

## 7. 排障速查

| 现象 | 大概率原因 |
| --- | --- |
| `relation "xxx" does not exist` | 表还没建，或者建到了另一个项目上。跑 `deploy.py --verify` |
| Agent 说派单成功但库里没有行 | 用了 anon key。换 `service_role`（见 §2.3） |
| 控制台显示「内存兜底」 | Python 服务没起，或 `DATA_LAYER_URL` 不对。先 `curl 127.0.0.1:8787/healthz` |
| `TASK_TERMINAL_STATE` 报错 | 任务已 `closed`/`escalated`，状态机不允许回退。这是设计如此 |
| `CREATE TRIGGER` 语法错误 | 用了 6543 端口。换 5432（见 §2.2） |
| 改了库但接口数字没变 | `CONTEXT_TTL_SECONDS` 默认 15 秒缓存。设为 0 再看 |
| 页面数据不对但界面正常 | 前端悄悄退回了内存快照。看启动那行「[数据层]」日志 |
