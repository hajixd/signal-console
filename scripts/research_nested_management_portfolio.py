from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import sys
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backtest-engine"))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

import runner  # noqa: E402
import search_higher_timeframe_strategies as statistics  # noqa: E402


REPORT_ROOT = PROJECT_ROOT / "Research" / "reports"
SOURCE = "nested_dynamic_management_2026_08"
SOURCE_URLS = [
    "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=968338",
    "https://papers.ssrn.com/sol3/Delivery.cfm/SSRN_ID3338243_code3381625.pdf?abstractid=3338243&mirid=1",
    "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6350238",
    "https://papers.ssrn.com/sol3/Delivery.cfm/6240638.pdf?abstractid=6240638&mirid=1",
]


@dataclass(frozen=True)
class ManagementSpec:
    name: str
    stop: runner.DynamicStopLossPolicy | None = None
    target: runner.DynamicTakeProfitPolicy | None = None
    initial_target: runner.TakeProfitPolicy | None = None


@dataclass(frozen=True)
class Candidate:
    strategy: runner.BacktestStrategy
    spec: ManagementSpec
    baseline_validation: statistics.Metrics
    baseline_holdout: statistics.Metrics
    train: statistics.Metrics
    validation: statistics.Metrics
    holdout: statistics.Metrics
    overall: statistics.Metrics
    trades: list[runner.BacktestTradeRow]
    holdout_p_value: float
    holdout_q_value: float = 1.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Nested train/validation/holdout research for moving TP/SL and profit-lock policies."
    )
    parser.add_argument("--market", choices=["forex", "futures"], required=True)
    parser.add_argument("--asset", action="append", help="Optional key/symbol; repeat or comma-separate.")
    parser.add_argument("--max-strategies", type=int, default=0)
    parser.add_argument("--min-train-trades", type=int, default=20)
    parser.add_argument("--min-validation-trades", type=int, default=8)
    parser.add_argument("--min-holdout-trades", type=int, default=12)
    parser.add_argument("--false-discovery-rate", type=float, default=0.15)
    parser.add_argument("--min-portfolio-pf", type=float, default=3.0)
    parser.add_argument("--min-trades-per-trading-day", type=float, default=5.0)
    parser.add_argument("--apply", action="store_true")
    return parser.parse_args()


def ts(value: str) -> int:
    return int(datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp())


TRAIN_START = ts("2022-01-01")
TRAIN_END = ts("2024-01-01")
VALIDATION_END = ts("2025-01-01")


def specs() -> list[ManagementSpec]:
    return [
        ManagementSpec("be_0_5r", runner.DynamicStopLossPolicy("breakeven", 0, 0.5, 0.0)),
        ManagementSpec("be_0_75r", runner.DynamicStopLossPolicy("breakeven", 0, 0.75, 0.0)),
        ManagementSpec("be_1r", runner.DynamicStopLossPolicy("breakeven", 0, 1.0, 0.0)),
        ManagementSpec("be_1_5r", runner.DynamicStopLossPolicy("breakeven", 0, 1.5, 0.0)),
        ManagementSpec("lock_0_25r_at_1r", runner.DynamicStopLossPolicy("breakeven", 0, 1.0, 0.25)),
        ManagementSpec("lock_0_5r_at_1_5r", runner.DynamicStopLossPolicy("breakeven", 0, 1.5, 0.5)),
        ManagementSpec("lock_1r_at_2r", runner.DynamicStopLossPolicy("breakeven", 0, 2.0, 1.0)),
        ManagementSpec("trail_prior_b0", runner.DynamicStopLossPolicy("trail_prior_bar", 0, 1.0, 0.0)),
        ManagementSpec("trail_prior_b2", runner.DynamicStopLossPolicy("trail_prior_bar", 2, 1.0, 0.0)),
        ManagementSpec("trail_hourly_b0", runner.DynamicStopLossPolicy("trail_hourly_pivot", 0, 1.0, 0.0)),
        ManagementSpec("trail_hourly_b2", runner.DynamicStopLossPolicy("trail_hourly_pivot", 2, 1.0, 0.0)),
        ManagementSpec(
            "be_1r_trail_target_prior",
            runner.DynamicStopLossPolicy("breakeven", 0, 1.0, 0.0),
            runner.DynamicTakeProfitPolicy("trail_prior_bar", 0, None),
        ),
        ManagementSpec(
            "lock_0_5r_trail_target_hourly",
            runner.DynamicStopLossPolicy("breakeven", 0, 1.5, 0.5),
            runner.DynamicTakeProfitPolicy("trail_hourly_extreme", 0, None),
        ),
        ManagementSpec("static_target_2r", initial_target=runner.TakeProfitPolicy("risk_multiple", 0, 2.0)),
        ManagementSpec("static_target_3r", initial_target=runner.TakeProfitPolicy("risk_multiple", 0, 3.0)),
        ManagementSpec("static_target_4r", initial_target=runner.TakeProfitPolicy("risk_multiple", 0, 4.0)),
    ]


