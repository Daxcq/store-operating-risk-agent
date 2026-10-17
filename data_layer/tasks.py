"""任务状态机与落库（任务B 提供持久化，任务C 负责编排）。

状态机（PROJECT.md §5）：
    open -> assigned -> investigating -> verifying -> closed
                                        └-> escalated

两条硬约束：
  1. 只有 open 可以「创建时写入」，其余迁移必须显式经 transition_task。
  2. closed / escalated 是终态，不可回退。数据库侧有触发器兜底
     （enforce_task_status_transition），本模块在 Python 侧先挡一道，
     这样拿到的错误信息更清楚，也不用等一次网络往返。
"""

from __future__ import annotations

import random
import string
import time
from typing import Any, Sequence

from .repository import RepositoryError, SupabaseRepository


# 允许的迁移表。值是该状态可以直接去往的状态集合。
TRANSITIONS: dict[str, set[str]] = {
    "open": {"assigned", "investigating", "escalated"},
    "assigned": {"investigating", "escalated"},
    "investigating": {"verifying", "escalated"},
    "verifying": {"closed", "escalated"},
    "closed": set(),      # 终态
    "escalated": set(),   # 终态
}

TERMINAL_STATES = {"closed", "escalated"}

# 中文状态名，用于写回给用户的文案
STATUS_LABELS = {
    "open": "待处理",
    "assigned": "已派单",
    "investigating": "处理中",
    "verifying": "复核中",
    "closed": "已关闭",
    "escalated": "已升级",
}


class TaskStateError(RuntimeError):
    """非法状态迁移。对应 API_CONTRACT.md 的 INVALID_QUERY / 422。"""

    def __init__(self, message: str, code: str = "INVALID_QUERY"):
        super().__init__(message)
        self.code = code


def _new_task_id() -> str:
    """task_<毫秒时间戳>_<4 位随机>。

    加随机后缀是因为同一毫秒内可能连开两个任务（Agent 并行调工具），
    纯时间戳会撞主键。
    """
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=4))
    return f"task_{int(time.time() * 1000)}_{suffix}"


def can_transition(current: str, target: str) -> bool:
    return target in TRANSITIONS.get(current, set())


def assert_transition(current: str, target: str, task_id: str | None = None) -> None:
    """校验迁移合法性，不合法抛 TaskStateError。"""
    label = task_id or "任务"
    if current not in TRANSITIONS:
        raise TaskStateError(f"未知的当前状态：{current}")
    if target not in TRANSITIONS:
        raise TaskStateError(f"未知的目标状态：{target}")
    if current in TERMINAL_STATES:
        raise TaskStateError(
            f"TASK_TERMINAL_STATE: {label} 已处于终态（{STATUS_LABELS.get(current, current)}），"
            f"不允许迁移到 {STATUS_LABELS.get(target, target)}。"
        )
    if not can_transition(current, target):
        allowed = "、".join(sorted(TRANSITIONS[current])) or "无"
        raise TaskStateError(
            f"不允许从 {STATUS_LABELS.get(current, current)} 迁移到 "
            f"{STATUS_LABELS.get(target, target)}。可选：{allowed}。"
        )


def build_task_payload(
    finding: dict,
    action_card: dict | None = None,
    trace_id: str | None = None,
) -> dict:
    """由 finding 构造 tasks_and_traces 的插入行。

    finding 应当是 rule_engine 的「富」finding（带 _owner_role / _verify_metric 等
    下划线字段），这样 SOP 里定义的处置人、时限、验收指标能直接落库，
    不需要在 Node 侧重复一遍。
    action_card 用于人工覆盖（前端弹窗里用户可能改了处置人和时限）。
    """
    action_card = action_card or {}

    problem = (
        action_card.get("problem")
        or finding.get("title")
        or "经营异常"
    )
    action = (
        action_card.get("action")
        or finding.get("recommendation")
        or "核查该异常原因"
    )

    return {
        "task_id": action_card.get("taskId") or _new_task_id(),
        "trace_id": trace_id or action_card.get("traceId"),
        "source_finding_id": finding.get("id"),
        "device_id": finding.get("deviceId"),
        "problem": problem,
        "action": action,
        "owner_role": action_card.get("ownerRole") or finding.get("_owner_role") or "区域经理",
        "due_hours": _as_int(action_card.get("dueHours") or finding.get("_due_hours"), 24),
        "verify_metric": action_card.get("verifyMetric") or finding.get("_verify_metric") or "refund_rate",
        "verify_target": action_card.get("verifyTarget") or finding.get("_verify_target") or "回落至同类中位数水平",
        "status": action_card.get("status") or "open",
    }


