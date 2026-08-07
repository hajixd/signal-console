from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, replace
from pathlib import Path

import polars as pl


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backtest-engine"))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

import runner  # noqa: E402
import research_competition_session_candidates as session  # noqa: E402
import research_nested_walk_forward_strategies as nested  # noqa: E402
import search_dynamic_range_additions as dynamic_range  # noqa: E402
import search_higher_timeframe_strategies as statistics  # noqa: E402


STRATEGY_ROOT = PROJECT_ROOT / "strategy"
LOADER_PATH = PROJECT_ROOT / "src" / "lib" / "strategy-loader.ts"
REPORT_ROOT = PROJECT_ROOT / "Research" / "reports"
SOURCE = "nested_session_walk_forward_2026_08"
ROUND_TRIP_COST_TICKS = 2.0
SOURCE_URLS = [
    "https://pages.stern.nyu.edu/~lpederse/papers/TimeSeriesMomentum.pdf",
    "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3489539",
    "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2140091",
    "https://www.bis.org/publ/work366.pdf",
    "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3503816",
    "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=712168",
    "https://doi.org/10.1111/1468-0262.00152",
    "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=264569",
    "https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf",
]


@dataclass(frozen=True)
class Candidate:
    strategy: runner.BacktestStrategy
    asset: runner.AssetConfig
    spec: session.VariantSpec
    train: statistics.Metrics
    validation: statistics.Metrics
    holdout: statistics.Metrics
    overall: statistics.Metrics
    trades: list[runner.BacktestTradeRow]
    entry_parity: float
    holdout_p_value: float
    holdout_q_value: float
    score: float
    train_trials: int
    validation_trials: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Research high-cadence session strategies with nested train/validation/holdout gates."
    )
    parser.add_argument("--market", choices=["forex", "futures"], required=True)
    parser.add_argument("--asset", action="append", help="Asset key or symbol; repeat or comma-separate.")
    parser.add_argument("--family-prefix", action="append", help="Only research matching structural family prefixes.")
    parser.add_argument("--report-suffix", default="", help="Optional suffix for a focused research report.")
    parser.add_argument("--risk-reward", default="2,3,4")
    parser.add_argument("--max-train-finalists-per-family", type=int, default=1)
    parser.add_argument("--max-holdout-tests-per-asset", type=int, default=4)
    parser.add_argument("--max-add-per-asset", type=int, default=2)
    parser.add_argument("--max-total-additions", type=int, default=24)
    parser.add_argument("--workers", type=int, default=1, help="Independent asset-research workers.")
    parser.add_argument("--min-train-trades", type=int, default=80)
    parser.add_argument("--min-validation-trades", type=int, default=40)
    parser.add_argument("--min-holdout-trades", type=int, default=60)
    parser.add_argument("--min-train-pf", type=float, default=1.10)
    parser.add_argument("--min-validation-pf", type=float, default=1.20)
    parser.add_argument("--min-holdout-pf", type=float, default=1.20)
    parser.add_argument("--min-overall-pf", type=float, default=1.35)
    parser.add_argument("--false-discovery-rate", type=float, default=0.10)
    parser.add_argument("--cost-ticks", type=float, default=ROUND_TRIP_COST_TICKS)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def parse_assets(values: list[str] | None) -> set[str]:
    return {
        item.strip().lower()
        for value in values or []
        for item in value.split(",")
        if item.strip()
    }


def selected_assets(args: argparse.Namespace) -> list[runner.AssetConfig]:
    requested = parse_assets(args.asset)
    return [
        asset
        for asset in runner.load_assets()
        if asset.market == args.market
        and (not requested or asset.key.lower() in requested or asset.symbol.lower() in requested)
        and (runner.DATA_ROOT / "15m" / asset.data_file).exists()
        and (runner.DATA_ROOT / "1m" / asset.data_file).exists()
    ]


def risk_rewards(raw: str) -> tuple[str, ...]:
    return session.parse_risk_rewards([raw])


