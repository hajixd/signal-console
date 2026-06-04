from __future__ import annotations

import argparse
import csv
import hashlib
import math
import random
import sys
from collections import Counter, defaultdict
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKTEST_ENGINE = PROJECT_ROOT / "backtest-engine"
REPORT_ROOT = PROJECT_ROOT / "Research" / "reports"
DEFAULT_INPUT = BACKTEST_ENGINE / "research" / "cross_market_results.csv"
DEFAULT_OUTPUT_CSV = REPORT_ROOT / "cross_market_rr_stress_20260604.csv"
DEFAULT_OUTPUT_MD = REPORT_ROOT / "cross_market_rr_stress_20260604.md"
BOOTSTRAP_SAMPLES = 800
BLOCK_SIZE = 5

sys.path.insert(0, str(BACKTEST_ENGINE))

import research_cross_market_strategies as cross  # noqa: E402
import runner  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Retest cross-market futures candidates with explicit bracket RR exits and stress checks."
    )
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output-csv", type=Path, default=DEFAULT_OUTPUT_CSV)
    parser.add_argument("--output-md", type=Path, default=DEFAULT_OUTPUT_MD)
    parser.add_argument("--source-min-pf", type=float, default=1.5)
    parser.add_argument("--source-min-trades", type=int, default=21)
    parser.add_argument("--min-pf", type=float, default=2.0)
    parser.add_argument("--min-trades", type=int, default=21)
    parser.add_argument("--rr", type=float, action="append", default=[3.0, 4.0, 5.0])
    parser.add_argument("--limit", type=int, default=40, help="Maximum source rows to retest after sorting.")
    parser.add_argument(
        "--direction-mode",
        choices=["best", "both"],
        default="best",
        help="Use the prior best direction only, or retest direct and opposite direction.",
    )
    return parser.parse_args()


def parse_bool(value: object) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def parse_float(value: object, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return parsed if math.isfinite(parsed) else fallback


def parse_int(value: object, fallback: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return fallback


def format_number(value: float | None) -> str:
    if value is None:
        return ""
    if math.isinf(value):
        return "Infinity"
    return f"{value:.6f}"


def rr_token(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value).rstrip("0").rstrip(".")


def variant_key(token: str) -> str:
    return token.split("=", 1)[0].strip().lower()


def force_rr_variant(variant_id: str, rr_value: float) -> str:
    drop_keys = {"exec_tf", "managed_exit", "rr", "risk_reward"}
    tokens = [
        token
        for token in str(variant_id).split("|")
        if token and variant_key(token) not in drop_keys
    ]
    rr_text = rr_token(rr_value)
    tokens.extend(["exec_tf=1m", "managed_exit=bracket", f"rr={rr_text}", f"risk_reward={rr_text}"])
    return "|".join(tokens)


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


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * pct) - 1))
    return ordered[index]


def split_evenly(values: list[float], parts: int) -> list[list[float]]:
    cuts = [math.ceil(len(values) * index / parts) for index in range(1, parts)]
    output: list[list[float]] = []
    start = 0
    for cut in cuts + [len(values)]:
        output.append(values[start:cut])
        start = cut
    return output


def rolling_window_pfs(values: list[float], window: int = 20) -> list[float]:
    if not values:
        return [0.0]
    if len(values) < window:
        return [profit_factor(values)]
    return [profit_factor(values[index : index + window]) for index in range(0, len(values) - window + 1)]


def bootstrap_pf_p05(values: list[float], seed: int) -> float:
    if not values:
        return 0.0
    rng = random.Random(seed)
    samples: list[float] = []
    for _ in range(BOOTSTRAP_SAMPLES):
        draw = [values[rng.randrange(len(values))] for _ in range(len(values))]
        samples.append(profit_factor(draw))
    return percentile(samples, 0.05)


