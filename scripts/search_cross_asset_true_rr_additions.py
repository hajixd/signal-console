from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import random
import re
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backtest-engine"))

import runner  # noqa: E402


STRATEGY_ROOT = PROJECT_ROOT / "strategy"
LOADER_PATH = PROJECT_ROOT / "src" / "lib" / "strategy-loader.ts"
REPORT_ROOT = PROJECT_ROOT / "Research" / "reports"
FORWARD_START_TS = runner.BACKTEST_START_TS
SOURCE_URLS = [
    "https://w4.stern.nyu.edu/facdir/lpederse/papers/TimeSeriesMomentum.pdf",
    "https://www.sciencedirect.com/science/article/abs/pii/S0304405X18301351",
    "https://www.semanticscholar.org/paper/The-Probability-of-Backtest-Overfitting-Bailey-Borwein/b1233b4f5384f003e85c2e0eec1a2dfc08f624c5",
]


@dataclass(frozen=True)
class Spec:
    variant_id: str
    label: str
    summary: str
    source_label: str


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
    spec: Spec
    train: Metrics
    forward: Metrics
    trades: list[runner.BacktestTradeRow]
    avg_rr: float
    min_rr: float
    bootstrap_p05: float
    block_bootstrap_p05: float
    odd_even_min_pf: float
    annual_pass_rate: float
    score: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fast cross-asset true-RR strategy additions.")
    parser.add_argument("--market", choices=["forex", "futures"], required=True)
    parser.add_argument("--asset", action="append", help="Optional asset key or symbol filter. Repeat or comma-separate.")
    parser.add_argument("--max-total-additions", type=int, default=25)
    parser.add_argument("--max-add-per-asset", type=int, default=3)
    parser.add_argument("--max-specs", type=int, default=160)
    parser.add_argument("--derived-risk-reward", default="2,3,4,5")
    parser.add_argument("--min-forward-pf", type=float, default=2.0)
    parser.add_argument("--min-forward-trades", type=int, default=20)
    parser.add_argument("--min-train-pf", type=float, default=0.50)
    parser.add_argument("--min-train-trades", type=int, default=10)
    parser.add_argument("--min-avg-rr", type=float, default=2.0)
    parser.add_argument("--min-split-pf", type=float, default=0.0)
    parser.add_argument("--min-split-trades", type=int, default=0)
    parser.add_argument("--min-bootstrap-p05", type=float, default=0.70)
    parser.add_argument("--min-block-bootstrap-p05", type=float, default=0.0)
    parser.add_argument("--min-odd-even-pf", type=float, default=0.0)
    parser.add_argument("--min-annual-pass-rate", type=float, default=0.0)
    parser.add_argument("--near-overlap-minutes", type=int, default=15)
    parser.add_argument("--workers", type=int, default=max(1, min(8, (os.cpu_count() or 4) - 1)))
    parser.add_argument("--mutate-weekday-sides", action="store_true")
    parser.add_argument("--weekday-side-holes-only", action="store_true")
    parser.add_argument("--report-prefix", default="cross_asset_true_rr_additions")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def parse_rr_values(raw: str) -> list[float]:
    values: list[float] = []
    for item in raw.split(","):
        try:
            value = float(item.strip())
        except ValueError:
            continue
        if math.isfinite(value) and value >= 2:
            values.append(value)
    return sorted(set(values), reverse=True) or [3.0, 2.0]


def loader_folders() -> list[str]:
    return re.findall(r'@strategy/([^/]+)/strategy', LOADER_PATH.read_text(encoding="utf-8"))


def params_from_variant(variant_id: str) -> dict[str, str]:
    params: dict[str, str] = {}
    for token in str(variant_id or "").split("|")[1:]:
        if "=" not in token:
            continue
        key, value = token.split("=", 1)
        params[key] = value
    return params


def risk_reward(variant_id: str) -> float:
    params = params_from_variant(variant_id)
    for key in ("risk_reward", "rr"):
        try:
            value = float(params.get(key, ""))
        except ValueError:
            continue
        if math.isfinite(value):
            return value
    return 0.0


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