def compact_specs(raw_rr: str) -> list[session.VariantSpec]:
    """Use universal/side-only filters; calendar slices are intentionally excluded."""
    specs = session.variant_specs("broad", risk_rewards(raw_rr))
    output: list[session.VariantSpec] = []
    for spec in specs:
        keys = {key for key, _value in spec.params}
        if keys.intersection({"signal_weekday", "signal_weekday_side", "signal_month"}):
            continue
        output.append(spec)

    # Dynamic opening ranges are a distinct, economically motivated family that the
    # original session grid did not cover. Keep the grid frozen and calendar-agnostic.
    rr_values = [float(value) for value in risk_rewards(raw_rr)]
    for range_spec in dynamic_range.build_specs(rr_values, "all"):
        parts = range_spec.variant_id.split("|")
        params = tuple(
            (key, value)
            for part in parts[2:]
            for key, separator, value in [part.partition("=")]
            if separator
        )
        output.append(
            session.VariantSpec(
                family=range_spec.family,
                params=params,
                label=range_spec.label,
                summary=range_spec.summary,
            )
        )

    # Multi-speed consensus is intentionally a small, calendar-agnostic grid. The
    # groups represent fast/intermediate/slow trend speeds; all three signs must
    # agree, which avoids selecting a different speed after observing each asset.
    consensus_groups = (
        ("3,10,20", "fast intermediate slow"),
        ("5,20,60", "short medium long"),
        ("20,60,120", "medium long structural"),
    )
    consensus_filters = (
        ("all", (), "all signals"),
        ("side_long", (("side_filter", "long"),), "long signals"),
        ("side_short", (("side_filter", "short"),), "short signals"),
    )
    for session_name, entry, exit_minute in (
        ("next_rth", "570", "945"),
        ("next_overnight", "945", "570"),
    ):
        for direction in ("momentum", "contrarian"):
            for lookbacks, speed_label in consensus_groups:
                for filter_name, filter_params, filter_label in consensus_filters:
                    for risk_reward in risk_rewards(raw_rr):
                        family = f"daily_tsmom_{session_name}_consensus_{filter_name}"
                        output.append(
                            session.VariantSpec(
                                family=family,
                                params=(
                                    ("consensus", "3"),
                                    ("direction", direction),
                                    ("entry", entry),
                                    ("exit", exit_minute),
                                    ("lookbacks", lookbacks),
                                    ("risk_reward", risk_reward),
                                    *filter_params,
                                ),
                                label=(
                                    f"Multi-speed {direction} {session_name.replace('_', ' ')} "
                                    f"{speed_label} {filter_label} {risk_reward}R"
                                ),
                                summary=(
                                    f"Calendar-agnostic multi-speed time-series {direction}: {lookbacks}-day "
                                    f"trend signs must unanimously agree before the {session_name.replace('_', ' ')} trade. "
                                    f"Filter: {filter_label}. Reward/risk: {risk_reward}:1."
                                ),
                            )
                        )

    return list({spec.variant_id: spec for spec in output}.values())


def structural_family(spec: session.VariantSpec) -> str:
    family = re.sub(r"_(?:all|side_(?:long|short))$", "", spec.family)
    params = dict(spec.params)
    direction = params.get("direction", params.get("side", "both"))
    return f"{family}|direction={direction}"


def strategy_for(
    asset: runner.AssetConfig, spec: session.VariantSpec, cost_ticks: float
) -> runner.BacktestStrategy:
    base = session.build_strategy(asset, spec)
    digest = hashlib.sha1(f"{asset.key}|{spec.variant_id}|nested_session".encode()).hexdigest()[:8]
    strategy_id = f"nested_session_{asset.key}_{session.slug(spec.family, 48)}_{digest}"
    return replace(
        base,
        id=strategy_id,
        folder=strategy_id,
        source=SOURCE,
        cost_units=max(0.0, cost_ticks),
        one_trade_per_day=False,
    )


def metric_seed(asset: runner.AssetConfig, spec: session.VariantSpec, suffix: str) -> int:
    return int(hashlib.sha1(f"{asset.key}|{spec.variant_id}|{suffix}".encode()).hexdigest()[:8], 16)


def metrics(
    trades: list[runner.BacktestTradeRow], asset: runner.AssetConfig, spec: session.VariantSpec, suffix: str
) -> statistics.Metrics:
    return statistics.metrics_for(trades, metric_seed(asset, spec, suffix), min_split_trades=5)


def fast_trades(
    strategy: runner.BacktestStrategy,
    asset: runner.AssetConfig,
    data: runner.EnrichedData,
    start: int,
    end: int | None,
) -> list[runner.BacktestTradeRow]:
    return runner.run_competition_session_edge_strategy(strategy, asset, data, start, end)


