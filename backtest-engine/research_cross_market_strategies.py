from __future__ import annotations

import argparse
import csv
import math
from dataclasses import replace
from pathlib import Path
from time import perf_counter

import runner


REPORT_DIR = runner.PROJECT_ROOT / "backtest-engine" / "research"
RESULTS_CSV = REPORT_DIR / "cross_market_results.csv"
BEST_CSV = REPORT_DIR / "cross_market_best.csv"
EXECUTION_TIMEFRAME = "1m"
EXECUTION_CACHE_LIMIT = 2


def clean_variant_id(variant_id: str) -> str:
    tokens = [token for token in variant_id.split("|") if token and token != "inverse=1"]
    return "|".join(tokens)


def slug(value: str) -> str:
    return "".join(character.lower() if character.isalnum() else "_" for character in value).strip("_")


def profit_factor(trades: list[runner.BacktestTradeRow]) -> float:
    gross_win = 0.0
    gross_loss = 0.0
    for trade in trades:
        if trade.r_multiple > 0:
            gross_win += trade.r_multiple
        elif trade.r_multiple < 0:
            gross_loss += abs(trade.r_multiple)
    if gross_loss == 0:
        return math.inf if gross_win > 0 else 0.0
    return gross_win / gross_loss


def metrics(trades: list[runner.BacktestTradeRow]) -> dict[str, float | int]:
    wins = sum(1 for trade in trades if trade.r_multiple > 0)
    losses = sum(1 for trade in trades if trade.r_multiple < 0)
    total_r = sum(trade.r_multiple for trade in trades)
    return {
        "pf": profit_factor(trades),
        "trades": len(trades),
        "wins": wins,
        "losses": losses,
        "win_rate_pct": (wins / len(trades) * 100) if trades else 0.0,
        "total_r": total_r,
        "avg_r": (total_r / len(trades)) if trades else 0.0,
    }


def clone_strategy(
    base: runner.BacktestStrategy,
    target_asset: runner.AssetConfig,
    invert_signal: bool,
) -> runner.BacktestStrategy:
    inverse_suffix = "__opposite" if invert_signal else ""
    return replace(
        base,
        id=f"{base.id}__on__{target_asset.key}{inverse_suffix}",
        label=f"{base.label} on {target_asset.symbol}" + (" Opposite" if invert_signal else ""),
        folder=f"{base.folder}__on__{target_asset.key}{inverse_suffix}",
        asset_key=target_asset.key,
        variant_id=clean_variant_id(base.variant_id),
        invert_signal=invert_signal,
    )


def scenario_for(base_market: str, target_market: str) -> str:
    return f"{base_market}_on_{target_market}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Cross-market strategy research runner")
    parser.add_argument(
        "--scenario",
        choices=["all", "forex_on_futures", "futures_on_forex", "all_assets"],
        default="all",
        help="Which cross-market direction to run",
    )
    parser.add_argument("--base-strategy", action="append", help="Optional strategy id/folder/asset filter. Repeat to include multiple.")
    parser.add_argument("--target-asset", action="append", help="Optional target asset key/symbol filter. Repeat to include multiple.")
    parser.add_argument("--limit", type=int, help="Optional maximum number of direct cross-market runs to execute.")
    parser.add_argument("--batch-size", type=int, help="Run only this many strategy/asset pairs from the deterministic work list.")
    parser.add_argument("--batch-index", type=int, default=0, help="Zero-based batch index used with --batch-size.")
    parser.add_argument("--best-min-pf", type=float, default=1.0, help="Minimum best PF to keep in cross_market_best.csv.")
    parser.add_argument("--best-min-trades", type=int, default=20, help="Minimum trade count to keep in cross_market_best.csv.")
    parser.add_argument("--append-results", action="store_true", help="Merge this batch into existing research CSVs.")
    parser.add_argument("--reset-results", action="store_true", help="Ignore existing research CSVs before writing this batch.")
    parser.add_argument("--skip-existing-results", action="store_true", help="Skip pairs already present in cross_market_results.csv.")
    parser.add_argument(
        "--target-order",
        choices=["catalog", "smallest-data-first"],
        default="catalog",
        help="Order target assets before batching/running.",
    )
    parser.add_argument(
        "--exclude-materialized-bases",
        action="store_true",
        help="Do not use generated cross-market strategy folders as source strategies.",
    )
    parser.add_argument(
        "--skip-existing-equivalent",
        action="store_true",
        help="Skip a target asset when an existing strategy already has the same phase, variant, inversion, and asset.",
    )
    parser.add_argument(
        "--skip-existing-similar",
        action="store_true",
        help="Skip a target asset when an existing strategy already has the same broad playbook/concept.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print selected work items without running backtests.")
    return parser.parse_args()