def requested_assets(values: list[str] | None) -> set[str]:
    return {item.strip().lower() for raw in values or [] for item in raw.split(",") if item.strip()}


def select_strategies(args: argparse.Namespace) -> tuple[list[runner.BacktestStrategy], dict[str, runner.AssetConfig]]:
    assets = runner.load_asset_by_key()
    requested = requested_assets(args.asset)
    selected = [
        strategy
        for strategy in runner.selected_backtest_strategies()
        if strategy.metadata_path is not None
        and strategy.asset_key in assets
        and assets[strategy.asset_key].market == args.market
        and (not requested or strategy.asset_key.lower() in requested or assets[strategy.asset_key].symbol.lower() in requested)
        and (runner.DATA_ROOT / runner.strategy_timeframe(strategy) / assets[strategy.asset_key].data_file).exists()
        and (
            runner.strategy_timeframe(strategy) == "1m"
            or (runner.DATA_ROOT / "1m" / assets[strategy.asset_key].data_file).exists()
        )
    ]
    selected.sort(key=lambda strategy: (strategy.asset_key, strategy.id))
    if args.max_strategies > 0:
        selected = selected[: args.max_strategies]
    return selected, assets


def metric_seed(strategy: runner.BacktestStrategy, spec_name: str, window: str) -> int:
    return int(hashlib.sha1(f"{strategy.id}|{spec_name}|{window}".encode()).hexdigest()[:8], 16)


def metrics(
    strategy: runner.BacktestStrategy,
    spec_name: str,
    window: str,
    trades: list[runner.BacktestTradeRow],
) -> statistics.Metrics:
    return statistics.metrics_for(trades, metric_seed(strategy, spec_name, window), min_split_trades=2)


def split_trades(trades: list[runner.BacktestTradeRow]) -> tuple[list[runner.BacktestTradeRow], ...]:
    return (
        [trade for trade in trades if TRAIN_START <= trade.entry_time < TRAIN_END],
        [trade for trade in trades if TRAIN_END <= trade.entry_time < VALIDATION_END],
        [trade for trade in trades if trade.entry_time >= VALIDATION_END],
    )


def load_data(
    asset: runner.AssetConfig,
    timeframe: str,
) -> tuple[runner.EnrichedData, list[tuple[str, runner.EnrichedData]] | None]:
    source = runner.build_enriched_data(runner.load_candle_csv(runner.DATA_ROOT / timeframe / asset.data_file), asset)
    if timeframe == "1m":
        return source, None
    execution = runner.build_enriched_data(runner.load_candle_csv(runner.DATA_ROOT / "1m" / asset.data_file), asset)
    return source, [("1m", execution)]


def run(
    strategy: runner.BacktestStrategy,
    asset: runner.AssetConfig,
    source: runner.EnrichedData,
    execution: list[tuple[str, runner.EnrichedData]] | None,
) -> list[runner.BacktestTradeRow]:
    return runner.run_single_strategy(
        strategy,
        asset,
        source,
        start_ts=TRAIN_START,
        end_ts=None,
        strict_anti_cheat=True,
        execution_data=execution,
    )


def managed(strategy: runner.BacktestStrategy, spec: ManagementSpec) -> runner.BacktestStrategy:
    return replace(
        strategy,
        source=SOURCE,
        dynamic_stop_loss_policy=spec.stop,
        dynamic_take_profit_policy=spec.target,
        take_profit_policy=spec.initial_target or strategy.take_profit_policy,
    )


