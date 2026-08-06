from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import sys
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path

import polars as pl


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backtest-engine"))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

import runner  # noqa: E402
import search_higher_timeframe_strategies as research  # noqa: E402


STRATEGY_ROOT = PROJECT_ROOT / "strategy"
LOADER_PATH = PROJECT_ROOT / "src" / "lib" / "strategy-loader.ts"
REPORT_ROOT = PROJECT_ROOT / "Research" / "reports"
SOURCE = "nested_walk_forward_literature_grid_2026_08"
ROUND_TRIP_COST_TICKS = 2.0
SOURCE_URLS = [
    "https://pages.stern.nyu.edu/~lpederse/papers/TimeSeriesMomentum.pdf",
    "https://www.bis.org/publ/work366.pdf",
    "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3503816",
    "https://doi.org/10.1111/1468-0262.00152",
    "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=264569",
    "https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf",
]


@dataclass(frozen=True)
class WindowPlan:
    train_start: int
    train_end: int
    validation_end: int
    holdout_end: int | None
    train_label: str
    validation_label: str
    holdout_label: str


@dataclass(frozen=True)
class WindowCandidate:
    strategy: runner.BacktestStrategy
    asset: runner.AssetConfig
    spec: research.Spec
    train: research.Metrics
    validation: research.Metrics
    holdout: research.Metrics
    overall: research.Metrics
    all_trades: list[runner.BacktestTradeRow]
    planned_rr_average: float
    planned_rr_minimum: float
    holdout_p_value: float
    holdout_q_value: float
    score: float
    train_trials: int
    validation_trials: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Nested walk-forward strategy research with a sealed final holdout.")
    parser.add_argument("--market", choices=["forex", "futures"], required=True)
    parser.add_argument("--asset", action="append", help="Optional asset key or symbol. Repeat or comma-separate.")
    parser.add_argument("--timeframe", action="append", default=["15m"], help="Analysis timeframe. Repeatable.")
    parser.add_argument("--risk-reward", default="2,3")
    parser.add_argument("--max-specs-per-asset-timeframe", type=int, default=720)
    parser.add_argument("--max-train-finalists-per-phase", type=int, default=1)
    parser.add_argument("--max-holdout-tests-per-asset", type=int, default=4)
    parser.add_argument("--max-add-per-asset", type=int, default=2)
    parser.add_argument("--max-total-additions", type=int, default=20)
    parser.add_argument("--min-train-trades", type=int, default=40)
    parser.add_argument("--min-validation-trades", type=int, default=12)
    parser.add_argument("--min-holdout-trades", type=int, default=20)
    parser.add_argument("--min-train-pf", type=float, default=1.15)
    parser.add_argument("--min-validation-pf", type=float, default=1.25)
    parser.add_argument("--min-holdout-pf", type=float, default=1.25)
    parser.add_argument("--min-overall-pf", type=float, default=1.50)
    parser.add_argument("--false-discovery-rate", type=float, default=0.10)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def utc_timestamp(value: str) -> int:
    return int(datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp())


def window_plan(market: str) -> WindowPlan:
    if market == "forex":
        return WindowPlan(
            train_start=utc_timestamp("2022-01-01"),
            train_end=utc_timestamp("2024-01-01"),
            validation_end=utc_timestamp("2025-01-01"),
            holdout_end=None,
            train_label="2022-01-01 through 2023-12-31",
            validation_label="2024-01-01 through 2024-12-31",
            holdout_label="2025-01-01 through asset latest",
        )
    return WindowPlan(
        train_start=utc_timestamp("2010-01-01"),
        train_end=utc_timestamp("2022-01-01"),
        validation_end=utc_timestamp("2024-01-01"),
        holdout_end=None,
        train_label="asset start through 2021-12-31",
        validation_label="2022-01-01 through 2023-12-31",
        holdout_label="2024-01-01 through asset latest",
    )


def parse_items(values: list[str] | None) -> set[str]:
    return {
        item.strip().lower()
        for value in values or []
        for item in value.split(",")
        if item.strip()
    }


def selected_assets(args: argparse.Namespace) -> list[runner.AssetConfig]:
    requested = parse_items(args.asset)
    return [
        asset
        for asset in runner.load_assets()
        if asset.market == args.market
        and (not requested or asset.key.lower() in requested or asset.symbol.lower() in requested)
    ]


def selected_timeframes(args: argparse.Namespace) -> list[str]:
    values = [item for raw in args.timeframe for item in raw.split(",") if item]
    return sorted(set(value for value in values if value in research.DEFAULT_TIMEFRAMES))