def selected_strategies(
    strategies: list[runner.BacktestStrategy],
    filters: list[str] | None,
) -> list[runner.BacktestStrategy]:
    if not filters:
        return strategies
    requested = [item.strip() for item in filters if item and item.strip()]
    if not requested:
        return strategies
    selected = [strategy for strategy in strategies if any(runner.strategy_matches_filter(strategy, item) for item in requested)]
    if not selected:
        raise ValueError(f"No strategies matched filter(s): {', '.join(requested)}")
    return selected


def selected_assets(
    assets: list[runner.AssetConfig],
    filters: list[str] | None,
) -> list[runner.AssetConfig]:
    if not filters:
        return assets
    requested = [item.strip().lower() for item in filters if item and item.strip()]
    if not requested:
        return assets
    selected = [
        asset
        for asset in assets
        if any(token in {asset.key.lower(), asset.symbol.lower()} for token in requested)
    ]
    if not selected:
        raise ValueError(f"No target assets matched filter(s): {', '.join(requested)}")
    return selected


def materialized_source_strategy(strategy: runner.BacktestStrategy) -> bool:
    return "_on_" in strategy.id or "_on_" in strategy.folder


def equivalent_key(strategy: runner.BacktestStrategy) -> tuple[str, str, bool, str]:
    return (
        strategy.phase,
        clean_variant_id(strategy.variant_id),
        bool(strategy.invert_signal),
        strategy.asset_key,
    )


def concept_key(strategy: runner.BacktestStrategy) -> str:
    haystack = f"{strategy.id} {strategy.folder} {strategy.label} {strategy.phase}".lower()
    if "tori" in haystack and "trendline" in haystack:
        return "tori_trendline_break_retest"
    if strategy.phase in {"tori_trendline_mtf", "trendline_break"} and "tori" in haystack:
        return "tori_trendline_break_retest"
    if "humbled" in haystack and "vwap" in haystack:
        return "humbled_trader_vwap_pullback"
    if "claytrader" in haystack or strategy.phase == "support_resistance_retest":
        return "claytrader_support_resistance_retest"
    if "reddit_orb_breakout" in haystack or strategy.phase == "reddit_orb_breakout":
        return "reddit_orb_breakout"
    if "reddit_orb_retest" in haystack or strategy.phase == "reddit_orb_retest":
        return "reddit_orb_retest"
    if "reddit_ema_pullback" in haystack or strategy.phase == "reddit_ema_pullback":
        return "reddit_ema_pullback"
    if "reddit_capitulation_reversion" in haystack or strategy.phase == "reddit_capitulation_reversion":
        return "reddit_capitulation_reversion"
    if "ny_sweep" in haystack or strategy.phase == "ny_sweep_playbook":
        return "ny_sweep_playbook"
    return strategy.phase


def similar_key(strategy: runner.BacktestStrategy, asset_key: str | None = None) -> tuple[str, str]:
    return (concept_key(strategy), asset_key if asset_key is not None else strategy.asset_key)