def train_passes(value: statistics.Metrics, args: argparse.Namespace) -> bool:
    return (
        value.trades >= args.min_train_trades
        and value.profit_factor >= 0.85
        and value.total_r > -2
        and value.odd_even_min_pf >= 0.55
    )


def validation_passes(
    value: statistics.Metrics, baseline: statistics.Metrics, args: argparse.Namespace
) -> bool:
    return (
        value.trades >= args.min_validation_trades
        and value.profit_factor >= max(1.05, baseline.profit_factor + 0.02)
        and value.bootstrap_pf_p05 >= 0.45
        and value.block_bootstrap_pf_p05 >= 0.45
        and value.odd_even_min_pf >= 0.55
        and value.sign_flip_p_value <= 0.30
    )


def validation_score(value: statistics.Metrics, baseline: statistics.Metrics) -> float:
    return (
        min(value.profit_factor - baseline.profit_factor, 5) * 4
        + min(value.bootstrap_pf_p05, 3)
        + min(value.block_bootstrap_pf_p05, 3)
        + math.log1p(value.trades)
        - value.sign_flip_p_value * 4
    )


def false_discovery(candidates: list[Candidate]) -> list[Candidate]:
    ordered = sorted(candidates, key=lambda candidate: candidate.holdout_p_value)
    count = len(ordered)
    q_values = [1.0] * count
    running = 1.0
    for index in range(count - 1, -1, -1):
        running = min(running, ordered[index].holdout_p_value * count / (index + 1))
        q_values[index] = min(1.0, running)
    return [replace(candidate, holdout_q_value=q_values[index]) for index, candidate in enumerate(ordered)]


def holdout_passes(candidate: Candidate, args: argparse.Namespace) -> bool:
    value = candidate.holdout
    overall = candidate.overall
    return (
        value.trades >= args.min_holdout_trades
        and value.profit_factor >= max(1.10, candidate.baseline_holdout.profit_factor)
        and value.bootstrap_pf_p05 >= 0.60
        and value.block_bootstrap_pf_p05 >= 0.55
        and value.odd_even_min_pf >= 0.60
        and candidate.holdout_q_value <= args.false_discovery_rate
        and overall.profit_factor > 1.0
        and overall.min_split_pf > 1.0
        and overall.bootstrap_pf_p05 > 1.0
        and overall.block_bootstrap_pf_p05 > 0.90
        and overall.annual_pass_rate >= 0.60
    )


def stress_validated_ids() -> set[str]:
    path = REPORT_ROOT / "stress_validation_catalog.csv"
    if not path.exists():
        return set()
    with path.open(newline="", encoding="utf-8") as handle:
        return {
            row["strategy_id"]
            for row in csv.DictReader(handle)
            if row.get("status") == "pass" and row.get("strategy_id")
        }


def portfolio_metrics(
    trades: list[runner.BacktestTradeRow],
    assets: dict[str, runner.AssetConfig],
    relative_scale_by_strategy: dict[str, float] | None = None,
) -> dict[str, float | int]:
    ordered = sorted(trades, key=lambda trade: (trade.entry_time, trade.exit_time, trade.strategy_id))
    scales = relative_scale_by_strategy or {}
    r_values = [
        trade.r_multiple * trade.size_multiplier * scales.get(trade.strategy_id, 1.0)
        for trade in ordered
    ]
    dollar_values = [
        trade.r_multiple
        * (abs(trade.sl_units) + abs(trade.cost_units))
        * assets[trade.asset_key].dollar_per_unit
        * trade.size_multiplier
        * scales.get(trade.strategy_id, 1.0)
        for trade in ordered
    ]
    days = {runner.iso_time(trade.entry_time)[:10] for trade in ordered}
    calendar_days = (
        max(1.0, (ordered[-1].exit_time - ordered[0].entry_time) / 86_400)
        if ordered
        else 1.0
    )
    return {
        "profitFactor": statistics.profit_factor(dollar_values),
        "rProfitFactor": statistics.profit_factor(r_values),
        "trades": len(ordered),
        "tradingDays": len(days),
        "tradesPerTradingDay": len(ordered) / len(days) if days else 0.0,
        "tradesPerDay": len(ordered) / calendar_days if ordered else 0.0,
        "netR": sum(r_values),
        "netDollars": sum(dollar_values),
    }


