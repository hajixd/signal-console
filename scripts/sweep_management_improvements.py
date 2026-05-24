from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import random
import sys
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backtest-engine"))

import runner  # noqa: E402


REPORT_ROOT = PROJECT_ROOT / "Research" / "reports"
FORWARD_START_TS = runner.BACKTEST_START_TS


@dataclass(frozen=True)
class Metrics:
    trades: int
    profit_factor: float
    total_r: float
    wins: int
    losses: int
    max_drawdown_r: float
    min_split_trades: int
    min_split_pf: float


@dataclass(frozen=True)
class CandidateSpec:
    name: str
    dynamic_stop_loss_policy: runner.DynamicStopLossPolicy | None = None
    dynamic_take_profit_policy: runner.DynamicTakeProfitPolicy | None = None
    take_profit_policy: runner.TakeProfitPolicy | None = None


@dataclass(frozen=True)
class Improvement:
    strategy: runner.BacktestStrategy
    spec: CandidateSpec
    baseline: Metrics
    forward: Metrics
    train: Metrics
    trades: list[runner.BacktestTradeRow]
    bootstrap_p05: float
    block_bootstrap_p05: float
    odd_even_min_pf: float
    annual_pass_rate: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sweep trailing/breakeven management variants and promote PF wins only.")
    parser.add_argument("--asset", action="append", help="Optional asset key or symbol filter. Repeat or comma-separate.")
    parser.add_argument("--strategy", action="append", help="Optional strategy id/folder filter. Repeat or comma-separate.")
    parser.add_argument("--market", choices=["all", "forex", "futures"], default="all")
    parser.add_argument("--skip-strategies", type=int, default=0, help="Skip this many strategies after filtering.")
    parser.add_argument("--max-strategies", type=int, default=0, help="Limit strategies after filtering. 0 means all.")
    parser.add_argument("--min-forward-trades", type=int, default=30)
    parser.add_argument("--min-train-trades", type=int, default=12)
    parser.add_argument("--min-train-pf", type=float, default=0.75)
    parser.add_argument("--min-split-trades", type=int, default=8)
    parser.add_argument("--min-split-pf", type=float, default=0.75)
    parser.add_argument("--min-bootstrap-p05", type=float, default=0.75)
    parser.add_argument("--min-block-bootstrap-p05", type=float, default=0.70)
    parser.add_argument("--min-odd-even-pf", type=float, default=0.70)
    parser.add_argument("--min-annual-pass-rate", type=float, default=0.45)
    parser.add_argument("--min-pf-improvement", type=float, default=0.01)
    parser.add_argument("--max-candidates-per-strategy", type=int, default=14)
    parser.add_argument("--report-prefix", default="management_improvement_sweep")
    parser.add_argument("--apply", action="store_true")
    return parser.parse_args()


def profit_factor(values: Iterable[float]) -> float:
    vals = list(values)
    gross_profit = sum(value for value in vals if value > 0)
    gross_loss = sum(abs(value) for value in vals if value < 0)
    if gross_loss == 0:
        return math.inf if gross_profit > 0 else 0.0
    return gross_profit / gross_loss


def max_drawdown(values: Iterable[float]) -> float:
    equity = 0.0
    peak = 0.0
    drawdown = 0.0
    for value in values:
        equity += value
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
    return drawdown


def split_values(values: list[float], parts: int = 4) -> list[list[float]]:
    if not values:
        return [[]]
    cuts = [math.ceil(len(values) * index / parts) for index in range(1, parts)]
    output: list[list[float]] = []
    start = 0
    for cut in [*cuts, len(values)]:
        output.append(values[start:cut])
        start = cut
    return output


def metrics_for(trades: list[runner.BacktestTradeRow]) -> Metrics:
    ordered = sorted(trades, key=lambda trade: (trade.entry_time, trade.strategy_id))
    values = [float(trade.r_multiple) for trade in ordered]
    splits = [split for split in split_values(values) if split]
    return Metrics(
        trades=len(values),
        profit_factor=profit_factor(values),
        total_r=sum(values),
        wins=sum(1 for value in values if value > 0),
        losses=sum(1 for value in values if value < 0),
        max_drawdown_r=max_drawdown(values),
        min_split_trades=min((len(split) for split in splits), default=0),
        min_split_pf=min((profit_factor(split) for split in splits), default=0.0),
    )


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * pct) - 1))
    return ordered[index]