def run_strategy(
    strategy: runner.BacktestStrategy,
    asset: runner.AssetConfig,
    enriched_cache: dict[str, runner.EnrichedData],
    execution_cache: dict[str, runner.EnrichedData] | None = None,
    execution_cache_order: list[str] | None = None,
) -> list[runner.BacktestTradeRow]:
    if asset.key not in enriched_cache:
        candle_path = runner.DATA_ROOT / "15m" / asset.data_file
        if not candle_path.exists():
            raise FileNotFoundError(f"Missing 15m candle file: {candle_path}. Run prepare-data first.")
        frame = runner.load_candle_csv(candle_path)
        enriched_cache[asset.key] = runner.build_enriched_data(frame, asset)
    execution_data: list[tuple[str, runner.EnrichedData]] = []
    execution_path = runner.DATA_ROOT / EXECUTION_TIMEFRAME / asset.data_file
    if runner.candle_file_has_rows(execution_path):
        if execution_cache is None:
            execution_cache = {}
        if execution_cache_order is None:
            execution_cache_order = []
        if asset.key not in execution_cache:
            execution_frame = runner.load_candle_csv(execution_path)
            execution_cache[asset.key] = runner.build_enriched_data(execution_frame, asset)
            execution_cache_order.append(asset.key)
            while len(execution_cache_order) > EXECUTION_CACHE_LIMIT:
                stale_key = execution_cache_order.pop(0)
                if stale_key != asset.key:
                    execution_cache.pop(stale_key, None)
        execution_data.append((EXECUTION_TIMEFRAME, execution_cache[asset.key]))
    return runner.run_single_strategy(
        strategy,
        asset,
        enriched_cache[asset.key],
        start_ts=runner.BACKTEST_START_TS,
        execution_data=execution_data,
    )


def execution_data_available(asset: runner.AssetConfig) -> bool:
    return runner.candle_file_has_rows(runner.DATA_ROOT / EXECUTION_TIMEFRAME / asset.data_file)