def block_bootstrap_pf_p05(values: list[float], seed: int) -> float:
    if not values:
        return 0.0
    rng = random.Random(seed)
    blocks = [values[index : index + BLOCK_SIZE] for index in range(0, max(1, len(values) - BLOCK_SIZE + 1))]
    if not blocks:
        blocks = [values]
    samples: list[float] = []
    for _ in range(BOOTSTRAP_SAMPLES):
        draw: list[float] = []
        while len(draw) < len(values):
            draw.extend(blocks[rng.randrange(len(blocks))])
        samples.append(profit_factor(draw[: len(values)]))
    return percentile(samples, 0.05)


def annual_stats(trades: list[runner.BacktestTradeRow]) -> tuple[int, float, float]:
    by_year: dict[int, list[float]] = defaultdict(list)
    for trade in trades:
        year = datetime.fromtimestamp(int(trade.entry_time), tz=timezone.utc).year
        by_year[year].append(float(trade.r_multiple))
    pfs = [profit_factor(values) for values in by_year.values() if len(values) >= 5]
    if not pfs:
        return 0, 0.0, 0.0
    return len(pfs), sum(1 for value in pfs if value > 1.0) / len(pfs), min(pfs)


def min_planned_rr(trades: list[runner.BacktestTradeRow]) -> float | None:
    ratios = [
        abs(float(trade.tp_units)) / abs(float(trade.sl_units))
        for trade in trades
        if abs(float(trade.tp_units)) > 0 and abs(float(trade.sl_units)) > 0
    ]
    return min(ratios) if ratios else None


def exit_reason_summary(trades: list[runner.BacktestTradeRow]) -> str:
    counts = Counter(str(trade.exit_reason) for trade in trades)
    return ";".join(f"{reason}:{count}" for reason, count in sorted(counts.items()))


def read_source_rows(path: Path, source_min_pf: float, source_min_trades: int, limit: int) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    selected = [
        row
        for row in rows
        if row.get("target_market") == "futures"
        and parse_float(row.get("best_pf")) >= source_min_pf
        and parse_int(row.get("best_trades")) >= source_min_trades
        and parse_float(row.get("best_total_r")) > 0
    ]
    selected.sort(
        key=lambda row: (
            parse_float(row.get("best_pf")),
            parse_int(row.get("best_trades")),
            parse_float(row.get("best_total_r")),
        ),
        reverse=True,
    )
    return selected[:limit]


def candidate_directions(base: runner.BacktestStrategy, row: dict[str, str], mode: str) -> list[tuple[str, bool]]:
    direct_invert = bool(base.invert_signal)
    if mode == "both":
        return [("direct", direct_invert), ("opposite", not direct_invert)]
    best_invert = not direct_invert if parse_bool(row.get("best_inverted")) else direct_invert
    return [("best", best_invert)]


