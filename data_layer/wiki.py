"""结构化 Wiki 挂载层。

knowledge_wiki 一张表同时承载四类词条，用 (category, target_key) 定位：
  semantic_rule    target_key = 'store_anomaly_v1' | 'region_scoring_v1'
  sop_playbook     target_key = 规则 id，如 'refund_high' / 'order_drop_watch'
  region_profile   target_key = region_id，如 'chaoyang'
  historical_case  target_key = 案例 id（预留 pgvector 语义检索）

本层的价值：阈值和权重不存在代码里，改 Wiki 词条就能改规则，
且每条结论都能回指到 wiki_id 作为证据。
"""

from __future__ import annotations

import re
from typing import Any, Sequence

from .repository import RepositoryError, SupabaseRepository


class WikiIndex:
    """把 knowledge_wiki 全量词条建成内存索引，供同步查询。

    每行最后会带一个 __raw 字段，保留原始行用于回写和证据引用。
    """

    def __init__(self, rows: Sequence[dict]):
        self._by_key: dict[tuple[str, str], dict] = {}
        self._by_category: dict[str, list[dict]] = {}
        self.rows = list(rows)
        for row in self.rows:
            category = row.get("category")
            target = row.get("target_key")
            self._by_key[(category, target)] = row
            self._by_category.setdefault(category, []).append(row)

    # -- 构造 ---------------------------------------------------------------

    @classmethod
    def from_repository(cls, repo: SupabaseRepository, data_version: str | None = None) -> "WikiIndex":
        return cls(repo.fetch_wiki(data_version=data_version))

    @classmethod
    def from_rows(cls, rows: Sequence[dict]) -> "WikiIndex":
        return cls(rows)

    # -- 查询 ---------------------------------------------------------------

    def get(self, category: str, target_key: str) -> dict | None:
        return self._by_key.get((category, target_key))

    def payload(self, category: str, target_key: str) -> dict:
        row = self.get(category, target_key)
        if not row:
            return {}
        return row.get("structured_payload") or {}

    def wiki_id(self, category: str, target_key: str) -> str | None:
        row = self.get(category, target_key)
        return row.get("wiki_id") if row else None

    def by_category(self, category: str) -> list[dict]:
        return list(self._by_category.get(category, []))

    # -- 语义规则 -----------------------------------------------------------

    def anomaly_rules(self) -> dict:
        return self.payload("semantic_rule", "store_anomaly_v1").get("rules", {})

    def scoring_weights(self) -> dict:
        return self.payload("semantic_rule", "region_scoring_v1").get("weights", {})

    def min_peer_count(self) -> int:
        value = self.payload("semantic_rule", "store_anomaly_v1").get("min_peer_count")
        return int(value) if value is not None else 3

    def peer_median_refund_rate(self) -> float | None:
        value = self.payload("semantic_rule", "store_anomaly_v1").get("peer_median_refund_rate_pct")
        return float(value) if value is not None else None

    # -- SOP 词条 -----------------------------------------------------------

    def sop(self, rule_id: str) -> dict:
        return self.payload("sop_playbook", rule_id)

    def render_sop_text(self, rule_id: str, context: dict[str, Any]) -> dict[str, Any]:
        """把 SOP 的模板占位符渲染成最终文案。

        模板形如 "近 7 天退款率 {refund_rate}%，同类中位数 {peer_median_refund_rate}%。"
        缺失的键保留原样并在 unresolved 中列出，避免静默产出 "{}" 这种脏数据。
        """
        payload = self.sop(rule_id)
        if not payload:
            return {"evidence": None, "recommendation": None, "unresolved": ["__sop_missing__"]}

        unresolved: list[str] = []

        def fill(template: str | None) -> str | None:
            if template is None:
                return None

            def repl(match: re.Match) -> str:
                key = match.group(1)
                if key in context and context[key] is not None:
                    return str(context[key])
                unresolved.append(key)
                return match.group(0)

            return re.sub(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}", repl, template)

        return {
            "evidence": fill(payload.get("evidence_template")),
            "recommendation": fill(payload.get("recommendation")),
            "owner_role": payload.get("owner_role"),
            "due_hours": payload.get("due_hours"),
            "verify_metric": payload.get("verify_metric"),
            "verify_target": payload.get("verify_target"),
            "finding_id": payload.get("finding_id"),
            "wiki_id": self.wiki_id("sop_playbook", rule_id),
            "unresolved": unresolved,
        }

    # -- 商圈档案 -----------------------------------------------------------

    def region_profile(self, region_id: str) -> dict:
        payload = self.payload("region_profile", region_id)
        return {
            "reasons": list(payload.get("reasons", [])),
            "assumptions": list(payload.get("assumptions", [])),
            "wiki_id": self.wiki_id("region_profile", region_id),
        }


def load_wiki(repo: SupabaseRepository, data_version: str | None = None) -> WikiIndex:
    return WikiIndex.from_repository(repo, data_version=data_version)


__all__ = ["WikiIndex", "load_wiki", "RepositoryError"]