def write_rows_csv(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fieldnames: list[str] = []
    for row in rows:
        for key in row.keys():
            if key not in fieldnames:
                fieldnames.append(key)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def read_rows_csv(path: Path) -> list[dict[str, object]]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def row_identity(row: dict[str, object]) -> tuple[str, str, str, str, str]:
    return (
        str(row["scenario"]),
        str(row["base_strategy_id"]),
        str(row["target_asset_key"]),
        str(row["phase"]),
        str(row["variant_id"]),
    )


def merge_rows(existing_rows: list[dict[str, object]], new_rows: list[dict[str, object]]) -> list[dict[str, object]]:
    merged: dict[tuple[str, str, str, str, str], dict[str, object]] = {
        row_identity(row): row
        for row in existing_rows
    }
    for row in new_rows:
        merged[row_identity(row)] = row
    return list(merged.values())


def qualifying_best_rows(
    rows: list[dict[str, object]],
    min_pf: float,
    min_trades: int,
) -> list[dict[str, object]]:
    return [
        row
        for row in rows
        if float(row["best_pf"]) >= min_pf and int(row["best_trades"]) >= min_trades
    ]


def data_file_size(asset: runner.AssetConfig) -> int:
    path = runner.DATA_ROOT / "15m" / asset.data_file
    return path.stat().st_size if path.exists() else 0


def main() -> None:
    args = parse_args()
    if args.batch_size is not None and args.batch_size <= 0:
        raise ValueError("--batch-size must be greater than zero")
    if args.batch_index < 0:
        raise ValueError("--batch-index must be zero or greater")
    if args.append_results and args.reset_results:
        raise ValueError("Use either --append-results or --reset-results, not both")
    assets = runner.load_asset_by_key()
    strategies = runner.load_backtest_strategies()
    existing_result_rows = [] if args.reset_results else read_rows_csv(RESULTS_CSV)
    existing_result_identities = {row_identity(row) for row in existing_result_rows}
    all_strategies = runner.load_backtest_strategies()
    existing_equivalents = {equivalent_key(strategy) for strategy in all_strategies}
    existing_similar = {similar_key(strategy) for strategy in all_strategies}
    strategies = all_strategies
    if args.exclude_materialized_bases:
        strategies = [strategy for strategy in strategies if not materialized_source_strategy(strategy)]
    all_assets = list(assets.values())
    all_forex_assets = [asset for asset in assets.values() if asset.market == "forex"]
    all_futures_assets = [asset for asset in assets.values() if asset.market == "futures"]
    all_forex_strategies = [strategy for strategy in strategies if assets[strategy.asset_key].market == "forex"]
    all_futures_strategies = [strategy for strategy in strategies if assets[strategy.asset_key].market == "futures"]
    enriched_cache: dict[str, runner.EnrichedData] = {}
    execution_cache: dict[str, runner.EnrichedData] = {}
    execution_cache_order: list[str] = []
    rows: list[dict[str, object]] = []
    experiment_sets: list[tuple[list[runner.BacktestStrategy], list[runner.AssetConfig]]] = []
    forex_strategy_count = 0
    futures_strategy_count = 0
    forex_asset_count = 0
    futures_asset_count = 0
    all_asset_strategy_count = 0
    all_asset_count = 0
    if args.scenario == "all_assets":
        selected_all_strategies = selected_strategies(strategies, args.base_strategy)
        selected_all_assets = selected_assets(all_assets, args.target_asset)
        all_asset_strategy_count = len(selected_all_strategies)
        all_asset_count = len(selected_all_assets)
        experiment_sets.append((selected_all_strategies, selected_all_assets))
    if args.scenario in {"all", "forex_on_futures"}:
        forex_strategies = selected_strategies(all_forex_strategies, args.base_strategy)
        futures_assets = selected_assets(all_futures_assets, args.target_asset)
        forex_strategy_count = len(forex_strategies)
        futures_asset_count = len(futures_assets)
        experiment_sets.append((forex_strategies, futures_assets))
    if args.scenario in {"all", "futures_on_forex"}:
        futures_strategies = selected_strategies(all_futures_strategies, args.base_strategy)
        forex_assets = selected_assets(all_forex_assets, args.target_asset)
        futures_strategy_count = len(futures_strategies)
        forex_asset_count = len(forex_assets)
        experiment_sets.append((futures_strategies, forex_assets))
    work_items = [
        (base, assets[base.asset_key], target_asset)
        for base_strategies, target_assets in experiment_sets
        for base in base_strategies
        for target_asset in (
            sorted(target_assets, key=data_file_size)
            if args.target_order == "smallest-data-first"
            else target_assets
        )
        if target_asset.key != base.asset_key
        and (
            not args.skip_existing_equivalent
            or (base.phase, clean_variant_id(base.variant_id), bool(base.invert_signal), target_asset.key) not in existing_equivalents
        )
        and (
            not args.skip_existing_similar
            or similar_key(base, target_asset.key) not in existing_similar
        )
        and (
            not args.skip_existing_results
            or row_identity(
                {
                    "scenario": scenario_for(assets[base.asset_key].market, target_asset.market),
                    "base_strategy_id": base.id,
                    "target_asset_key": target_asset.key,
                    "phase": base.phase,
                    "variant_id": clean_variant_id(base.variant_id),
                }
            ) not in existing_result_identities
        )
    ]
    total_direct_runs = len(work_items)
    batch_start = 0
    batch_end = total_direct_runs
    if args.batch_size is not None:
        batch_start = args.batch_index * args.batch_size
        batch_end = min(batch_start + args.batch_size, total_direct_runs)
        work_items = work_items[batch_start:batch_end]
    if args.limit is not None:
        work_items = work_items[: args.limit]
    batch_direct_runs = len(work_items)
    completed_direct_runs = 0
    started = perf_counter()

    if args.scenario == "all_assets":
        print(
            f"Running {total_direct_runs} direct all-asset backtests "
            f"({all_asset_strategy_count} strategies on {all_asset_count} target assets, excluding same-asset runs)"
        )
    else:
        print(
            f"Running {total_direct_runs} direct cross-market backtests "
            f"({forex_strategy_count} forex strategies on {futures_asset_count} futures assets, "
            f"{futures_strategy_count} futures strategies on {forex_asset_count} forex assets)"
        )
    if args.batch_size is not None:
        print(
            f"Batch {args.batch_index}: running work items {batch_start + 1}-{batch_end} "
            f"of {total_direct_runs} ({batch_direct_runs} pair tests)"
        )
    if args.dry_run:
        for index, (base, _base_asset, target_asset) in enumerate(work_items, start=batch_start + 1):
            print(f"{index}: {base.id} -> {target_asset.key} ({target_asset.market}, {target_asset.symbol})")
        print("Dry run complete.")
        return

    existing_rows = [] if args.reset_results or not args.append_results else existing_result_rows

    for base, base_asset, target_asset in work_items:
        completed_direct_runs += 1
        print(
            f"Starting [{completed_direct_runs}/{batch_direct_runs} batch, "
            f"{batch_start + completed_direct_runs}/{total_direct_runs} overall] "
            f"{base.id} on {target_asset.key}"
        )
        direct_strategy = clone_strategy(base, target_asset, invert_signal=base.invert_signal)
        direct_trades = run_strategy(direct_strategy, target_asset, enriched_cache, execution_cache, execution_cache_order)
        direct_metrics = metrics(direct_trades)

        opposite_tested = float(direct_metrics["pf"]) < 1.0
        opposite_metrics: dict[str, float | int] | None = None
        if opposite_tested:
            opposite_strategy = clone_strategy(base, target_asset, invert_signal=not base.invert_signal)
            opposite_trades = run_strategy(opposite_strategy, target_asset, enriched_cache, execution_cache, execution_cache_order)
            opposite_metrics = metrics(opposite_trades)

        best_metrics = direct_metrics
        best_inverted = False
        if opposite_metrics and float(opposite_metrics["pf"]) > float(direct_metrics["pf"]):
            best_metrics = opposite_metrics
            best_inverted = True

        row = {
            "scenario": scenario_for(base_asset.market, target_asset.market),
            "base_strategy_id": base.id,
            "base_label": base.label,
            "base_asset_key": base.asset_key,
            "base_symbol": base_asset.symbol,
            "base_market": base_asset.market,
            "target_asset_key": target_asset.key,
            "target_symbol": target_asset.symbol,
            "target_market": target_asset.market,
            "phase": base.phase,
            "variant_id": clean_variant_id(base.variant_id),
            "execution_timeframe": EXECUTION_TIMEFRAME if execution_data_available(target_asset) else "",
            "direct_pf": float(direct_metrics["pf"]),
            "direct_trades": int(direct_metrics["trades"]),
            "direct_win_rate_pct": float(direct_metrics["win_rate_pct"]),
            "direct_total_r": float(direct_metrics["total_r"]),
            "opposite_tested": opposite_tested,
            "opposite_pf": float(opposite_metrics["pf"]) if opposite_metrics else "",
            "opposite_trades": int(opposite_metrics["trades"]) if opposite_metrics else "",
            "opposite_win_rate_pct": float(opposite_metrics["win_rate_pct"]) if opposite_metrics else "",
            "opposite_total_r": float(opposite_metrics["total_r"]) if opposite_metrics else "",
            "best_pf": float(best_metrics["pf"]),
            "best_trades": int(best_metrics["trades"]),
            "best_win_rate_pct": float(best_metrics["win_rate_pct"]),
            "best_total_r": float(best_metrics["total_r"]),
            "best_inverted": best_inverted,
        }
        rows.append(row)

        checkpoint_rows = merge_rows(existing_rows, rows)
        checkpoint_rows.sort(key=lambda item: (float(item["best_pf"]), int(item["best_trades"])), reverse=True)
        write_rows_csv(RESULTS_CSV, checkpoint_rows)
        write_rows_csv(BEST_CSV, qualifying_best_rows(checkpoint_rows, args.best_min_pf, args.best_min_trades))

        if completed_direct_runs % 5 == 0 or completed_direct_runs == batch_direct_runs:
            elapsed = perf_counter() - started
            print(
                f"[{completed_direct_runs}/{batch_direct_runs} batch, {batch_start + completed_direct_runs}/{total_direct_runs} overall] "
                f"{base.id} on {target_asset.key}: direct PF={float(direct_metrics['pf']):.2f}"
                + (
                    f", opposite PF={float(opposite_metrics['pf']):.2f}" if opposite_metrics else ""
                )
                + f" ({elapsed:.1f}s elapsed)"
            )

    rows = merge_rows(existing_rows, rows)
    rows.sort(key=lambda item: (float(item["best_pf"]), int(item["best_trades"])), reverse=True)
    best_rows = qualifying_best_rows(rows, args.best_min_pf, args.best_min_trades)

    write_rows_csv(RESULTS_CSV, rows)
    write_rows_csv(BEST_CSV, best_rows)

    direct_winners = sum(1 for row in rows if float(row["direct_pf"]) >= 1.0)
    opposite_winners = sum(1 for row in rows if row["opposite_tested"] and float(row["opposite_pf"] or 0.0) >= 1.0)
    elapsed = perf_counter() - started
    print(f"Wrote {len(rows)} cumulative results to {RESULTS_CSV}")
    print(f"Wrote {len(best_rows)} candidate rows to {BEST_CSV} (PF>={args.best_min_pf}, trades>={args.best_min_trades})")
    print(f"Direct PF>=1 results: {direct_winners}")
    print(f"Opposite PF>=1 results (only among tested opposite runs): {opposite_winners}")
    print(f"Completed in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