def bootstrap_pf_p05(values: list[float], seed: int, samples: int = 220) -> float:
    if not values:
        return 0.0
    rng = random.Random(seed)
    return percentile([profit_factor([values[rng.randrange(len(values))] for _ in values]) for _ in range(samples)], 0.05)


def block_bootstrap_pf_p05(values: list[float], seed: int, samples: int = 140, block_size: int = 5) -> float:
    if not values:
        return 0.0
    rng = random.Random(seed)
    pfs: list[float] = []
    for _ in range(samples):
        draw: list[float] = []
        while len(draw) < len(values):
            start = rng.randrange(len(values))
            draw.extend(values[start : start + block_size])
            if start + block_size > len(values):
                draw.extend(values[: (start + block_size) % len(values)])
        pfs.append(profit_factor(draw[: len(values)]))
    return percentile(pfs, 0.05)


def annual_pass_rate(trades: list[runner.BacktestTradeRow]) -> float:
    by_year: dict[str, list[float]] = {}
    for trade in trades:
        by_year.setdefault(runner.iso_time(trade.entry_time)[:4], []).append(float(trade.r_multiple))
    tested = [profit_factor(values) for values in by_year.values() if len(values) >= 5]
    if not tested:
        return 0.0
    return sum(1 for value in tested if value > 1.0) / len(tested)


def finite_metric(value: float) -> float:
    if math.isinf(value):
        return 999.0
    if math.isnan(value):
        return 0.0
    return round(value, 6)


def candidate_specs(limit: int) -> list[CandidateSpec]:
    specs: list[CandidateSpec] = []
    for buffer_units in (0, 1, 2, 4):
        specs.append(
            CandidateSpec(
                name=f"be_trail_prior_bar_b{buffer_units}",
                dynamic_stop_loss_policy=runner.DynamicStopLossPolicy("trail_prior_bar", float(buffer_units)),
            )
        )
    for buffer_units in (0, 2, 4):
        specs.append(
            CandidateSpec(
                name=f"be_trail_hourly_pivot_b{buffer_units}",
                dynamic_stop_loss_policy=runner.DynamicStopLossPolicy("trail_hourly_pivot", float(buffer_units)),
            )
        )
    for buffer_units in (0, 2):
        specs.append(
            CandidateSpec(
                name=f"trail_tp_prior_bar_b{buffer_units}",
                dynamic_take_profit_policy=runner.DynamicTakeProfitPolicy("trail_prior_bar", float(buffer_units), None),
            )
        )
        specs.append(
            CandidateSpec(
                name=f"trail_tp_hourly_extreme_b{buffer_units}",
                dynamic_take_profit_policy=runner.DynamicTakeProfitPolicy("trail_hourly_extreme", float(buffer_units), None),
            )
        )
    for buffer_units in (0, 2):
        for reward_multiple in (2.0, 3.0, 4.0):
            specs.append(
                CandidateSpec(
                    name=f"be_trail_prior_b{buffer_units}_tp_{reward_multiple:g}r",
                    dynamic_stop_loss_policy=runner.DynamicStopLossPolicy("trail_prior_bar", float(buffer_units)),
                    dynamic_take_profit_policy=runner.DynamicTakeProfitPolicy("risk_multiple", 0.0, reward_multiple),
                )
            )
    for reward_multiple in (2.0, 3.0, 4.0, 5.0):
        specs.append(
            CandidateSpec(
                name=f"static_tp_{reward_multiple:g}r",
                take_profit_policy=runner.TakeProfitPolicy("risk_multiple", 0.0, reward_multiple),
            )
        )
    return specs[: max(1, limit)]


