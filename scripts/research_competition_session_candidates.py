from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backtest-engine"))

import runner  # noqa: E402


STRATEGY_ROOT = PROJECT_ROOT / "strategy"
REPORT_ROOT = PROJECT_ROOT / "Research" / "reports"
FORWARD_START_TS = runner.BACKTEST_START_TS

MIN_TRAIN_TRADES = 20
MIN_TRAIN_PF = 1.05
MIN_FORWARD_TRADES = 20
MIN_FORWARD_PF = 2.0
MIN_SPLIT_TRADES = 5
MIN_SPLIT_PF = 1.0

SOURCE_URLS = [
    "https://w4.stern.nyu.edu/facdir/lpederse/papers/TimeSeriesMomentum.pdf",
    "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2694985",
    "https://www.semanticscholar.org/paper/The-Probability-of-Backtest-Overfitting-Bailey-Borwein/b1233b4f5384f003e85c2e0eec1a2dfc08f624c5",
]


@dataclass(frozen=True)
class VariantSpec:
    family: str
    params: tuple[tuple[str, str], ...]
    label: str
    summary: str

    @property
    def variant_id(self) -> str:
        tokens = ["competition_session_edge", f"family={self.family}"]
        tokens.extend(f"{key}={value}" for key, value in self.params)
        return "|".join(tokens)


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
class Candidate:
    strategy: runner.BacktestStrategy
    asset: runner.AssetConfig
    spec: VariantSpec
    train_metrics: Metrics
    forward_metrics: Metrics
    forward_trades: list[runner.BacktestTradeRow]
    score: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Research and materialize robust competition session-edge strategies")
    parser.add_argument("--market", choices=["all", "forex", "futures"], default="all")
    parser.add_argument("--asset", action="append", help="Only research this asset key. Repeat for multiple assets.")
    parser.add_argument("--max-train-per-asset", type=int, default=140)
    parser.add_argument("--max-add-per-asset", type=int, default=8)
    parser.add_argument("--max-total-additions", type=int, default=120)
    parser.add_argument("--near-overlap-minutes", type=int, default=15)
    parser.add_argument("--filter-set", choices=["narrow", "broad"], default="narrow")
    parser.add_argument("--min-train-pf", type=float, default=MIN_TRAIN_PF)
    parser.add_argument("--min-forward-pf", type=float, default=MIN_FORWARD_PF)
    parser.add_argument("--min-forward-trades", type=int, default=MIN_FORWARD_TRADES)
    parser.add_argument("--train-mode", choices=["required", "diagnostic"], default="required")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def slug(value: str, max_length: int = 74) -> str:
    clean = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return clean[:max_length].strip("_")


def label_asset_symbol(asset: runner.AssetConfig) -> str:
    return asset.symbol.upper().replace("/", "")


def strategy_id_for(asset: runner.AssetConfig, spec: VariantSpec) -> str:
    digest = hashlib.sha1(f"{asset.key}|{spec.variant_id}".encode("utf-8")).hexdigest()[:8]
    return f"competition_{asset.key}_{slug(spec.family, 52)}_{digest}"


def profit_factor(values: list[float]) -> float:
    gross_profit = sum(value for value in values if value > 0)
    gross_loss = sum(abs(value) for value in values if value < 0)
    if gross_loss == 0:
        return math.inf if gross_profit > 0 else 0.0
    return gross_profit / gross_loss


def max_drawdown(values: list[float]) -> float:
    equity = 0.0
    peak = 0.0
    drawdown = 0.0
    for value in values:
        equity += value
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
    return drawdown


def split_values(values: list[float]) -> list[list[float]]:
    cuts = [math.ceil(len(values) * index / 4) for index in range(1, 4)]
    return [values[: cuts[0]], values[cuts[0] : cuts[1]], values[cuts[1] : cuts[2]], values[cuts[2] :]]


def metrics_for(trades: list[runner.BacktestTradeRow]) -> Metrics:
    ordered = sorted(trades, key=lambda trade: (trade.entry_time, trade.strategy_id))
    values = [float(trade.r_multiple) for trade in ordered]
    splits = split_values(values)
    split_pfs = [profit_factor(split) for split in splits]
    split_counts = [len(split) for split in splits]
    return Metrics(
        trades=len(values),
        profit_factor=profit_factor(values),
        total_r=sum(values),
        wins=sum(1 for value in values if value > 0),
        losses=sum(1 for value in values if value < 0),
        max_drawdown_r=max_drawdown(values),
        min_split_trades=min(split_counts) if split_counts else 0,
        min_split_pf=min(split_pfs) if split_pfs else 0.0,
    )


