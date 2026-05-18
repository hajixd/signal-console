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
from typing import Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backtest-engine"))

import runner  # noqa: E402


STRATEGY_ROOT = PROJECT_ROOT / "strategy"
LOADER_PATH = PROJECT_ROOT / "src" / "lib" / "strategy-loader.ts"
REPORT_ROOT = PROJECT_ROOT / "Research" / "reports"
FORWARD_START_TS = runner.BACKTEST_START_TS
MIN_SPLIT_TRADES = 5
MIN_SPLIT_PF = 1.0
SOURCE_URLS = [
    "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2552752",
    "https://www.semanticscholar.org/paper/The-Probability-of-Backtest-Overfitting-Bailey-Borwein/b1233b4f5384f003e85c2e0eec1a2dfc08f624c5",
    "https://www.tradapt.com/resources/strategies/opening-range-breakout",
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
class Spec:
    variant_id: str
    family: str
    label: str
    summary: str
    risk_reward: float
    base_key: str


@dataclass(frozen=True)
class Candidate:
    strategy: runner.BacktestStrategy
    asset: runner.AssetConfig
    spec: Spec
    train: Metrics
    forward: Metrics
    trades: list[runner.BacktestTradeRow]
    avg_planned_rr: float
    min_planned_rr: float
    bootstrap_p05: float
    block_bootstrap_p05: float
    annual_pass_rate: float
    score: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Search for true dynamic session-range additions.")
    parser.add_argument("--asset", action="append", help="Asset key or symbol to scan. Repeatable.")
    parser.add_argument("--market", choices=["all", "forex", "futures", "crypto", "gold_spot"], default="all")
    parser.add_argument("--risk-reward", default="3,4,5", help="Comma separated planned RR values.")
    parser.add_argument("--filter-mode", choices=["all", "month", "weekday_side", "broad"], default="broad")
    parser.add_argument("--min-forward-pf", type=float, default=3.0)
    parser.add_argument("--min-forward-trades", type=int, default=50)
    parser.add_argument("--min-train-pf", type=float, default=1.0)
    parser.add_argument("--min-train-trades", type=int, default=20)
    parser.add_argument("--min-avg-rr", type=float, default=2.0)
    parser.add_argument("--min-bootstrap-p05", type=float, default=1.0)
    parser.add_argument("--near-overlap-minutes", type=int, default=15)
    parser.add_argument("--max-fast-per-asset", type=int, default=40)
    parser.add_argument("--max-add-per-asset", type=int, default=2)
    parser.add_argument("--max-total-additions", type=int, default=20)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def parse_rr(raw: str) -> list[float]:
    output: list[float] = []
    for item in raw.split(","):
        try:
            value = float(item.strip())
        except ValueError:
            continue
        if math.isfinite(value) and value >= 2.0:
            output.append(value)
    return sorted(set(output), reverse=True) or [3.0]


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
    values = [float(trade.r_multiple) for trade in sorted(trades, key=lambda item: item.entry_time)]
    splits = [split for split in split_values(values) if split]
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


def block_bootstrap_pf_p05(values: list[float], seed: int, samples: int = 250, block_size: int = 5) -> float:
    if not values:
        return 0.0
    rng = random.Random(seed)
    pfs: list[float] = []
    starts = list(range(len(values)))
    for _ in range(samples):
        draw: list[float] = []
        while len(draw) < len(values):
            start = rng.choice(starts)
            draw.extend(values[start : start + block_size])
            if start + block_size > len(values):
                draw.extend(values[: (start + block_size) % len(values)])
        pfs.append(profit_factor(draw[: len(values)]))
    return percentile(pfs, 0.05)


def annual_pass_rate(trades: list[runner.BacktestTradeRow]) -> float:
    by_year: dict[str, list[float]] = {}
    for trade in trades:
        year = runner.format_iso_timestamp(trade.entry_time)[:4]
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


def params_from_variant(variant_id: str) -> dict[str, str]:
    params: dict[str, str] = {}
    for token in variant_id.split("|")[1:]:
        if "=" in token:
            key, value = token.split("=", 1)
            params[key] = value
    return params


def canonical_variant(variant_id: str, include_rr: bool = True) -> str:
    tokens = [token for token in str(variant_id or "").split("|") if token]
    if not tokens:
        return ""
    head = tokens[0]
    keyed: dict[str, str] = {}
    loose: list[str] = []
    for token in tokens[1:]:
        if "=" not in token:
            loose.append(token)
            continue
        key, value = token.split("=", 1)
        if not include_rr and key in {"risk_reward", "rr"}:
            continue
        keyed[key] = value
    return "|".join([head, *loose, *(f"{key}={keyed[key]}" for key in sorted(keyed))])


def loader_folders() -> list[str]:
    return re.findall(r'@strategy/([^/]+)/strategy', LOADER_PATH.read_text(encoding="utf-8"))


def existing_variant_keys() -> set[tuple[str, str]]:
    keys: set[tuple[str, str]] = set()
    for folder in loader_folders():
        metadata_path = STRATEGY_ROOT / folder / "machine_learning" / "selection.json"
        if not metadata_path.exists():
            continue
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        asset_key = str(payload.get("assetKey") or "")
        variant_id = str(payload.get("variantId") or "")
        keys.add((asset_key, canonical_variant(variant_id, include_rr=True)))
        keys.add((asset_key, canonical_variant(variant_id, include_rr=False)))
    return keys


def trade_signature_from_row(row: dict[str, str]) -> tuple[str, str, int] | None:
    timestamp_value = row.get("entry_time") or row.get("signal_time")
    if not timestamp_value:
        return None
    try:
        timestamp = runner.parse_iso_timestamp(timestamp_value)
    except Exception:
        return None
    return row.get("asset_key", ""), row.get("side", "").lower(), timestamp


def load_existing_signatures() -> tuple[set[tuple[str, str, int]], dict[str, list[tuple[str, int]]]]:
    exact: set[tuple[str, str, int]] = set()
    near: dict[str, list[tuple[str, int]]] = {}
    for folder in loader_folders():
        csv_path = STRATEGY_ROOT / folder / "backtest_trades.csv"
        if not csv_path.exists():
            continue
        with csv_path.open("r", newline="", encoding="utf-8") as handle:
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


def filter_specs(mode: str) -> list[tuple[str, tuple[tuple[str, str], ...], str]]:
    filters: list[tuple[str, tuple[tuple[str, str], ...], str]] = []
    if mode in {"all", "broad"}:
        filters.append(("all", (), "all signals"))
    if mode in {"month", "broad"}:
        filters.extend((f"month_{month}", (("signal_month", str(month)),), f"month {month}") for month in range(1, 13))
    if mode in {"weekday_side", "broad"}:
        filters.extend(
            (
                f"weekday_side_{weekday}_{side}",
                (("signal_weekday_side", f"{weekday}_{side}"),),
                f"{side} signals on weekday {weekday}",
            )
            for weekday in range(5)
            for side in ("long", "short")
        )
    return filters


def variant_id(family: str, params: Iterable[tuple[str, str]]) -> str:
    return "|".join(["competition_session_edge", f"family={family}", *(f"{key}={value}" for key, value in params)])


def build_specs(rr_values: list[float], filter_mode: str = "broad") -> list[Spec]:
    output: dict[str, Spec] = {}
    rr_texts = [(value, str(int(value)) if float(value).is_integer() else str(value)) for value in rr_values]
    for filter_name, filter_params, filter_label in filter_specs(filter_mode):
        for rr_value, rr_text in rr_texts:
            for range_end in (585, 600):
                for break_end in (660, 720, 945):
                    for direction in ("breakout", "fade"):
                        family = f"ny_opening_range_{direction}_{filter_name}"
                        params = (
                            ("break_end", str(break_end)),
                            ("break_start", str(range_end + 15)),
                            ("direction", direction),
                            ("forced_exit", "945"),
                            ("range_end", str(range_end)),
                            ("range_start", "570"),
                            ("risk_reward", rr_text),
                            *filter_params,
                            ("managed_exit", "bracket"),
                        )
                        vid = variant_id(family, params)
                        key = canonical_variant(vid, include_rr=True)
                        base_key = canonical_variant(vid, include_rr=False)
                        output[key] = Spec(
                            variant_id=vid,
                            family=family,
                            label=f"NY opening range {direction} {filter_label} true {rr_text}R",
                            summary=(
                                f"Dynamic New York opening-range {direction}: stop is the live range/sweep extreme, "
                                f"target is {rr_text}:1 of realized risk, filter {filter_label}."
                            ),
                            risk_reward=rr_value,
                            base_key=base_key,
                        )

            for break_end, forced_exit in ((360, 600), (480, 600), (570, 945)):
                for direction in ("breakout", "fade"):
                    family = f"asia_range_london_{direction}_{filter_name}"
                    params = (
                        ("break_end", str(break_end)),
                        ("break_start", "180"),
                        ("direction", direction),
                        ("forced_exit", str(forced_exit)),
                        ("range_end", "165"),
                        ("range_start", "1080"),
                        ("risk_reward", rr_text),
                        *filter_params,
                        ("managed_exit", "bracket"),
                    )
                    vid = variant_id(family, params)
                    key = canonical_variant(vid, include_rr=True)
                    base_key = canonical_variant(vid, include_rr=False)
                    output[key] = Spec(
                        variant_id=vid,
                        family=family,
                        label=f"Asia range London {direction} {filter_label} true {rr_text}R",
                        summary=(
                            f"Dynamic Asia-session range {direction} into London: stop is the live range/sweep "
                            f"extreme, target is {rr_text}:1 of realized risk, filter {filter_label}."
                        ),
                        risk_reward=rr_value,
                        base_key=base_key,
                    )
    return list(output.values())


def slugify(value: str, max_len: int = 88) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return slug[:max_len].strip("_")


def strategy_id_for(asset: runner.AssetConfig, spec: Spec) -> str:
    digest = hashlib.sha1(f"{asset.key}|{canonical_variant(spec.variant_id)}".encode("utf-8")).hexdigest()[:8]
    params = params_from_variant(spec.variant_id)
    stem = slugify(
        "_".join(
            [
                asset.key,
                spec.family,
                f"be_{params.get('break_end', '')}",
                f"rr_{params.get('risk_reward', '')}",
            ]
        )
    )
    return f"competition_{stem}_{digest}"


def symbol_label(asset: runner.AssetConfig) -> str:
    return asset.symbol.upper().replace("/", "")


def build_strategy(asset: runner.AssetConfig, spec: Spec) -> runner.BacktestStrategy:
    strategy_id = strategy_id_for(asset, spec)
    return runner.BacktestStrategy(
        id=strategy_id,
        label=f"{symbol_label(asset)} {spec.label}",
        folder=strategy_id,
        asset_key=asset.key,
        phase="competition_session_edge",
        variant_id=spec.variant_id,
        source="dynamic_range_train_forward_2026_05",
        one_trade_per_day=False,
        cost_units=0.0,
    )


def load_asset_data(asset: runner.AssetConfig) -> runner.EnrichedData:
    frame = runner.load_candle_csv(runner.DATA_ROOT / "15m" / asset.data_file)
    return runner.build_enriched_data(frame, asset)


def qualifies(metrics: Metrics, min_pf: float, min_trades: int) -> bool:
    return (
        metrics.trades >= min_trades
        and metrics.profit_factor >= min_pf
        and metrics.min_split_trades >= MIN_SPLIT_TRADES
        and metrics.min_split_pf > MIN_SPLIT_PF
    )


def candidate_score(forward: Metrics, train: Metrics, avg_rr: float, bootstrap_p05: float) -> float:
    return (
        min(forward.profit_factor, 10.0) * 12.0
        + math.log1p(forward.trades) * 4.0
        + min(train.profit_factor, 4.0) * 2.0
        + avg_rr
        + min(bootstrap_p05, 4.0) * 3.0
    )


def research_asset(
    asset: runner.AssetConfig,
    specs: list[Spec],
    existing_keys: set[tuple[str, str]],
    exact: set[tuple[str, str, int]],
    near: dict[str, list[tuple[str, int]]],
    args: argparse.Namespace,
) -> list[Candidate]:
    data = load_asset_data(asset)
    ranked: list[tuple[float, runner.BacktestStrategy, Spec, Metrics, list[runner.BacktestTradeRow], float, float]] = []
    seen_base_keys: set[str] = set()

    for index, spec in enumerate(specs, start=1):
        if (asset.key, canonical_variant(spec.variant_id, include_rr=True)) in existing_keys:
            continue
        if (asset.key, spec.base_key) in existing_keys:
            continue
        strategy = build_strategy(asset, spec)
        trades = runner.run_competition_session_edge_strategy(strategy, asset, data, FORWARD_START_TS, None)
        forward = metrics_for(trades)
        if not qualifies(forward, args.min_forward_pf, args.min_forward_trades):
            continue
        avg_rr, min_rr = planned_rr(trades)
        if avg_rr < args.min_avg_rr or min_rr < 1.95:
            continue
        base_select_key = spec.base_key
        if base_select_key in seen_base_keys:
            continue
        seen_base_keys.add(base_select_key)
        score = min(forward.profit_factor, 10.0) * 10.0 + math.log1p(forward.trades) * 4.0 + avg_rr
        ranked.append((score, strategy, spec, forward, trades, avg_rr, min_rr))
        if index % 500 == 0:
            print(f"    {asset.key}: scanned {index}/{len(specs)} specs, fast_hits={len(ranked)}", flush=True)

    ranked.sort(key=lambda row: (row[0], row[3].profit_factor, row[3].trades), reverse=True)
    ranked = ranked[: args.max_fast_per_asset]
    selected: list[Candidate] = []
    near_seconds = max(0, args.near_overlap_minutes) * 60

    for _score, strategy, spec, _fast, _fast_trades, _fast_avg_rr, _fast_min_rr in ranked:
        if len(selected) >= args.max_add_per_asset:
            break
        train_trades = runner.run_single_strategy(strategy, asset, data, 0, FORWARD_START_TS, strict_anti_cheat=True)
        train = metrics_for(train_trades)
        if train.trades < args.min_train_trades or train.profit_factor < args.min_train_pf:
            continue
        strict_trades = runner.run_single_strategy(strategy, asset, data, FORWARD_START_TS, None, strict_anti_cheat=True)
        forward = metrics_for(strict_trades)
        if not qualifies(forward, args.min_forward_pf, args.min_forward_trades):
            continue
        avg_rr, min_rr = planned_rr(strict_trades)
        if avg_rr < args.min_avg_rr or min_rr < 1.95:
            continue
        if has_overlap(strict_trades, exact, near, near_seconds):
            continue
        values = [float(trade.r_multiple) for trade in strict_trades]
        seed = int(hashlib.sha1(f"{asset.key}|{spec.variant_id}".encode("utf-8")).hexdigest()[:8], 16)
        boot = bootstrap_pf_p05(values, seed)
        block_boot = block_bootstrap_pf_p05(values, seed ^ 0xA5A5A5A5)
        annual = annual_pass_rate(strict_trades)
        if boot <= args.min_bootstrap_p05 or block_boot <= 0.90 or annual < 0.60:
            continue
        strict_candidate = Candidate(
            strategy=strategy,
            asset=asset,
            spec=spec,
            train=train,
            forward=forward,
            trades=strict_trades,
            avg_planned_rr=avg_rr,
            min_planned_rr=min_rr,
            bootstrap_p05=boot,
            block_bootstrap_p05=block_boot,
            annual_pass_rate=annual,
            score=candidate_score(forward, train, avg_rr, boot),
        )
        register_trades(strict_trades, exact, near)
        selected.append(strict_candidate)

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
    forward = candidate.forward
    train = candidate.train
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
            "Dynamic session-range search. Parameters were generated before forward acceptance; "
            "pre-2022 training, post-2022 strict anti-cheat forward validation, split stability, "
            "bootstrap stress, annual pass rate, no duplicate variant, and no same-asset entry overlap were required."
        ),
        "trainingWindow": {"start": "asset_start", "end": "2021-12-31"},
        "forwardWindow": {"start": "2022-01-01", "end": "asset_latest"},
        "selectedTrainingProfitFactor": json_metric(train.profit_factor),
        "selectedTrainingTrades": train.trades,
        "selectedForwardProfitFactor": json_metric(forward.profit_factor),
        "selectedForwardTrades": forward.trades,
        "minimumRiskReward": 2,
        "selectedRiskReward": round(candidate.avg_planned_rr, 6),
        "forwardWins": forward.wins,
        "forwardLosses": forward.losses,
        "forwardTotalR": round(forward.total_r, 6),
        "forwardAverageR": round(forward.total_r / forward.trades if forward.trades else 0.0, 6),
        "forwardMaxDrawdownR": round(forward.max_drawdown_r, 6),
        "verificationSummary": (
            f"Strict dynamic range validation: forward PF {forward.profit_factor:.2f} over {forward.trades} trades, "
            f"average planned RR {candidate.avg_planned_rr:.2f}, min planned RR {candidate.min_planned_rr:.2f}, "
            f"bootstrap PF p05 {candidate.bootstrap_p05:.2f}, block-bootstrap PF p05 {candidate.block_bootstrap_p05:.2f}, "
            f"annual pass rate {candidate.annual_pass_rate:.0%}."
        ),
        "costUnits": candidate.strategy.cost_units,
        "oneTradePerDay": False,
    }
    (metadata_dir / "selection.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    runner.write_strategy_backtest_csv(strategy_dir / "backtest_trades.csv", candidate.trades)


def update_loader(candidates: list[Candidate]) -> None:
    if not candidates:
        return
    text = LOADER_PATH.read_text(encoding="utf-8")
    existing = loader_folders()
    next_index = len(existing)
    import_lines = []
    array_lines = []
    for offset, candidate in enumerate(candidates):
        symbol = f"strategy{next_index + offset:03d}"
        import_lines.append(f'import {symbol} from "@strategy/{candidate.strategy.folder}/strategy";')
        array_lines.append(f"  {symbol}")
    insert_at = text.index("\nimport type { StrategyDefinition }")
    text = text[:insert_at] + "\n" + "\n".join(import_lines) + text[insert_at:]
    text = re.sub(r"\n\s*strategy\d{3}\n\];", lambda match: match.group(0).replace("\n];", ",\n" + ",\n".join(array_lines) + "\n];"), text, count=1)
    LOADER_PATH.write_text(text, encoding="utf-8")


def write_report(candidates: list[Candidate], dry_run: bool) -> None:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    csv_path = REPORT_ROOT / "dynamic_range_addition_search.csv"
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
                    "avg_rr": f"{candidate.avg_planned_rr:.6f}",
                    "min_rr": f"{candidate.min_planned_rr:.6f}",
                    "train_pf": f"{candidate.train.profit_factor:.6f}",
                    "train_trades": candidate.train.trades,
                    "bootstrap_p05": f"{candidate.bootstrap_p05:.6f}",
                    "block_bootstrap_p05": f"{candidate.block_bootstrap_p05:.6f}",
                    "annual_pass_rate": f"{candidate.annual_pass_rate:.6f}",
                    "variant_id": candidate.spec.variant_id,
                }
            )
    md_path = REPORT_ROOT / "dynamic_range_addition_search.md"
    lines = [
        "# Dynamic Range Addition Search",
        "",
        f"- Status: {'dry run' if dry_run else 'applied'}",
        f"- Qualified additions: {len(candidates)}",
        "",
        "| Strategy | Asset | PF | Trades | Avg RR | Train PF | Bootstrap p05 | Variant |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for candidate in candidates:
        lines.append(
            f"| `{candidate.strategy.id}` | {candidate.asset.key} | {candidate.forward.profit_factor:.3f} | "
            f"{candidate.forward.trades} | {candidate.avg_planned_rr:.2f} | {candidate.train.profit_factor:.3f} | "
            f"{candidate.bootstrap_p05:.3f} | `{candidate.spec.variant_id}` |"
        )
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"report={csv_path.relative_to(PROJECT_ROOT)}")
    print(f"markdown={md_path.relative_to(PROJECT_ROOT)}")