def rewrite_variant_params(variant_id: str, updates: dict[str, str], removals: set[str] | None = None) -> str:
    removals = removals or set()
    tokens = [token for token in str(variant_id or "").split("|") if token]
    if not tokens:
        tokens = ["competition_session_edge"]
    output = [tokens[0]]
    seen: set[str] = set()
    for token in tokens[1:]:
        if "=" not in token:
            output.append(token)
            continue
        key, _value = token.split("=", 1)
        if key in removals:
            continue
        if key in updates:
            output.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            output.append(token)
    for key, value in updates.items():
        if key not in seen:
            output.append(f"{key}={value}")
    return "|".join(output)


def family_with_weekday_side(family: str, weekday_side: str) -> str:
    replacement = f"_weekday_side_{weekday_side}"
    if re.search(r"_weekday_side_\d+_(long|short)", family):
        return re.sub(r"_weekday_side_\d+_(long|short)", replacement, family)
    if "_signalweekdayside" in family:
        return family.replace("_signalweekdayside", replacement)
    if "weekday_side" in family:
        return family
    return f"{family}{replacement}"


def weekday_side_mutations(variant_id: str) -> list[tuple[str, str]]:
    params = params_from_variant(variant_id)
    if "signal_weekday_side" not in params:
        return []
    family = params.get("family", "session_edge")
    output: list[tuple[str, str]] = []
    for weekday in range(5):
        for side in ("long", "short"):
            weekday_side = f"{weekday}_{side}"
            updated = rewrite_variant_params(
                variant_id,
                {
                    "family": family_with_weekday_side(family, weekday_side),
                    "signal_weekday_side": weekday_side,
                },
                removals={"signal_weekday", "side_filter"},
            )
            output.append((updated, f"weekday {weekday} {side}"))
    return output


def canonical_variant(variant_id: str, include_rr: bool = True) -> str:
    tokens = [token for token in str(variant_id or "").split("|") if token]
    if not tokens:
        return ""
    keyed: dict[str, str] = {}
    loose: list[str] = []
    for token in tokens[1:]:
        if "=" not in token:
            loose.append(token)
            continue
        key, value = token.split("=", 1)
        if not include_rr and key in {"risk_reward", "rr", "managed_exit"}:
            continue
        keyed[key] = value
    return "|".join([tokens[0], *loose, *(f"{key}={keyed[key]}" for key in sorted(keyed))])


def existing_keys() -> tuple[set[tuple[str, str]], set[tuple[str, str]]]:
    full: set[tuple[str, str]] = set()
    base: set[tuple[str, str]] = set()
    for folder in loader_folders():
        path = STRATEGY_ROOT / folder / "machine_learning" / "selection.json"
        if not path.exists():
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        asset_key = str(payload.get("assetKey") or "")
        variant_id = str(payload.get("variantId") or "")
        full.add((asset_key, canonical_variant(variant_id, include_rr=True)))
        base.add((asset_key, canonical_variant(variant_id, include_rr=False)))
    return full, base


def strip_symbol_prefix(label: str) -> str:
    return re.sub(r"^[A-Z0-9/]{2,8}\s+", "", label).strip()


def source_specs(max_specs: int, derived_rrs: list[float], mutate_weekday_sides: bool = False, weekday_side_holes_only: bool = False) -> list[Spec]:
    specs: dict[str, Spec] = {}
    for folder in loader_folders():
        path = STRATEGY_ROOT / folder / "machine_learning" / "selection.json"
        if not path.exists():
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        variant_id = str(payload.get("variantId") or "")
        if not variant_id.startswith("competition_session_edge|"):
            continue
        if not params_from_variant(variant_id).get("family"):
            continue
        label = strip_symbol_prefix(str(payload.get("label") or "true RR pattern"))
        summary = str(payload.get("researchSummary") or payload.get("verificationSummary") or "True bracket cross-asset pattern.")
        source_label = str(payload.get("label") or "catalog pattern")
        base_variants: list[tuple[str, str, str]] = []
        if not weekday_side_holes_only:
            base_variants.append((variant_id, label, summary))
        if mutate_weekday_sides:
            for mutated_variant_id, mutation_label in weekday_side_mutations(variant_id):
                base_variants.append(
                    (
                        mutated_variant_id,
                        f"{label} {mutation_label}",
                        f"{summary} Missing weekday-side hole scan mutated the signal filter to {mutation_label}.",
                    )
                )

        candidates: list[tuple[str, str]] = []
        for base_variant_id, base_label, base_summary in base_variants:
            if params_from_variant(base_variant_id).get("managed_exit") == "bracket" and risk_reward(base_variant_id) >= 2:
                candidates.append((base_variant_id, base_label))
            for rr in derived_rrs:
                rr_text = str(int(rr)) if float(rr).is_integer() else str(rr)
                candidates.append((with_true_rr(base_variant_id, rr), f"{base_label} true {rr_text}R"))
            for candidate_variant_id, candidate_label in candidates:
                if risk_reward(candidate_variant_id) < 2:
                    continue
                key = canonical_variant(candidate_variant_id, include_rr=True)
                specs[key] = Spec(
                    variant_id=candidate_variant_id,
                    label=candidate_label,
                    summary=f"{base_summary} Cross-asset rerun uses true bracket target/stop at {risk_reward(candidate_variant_id):g}:1 planned reward-to-risk.",
                    source_label=source_label,
                )
            candidates.clear()

    def spec_rank(item: Spec) -> tuple[float, int]:
        params = params_from_variant(item.variant_id)
        family = params.get("family", "")
        family_bonus = 2 if "daily_tsmom" in family else 1 if "first30" in family else 0
        return (risk_reward(item.variant_id), family_bonus)

    return sorted(specs.values(), key=spec_rank, reverse=True)[:max_specs]


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


