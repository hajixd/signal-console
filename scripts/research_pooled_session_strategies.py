from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from dataclasses import dataclass, replace
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backtest-engine"))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

import runner  # noqa: E402
import research_nested_session_strategies as nested_session  # noqa: E402
import research_nested_walk_forward_strategies as nested  # noqa: E402
import search_higher_timeframe_strategies as statistics  # noqa: E402


REPORT_ROOT = PROJECT_ROOT / "Research" / "reports"
STRATEGY_ROOT = PROJECT_ROOT / "strategy"
SOURCE = "pooled_nested_session_2026_08"


@dataclass(frozen=True)
class PooledCandidate:
    spec: object
    train: statistics.Metrics
    validation: statistics.Metrics
    holdout: statistics.Metrics
    overall: statistics.Metrics
    strict_trades_by_asset: dict[str, list[runner.BacktestTradeRow]]
    entry_parity: float
    holdout_p_value: float
    holdout_q_value: float = 1.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Pool frozen session hypotheses across a market before opening the sealed holdout."
    )
    parser.add_argument("--market", choices=["forex", "futures"], required=True)
    parser.add_argument("--asset", action="append", help="Optional asset key or symbol; repeat or comma-separate.")
    parser.add_argument("--risk-reward", default="2,3,4")
    parser.add_argument("--max-train-finalists-per-family", type=int, default=1)
    parser.add_argument("--max-holdout-tests", type=int, default=8)
    parser.add_argument("--cost-ticks", type=float, default=2.0)
    parser.add_argument("--spec-start", type=int, default=1, help="One-based frozen-grid start index.")
    parser.add_argument("--spec-end", type=int, default=0, help="Inclusive frozen-grid end index; 0 means all.")
    parser.add_argument(
        "--report-suffix",
        default="",
        help="Optional suffix for independent family-complete research chunks.",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def metric_seed(market: str, variant_id: str, window: str) -> int:
    return int(hashlib.sha1(f"{market}|{variant_id}|{window}".encode()).hexdigest()[:8], 16)


def metrics(market: str, spec: object, window: str, trades: list[runner.BacktestTradeRow]) -> statistics.Metrics:
    return statistics.metrics_for(
        trades,
        metric_seed(market, str(getattr(spec, "variant_id")), window),
        min_split_trades=8,
    )


def train_passes(value: statistics.Metrics) -> bool:
    return (
        value.trades >= 500
        and value.profit_factor >= 0.98
        and value.total_r > -10
        and value.odd_even_min_pf >= 0.85
        and value.bootstrap_pf_p05 >= 0.85
        and value.block_bootstrap_pf_p05 >= 0.80
    )


def validation_passes(value: statistics.Metrics) -> bool:
    return (
        value.trades >= 250
        and value.profit_factor >= 1.05
        and value.total_r > 0
        and value.min_split_pf >= 0.85
        and value.odd_even_min_pf >= 0.90
        and value.bootstrap_pf_p05 >= 0.95
        and value.block_bootstrap_pf_p05 >= 0.90
        and value.sign_flip_p_value <= 0.10
    )


def final_passes(candidate: PooledCandidate) -> bool:
    value = candidate.holdout
    overall = candidate.overall
    return (
        value.trades >= 350
        and value.profit_factor >= 1.10
        and value.total_r > 0
        and value.min_split_pf >= 0.85
        and value.odd_even_min_pf >= 0.90
        and value.bootstrap_pf_p05 >= 1.0
        and value.block_bootstrap_pf_p05 >= 0.90
        and candidate.holdout_q_value <= 0.10
        and overall.profit_factor >= 1.10
        and overall.min_split_pf >= 0.90
        and overall.annual_pass_rate >= 0.75
        and candidate.entry_parity >= 0.98
    )


def score(value: statistics.Metrics) -> float:
    return (
        min(value.profit_factor, 2.5) * 5
        + min(value.bootstrap_pf_p05, 2) * 3
        + min(value.block_bootstrap_pf_p05, 2) * 2
        + math.log1p(value.trades)
        - value.sign_flip_p_value * 6
    )


def false_discovery(candidates: list[PooledCandidate]) -> list[PooledCandidate]:
    ordered = sorted(candidates, key=lambda candidate: candidate.holdout_p_value)
    running = 1.0
    q_values = [1.0] * len(ordered)
    for index in range(len(ordered) - 1, -1, -1):
        running = min(running, ordered[index].holdout_p_value * len(ordered) / (index + 1))
        q_values[index] = min(1.0, running)
    return [replace(candidate, holdout_q_value=q_values[index]) for index, candidate in enumerate(ordered)]


def pooled_fast_trades(
    assets: list[runner.AssetConfig],
    data_by_asset: dict[str, runner.EnrichedData],
    spec: object,
    cost_ticks: float,
    start: int,
    end: int | None,
) -> list[runner.BacktestTradeRow]:
    output: list[runner.BacktestTradeRow] = []
    for asset in assets:
        strategy = replace(nested_session.strategy_for(asset, spec, cost_ticks), source=SOURCE)
        output.extend(nested_session.fast_trades(strategy, asset, data_by_asset[asset.key], start, end))
    return sorted(output, key=lambda trade: (trade.entry_time, trade.exit_time, trade.strategy_id))


def pooled_strict_trades(
    assets: list[runner.AssetConfig],
    data_by_asset: dict[str, runner.EnrichedData],
    execution_by_asset: dict[str, runner.EnrichedData],
    spec: object,
    cost_ticks: float,
    start: int,
    end: int | None,
) -> dict[str, list[runner.BacktestTradeRow]]:
    return {
        asset.key: nested_session.strict_trades(
            replace(nested_session.strategy_for(asset, spec, cost_ticks), source=SOURCE),
            asset,
            data_by_asset[asset.key],
            execution_by_asset[asset.key],
            start,
            end,
        )
        for asset in assets
    }


def flattened(by_asset: dict[str, list[runner.BacktestTradeRow]]) -> list[runner.BacktestTradeRow]:
    return sorted(
        (trade for trades in by_asset.values() for trade in trades),
        key=lambda trade: (trade.entry_time, trade.exit_time, trade.strategy_id),
    )


def pooled_entry_parity(
    fast: list[runner.BacktestTradeRow], strict: list[runner.BacktestTradeRow]
) -> float:
    fast_entries = {(trade.asset_key, trade.side, trade.entry_time) for trade in fast}
    strict_entries = {(trade.asset_key, trade.side, trade.entry_time) for trade in strict}
    union = fast_entries | strict_entries
    return len(fast_entries & strict_entries) / len(union) if union else 1.0


def metric_payload(value: statistics.Metrics) -> dict[str, float | int]:
    return {
        "trades": value.trades,
        "profitFactor": statistics.json_metric(value.profit_factor),
        "totalR": round(value.total_r, 6),
        "minimumChronologicalSplitPf": statistics.json_metric(value.min_split_pf),
        "bootstrapPfP05": statistics.json_metric(value.bootstrap_pf_p05),
        "blockBootstrapPfP05": statistics.json_metric(value.block_bootstrap_pf_p05),
        "oddEvenMinimumPf": statistics.json_metric(value.odd_even_min_pf),
        "annualPassRate": round(value.annual_pass_rate, 6),
        "signFlipPValue": round(value.sign_flip_p_value, 6),
    }


def materialize(
    candidate: PooledCandidate,
    assets: list[runner.AssetConfig],
    args: argparse.Namespace,
    plan: object,
) -> list[nested_session.Candidate]:
    existing_variants = statistics.existing_variant_keys()
    existing_entries = nested.load_existing_entry_times()
    materialized: list[nested_session.Candidate] = []
    for asset in assets:
        strategy = replace(nested_session.strategy_for(asset, candidate.spec, args.cost_ticks), source=SOURCE)
        canonical = statistics.canonical_variant(strategy.variant_id)
        trades = candidate.strict_trades_by_asset.get(asset.key, [])
        if not trades or (asset.key, canonical) in existing_variants:
            continue
        if nested.near_overlap_share(trades, existing_entries, 15 * 60) >= 0.80:
            continue
        asset_validation_rows = [trade for trade in trades if plan.train_end <= trade.entry_time < plan.validation_end]
        asset_holdout_rows = [trade for trade in trades if trade.entry_time >= plan.validation_end]
        asset_validation = metrics(args.market, candidate.spec, f"asset_{asset.key}_validation", asset_validation_rows)
        asset_holdout = metrics(args.market, candidate.spec, f"asset_{asset.key}_holdout", asset_holdout_rows)
        asset_overall = metrics(args.market, candidate.spec, f"asset_{asset.key}_overall", trades)
        wrapper = nested_session.Candidate(
            strategy=strategy,
            asset=asset,
            spec=candidate.spec,
            train=candidate.train,
            validation=asset_validation,
            holdout=asset_holdout,
            overall=asset_overall,
            trades=trades,
            entry_parity=candidate.entry_parity,
            holdout_p_value=candidate.holdout_p_value,
            holdout_q_value=candidate.holdout_q_value,
            score=score(candidate.holdout),
            train_trials=0,
            validation_trials=0,
        )
        nested_session.materialize(wrapper, args)
        metadata_path = STRATEGY_ROOT / strategy.folder / "parameters" / "backtest.json"
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        payload.update({
            "source": SOURCE,
            "selectionMethod": (
                "One frozen market-level hypothesis was selected on pooled cross-asset training, passed untouched "
                "pooled validation, then passed a sealed pooled 2025+ holdout with Benjamini-Hochberg correction. "
                "Every asset instance is the same precommitted rule; no asset-specific parameter was selected."
            ),
            "pooledTrainingMetrics": metric_payload(candidate.train),
            "pooledValidationMetrics": metric_payload(candidate.validation),
            "pooledHoldoutMetrics": metric_payload(candidate.holdout),
            "pooledOverallMetrics": metric_payload(candidate.overall),
            "verificationSummary": (
                f"Pooled nested validation: train PF {candidate.train.profit_factor:.2f} ({candidate.train.trades}), "
                f"validation PF {candidate.validation.profit_factor:.2f} ({candidate.validation.trades}), sealed "
                f"holdout PF {candidate.holdout.profit_factor:.2f} ({candidate.holdout.trades}), q="
                f"{candidate.holdout_q_value:.3f}, strict parity {candidate.entry_parity:.1%}; this asset contributes "
                f"{len(trades)} strict one-minute-execution trades."
            ),
        })
        metadata_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        materialized.append(wrapper)
        existing_variants.add((asset.key, canonical))
        for trade in trades:
            side = "long" if trade.side == 1 else "short"
            existing_entries.setdefault((trade.asset_key, side), {}).setdefault(strategy.folder, []).append(trade.entry_time)
    return materialized


def main() -> int:
    args = parse_args()
    plan = nested.window_plan(args.market)
    assets = nested_session.selected_assets(args)
    all_specs = nested_session.compact_specs(args.risk_reward)
    start_index = max(0, args.spec_start - 1)
    end_index = len(all_specs) if args.spec_end <= 0 else min(len(all_specs), args.spec_end)
    specs = all_specs[start_index:end_index]
    data_by_asset = {asset.key: nested_session.session.load_asset_data(asset) for asset in assets}
    print(f"Pooled nested session research: {args.market}, {len(assets)} assets, {len(specs)} frozen variants", flush=True)

    ranked_by_family: dict[str, list[tuple[float, object, statistics.Metrics]]] = {}
    for index, spec in enumerate(specs, start=1):
        train_rows = pooled_fast_trades(assets, data_by_asset, spec, args.cost_ticks, plan.train_start, plan.train_end)
        value = metrics(args.market, spec, "train", train_rows)
        if train_passes(value):
            ranked_by_family.setdefault(nested_session.structural_family(spec), []).append((score(value), spec, value))
        if index % 40 == 0 or index == len(specs):
            print(f"  training {index}/{len(specs)}; passing hypotheses={sum(len(rows) for rows in ranked_by_family.values())}", flush=True)

    finalists: list[tuple[object, statistics.Metrics]] = []
    for rows in ranked_by_family.values():
        rows.sort(key=lambda item: item[0], reverse=True)
        finalists.extend((spec, value) for _score, spec, value in rows[: args.max_train_finalists_per_family])
    validation_ranked: list[tuple[float, object, statistics.Metrics, statistics.Metrics, list[runner.BacktestTradeRow]]] = []
    for spec, train in finalists:
        fast_rows = pooled_fast_trades(assets, data_by_asset, spec, args.cost_ticks, plan.train_end, plan.validation_end)
        value = metrics(args.market, spec, "validation_fast", fast_rows)
        if validation_passes(value):
            validation_ranked.append((score(value), spec, train, value, fast_rows))
    validation_ranked.sort(key=lambda item: item[0], reverse=True)
    tested = validation_ranked[: args.max_holdout_tests]
    print(f"  family finalists={len(finalists)}, fast validation passes={len(validation_ranked)}, sealed tests={len(tested)}", flush=True)

    if not tested:
        corrected: list[PooledCandidate] = []
    else:
        execution_by_asset = {asset.key: nested_session.load_execution_data(asset, plan.train_start) for asset in assets}
        tested_candidates: list[PooledCandidate] = []
        for _rank_score, spec, train, _fast_validation, fast_validation_rows in tested:
            strict_validation_by_asset = pooled_strict_trades(
                assets, data_by_asset, execution_by_asset, spec, args.cost_ticks, plan.train_end, plan.validation_end
            )
            strict_validation_rows = flattened(strict_validation_by_asset)
            validation = metrics(args.market, spec, "validation_strict", strict_validation_rows)
            parity = pooled_entry_parity(fast_validation_rows, strict_validation_rows)
            if parity < 0.98 or not validation_passes(validation):
                print(f"    strict validation reject {getattr(spec, 'family')}: PF={validation.profit_factor:.2f}, parity={parity:.3f}", flush=True)
                continue
            holdout_by_asset = pooled_strict_trades(
                assets, data_by_asset, execution_by_asset, spec, args.cost_ticks, plan.validation_end, plan.holdout_end
            )
            holdout_rows = flattened(holdout_by_asset)
            holdout = metrics(args.market, spec, "holdout", holdout_rows)
            overall = metrics(args.market, spec, "oos", sorted([*strict_validation_rows, *holdout_rows], key=lambda trade: trade.entry_time))
            full_by_asset = pooled_strict_trades(
                assets, data_by_asset, execution_by_asset, spec, args.cost_ticks, plan.train_start, plan.holdout_end
            )
            tested_candidates.append(PooledCandidate(
                spec=spec,
                train=train,
                validation=validation,
                holdout=holdout,
                overall=overall,
                strict_trades_by_asset=full_by_asset,
                entry_parity=parity,
                holdout_p_value=holdout.sign_flip_p_value,
            ))
        corrected = false_discovery(tested_candidates)

    eligible = [candidate for candidate in corrected if final_passes(candidate)]
    selected = sorted(eligible, key=lambda candidate: score(candidate.holdout), reverse=True)[:2]
    materialized: list[nested_session.Candidate] = []
    if not args.dry_run:
        for candidate in selected:
            materialized.extend(materialize(candidate, assets, args, plan))
        nested_session.update_loader(materialized)

    report = {
        "market": args.market,
        "assets": len(assets),
        "riskRewardGrid": args.risk_reward,
        "specStart": args.spec_start,
        "specEnd": end_index,
        "frozenVariants": len(specs),
        "trainingFamilyFinalists": len(finalists),
        "validationPasses": len(validation_ranked),
        "sealedHoldoutTests": len(tested),
        "eligiblePooledHypotheses": len(eligible),
        "selectedPooledHypotheses": len(selected),
        "materializedAssetStrategies": len(materialized),
        "dryRun": args.dry_run,
        "selected": [
            {
                "variantId": getattr(candidate.spec, "variant_id"),
                "train": metric_payload(candidate.train),
                "validation": metric_payload(candidate.validation),
                "holdout": metric_payload(candidate.holdout),
                "overall": metric_payload(candidate.overall),
                "holdoutQValue": round(candidate.holdout_q_value, 6),
                "entryParity": round(candidate.entry_parity, 6),
            }
            for candidate in selected
        ],
        "method": (
            "Frozen calendar-agnostic session hypotheses pooled across every market asset; train ranks one per family, "
            "untouched validation selects finalists, sealed 2025+ holdout uses BH/ordinary bootstrap/block bootstrap/"
            "odd-even/annual/strict one-minute parity gates. No asset-specific parameters are selected."
        ),
    }
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    safe_suffix = "".join(character for character in args.report_suffix if character.isalnum() or character in "-_")
    suffix = f"_{safe_suffix}" if safe_suffix else ""
    path = REPORT_ROOT / f"pooled_nested_session_{args.market}{suffix}_summary.json"
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