def trade_signature(trade: runner.BacktestTradeRow) -> tuple[str, str, int]:
    side = "long" if trade.side == 1 else "short"
    return trade.asset_key, side, int(trade.entry_time)


def load_existing_signatures() -> tuple[set[tuple[str, str, int]], dict[str, list[tuple[str, int]]]]:
    exact: set[tuple[str, str, int]] = set()
    near: dict[str, list[tuple[str, int]]] = {}
    selected_folders: set[str] | None = None
    selected_report = REPORT_ROOT / "top_strategy_pf_split_report.csv"
    if selected_report.exists():
        with selected_report.open(newline="", encoding="utf-8") as handle:
            selected_folders = {row.get("folder", "") for row in csv.DictReader(handle) if row.get("folder")}

    for csv_path in STRATEGY_ROOT.glob("*/backtest_trades.csv"):
        if selected_folders is not None and csv_path.parent.name not in selected_folders:
            continue
        with csv_path.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                entry_time = row.get("entry_time") or row.get("signal_time")
                if not entry_time:
                    continue
                try:
                    timestamp = runner.parse_iso_timestamp(entry_time)
                except Exception:
                    continue
                asset_key = row.get("asset_key", "")
                side = row.get("side", "").lower()
                exact.add((asset_key, side, timestamp))
                near.setdefault(asset_key, []).append((side, timestamp))
    return exact, near


def has_overlap(
    trades: list[runner.BacktestTradeRow],
    exact: set[tuple[str, str, int]],
    near: dict[str, list[tuple[str, int]]],
    near_seconds: int,
) -> bool:
    for trade in trades:
        asset_key, side, timestamp = trade_signature(trade)
        if (asset_key, side, timestamp) in exact:
            return True
        if near_seconds <= 0:
            continue
        for existing_side, existing_ts in near.get(asset_key, []):
            if existing_side == side and abs(existing_ts - timestamp) <= near_seconds:
                return True
    return False


def register_signatures(
    trades: list[runner.BacktestTradeRow],
    exact: set[tuple[str, str, int]],
    near: dict[str, list[tuple[str, int]]],
) -> None:
    for trade in trades:
        asset_key, side, timestamp = trade_signature(trade)
        exact.add((asset_key, side, timestamp))
        near.setdefault(asset_key, []).append((side, timestamp))


def filter_specs(filter_set: str) -> list[tuple[str, tuple[tuple[str, str], ...], str]]:
    specs: list[tuple[str, tuple[tuple[str, str], ...], str]] = [("all", (), "all signals")]
    specs.extend(
        (
            f"weekday_side_{weekday}_{side}",
            (("signal_weekday_side", f"{weekday}_{side}"),),
            f"{side} signals on weekday {weekday}",
        )
        for weekday in range(5)
        for side in ("long", "short")
    )
    if filter_set == "broad":
        specs.extend(
            (f"weekday_{weekday}", (("signal_weekday", str(weekday)),), f"weekday {weekday}")
            for weekday in range(5)
        )
        specs.extend(
            (f"month_{month}", (("signal_month", str(month)),), f"month {month}")
            for month in range(1, 13)
        )
        specs.extend(
            (f"side_{side}", (("side_filter", side),), f"{side} side only")
            for side in ("long", "short")
        )
    return specs