def data_for(
    strategy: runner.BacktestStrategy,
    assets: dict[str, runner.AssetConfig],
    cache: dict[tuple[str, str], runner.EnrichedData],
) -> tuple[runner.AssetConfig, runner.EnrichedData, runner.EnrichedData | None]:
    asset = assets[strategy.asset_key]
    timeframe = runner.strategy_timeframe(strategy)
    cache_key = (asset.key, timeframe)
    if cache_key not in cache:
        cache[cache_key] = runner.build_enriched_data(
            runner.load_candle_csv(runner.DATA_ROOT / timeframe / asset.data_file),
            asset,
        )
    execution_data = None
    execution_timeframe = runner.strategy_execution_timeframe(strategy)
    if execution_timeframe is not None:
        execution_key = (asset.key, execution_timeframe)
        if execution_key not in cache:
            cache[execution_key] = runner.build_enriched_data(
                runner.load_candle_csv(runner.DATA_ROOT / execution_timeframe / asset.data_file),
                asset,
            )
        execution_data = cache[execution_key]
    return asset, cache[cache_key], execution_data


def run_strategy(
    strategy: runner.BacktestStrategy,
    asset: runner.AssetConfig,
    data: runner.EnrichedData,
    execution_data: runner.EnrichedData | None,
    start_ts: int,
    end_ts: int | None,
) -> list[runner.BacktestTradeRow]:
    return runner.run_single_strategy(
        strategy,
        asset,
        data,
        start_ts=start_ts,
        end_ts=end_ts,
        strict_anti_cheat=True,
        execution_data=execution_data,
    )


def build_candidate(strategy: runner.BacktestStrategy, spec: CandidateSpec) -> runner.BacktestStrategy:
    return replace(
        strategy,
        dynamic_stop_loss_policy=spec.dynamic_stop_loss_policy,
        dynamic_take_profit_policy=spec.dynamic_take_profit_policy,
        take_profit_policy=spec.take_profit_policy or strategy.take_profit_policy,
    )


def passes_gates(forward: Metrics, baseline: Metrics, train: Metrics, values: list[float], trades: list[runner.BacktestTradeRow], args: argparse.Namespace, seed: int) -> tuple[bool, float, float, float, float]:
    if train.trades < args.min_train_trades or train.profit_factor < args.min_train_pf:
        return False, 0.0, 0.0, 0.0, 0.0
    boot = bootstrap_pf_p05(values, seed)
    block = block_bootstrap_pf_p05(values, seed ^ 0xA5A5A5A5)
    odd_even = min(profit_factor(values[::2]), profit_factor(values[1::2]))
    annual = annual_pass_rate(trades)
    return (
        boot >= args.min_bootstrap_p05
        and block >= args.min_block_bootstrap_p05
        and odd_even >= args.min_odd_even_pf
        and annual >= args.min_annual_pass_rate,
        boot,
        block,
        odd_even,
        annual,
    )


def passes_forward_gate(forward: Metrics, baseline: Metrics, args: argparse.Namespace) -> bool:
    return (
        forward.trades >= args.min_forward_trades
        and forward.profit_factor > baseline.profit_factor + args.min_pf_improvement
        and forward.min_split_trades >= args.min_split_trades
        and forward.min_split_pf >= args.min_split_pf
    )


def score(improvement: Improvement) -> float:
    pf_gain = improvement.forward.profit_factor - improvement.baseline.profit_factor
    return (
        min(pf_gain, 10) * 20
        + min(improvement.forward.profit_factor, 20) * 3
        + math.log1p(improvement.forward.trades) * 2
        + min(improvement.bootstrap_p05, 5)
        + min(improvement.block_bootstrap_p05, 5)
        + min(improvement.odd_even_min_pf, 5)
    )


def select_strategies(args: argparse.Namespace) -> list[runner.BacktestStrategy]:
    requested = {item.lower() for raw in args.asset or [] for item in raw.split(",") if item.strip()}
    requested_strategies = {item.lower() for raw in args.strategy or [] for item in raw.split(",") if item.strip()}
    assets = runner.load_asset_by_key()
    strategies = [
        strategy
        for strategy in runner.selected_backtest_strategies()
        if strategy.metadata_path is not None
        and strategy.asset_key in assets
        and (args.market == "all" or assets[strategy.asset_key].market == args.market)
        and (not requested or strategy.asset_key.lower() in requested or assets[strategy.asset_key].symbol.lower() in requested)
        and (
            not requested_strategies
            or strategy.id.lower() in requested_strategies
            or strategy.folder.lower() in requested_strategies
        )
    ]
    offset = max(0, args.skip_strategies)
    selected = strategies[offset:]
    return selected[: args.max_strategies] if args.max_strategies > 0 else selected


