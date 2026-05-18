from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import random
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backtest-engine"))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

import runner  # noqa: E402
import research_competition_session_candidates as research  # noqa: E402


STRATEGY_ROOT = PROJECT_ROOT / "strategy"
LOADER_PATH = PROJECT_ROOT / "src" / "lib" / "strategy-loader.ts"
REPORT_ROOT = PROJECT_ROOT / "Research" / "reports"
FORWARD_START_TS = runner.BACKTEST_START_TS

MIN_SPLIT_TRADES = 5
MIN_SPLIT_PF = 1.0
SOURCE_URLS = [
    "https://w4.stern.nyu.edu/facdir/lpederse/papers/TimeSeriesMomentum.pdf",
    "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2694985",
    "https://www.semanticscholar.org/paper/The-Probability-of-Backtest-Overfitting-Bailey-Borwein/b1233b4f5384f003e85c2e0eec1a2dfc08f624c5",
]


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
class Target:
    folder: str
    metadata_path: Path
    metadata: dict[str, Any]
    strategy: runner.BacktestStrategy
    baseline: Metrics
    baseline_rr: float


@dataclass(frozen=True)
class CandidateSpec:
    variant_id: str
    label: str
    summary: str
    risk_reward: float
    family: str


@dataclass(frozen=True)
class Candidate:
    target: Target
    spec: CandidateSpec
    fast_metrics: Metrics
    train_metrics: Metrics
    strict_metrics: Metrics
    strict_trades: list[runner.BacktestTradeRow]
    min_planned_rr: float
    score: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Find and apply true bracket RR>=2 replacements for active 1R strategies.")
    parser.add_argument("--rr", default="3,2,4,5", help="Comma-separated RR values to scan. Values below 2 are ignored.")
    parser.add_argument("--filter-set", choices=["narrow", "broad"], default="broad")
    parser.add_argument("--mode", choices=["direct", "local", "narrow", "broad"], default="local")
    parser.add_argument("--weakest-targets", type=int, default=45)
    parser.add_argument("--max-specs-per-asset", type=int, default=1800)
    parser.add_argument("--min-trades", type=int, default=20)
    parser.add_argument("--preferred-min-trades", type=int, default=50)
    parser.add_argument("--min-train-trades", type=int, default=20)
    parser.add_argument("--min-train-pf", type=float, default=0.80)
    parser.add_argument("--min-bootstrap-p05", type=float, default=1.0)
    parser.add_argument("--near-overlap-minutes", type=int, default=15)
    parser.add_argument("--max-fast-per-asset", type=int, default=260)
    parser.add_argument("--max-strict-per-target", type=int, default=80)
    parser.add_argument("--max-replacements", type=int, default=100)
    parser.add_argument("--asset", action="append", help="Limit to one asset key or symbol. Repeat for more.")
    parser.add_argument("--apply", action="store_true", help="Write selected replacements into strategy folders.")
    return parser.parse_args()


def loader_folders() -> list[str]:
    text = LOADER_PATH.read_text(encoding="utf-8")
    return re.findall(r'@strategy/([^/]+)/strategy', text)


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_params(variant_id: str) -> dict[str, str]:
    params: dict[str, str] = {}
    for token in str(variant_id or "").split("|")[1:]:
        if "=" not in token:
            continue
        key, value = token.split("=", 1)
        params[key.strip()] = value.strip()
    return params


def risk_reward_from_variant(variant_id: str) -> float | None:
    params = parse_params(variant_id)
    for key in ("risk_reward", "rr"):
        raw = params.get(key)
        if raw is None:
            continue
        try:
            value = float(raw)
        except ValueError:
            continue
        if math.isfinite(value) and value > 0:
            return value
    return None


def uses_bracket(variant_id: str) -> bool:
    return parse_params(variant_id).get("managed_exit") in {"bracket", "stop_target"}


def canonical_variant(variant_id: str) -> str:
    tokens = [token for token in str(variant_id or "").split("|") if token]
    if not tokens:
        return ""
    head, tail = tokens[0], tokens[1:]
    keyed: dict[str, str] = {}
    loose: list[str] = []
    for token in tail:
        if "=" not in token:
            loose.append(token)
            continue
        key, value = token.split("=", 1)
        keyed[key] = value
    return "|".join([head, *loose, *(f"{key}={keyed[key]}" for key in sorted(keyed))])


