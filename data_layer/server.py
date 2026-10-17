#!/usr/bin/env python3
"""数据层 HTTP 服务（任务B 对外接口）。

只依赖标准库 http.server，不引入 FastAPI/Flask——数据层是内部服务，
跑在本机 loopback 上，少一个依赖就少一次装包失败的机会。

暴露 4 个端点，与 docs/API_CONTRACT.md 完全对齐：

    GET  /api/v1/dashboard?regionId=&storeId=&deviceId=&from=&to=
    GET  /api/v1/audit?regionId=&storeId=&deviceId=&severity=
    GET  /api/v1/regions?regionIds=chaoyang,nanguan
    POST /api/v1/agent/run          {"query": "..."}
    GET  /healthz                    部署自检，含各表行数

Node 桥接层（任务C）用 HTTPS_PROXY 之前先看这里：base URL 默认
http://127.0.0.1:8787。启动：

    python -m data_layer.server               # 默认 8787
    python -m data_layer.server --port 9000   # 换端口
    python -m data_layer.server --offline     # 不连 Supabase，用 fixtures 起服务

--offline 模式对前端联调很有用：没有数据库也能把整条链路跑通。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data_layer import (  # noqa: E402
    ContractError,
    RepositoryError,
    audit_operations,
    build_context,
    compare_regions,
    estimate_region_roi,
    get_context,
    get_dashboard_metrics,
    get_repository,
)
from data_layer.tasks import (  # noqa: E402
    TaskStateError,
    create_task,
    find_finding,
    transition_task,
    verify_task,
)

# POST /api/v1/agent/run 只做确定性部分。
# 真正的 LLM 编排在 Node 侧（任务C 的 LangGraph），这里只回答
# 「这条 query 该调哪些工具、结果是什么」，把算数全部留在 Python。
INTENT_KEYWORDS = [
    (("对比", "比较", "哪个区", "哪个区域", "排名", "排行"), "compare_regions"),
    (("回本", "投入", "roi", "ROI", "测算", "值得投"), "estimate_region_roi"),
    (("审计", "异常", "风险", "退款", "问题", "核查"), "audit_operations"),
    (("看板", "总览", "大盘", "整体", "概况", "怎么样"), "get_dashboard_metrics"),
]


def _parse_query(query: str) -> dict:
    text = (query or "").strip()
    if not text:
        raise ContractError("INVALID_QUERY", "query 不能为空。")
    if len(text) > 2000:
        raise ContractError(
            "INVALID_QUERY", f"query 过长（{len(text)} 字符），上限 2000。"
        )

    planned = [
        tool for keywords, tool in INTENT_KEYWORDS if any(k in text for k in keywords)
    ]
    if not planned:
        planned = ["get_dashboard_metrics"]

    # 从 query 里捞区域名
    from data_layer.domain_services import REGION_ALIASES, is_city_alias

    regions: list[str] = []
    lowered = text.lower()
    for alias, region_id in REGION_ALIASES.items():
        if alias in lowered and region_id not in regions:
            regions.append(region_id)

    return {"intent": planned[0], "plannedTools": planned, "regions": regions}


class Handler(BaseHTTPRequestHandler):
    server_version = "LaisenDataLayer/0.1"

    # 由 create_server 注入
    ctx_factory = None  # type: ignore
    repo_factory = None  # type: ignore

    # -- 工具 ---------------------------------------------------------------

    def _send(self, status: int, body: dict) -> None:
        payload = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        # 前端跑在 Vite 上（通常 5173），需要放行跨域
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(payload)

    def _error(self, exc: Exception) -> None:
        if isinstance(exc, ContractError):
            self._send(exc.status, exc.to_envelope())
            return
        if isinstance(exc, TaskStateError):
            # 状态机违规：422 而不是 400。请求本身合法，是任务当前状态不允许。
            status = 404 if exc.code == "DEVICE_NOT_FOUND" else 422
            self._send(status, {"error": {"code": exc.code, "message": str(exc)}})
            return
        if isinstance(exc, RepositoryError):
            self._send(
                500,
                {"error": {"code": "INTERNAL_ERROR", "message": f"数据库访问失败：{exc}"}},
            )
            return
        self._send(
            500, {"error": {"code": "INTERNAL_ERROR", "message": f"未预期错误：{exc}"}}
        )

    def _ctx(self):
        return self.ctx_factory()

    def _repo(self):
        return self.repo_factory()

    def _params(self) -> dict:
        parsed = urlparse(self.path)
        raw = parse_qs(parsed.query)
        flat = {k: v[0] for k, v in raw.items() if v}
        params: dict = {}
        mapping = {
            "regionId": "regionId",
            "region_id": "regionId",
            "storeId": "storeId",
            "store_id": "storeId",
            "deviceId": "deviceId",
            "device_id": "deviceId",
            "severity": "severity",
            "from": "from",
            "to": "to",
        }
        for key, target in mapping.items():
            if key in flat:
                params[target] = flat[key]
        return params, parsed.path

    def log_message(self, fmt, *args):  # noqa: A003
        # 默认日志会打到 stderr，Node 侧已经有一份 trace，这里保持安静
        if os.environ.get("DATA_LAYER_VERBOSE") == "1":
            super().log_message(fmt, *args)

    # -- 路由 ---------------------------------------------------------------

    def do_OPTIONS(self):  # noqa: N802
        self._send(204, {})

    def do_GET(self):  # noqa: N802
        try:
            params, path = self._params()
            if path == "/healthz":
                self._send(200, self._health())
            elif path == "/api/v1/dashboard":
                self._send(200, get_dashboard_metrics(params, ctx=self._ctx()))
            elif path == "/api/v1/audit":
                self._send(200, audit_operations(params, ctx=self._ctx()))
            elif path == "/api/v1/regions":
                raw = params.get("regionIds") or params.get("regionId")
                region_ids = [r for r in raw.split(",") if r.strip()] if raw else None
                self._send(200, compare_regions(region_ids, ctx=self._ctx()))
            elif path == "/api/v1/roi":
                # 单区域 ROI 测算。与 compareRegions 的区别：
                # 多了 roiNote / status，且缺少成本数据时 status='insufficient'。
                region_id = params.get("regionId")
                if not region_id:
                    raise ContractError("INVALID_QUERY", "缺少 regionId 参数。")
                self._send(200, estimate_region_roi(region_id, ctx=self._ctx()))
            else:
                self._send(
                    404,
                    {"error": {"code": "INTERNAL_ERROR", "message": f"未知路径：{path}"}},
                )
        except Exception as exc:  # noqa: BLE001
            self._error(exc)

    def do_POST(self):  # noqa: N802
        try:
            _, path = self._params()
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length else "{}"
            try:
                body = json.loads(raw or "{}")
            except json.JSONDecodeError as exc:
                raise ContractError("INVALID_QUERY", f"请求体不是合法 JSON：{exc}") from exc

            if path == "/api/v1/agent/run":
                self._send(200, self._agent_run(body))
            elif path == "/api/v1/tasks":
                self._send(201, self._create_task(body))
            elif path == "/api/v1/traces":
                self._send(202, self._write_trace(body))
            elif path.startswith("/api/v1/tasks/"):
                self._send(200, self._task_action(path, body))
            else:
                self._send(
                    404,
                    {"error": {"code": "INTERNAL_ERROR", "message": f"未知路径：{path}"}},
                )
        except Exception as exc:  # noqa: BLE001
            self._error(exc)

    # -- 任务与 trace（任务C 的落库出口） ------------------------------------

    def _create_task(self, body: dict) -> dict:
        """POST /api/v1/tasks

        body: {"findingId": "finding-001", "actionCard": {...}, "traceId": "..."}
        也可以直接传 finding 对象（Node 侧已经从 audit 拿到整条），
        省一次重新审计。两者都给时以 findingId 为准，保证取到的是「富」finding。
        """
        finding_id = body.get("findingId") or (body.get("finding") or {}).get("id")
        finding = None

        if finding_id:
            ctx = self._ctx()
            enriched = audit_operations(None, ctx=ctx).get("_enrichedFindings", [])
            finding = find_finding(enriched, finding_id)

        if finding is None and isinstance(body.get("finding"), dict):
            finding = body["finding"]

        if finding is None:
            raise ContractError(
                "INVALID_QUERY",
                f"找不到 finding：{finding_id or '（未提供）'}。"
                "请先调用 /api/v1/audit 取得当前发现列表。",
            )

        task = create_task(
            self._repo(),
            finding,
            action_card=body.get("actionCard"),
            trace_id=body.get("traceId"),
        )
        return {"task": task, "created": True, "dataVersion": self._ctx().data_version}

    def _task_action(self, path: str, body: dict) -> dict:
        """POST /api/v1/tasks/<taskId>/status  → 任意合法状态迁移
           POST /api/v1/tasks/<taskId>/verify  → 复核并关闭/升级
        """
        parts = [segment for segment in path.split("/") if segment]
        # ["api", "v1", "tasks", "<id>", "<action>"]
        if len(parts) != 5 or parts[4] not in ("status", "verify"):
            raise ContractError("INVALID_QUERY", f"未知的任务路径：{path}")

        task_id, action = parts[3], parts[4]
        repo = self._repo()

        if action == "verify":
            task = verify_task(
                repo,
                task_id,
                target_met=body.get("targetMet"),
                evidence=body.get("evidence"),
            )
        else:
            target = body.get("status")
            if not target:
                raise ContractError("INVALID_QUERY", "缺少 status 参数。")
            task = transition_task(repo, task_id, target)

        return {"task": task, "dataVersion": self._ctx().data_version}

    def _write_trace(self, body: dict) -> dict:
        """POST /api/v1/traces —— 把 Node 侧 traceLogger 的节点事件持久化。

        写失败不抛错：可观测性不该阻塞业务（与 repository.insert_trace_event
        的策略一致）。离线夹具没有 trace 表，静默跳过。
        """
        trace_id = body.get("traceId")
        node_name = body.get("nodeName")
        if not trace_id or not node_name:
            raise ContractError("INVALID_QUERY", "traceId 与 nodeName 均为必填。")

        repo = self._repo()
        insert = getattr(repo, "insert_trace_event", None)
        if insert is not None:
            insert(trace_id, node_name, body.get("payload") or {})
        return {"traceId": trace_id, "recorded": insert is not None}

    # -- 业务 ---------------------------------------------------------------

    def _health(self) -> dict:
        ctx = self._ctx()
        return {
            "status": "ok",
            "mode": "offline" if os.environ.get("DATA_LAYER_OFFLINE") == "1" else "supabase",
            "dataVersion": ctx.data_version,
            "counts": {
                "stores": len(ctx.store_metrics),
                "regions": len(ctx.region_inputs),
                "wikiEntries": len(ctx.wiki.rows),
            },
        }

    def _agent_run(self, body: dict) -> dict:
        """确定性工具编排。

        真正的 LLM 在 Node 侧。这里返回 AgentResponse 的骨架 +
        toolCalls 审计数组，Node 拿到后只需负责组织自然语言。
        """
        query = body.get("query")
        parsed = _parse_query(query or "")
        ctx = self._ctx()
        regions = parsed["regions"]

        tool_calls: list[dict] = []
        dashboard = None
        findings: list[dict] = []
        region_comparison = None
        assumptions: list[str] = []

        for tool in parsed["plannedTools"]:
            try:
                if tool == "get_dashboard_metrics":
                    dashboard = get_dashboard_metrics(
                        {"regionId": regions[0]} if len(regions) == 1 else None, ctx=ctx
                    )
                elif tool == "audit_operations":
                    audit = audit_operations(
                        {"regionId": regions[0]} if len(regions) == 1 else None, ctx=ctx
                    )
                    findings = audit["findings"]
                    assumptions.extend(audit.get("notes", []))
                elif tool == "compare_regions":
                    region_comparison = compare_regions(regions or None, ctx=ctx)
                    assumptions.extend(region_comparison.get("assumptions", []))
                elif tool == "estimate_region_roi":
                    if len(regions) == 1:
                        roi = estimate_region_roi(regions[0], ctx=ctx)
                        region_comparison = {"regions": [roi], "count": 1}
                        assumptions.append(roi["roiNote"])
                tool_calls.append({"toolName": tool, "status": "ok"})
            except ContractError as exc:
                # 单个工具失败不应让整轮失败，如实记录后继续
                tool_calls.append(
                    {"toolName": tool, "status": "error", "error": exc.code}
                )
                assumptions.append(f"{tool} 未完成：{exc.message}")

        return {
            "query": query,
            "intent": parsed["intent"],
            "toolCalls": tool_calls,
            "dashboardMetrics": dashboard,
            "findings": findings,
            "regionComparison": region_comparison,
            "recommendations": _recommendations(findings),
            "assumptions": assumptions,
            "summary": _summary(parsed, dashboard, findings, region_comparison),
            "dataVersion": ctx.data_version,
        }


def _summary(parsed: dict, dashboard, findings, region_comparison) -> str:
    parts: list[str] = []
    if dashboard:
        sales = dashboard.get("salesAmount")
        rate = dashboard.get("onlineRate")
        sales_text = f"{sales:,.0f} 元" if isinstance(sales, (int, float)) else "暂无"
        rate_text = f"{rate * 100:.1f}%" if isinstance(rate, (int, float)) else "暂无"
        parts.append(
            f"当前窗口销售额 {sales_text}，设备在线率 {rate_text}，"
            f"未结风险发现 {dashboard.get('openFindingCount', 0)} 项。"
        )
    if findings:
        high = [f for f in findings if f["severity"] == "high"]
        parts.append(f"共 {len(findings)} 项经营发现，其中高风险 {len(high)} 项。")
    if region_comparison and region_comparison.get("regions"):
        top = region_comparison["regions"][0]
        if top.get("score") is not None:
            parts.append(f"区域评分最高的是{top['name']}（{top['score']} 分）。")
    return "".join(parts) or "未识别到可执行的经营分析意图，请补充区域或指标关键词。"


def _recommendations(findings) -> list[str]:
    seen: list[str] = []
    for finding in findings:
        text = finding.get("recommendation")
        if text and text not in seen:
            seen.append(text)
    return seen


def create_server(host: str, port: int, offline: bool = False) -> ThreadingHTTPServer:
    if offline:
        os.environ["DATA_LAYER_OFFLINE"] = "1"
        from data_layer.fixtures import FakeRepository

        repo = FakeRepository()
        handler = type(
            "OfflineHandler",
            (Handler,),
            {
                "ctx_factory": staticmethod(lambda: build_context(repo=repo)),
                # 离线也要能建任务：前端联调时任务流的交互不能是死的。
                # FakeRepository 在内存里维护任务，进程退出即丢，符合预期。
                "repo_factory": staticmethod(lambda: repo),
            },
        )
    else:
        handler = type(
            "LiveHandler",
            (Handler,),
            {
                "ctx_factory": staticmethod(lambda: get_context()),
                "repo_factory": staticmethod(lambda: get_repository()),
            },
        )

    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True
    return server


def main() -> int:
    parser = argparse.ArgumentParser(description="数据层 HTTP 服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("DATA_LAYER_PORT", "8787")))
    parser.add_argument("--offline", action="store_true", help="不连 Supabase，用内置夹具")
    args = parser.parse_args()

    server = create_server(args.host, args.port, offline=args.offline)
    mode = "离线夹具" if args.offline else "Supabase"
    print(f"数据层已启动：http://{args.host}:{args.port}  （数据源：{mode}）")
    print("  GET  /api/v1/dashboard")
    print("  GET  /api/v1/audit")
    print("  GET  /api/v1/regions")
    print("  GET  /api/v1/roi")
    print("  POST /api/v1/agent/run")
    print("  POST /api/v1/tasks                      建任务（落库）")
    print("  POST /api/v1/tasks/{id}/status          迁移状态")
    print("  POST /api/v1/tasks/{id}/verify          复核关闭/升级")
    print("  POST /api/v1/traces                     写 trace 事件")
    print("  GET  /healthz")
    print("按 Ctrl+C 停止。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