def apply_improvement(improvement: Improvement) -> None:
    strategy = improvement.strategy
    if strategy.metadata_path is None:
        return
    payload = json.loads(strategy.metadata_path.read_text(encoding="utf-8"))
    if improvement.spec.dynamic_stop_loss_policy is None:
        payload.pop("dynamicStopLossPolicy", None)
    else:
        payload["dynamicStopLossPolicy"] = {
            "mode": improvement.spec.dynamic_stop_loss_policy.mode,
            "bufferUnits": improvement.spec.dynamic_stop_loss_policy.buffer_units,
        }
    if improvement.spec.dynamic_take_profit_policy is None:
        payload.pop("dynamicTakeProfitPolicy", None)
    else:
        payload["dynamicTakeProfitPolicy"] = {
            "mode": improvement.spec.dynamic_take_profit_policy.mode,
            "bufferUnits": improvement.spec.dynamic_take_profit_policy.buffer_units,
        }
        if improvement.spec.dynamic_take_profit_policy.reward_multiple is not None:
            payload["dynamicTakeProfitPolicy"]["rewardMultiple"] = improvement.spec.dynamic_take_profit_policy.reward_multiple
    if improvement.spec.take_profit_policy is not None:
        payload["takeProfitPolicy"] = {
            "mode": improvement.spec.take_profit_policy.mode,
            "bufferUnits": improvement.spec.take_profit_policy.buffer_units,
            "rewardMultiple": improvement.spec.take_profit_policy.reward_multiple,
        }
    payload["selectedTrainingProfitFactor"] = finite_metric(improvement.train.profit_factor)
    payload["selectedTrainingTrades"] = improvement.train.trades
    payload["selectedForwardProfitFactor"] = finite_metric(improvement.forward.profit_factor)
    payload["selectedForwardTrades"] = improvement.forward.trades
    payload["forwardWins"] = improvement.forward.wins
    payload["forwardLosses"] = improvement.forward.losses
    payload["forwardTotalR"] = round(improvement.forward.total_r, 6)
    payload["forwardAverageR"] = round(improvement.forward.total_r / improvement.forward.trades if improvement.forward.trades else 0.0, 6)
    payload["forwardMaxDrawdownR"] = round(improvement.forward.max_drawdown_r, 6)
    payload["selectionMethod"] = (
        f"{payload.get('selectionMethod', 'Strategy selection')} Management sweep promoted "
        f"`{improvement.spec.name}` only after strict forward PF improved from "
        f"{improvement.baseline.profit_factor:.2f} to {improvement.forward.profit_factor:.2f}."
    )
    payload["verificationSummary"] = (
        f"Management sweep `{improvement.spec.name}` strict PF {improvement.forward.profit_factor:.2f} "
        f"over {improvement.forward.trades} trades, beating baseline PF {improvement.baseline.profit_factor:.2f}; "
        f"train PF {improvement.train.profit_factor:.2f}, bootstrap p05 {improvement.bootstrap_p05:.2f}, "
        f"block-bootstrap p05 {improvement.block_bootstrap_p05:.2f}, odd/even min PF {improvement.odd_even_min_pf:.2f}, "
        f"annual pass rate {improvement.annual_pass_rate:.0%}."
    )
    strategy.metadata_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    runner.write_strategy_backtest_csv(PROJECT_ROOT / "strategy" / strategy.folder / "backtest_trades.csv", improvement.trades)