def optimized_portfolio(
    trades: list[runner.BacktestTradeRow],
    assets: dict[str, runner.AssetConfig],
    minimum_scale: float = 0.1,
    maximum_scale: float = 3.0,
) -> dict[str, object]:
    development_trades = [trade for trade in trades if trade.entry_time < VALIDATION_END]
    sealed_holdout_trades = [trade for trade in trades if trade.entry_time >= VALIDATION_END]
    by_strategy: dict[str, list[float]] = {}
    for trade in development_trades:
        pnl = (
            trade.r_multiple
            * (abs(trade.sl_units) + abs(trade.cost_units))
            * assets[trade.asset_key].dollar_per_unit
            * trade.size_multiplier
        )
        by_strategy.setdefault(trade.strategy_id, []).append(pnl)
    ranked = sorted(
        by_strategy,
        key=lambda strategy_id: statistics.profit_factor(by_strategy[strategy_id]),
        reverse=True,
    )
    best_pf = 0.0
    best_high_count = 0
    for high_count in range(len(ranked) + 1):
        values = [
            pnl * (maximum_scale if index < high_count else minimum_scale)
            for index, strategy_id in enumerate(ranked)
            for pnl in by_strategy[strategy_id]
        ]
        candidate_pf = statistics.profit_factor(values)
        if candidate_pf > best_pf:
            best_pf = candidate_pf
            best_high_count = high_count
    weights = {
        strategy_id: maximum_scale if index < best_high_count else minimum_scale
        for index, strategy_id in enumerate(ranked)
    }
    full = portfolio_metrics(trades, assets, weights)
    development = portfolio_metrics(development_trades, assets, weights)
    sealed_holdout = portfolio_metrics(sealed_holdout_trades, assets, weights)
    return {
        **full,
        "minimumScale": minimum_scale,
        "maximumScale": maximum_scale,
        "highScaleStrategyCount": best_high_count,
        "relativeScaleByStrategy": weights,
        "sizingSelectionWindow": "2022-01-01 through 2024-12-31",
        "developmentPortfolio": development,
        "sealedHoldoutPortfolio": sealed_holdout,
    }


def policy_payload(spec: ManagementSpec) -> dict[str, object]:
    payload: dict[str, object] = {}
    if spec.stop is not None:
        payload["dynamicStopLossPolicy"] = {
            "mode": spec.stop.mode,
            "bufferUnits": spec.stop.buffer_units,
            "triggerMultiple": spec.stop.trigger_multiple,
            "lockMultiple": spec.stop.lock_multiple,
        }
    if spec.target is not None:
        target: dict[str, object] = {"mode": spec.target.mode, "bufferUnits": spec.target.buffer_units}
        if spec.target.reward_multiple is not None:
            target["rewardMultiple"] = spec.target.reward_multiple
        payload["dynamicTakeProfitPolicy"] = target
    if spec.initial_target is not None:
        payload["takeProfitPolicy"] = {
            "mode": spec.initial_target.mode,
            "bufferUnits": spec.initial_target.buffer_units,
            "rewardMultiple": spec.initial_target.reward_multiple,
        }
    return payload


def apply(candidate: Candidate) -> None:
    metadata_path = candidate.strategy.metadata_path
    if metadata_path is None:
        return
    payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    payload.pop("dynamicStopLossPolicy", None)
    payload.pop("dynamicTakeProfitPolicy", None)
    payload.update(policy_payload(candidate.spec))
    payload["source"] = SOURCE
    payload["verificationSummary"] = (
        f"Nested management `{candidate.spec.name}`: validation PF {candidate.validation.profit_factor:.2f} "
        f"over {candidate.validation.trades} trades; sealed holdout PF {candidate.holdout.profit_factor:.2f} "
        f"over {candidate.holdout.trades} trades; holdout q={candidate.holdout_q_value:.3f}."
    )
    metadata_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    runner.write_strategy_backtest_csv(PROJECT_ROOT / "strategy" / candidate.strategy.folder / "backtest_trades.csv", candidate.trades)


