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
        choices=["all", "forex_on_futures", "futures_on_forex"],
        default="all",
        help="Which cross-market direction to run",
    )
    parser.add_argument("--base-strategy", action="append", help="Optional strategy id/folder/asset filter. Repeat to include multiple.")
    parser.add_argument("--target-asset", action="append", help="Optional target asset key/symbol filter. Repeat to include multiple.")
    parser.add_argument("--limit", type=int, help="Optional maximum number of direct cross-market runs to execute.")
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


def run_strategy(
    strategy: runner.BacktestStrategy,
    asset: runner.AssetConfig,
    enriched_cache: dict[str, runner.EnrichedData],
) -> list[runner.BacktestTradeRow]:
    if asset.key not in enriched_cache:
        candle_path = runner.DATA_ROOT / "15m" / asset.data_file
        if not candle_path.exists():
            raise FileNotFoundError(f"Missing 15m candle file: {candle_path}. Run prepare-data first.")
        frame = runner.load_candle_csv(candle_path)
        enriched_cache[asset.key] = runner.build_enriched_data(frame)
    return runner.run_single_strategy(
        strategy,
        asset,
        enriched_cache[asset.key],
        start_ts=runner.BACKTEST_START_TS,
    )


def write_rows_csv(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    args = parse_args()
    assets = runner.load_asset_by_key()
    strategies = runner.load_backtest_strategies()
    all_forex_assets = [asset for asset in assets.values() if asset.market == "forex"]
    all_futures_assets = [asset for asset in assets.values() if asset.market == "futures"]
    all_forex_strategies = [strategy for strategy in strategies if assets[strategy.asset_key].market == "forex"]
    all_futures_strategies = [strategy for strategy in strategies if assets[strategy.asset_key].market == "futures"]
    enriched_cache: dict[str, runner.EnrichedData] = {}
    rows: list[dict[str, object]] = []
    experiment_sets: list[tuple[list[runner.BacktestStrategy], list[runner.AssetConfig]]] = []
    forex_strategy_count = 0
    futures_strategy_count = 0
    forex_asset_count = 0
    futures_asset_count = 0
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
    total_direct_runs = sum(len(base_strategies) * len(target_assets) for base_strategies, target_assets in experiment_sets)
    completed_direct_runs = 0
    started = perf_counter()

    print(
        f"Running {total_direct_runs} direct cross-market backtests "
        f"({forex_strategy_count} forex strategies on {futures_asset_count} futures assets, "
        f"{futures_strategy_count} futures strategies on {forex_asset_count} forex assets)"
    )

    for base_strategies, target_assets in experiment_sets:
        for base in base_strategies:
            base_asset = assets[base.asset_key]
            for target_asset in target_assets:
                if args.limit is not None and completed_direct_runs >= args.limit:
                    break
                completed_direct_runs += 1
                direct_strategy = clone_strategy(base, target_asset, invert_signal=base.invert_signal)
                direct_trades = run_strategy(direct_strategy, target_asset, enriched_cache)
                direct_metrics = metrics(direct_trades)

                opposite_tested = float(direct_metrics["pf"]) < 1.0
                opposite_metrics: dict[str, float | int] | None = None
                if opposite_tested:
                    opposite_strategy = clone_strategy(base, target_asset, invert_signal=not base.invert_signal)
                    opposite_trades = run_strategy(opposite_strategy, target_asset, enriched_cache)
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

                if completed_direct_runs % 25 == 0:
                    snapshot_rows = sorted(rows, key=lambda item: (float(item["best_pf"]), int(item["best_trades"])), reverse=True)
                    snapshot_best_rows = [
                        item
                        for item in snapshot_rows
                        if float(item["best_pf"]) >= 1.0 and int(item["best_trades"]) >= 20
                    ]
                    write_rows_csv(RESULTS_CSV, snapshot_rows)
                    write_rows_csv(BEST_CSV, snapshot_best_rows)

                if completed_direct_runs % 10 == 0 or completed_direct_runs == total_direct_runs:
                    elapsed = perf_counter() - started
                    print(
                        f"[{completed_direct_runs}/{total_direct_runs}] "
                        f"{base.id} on {target_asset.key}: direct PF={float(direct_metrics['pf']):.2f}"
                        + (
                            f", opposite PF={float(opposite_metrics['pf']):.2f}" if opposite_metrics else ""
                        )
                        + f" ({elapsed:.1f}s elapsed)"
                    )
            if args.limit is not None and completed_direct_runs >= args.limit:
                break
        if args.limit is not None and completed_direct_runs >= args.limit:
            break

    rows.sort(key=lambda item: (float(item["best_pf"]), int(item["best_trades"])), reverse=True)
    best_rows = [
        row
        for row in rows
        if float(row["best_pf"]) >= 1.0 and int(row["best_trades"]) >= 20
    ]

    write_rows_csv(RESULTS_CSV, rows)
    write_rows_csv(BEST_CSV, best_rows)

    direct_winners = sum(1 for row in rows if float(row["direct_pf"]) >= 1.0)
    opposite_winners = sum(1 for row in rows if row["opposite_tested"] and float(row["opposite_pf"] or 0.0) >= 1.0)
    elapsed = perf_counter() - started
    print(f"Wrote {len(rows)} results to {RESULTS_CSV}")
    print(f"Wrote {len(best_rows)} candidate rows to {BEST_CSV}")
    print(f"Direct PF>=1 results: {direct_winners}")
    print(f"Opposite PF>=1 results (only among tested opposite runs): {opposite_winners}")
    print(f"Completed in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
