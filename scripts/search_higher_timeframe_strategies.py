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
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import numpy as np


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backtest-engine"))

import runner  # noqa: E402


STRATEGY_ROOT = PROJECT_ROOT / "strategy"
LOADER_PATH = PROJECT_ROOT / "src" / "lib" / "strategy-loader.ts"
REPORT_ROOT = PROJECT_ROOT / "Research" / "reports"
SOURCE = "higher_timeframe_rigorous_search_2026_05"
EXECUTION_TIMEFRAME: str | None = None
DEFAULT_TIMEFRAMES = ("10m", "15m", "30m", "45m", "1h", "4h", "1d", "1w")
TIMEFRAME_SECONDS = {
    "1m": 60,
    "5m": 5 * 60,
    "10m": 10 * 60,
    "15m": 15 * 60,
    "30m": 30 * 60,
    "45m": 45 * 60,
    "1h": 60 * 60,
    "4h": 4 * 60 * 60,
    "1d": 24 * 60 * 60,
    "1w": 7 * 24 * 60 * 60,
}
SOURCE_URLS = [
    "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253",
    "https://www.semanticscholar.org/paper/The-Probability-of-Backtest-Overfitting-Bailey-Borwein/b1233b4f5384f003e85c2e0eec1a2dfc08f624c5",
    "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551",
]

EVALUATORS = {
    "decile_forward_edge": ("evaluateDecileForwardEdge", "@/lib/strategy-runtime/decile-forward-edge"),
    "ict_sweep_fvg": ("evaluateIctSweepFvg", "@/lib/strategy-runtime/ict-sweep-fvg"),
    "ict_turtle_soup": ("evaluateIctTurtleSoup", "@/lib/strategy-runtime/ict-turtle-soup"),
    "moving_average_crossover": ("evaluateMovingAverageCrossover", "@/lib/strategy-runtime/moving-average-crossover"),
    "moving_average_touch": ("evaluateMovingAverageTouch", "@/lib/strategy-runtime/moving-average-touch"),
    "percentile_range_study": ("evaluatePercentileRangeStudy", "@/lib/strategy-runtime/percentile-range-study"),
    "reddit_ema_pullback": ("evaluateRedditEmaPullback", "@/lib/strategy-runtime/reddit-ema-pullback"),
    "round_number_rejection": ("evaluateRoundNumberRejection", "@/lib/strategy-runtime/round-number-rejection"),
    "support_resistance_retest": ("evaluateSupportResistanceRetest", "@/lib/strategy-runtime/support-resistance-retest"),
    "trendline_break": ("evaluateTrendlineBreak", "@/lib/strategy-runtime/trendline-break"),
    "vwap_pullback": ("evaluateVwapPullback", "@/lib/strategy-runtime/vwap-pullback"),
}


@dataclass(frozen=True)
class Metrics:
    trades: int
    wins: int
    losses: int
    win_rate_pct: float
    profit_factor: float
    total_r: float
    avg_r: float
    max_drawdown_r: float
    min_split_trades: int
    min_split_pf: float
    odd_even_min_pf: float
    annual_pass_rate: float
    worst_annual_pf: float
    bootstrap_pf_p05: float
    block_bootstrap_pf_p05: float
    sign_flip_p_value: float


@dataclass(frozen=True)
class Spec:
    phase: str
    variant_id: str
    label: str
    summary: str
    timeframe: str
    risk_reward: float
    tp_units: float | None
    sl_units: float | None
    family_key: str


@dataclass(frozen=True)
class Candidate:
    strategy: runner.BacktestStrategy
    asset: runner.AssetConfig
    spec: Spec
    train: Metrics
    forward: Metrics
    overall: Metrics
    trades: list[runner.BacktestTradeRow]
    avg_planned_rr: float
    min_planned_rr: float
    score: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Search higher-timeframe strategies with normal backtest exits and anti-overfit gates.")
    parser.add_argument("--asset", action="append", help="Asset key or symbol to scan. Repeat or comma-separate.")
    parser.add_argument("--market", choices=["all", "forex", "futures", "crypto", "gold_spot"], default="all")
    parser.add_argument("--timeframe", action="append", help="Analysis timeframe(s). Defaults to 10m,15m,30m,45m,1h,4h,1d,1w.")
    parser.add_argument("--risk-reward", default="2,3", help="Comma-separated RR values. Values below 2 are ignored.")
    parser.add_argument("--min-forward-pf", type=float, default=2.0)
    parser.add_argument("--min-overall-pf", type=float, default=2.0)
    parser.add_argument("--min-forward-trades", type=int, default=20)
    parser.add_argument("--min-train-trades", type=int, default=8)
    parser.add_argument("--min-train-pf", type=float, default=1.0)
    parser.add_argument("--min-split-trades", type=int, default=3)
    parser.add_argument("--min-split-pf", type=float, default=1.0)
    parser.add_argument("--min-bootstrap-p05", type=float, default=1.0)
    parser.add_argument("--min-block-bootstrap-p05", type=float, default=0.9)
    parser.add_argument("--min-annual-pass-rate", type=float, default=0.6)
    parser.add_argument("--max-sign-flip-p", type=float, default=0.10)
    parser.add_argument("--prefer-win-rate", type=float, default=60.0)
    parser.add_argument("--near-overlap-minutes", type=int, default=45)
    parser.add_argument("--max-specs-per-asset-timeframe", type=int, default=420)
    parser.add_argument("--max-fast-per-asset-timeframe", type=int, default=16)
    parser.add_argument("--max-add-per-asset", type=int, default=2)
    parser.add_argument("--max-total-additions", type=int, default=12)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def parse_csv_list(values: Iterable[str] | None) -> list[str]:
    output: list[str] = []
    for raw in values or []:
        output.extend(item.strip() for item in raw.split(",") if item.strip())
    return output