def metric_seed(asset: runner.AssetConfig, spec: research.Spec, suffix: str) -> int:
    return int(hashlib.sha1(f"{asset.key}|{research.canonical_variant(spec.variant_id)}|{suffix}".encode()).hexdigest()[:8], 16)


def training_atr_units(data: runner.EnrichedData, asset: runner.AssetConfig, plan: WindowPlan) -> float:
    mask = (data.times >= plan.train_start) & (data.times < plan.train_end)
    values = data.atr14[mask]
    values = values[values > 0]
    if values.shape[0] == 0 or asset.tick_size <= 0:
        return research.median_atr_units(data, asset)
    return max(2.0, float(sorted(values.tolist())[len(values) // 2]) / asset.tick_size)


def strict_trades(
    strategy: runner.BacktestStrategy,
    asset: runner.AssetConfig,
    data: runner.EnrichedData,
    execution_data: runner.EnrichedData,
    start: int,
    end: int | None,
) -> list[runner.BacktestTradeRow]:
    return runner.run_single_strategy(
        strategy,
        asset,
        data,
        start,
        end,
        strict_anti_cheat=True,
        execution_data=[("1m", execution_data)],
    )


def load_execution_data(asset: runner.AssetConfig, start: int) -> runner.EnrichedData:
    frame = runner.load_candle_csv(runner.DATA_ROOT / "1m" / asset.data_file)
    warmup_start = max(0, start - 90 * 24 * 60 * 60)
    frame = frame.filter(pl.col("time") >= warmup_start)
    return runner.build_enriched_data(frame, asset)


def metrics(trades: list[runner.BacktestTradeRow], asset: runner.AssetConfig, spec: research.Spec, suffix: str) -> research.Metrics:
    return research.metrics_for(trades, metric_seed(asset, spec, suffix), min_split_trades=3)


def fast_train_score(value: research.Metrics) -> float:
    return min(value.profit_factor, 5.0) * math.log1p(value.trades) + min(value.bootstrap_pf_p05, 3.0) * 2.0


def validation_score(train: research.Metrics, validation: research.Metrics) -> float:
    return (
        min(train.profit_factor, 4.0)
        + min(validation.profit_factor, 5.0) * 2.0
        + min(validation.bootstrap_pf_p05, 3.0) * 2.0
        + min(validation.block_bootstrap_pf_p05, 3.0)
        + math.log1p(validation.trades)
        - validation.sign_flip_p_value * 8.0
    )


def training_passes(value: research.Metrics, args: argparse.Namespace) -> bool:
    return (
        value.trades >= args.min_train_trades
        and value.profit_factor >= args.min_train_pf
        and value.total_r > 0
        and value.odd_even_min_pf > 0.90
    )


def validation_passes(value: research.Metrics, args: argparse.Namespace) -> bool:
    return (
        value.trades >= args.min_validation_trades
        and value.profit_factor >= args.min_validation_pf
        and value.total_r > 0
        and value.min_split_pf >= 0.75
        and value.bootstrap_pf_p05 >= 0.75
        and value.block_bootstrap_pf_p05 >= 0.70
        and value.odd_even_min_pf >= 0.80
        and value.sign_flip_p_value <= 0.20
    )


def holdout_passes(candidate: WindowCandidate, args: argparse.Namespace) -> bool:
    holdout = candidate.holdout
    overall = candidate.overall
    return (
        holdout.trades >= args.min_holdout_trades
        and holdout.profit_factor >= args.min_holdout_pf
        and holdout.total_r > 0
        and holdout.min_split_pf >= 0.70
        and holdout.bootstrap_pf_p05 >= 0.80
        and holdout.block_bootstrap_pf_p05 >= 0.75
        and holdout.odd_even_min_pf >= 0.80
        and candidate.holdout_q_value <= args.false_discovery_rate
        and overall.profit_factor >= args.min_overall_pf
        and overall.annual_pass_rate >= 0.60
        and candidate.planned_rr_minimum >= 1.95
        and candidate.planned_rr_average >= 2.0
    )


def benjamini_hochberg(candidates: list[WindowCandidate]) -> list[WindowCandidate]:
    if not candidates:
        return []
    ordered = sorted(candidates, key=lambda item: item.holdout_p_value)
    count = len(ordered)
    q_values = [1.0] * count
    running = 1.0
    for index in range(count - 1, -1, -1):
        rank = index + 1
        running = min(running, ordered[index].holdout_p_value * count / rank)
        q_values[index] = min(1.0, running)
    return [replace(candidate, holdout_q_value=q_values[index]) for index, candidate in enumerate(ordered)]


def load_existing_entry_times() -> dict[tuple[str, str], dict[str, list[int]]]:
    output: dict[tuple[str, str], dict[str, list[int]]] = {}
    loader = LOADER_PATH.read_text(encoding="utf-8")
    folders = re.findall(r'@strategy/([^/]+)/strategy', loader)
    for folder in folders:
        path = STRATEGY_ROOT / folder / "backtest_trades.csv"
        if not path.exists():
            continue
        with path.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                side = str(row.get("side", "")).lower()
                asset_key = str(row.get("asset_key", ""))
                if side not in {"long", "short"} or not asset_key:
                    continue
                try:
                    timestamp = research.parse_time(str(row.get("entry_time", "")))
                except (TypeError, ValueError):
                    timestamp = None
                if timestamp is not None:
                    output.setdefault((asset_key, side), {}).setdefault(folder, []).append(timestamp)
    for folders_by_key in output.values():
        for timestamps in folders_by_key.values():
            timestamps.sort()
    return output


def side_name(side: int) -> str:
    return "long" if side == 1 else "short"


def near_overlap_share(
    trades: list[runner.BacktestTradeRow],
    existing: dict[tuple[str, str], dict[str, list[int]]],
    seconds: int,
) -> float:
    if not trades:
        return 1.0
    by_folder: dict[str, int] = {}
    for trade in trades:
        for folder, timestamps in existing.get((trade.asset_key, side_name(trade.side)), {}).items():
            if any(abs(timestamp - trade.entry_time) <= seconds for timestamp in timestamps):
                by_folder[folder] = by_folder.get(folder, 0) + 1
    return max(by_folder.values(), default=0) / len(trades)


def register_candidate(candidate: WindowCandidate, existing: dict[tuple[str, str], dict[str, list[int]]]) -> None:
    for trade in candidate.all_trades:
        existing.setdefault((trade.asset_key, side_name(trade.side)), {}).setdefault(candidate.strategy.folder, []).append(trade.entry_time)


def research_asset_timeframe(
    asset: runner.AssetConfig,
    timeframe: str,
    plan: WindowPlan,
    args: argparse.Namespace,
) -> tuple[list[WindowCandidate], int, int]:
    if not research.data_exists(asset, timeframe):
        return [], 0, 0
    if not (runner.DATA_ROOT / "1m" / asset.data_file).exists():
        return [], 0, 0
    data = research.load_enriched(asset, timeframe, {})
    execution_data = load_execution_data(asset, plan.train_start)
    atr_units = training_atr_units(data, asset, plan)
    specs = research.build_specs(timeframe, atr_units, research.parse_rr(args.risk_reward), args.max_specs_per_asset_timeframe)
    existing_keys = research.existing_variant_keys()
    train_by_phase: dict[str, list[tuple[float, runner.BacktestStrategy, research.Spec, research.Metrics]]] = {}
    train_trials = 0

    for spec in specs:
        if (asset.key, research.canonical_variant(spec.variant_id)) in existing_keys:
            continue
        strategy = replace(research.build_strategy(asset, spec), source=SOURCE, cost_units=ROUND_TRIP_COST_TICKS)
        trades = runner.run_single_strategy(strategy, asset, data, plan.train_start, plan.train_end, strict_anti_cheat=False)
        value = metrics(trades, asset, spec, "train_fast")
        train_trials += 1
        if not training_passes(value, args):
            continue
        train_by_phase.setdefault(spec.phase, []).append((fast_train_score(value), strategy, spec, value))

    train_finalists: list[tuple[runner.BacktestStrategy, research.Spec, research.Metrics]] = []
    for rows in train_by_phase.values():
        rows.sort(key=lambda item: item[0], reverse=True)
        for _score, strategy, spec, _fast_value in rows[: args.max_train_finalists_per_phase]:
            strict_train = metrics(strict_trades(strategy, asset, data, execution_data, plan.train_start, plan.train_end), asset, spec, "train_strict")
            if training_passes(strict_train, args):
                train_finalists.append((strategy, spec, strict_train))

    validation_rows: list[tuple[float, runner.BacktestStrategy, research.Spec, research.Metrics, research.Metrics]] = []
    validation_trials = 0
    for strategy, spec, train_value in train_finalists:
        validation_value = metrics(
            strict_trades(strategy, asset, data, execution_data, plan.train_end, plan.validation_end),
            asset,
            spec,
            "validation",
        )
        validation_trials += 1
        if validation_passes(validation_value, args):
            validation_rows.append((validation_score(train_value, validation_value), strategy, spec, train_value, validation_value))

    validation_rows.sort(key=lambda item: item[0], reverse=True)
    holdout_rows: list[WindowCandidate] = []
    for score, strategy, spec, train_value, validation_value in validation_rows[: args.max_holdout_tests_per_asset]:
        holdout_trades = strict_trades(strategy, asset, data, execution_data, plan.validation_end, plan.holdout_end)
        holdout_value = metrics(holdout_trades, asset, spec, "holdout")
        train_trades = strict_trades(strategy, asset, data, execution_data, plan.train_start, plan.train_end)
        validation_trades = strict_trades(strategy, asset, data, execution_data, plan.train_end, plan.validation_end)
        out_of_sample_trades = sorted([*validation_trades, *holdout_trades], key=lambda trade: (trade.entry_time, trade.exit_time))
        overall_value = metrics(out_of_sample_trades, asset, spec, "overall_out_of_sample")
        avg_rr, min_rr = research.planned_rr(out_of_sample_trades)
        holdout_rows.append(
            WindowCandidate(
                strategy=strategy,
                asset=asset,
                spec=spec,
                train=train_value,
                validation=validation_value,
                holdout=holdout_value,
                overall=overall_value,
                all_trades=out_of_sample_trades,
                planned_rr_average=avg_rr,
                planned_rr_minimum=min_rr,
                holdout_p_value=holdout_value.sign_flip_p_value,
                holdout_q_value=1.0,
                score=score + min(holdout_value.profit_factor, 5.0) * 2.0 + math.log1p(holdout_value.trades),
                train_trials=train_trials,
                validation_trials=validation_trials,
            )
        )
    return holdout_rows, train_trials, validation_trials


def write_strategy_ts(path: Path, candidate: WindowCandidate) -> None:
    evaluator, module_path = research.EVALUATORS[candidate.spec.phase]
    path.write_text(
        f'''import {{ createStrategyDefinition, runtimeDefaultsFromMetadata }} from "@/lib/strategy-definition";
import {{ {evaluator} }} from "{module_path}";
import selection from "./parameters/backtest.json";

export default createStrategyDefinition({{
  id: "{candidate.strategy.id}",
  label: "{candidate.strategy.label}",
  folder: "{candidate.strategy.folder}",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "{candidate.asset.key}",
  phase: "{candidate.strategy.phase}",
  liveEnabled: true,
  evaluator: {evaluator},
  defaults: runtimeDefaultsFromMetadata(selection)
}});
''',
        encoding="utf-8",
    )


def metric_payload(value: research.Metrics) -> dict[str, float | int]:
    return {
        "trades": value.trades,
        "profitFactor": research.json_metric(value.profit_factor),
        "totalR": round(value.total_r, 6),
        "maxDrawdownR": round(value.max_drawdown_r, 6),
        "minimumChronologicalSplitPf": research.json_metric(value.min_split_pf),
        "bootstrapPfP05": research.json_metric(value.bootstrap_pf_p05),
        "blockBootstrapPfP05": research.json_metric(value.block_bootstrap_pf_p05),
        "oddEvenMinimumPf": research.json_metric(value.odd_even_min_pf),
        "annualPassRate": round(value.annual_pass_rate, 6),
        "signFlipPValue": round(value.sign_flip_p_value, 6),
    }


def materialize(candidate: WindowCandidate, plan: WindowPlan) -> None:
    strategy_dir = STRATEGY_ROOT / candidate.strategy.folder
    metadata_dir = strategy_dir / "parameters"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    write_strategy_ts(strategy_dir / "strategy.ts", candidate)
    payload = {
        "strategyId": candidate.strategy.id,
        "label": candidate.strategy.label,
        "folder": candidate.strategy.folder,
        "assetKey": candidate.asset.key,
        "phase": candidate.strategy.phase,
        "variantId": candidate.strategy.variant_id,
        "source": SOURCE,
        "sourceUrls": SOURCE_URLS,
        "researchSummary": candidate.spec.summary,
        "selectionMethod": (
            "Literature-motivated immutable grid; fast ranking used only inside the training window. "
            "Strict anti-cheat replay then qualified an untouched chronological validation window before "
            "a sealed final holdout. Holdout sign-flip p-values were Benjamini-Hochberg corrected across "
            "all finalists. Ordinary and block bootstrap, odd/even, annual, split, duplicate-entry, "
            "realized-bracket and two-tick round-trip friction gates were also required."
        ),
        "windowPlan": {
            "training": plan.train_label,
            "validation": plan.validation_label,
            "holdout": plan.holdout_label,
        },
        "trialAccounting": {
            "trainingGridTrialsForAssetTimeframe": candidate.train_trials,
            "validationFinalistsForAssetTimeframe": candidate.validation_trials,
            "holdoutPValue": round(candidate.holdout_p_value, 6),
            "holdoutFalseDiscoveryRateQValue": round(candidate.holdout_q_value, 6),
        },
        "trainingMetrics": metric_payload(candidate.train),
        "validationMetrics": metric_payload(candidate.validation),
        "holdoutMetrics": metric_payload(candidate.holdout),
        "overallMetrics": metric_payload(candidate.overall),
        "selectedTrainingProfitFactor": research.json_metric(candidate.train.profit_factor),
        "selectedTrainingTrades": candidate.train.trades,
        "selectedForwardProfitFactor": research.json_metric(candidate.holdout.profit_factor),
        "selectedForwardTrades": candidate.holdout.trades,
        "forwardTotalR": round(candidate.holdout.total_r, 6),
        "minimumRiskReward": 2.0,
        "selectedRiskReward": round(candidate.planned_rr_average, 6),
        "costUnits": ROUND_TRIP_COST_TICKS,
        "oneTradePerDay": True,
        "verificationSummary": (
            f"Strict nested walk-forward: train PF {candidate.train.profit_factor:.2f} ({candidate.train.trades}), "
            f"validation PF {candidate.validation.profit_factor:.2f} ({candidate.validation.trades}), "
            f"sealed holdout PF {candidate.holdout.profit_factor:.2f} ({candidate.holdout.trades}), "
            f"holdout q={candidate.holdout_q_value:.3f}, overall PF {candidate.overall.profit_factor:.2f}; "
            f"two-tick round-trip friction and normal engine exits included."
        ),
    }
    if candidate.spec.tp_units is not None:
        payload["tpUnits"] = round(candidate.spec.tp_units, 6)
    if candidate.spec.sl_units is not None:
        payload["slUnits"] = round(candidate.spec.sl_units, 6)
    if candidate.spec.phase == "ict_sweep_fvg":
        payload["ictRiskReward"] = candidate.spec.risk_reward
    (metadata_dir / "backtest.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    runner.write_strategy_backtest_csv(strategy_dir / "backtest_trades.csv", candidate.all_trades)


def update_loader(candidates: list[WindowCandidate]) -> None:
    if not candidates:
        return
    text = LOADER_PATH.read_text(encoding="utf-8")
    existing_folders = set(re.findall(r'@strategy/([^/]+)/strategy', text))
    additions = [candidate for candidate in candidates if candidate.strategy.folder not in existing_folders]
    if not additions:
        return
    indexes = [int(value) for value in re.findall(r"strategy(\d{3})", text)]
    next_index = max(indexes, default=-1) + 1
    imports: list[str] = []
    items: list[str] = []
    for offset, candidate in enumerate(additions):
        identifier = f"strategy{next_index + offset:03d}"
        imports.append(f'import {identifier} from "@strategy/{candidate.strategy.folder}/strategy";')
        items.append(f"  {identifier}")
    insert_at = text.index("\nimport type { StrategyDefinition }")
    text = text[:insert_at] + "\n" + "\n".join(imports) + text[insert_at:]
    array_end = text.rfind("\n];")
    if array_end < 0:
        raise ValueError("Could not locate strategy array")
    prefix = "," if re.search(r"strategy\d{3}\s*$", text[:array_end]) else ""
    text = text[:array_end] + prefix + "\n" + ",\n".join(items) + text[array_end:]
    LOADER_PATH.write_text(text, encoding="utf-8")


def write_report(candidates: list[WindowCandidate], selected: list[WindowCandidate], args: argparse.Namespace) -> None:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    selected_ids = {candidate.strategy.id for candidate in selected}
    path = REPORT_ROOT / f"nested_walk_forward_{args.market}.csv"
    fields = [
        "status", "strategy_id", "asset_key", "timeframe", "phase", "train_pf", "train_trades",
        "validation_pf", "validation_trades", "holdout_pf", "holdout_trades", "holdout_p_value",
        "holdout_q_value", "overall_pf", "overall_trades", "overall_bootstrap_p05",
        "overall_block_bootstrap_p05", "annual_pass_rate", "planned_rr_minimum", "train_trials",
        "validation_trials", "variant_id",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for candidate in sorted(candidates, key=lambda item: item.score, reverse=True):
            writer.writerow({
                "status": "selected" if candidate.strategy.id in selected_ids else "rejected",
                "strategy_id": candidate.strategy.id,
                "asset_key": candidate.asset.key,
                "timeframe": candidate.spec.timeframe,
                "phase": candidate.spec.phase,
                "train_pf": f"{candidate.train.profit_factor:.6f}",
                "train_trades": candidate.train.trades,
                "validation_pf": f"{candidate.validation.profit_factor:.6f}",
                "validation_trades": candidate.validation.trades,
                "holdout_pf": f"{candidate.holdout.profit_factor:.6f}",
                "holdout_trades": candidate.holdout.trades,
                "holdout_p_value": f"{candidate.holdout_p_value:.6f}",
                "holdout_q_value": f"{candidate.holdout_q_value:.6f}",
                "overall_pf": f"{candidate.overall.profit_factor:.6f}",
                "overall_trades": candidate.overall.trades,
                "overall_bootstrap_p05": f"{candidate.overall.bootstrap_pf_p05:.6f}",
                "overall_block_bootstrap_p05": f"{candidate.overall.block_bootstrap_pf_p05:.6f}",
                "annual_pass_rate": f"{candidate.overall.annual_pass_rate:.6f}",
                "planned_rr_minimum": f"{candidate.planned_rr_minimum:.6f}",
                "train_trials": candidate.train_trials,
                "validation_trials": candidate.validation_trials,
                "variant_id": candidate.strategy.variant_id,
            })


def main() -> int:
    args = parse_args()
    plan = window_plan(args.market)
    assets = selected_assets(args)
    timeframes = selected_timeframes(args)
    if not assets or not timeframes:
        raise ValueError("No matching assets or timeframes")

    print(f"Nested walk-forward research: {args.market}, {len(assets)} assets, timeframes={timeframes}")
    holdout_candidates: list[WindowCandidate] = []
    total_train_trials = 0
    total_validation_trials = 0
    for asset in assets:
        for timeframe in timeframes:
            print(f"  {asset.key} {timeframe}", flush=True)
            rows, train_trials, validation_trials = research_asset_timeframe(asset, timeframe, plan, args)
            holdout_candidates.extend(rows)
            total_train_trials += train_trials
            total_validation_trials += validation_trials
            print(f"    train trials={train_trials}, validation finalists={validation_trials}, holdout tests={len(rows)}", flush=True)

    corrected = benjamini_hochberg(holdout_candidates)
    eligible = [candidate for candidate in corrected if holdout_passes(candidate, args)]
    eligible.sort(key=lambda item: item.score, reverse=True)
    existing_entries = load_existing_entry_times()
    selected: list[WindowCandidate] = []
    selected_per_asset: dict[str, int] = {}
    for candidate in eligible:
        if len(selected) >= args.max_total_additions:
            break
        if selected_per_asset.get(candidate.asset.key, 0) >= args.max_add_per_asset:
            continue
        near_seconds = max(15 * 60, research.TIMEFRAME_SECONDS.get(candidate.spec.timeframe, 0))
        if near_overlap_share(candidate.all_trades, existing_entries, near_seconds) >= 0.80:
            continue
        selected.append(candidate)
        selected_per_asset[candidate.asset.key] = selected_per_asset.get(candidate.asset.key, 0) + 1
        register_candidate(candidate, existing_entries)

    write_report(corrected, selected, args)
    print(
        f"Completed {total_train_trials} frozen-grid training trials, {total_validation_trials} validation finalists, "
        f"and {len(holdout_candidates)} sealed holdout tests. Selected {len(selected)} strategies."
    )
    for candidate in selected:
        print(
            f"  {candidate.strategy.id}: train {candidate.train.profit_factor:.2f}/{candidate.train.trades}, "
            f"validation {candidate.validation.profit_factor:.2f}/{candidate.validation.trades}, "
            f"holdout {candidate.holdout.profit_factor:.2f}/{candidate.holdout.trades}, "
            f"q={candidate.holdout_q_value:.3f}, overall {candidate.overall.profit_factor:.2f}/{candidate.overall.trades}"
        )

    if not args.dry_run:
        for candidate in selected:
            materialize(candidate, plan)
        update_loader(selected)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
