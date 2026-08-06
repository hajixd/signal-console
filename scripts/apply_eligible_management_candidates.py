from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backtest-engine"))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

import runner  # noqa: E402
import research_nested_management_portfolio as management  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Apply only individually holdout-qualified moving-exit policies.")
    parser.add_argument("--market", choices=["forex", "futures"], required=True)
    return parser.parse_args()


def eligible_rows(market: str) -> list[dict[str, str]]:
    path = management.REPORT_ROOT / f"nested_management_{market}.csv"
    with path.open(newline="", encoding="utf-8") as handle:
        return [row for row in csv.DictReader(handle) if row.get("status") in {"eligible", "applied"}]


def main() -> int:
    args = parse_args()
    rows = eligible_rows(args.market)
    strategies = {strategy.id: strategy for strategy in runner.selected_backtest_strategies()}
    assets = runner.load_asset_by_key()
    specs = {spec.name: spec for spec in management.specs()}
    data_cache: dict[tuple[str, str], tuple[runner.EnrichedData, list[tuple[str, runner.EnrichedData]] | None]] = {}
    applied: list[dict[str, object]] = []

    for row in rows:
        strategy = strategies.get(row["strategy_id"])
        spec = specs.get(row["spec"])
        if strategy is None or spec is None:
            raise ValueError(f"Missing strategy/spec for {row.get('strategy_id')} {row.get('spec')}")
        asset = assets[strategy.asset_key]
        timeframe = runner.strategy_timeframe(strategy)
        cache_key = (asset.key, timeframe)
        if cache_key not in data_cache:
            data_cache[cache_key] = management.load_data(asset, timeframe)
        source, execution = data_cache[cache_key]
        baseline_trades = management.run(strategy, asset, source, execution)
        candidate_strategy = management.managed(strategy, spec)
        trades = management.run(candidate_strategy, asset, source, execution)
        _train_rows, validation_rows, holdout_rows = management.split_trades(trades)
        _base_train, base_validation_rows, base_holdout_rows = management.split_trades(baseline_trades)
        candidate = management.Candidate(
            strategy=strategy,
            spec=spec,
            baseline_validation=management.metrics(strategy, "baseline", "validation", base_validation_rows),
            baseline_holdout=management.metrics(strategy, "baseline", "holdout", base_holdout_rows),
            train=management.metrics(strategy, spec.name, "train", [trade for trade in trades if management.TRAIN_START <= trade.entry_time < management.TRAIN_END]),
            validation=management.metrics(strategy, spec.name, "validation", validation_rows),
            holdout=management.metrics(strategy, spec.name, "holdout", holdout_rows),
            overall=management.metrics(strategy, spec.name, "overall", trades),
            trades=trades,
            holdout_p_value=float(row["holdout_p_value"]),
            holdout_q_value=float(row["holdout_q_value"]),
        )
        expected_pf = float(row["overall_pf"])
        if abs(candidate.overall.profit_factor - expected_pf) > 0.02:
            raise ValueError(
                f"Recomputed PF drifted for {strategy.id}: report={expected_pf:.4f}, now={candidate.overall.profit_factor:.4f}"
            )
        management.apply(candidate)
        applied.append({
            "strategyId": strategy.id,
            "policy": spec.name,
            "validationProfitFactor": candidate.validation.profit_factor,
            "sealedHoldoutProfitFactor": candidate.holdout.profit_factor,
            "holdoutQValue": candidate.holdout_q_value,
            "overallProfitFactor": candidate.overall.profit_factor,
        })

    print({"market": args.market, "applied": applied})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