def write_report(improvements: list[Improvement], args: argparse.Namespace) -> None:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    csv_path = REPORT_ROOT / f"{args.report_prefix}.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "status",
                "strategy_id",
                "asset_key",
                "spec",
                "baseline_pf",
                "forward_pf",
                "pf_gain",
                "forward_trades",
                "train_pf",
                "train_trades",
                "bootstrap_p05",
                "block_bootstrap_p05",
                "odd_even_min_pf",
                "annual_pass_rate",
            ],
        )
        writer.writeheader()
        for improvement in improvements:
            writer.writerow(
                {
                    "status": "applied" if args.apply else "selected",
                    "strategy_id": improvement.strategy.id,
                    "asset_key": improvement.strategy.asset_key,
                    "spec": improvement.spec.name,
                    "baseline_pf": f"{improvement.baseline.profit_factor:.6f}",
                    "forward_pf": f"{improvement.forward.profit_factor:.6f}",
                    "pf_gain": f"{improvement.forward.profit_factor - improvement.baseline.profit_factor:.6f}",
                    "forward_trades": improvement.forward.trades,
                    "train_pf": f"{improvement.train.profit_factor:.6f}",
                    "train_trades": improvement.train.trades,
                    "bootstrap_p05": f"{improvement.bootstrap_p05:.6f}",
                    "block_bootstrap_p05": f"{improvement.block_bootstrap_p05:.6f}",
                    "odd_even_min_pf": f"{improvement.odd_even_min_pf:.6f}",
                    "annual_pass_rate": f"{improvement.annual_pass_rate:.6f}",
                }
            )
    md_path = REPORT_ROOT / f"{args.report_prefix}.md"
    lines = [
        "# Management Improvement Sweep",
        "",
        f"- Status: {'applied' if args.apply else 'dry run'}",
        f"- Qualified improvements: {len(improvements)}",
        "",
        "| Strategy | Asset | Spec | Baseline PF | New PF | Trades | Train PF | Boot p05 | Block p05 | Odd/Even PF |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for improvement in improvements:
        lines.append(
            f"| `{improvement.strategy.id}` | {improvement.strategy.asset_key} | `{improvement.spec.name}` | "
            f"{improvement.baseline.profit_factor:.3f} | {improvement.forward.profit_factor:.3f} | "
            f"{improvement.forward.trades} | {improvement.train.profit_factor:.3f} | "
            f"{improvement.bootstrap_p05:.3f} | {improvement.block_bootstrap_p05:.3f} | {improvement.odd_even_min_pf:.3f} |"
        )
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"report={csv_path.relative_to(PROJECT_ROOT)}", flush=True)
    print(f"markdown={md_path.relative_to(PROJECT_ROOT)}", flush=True)


def main() -> int:
    args = parse_args()
    assets = runner.load_asset_by_key()
    strategies = select_strategies(args)
    specs = candidate_specs(args.max_candidates_per_strategy)
    cache: dict[tuple[str, str], runner.EnrichedData] = {}
    improvements: list[Improvement] = []
    print(f"Scanning {len(strategies)} strategy(ies) with {len(specs)} management variant(s)", flush=True)

    for index, strategy in enumerate(strategies, start=1):
        asset, data, execution_data = data_for(strategy, assets, cache)
        baseline_trades = run_strategy(strategy, asset, data, execution_data, FORWARD_START_TS, None)
        baseline = metrics_for(baseline_trades)
        best: Improvement | None = None
        for spec in specs:
            candidate = build_candidate(strategy, spec)
            try:
                forward_trades = run_strategy(candidate, asset, data, execution_data, FORWARD_START_TS, None)
            except Exception:
                continue
            forward = metrics_for(forward_trades)
            if not passes_forward_gate(forward, baseline, args):
                continue
            try:
                train_trades = run_strategy(candidate, asset, data, execution_data, 0, FORWARD_START_TS)
            except Exception:
                continue
            train = metrics_for(train_trades)
            values = [float(trade.r_multiple) for trade in forward_trades]
            seed = int(hashlib.sha1(f"{strategy.id}|{spec.name}".encode("utf-8")).hexdigest()[:8], 16)
            ok, boot, block, odd_even, annual = passes_gates(forward, baseline, train, values, forward_trades, args, seed)
            if not ok:
                continue
            improvement = Improvement(strategy, spec, baseline, forward, train, forward_trades, boot, block, odd_even, annual)
            if best is None or score(improvement) > score(best):
                best = improvement
        if best is not None:
            improvements.append(best)
            print(
                f"  [{index}/{len(strategies)}] improve {strategy.id}: "
                f"PF {best.baseline.profit_factor:.3f} -> {best.forward.profit_factor:.3f} via {best.spec.name}",
                flush=True,
            )
        elif index % 10 == 0:
            print(f"  [{index}/{len(strategies)}] scanned; qualified={len(improvements)}", flush=True)

    improvements = sorted(improvements, key=score, reverse=True)
    if args.apply:
        for improvement in improvements:
            apply_improvement(improvement)
    write_report(improvements, args)
    print(f"qualified={len(improvements)} applied={args.apply}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
