"""Supabase 访问层。

唯一的职责：把 4 张表读成 Python 结构，把写操作发回去。
不含任何业务判断——指标、规则、评分都在上层。

连接方式：supabase-py（PostgREST over HTTPS）。
  - 读：anon key 足够（表未开启 RLS 时两者等价）
  - 写 tasks_and_traces / trace_events：需要 service_role key，
    因为 RLS 默认会拦截匿名写。用 anon key 时写操作会静默失败。
"""

from __future__ import annotations

from typing import Any, Sequence

from . import config


class RepositoryError(RuntimeError):
    """数据库访问失败。上层据此决定是否降级。"""


class SupabaseRepository:
    """thin wrapper：惰性建连，失败时抛出 RepositoryError 供 Fallback 捕获。"""

    def __init__(self, url: str | None = None, key: str | None = None, client: Any = None):
        self._client = client
        self._url = url
        self._key = key

    # -- 连接 ---------------------------------------------------------------

    @property
    def client(self) -> Any:
        if self._client is None:
            if not self._url or not self._key:
                self._url, self._key = config.get_supabase_credentials()
            try:
                from supabase import create_client
            except ImportError as exc:  # pragma: no cover
                raise RepositoryError(
                    "未安装 supabase 依赖。执行：pip install -r requirements.txt"
                ) from exc
            try:
                self._client = create_client(self._url, self._key)
            except Exception as exc:  # pragma: no cover
                raise RepositoryError(f"无法连接 Supabase：{exc}") from exc
        return self._client

    def _select(self, table: str, columns: str = "*") -> Any:
        try:
            return self.client.table(table).select(columns)
        except Exception as exc:
            raise RepositoryError(f"查询 {table} 失败：{exc}") from exc

    def _rows(self, query: Any) -> list[dict]:
        try:
            result = query.execute()
        except Exception as exc:
            raise RepositoryError(f"执行查询失败：{exc}") from exc
        data = getattr(result, "data", None)
        if data is None:
            raise RepositoryError("Supabase 返回结果缺少 data 字段。")
        return list(data)

    # -- 读 -----------------------------------------------------------------

    def fetch_store_operations(self, data_version: str | None = None) -> list[dict]:
        """全部门店的全部周期行（Demo 数据量很小，一次取回）。"""
        version = data_version or config.DATA_VERSION
        rows = self._rows(
            self._select("store_operations_daily")
            .eq("data_version", version)
            .order("store_id")
            .order("period_type")
        )
        if not rows:
            raise RepositoryError(
                f"store_operations_daily 在 data_version={version} 下没有任何数据，"
                "请先执行 supabase/init.sql。"
            )
        return rows

    def fetch_region_inputs(self, data_version: str | None = None) -> list[dict]:
        version = data_version or config.DATA_VERSION
        rows = self._rows(
            self._select("region_market_inputs").eq("data_version", version).order("region_id")
        )
        if not rows:
            raise RepositoryError(
                f"region_market_inputs 在 data_version={version} 下没有任何数据，"
                "请先执行 supabase/init.sql。"
            )
        return rows

    def fetch_wiki(
        self,
        category: str | None = None,
        target_key: str | None = None,
        data_version: str | None = None,
    ) -> list[dict]:
        version = data_version or config.DATA_VERSION
        query = self._select("knowledge_wiki").eq("data_version", version)
        if category:
            query = query.eq("category", category)
        if target_key:
            query = query.eq("target_key", target_key)
        return self._rows(query.order("category").order("target_key"))

    # -- 写 -----------------------------------------------------------------

    def insert_task(self, payload: dict) -> dict:
        """创建任务。要求 service_role key，否则 RLS 会拦截。"""
        try:
            result = self.client.table("tasks_and_traces").insert(payload).execute()
        except Exception as exc:
            raise RepositoryError(f"创建任务失败：{exc}") from exc
        data = getattr(result, "data", None) or []
        return data[0] if data else payload

    def update_task_status(self, task_id: str, status: str) -> dict | None:
        """迁移任务状态。终态守卫在数据库触发器中，回退会抛异常。"""
        try:
            result = (
                self.client.table("tasks_and_traces")
                .update({"status": status})
                .eq("task_id", task_id)
                .execute()
            )
        except Exception as exc:
            raise RepositoryError(f"更新任务 {task_id} 状态失败：{exc}") from exc
        data = getattr(result, "data", None) or []
        return data[0] if data else None

    def fetch_task(self, task_id: str) -> dict | None:
        rows = self._rows(self._select("tasks_and_traces").eq("task_id", task_id).limit(1))
        return rows[0] if rows else None

    def insert_trace_event(
        self,
        trace_id: str,
        node_name: str,
        payload: dict,
        data_version: str | None = None,
    ) -> None:
        """写一条 trace 事件。失败只告警，不影响主流程（可观测性不应阻塞业务）。"""
        try:
            self.client.table("trace_events").insert(
                {
                    "trace_id": trace_id,
                    "node_name": node_name,
                    "payload": payload or {},
                    "data_version": data_version or config.DATA_VERSION,
                }
            ).execute()
        except Exception:  # pragma: no cover - 可观测性降级
            return

    def fetch_trace_events(self, trace_id: str) -> Sequence[dict]:
        return self._rows(
            self._select("trace_events").eq("trace_id", trace_id).order("id")
        )

    def healthcheck(self) -> dict:
        """部署自检：返回各表行数，异常则抛出 RepositoryError。"""
        counts = {}
        for table in (
            "store_operations_daily",
            "region_market_inputs",
            "knowledge_wiki",
            "tasks_and_traces",
            "trace_events",
        ):
            try:
                rows = self._rows(self._select(table, "count"))
                # PostgREST 的 count 需要 head 请求；退化为取 id 计数
                counts[table] = rows[0].get("count") if rows and isinstance(rows[0], dict) else len(rows)
            except RepositoryError:
                # count 列可能不可用，退回全量取行
                rows = self._rows(self._select(table))
                counts[table] = len(rows)
        return counts


_default_repo: SupabaseRepository | None = None


def get_repository(reset: bool = False) -> SupabaseRepository:
    """进程级单例。测试时可传 reset=True 重建。"""
    global _default_repo
    if _default_repo is None or reset:
        _default_repo = SupabaseRepository()
    return _default_repo