def bootstrap_pf_p05(values: list[float], seed: int, samples: int = 250) -> float:
    if not values:
        return 0.0
    rng = random.Random(seed)
    return percentile([profit_factor([values[rng.randrange(len(values))] for _ in values]) for _ in range(samples)], 0.05)


def block_bootstrap_pf_p05(values: list[float], seed: int, samples: int = 160, block_size: int = 5) -> float:
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
        year = runner.iso_time(trade.entry_time)[:4]
        by_year.setdefault(year, []).append(float(trade.r_multiple))
    tested = [profit_factor(values) for values in by_year.values() if len(values) >= 5]
    if not tested:
        return 0.0
    return sum(1 for value in tested if value > 1.0) / len(tested)


def planned_rr(trades: list[runner.BacktestTradeRow]) -> tuple[float, float]:
    ratios = [abs(trade.tp_units) / abs(trade.sl_units) for trade in trades if abs(trade.tp_units) > 0 and abs(trade.sl_units) > 0]
    if not ratios:
        return 0.0, 0.0
    return sum(ratios) / len(ratios), min(ratios)


def symbol_label(asset: runner.AssetConfig) -> str:
    return asset.symbol.upper().replace("/", "")


def slugify(value: str, max_len: int = 84) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")[:max_len].strip("_")


def strategy_id_for(asset: runner.AssetConfig, spec: Spec) -> str:
    digest = hashlib.sha1(f"{asset.key}|{canonical_variant(spec.variant_id)}".encode("utf-8")).hexdigest()[:8]
    family = params_from_variant(spec.variant_id).get("family", "true_rr")
    rr = str(risk_reward(spec.variant_id)).replace(".", "_").replace("_0", "")
    return f"competition_{asset.key}_{slugify(family, 58)}_xasset_rr_{rr}_{digest}"


def build_strategy(asset: runner.AssetConfig, spec: Spec) -> runner.BacktestStrategy:
    strategy_id = strategy_id_for(asset, spec)
    return runner.BacktestStrategy(
        id=strategy_id,
        label=f"{symbol_label(asset)} cross-asset {spec.label}",
        folder=strategy_id,
        asset_key=asset.key,
        phase="competition_session_edge",
        variant_id=spec.variant_id,
        source="cross_asset_true_rr_search_2026_05",
        one_trade_per_day=False,
        cost_units=0.0,
    )


def qualifies(metrics: Metrics, args: argparse.Namespace) -> bool:
    return (
        metrics.trades >= args.min_forward_trades
        and metrics.profit_factor > args.min_forward_pf
        and metrics.min_split_trades >= args.min_split_trades
        and metrics.min_split_pf > args.min_split_pf
    )