def load_execution_data(asset: runner.AssetConfig, start: int) -> runner.EnrichedData:
    frame = runner.load_candle_csv(runner.DATA_ROOT / "1m" / asset.data_file)
    warmup_start = max(0, start - 90 * 24 * 60 * 60)
    frame = frame.filter(pl.col("time") >= warmup_start)
    return runner.build_enriched_data(frame, asset)


def strict_trades(
    strategy: runner.BacktestStrategy,
    asset: runner.AssetConfig,
    source_data: runner.EnrichedData,
    execution_data: runner.EnrichedData,
    start: int,
    end: int | None,
) -> list[runner.BacktestTradeRow]:
    return runner.run_single_strategy(
        strategy,
        asset,
        source_data,
        start_ts=start,
        end_ts=end,
        strict_anti_cheat=True,
        execution_data=[("1m", execution_data)],
    )


def entry_parity(fast: list[runner.BacktestTradeRow], strict: list[runner.BacktestTradeRow]) -> float:
    fast_entries = {(trade.side, trade.entry_time) for trade in fast}
    strict_entries = {(trade.side, trade.entry_time) for trade in strict}
    union = fast_entries | strict_entries
    return len(fast_entries & strict_entries) / len(union) if union else 1.0


def training_passes(value: statistics.Metrics, args: argparse.Namespace) -> bool:
    return (
        value.trades >= args.min_train_trades
        and value.profit_factor >= args.min_train_pf
        and value.total_r > 0
        and value.odd_even_min_pf >= 0.85
    )


def validation_passes(value: statistics.Metrics, args: argparse.Namespace) -> bool:
    return (
        value.trades >= args.min_validation_trades
        and value.profit_factor >= args.min_validation_pf
        and value.total_r > 0
        and value.min_split_pf >= 0.70
        and value.bootstrap_pf_p05 >= 0.75
        and value.block_bootstrap_pf_p05 >= 0.70
        and value.odd_even_min_pf >= 0.80
        and value.sign_flip_p_value <= 0.20
    )


def final_passes(candidate: Candidate, args: argparse.Namespace) -> bool:
    value = candidate.holdout
    overall = candidate.overall
    return (
        value.trades >= args.min_holdout_trades
        and value.profit_factor >= args.min_holdout_pf
        and value.total_r > 0
        and value.min_split_pf >= 0.70
        and value.bootstrap_pf_p05 >= 0.80
        and value.block_bootstrap_pf_p05 >= 0.75
        and value.odd_even_min_pf >= 0.80
        and candidate.holdout_q_value <= args.false_discovery_rate
        and overall.profit_factor >= args.min_overall_pf
        and overall.annual_pass_rate >= 0.60
        and candidate.entry_parity >= 0.98
    )


def train_score(value: statistics.Metrics) -> float:
    return (
        min(value.profit_factor, 4.0) * 2.0
        + min(value.bootstrap_pf_p05, 2.5)
        + min(value.block_bootstrap_pf_p05, 2.5)
        + math.log1p(value.trades)
    )


def validation_score(train: statistics.Metrics, validation: statistics.Metrics) -> float:
    return (
        min(train.profit_factor, 3.0)
        + min(validation.profit_factor, 5.0) * 2.0
        + min(validation.bootstrap_pf_p05, 3.0) * 2.0
        + min(validation.block_bootstrap_pf_p05, 3.0)
        + math.log1p(validation.trades)
        - validation.sign_flip_p_value * 8.0
    )