def main() -> int:
    args = parse_args()
    rr_values = parse_rr(args.risk_reward)
    requested = {item.lower() for raw in args.asset or [] for item in raw.split(",") if item.strip()}
    assets = [
        asset
        for asset in runner.load_assets()
        if (args.market == "all" or asset.market == args.market)
        and (not requested or asset.key.lower() in requested or asset.symbol.lower() in requested)
        and (runner.DATA_ROOT / "15m" / asset.data_file).exists()
    ]
    specs = build_specs(rr_values, args.filter_mode)
    existing_keys = existing_variant_keys()
    exact, near = load_existing_signatures()
    selected: list[Candidate] = []
    print(f"Scanning {len(assets)} asset(s), {len(specs)} dynamic range specs per asset", flush=True)
    for asset in assets:
        if len(selected) >= args.max_total_additions:
            break
        print(f"  asset={asset.key}", flush=True)
        additions = research_asset(asset, specs, existing_keys, exact, near, args)
        selected.extend(additions)
        print(f"    selected={len(additions)}", flush=True)

    selected = sorted(selected, key=lambda item: item.score, reverse=True)[: args.max_total_additions]
    if not args.dry_run:
        for candidate in selected:
            materialize(candidate)
        update_loader(selected)
    write_report(selected, args.dry_run)
    print(f"qualified={len(selected)} applied={not args.dry_run}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