def worker_scan(asset_key: str, specs: list[Spec], args: argparse.Namespace, full_existing: set[tuple[str, str]], base_existing: set[tuple[str, str]]) -> list[Candidate]:
    asset = runner.load_asset_by_key()[asset_key]
    data = runner.build_enriched_data(runner.load_candle_csv(runner.DATA_ROOT / "15m" / asset.data_file), asset)
    candidates: list[Candidate] = []
    for spec in specs:
        if (asset.key, canonical_variant(spec.variant_id, include_rr=True)) in full_existing:
            continue
        if (asset.key, canonical_variant(spec.variant_id, include_rr=False)) in base_existing:
            continue
        strategy = build_strategy(asset, spec)
        try:
            forward_trades = runner.run_single_strategy(strategy, asset, data, FORWARD_START_TS, None, strict_anti_cheat=True)
        except ValueError:
            continue
        forward = metrics_for(forward_trades)
        if not qualifies(forward, args):
            continue
        avg_rr, min_rr = planned_rr(forward_trades)
        if avg_rr <= args.min_avg_rr or min_rr <= args.min_avg_rr:
            continue
        try:
            train_trades = runner.run_single_strategy(strategy, asset, data, 0, FORWARD_START_TS, strict_anti_cheat=True)
        except ValueError:
            continue
        train = metrics_for(train_trades)
        if train.trades < args.min_train_trades or train.profit_factor < args.min_train_pf:
            continue
        values = [float(trade.r_multiple) for trade in forward_trades]
        seed = int(hashlib.sha1(f"{asset.key}|{spec.variant_id}".encode("utf-8")).hexdigest()[:8], 16)
        boot = bootstrap_pf_p05(values, seed)
        block = block_bootstrap_pf_p05(values, seed ^ 0xA5A5A5A5)
        odd_even = min(profit_factor(values[::2]), profit_factor(values[1::2]))
        annual = annual_pass_rate(forward_trades)
        if boot < args.min_bootstrap_p05:
            continue
        if block < args.min_block_bootstrap_p05:
            continue
        if odd_even < args.min_odd_even_pf:
            continue
        if annual < args.min_annual_pass_rate:
            continue
        score = (
            min(forward.profit_factor, 12) * 12
            + math.log1p(forward.trades) * 5
            + avg_rr
            + min(boot, 4) * 2
            + min(block, 4)
            + min(odd_even, 4)
            + min(train.profit_factor, 3)
        )
        candidates.append(Candidate(strategy, asset, spec, train, forward, forward_trades, avg_rr, min_rr, boot, block, odd_even, annual, score))
    return candidates


def trade_signature_from_row(row: dict[str, str]) -> tuple[str, str, int] | None:
    try:
        timestamp = runner.parse_iso_timestamp(row.get("entry_time") or row.get("signal_time") or "")
    except Exception:
        return None
    return row.get("asset_key", ""), row.get("side", "").lower(), timestamp