def research_asset(asset: runner.AssetConfig, specs: list[session.VariantSpec], args: argparse.Namespace) -> list[Candidate]:
    plan = nested.window_plan(args.market)
    source_data = session.load_asset_data(asset)
    ranked: dict[str, list[tuple[float, runner.BacktestStrategy, session.VariantSpec, statistics.Metrics]]] = {}
    train_trials = 0

    for spec in specs:
        strategy = strategy_for(asset, spec, args.cost_ticks)
        train = metrics(fast_trades(strategy, asset, source_data, plan.train_start, plan.train_end), asset, spec, "train")
        train_trials += 1
        if training_passes(train, args):
            ranked.setdefault(structural_family(spec), []).append((train_score(train), strategy, spec, train))

    finalists: list[tuple[runner.BacktestStrategy, session.VariantSpec, statistics.Metrics]] = []
    for family_rows in ranked.values():
        family_rows.sort(key=lambda item: item[0], reverse=True)
        finalists.extend(
            (strategy, spec, train)
            for _score, strategy, spec, train in family_rows[: args.max_train_finalists_per_family]
        )
    print(f"    training passes={sum(len(rows) for rows in ranked.values())}, family finalists={len(finalists)}", flush=True)

    validation_fast: list[
        tuple[float, runner.BacktestStrategy, session.VariantSpec, statistics.Metrics, list[runner.BacktestTradeRow]]
    ] = []
    for strategy, spec, train in finalists:
        trades = fast_trades(strategy, asset, source_data, plan.train_end, plan.validation_end)
        value = metrics(trades, asset, spec, "validation_fast")
        if validation_passes(value, args):
            validation_fast.append((validation_score(train, value), strategy, spec, train, trades))
    validation_fast.sort(key=lambda item: item[0], reverse=True)
    print(f"    fast validation passes={len(validation_fast)}", flush=True)

    tested = validation_fast[: args.max_holdout_tests_per_asset]
    if not tested:
        return []
    execution_data = load_execution_data(asset, plan.train_end)
    output: list[Candidate] = []
    for score, strategy, spec, train, fast_validation_trades in tested:
        validation_trades = strict_trades(
            strategy, asset, source_data, execution_data, plan.train_end, plan.validation_end
        )
        validation = metrics(validation_trades, asset, spec, "validation_strict")
        parity = entry_parity(fast_validation_trades, validation_trades)
        if parity < 0.98 or not validation_passes(validation, args):
            print(
                f"    strict validation reject {spec.family}: parity={parity:.3f}, "
                f"PF={validation.profit_factor:.2f}, trades={validation.trades}, "
                f"bootstrap={validation.bootstrap_pf_p05:.2f}, p={validation.sign_flip_p_value:.3f}",
                flush=True,
            )
            continue
        holdout_trades = strict_trades(
            strategy, asset, source_data, execution_data, plan.validation_end, plan.holdout_end
        )
        holdout = metrics(holdout_trades, asset, spec, "holdout")
        out_of_sample = sorted([*validation_trades, *holdout_trades], key=lambda trade: (trade.entry_time, trade.exit_time))
        overall = metrics(out_of_sample, asset, spec, "overall_out_of_sample")
        output.append(
            Candidate(
                strategy=strategy,
                asset=asset,
                spec=spec,
                train=train,
                validation=validation,
                holdout=holdout,
                overall=overall,
                trades=out_of_sample,
                entry_parity=parity,
                holdout_p_value=holdout.sign_flip_p_value,
                holdout_q_value=1.0,
                score=score + min(holdout.profit_factor, 5.0) * 2.0 + math.log1p(holdout.trades),
                train_trials=train_trials,
                validation_trials=len(finalists),
            )
        )
    return output


def false_discovery_correction(candidates: list[Candidate]) -> list[Candidate]:
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


def metric_payload(value: statistics.Metrics) -> dict[str, float | int]:
    return {
        "trades": value.trades,
        "profitFactor": statistics.json_metric(value.profit_factor),
        "totalR": round(value.total_r, 6),
        "maxDrawdownR": round(value.max_drawdown_r, 6),
        "minimumChronologicalSplitPf": statistics.json_metric(value.min_split_pf),
        "bootstrapPfP05": statistics.json_metric(value.bootstrap_pf_p05),
        "blockBootstrapPfP05": statistics.json_metric(value.block_bootstrap_pf_p05),
        "oddEvenMinimumPf": statistics.json_metric(value.odd_even_min_pf),
        "annualPassRate": round(value.annual_pass_rate, 6),
        "signFlipPValue": round(value.sign_flip_p_value, 6),
    }