def with_true_rr(variant_id: str, rr: float) -> str:
    tokens = [token for token in str(variant_id or "").split("|") if token]
    if not tokens:
        tokens = ["competition_session_edge"]
    cleaned = [
        token
        for token in tokens
        if not token.startswith("risk_reward=")
        and not token.startswith("rr=")
        and not token.startswith("managed_exit=")
    ]
    rr_text = str(int(rr)) if float(rr).is_integer() else str(rr)
    return "|".join([*cleaned, f"risk_reward={rr_text}", "managed_exit=bracket"])


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
    cuts = [math.ceil(len(values) * index / parts) for index in range(1, parts)]
    output: list[list[float]] = []
    start = 0
    for cut in [*cuts, len(values)]:
        output.append(values[start:cut])
        start = cut
    return output


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * pct) - 1))
    return ordered[index]


def bootstrap_pf_p05(values: list[float], seed: int, samples: int = 400) -> float:
    if not values:
        return 0.0
    rng = random.Random(seed)
    pfs: list[float] = []
    for _ in range(samples):
        draw = [values[rng.randrange(len(values))] for _ in range(len(values))]
        pfs.append(profit_factor(draw))
    return percentile(pfs, 0.05)


def metrics_for(trades: list[runner.BacktestTradeRow]) -> Metrics:
    ordered = sorted(trades, key=lambda trade: (trade.entry_time, trade.strategy_id))
    values = [float(trade.r_multiple) for trade in ordered]
    splits = split_values(values) if values else [[]]
    split_pfs = [profit_factor(split) for split in splits if split]
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


def parse_timestamp(value: str) -> int:
    return runner.parse_iso_timestamp(value)