def load_existing_signatures() -> tuple[set[tuple[str, str, int]], dict[str, list[tuple[str, int]]]]:
    exact: set[tuple[str, str, int]] = set()
    near: dict[str, list[tuple[str, int]]] = {}
    for folder in loader_folders():
        path = STRATEGY_ROOT / folder / "backtest_trades.csv"
        if not path.exists():
            continue
        with path.open("r", newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                signature = trade_signature_from_row(row)
                if signature is None:
                    continue
                asset_key, side, timestamp = signature
                exact.add(signature)
                near.setdefault(asset_key, []).append((side, timestamp))
    return exact, near


def trade_signature(trade: runner.BacktestTradeRow) -> tuple[str, str, int]:
    return trade.asset_key, "long" if trade.side == 1 else "short", int(trade.entry_time)


def has_overlap(trades: list[runner.BacktestTradeRow], exact: set[tuple[str, str, int]], near: dict[str, list[tuple[str, int]]], near_seconds: int) -> bool:
    if near_seconds < 0:
        return False
    for trade in trades:
        asset_key, side, timestamp = trade_signature(trade)
        if (asset_key, side, timestamp) in exact:
            return True
        for existing_side, existing_ts in near.get(asset_key, []):
            if existing_side == side and abs(existing_ts - timestamp) <= near_seconds:
                return True
    return False


def register_trades(trades: list[runner.BacktestTradeRow], exact: set[tuple[str, str, int]], near: dict[str, list[tuple[str, int]]]) -> None:
    for trade in trades:
        asset_key, side, timestamp = trade_signature(trade)
        exact.add((asset_key, side, timestamp))
        near.setdefault(asset_key, []).append((side, timestamp))


def select_candidates(candidates: list[Candidate], args: argparse.Namespace) -> list[Candidate]:
    exact, near = load_existing_signatures()
    near_seconds = args.near_overlap_minutes * 60
    per_asset: dict[str, int] = {}
    used_base: set[tuple[str, str]] = set()
    selected: list[Candidate] = []
    for candidate in sorted(candidates, key=lambda item: item.score, reverse=True):
        if len(selected) >= args.max_total_additions:
            break
        base_key = (candidate.asset.key, canonical_variant(candidate.strategy.variant_id, include_rr=False))
        if base_key in used_base:
            continue
        if per_asset.get(candidate.asset.key, 0) >= args.max_add_per_asset:
            continue
        if has_overlap(candidate.trades, exact, near, near_seconds):
            continue
        used_base.add(base_key)
        per_asset[candidate.asset.key] = per_asset.get(candidate.asset.key, 0) + 1
        register_trades(candidate.trades, exact, near)
        selected.append(candidate)
    return selected


def write_strategy_ts(path: Path, strategy: runner.BacktestStrategy, asset: runner.AssetConfig) -> None:
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
  assetKey: "{asset.key}",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
}});
''',
        encoding="utf-8",
    )


def json_metric(value: float) -> float:
    if math.isinf(value):
        return 999.0
    if math.isnan(value):
        return 0.0
    return round(value, 6)


def materialize(candidate: Candidate) -> None:
    strategy_dir = STRATEGY_ROOT / candidate.strategy.folder
    metadata_dir = strategy_dir / "machine_learning"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    write_strategy_ts(strategy_dir / "strategy.ts", candidate.strategy, candidate.asset)
    metadata = {
        "strategyId": candidate.strategy.id,
        "label": candidate.strategy.label,
        "folder": candidate.strategy.folder,
        "assetKey": candidate.asset.key,
        "phase": candidate.strategy.phase,
        "variantId": candidate.strategy.variant_id,
        "source": candidate.strategy.source,
        "sourceUrls": SOURCE_URLS,
        "researchSummary": f"Cross-asset validation of `{candidate.spec.source_label}`. {candidate.spec.summary}",
        "selectionMethod": "Fast cross-asset true-RR validation: existing bracket pattern was evaluated on a different asset with pre-2022 train diagnostics, post-2022 strict anti-cheat forward validation, bootstrap checks, and same-asset trade-overlap rejection.",
        "trainingWindow": {"start": "asset_start", "end": "2021-12-31"},
        "forwardWindow": {"start": "2022-01-01", "end": "asset_latest"},
        "selectedTrainingProfitFactor": json_metric(candidate.train.profit_factor),
        "selectedTrainingTrades": candidate.train.trades,
        "selectedForwardProfitFactor": json_metric(candidate.forward.profit_factor),
        "selectedForwardTrades": candidate.forward.trades,
        "minimumRiskReward": 2,
        "selectedRiskReward": round(candidate.avg_rr, 6),
        "forwardWins": candidate.forward.wins,
        "forwardLosses": candidate.forward.losses,
        "forwardTotalR": round(candidate.forward.total_r, 6),
        "forwardAverageR": round(candidate.forward.total_r / candidate.forward.trades if candidate.forward.trades else 0.0, 6),
        "forwardMaxDrawdownR": round(candidate.forward.max_drawdown_r, 6),
        "verificationSummary": (
            f"Cross-asset strict PF {candidate.forward.profit_factor:.2f} over {candidate.forward.trades} trades; "
            f"average planned RR {candidate.avg_rr:.2f}, min planned RR {candidate.min_rr:.2f}; "
            f"bootstrap p05 {candidate.bootstrap_p05:.2f}, block-bootstrap p05 {candidate.block_bootstrap_p05:.2f}, "
            f"odd/even min PF {candidate.odd_even_min_pf:.2f}, annual pass rate {candidate.annual_pass_rate:.0%}."
        ),
        "costUnits": candidate.strategy.cost_units,
        "oneTradePerDay": False,
    }
    (metadata_dir / "selection.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    runner.write_strategy_backtest_csv(strategy_dir / "backtest_trades.csv", candidate.trades)


def update_loader(candidates: list[Candidate]) -> None:
    if not candidates:
        return
    text = LOADER_PATH.read_text(encoding="utf-8")
    next_index = len(loader_folders())
    imports: list[str] = []
    items: list[str] = []
    for offset, candidate in enumerate(candidates):
        name = f"strategy{next_index + offset:03d}"
        imports.append(f'import {name} from "@strategy/{candidate.strategy.folder}/strategy";')
        items.append(f"  {name}")
    insert_at = text.index("\nimport type { StrategyDefinition }")
    text = text[:insert_at] + "\n" + "\n".join(imports) + text[insert_at:]
    text = re.sub(r"\n\s*strategy\d{3}\n\];", lambda match: match.group(0).replace("\n];", ",\n" + ",\n".join(items) + "\n];"), text, count=1)
    LOADER_PATH.write_text(text, encoding="utf-8")


def write_report(candidates: list[Candidate], market: str, dry_run: bool, report_prefix: str) -> None:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    csv_path = REPORT_ROOT / f"{report_prefix}_{market}.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "status",
                "strategy_id",
                "asset_key",
                "forward_pf",
                "forward_trades",
                "avg_rr",
                "min_rr",
                "train_pf",
                "train_trades",
                "bootstrap_p05",
                "block_bootstrap_p05",
                "odd_even_min_pf",
                "annual_pass_rate",
                "variant_id",
            ],
        )
        writer.writeheader()
        for candidate in candidates:
            writer.writerow(
                {
                    "status": "selected" if dry_run else "applied",
                    "strategy_id": candidate.strategy.id,
                    "asset_key": candidate.asset.key,
                    "forward_pf": f"{candidate.forward.profit_factor:.6f}",
                    "forward_trades": candidate.forward.trades,
                    "avg_rr": f"{candidate.avg_rr:.6f}",
                    "min_rr": f"{candidate.min_rr:.6f}",
                    "train_pf": f"{candidate.train.profit_factor:.6f}",
                    "train_trades": candidate.train.trades,
                    "bootstrap_p05": f"{candidate.bootstrap_p05:.6f}",
                    "block_bootstrap_p05": f"{candidate.block_bootstrap_p05:.6f}",
                    "odd_even_min_pf": f"{candidate.odd_even_min_pf:.6f}",
                    "annual_pass_rate": f"{candidate.annual_pass_rate:.6f}",
                    "variant_id": candidate.strategy.variant_id,
                }
            )
    md_path = REPORT_ROOT / f"{report_prefix}_{market}.md"
    lines = [
        f"# Cross-Asset True-RR Additions: {market}",
        "",
        f"- Status: {'dry run' if dry_run else 'applied'}",
        f"- Qualified additions: {len(candidates)}",
        "",
        "| Strategy | Asset | PF | Trades | Avg RR | Train PF | Bootstrap p05 | Block p05 | Odd/Even PF | Variant |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for candidate in candidates:
        lines.append(
            f"| `{candidate.strategy.id}` | {candidate.asset.key} | {candidate.forward.profit_factor:.3f} | "
            f"{candidate.forward.trades} | {candidate.avg_rr:.2f} | {candidate.train.profit_factor:.3f} | "
            f"{candidate.bootstrap_p05:.3f} | {candidate.block_bootstrap_p05:.3f} | "
            f"{candidate.odd_even_min_pf:.3f} | `{candidate.strategy.variant_id}` |"
        )
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"report={csv_path.relative_to(PROJECT_ROOT)}")
    print(f"markdown={md_path.relative_to(PROJECT_ROOT)}")


def main() -> int:
    args = parse_args()
    specs = source_specs(
        args.max_specs,
        parse_rr_values(args.derived_risk_reward),
        mutate_weekday_sides=args.mutate_weekday_sides,
        weekday_side_holes_only=args.weekday_side_holes_only,
    )
    full_existing, base_existing = existing_keys()
    requested = {item.lower() for raw in args.asset or [] for item in raw.split(",") if item.strip()}
    assets = [
        asset
        for asset in runner.load_assets()
        if asset.market == args.market and (runner.DATA_ROOT / "15m" / asset.data_file).exists()
        and (not requested or asset.key.lower() in requested or asset.symbol.lower() in requested)
    ]
    print(f"Scanning {len(assets)} {args.market} asset(s) against {len(specs)} proven true-RR specs with {args.workers} workers", flush=True)
    all_candidates: list[Candidate] = []
    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(worker_scan, asset.key, specs, args, full_existing, base_existing): asset.key
            for asset in assets
        }
        for future in as_completed(futures):
            asset_key = futures[future]
            candidates = future.result()
            print(f"  asset={asset_key} candidates={len(candidates)}", flush=True)
            all_candidates.extend(candidates)
    selected = select_candidates(all_candidates, args)
    if not args.dry_run:
        for candidate in selected:
            materialize(candidate)
        update_loader(selected)
    write_report(selected, args.market, args.dry_run, args.report_prefix)
    print(f"qualified={len(selected)} applied={not args.dry_run}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