def parse_rr(raw: str) -> list[float]:
    values: list[float] = []
    for item in raw.split(","):
        try:
            value = float(item.strip())
        except ValueError:
            continue
        if math.isfinite(value) and value >= 2.0:
            values.append(value)
    return sorted(set(values)) or [2.0]


def fmt_rr(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value:g}"


def slug(value: str, max_len: int = 90) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")[:max_len].strip("_")


def symbol_label(asset: runner.AssetConfig) -> str:
    return asset.symbol.upper().replace("/", "")


def loader_folders() -> list[str]:
    if not LOADER_PATH.exists():
        return []
    return re.findall(r'@strategy/([^/]+)/strategy', LOADER_PATH.read_text(encoding="utf-8"))


def canonical_variant(variant_id: str) -> str:
    tokens = [token for token in variant_id.split("|") if token]
    if not tokens:
        return ""
    keyed: dict[str, str] = {}
    loose: list[str] = []
    for token in tokens[1:]:
        if "=" not in token:
            loose.append(token)
            continue
        key, value = token.split("=", 1)
        keyed[key] = value
    return "|".join([tokens[0], *loose, *(f"{key}={keyed[key]}" for key in sorted(keyed))])


def existing_variant_keys() -> set[tuple[str, str]]:
    output: set[tuple[str, str]] = set()
    for folder in loader_folders():
        for relative in (Path("machine_learning") / "selection.json", Path("bayes") / "selection.json", Path("parameters") / "backtest.json"):
            metadata_path = STRATEGY_ROOT / folder / relative
            if not metadata_path.exists():
                continue
            try:
                payload = json.loads(metadata_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            output.add((str(payload.get("assetKey") or ""), canonical_variant(str(payload.get("variantId") or ""))))
            break
    return output


def parse_time(value: str) -> int | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        try:
            return int(float(value))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


def load_existing_trade_times() -> dict[tuple[str, str], list[tuple[int, int, str]]]:
    output: dict[tuple[str, str], list[tuple[int, int, str]]] = {}
    for folder in loader_folders():
        csv_path = STRATEGY_ROOT / folder / "backtest_trades.csv"
        if not csv_path.exists():
            continue
        with csv_path.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                entry_time = parse_time(row.get("entry_time", ""))
                exit_time = parse_time(row.get("exit_time", "")) or entry_time
                asset_key = row.get("asset_key", "")
                side = row.get("side", "").lower()
                if entry_time is None or not asset_key or side not in {"long", "short"}:
                    continue
                output.setdefault((asset_key, side), []).append((entry_time, exit_time or entry_time, folder))
    for rows in output.values():
        rows.sort()
    return output


def side_name(side: int) -> str:
    return "long" if side == 1 else "short"


def selected_trade_overlaps(
    trades: list[runner.BacktestTradeRow],
    existing: dict[tuple[str, str], list[tuple[int, int, str]]],
    near_seconds: int,
    interval_overlap: bool = False,
) -> bool:
    for trade in trades:
        rows = existing.get((trade.asset_key, side_name(trade.side)), [])
        for entry_time, exit_time, _folder in rows:
            if abs(entry_time - trade.entry_time) <= near_seconds:
                return True
            if interval_overlap and trade.entry_time <= exit_time and entry_time <= trade.exit_time:
                return True
    return False


def register_trades(
    trades: list[runner.BacktestTradeRow],
    existing: dict[tuple[str, str], list[tuple[int, int, str]]],
    folder: str,
) -> None:
    for trade in trades:
        existing.setdefault((trade.asset_key, side_name(trade.side)), []).append((trade.entry_time, trade.exit_time, folder))


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
    sampled: list[float] = []
    for _ in range(samples):
        draw = [values[rng.randrange(len(values))] for _ in range(len(values))]
        sampled.append(profit_factor(draw))
    return percentile(sampled, 0.05)


def block_bootstrap_pf_p05(values: list[float], seed: int, samples: int = 250, block_size: int = 5) -> float:
    if not values:
        return 0.0
    rng = random.Random(seed)
    sampled: list[float] = []
    starts = list(range(len(values)))
    for _ in range(samples):
        draw: list[float] = []
        while len(draw) < len(values):
            start = rng.choice(starts)
            draw.extend(values[start : start + block_size])
            if start + block_size > len(values):
                draw.extend(values[: (start + block_size) % len(values)])
        sampled.append(profit_factor(draw[: len(values)]))
    return percentile(sampled, 0.05)


def sign_flip_p_value(values: list[float], seed: int, samples: int = 700) -> float:
    if not values:
        return 1.0
    observed = sum(values)
    if observed <= 0:
        return 1.0
    magnitudes = [abs(value) for value in values]
    rng = random.Random(seed)
    count = 0
    for _ in range(samples):
        synthetic = sum(value if rng.random() >= 0.5 else -value for value in magnitudes)
        if synthetic >= observed:
            count += 1
    return (count + 1) / (samples + 1)


def annual_metrics(trades: list[runner.BacktestTradeRow], min_trades: int) -> tuple[float, float]:
    by_year: dict[int, list[float]] = {}
    for trade in trades:
        year = datetime.fromtimestamp(int(trade.entry_time), tz=timezone.utc).year
        by_year.setdefault(year, []).append(float(trade.r_multiple))
    tested = [profit_factor(values) for _year, values in sorted(by_year.items()) if len(values) >= min_trades]
    if not tested:
        return 0.0, 0.0
    return sum(1 for value in tested if value >= 1.0) / len(tested), min(tested)


def metrics_for(trades: list[runner.BacktestTradeRow], seed: int, min_split_trades: int) -> Metrics:
    ordered = sorted(trades, key=lambda item: (item.entry_time, item.exit_time))
    values = [float(trade.r_multiple) for trade in ordered]
    splits = [split for split in split_values(values) if split]
    annual_pass_rate, worst_annual_pf = annual_metrics(ordered, min_split_trades)
    wins = sum(1 for value in values if value > 0)
    losses = sum(1 for value in values if value < 0)
    return Metrics(
        trades=len(values),
        wins=wins,
        losses=losses,
        win_rate_pct=(wins / len(values) * 100.0) if values else 0.0,
        profit_factor=profit_factor(values),
        total_r=sum(values),
        avg_r=(sum(values) / len(values)) if values else 0.0,
        max_drawdown_r=max_drawdown(values),
        min_split_trades=min((len(split) for split in splits), default=0),
        min_split_pf=min((profit_factor(split) for split in splits), default=0.0),
        odd_even_min_pf=min(profit_factor(values[::2]), profit_factor(values[1::2])),
        annual_pass_rate=annual_pass_rate,
        worst_annual_pf=worst_annual_pf,
        bootstrap_pf_p05=bootstrap_pf_p05(values, seed),
        block_bootstrap_pf_p05=block_bootstrap_pf_p05(values, seed ^ 0xA5A5A5A5),
        sign_flip_p_value=sign_flip_p_value(values, seed ^ 0x517CC1B7),
    )


def planned_rr(trades: list[runner.BacktestTradeRow]) -> tuple[float, float]:
    values = [
        abs(trade.tp_units) / abs(trade.sl_units)
        for trade in trades
        if abs(trade.tp_units) > 0 and abs(trade.sl_units) > 0
    ]
    if not values:
        return 0.0, 0.0
    return sum(values) / len(values), min(values)


def json_metric(value: float) -> float:
    if math.isnan(value):
        return 0.0
    if math.isinf(value):
        return 999.0
    return round(value, 6)


def data_exists(asset: runner.AssetConfig, timeframe: str) -> bool:
    return (runner.DATA_ROOT / timeframe / asset.data_file).exists()


def selected_assets(args: argparse.Namespace) -> list[runner.AssetConfig]:
    requested = {item.lower() for item in parse_csv_list(args.asset)}
    output: list[runner.AssetConfig] = []
    for asset in runner.load_assets():
        if args.market != "all" and asset.market != args.market:
            continue
        if requested and asset.key.lower() not in requested and asset.symbol.lower() not in requested:
            continue
        if EXECUTION_TIMEFRAME and not data_exists(asset, EXECUTION_TIMEFRAME):
            continue
        output.append(asset)
    return output


def selected_timeframes(args: argparse.Namespace) -> list[str]:
    requested = parse_csv_list(args.timeframe)
    values = requested or list(DEFAULT_TIMEFRAMES)
    return [value for value in values if value in DEFAULT_TIMEFRAMES]


def load_enriched(asset: runner.AssetConfig, timeframe: str, cache: dict[tuple[str, str], runner.EnrichedData]) -> runner.EnrichedData:
    key = (asset.key, timeframe)
    if key not in cache:
        frame = runner.load_candle_csv(runner.DATA_ROOT / timeframe / asset.data_file)
        cache[key] = runner.build_enriched_data(frame, asset)
    return cache[key]


def median_atr_units(data: runner.EnrichedData, asset: runner.AssetConfig) -> float:
    if asset.tick_size <= 0:
        return 100.0
    values = data.atr14[np.isfinite(data.atr14) & (data.atr14 > 0)]
    if values.shape[0] == 0:
        return 100.0
    return max(2.0, float(np.median(values)) / asset.tick_size)


def rounded_units(value: float) -> float:
    if value < 10:
        step = 1.0
    elif value < 100:
        step = 5.0
    else:
        step = 10.0
    return max(1.0, round(value / step) * step)


def unit_pairs(atr_units: float, rr_values: list[float]) -> list[tuple[float, float, float]]:
    pairs: list[tuple[float, float, float]] = []
    for sl_mult in (0.45, 0.70, 1.00):
        sl_units = rounded_units(atr_units * sl_mult)
        for rr in rr_values:
            pairs.append((sl_units * rr, sl_units, rr))
    deduped: dict[tuple[float, float], tuple[float, float, float]] = {}
    for tp_units, sl_units, rr in pairs:
        deduped[(tp_units, sl_units)] = (tp_units, sl_units, rr)
    return list(deduped.values())


def variant(head: str, *parts: tuple[str, str | int | float]) -> str:
    return "|".join([head, *(f"{key}={value}" for key, value in parts)])


def build_specs(timeframe: str, atr_units: float, rr_values: list[float], limit: int) -> list[Spec]:
    specs: list[Spec] = []
    tf_seconds = TIMEFRAME_SECONDS[timeframe]
    base_max_bars = max(3, min(36, round((6 * 60 * 60) / tf_seconds)))
    max_bars_values = sorted({base_max_bars, max(2, base_max_bars // 2), min(48, base_max_bars * 2)})

    def add(phase: str, family_key: str, label: str, summary: str, risk_reward: float, tp_units: float | None, sl_units: float | None, params: list[tuple[str, str | int | float]]) -> None:
        execution_tokens = [("exec_tf", EXECUTION_TIMEFRAME)] if EXECUTION_TIMEFRAME else []
        tokens = [("tf", timeframe), *execution_tokens, *params]
        specs.append(
            Spec(
                phase=phase,
                variant_id=variant(phase, *tokens),
                label=label,
                summary=summary,
                timeframe=timeframe,
                risk_reward=risk_reward,
                tp_units=tp_units,
                sl_units=sl_units,
                family_key=family_key,
            )
        )

    for tp_units, sl_units, rr in unit_pairs(atr_units, rr_values):
        rr_text = fmt_rr(rr)
        for max_bars in max_bars_values:
            for range_bars in (12, 24, 48):
                for study_bars in (180, 360):
                    for horizon_bars in (1, 2, 4):
                        for buckets in (10, 20):
                            params = [
                                ("range", range_bars),
                                ("study", study_bars),
                                ("horizon", horizon_bars),
                                ("buckets", buckets),
                                ("min_samples", 10),
                                ("edge_ticks", max(2, round(sl_units * 0.10))),
                                ("trend", "ema"),
                                ("max_bars", max_bars),
                                ("rr", rr_text),
                                ("one_trade", 1),
                            ]
                            add(
                                "percentile_range_study",
                                f"percentile_{range_bars}_{study_bars}_{horizon_bars}_{buckets}",
                                f"Percentile range edge {timeframe} {rr_text}R",
                                "Rolling range-position conditional edge with normal strategy exits.",
                                rr,
                                tp_units,
                                sl_units,
                                params,
                            )

            for range_bars in (12, 24, 48, 96):
                for trend in ("ema", "all"):
                    for long_deciles, short_deciles in (("10", "1"), ("9,10", "1,2")):
                        params = [
                            ("range", range_bars),
                            ("buckets", 10),
                            ("long", long_deciles),
                            ("short", short_deciles),
                            ("trend", trend),
                            ("max_bars", max_bars),
                            ("rr", rr_text),
                            ("one_trade", 1),
                        ]
                        add(
                            "decile_forward_edge",
                            f"decile_{range_bars}_{trend}_{long_deciles}_{short_deciles}",
                            f"Decile forward edge {timeframe} {rr_text}R",
                            "Range decile transition edge, separated from percentile bucket study by entry trigger.",
                            rr,
                            tp_units,
                            sl_units,
                            params,
                        )

            for ma in ("EMA21", "EMA50", "SMA50"):
                for side in ("support_long", "resistance_short"):
                    for trend in ("ema", "all"):
                        params = [
                            ("ma", ma),
                            ("side", side),
                            ("fresh", 1),
                            ("trend", trend),
                            ("max_bars", max_bars),
                            ("rr", rr_text),
                            ("one_trade", 1),
                        ]
                        add(
                            "moving_average_touch",
                            f"ma_touch_{ma}_{side}_{trend}",
                            f"MA touch {timeframe} {rr_text}R",
                            "Single-side moving average touch continuation with normal strategy exits.",
                            rr,
                            tp_units,
                            sl_units,
                            params,
                        )

            for fast, slow, direction in (
                ("EMA21", "EMA50", "both"),
                ("EMA50", "EMA200", "both"),
                ("SMA50", "SMA200", "both"),
            ):
                params = [
                    ("fast", fast),
                    ("slow", slow),
                    ("direction", direction),
                    ("max_bars", max_bars),
                    ("rr", rr_text),
                    ("one_trade", 1),
                ]
                add(
                    "moving_average_crossover",
                    f"ma_cross_{fast}_{slow}_{direction}",
                    f"MA crossover {timeframe} {rr_text}R",
                    "Moving-average crossover trend trigger with normal strategy exits.",
                    rr,
                    tp_units,
                    sl_units,
                    params,
                )

        for max_bars in max_bars_values:
            for phase, family, label in (
                ("trendline_break", "trendline_break", "Trendline break"),
                ("vwap_pullback", "vwap_pullback", "VWAP pullback"),
                ("support_resistance_retest", "support_resistance_retest", "Support/resistance retest"),
                ("ict_turtle_soup", "ict_turtle_soup", "ICT turtle soup"),
                ("reddit_ema_pullback", "reddit_ema_pullback", "EMA pullback"),
            ):
                if timeframe in {"1d", "1w"} and phase in {"vwap_pullback", "support_resistance_retest", "ict_turtle_soup", "reddit_ema_pullback"}:
                    continue
                for trend in ("ema", "all"):
                    params = [
                        ("rr", rr_text),
                        ("sl_atr", 1.0),
                        ("threshold", 0.65),
                        ("trend", trend),
                        ("max_bars", max_bars),
                        ("one_trade", 1),
                    ]
                    add(
                        phase,
                        f"{family}_{trend}",
                        f"{label} {timeframe} {rr_text}R",
                        f"{label} with dynamic stop distance and normal strategy exits.",
                        rr,
                        None,
                        None,
                        params,
                    )

            if timeframe not in {"1d", "1w"}:
                params = [
                    ("rr", rr_text),
                    ("ict_rr", rr_text),
                    ("threshold", 0.65),
                    ("trend", "all"),
                    ("max_bars", max_bars),
                    ("one_trade", 1),
                ]
                add(
                    "ict_sweep_fvg",
                    "ict_sweep_fvg_limit",
                    f"ICT sweep FVG limit {timeframe} {rr_text}R",
            "Prior-day sweep plus FVG displacement using an OTE limit entry and normal strategy exits.",
                    rr,
                    None,
                    None,
                    params,
                )

    deduped: dict[str, Spec] = {}
    for spec in specs:
        deduped[canonical_variant(spec.variant_id)] = spec
    ordered = list(deduped.values())
    phase_priority = {
        "moving_average_touch": 0,
        "moving_average_crossover": 1,
        "trendline_break": 2,
        "vwap_pullback": 3,
        "support_resistance_retest": 4,
        "ict_turtle_soup": 5,
        "reddit_ema_pullback": 6,
        "ict_sweep_fvg": 7,
        "decile_forward_edge": 8,
        "percentile_range_study": 9,
    }
    ordered.sort(key=lambda spec: (phase_priority.get(spec.phase, 99), spec.family_key, spec.variant_id))
    return ordered[:limit]


def strategy_id_for(asset: runner.AssetConfig, spec: Spec) -> str:
    digest = hashlib.sha1(f"{asset.key}|{canonical_variant(spec.variant_id)}".encode("utf-8")).hexdigest()[:8]
    return f"higher_tf_{slug(asset.key, 38)}_{slug(spec.phase, 28)}_{slug(spec.timeframe, 8)}_{digest}"


def build_strategy(asset: runner.AssetConfig, spec: Spec) -> runner.BacktestStrategy:
    strategy_id = strategy_id_for(asset, spec)
    return runner.BacktestStrategy(
        id=strategy_id,
        label=f"{symbol_label(asset)} {spec.label}",
        folder=strategy_id,
        asset_key=asset.key,
        phase=spec.phase,
        variant_id=spec.variant_id,
        source=SOURCE,
        ict_risk_reward=spec.risk_reward if spec.phase == "ict_sweep_fvg" else None,
        tp_units=spec.tp_units,
        sl_units=spec.sl_units,
        one_trade_per_day=True,
        cost_units=0.0,
    )


def fast_qualifies(metrics: Metrics, args: argparse.Namespace) -> bool:
    return metrics.trades >= args.min_forward_trades and metrics.profit_factor >= args.min_forward_pf


def final_rejection_reason(candidate: Candidate, args: argparse.Namespace) -> str | None:
    if candidate.forward.trades < args.min_forward_trades:
        return "forward_trades"
    if candidate.forward.profit_factor < args.min_forward_pf:
        return "forward_pf"
    if candidate.overall.profit_factor < args.min_overall_pf:
        return "overall_pf"
    if candidate.train.trades < args.min_train_trades:
        return "train_trades"
    if candidate.train.profit_factor < args.min_train_pf:
        return "train_pf"
    if candidate.min_planned_rr < 1.95 or candidate.avg_planned_rr < 2.0:
        return "planned_rr"
    if candidate.forward.min_split_trades < args.min_split_trades:
        return "split_trades"
    if candidate.forward.min_split_pf < args.min_split_pf:
        return "split_pf"
    if candidate.forward.odd_even_min_pf < args.min_split_pf:
        return "odd_even_pf"
    if candidate.forward.annual_pass_rate < args.min_annual_pass_rate:
        return "annual_walk_forward"
    if candidate.forward.bootstrap_pf_p05 < args.min_bootstrap_p05:
        return "bootstrap_pf"
    if candidate.forward.block_bootstrap_pf_p05 < args.min_block_bootstrap_p05:
        return "block_bootstrap_pf"
    if candidate.forward.sign_flip_p_value > args.max_sign_flip_p:
        return "sign_flip"
    if candidate.forward.total_r <= 0 or candidate.forward.max_drawdown_r > max(candidate.forward.total_r, 1.0) * 1.25:
        return "drawdown"
    return None


def score_candidate(candidate: Candidate, args: argparse.Namespace) -> float:
    win_bonus = 4.0 if candidate.forward.win_rate_pct >= args.prefer_win_rate else candidate.forward.win_rate_pct / max(args.prefer_win_rate, 1.0)
    return (
        min(candidate.forward.profit_factor, 8.0) * 12.0
        + math.log1p(candidate.forward.trades) * 4.0
        + min(candidate.train.profit_factor, 4.0) * 2.0
        + min(candidate.forward.bootstrap_pf_p05, 4.0) * 3.0
        + min(candidate.forward.annual_pass_rate, 1.0) * 4.0
        + win_bonus
        - candidate.forward.sign_flip_p_value * 10.0
    )


def research_asset_timeframe(
    asset: runner.AssetConfig,
    timeframe: str,
    rr_values: list[float],
    existing_keys: set[tuple[str, str]],
    existing_trades: dict[tuple[str, str], list[tuple[int, int, str]]],
    cache: dict[tuple[str, str], runner.EnrichedData],
    args: argparse.Namespace,
) -> list[Candidate]:
    if not data_exists(asset, timeframe):
        return []

    data = load_enriched(asset, timeframe, cache)
    atr_units = median_atr_units(data, asset)
    specs = build_specs(timeframe, atr_units, rr_values, args.max_specs_per_asset_timeframe)
    fast_rows: list[tuple[float, runner.BacktestStrategy, Spec, Metrics]] = []
    print(f"    {timeframe}: specs={len(specs)} atr_units={atr_units:.1f}", flush=True)

    for spec in specs:
        if (asset.key, canonical_variant(spec.variant_id)) in existing_keys:
            continue
        strategy = build_strategy(asset, spec)
        seed = int(hashlib.sha1(f"{asset.key}|{spec.variant_id}|fast".encode("utf-8")).hexdigest()[:8], 16)
        trades = runner.run_single_strategy(strategy, asset, data, runner.BACKTEST_START_TS, None, strict_anti_cheat=False)
        metrics = metrics_for(trades, seed, args.min_split_trades)
        if not fast_qualifies(metrics, args):
            continue
        avg_rr, min_rr = planned_rr(trades)
        if avg_rr < 2.0 or min_rr < 1.95:
            continue
        fast_score = min(metrics.profit_factor, 8.0) * 10.0 + math.log1p(metrics.trades) * 4.0 + metrics.win_rate_pct / 10.0
        fast_rows.append((fast_score, strategy, spec, metrics))

    fast_rows.sort(key=lambda row: (row[0], row[3].profit_factor, row[3].trades), reverse=True)
    fast_rows = fast_rows[: args.max_fast_per_asset_timeframe]
    if not fast_rows:
        return []

    execution_data = load_enriched(asset, EXECUTION_TIMEFRAME, cache) if EXECUTION_TIMEFRAME else None
    selected: list[Candidate] = []
    near_seconds = max(args.near_overlap_minutes * 60, TIMEFRAME_SECONDS.get(timeframe, 0))
    seen_family: set[str] = set()

    for _fast_score, strategy, spec, _fast_metrics in fast_rows:
        if len(selected) >= args.max_add_per_asset:
            break
        family_key = f"{spec.timeframe}:{spec.phase}:{spec.family_key}"
        if family_key in seen_family:
            continue

        train_trades = runner.run_single_strategy(strategy, asset, data, 0, runner.BACKTEST_START_TS, strict_anti_cheat=True, execution_data=execution_data)
        forward_trades = runner.run_single_strategy(
            strategy,
            asset,
            data,
            runner.BACKTEST_START_TS,
            None,
            strict_anti_cheat=True,
            execution_data=execution_data,
        )
        overall_trades = sorted([*train_trades, *forward_trades], key=lambda item: (item.entry_time, item.exit_time))
        seed = int(hashlib.sha1(f"{asset.key}|{spec.variant_id}".encode("utf-8")).hexdigest()[:8], 16)
        train = metrics_for(train_trades, seed ^ 0x13579BDF, args.min_split_trades)
        forward = metrics_for(forward_trades, seed, args.min_split_trades)
        overall = metrics_for(overall_trades, seed ^ 0x2468ACE0, args.min_split_trades)
        avg_rr, min_rr = planned_rr(forward_trades)
        candidate = Candidate(
            strategy=strategy,
            asset=asset,
            spec=spec,
            train=train,
            forward=forward,
            overall=overall,
            trades=forward_trades,
            avg_planned_rr=avg_rr,
            min_planned_rr=min_rr,
            score=0.0,
        )
        reason = final_rejection_reason(candidate, args)
        if reason is not None:
            continue
        if selected_trade_overlaps(forward_trades, existing_trades, near_seconds):
            continue
        candidate = Candidate(
            strategy=candidate.strategy,
            asset=candidate.asset,
            spec=candidate.spec,
            train=candidate.train,
            forward=candidate.forward,
            overall=candidate.overall,
            trades=candidate.trades,
            avg_planned_rr=candidate.avg_planned_rr,
            min_planned_rr=candidate.min_planned_rr,
            score=score_candidate(candidate, args),
        )
        selected.append(candidate)
        seen_family.add(family_key)
        register_trades(candidate.trades, existing_trades, candidate.strategy.folder)
        existing_keys.add((asset.key, canonical_variant(spec.variant_id)))

    return selected


def write_strategy_ts(path: Path, candidate: Candidate) -> None:
    evaluator, module_path = EVALUATORS[candidate.spec.phase]
    strategy = candidate.strategy
    asset = candidate.asset
    path.write_text(
        f'''import {{ createStrategyDefinition, runtimeDefaultsFromMetadata }} from "@/lib/strategy-definition";
import {{ {evaluator} }} from "{module_path}";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({{
  id: "{strategy.id}",
  label: "{strategy.label}",
  folder: "{strategy.folder}",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "{asset.key}",
  phase: "{strategy.phase}",
  liveEnabled: true,
  evaluator: {evaluator},
  defaults: runtimeDefaultsFromMetadata(selection)
}});
''',
        encoding="utf-8",
    )


def materialize(candidate: Candidate) -> None:
    strategy_dir = STRATEGY_ROOT / candidate.strategy.folder
    metadata_dir = strategy_dir / "machine_learning"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    write_strategy_ts(strategy_dir / "strategy.ts", candidate)
    payload = {
        "strategyId": candidate.strategy.id,
        "label": candidate.strategy.label,
        "folder": candidate.strategy.folder,
        "assetKey": candidate.asset.key,
        "phase": candidate.strategy.phase,
        "variantId": candidate.strategy.variant_id,
        "source": candidate.strategy.source,
        "sourceUrls": SOURCE_URLS,
        "researchSummary": candidate.spec.summary,
        "selectionMethod": (
            "Higher-timeframe grid search with immutable candidate parameters, strict anti-cheat replay, "
            "normal strategy exits, pre-2022 training diagnostics, post-2022 forward validation, "
            "chronological split tests, annual walk-forward pass rate, bootstrap and block-bootstrap PF stress, "
            "odd/even trade stability, sign-flip significance, and same-asset same-side no-overlap filtering."
        ),
        "trainingWindow": {"start": "asset_start", "end": "2021-12-31"},
        "forwardWindow": {"start": "2022-01-01", "end": "asset_latest"},
        "selectedTrainingProfitFactor": json_metric(candidate.train.profit_factor),
        "selectedTrainingTrades": candidate.train.trades,
        "selectedForwardProfitFactor": json_metric(candidate.forward.profit_factor),
        "selectedForwardTrades": candidate.forward.trades,
        "minimumRiskReward": 2,
        "selectedRiskReward": round(candidate.avg_planned_rr, 6),
        "forwardWins": candidate.forward.wins,
        "forwardLosses": candidate.forward.losses,
        "forwardTotalR": round(candidate.forward.total_r, 6),
        "forwardAverageR": round(candidate.forward.avg_r, 6),
        "forwardMaxDrawdownR": round(candidate.forward.max_drawdown_r, 6),
        "verificationSummary": (
            f"Forward PF {candidate.forward.profit_factor:.2f}, win rate {candidate.forward.win_rate_pct:.1f}%, "
            f"{candidate.forward.trades} trades, average RR {candidate.avg_planned_rr:.2f}, "
            f"min split PF {candidate.forward.min_split_pf:.2f}, annual pass {candidate.forward.annual_pass_rate:.0%}, "
            f"bootstrap p05 {candidate.forward.bootstrap_pf_p05:.2f}, block-bootstrap p05 {candidate.forward.block_bootstrap_pf_p05:.2f}, "
            f"sign-flip p={candidate.forward.sign_flip_p_value:.3f}; exits use the normal strategy timeframe."
        ),
        "costUnits": candidate.strategy.cost_units,
        "oneTradePerDay": True,
    }
    if candidate.spec.tp_units is not None:
        payload["tpUnits"] = round(candidate.spec.tp_units, 6)
    if candidate.spec.sl_units is not None:
        payload["slUnits"] = round(candidate.spec.sl_units, 6)
    if candidate.spec.phase == "ict_sweep_fvg":
        payload["ictRiskReward"] = candidate.spec.risk_reward
    (metadata_dir / "selection.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    runner.write_strategy_backtest_csv(strategy_dir / "backtest_trades.csv", candidate.trades)


def update_loader(candidates: list[Candidate]) -> None:
    if not candidates:
        return
    text = LOADER_PATH.read_text(encoding="utf-8")
    existing_indexes = [int(match) for match in re.findall(r"strategy(\d{3})", text)]
    next_index = (max(existing_indexes) + 1) if existing_indexes else 0
    imports: list[str] = []
    items: list[str] = []
    for offset, candidate in enumerate(candidates):
        name = f"strategy{next_index + offset:03d}"
        imports.append(f'import {name} from "@strategy/{candidate.strategy.folder}/strategy";')
        items.append(f"  {name}")
    insert_at = text.index("\nimport type { StrategyDefinition }")
    text = text[:insert_at] + "\n" + "\n".join(imports) + text[insert_at:]
    array_end = text.rfind("\n];")
    if array_end < 0:
        raise ValueError("Could not locate STRATEGY_DEFINITIONS array end")
    prefix = "," if re.search(r"strategy\d{3}\s*$", text[:array_end]) else ""
    text = text[:array_end] + prefix + "\n" + ",\n".join(items) + text[array_end:]
    LOADER_PATH.write_text(text, encoding="utf-8")


def write_report(candidates: list[Candidate], dry_run: bool) -> None:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    csv_path = REPORT_ROOT / "higher_timeframe_strategy_search.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "status",
                "strategy_id",
                "asset_key",
                "timeframe",
                "phase",
                "forward_pf",
                "forward_trades",
                "forward_win_rate_pct",
                "avg_rr",
                "train_pf",
                "train_trades",
                "overall_pf",
                "bootstrap_pf_p05",
                "block_bootstrap_pf_p05",
                "annual_pass_rate",
                "sign_flip_p_value",
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
                    "timeframe": candidate.spec.timeframe,
                    "phase": candidate.strategy.phase,
                    "forward_pf": f"{candidate.forward.profit_factor:.6f}",
                    "forward_trades": candidate.forward.trades,
                    "forward_win_rate_pct": f"{candidate.forward.win_rate_pct:.6f}",
                    "avg_rr": f"{candidate.avg_planned_rr:.6f}",
                    "train_pf": f"{candidate.train.profit_factor:.6f}",
                    "train_trades": candidate.train.trades,
                    "overall_pf": f"{candidate.overall.profit_factor:.6f}",
                    "bootstrap_pf_p05": f"{candidate.forward.bootstrap_pf_p05:.6f}",
                    "block_bootstrap_pf_p05": f"{candidate.forward.block_bootstrap_pf_p05:.6f}",
                    "annual_pass_rate": f"{candidate.forward.annual_pass_rate:.6f}",
                    "sign_flip_p_value": f"{candidate.forward.sign_flip_p_value:.6f}",
                    "variant_id": candidate.strategy.variant_id,
                }
            )
    summary = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "dryRun": dry_run,
        "selected": len(candidates),
        "methods": [
            "analysis timeframe entries",
            "normal strategy exits",
            "strict anti-cheat signal replay",
            "pre-2022 train / post-2022 forward split",
            "chronological quartile stability",
            "annual walk-forward pass rate",
            "bootstrap and block-bootstrap PF p05",
            "odd/even trade stability",
            "sign-flip statistical test",
            "same-asset same-side no-overlap filter",
        ],
    }
    (REPORT_ROOT / "higher_timeframe_strategy_search_summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(f"report={csv_path.relative_to(PROJECT_ROOT)}")


def main() -> int:
    args = parse_args()
    rr_values = parse_rr(args.risk_reward)
    timeframes = selected_timeframes(args)
    assets = selected_assets(args)
    existing_keys = existing_variant_keys()
    existing_trades = load_existing_trade_times()
    cache: dict[tuple[str, str], runner.EnrichedData] = {}
    selected: list[Candidate] = []
    additions_by_asset: dict[str, int] = {}
    print(f"Scanning {len(assets)} asset(s), timeframes={','.join(timeframes)}, rr={','.join(fmt_rr(value) for value in rr_values)}", flush=True)

    for asset in assets:
        if len(selected) >= args.max_total_additions:
            break
        additions_by_asset.setdefault(asset.key, 0)
        print(f"  asset={asset.key}", flush=True)
        for timeframe in timeframes:
            if len(selected) >= args.max_total_additions or additions_by_asset[asset.key] >= args.max_add_per_asset:
                break
            additions = research_asset_timeframe(asset, timeframe, rr_values, existing_keys, existing_trades, cache, args)
            slots = max(0, min(args.max_add_per_asset - additions_by_asset[asset.key], args.max_total_additions - len(selected)))
            if slots:
                additions = sorted(additions, key=lambda item: item.score, reverse=True)[:slots]
                selected.extend(additions)
                additions_by_asset[asset.key] += len(additions)
                if additions:
                    print(f"      selected={len(additions)}", flush=True)

    selected = sorted(selected, key=lambda item: item.score, reverse=True)[: args.max_total_additions]
    if not args.dry_run:
        for candidate in selected:
            materialize(candidate)
        update_loader(selected)
    write_report(selected, args.dry_run)
    print(f"qualified={len(selected)} applied={not args.dry_run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
