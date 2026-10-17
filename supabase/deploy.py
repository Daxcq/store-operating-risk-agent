#!/usr/bin/env python3
"""把 supabase/init.sql 部署到 Supabase（或任意 PostgreSQL）。

为什么需要直连：
    init.sql 里全是 DDL（CREATE TABLE / CREATE EXTENSION / CREATE TRIGGER），
    而 PostgREST（也就是 supabase-py 走的 HTTP 接口）只能操作数据、不能建表。
    所以建库这一步必须用 PostgreSQL 原生连接，即 SUPABASE_DB_URL。

用法：
    # 1. 配置 .env（至少要有 SUPABASE_DB_URL）
    # 2. 执行
    python supabase/deploy.py                # 建表 + 灌种子数据
    python supabase/deploy.py --verify       # 只做自检，不改任何数据
    python supabase/deploy.py --dry-run      # 只打印将要执行的 SQL 长度与语句数

安全说明：
    Supabase 的数据库密码会出现在连接串里。Supabase 后台
    Project Settings -> Database -> Connection string -> URI 可以取到。
    建议用 Session pooler（端口 5432）或 Direct connection；
    Transaction pooler（6543）不支持 DDL 里的某些语句，不要用。
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SQL_PATH = Path(__file__).resolve().parent / "init.sql"

# 期望的建库后行数，用于 --verify 自检
EXPECTED_COUNTS = {
    "store_operations_daily": 10,
    "region_market_inputs": 5,
    "knowledge_wiki": 11,
    "tasks_and_traces": 1,
    "trace_events": 0,
}


def load_env() -> None:
    """从仓库根目录的 .env 读配置。没有 python-dotenv 就靠系统环境变量。"""
    env_path = ROOT / ".env"
    try:
        from dotenv import load_dotenv

        if env_path.exists():
            load_dotenv(env_path, override=False)
    except ImportError:
        if env_path.exists():
            # 极简 .env 解析：KEY=VALUE，忽略注释与空行
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def connect(db_url: str):
    """返回一个 PostgreSQL 连接。优先 psycopg (v3)，退回 psycopg2。"""
    try:
        import psycopg  # type: ignore

        return psycopg.connect(db_url, autocommit=False)
    except ImportError:
        pass

    try:
        import psycopg2  # type: ignore

        return psycopg2.connect(db_url)
    except ImportError:
        print(
            "缺少 PostgreSQL 驱动。执行以下任一命令后重试：\n"
            "  pip install psycopg[binary] --break-system-packages\n"
            "  pip install psycopg2-binary --break-system-packages",
            file=sys.stderr,
        )
        raise SystemExit(2)


def strip_comments(sql: str) -> str:
    """去掉 `--` 行注释和 `/* */` 块注释。

    不处理字符串字面量里的 `--`：init.sql 的注释都在行首，不会误伤。
    """
    import re

    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.DOTALL)
    return "\n".join(
        line for line in sql.splitlines() if not line.strip().startswith("--")
    )


def split_statements(sql: str) -> list[str]:
    """把脚本切成单条语句，正确跳过 PostgreSQL 美元引号内的分号。

    关键点：`$$ ... $$` 或 `$tag$ ... $tag$` 里的分号不能当语句分隔符，
    否则 plpgsql 函数体会被切碎，CREATE FUNCTION 一定报语法错误。
    逐字符扫描，用引号状态机处理，比按分号 split 再回头配对可靠。
    """
    import re

    cleaned = strip_comments(sql)
    statements: list[str] = []
    buffer: list[str] = []
    index = 0
    length = len(cleaned)
    dollar_tag: str | None = None
    in_single = False

    while index < length:
        char = cleaned[index]

        if dollar_tag is None and not in_single:
            # 单引号字符串：'it''s' 里的 '' 是转义，跳过两个
            if char == "'":
                in_single = True
                buffer.append(char)
                index += 1
                continue
            # 美元引号起点：$ 或 $tag$
            if char == "$":
                match = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", cleaned[index:])
                if match:
                    dollar_tag = match.group(0)
                    buffer.append(dollar_tag)
                    index += len(dollar_tag)
                    continue
            if char == ";":
                statement = "".join(buffer).strip()
                if statement:
                    statements.append(statement)
                buffer = []
                index += 1
                continue
        else:
            if dollar_tag is not None and cleaned.startswith(dollar_tag, index):
                buffer.append(dollar_tag)
                index += len(dollar_tag)
                dollar_tag = None
                continue
            if in_single and char == "'":
                # '' 是转义的单引号，不属于字符串结束
                if cleaned.startswith("''", index):
                    buffer.append("''")
                    index += 2
                    continue
                in_single = False

        buffer.append(char)
        index += 1

    remainder = "".join(buffer).strip()
    if remainder:
        statements.append(remainder)
    return statements


def deploy(db_url: str) -> int:
    if not SQL_PATH.exists():
        print(f"找不到 SQL 脚本：{SQL_PATH}", file=sys.stderr)
        return 2

    sql = SQL_PATH.read_text(encoding="utf-8")
    statements = split_statements(sql)
    print(f"读取 {SQL_PATH.name}：{len(sql):,} 字符，{len(statements)} 条语句")

    conn = connect(db_url)
    try:
        with conn.cursor() as cur:
            for index, statement in enumerate(statements, 1):
                head = " ".join(statement.split())[:70]
                try:
                    cur.execute(statement)
                except Exception as exc:
                    conn.rollback()
                    print(f"\n第 {index} 条语句失败：{head}...", file=sys.stderr)
                    print(f"错误：{exc}", file=sys.stderr)
                    print(
                        "\n事务已回滚，数据库未被改动。常见原因：\n"
                        "  · 该实例不支持 pgvector —— 把 init.sql 第 0 节注释掉，"
                        "并删掉 knowledge_wiki 的 embedding 列\n"
                        "  · 用了 Transaction pooler（端口 6543）—— 换成 5432 直连\n"
                        "  · 密码或项目 URL 写错",
                        file=sys.stderr,
                    )
                    return 1
                print(f"  [{index}/{len(statements)}] OK  {head}...")
        conn.commit()
        print("\n部署完成，已提交。")
    finally:
        conn.close()

    return verify(db_url)


def verify(db_url: str) -> int:
    """逐表核对行数。不改数据。"""
    print("\n" + "=" * 70)
    print("建库自检")
    print("=" * 70)
    conn = connect(db_url)
    ok = True
    try:
        with conn.cursor() as cur:
            for table, expected in EXPECTED_COUNTS.items():
                try:
                    cur.execute(f"SELECT COUNT(*) FROM {table}")
                    actual = cur.fetchone()[0]
                except Exception as exc:
                    conn.rollback()
                    print(f"  FAIL {table}: 查询失败 —— {exc}")
                    ok = False
                    continue
                marker = "PASS" if actual == expected else "FAIL"
                if actual != expected:
                    ok = False
                print(f"  {marker} {table}: {actual} 行（期望 {expected}）")

            # Wiki 四类词条都要在，否则规则层会静默降级
            try:
                cur.execute(
                    "SELECT category, COUNT(*) FROM knowledge_wiki "
                    "GROUP BY category ORDER BY category"
                )
                print("\n  knowledge_wiki 分类分布：")
                for category, count in cur.fetchall():
                    print(f"    {category}: {count}")
            except Exception:
                conn.rollback()

            # 终态守卫触发器必须存在
            try:
                cur.execute(
                    "SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'trg_task_status_transition'"
                )
                trigger_count = cur.fetchone()[0]
                marker = "PASS" if trigger_count == 1 else "FAIL"
                if trigger_count != 1:
                    ok = False
                print(f"\n  {marker} 任务终态触发器已安装")
            except Exception:
                conn.rollback()
    finally:
        conn.close()

    print("\n" + ("全部通过。" if ok else "存在不符合预期的项，请检查上面的 FAIL 行。"))
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="部署 init.sql 到 Supabase")
    parser.add_argument("--verify", action="store_true", help="只自检，不执行建库")
    parser.add_argument("--dry-run", action="store_true", help="只解析脚本，不连库")
    args = parser.parse_args()

    if args.dry_run:
        sql = SQL_PATH.read_text(encoding="utf-8")
        statements = split_statements(sql)
        print(f"将执行 {len(statements)} 条语句：")
        for index, statement in enumerate(statements, 1):
            print(f"  {index:>3}. {' '.join(statement.split())[:90]}")
        return 0

    load_env()
    db_url = os.environ.get("SUPABASE_DB_URL", "").strip()

    if not db_url:
        print(
            "缺少 SUPABASE_DB_URL。\n\n"
            "获取方式：Supabase 后台 -> Project Settings -> Database ->\n"
            "  Connection string -> URI（用 5432 直连，不要用 6543 连接池）\n\n"
            "然后在仓库根目录的 .env 里写：\n"
            "  SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@"
            "aws-0-<region>.pooler.supabase.com:5432/postgres\n\n"
            "或者直接用后台的 SQL Editor 粘贴 init.sql 全文执行——"
            "效果完全一样，不需要本脚本。",
            file=sys.stderr,
        )
        return 2

    if args.verify:
        return verify(db_url)
    return deploy(db_url)


if __name__ == "__main__":
    sys.exit(main())