def find_finding(findings: Sequence[dict], finding_id: str) -> dict | None:
    wanted = str(finding_id).strip()
    for finding in findings:
        if str(finding.get("id")) == wanted:
            return finding
    return None


def create_task(
    repo: SupabaseRepository,
    finding: dict,
    action_card: dict | None = None,
    trace_id: str | None = None,
) -> dict:
    """创建任务并落库。返回落库后的行（含 task_id）。"""
    payload = build_task_payload(finding, action_card, trace_id)

    if payload["status"] != "open":
        raise TaskStateError("新建任务的初始状态必须是 open。")

    try:
        row = repo.insert_task(payload)
    except RepositoryError as exc:
        # 典型的失败原因是用了 anon key —— RLS 会拦下写操作。
        raise RepositoryError(
            f"{exc}\n"
            "提示：写入 tasks_and_traces 需要 service_role key。"
            "请在 .env 里配置 SUPABASE_SERVICE_ROLE_KEY。"
        ) from exc

    return {
        **row,
        "statusLabel": STATUS_LABELS.get(row.get("status", "open"), row.get("status")),
    }


def transition_task(repo: SupabaseRepository, task_id: str, target: str) -> dict:
    """迁移任务状态。先查当前状态做本地校验，再落库。"""
    current_row = repo.fetch_task(task_id)
    if not current_row:
        raise TaskStateError(f"任务不存在：{task_id}", code="DEVICE_NOT_FOUND")

    current = current_row.get("status", "open")
    assert_transition(current, target, task_id)

    updated = repo.update_task_status(task_id, target)
    row = updated or {**current_row, "status": target}
    return {
        **row,
        "statusLabel": STATUS_LABELS.get(target, target),
        "previousStatus": current,
    }


def verify_task(
    repo: SupabaseRepository,
    task_id: str,
    target_met: bool | None = None,
    evidence: str | None = None,
) -> dict:
    """复核并关闭/升级任务。

    target_met 为 None 时，读库里任务当前的 verify_metric 与 verify_target
    无法自动判定，因此要求调用方显式给出结论——这是有意为之：
    复核本身是人工判断，不应该由代码猜测。

    target_met=True  -> verifying -> closed
    target_met=False -> escalated
    """
    if target_met is None:
        raise TaskStateError(
            "verifyTask 需要显式给出 targetMet（true/false）。"
            "复核结论属于人工判断，系统不代为猜测。"
        )

    current_row = repo.fetch_task(task_id)
    if not current_row:
        raise TaskStateError(f"任务不存在：{task_id}", code="DEVICE_NOT_FOUND")

    current = current_row.get("status", "open")
    target = "closed" if target_met else "escalated"

    # 任务可能停在 open / assigned / investigating 任一状态就被复核，
    # 这里按状态机逐步推进到 verifying，再落到终态，避免跳过中间状态。
    chain = _path_to_verifying(current)
    for step in chain:
        assert_transition(current, step, task_id)
        repo.update_task_status(task_id, step)
        current = step

    assert_transition(current, target, task_id)
    updated = repo.update_task_status(task_id, target)
    row = updated or {**current_row, "status": target}

    return {
        **row,
        "statusLabel": STATUS_LABELS.get(target, target),
        "targetMet": target_met,
        "verifyMetric": current_row.get("verify_metric"),
        "verifyTarget": current_row.get("verify_target"),
        "evidence": evidence,
        "expectedAction": "保存复核证据并关闭任务" if target_met else "保留原证据并升级任务",
    }


def _path_to_verifying(current: str) -> list[str]:
    """从当前状态走到 verifying 的最短路径。已在 verifying 则返回空。"""
    if current == "verifying":
        return []
    if current == "open":
        return ["assigned", "investigating", "verifying"]
    if current == "assigned":
        return ["investigating", "verifying"]
    if current == "investigating":
        return ["verifying"]
    if current in TERMINAL_STATES:
        raise TaskStateError(
            f"TASK_TERMINAL_STATE: 任务已处于终态（{STATUS_LABELS.get(current, current)}），"
            "无法复核。"
        )
    raise TaskStateError(f"未知的当前状态：{current}")


def _as_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


__all__ = [
    "TRANSITIONS",
    "TERMINAL_STATES",
    "STATUS_LABELS",
    "TaskStateError",
    "can_transition",
    "assert_transition",
    "build_task_payload",
    "create_task",
    "transition_task",
    "verify_task",
    "find_finding",
]