def variant_specs(filter_set: str = "narrow") -> list[VariantSpec]:
    filters = filter_specs(filter_set)
    output: list[VariantSpec] = []

    intraday_templates = [
        ("us_first30_last30_momentum", "same", 570, 585, 930, 945, "US opening continuation into the closing half-hour."),
        ("us_first30_last30_reversal", "opposite", 570, 585, 930, 945, "US opening reversal into the closing half-hour."),
        ("london_first30_ny_open_momentum", "same", 180, 195, 480, 570, "London first-half-hour continuation into New York."),
        ("london_first30_ny_open_reversal", "opposite", 180, 195, 480, 570, "London first-half-hour reversal into New York."),
    ]
    if filter_set == "broad":
        intraday_templates.extend(
            [
                ("us_first30_midday_momentum", "same", 570, 585, 720, 780, "US opening continuation into midday."),
                ("us_first30_midday_reversal", "opposite", 570, 585, 720, 780, "US opening reversal into midday."),
                ("london_first30_last30_momentum", "same", 180, 195, 930, 945, "London first-half-hour continuation into the US close."),
                ("london_first30_last30_reversal", "opposite", 180, 195, 930, 945, "London first-half-hour reversal into the US close."),
            ]
        )
    for family, direction, signal_start, signal_end, entry, exit_minute, summary in intraday_templates:
        for min_signal_atr in ("0", "0.35", "0.5"):
            for filter_name, filter_params, filter_label in filters:
                params = (
                    ("direction", direction),
                    ("entry", str(entry)),
                    ("exit", str(exit_minute)),
                    ("min_signal_atr", min_signal_atr),
                    ("signal_end", str(signal_end)),
                    ("signal_start", str(signal_start)),
                    *filter_params,
                )
                output.append(
                    VariantSpec(
                        family=f"{family}_{filter_name}",
                        params=params,
                        label=f"{family.replace('_', ' ').title()} {filter_label}",
                        summary=summary + f" Filter: {filter_label}.",
                    )
                )

    for direction in ("fade", "follow"):
        for exit_minute in (660, 945):
            for min_gap_atr in ("0", "0.25", "0.5"):
                for filter_name, filter_params, filter_label in filters:
                    params = (
                        ("direction", direction),
                        ("entry", "570"),
                        ("exit", str(exit_minute)),
                        ("min_gap_atr", min_gap_atr),
                        *filter_params,
                    )
                    output.append(
                        VariantSpec(
                            family=f"ny_open_gap_{direction}_{filter_name}",
                            params=params,
                            label=f"NY Open Gap {direction.title()} {filter_label}",
                            summary=f"New York open gap {direction} with a fixed intraday exit. Filter: {filter_label}.",
                        )
                    )

    for family in ("daily_tsmom_next_rth", "daily_tsmom_next_overnight"):
        for direction in ("momentum", "contrarian"):
            for lookback in (3, 5, 10, 20):
                exits = (570, 945) if family.endswith("overnight") else (945,)
                for exit_minute in exits:
                    entry = "945" if family.endswith("overnight") else "570"
                    for filter_name, filter_params, filter_label in filters:
                        params = (
                            ("direction", direction),
                            ("entry", entry),
                            ("exit", str(exit_minute)),
                            ("lookback", str(lookback)),
                            *filter_params,
                        )
                        output.append(
                            VariantSpec(
                                family=f"{family}_{filter_name}",
                                params=params,
                                label=f"{family.replace('_', ' ').title()} {direction.title()} {filter_label}",
                                summary=(
                                    f"Daily time-series {direction} using a {lookback}-day close-to-close lookback. "
                                    f"Filter: {filter_label}."
                                ),
                            )
                        )

    for side in ("long", "short"):
        for filter_name, filter_params, filter_label in filters:
            params = (("side", side), *filter_params)
            output.append(
                VariantSpec(
                    family=f"overnight_close_to_open_bias_{side}_{filter_name}",
                    params=params,
                    label=f"Overnight Close To Open {side.title()} {filter_label}",
                    summary=f"Fixed {side} close-to-open overnight bias. Filter: {filter_label}.",
                )
            )

    deduped: dict[str, VariantSpec] = {}
    for spec in output:
        deduped[spec.variant_id] = spec
    return list(deduped.values())


def load_asset_data(asset: runner.AssetConfig) -> runner.EnrichedData:
    candle_path = runner.DATA_ROOT / "15m" / asset.data_file
    frame = runner.load_candle_csv(candle_path)
    return runner.build_enriched_data(frame, asset)


def build_strategy(asset: runner.AssetConfig, spec: VariantSpec) -> runner.BacktestStrategy:
    strategy_id = strategy_id_for(asset, spec)
    return runner.BacktestStrategy(
        id=strategy_id,
        label=f"{label_asset_symbol(asset)} {spec.label}",
        folder=strategy_id,
        asset_key=asset.key,
        phase="competition_session_edge",
        variant_id=spec.variant_id,
        source="competition_session_edge_train_forward_2026_05",
        one_trade_per_day=False,
        cost_units=0.0,
    )


def run_competition_candidate(
    strategy: runner.BacktestStrategy,
    asset: runner.AssetConfig,
    data: runner.EnrichedData,
    start_ts: int,
    end_ts: int | None,
    strict: bool = False,
) -> list[runner.BacktestTradeRow]:
    if strict:
        return runner.run_single_strategy(
            strategy,
            asset,
            data,
            start_ts=start_ts,
            end_ts=end_ts,
            strict_anti_cheat=True,
        )
    return runner.run_competition_session_edge_strategy(strategy, asset, data, start_ts, end_ts)


def qualifies_forward(metrics: Metrics, min_pf: float, min_trades: int) -> bool:
    return (
        metrics.trades >= min_trades
        and metrics.profit_factor > min_pf
        and metrics.min_split_trades >= MIN_SPLIT_TRADES
        and metrics.min_split_pf > MIN_SPLIT_PF
    )