def materialize(candidate: Candidate, args: argparse.Namespace) -> None:
    plan = nested.window_plan(args.market)
    strategy_dir = STRATEGY_ROOT / candidate.strategy.folder
    metadata_dir = strategy_dir / "parameters"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    (strategy_dir / "strategy.ts").write_text(
        f'''import {{ createStrategyDefinition, runtimeDefaultsFromMetadata }} from "@/lib/strategy-definition";
import {{ evaluateCompetitionSessionEdge }} from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./parameters/backtest.json";

export default createStrategyDefinition({{
  id: "{candidate.strategy.id}",
  label: "{candidate.strategy.label}",
  folder: "{candidate.strategy.folder}",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "{candidate.asset.key}",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
}});
''',
        encoding="utf-8",
    )
    payload = {
        "strategyId": candidate.strategy.id,
        "label": candidate.strategy.label,
        "folder": candidate.strategy.folder,
        "assetKey": candidate.asset.key,
        "phase": "competition_session_edge",
        "variantId": candidate.strategy.variant_id,
        "source": SOURCE,
        "sourceUrls": SOURCE_URLS,
        "researchSummary": candidate.spec.summary,
        "selectionMethod": (
            "Immutable literature-motivated session grid. Parameters were ranked only in training, then had to "
            "pass untouched chronological validation and a sealed final holdout under the strict anti-cheat engine. "
            "The final holdout uses Benjamini-Hochberg multiple-test correction, ordinary and block bootstrap, "
            "odd/even, annual, chronological split, duplicate-entry, fast/strict entry-parity and two-tick friction gates."
        ),
        "windowPlan": {
            "training": plan.train_label,
            "validation": plan.validation_label,
            "holdout": plan.holdout_label,
        },
        "trialAccounting": {
            "trainingGridTrialsForAsset": candidate.train_trials,
            "validationFinalistsForAsset": candidate.validation_trials,
            "holdoutPValue": round(candidate.holdout_p_value, 6),
            "holdoutFalseDiscoveryRateQValue": round(candidate.holdout_q_value, 6),
        },
        "trainingMetrics": metric_payload(candidate.train),
        "validationMetrics": metric_payload(candidate.validation),
        "holdoutMetrics": metric_payload(candidate.holdout),
        "overallMetrics": metric_payload(candidate.overall),
        "selectedTrainingProfitFactor": statistics.json_metric(candidate.train.profit_factor),
        "selectedTrainingTrades": candidate.train.trades,
        "selectedForwardProfitFactor": statistics.json_metric(candidate.holdout.profit_factor),
        "selectedForwardTrades": candidate.holdout.trades,
        "forwardTotalR": round(candidate.holdout.total_r, 6),
        "minimumRiskReward": 2.0,
        "selectedRiskReward": float(dict(candidate.spec.params).get("risk_reward", 2)),
        "costUnits": candidate.strategy.cost_units,
        "oneTradePerDay": False,
        "verificationSummary": (
            f"Strict nested walk-forward: train PF {candidate.train.profit_factor:.2f} ({candidate.train.trades}), "
            f"validation PF {candidate.validation.profit_factor:.2f} ({candidate.validation.trades}), "
            f"sealed holdout PF {candidate.holdout.profit_factor:.2f} ({candidate.holdout.trades}), "
            f"holdout q={candidate.holdout_q_value:.3f}, OOS PF {candidate.overall.profit_factor:.2f}, "
            f"entry parity {candidate.entry_parity:.1%}; one-minute exits and {candidate.strategy.cost_units:g}-tick friction included."
        ),
    }
    (metadata_dir / "backtest.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    runner.write_strategy_backtest_csv(strategy_dir / "backtest_trades.csv", candidate.trades)


def update_loader(candidates: list[Candidate]) -> None:
    if not candidates:
        return
    text = LOADER_PATH.read_text(encoding="utf-8")
    existing = set(re.findall(r'@strategy/([^/]+)/strategy', text))
    additions = [candidate for candidate in candidates if candidate.strategy.folder not in existing]
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


def write_report(candidates: list[Candidate], selected: list[Candidate], args: argparse.Namespace) -> Path:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    selected_ids = {candidate.strategy.id for candidate in selected}
    suffix = f"_{session.slug(args.report_suffix)}" if args.report_suffix.strip() else ""
    path = REPORT_ROOT / f"nested_session_walk_forward_{args.market}{suffix}.csv"
    fields = [
        "status", "strategy_id", "asset_key", "family", "train_pf", "train_trades", "validation_pf",
        "validation_trades", "holdout_pf", "holdout_trades", "holdout_p_value", "holdout_q_value",
        "oos_pf", "oos_trades", "bootstrap_p05", "block_bootstrap_p05", "annual_pass_rate",
        "entry_parity", "cost_ticks", "train_trials", "validation_trials", "variant_id",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for candidate in sorted(candidates, key=lambda item: item.score, reverse=True):
            writer.writerow({
                "status": "selected" if candidate.strategy.id in selected_ids else "rejected",
                "strategy_id": candidate.strategy.id,
                "asset_key": candidate.asset.key,
                "family": candidate.spec.family,
                "train_pf": f"{candidate.train.profit_factor:.6f}",
                "train_trades": candidate.train.trades,
                "validation_pf": f"{candidate.validation.profit_factor:.6f}",
                "validation_trades": candidate.validation.trades,
                "holdout_pf": f"{candidate.holdout.profit_factor:.6f}",
                "holdout_trades": candidate.holdout.trades,
                "holdout_p_value": f"{candidate.holdout_p_value:.6f}",
                "holdout_q_value": f"{candidate.holdout_q_value:.6f}",
                "oos_pf": f"{candidate.overall.profit_factor:.6f}",
                "oos_trades": candidate.overall.trades,
                "bootstrap_p05": f"{candidate.overall.bootstrap_pf_p05:.6f}",
                "block_bootstrap_p05": f"{candidate.overall.block_bootstrap_pf_p05:.6f}",
                "annual_pass_rate": f"{candidate.overall.annual_pass_rate:.6f}",
                "entry_parity": f"{candidate.entry_parity:.6f}",
                "cost_ticks": f"{candidate.strategy.cost_units:.6f}",
                "train_trials": candidate.train_trials,
                "validation_trials": candidate.validation_trials,
                "variant_id": candidate.strategy.variant_id,
            })
    return path


def main() -> int:
    args = parse_args()
    assets = selected_assets(args)
    specs = compact_specs(args.risk_reward)
    requested_families = parse_assets(args.family_prefix)
    if requested_families:
        specs = [spec for spec in specs if any(spec.family.startswith(prefix) for prefix in requested_families)]
    if not assets:
        raise ValueError("No matching assets with both 15-minute and 1-minute data")
    print(f"Nested session research: {args.market}, {len(assets)} assets, {len(specs)} frozen variants")
    candidates: list[Candidate] = []
    worker_count = max(1, min(args.workers, len(assets)))
    if worker_count == 1:
        for asset in assets:
            print(f"  {asset.key}", flush=True)
            rows = research_asset(asset, specs, args)
            candidates.extend(rows)
            print(f"    sealed holdout tests={len(rows)}", flush=True)
    else:
        with ProcessPoolExecutor(max_workers=worker_count) as executor:
            pending = {executor.submit(research_asset, asset, specs, args): asset for asset in assets}
            for future in as_completed(pending):
                asset = pending[future]
                rows = future.result()
                candidates.extend(rows)
                print(f"  {asset.key}: sealed holdout tests={len(rows)}", flush=True)

    corrected = false_discovery_correction(candidates)
    eligible = [candidate for candidate in corrected if final_passes(candidate, args)]
    eligible.sort(key=lambda item: item.score, reverse=True)
    existing_entries = nested.load_existing_entry_times()
    selected: list[Candidate] = []
    per_asset: dict[str, int] = {}
    for candidate in eligible:
        if len(selected) >= args.max_total_additions:
            break
        if per_asset.get(candidate.asset.key, 0) >= args.max_add_per_asset:
            continue
        if nested.near_overlap_share(candidate.trades, existing_entries, 15 * 60) >= 0.80:
            continue
        selected.append(candidate)
        per_asset[candidate.asset.key] = per_asset.get(candidate.asset.key, 0) + 1
        nested.register_candidate(candidate, existing_entries)

    report = write_report(corrected, selected, args)
    print(f"Tested {len(candidates)} sealed holdouts; selected {len(selected)}. Report: {report}")
    for candidate in selected:
        print(
            f"  {candidate.strategy.id}: train {candidate.train.profit_factor:.2f}/{candidate.train.trades}, "
            f"validation {candidate.validation.profit_factor:.2f}/{candidate.validation.trades}, "
            f"holdout {candidate.holdout.profit_factor:.2f}/{candidate.holdout.trades}, "
            f"q={candidate.holdout_q_value:.3f}, OOS {candidate.overall.profit_factor:.2f}/{candidate.overall.trades}"
        )
    if not args.dry_run:
        for candidate in selected:
            materialize(candidate, args)
        update_loader(selected)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