def main() -> int:
    args = parse_args()
    strategies, assets = select_strategies(args)
    by_asset: dict[str, list[runner.BacktestStrategy]] = {}
    for strategy in strategies:
        by_asset.setdefault(strategy.asset_key, []).append(strategy)
    shortlisted: list[Candidate] = []
    baseline_full: dict[str, list[runner.BacktestTradeRow]] = {}
    print(f"Nested management: {args.market}, {len(strategies)} strategies, {len(specs())} frozen variants", flush=True)

    for asset_index, (asset_key, asset_strategies) in enumerate(by_asset.items(), start=1):
        asset = assets[asset_key]
        data_cache: dict[str, tuple[runner.EnrichedData, list[tuple[str, runner.EnrichedData]] | None]] = {}
        print(f"  [{asset_index}/{len(by_asset)}] {asset_key}: {len(asset_strategies)} strategies", flush=True)
        for strategy in asset_strategies:
            timeframe = runner.strategy_timeframe(strategy)
            if timeframe not in data_cache:
                data_cache[timeframe] = load_data(asset, timeframe)
            source, execution = data_cache[timeframe]
            baseline_trades = run(strategy, asset, source, execution)
            baseline_full[strategy.id] = baseline_trades
            _base_train_rows, base_validation_rows, base_holdout_rows = split_trades(baseline_trades)
            baseline_validation = metrics(strategy, "baseline", "validation", base_validation_rows)
            baseline_holdout = metrics(strategy, "baseline", "holdout", base_holdout_rows)
            validation_ranked: list[tuple[float, Candidate]] = []

            for spec in specs():
                candidate_strategy = managed(strategy, spec)
                try:
                    all_trades = run(candidate_strategy, asset, source, execution)
                except Exception as error:
                    print(f"    skip {strategy.id} {spec.name}: {error}", flush=True)
                    continue
                train_rows, validation_rows, holdout_rows = split_trades(all_trades)
                train = metrics(strategy, spec.name, "train", train_rows)
                if not train_passes(train, args):
                    continue
                validation = metrics(strategy, spec.name, "validation", validation_rows)
                if not validation_passes(validation, baseline_validation, args):
                    continue
                holdout = metrics(strategy, spec.name, "holdout", holdout_rows)
                overall = metrics(strategy, spec.name, "overall", all_trades)
                candidate = Candidate(
                    strategy=strategy,
                    spec=spec,
                    baseline_validation=baseline_validation,
                    baseline_holdout=baseline_holdout,
                    train=train,
                    validation=validation,
                    holdout=holdout,
                    overall=overall,
                    trades=all_trades,
                    holdout_p_value=holdout.sign_flip_p_value,
                )
                validation_ranked.append((validation_score(validation, baseline_validation), candidate))

            if validation_ranked:
                validation_ranked.sort(key=lambda item: item[0], reverse=True)
                shortlisted.append(validation_ranked[0][1])
                best = validation_ranked[0][1]
                print(
                    f"    shortlist {strategy.id}: {best.spec.name}, validation "
                    f"{best.baseline_validation.profit_factor:.2f}->{best.validation.profit_factor:.2f}",
                    flush=True,
                )

    corrected = false_discovery(shortlisted)
    eligible = [candidate for candidate in corrected if holdout_passes(candidate, args)]
    eligible_by_id = {candidate.strategy.id: candidate for candidate in eligible}
    prior_robust_ids = stress_validated_ids()
    proposed_active_ids = prior_robust_ids.union(eligible_by_id)
    proposed_trades: list[runner.BacktestTradeRow] = []
    for strategy in strategies:
        candidate = eligible_by_id.get(strategy.id)
        if candidate is not None:
            proposed_trades.extend(candidate.trades)
        elif strategy.id in prior_robust_ids:
            proposed_trades.extend(baseline_full.get(strategy.id, []))
    baseline_trades = [
        trade
        for strategy in strategies
        if strategy.id in prior_robust_ids
        for trade in baseline_full.get(strategy.id, [])
    ]
    baseline_portfolio = portfolio_metrics(baseline_trades, assets)
    proposed_portfolio = portfolio_metrics(proposed_trades, assets)
    optimized_proposed_portfolio = optimized_portfolio(proposed_trades, assets)
    target_met = (
        optimized_proposed_portfolio["profitFactor"] >= args.min_portfolio_pf
        and optimized_proposed_portfolio["tradesPerDay"] >= args.min_trades_per_trading_day
        and optimized_proposed_portfolio["developmentPortfolio"]["profitFactor"] >= args.min_portfolio_pf
        and optimized_proposed_portfolio["sealedHoldoutPortfolio"]["profitFactor"] > 1.0
    )

    applied = bool(args.apply and target_met)
    if applied:
        for candidate in eligible:
            apply(candidate)

    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    csv_path = REPORT_ROOT / f"nested_management_{args.market}.csv"
    fields = [
        "status", "strategy_id", "asset_key", "spec", "baseline_validation_pf", "validation_pf",
        "validation_trades", "baseline_holdout_pf", "holdout_pf", "holdout_trades", "holdout_p_value",
        "holdout_q_value", "overall_pf", "overall_trades", "bootstrap_p05", "block_bootstrap_p05",
        "annual_pass_rate",
    ]
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for candidate in corrected:
            is_eligible = candidate.strategy.id in eligible_by_id
            writer.writerow({
                "status": "applied" if applied and is_eligible else "eligible" if is_eligible else "rejected",
                "strategy_id": candidate.strategy.id,
                "asset_key": candidate.strategy.asset_key,
                "spec": candidate.spec.name,
                "baseline_validation_pf": f"{candidate.baseline_validation.profit_factor:.6f}",
                "validation_pf": f"{candidate.validation.profit_factor:.6f}",
                "validation_trades": candidate.validation.trades,
                "baseline_holdout_pf": f"{candidate.baseline_holdout.profit_factor:.6f}",
                "holdout_pf": f"{candidate.holdout.profit_factor:.6f}",
                "holdout_trades": candidate.holdout.trades,
                "holdout_p_value": f"{candidate.holdout_p_value:.6f}",
                "holdout_q_value": f"{candidate.holdout_q_value:.6f}",
                "overall_pf": f"{candidate.overall.profit_factor:.6f}",
                "overall_trades": candidate.overall.trades,
                "bootstrap_p05": f"{candidate.holdout.bootstrap_pf_p05:.6f}",
                "block_bootstrap_p05": f"{candidate.holdout.block_bootstrap_pf_p05:.6f}",
                "annual_pass_rate": f"{candidate.overall.annual_pass_rate:.6f}",
            })
    summary = {
        "market": args.market,
        "strategies": len(strategies),
        "managementVariants": len(specs()),
        "shortlisted": len(shortlisted),
        "eligible": len(eligible),
        "priorStressValidatedStrategies": sum(1 for strategy in strategies if strategy.id in prior_robust_ids),
        "proposedActiveStrategyIds": sorted(
            strategy.id for strategy in strategies if strategy.id in proposed_active_ids
        ),
        "baselinePortfolio": baseline_portfolio,
        "proposedPortfolio": proposed_portfolio,
        "optimizedProposedPortfolio": optimized_proposed_portfolio,
        "target": {
            "profitFactor": args.min_portfolio_pf,
            "tradesPerDay": args.min_trades_per_trading_day,
        },
        "targetMet": target_met,
        "applied": applied,
        "sourceUrls": SOURCE_URLS,
        "method": (
            "Frozen moving-stop/target grid; 2022-2023 training; 2024 untouched validation chooses one policy per "
            "strategy; 2025+ sealed holdout with Benjamini-Hochberg, bootstrap, block-bootstrap, odd/even and annual gates. "
            "Final sizing is selected only on pre-2025 development data within a bounded 0.1x-3x box, then checked "
            "unchanged on the sealed 2025+ holdout. Application is disabled unless development and full-history PF, "
            "the Stats-tab calendar-day cadence, and positive sealed-holdout PF all clear their gates."
        ),
    }
    (REPORT_ROOT / f"nested_management_{args.market}_summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