def read_trade_rows(csv_path: Path) -> list[dict[str, str]]:
    with csv_path.open("r", newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def baseline_metrics(csv_path: Path) -> tuple[Metrics, float]:
    rows = read_trade_rows(csv_path)
    values: list[float] = []
    rr_values: list[float] = []
    for row in rows:
        try:
            values.append(float(row["r_multiple"]))
        except (KeyError, ValueError):
            continue
        try:
            tp_units = abs(float(row.get("tp_units", "") or 0.0))
            sl_units = abs(float(row.get("sl_units", "") or 0.0))
        except ValueError:
            tp_units = 0.0
            sl_units = 0.0
        if tp_units > 0 and sl_units > 0:
            rr_values.append(tp_units / sl_units)
    pseudo_trades = [
        runner.BacktestTradeRow(
            strategy_id="baseline",
            asset_key="",
            asset_name="",
            market="",
            symbol="",
            phase="",
            variant_id="",
            side=1,
            signal_time=index,
            entry_index=index,
            exit_index=index,
            entry_time=index,
            exit_time=index,
            entry_price=0.0,
            exit_price=0.0,
            net_units=value,
            r_multiple=value,
            tp_units=0.0,
            sl_units=0.0,
            cost_units=0.0,
            exit_reason="",
            bars_held=1,
            source="",
            tp_mode="",
            sl_mode="",
            size_mode="",
            size_multiplier=1.0,
        )
        for index, value in enumerate(values)
    ]
    return metrics_for(pseudo_trades), min(rr_values) if rr_values else 1.0


def load_strategy_from_metadata(folder: str, metadata_path: Path, metadata: dict[str, Any]) -> runner.BacktestStrategy:
    return runner.BacktestStrategy(
        id=str(metadata.get("strategyId") or folder),
        label=str(metadata.get("label") or folder),
        folder=folder,
        asset_key=str(metadata["assetKey"]),
        phase=str(metadata["phase"]),
        variant_id=str(metadata["variantId"]),
        source=str(metadata.get("source") or "strategy_metadata"),
        one_trade_per_day=bool(metadata.get("oneTradePerDay", False)),
        cost_units=float(metadata.get("costUnits", 0.0) or 0.0),
        metadata_path=metadata_path,
    )


def active_targets(asset_filter: set[str]) -> list[Target]:
    targets: list[Target] = []
    for folder in loader_folders():
        metadata_path = STRATEGY_ROOT / folder / "machine_learning" / "selection.json"
        if not metadata_path.exists():
            continue
        metadata = read_json(metadata_path)
        if metadata.get("phase") != "competition_session_edge":
            continue
        asset_key = str(metadata.get("assetKey") or "")
        if asset_filter and asset_key.lower() not in asset_filter:
            continue
        variant_id = str(metadata.get("variantId") or "")
        rr = risk_reward_from_variant(variant_id)
        true_bracket = rr is not None and rr >= 2.0 and uses_bracket(variant_id)
        if true_bracket:
            continue
        csv_path = STRATEGY_ROOT / folder / "backtest_trades.csv"
        if not csv_path.exists():
            continue
        baseline, baseline_rr = baseline_metrics(csv_path)
        targets.append(
            Target(
                folder=folder,
                metadata_path=metadata_path,
                metadata=metadata,
                strategy=load_strategy_from_metadata(folder, metadata_path, metadata),
                baseline=baseline,
                baseline_rr=min(baseline_rr, rr or baseline_rr),
            )
        )
    return targets


def load_asset_data(asset: runner.AssetConfig) -> runner.EnrichedData:
    frame = runner.load_candle_csv(runner.DATA_ROOT / "15m" / asset.data_file)
    return runner.build_enriched_data(frame, asset)


def symbol_label(asset: runner.AssetConfig) -> str:
    return asset.symbol.upper().replace("/", "")


def candidate_label(asset: runner.AssetConfig, spec: CandidateSpec) -> str:
    return f"{symbol_label(asset)} {spec.label}"


def candidate_summary(spec: CandidateSpec) -> str:
    return f"{spec.summary} Uses true bracket stop/target management at {spec.risk_reward:g}:1 planned reward-to-risk."


def build_candidate_strategy(target: Target, asset: runner.AssetConfig, spec: CandidateSpec) -> runner.BacktestStrategy:
    return runner.BacktestStrategy(
        id=target.strategy.id,
        label=candidate_label(asset, spec),
        folder=target.folder,
        asset_key=asset.key,
        phase="competition_session_edge",
        variant_id=spec.variant_id,
        source=str(target.metadata.get("source") or "true_rr_replacement_search_2026_05"),
        one_trade_per_day=False,
        cost_units=float(target.metadata.get("costUnits", 0.0) or 0.0),
        metadata_path=target.metadata_path,
    )


def parse_rr_values(raw: str) -> list[float]:
    values: list[float] = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        try:
            value = float(item)
        except ValueError:
            continue
        if math.isfinite(value) and value >= 2:
            values.append(value)
    return sorted(set(values), reverse=True) or [3.0, 2.0]


def spec_from_research(spec: research.VariantSpec) -> CandidateSpec:
    params = tuple((key, value) for key, value in spec.params if key not in {"managed_exit"})
    params = (*params, ("managed_exit", "bracket"))
    variant_id = "|".join(
        [
            "competition_session_edge",
            f"family={spec.family}",
            *(f"{key}={value}" for key, value in params),
        ]
    )
    rr = risk_reward_from_variant(variant_id) or 2.0
    return CandidateSpec(
        variant_id=variant_id,
        label=spec.label,
        summary=spec.summary,
        risk_reward=rr,
        family=spec.family,
    )


def direct_specs(target: Target, rr_values: list[float]) -> list[CandidateSpec]:
    params = parse_params(target.strategy.variant_id)
    family = params.get("family", "")
    base_label = str(target.metadata.get("label") or target.strategy.label)
    summary = str(target.metadata.get("researchSummary") or "Existing strategy variant retested with true bracket exits.")
    specs: list[CandidateSpec] = []
    for rr in rr_values:
        variant_id = with_true_rr(target.strategy.variant_id, rr)
        specs.append(
            CandidateSpec(
                variant_id=variant_id,
                label=f"{base_label} true {rr:g}R",
                summary=summary,
                risk_reward=rr,
                family=family,
            )
        )
    return specs


def family_base(family: str) -> str:
    output = family
    output = re.sub(r"_weekday_side_\d+_(?:long|short)$", "", output)
    output = re.sub(r"_month_\d+$", "", output)
    output = re.sub(r"_weekday_\d+$", "", output)
    output = re.sub(r"_side_(?:long|short)$", "", output)
    return output


def filter_variants() -> list[tuple[str, tuple[tuple[str, str], ...], str]]:
    output: list[tuple[str, tuple[tuple[str, str], ...], str]] = [("all", (), "all signals")]
    output.extend(
        (
            f"weekday_side_{weekday}_{side}",
            (("signal_weekday_side", f"{weekday}_{side}"),),
            f"{side} signals on weekday {weekday}",
        )
        for weekday in range(5)
        for side in ("long", "short")
    )
    output.extend(
        (f"month_{month}", (("signal_month", str(month)),), f"month {month}")
        for month in range(1, 13)
    )
    output.extend(
        (f"side_{side}", (("side_filter", side),), f"{side} signals")
        for side in ("long", "short")
    )
    return output


def local_mutation_specs(target: Target, rr_values: list[float]) -> list[CandidateSpec]:
    params = parse_params(target.strategy.variant_id)
    family = family_base(params.get("family", ""))
    if not family:
        return direct_specs(target, rr_values)
    base_params = {
        key: value
        for key, value in params.items()
        if key
        not in {
            "family",
            "risk_reward",
            "rr",
            "managed_exit",
            "signal_weekday",
            "signal_weekday_side",
            "signal_month",
            "side_filter",
        }
    }
    specs: dict[str, CandidateSpec] = {}

    def add_spec(mutated: dict[str, str], filter_name: str, filter_params: tuple[tuple[str, str], ...], filter_label: str, rr: float) -> None:
        rr_text = str(int(rr)) if float(rr).is_integer() else str(rr)
        family_name = family if filter_name == "all" else f"{family}_{filter_name}"
        pieces = [
            "competition_session_edge",
            f"family={family_name}",
            *(f"{key}={value}" for key, value in sorted(mutated.items())),
            *(f"{key}={value}" for key, value in filter_params),
            f"risk_reward={rr_text}",
            "managed_exit=bracket",
        ]
        variant_id = "|".join(pieces)
        label_family = family.replace("_", " ").title()
        spec = CandidateSpec(
            variant_id=variant_id,
            label=f"{label_family} {filter_label} true {rr:g}R",
            summary=f"Local mutation of {label_family}; filter: {filter_label}.",
            risk_reward=rr,
            family=family_name,
        )
        specs[canonical_variant(variant_id)] = spec

    filters = filter_variants()
    for rr in rr_values:
        for filter_name, filter_params, filter_label in filters:
            if family.startswith(("us_first30", "us_secondlast", "london_first30")):
                for direction in ("same", "opposite"):
                    for min_signal_atr in ("0", "0.2", "0.35", "0.5", "0.75", "1"):
                        mutated = dict(base_params)
                        mutated["direction"] = direction
                        mutated["min_signal_atr"] = min_signal_atr
                        mutated.setdefault("signal_start", params.get("signal_start", "570"))
                        mutated.setdefault("signal_end", params.get("signal_end", "585"))
                        mutated.setdefault("entry", params.get("entry", "930"))
                        mutated.setdefault("exit", params.get("exit", "945"))
                        add_spec(mutated, filter_name, filter_params, filter_label, rr)
            elif family.startswith("ny_open_gap"):
                for direction in ("fade", "follow"):
                    for min_gap_atr in ("0", "0.25", "0.5", "0.75", "1"):
                        mutated = dict(base_params)
                        mutated["direction"] = direction
                        mutated["min_gap_atr"] = min_gap_atr
                        mutated.setdefault("entry", params.get("entry", "570"))
                        mutated.setdefault("exit", params.get("exit", "945"))
                        add_spec(mutated, filter_name, filter_params, filter_label, rr)
            elif family.startswith("daily_tsmom"):
                for direction in ("momentum", "contrarian"):
                    for lookback in ("3", "5", "10", "20"):
                        mutated = dict(base_params)
                        mutated["direction"] = direction
                        mutated["lookback"] = lookback
                        mutated.setdefault("entry", params.get("entry", "945" if family.endswith("overnight") else "570"))
                        mutated.setdefault("exit", params.get("exit", "570" if family.endswith("overnight") else "945"))
                        add_spec(mutated, filter_name, filter_params, filter_label, rr)
            elif family.startswith("overnight_close_to_open_bias"):
                for side in ("long", "short"):
                    mutated = dict(base_params)
                    mutated["side"] = side
                    add_spec(mutated, filter_name, filter_params, filter_label, rr)
            elif family.startswith(("asia_range", "ny_opening_range")):
                mutated = dict(base_params)
                add_spec(mutated, filter_name, filter_params, filter_label, rr)

    for spec in direct_specs(target, rr_values):
        specs[canonical_variant(spec.variant_id)] = spec
    return list(specs.values())


def build_spec_pool(
    targets_by_asset: dict[str, list[Target]],
    rr_values: list[float],
    filter_set: str,
    mode: str,
    max_specs_per_asset: int,
) -> dict[str, list[CandidateSpec]]:
    rr_text = tuple(str(int(value)) if float(value).is_integer() else str(value) for value in rr_values)
    research_specs = [] if mode == "local" else [spec_from_research(spec) for spec in research.variant_specs(filter_set, rr_text)]
    by_asset: dict[str, dict[str, CandidateSpec]] = {}
    for asset_key, targets in targets_by_asset.items():
        deduped: dict[str, CandidateSpec] = {}
        for spec in research_specs:
            deduped[canonical_variant(spec.variant_id)] = spec
        for target in targets:
            local_specs = local_mutation_specs(target, rr_values) if mode == "local" else direct_specs(target, rr_values)
            for spec in local_specs:
                deduped[canonical_variant(spec.variant_id)] = spec
        values = list(deduped.values())
        if max_specs_per_asset > 0:
            values.sort(key=lambda spec: (spec.risk_reward, "weekday_side" in spec.variant_id, "month" in spec.variant_id), reverse=True)
            values = values[:max_specs_per_asset]
        by_asset[asset_key] = {canonical_variant(spec.variant_id): spec for spec in values}
    return {asset_key: list(specs.values()) for asset_key, specs in by_asset.items()}


def qualifies_fast(metrics: Metrics, min_pf: float, min_trades: int) -> bool:
    return (
        metrics.trades >= min_trades
        and metrics.profit_factor + 1e-12 >= min_pf
        and metrics.min_split_trades >= MIN_SPLIT_TRADES
        and metrics.min_split_pf > MIN_SPLIT_PF
    )


def candidate_score(metrics: Metrics, train: Metrics, rr: float) -> float:
    capped_pf = min(metrics.profit_factor, 10.0)
    capped_train = min(max(train.profit_factor, 0.0), 4.0)
    return capped_pf * 10.0 + math.log1p(metrics.trades) * 3.0 + rr * 2.0 + capped_train


def min_planned_rr(trades: list[runner.BacktestTradeRow]) -> float:
    ratios = [abs(trade.tp_units) / abs(trade.sl_units) for trade in trades if abs(trade.tp_units) > 0 and abs(trade.sl_units) > 0]
    return min(ratios) if ratios else 0.0


def trade_signature_from_row(row: dict[str, str]) -> tuple[str, str, int] | None:
    timestamp_value = row.get("entry_time") or row.get("signal_time")
    if not timestamp_value:
        return None
    try:
        timestamp = parse_timestamp(timestamp_value)
    except Exception:
        return None
    return row.get("asset_key", ""), row.get("side", "").lower(), timestamp


def trade_signature(trade: runner.BacktestTradeRow) -> tuple[str, str, int]:
    return trade.asset_key, "long" if trade.side == 1 else "short", int(trade.entry_time)


def load_folder_signatures(folders: list[str]) -> dict[str, list[tuple[str, str, int]]]:
    output: dict[str, list[tuple[str, str, int]]] = {}
    for folder in folders:
        csv_path = STRATEGY_ROOT / folder / "backtest_trades.csv"
        if not csv_path.exists():
            output[folder] = []
            continue
        signatures = [signature for row in read_trade_rows(csv_path) if (signature := trade_signature_from_row(row))]
        output[folder] = signatures
    return output


def merged_signatures(
    by_folder: dict[str, list[tuple[str, str, int]]],
    exclude_folders: set[str],
) -> tuple[set[tuple[str, str, int]], dict[str, list[tuple[str, int]]]]:
    exact: set[tuple[str, str, int]] = set()
    near: dict[str, list[tuple[str, int]]] = {}
    for folder, signatures in by_folder.items():
        if folder in exclude_folders:
            continue
        for asset_key, side, timestamp in signatures:
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


def register_trades(
    trades: list[runner.BacktestTradeRow],
    exact: set[tuple[str, str, int]],
    near: dict[str, list[tuple[str, int]]],
) -> None:
    for trade in trades:
        asset_key, side, timestamp = trade_signature(trade)
        exact.add((asset_key, side, timestamp))
        near.setdefault(asset_key, []).append((side, timestamp))


def evaluate_asset_specs(
    asset: runner.AssetConfig,
    targets: list[Target],
    specs: list[CandidateSpec],
    args: argparse.Namespace,
) -> list[tuple[CandidateSpec, Metrics, Metrics, float]]:
    data = load_asset_data(asset)
    min_asset_pf = min(target.baseline.profit_factor for target in targets)
    min_pf_floor = max(1.95, min_asset_pf - 0.05)
    rows: list[tuple[CandidateSpec, Metrics, Metrics, float]] = []
    dummy_target = targets[0]
    seen = set()

    for index, spec in enumerate(specs, start=1):
        key = canonical_variant(spec.variant_id)
        if key in seen:
            continue
        seen.add(key)
        strategy = build_candidate_strategy(dummy_target, asset, spec)
        fast_trades = runner.run_competition_session_edge_strategy(
            strategy,
            asset,
            data,
            start_ts=FORWARD_START_TS,
            end_ts=None,
        )
        fast = metrics_for(fast_trades)
        if not qualifies_fast(fast, min_pf_floor, args.min_trades):
            continue
        train_trades = runner.run_competition_session_edge_strategy(
            strategy,
            asset,
            data,
            start_ts=0,
            end_ts=FORWARD_START_TS,
        )
        train = metrics_for(train_trades)
        if train.trades < args.min_train_trades or train.profit_factor < args.min_train_pf:
            continue
        rows.append((spec, fast, train, candidate_score(fast, train, spec.risk_reward)))

    rows.sort(key=lambda row: (row[3], row[1].profit_factor, row[1].trades), reverse=True)
    return rows[: args.max_fast_per_asset]


def select_replacements(
    assets: dict[str, runner.AssetConfig],
    targets_by_asset: dict[str, list[Target]],
    candidates_by_asset: dict[str, list[tuple[CandidateSpec, Metrics, Metrics, float]]],
    args: argparse.Namespace,
) -> list[Candidate]:
    folder_signatures = load_folder_signatures(loader_folders())
    selected: list[Candidate] = []
    selected_variants: set[tuple[str, str]] = set()
    replaced_folders: set[str] = set()
    near_seconds = max(0, args.near_overlap_minutes) * 60
    data_cache: dict[str, runner.EnrichedData] = {}

    ranked_targets = sorted(
        (target for targets in targets_by_asset.values() for target in targets),
        key=lambda target: (target.baseline.profit_factor, -target.baseline.trades),
    )

    for target in ranked_targets:
        if len(selected) >= args.max_replacements:
            break
        asset = assets[target.strategy.asset_key]
        candidates = candidates_by_asset.get(asset.key, [])
        strict_attempts = 0
        exact, near = merged_signatures(folder_signatures, {target.folder, *replaced_folders})
        for spec, fast, train, _score in candidates:
            if strict_attempts >= args.max_strict_per_target:
                break
            if (asset.key, canonical_variant(spec.variant_id)) in selected_variants:
                continue
            required_trades = args.min_trades if target.baseline.trades < args.preferred_min_trades else args.preferred_min_trades
            if fast.trades < required_trades:
                continue
            if fast.profit_factor + 1e-12 < target.baseline.profit_factor:
                continue
            if not (spec.risk_reward >= 2 and uses_bracket(spec.variant_id)):
                continue

            data = data_cache.get(asset.key)
            if data is None:
                data = load_asset_data(asset)
                data_cache[asset.key] = data
            strategy = build_candidate_strategy(target, asset, spec)
            strict_attempts += 1
            strict_trades = runner.run_single_strategy(
                strategy,
                asset,
                data,
                start_ts=FORWARD_START_TS,
                end_ts=None,
                strict_anti_cheat=True,
            )
            strict = metrics_for(strict_trades)
            planned_rr = min_planned_rr(strict_trades)
            if strict.trades < required_trades:
                continue
            if strict.profit_factor + 1e-12 < target.baseline.profit_factor:
                continue
            if strict.min_split_trades < MIN_SPLIT_TRADES or strict.min_split_pf <= MIN_SPLIT_PF:
                continue
            if planned_rr + 1e-9 < 2.0:
                continue
            seed = int(hashlib.sha1(f"{target.strategy.id}|{spec.variant_id}".encode("utf-8")).hexdigest()[:8], 16)
            if bootstrap_pf_p05([float(trade.r_multiple) for trade in strict_trades], seed) <= args.min_bootstrap_p05:
                continue
            if has_overlap(strict_trades, exact, near, near_seconds):
                continue

            selected_candidate = Candidate(
                target=target,
                spec=spec,
                fast_metrics=fast,
                train_metrics=train,
                strict_metrics=strict,
                strict_trades=strict_trades,
                min_planned_rr=planned_rr,
                score=candidate_score(strict, train, spec.risk_reward),
            )
            selected.append(selected_candidate)
            selected_variants.add((asset.key, canonical_variant(spec.variant_id)))
            replaced_folders.add(target.folder)
            register_trades(strict_trades, exact, near)
            break
    return selected


def json_metric(value: float) -> float:
    if math.isinf(value):
        return 999.0
    if math.isnan(value):
        return 0.0
    return round(value, 6)


def write_strategy_ts(path: Path, strategy: runner.BacktestStrategy) -> None:
    path.write_text(
        f'''import {{ createStrategyDefinition, runtimeDefaultsFromMetadata }} from "@/lib/strategy-definition";
import {{ evaluateCompetitionSessionEdge }} from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({{
  id: "{strategy.id}",
  label: "{strategy.label}",
  folder: "{strategy.folder}",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "{strategy.asset_key}",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
}});
''',
        encoding="utf-8",
    )


def apply_replacement(candidate: Candidate, asset: runner.AssetConfig) -> None:
    target = candidate.target
    strategy = build_candidate_strategy(target, asset, candidate.spec)
    strategy_dir = STRATEGY_ROOT / target.folder
    metadata_dir = strategy_dir / "machine_learning"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    forward = candidate.strict_metrics
    train = candidate.train_metrics
    payload = dict(target.metadata)
    payload.update(
        {
            "strategyId": strategy.id,
            "label": strategy.label,
            "folder": strategy.folder,
            "assetKey": asset.key,
            "phase": "competition_session_edge",
            "variantId": strategy.variant_id,
            "source": strategy.source,
            "sourceUrls": payload.get("sourceUrls") or SOURCE_URLS,
            "researchSummary": candidate_summary(candidate.spec),
            "selectionMethod": (
                "True-RR replacement search; pre-2022 train metrics were checked before post-2022 forward "
                "acceptance. Replacement required strict anti-cheat rerun, same-or-better forward PF, "
                "split stability, true planned TP/SL ratio, and no same-asset duplicate entries."
            ),
            "trainingWindow": {"start": "asset_start", "end": "2021-12-31"},
            "forwardWindow": {"start": "2022-01-01", "end": "asset_latest"},
            "selectedTrainingProfitFactor": json_metric(train.profit_factor),
            "selectedTrainingTrades": train.trades,
            "selectedForwardProfitFactor": json_metric(forward.profit_factor),
            "selectedForwardTrades": forward.trades,
            "minimumRiskReward": 2,
            "selectedRiskReward": round(candidate.min_planned_rr, 6),
            "forwardWins": forward.wins,
            "forwardLosses": forward.losses,
            "forwardTotalR": round(forward.total_r, 6),
            "forwardAverageR": round(forward.total_r / forward.trades if forward.trades else 0.0, 6),
            "forwardMaxDrawdownR": round(forward.max_drawdown_r, 6),
            "verificationSummary": (
                f"True bracket replacement accepted: baseline PF {target.baseline.profit_factor:.4f} "
                f"({target.baseline.trades} trades, displayed RR {target.baseline_rr:.2f}) -> "
                f"strict PF {forward.profit_factor:.4f} ({forward.trades} trades, min planned RR "
                f"{candidate.min_planned_rr:.2f}). Min forward split PF {forward.min_split_pf:.2f}; "
                f"pre-2022 train PF {train.profit_factor:.2f} over {train.trades} trades."
            ),
            "costUnits": strategy.cost_units,
            "oneTradePerDay": False,
        }
    )
    write_strategy_ts(strategy_dir / "strategy.ts", strategy)
    (metadata_dir / "selection.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    runner.write_strategy_backtest_csv(strategy_dir / "backtest_trades.csv", candidate.strict_trades)


def write_reports(selected: list[Candidate], evaluated: dict[str, int], apply: bool) -> None:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    csv_path = REPORT_ROOT / "true_rr_replacement_search.csv"
    fieldnames = [
        "status",
        "strategy_id",
        "folder",
        "asset_key",
        "baseline_pf",
        "baseline_trades",
        "baseline_rr",
        "selected_pf",
        "selected_trades",
        "selected_rr",
        "min_planned_rr",
        "train_pf",
        "train_trades",
        "min_split_pf",
        "variant_id",
    ]
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for candidate in selected:
            target = candidate.target
            writer.writerow(
                {
                    "status": "applied" if apply else "selected",
                    "strategy_id": target.strategy.id,
                    "folder": target.folder,
                    "asset_key": target.strategy.asset_key,
                    "baseline_pf": f"{target.baseline.profit_factor:.6f}",
                    "baseline_trades": target.baseline.trades,
                    "baseline_rr": f"{target.baseline_rr:.6f}",
                    "selected_pf": f"{candidate.strict_metrics.profit_factor:.6f}",
                    "selected_trades": candidate.strict_metrics.trades,
                    "selected_rr": f"{candidate.spec.risk_reward:.6f}",
                    "min_planned_rr": f"{candidate.min_planned_rr:.6f}",
                    "train_pf": f"{candidate.train_metrics.profit_factor:.6f}",
                    "train_trades": candidate.train_metrics.trades,
                    "min_split_pf": f"{candidate.strict_metrics.min_split_pf:.6f}",
                    "variant_id": candidate.spec.variant_id,
                }
            )

    md_path = REPORT_ROOT / "true_rr_replacement_search.md"
    rr_counts: dict[str, int] = {}
    for candidate in selected:
        key = f"{candidate.spec.risk_reward:g}R"
        rr_counts[key] = rr_counts.get(key, 0) + 1
    lines = [
        "# True RR Replacement Search",
        "",
        f"- Evaluated fast candidate rows by asset: {evaluated}",
        f"- Qualified replacements {'applied' if apply else 'selected'}: {len(selected)}",
        f"- RR mix: {rr_counts}",
        "",
        "| Strategy | Asset | PF | Trades | RR | Train PF | Variant |",
        "| --- | --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for candidate in selected:
        target = candidate.target
        lines.append(
            f"| `{target.strategy.id}` | {target.strategy.asset_key} | "
            f"{target.baseline.profit_factor:.3f} -> {candidate.strict_metrics.profit_factor:.3f} | "
            f"{target.baseline.trades} -> {candidate.strict_metrics.trades} | "
            f"{target.baseline_rr:.2f} -> {candidate.min_planned_rr:.2f} | "
            f"{candidate.train_metrics.profit_factor:.3f} | `{candidate.spec.variant_id}` |"
        )
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    ids_path = REPORT_ROOT / "true_rr_replacement_ids.txt"
    ids_path.write_text("\n".join(candidate.target.strategy.id for candidate in selected) + ("\n" if selected else ""), encoding="utf-8")
    print(f"report={csv_path.relative_to(PROJECT_ROOT)}")
    print(f"markdown={md_path.relative_to(PROJECT_ROOT)}")
    print(f"ids={ids_path.relative_to(PROJECT_ROOT)}")


def main() -> int:
    args = parse_args()
    assets_by_key = runner.load_asset_by_key()
    asset_filter = {item.lower() for item in args.asset or []}
    symbol_to_key = {asset.symbol.lower(): key for key, asset in assets_by_key.items()}
    expanded_filter = set(asset_filter)
    expanded_filter.update(symbol_to_key[item] for item in asset_filter if item in symbol_to_key)

    rr_values = parse_rr_values(args.rr)
    targets = active_targets(expanded_filter)
    targets.sort(key=lambda target: (target.baseline.profit_factor, -target.baseline.trades))
    if args.weakest_targets > 0:
        targets = targets[: args.weakest_targets]
    targets_by_asset: dict[str, list[Target]] = {}
    for target in targets:
        if target.strategy.asset_key in assets_by_key:
            targets_by_asset.setdefault(target.strategy.asset_key, []).append(target)

    if not targets_by_asset:
        print("No active RR<2 competition_session_edge targets found.")
        write_reports([], {}, args.apply)
        return 0

    effective_filter_set = args.filter_set if args.mode == "broad" else "narrow"
    spec_pool = build_spec_pool(
        targets_by_asset,
        rr_values,
        effective_filter_set,
        args.mode,
        args.max_specs_per_asset,
    )
    evaluated_counts: dict[str, int] = {}
    candidates_by_asset: dict[str, list[tuple[CandidateSpec, Metrics, Metrics, float]]] = {}
    for asset_key, asset_targets in sorted(targets_by_asset.items()):
        asset = assets_by_key[asset_key]
        specs = spec_pool.get(asset_key, [])
        print(f"Scanning {asset_key}: {len(asset_targets)} target(s), {len(specs)} true-RR spec(s)", flush=True)
        candidates = evaluate_asset_specs(asset, asset_targets, specs, args)
        candidates_by_asset[asset_key] = candidates
        evaluated_counts[asset_key] = len(candidates)
        best = candidates[0][1].profit_factor if candidates else 0.0
        print(f"  candidates_after_fast_gates={len(candidates)} best_pf={best:.4f}", flush=True)

    selected = select_replacements(assets_by_key, targets_by_asset, candidates_by_asset, args)
    if args.apply:
        for candidate in selected:
            apply_replacement(candidate, assets_by_key[candidate.target.strategy.asset_key])

    write_reports(selected, evaluated_counts, args.apply)
    print(f"targets={len(targets)} selected={len(selected)} applied={args.apply}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
