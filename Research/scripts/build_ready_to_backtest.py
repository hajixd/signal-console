from __future__ import annotations

import argparse
import itertools
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from common import IDEAS_APPROVED, READY_ROOT, ensure_research_dirs, iter_json_files, load_assets, read_json, split_csv_arg, stable_id, write_json


SUPPORTED_ENGINES = {"overnight_bias", "open_gap", "intraday_momentum", "range_break", "daily_tsmom"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Expand approved ideas into single-asset ready-to-backtest strategy specs.")
    parser.add_argument("--markets", default="futures,forex", help="Comma-separated markets to include.")
    parser.add_argument("--asset", action="append", help="Asset key/symbol filter. Repeat or comma-separate.")
    parser.add_argument("--idea", action="append", help="Idea id filter. Repeatable.")
    parser.add_argument("--max-per-idea", type=int, default=0, help="Optional cap after expansion per idea; 0 means no cap.")
    parser.add_argument("--clear-ready", action="store_true", help="Clear old ready specs before building.")
    return parser.parse_args()


def product_grid(grid: dict[str, Any]) -> list[dict[str, Any]]:
    if not grid:
        return [{}]
    keys = list(grid.keys())
    values = [value if isinstance(value, list) else [value] for value in grid.values()]
    return [dict(zip(keys, combo, strict=True)) for combo in itertools.product(*values)]


def selected_ideas(filters: list[str] | None) -> list[dict[str, Any]]:
    requested = {item.strip().lower() for item in (filters or []) if item.strip()}
    ideas = []
    for path in iter_json_files(IDEAS_APPROVED):
        idea = read_json(path)
        idea_id = str(idea.get("ideaId", path.stem)).lower()
        if requested and idea_id not in requested and path.stem.lower() not in requested:
            continue
        if idea.get("status") not in {None, "approved"}:
            continue
        ideas.append(idea)
    return ideas


def clear_ready() -> None:
    for child in READY_ROOT.iterdir():
        if child.name == ".gitkeep":
            continue
        if child.is_dir():
            for nested in child.rglob("*"):
                if nested.is_file():
                    nested.unlink()
            for nested_dir in sorted((path for path in child.rglob("*") if path.is_dir()), reverse=True):
                nested_dir.rmdir()
            child.rmdir()
        elif child.is_file():
            child.unlink()


def idea_assets(idea: dict[str, Any], markets: list[str], asset_filters: list[str]) -> list[Any]:
    idea_markets = [str(item) for item in idea.get("markets", []) if str(item)]
    selected_markets = [market for market in markets if not idea_markets or market in idea_markets]
    idea_asset_keys = [str(item) for item in idea.get("assetKeys", []) if str(item)]
    assets = load_assets(selected_markets, asset_filters)
    if idea_asset_keys:
        requested = {item.lower() for item in idea_asset_keys}
        assets = [asset for asset in assets if asset.key.lower() in requested or asset.symbol.lower() in requested]
    return assets


def write_spec(idea: dict[str, Any], asset: Any, engine: str, params: dict[str, Any]) -> Path:
    spec_id = stable_id(str(idea.get("ideaId")), asset.key, engine, params, prefix="rs_")
    folder = READY_ROOT / spec_id
    payload = {
        "strategyId": spec_id,
        "ideaId": idea.get("ideaId"),
        "title": idea.get("title"),
        "hypothesis": idea.get("hypothesis"),
        "provenance": idea.get("provenance"),
        "sourceUrls": idea.get("sourceUrls", []),
        "status": "ready_to_backtest",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "assetKey": asset.key,
        "symbol": asset.symbol,
        "market": asset.market,
        "engine": engine,
        "params": params,
        "thresholds": {
            "minProfitFactor": 2.0,
            "minTrades": 21
        }
    }
    write_json(folder / "strategy.json", payload)
    return folder


def main() -> None:
    args = parse_args()
    ensure_research_dirs()
    if args.clear_ready:
        clear_ready()
    markets = split_csv_arg(args.markets)
    asset_filters = [item for raw in (args.asset or []) for item in split_csv_arg(raw)]
    written: list[Path] = []
    for idea in selected_ideas(args.idea):
        engines = [str(engine) for engine in idea.get("engines", []) if str(engine) in SUPPORTED_ENGINES]
        assets = idea_assets(idea, markets, asset_filters)
        grid = product_grid(idea.get("parameterGrid", {}))
        count = 0
        for asset in assets:
            for engine in engines:
                for params in grid:
                    if args.max_per_idea and count >= args.max_per_idea:
                        break
                    written.append(write_spec(idea, asset, engine, params))
                    count += 1
                if args.max_per_idea and count >= args.max_per_idea:
                    break
            if args.max_per_idea and count >= args.max_per_idea:
                break
    manifest = {
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "readyCount": len(written),
        "folders": [path.name for path in written],
    }
    write_json(READY_ROOT / "_manifest.json", manifest)
    print(f"Wrote {len(written)} ready-to-backtest strategy folder(s).")


if __name__ == "__main__":
    main()
