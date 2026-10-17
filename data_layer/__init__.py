"""莱森购零售经营风险 Agent —— Python 数据层（任务 B）。

对外只暴露四个契约函数，与 docs/API_CONTRACT.md 冻结的接口一一对应：

    from data_layer import get_dashboard_metrics, audit_operations
    from data_layer import compare_regions, estimate_region_roi

分工边界（TECHNICAL_ARCHITECTURE.md §6）：
    本层负责全部确定性计算——聚合、比率、规则命中、评分、回本周期。
    LLM 只解析意图、编排工具、组织语言，绝不参与算数。
"""

from .config import ConfigError, DATA_VERSION, MIN_PEER_COUNT, describe
from .domain_services import (
    ContractError,
    DataContext,
    audit_operations,
    build_context,
    clear_context_cache,
    compare_regions,
    compute_payback_months,
    estimate_region_roi,
    get_context,
    get_dashboard_metrics,
    normalize_region_id,
    score_region,
)
from .metrics import (
    compute_store_metrics,
    median,
    safe_change_pct,
    safe_ratio,
    sum_field,
)
from .repository import RepositoryError, SupabaseRepository, get_repository
from .rule_engine import resolve_open_finding_count, run_audit, to_contract_finding
from .wiki import WikiIndex, load_wiki

__version__ = "0.1.0"

__all__ = [
    # 四个契约函数
    "get_dashboard_metrics",
    "audit_operations",
    "compare_regions",
    "estimate_region_roi",
    # 上下文与缓存
    "DataContext",
    "build_context",
    "get_context",
    "clear_context_cache",
    # 错误
    "ContractError",
    "RepositoryError",
    "ConfigError",
    # 底层
    "SupabaseRepository",
    "get_repository",
    "WikiIndex",
    "load_wiki",
    "compute_store_metrics",
    "safe_ratio",
    "safe_change_pct",
    "sum_field",
    "median",
    "run_audit",
    "to_contract_finding",
    "resolve_open_finding_count",
    "score_region",
    "compute_payback_months",
    "normalize_region_id",
    "describe",
    "DATA_VERSION",
    "MIN_PEER_COUNT",
    "__version__",
]