def stable_seed(*parts: object) -> int:
    digest = hashlib.sha1("|".join(str(part) for part in parts).encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def validate_candidate(
    row: dict[str, str],
    base: runner.BacktestStrategy,
    asset: runner.AssetConfig,
    direction_label: str,
    invert_signal: bool,
    rr_value: float,
    enriched_cache: dict[str, runner.EnrichedData],
    execution_cache: dict[str, runner.EnrichedData],
    execution_cache_order: list[str],
    min_pf: float,
    min_trades: int,
) -> dict[str, str]:
    variant_id = force_rr_variant(row["variant_id"], rr_value)
    clone = cross.clone_strategy(base, asset, invert_signal=invert_signal)
    strategy = replace(
        clone,
        id=f"{clone.id}__stress_rr_{rr_token(rr_value)}",
        label=f"{clone.label} RR {rr_token(rr_value)}",
        variant_id=variant_id,
    )
    trades = cross.run_strategy(strategy, asset, enriched_cache, execution_cache, execution_cache_order)
    trades = sorted(trades, key=lambda trade: int(trade.entry_time))
    values = [float(trade.r_multiple) for trade in trades]
    halves = [profit_factor(split) for split in split_evenly(values, 2)] if values else [0.0, 0.0]
    quarters = [profit_factor(split) for split in split_evenly(values, 4)] if values else [0.0, 0.0, 0.0, 0.0]
    rolling = rolling_window_pfs(values, 20)
    seed = stable_seed(row.get("base_strategy_id"), row.get("target_asset_key"), invert_signal, rr_value, variant_id)
    simple_bootstrap = bootstrap_pf_p05(values, 9173 ^ seed)
    block_bootstrap = block_bootstrap_pf_p05(values, 42017 ^ seed)
    annual_windows, annual_pass_rate, worst_annual_pf = annual_stats(trades)
    rr = min_planned_rr(trades)
    one_minute_refined_trades = sum(1 for trade in trades if str(trade.execution_timeframe) == "1m")
    all_exits_on_1m = bool(trades) and one_minute_refined_trades == len(trades)
    pf = profit_factor(values)
    total_r = sum(values)
    checks = {
        "execution_tf_1m_all_trades": all_exits_on_1m,
        "overall_pf_gt_min": pf > min_pf,
        "trades_ge_min": len(values) >= min_trades,
        "total_r_gt_0": total_r > 0,
        "planned_rr_gt_2": rr is not None and rr > 2.0,
        "half_pf_gt_1": min(halves) > 1.0,
        "quarter_pf_gt_1": min(quarters) > 1.0,
        "rolling20_pf_p25_gt_1": percentile(rolling, 0.25) > 1.0,
        "simple_bootstrap_p05_gt_1": simple_bootstrap > 1.0,
        "block_bootstrap_p05_gt_0_9": block_bootstrap > 0.9,
        "annual_walk_forward_pass_rate_ge_60pct": annual_pass_rate >= 0.6,
    }
    threshold_pass = all(checks[key] for key in ("overall_pf_gt_min", "trades_ge_min", "total_r_gt_0", "planned_rr_gt_2"))
    stress_pass = all(checks.values())
    status = "robust" if stress_pass else "qualified_watch" if threshold_pass else "reject"
    return {
        "status": status,
        "failed_checks": ",".join(key for key, passed in checks.items() if not passed),
        "base_strategy_id": row.get("base_strategy_id", ""),
        "base_asset_key": row.get("base_asset_key", ""),
        "target_asset_key": row.get("target_asset_key", ""),
        "target_symbol": row.get("target_symbol", ""),
        "phase": row.get("phase", ""),
        "direction": direction_label,
        "invert_signal": str(bool(invert_signal)),
        "rr": rr_token(rr_value),
        "execution_timeframe": "1m" if all_exits_on_1m else "",
        "one_minute_refined_trades": str(one_minute_refined_trades),
        "source_best_pf": format_number(parse_float(row.get("best_pf"))),
        "source_best_trades": str(parse_int(row.get("best_trades"))),
        "source_best_total_r": format_number(parse_float(row.get("best_total_r"))),
        "pf": format_number(pf),
        "trades": str(len(values)),
        "win_rate_pct": format_number((sum(1 for value in values if value > 0) / len(values) * 100) if values else 0.0),
        "total_r": format_number(total_r),
        "avg_r": format_number((total_r / len(values)) if values else 0.0),
        "max_drawdown_r": format_number(max_drawdown(values)),
        "min_half_pf": format_number(min(halves)),
        "min_quarter_pf": format_number(min(quarters)),
        "rolling20_pf_p25": format_number(percentile(rolling, 0.25)),
        "bootstrap_pf_p05": format_number(simple_bootstrap),
        "block_bootstrap_pf_p05": format_number(block_bootstrap),
        "annual_windows": str(annual_windows),
        "annual_pass_rate": format_number(annual_pass_rate),
        "worst_annual_pf": format_number(worst_annual_pf),
        "min_planned_rr": format_number(rr),
        "exit_reasons": exit_reason_summary(trades),
        "variant_id": variant_id,
    }


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(rows[0].keys()) if rows else ["status"]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_markdown(path: Path, rows: list[dict[str, str]], source_count: int) -> None:
    rows_by_status = Counter(row["status"] for row in rows)
    ranked = sorted(
        rows,
        key=lambda row: (
            row["status"] == "robust",
            row["status"] == "qualified_watch",
            parse_float(row.get("pf")),
            parse_int(row.get("trades")),
            parse_float(row.get("total_r")),
        ),
        reverse=True,
    )
    lines = [
        "# Cross-Market Futures RR Stress",
        "",
        f"- Source rows retested: {source_count}",
        "- Exit/stat execution timeframe: 1m",
        f"- RR brackets tested: {', '.join(sorted({row['rr'] for row in rows}, key=parse_float)) if rows else 'none'}",
        f"- Results: {dict(rows_by_status)}",
        "",
        "## Top Results",
        "",
        "| Status | Target | Base | RR | PF | Trades | Total R | Min Quarter PF | Bootstrap p05 | Block p05 | Annual Pass | Failed Checks |",
        "|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for row in ranked[:30]:
        lines.append(
            "| {status} | {target} | {base} | {rr} | {pf} | {trades} | {total_r} | {quarter} | {boot} | {block} | {annual} | {failed} |".format(
                status=row["status"],
                target=row["target_symbol"] or row["target_asset_key"],
                base=row["base_strategy_id"],
                rr=row["rr"],
                pf=row["pf"],
                trades=row["trades"],
                total_r=row["total_r"],
                quarter=row["min_quarter_pf"],
                boot=row["bootstrap_pf_p05"],
                block=row["block_bootstrap_pf_p05"],
                annual=row["annual_pass_rate"],
                failed=row["failed_checks"] or "none",
            )
        )
    lines.extend(
        [
            "",
            "## Gates",
            "",
            "- `robust`: all trades refined on 1m execution data, PF above threshold, trade count, positive total R, planned RR > 2, chronological half/quarter PF > 1, rolling 20-trade lower-quartile PF > 1, bootstrap p05 > 1, block bootstrap p05 > 0.9, annual pass rate >= 60%.",
            "- `qualified_watch`: PF/RR/trade-count gate passed, but at least one robustness check failed.",
            "- `reject`: did not pass the PF/RR/trade-count gate.",
            "",
        ]
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    args = parse_args()
    source_rows = read_source_rows(args.input, args.source_min_pf, args.source_min_trades, args.limit)
    assets = runner.load_asset_by_key()
    strategies = {strategy.id: strategy for strategy in runner.load_backtest_strategies()}
    enriched_cache: dict[str, runner.EnrichedData] = {}
    execution_cache: dict[str, runner.EnrichedData] = {}
    execution_cache_order: list[str] = []
    output_rows: list[dict[str, str]] = []
    total_tests = len(source_rows) * len(args.rr) * (2 if args.direction_mode == "both" else 1)
    completed = 0
    print(f"Retesting {len(source_rows)} source rows across {total_tests} RR/direction combinations")

    for row in source_rows:
        base = strategies.get(row["base_strategy_id"])
        asset = assets.get(row["target_asset_key"])
        if base is None or asset is None:
            continue
        for direction_label, invert_signal in candidate_directions(base, row, args.direction_mode):
            for rr_value in args.rr:
                completed += 1
                output_rows.append(
                    validate_candidate(
                        row,
                        base,
                        asset,
                        direction_label,
                        invert_signal,
                        rr_value,
                        enriched_cache,
                        execution_cache,
                        execution_cache_order,
                        args.min_pf,
                        args.min_trades,
                    )
                )
                if completed % 5 == 0 or completed == total_tests:
                    print(f"Completed {completed}/{total_tests} RR stress tests")

    output_rows.sort(
        key=lambda row: (
            row["status"] == "robust",
            row["status"] == "qualified_watch",
            parse_float(row.get("pf")),
            parse_int(row.get("trades")),
            parse_float(row.get("total_r")),
        ),
        reverse=True,
    )
    write_csv(args.output_csv, output_rows)
    write_markdown(args.output_md, output_rows, len(source_rows))
    print(f"Wrote {len(output_rows)} rows to {args.output_csv}")
    print(f"Wrote markdown report to {args.output_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
