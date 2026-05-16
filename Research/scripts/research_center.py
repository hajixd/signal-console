from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from common import BACKTESTED_ROOT, IDEAS_APPROVED, IDEAS_INBOX, PAGES_ROOT, QUALIFIED_ROOT, READY_ROOT, REPORTS_ROOT, SEARCH_RESULTS_ROOT, ensure_research_dirs


SCRIPT_ROOT = Path(__file__).resolve().parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Research Center orchestrator.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("status")

    seed = subparsers.add_parser("seed")
    seed.add_argument("--from-pages", action="store_true")

    search = subparsers.add_parser("search")
    search.add_argument("--topic", action="append")
    search.add_argument("--limit", type=int, default=8)

    fetch = subparsers.add_parser("fetch")
    fetch.add_argument("--limit", type=int, default=50)

    build = subparsers.add_parser("build")
    build.add_argument("--markets", default="futures,forex")
    build.add_argument("--asset", action="append")
    build.add_argument("--max-per-idea", type=int, default=0)
    build.add_argument("--clear-ready", action="store_true")

    backtest = subparsers.add_parser("backtest")
    backtest.add_argument("--min-pf", type=float, default=2.0)
    backtest.add_argument("--min-trades", type=int, default=21)
    backtest.add_argument("--workers", type=int, default=1)
    backtest.add_argument("--limit", type=int, default=0)
    backtest.add_argument("--overwrite", action="store_true")
    backtest.add_argument("--clear-results", action="store_true")

    cycle = subparsers.add_parser("local-cycle")
    cycle.add_argument("--markets", default="futures,forex")
    cycle.add_argument("--asset", action="append")
    cycle.add_argument("--max-per-idea", type=int, default=0)
    cycle.add_argument("--min-pf", type=float, default=2.0)
    cycle.add_argument("--min-trades", type=int, default=21)
    cycle.add_argument("--workers", type=int, default=1)
    cycle.add_argument("--limit", type=int, default=0)
    cycle.add_argument("--clear-ready", action="store_true")
    cycle.add_argument("--clear-results", action="store_true")

    return parser.parse_args()


def run_script(name: str, args: list[str] | None = None) -> None:
    command = [sys.executable, str(SCRIPT_ROOT / name), *(args or [])]
    print(" ".join(command))
    subprocess.run(command, check=True)


def count_stage(path: Path, pattern: str = "*", dirs_only: bool = False) -> int:
    if not path.exists():
        return 0
    return sum(
        1
        for item in path.glob(pattern)
        if item.name != ".gitkeep" and not item.name.startswith("_") and (not dirs_only or item.is_dir())
    )


def status() -> None:
    ensure_research_dirs()
    rows = [
        ("search result files", count_stage(SEARCH_RESULTS_ROOT, "*.json")),
        ("fetched pages", count_stage(PAGES_ROOT, "*.json")),
        ("ideas inbox", count_stage(IDEAS_INBOX, "*.json")),
        ("ideas approved", count_stage(IDEAS_APPROVED, "*.json")),
        ("ready folders", count_stage(READY_ROOT, dirs_only=True)),
        ("backtested folders", count_stage(BACKTESTED_ROOT, dirs_only=True)),
        ("qualified folders", count_stage(QUALIFIED_ROOT, dirs_only=True)),
        ("reports", count_stage(REPORTS_ROOT)),
    ]
    for label, count in rows:
        print(f"{label}: {count}")


def main() -> None:
    args = parse_args()
    ensure_research_dirs()
    if args.command == "status":
        status()
        return
    if args.command == "seed":
        script_args = ["--seed"]
        if args.from_pages:
            script_args.append("--from-pages")
        run_script("ideas_from_research.py", script_args)
        return
    if args.command == "search":
        script_args: list[str] = ["--limit", str(args.limit)]
        for topic in args.topic or []:
            script_args.extend(["--topic", topic])
        run_script("search_internet.py", script_args)
        return
    if args.command == "fetch":
        run_script("fetch_sources.py", ["--limit", str(args.limit)])
        return
    if args.command == "build":
        script_args = ["--markets", args.markets, "--max-per-idea", str(args.max_per_idea)]
        for asset in args.asset or []:
            script_args.extend(["--asset", asset])
        if args.clear_ready:
            script_args.append("--clear-ready")
        run_script("build_ready_to_backtest.py", script_args)
        return
    if args.command == "backtest":
        script_args = [
            "--min-pf",
            str(args.min_pf),
            "--min-trades",
            str(args.min_trades),
            "--workers",
            str(args.workers),
            "--limit",
            str(args.limit),
        ]
        if args.overwrite:
            script_args.append("--overwrite")
        if args.clear_results:
            script_args.append("--clear-results")
        run_script("backtest_ready.py", script_args)
        return
    if args.command == "local-cycle":
        run_script("ideas_from_research.py", ["--seed"])
        build_args = ["--markets", args.markets, "--max-per-idea", str(args.max_per_idea)]
        for asset in args.asset or []:
            build_args.extend(["--asset", asset])
        if args.clear_ready:
            build_args.append("--clear-ready")
        run_script("build_ready_to_backtest.py", build_args)
        backtest_args = [
            "--min-pf",
            str(args.min_pf),
            "--min-trades",
            str(args.min_trades),
            "--workers",
            str(args.workers),
            "--limit",
            str(args.limit),
        ]
        if args.clear_results:
            backtest_args.append("--clear-results")
        run_script("backtest_ready.py", backtest_args)
        status()


if __name__ == "__main__":
    main()
