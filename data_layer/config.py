"""环境与运行开关配置。

只从环境变量读取，不硬编码任何密钥。可配合仓库根目录的 .env 使用
（python-dotenv 会自动加载）。
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    # 依次尝试仓库根目录与本包上一级目录的 .env
    for candidate in (
        Path(__file__).resolve().parent.parent / ".env",
        Path(__file__).resolve().parent / ".env",
    ):
        if candidate.exists():
            load_dotenv(candidate, override=False)
except ImportError:  # python-dotenv 是可选依赖
    pass


class ConfigError(RuntimeError):
    """缺少必需的环境变量。"""


SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL", "").strip()

# 数据版本：与 AGENT_IDENTITY.dataVersion 和种子数据保持一致
DATA_VERSION = os.environ.get("DATA_VERSION", "demo_v1").strip() or "demo_v1"

# 观察窗口默认值（对齐 configs/metrics.yaml 的 windows 段）
DEFAULT_CURRENT_WINDOW_DAYS = 7
DEFAULT_BASELINE_WINDOW_DAYS = 7

# 少于该数量的可比门店 -> insufficient，不得输出确定性建议
MIN_PEER_COUNT = 3

# 数据不足时是否抛出 INSUFFICIENT_DATA（True）还是返回降级结果（False）
STRICT_INSUFFICIENT = os.environ.get("STRICT_INSUFFICIENT", "false").lower() == "true"

# openFindingCount 口径开关（见 docs/DEPLOYMENT.md §5）：
#   contract_snapshot —— 固定返回 3，与 PROJECT.md 第 10 节验收快照一致（默认）
#   rule_derived      —— 按 store_anomaly_v1 规则实算，A/B/E 三店命中，返回 3
#   rule_derived_all  —— 按规则实算且不排除任何门店（同样为 3）
OPEN_FINDINGS_MODE = os.environ.get("OPEN_FINDINGS_MODE", "contract_snapshot").strip()

# DataContext 进程级缓存时长（秒）。
# Agent 一轮里通常连调 2~4 个工具，缓存能省掉重复的全表读。
# 设为 0 可关闭缓存（改库后立即可见，调试时用）。
try:
    CONTEXT_TTL_SECONDS = float(os.environ.get("CONTEXT_TTL_SECONDS", "15"))
except ValueError:
    CONTEXT_TTL_SECONDS = 15.0


def get_supabase_credentials() -> tuple[str, str]:
    """返回 (url, key)。优先 service_role（写操作需要），其次 anon。"""
    if not SUPABASE_URL:
        raise ConfigError(
            "缺少 SUPABASE_URL。请在 .env 中配置，或参考 .env.example。"
        )
    key = SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY
    if not key:
        raise ConfigError(
            "缺少 SUPABASE_SERVICE_ROLE_KEY 或 SUPABASE_ANON_KEY。请在 .env 中配置。"
        )
    return SUPABASE_URL, key


def describe() -> dict:
    """脱敏后的配置摘要，供 verify 脚本打印。"""
    return {
        "supabase_url_configured": bool(SUPABASE_URL),
        "anon_key_configured": bool(SUPABASE_ANON_KEY),
        "service_role_key_configured": bool(SUPABASE_SERVICE_ROLE_KEY),
        "db_url_configured": bool(SUPABASE_DB_URL),
        "data_version": DATA_VERSION,
        "min_peer_count": MIN_PEER_COUNT,
        "open_findings_mode": OPEN_FINDINGS_MODE,
        "context_ttl_seconds": CONTEXT_TTL_SECONDS,
    }