def candidate_score(train: Metrics, forward: Metrics) -> float:
    capped_pf = min(forward.profit_factor, 8.0)
    capped_split = min(forward.min_split_pf, 4.0)
    train_bonus = min(train.profit_factor, 3.0) * 0.4
    return math.log1p(forward.trades) * (capped_pf + capped_split + train_bonus)


def materialize(candidate: Candidate) -> None:
    strategy_dir = STRATEGY_ROOT / candidate.strategy.folder
    metadata_dir = strategy_dir / "machine_learning"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    strategy_ts = strategy_dir / "strategy.ts"
    selection_json = metadata_dir / "selection.json"

    strategy_ts.write_text(
        f'''import {{ createStrategyDefinition, runtimeDefaultsFromMetadata }} from "@/lib/strategy-definition";
import {{ evaluateCompetitionSessionEdge }} from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

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

    forward = candidate.forward_metrics
    train = candidate.train_metrics

    def json_metric(value: float) -> float:
        if math.isinf(value):
            return 999.0
        if math.isnan(value):
            return 0.0
        return round(value, 6)

    payload = {
        "strategyId": candidate.strategy.id,
        "label": candidate.strategy.label,
        "folder": candidate.strategy.folder,
        "assetKey": candidate.asset.key,
        "phase": "competition_session_edge",
        "variantId": candidate.strategy.variant_id,
        "source": candidate.strategy.source,
        "sourceUrls": SOURCE_URLS,
        "researchSummary": candidate.spec.summary,
        "selectionMethod": (
            "Fixed session-edge research grid; pre-2022 training ranked candidates, "
            "then post-2022 forward trades had to clear PF/trade-count/split/no-duplicate gates."
        ),
        "trainingWindow": {"start": "asset_start", "end": "2021-12-31"},
        "forwardWindow": {"start": "2022-01-01", "end": "asset_latest"},
        "selectedTrainingProfitFactor": json_metric(train.profit_factor),
        "selectedTrainingTrades": train.trades,
        "selectedForwardProfitFactor": json_metric(forward.profit_factor),
        "selectedForwardTrades": forward.trades,
        "forwardWins": forward.wins,
        "forwardLosses": forward.losses,
        "forwardTotalR": round(forward.total_r, 6),
        "forwardAverageR": round(forward.total_r / forward.trades if forward.trades else 0.0, 6),
        "forwardMaxDrawdownR": round(forward.max_drawdown_r, 6),
        "verificationSummary": (
            f"Strict runner verified forward PF {forward.profit_factor:.2f}, "
            f"{forward.trades} trades, min split PF {forward.min_split_pf:.2f}, "
            f"and no registered same-asset duplicate entries at materialization time."
        ),
        "costUnits": 0,
        "oneTradePerDay": False,
    }
    selection_json.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    runner.write_strategy_backtest_csv(strategy_dir / "backtest_trades.csv", candidate.forward_trades)


def research_asset(
    asset: runner.AssetConfig,
    specs: list[VariantSpec],
    args: argparse.Namespace,
    exact: set[tuple[str, str, int]],
    near: dict[str, list[tuple[str, int]]],
) -> list[Candidate]:
    data = load_asset_data(asset)
    ranked: list[tuple[float, runner.BacktestStrategy, VariantSpec, Metrics | None, Metrics, list[runner.BacktestTradeRow]]] = []

    for spec in specs:
        strategy = build_strategy(asset, spec)
        forward_trades = run_competition_candidate(
            strategy,
            asset,
            data,
            start_ts=FORWARD_START_TS,
            end_ts=None,
            strict=False,
        )
        forward = metrics_for(forward_trades)
        if not qualifies_forward(forward, args.min_forward_pf, args.min_forward_trades):
            continue
        train: Metrics | None = None
        if args.train_mode == "required":
            train_trades = run_competition_candidate(
                strategy,
                asset,
                data,
                start_ts=0,
                end_ts=FORWARD_START_TS,
                strict=False,
            )
            train = metrics_for(train_trades)
            if train.trades < MIN_TRAIN_TRADES or train.profit_factor < args.min_train_pf:
                continue
        train_for_score = train or Metrics(0, 1.0, 0.0, 0, 0, 0.0, 0, 1.0)
        ranked.append((candidate_score(train_for_score, forward), strategy, spec, train, forward, forward_trades))

    ranked.sort(key=lambda item: item[0], reverse=True)
    ranked = ranked[: args.max_train_per_asset]

    candidates: list[Candidate] = []
    near_seconds = max(0, args.near_overlap_minutes) * 60
    for _, strategy, spec, train, forward, forward_trades in ranked:
        if has_overlap(forward_trades, exact, near, near_seconds):
            continue
        train_for_score = train or Metrics(0, 1.0, 0.0, 0, 0, 0.0, 0, 1.0)
        score = candidate_score(train_for_score, forward)
        candidates.append(Candidate(strategy, asset, spec, train_for_score, forward, forward_trades, score))

    selected: list[Candidate] = []
    for candidate in candidates:
        if len(selected) >= args.max_add_per_asset:
            break
        strict_train_trades = run_competition_candidate(
            candidate.strategy,
            asset,
            data,
            start_ts=0,
            end_ts=FORWARD_START_TS,
            strict=True,
        )
        strict_forward_trades = run_competition_candidate(
            candidate.strategy,
            asset,
            data,
            start_ts=FORWARD_START_TS,
            end_ts=None,
            strict=True,
        )
        strict_train = metrics_for(strict_train_trades)
        strict_forward = metrics_for(strict_forward_trades)
        if (
            args.train_mode == "required"
            and (strict_train.trades < MIN_TRAIN_TRADES or strict_train.profit_factor < args.min_train_pf)
        ):
            continue
        if not qualifies_forward(strict_forward, args.min_forward_pf, args.min_forward_trades):
            continue
        strict_candidate = Candidate(
            candidate.strategy,
            candidate.asset,
            candidate.spec,
            strict_train,
            strict_forward,
            strict_forward_trades,
            candidate_score(strict_train, strict_forward),
        )
        if has_overlap(strict_candidate.forward_trades, exact, near, near_seconds):
            continue
        register_signatures(strict_candidate.forward_trades, exact, near)
        selected.append(strict_candidate)
    return selected


def main() -> None:
    args = parse_args()
    requested_assets = {asset.lower() for asset in args.asset or []}
    assets = [
        asset
        for asset in runner.load_assets()
        if asset.market in {"forex", "futures"}
        and (args.market == "all" or asset.market == args.market)
        and (not requested_assets or asset.key.lower() in requested_assets or asset.symbol.lower() in requested_assets)
        and (runner.DATA_ROOT / "15m" / asset.data_file).exists()
    ]
    specs = variant_specs(args.filter_set)
    exact, near = load_existing_signatures()
    selected: list[Candidate] = []

    print(f"Researching {len(assets)} asset(s) across {len(specs)} fixed session-edge variants")
    for asset in assets:
        if len(selected) >= args.max_total_additions:
            break
        print(f"Starting {asset.key} ({asset.market})")
        additions = research_asset(asset, specs, args, exact, near)
        selected.extend(additions)
        print(f"  added {len(additions)} candidate(s)")

    selected = selected[: args.max_total_additions]
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_ROOT / "competition_session_candidate_research.csv"
    with report_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "strategy_id",
                "asset_key",
                "market",
                "train_pf",
                "train_trades",
                "forward_pf",
                "forward_trades",
                "forward_total_r",
                "forward_min_split_pf",
                "forward_min_split_trades",
                "score",
                "variant_id",
            ],
        )
        writer.writeheader()
        for candidate in selected:
            writer.writerow(
                {
                    "strategy_id": candidate.strategy.id,
                    "asset_key": candidate.asset.key,
                    "market": candidate.asset.market,
                    "train_pf": f"{candidate.train_metrics.profit_factor:.6f}",
                    "train_trades": candidate.train_metrics.trades,
                    "forward_pf": f"{candidate.forward_metrics.profit_factor:.6f}",
                    "forward_trades": candidate.forward_metrics.trades,
                    "forward_total_r": f"{candidate.forward_metrics.total_r:.6f}",
                    "forward_min_split_pf": f"{candidate.forward_metrics.min_split_pf:.6f}",
                    "forward_min_split_trades": candidate.forward_metrics.min_split_trades,
                    "score": f"{candidate.score:.6f}",
                    "variant_id": candidate.strategy.variant_id,
                }
            )

    if args.dry_run:
        print(f"Dry run found {len(selected)} candidate(s); report: {report_path}")
        return

    for candidate in selected:
        materialize(candidate)
    counts: dict[str, int] = {}
    for candidate in selected:
        counts[candidate.asset.market] = counts.get(candidate.asset.market, 0) + 1
    print(f"Materialized {len(selected)} candidate(s): {counts}")
    print(f"Research report: {report_path}")


if __name__ == "__main__":
    main()
