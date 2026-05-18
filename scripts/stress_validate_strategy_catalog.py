from __future__ import annotations

import csv
import hashlib
import json
import math
import random
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
STRATEGY_ROOT = PROJECT_ROOT / "strategy"
LOADER_PATH = PROJECT_ROOT / "src" / "lib" / "strategy-loader.ts"
REPORT_ROOT = PROJECT_ROOT / "Research" / "reports"
BOOTSTRAP_SAMPLES = 800
BLOCK_SIZE = 5


@dataclass(frozen=True)
class Trade:
    entry_time: datetime
    side: str
    r_multiple: float
    tp_units: float
    sl_units: float


def fmt(value: float | None) -> str:
    if value is None:
        return ""
    if math.isinf(value):
        return "Infinity"
    return f"{value:.6f}"


def parse_timestamp(value: str) -> datetime:
    raw = value.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    parsed = datetime.fromisoformat(raw)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


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


def loader_folders() -> list[str]:
    text = LOADER_PATH.read_text(encoding="utf-8")
    return re.findall(r'@strategy/([^/]+)/strategy', text)


def read_metadata(folder: str) -> dict[str, object]:
    for relative in ("machine_learning/selection.json", "bayes/selection.json", "parameters/backtest.json"):
        path = STRATEGY_ROOT / folder / relative
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    return {}


def read_trades(folder: str) -> list[Trade]:
    path = STRATEGY_ROOT / folder / "backtest_trades.csv"
    trades: list[Trade] = []
    with path.open("r", newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            trades.append(
                Trade(
                    entry_time=parse_timestamp(row.get("entry_time") or row.get("signal_time") or row["exit_time"]),
                    side=str(row.get("side", "")).lower(),
                    r_multiple=float(row["r_multiple"]),
                    tp_units=abs(float(row.get("tp_units", 0) or 0)),
                    sl_units=abs(float(row.get("sl_units", 0) or 0)),
                )
            )
    return sorted(trades, key=lambda trade: trade.entry_time)


def split_evenly(values: list[float], parts: int) -> list[list[float]]:
    cuts = [math.ceil(len(values) * index / parts) for index in range(1, parts)]
    output: list[list[float]] = []
    start = 0
    for cut in cuts + [len(values)]:
        output.append(values[start:cut])
        start = cut
    return output


def rolling_window_pfs(values: list[float], window: int = 20) -> list[float]:
    if len(values) < window:
        return [profit_factor(values)]
    return [profit_factor(values[index : index + window]) for index in range(0, len(values) - window + 1)]


def bootstrap_pf_p05(values: list[float], seed: int) -> float:
    rng = random.Random(seed)
    samples: list[float] = []
    for _ in range(BOOTSTRAP_SAMPLES):
        draw = [values[rng.randrange(len(values))] for _ in range(len(values))]
        samples.append(profit_factor(draw))
    return percentile(samples, 0.05)


def block_bootstrap_pf_p05(values: list[float], seed: int) -> float:
    rng = random.Random(seed)
    blocks = [values[index : index + BLOCK_SIZE] for index in range(0, max(1, len(values) - BLOCK_SIZE + 1))]
    samples: list[float] = []
    for _ in range(BOOTSTRAP_SAMPLES):
        draw: list[float] = []
        while len(draw) < len(values):
            draw.extend(blocks[rng.randrange(len(blocks))])
        samples.append(profit_factor(draw[: len(values)]))
    return percentile(samples, 0.05)


def annual_stats(trades: list[Trade]) -> tuple[int, float, float]:
    by_year: dict[int, list[float]] = defaultdict(list)
    for trade in trades:
        by_year[trade.entry_time.year].append(trade.r_multiple)
    pfs = [profit_factor(values) for values in by_year.values() if len(values) >= 5]
    if not pfs:
        return 0, 0.0, 0.0
    return len(pfs), sum(1 for value in pfs if value > 1.0) / len(pfs), min(pfs)


def min_planned_rr(trades: list[Trade]) -> float | None:
    ratios = [trade.tp_units / trade.sl_units for trade in trades if trade.tp_units > 0 and trade.sl_units > 0]
    return min(ratios) if ratios else None


def validate_folder(folder: str, rank: int) -> dict[str, str]:
    metadata = read_metadata(folder)
    trades = read_trades(folder)
    values = [trade.r_multiple for trade in trades]
    halves = [profit_factor(split) for split in split_evenly(values, 2)]
    quarters = [profit_factor(split) for split in split_evenly(values, 4)]
    rolling = rolling_window_pfs(values, 20)
    annual_windows, annual_pass_rate, worst_annual_pf = annual_stats(trades)
    stable_seed = int(hashlib.sha1(str(metadata.get("strategyId", folder)).encode("utf-8")).hexdigest()[:8], 16)
    simple_bootstrap = bootstrap_pf_p05(values, 9173 ^ stable_seed)
    block_bootstrap = block_bootstrap_pf_p05(values, 42017 ^ stable_seed)
    rr = min_planned_rr(trades)
    checks = {
        "overall_pf_gt_1": profit_factor(values) > 1.0,
        "trades_ge_20": len(values) >= 20,
        "half_pf_gt_1": min(halves) > 1.0,
        "quarter_pf_gt_1": min(quarters) > 1.0,
        "rolling_pf_p25_gt_1": percentile(rolling, 0.25) > 1.0,
        "simple_bootstrap_p05_gt_1": simple_bootstrap > 1.0,
        "block_bootstrap_p05_gt_0_9": block_bootstrap > 0.9,
        "annual_walk_forward_pass_rate_ge_60pct": annual_pass_rate >= 0.6,
    }
    status = "pass" if all(checks.values()) else "watch"
    return {
        "strategy_id": str(metadata.get("strategyId", folder)),
        "folder": folder,
        "asset_key": str(metadata.get("assetKey", "")),
        "phase": str(metadata.get("phase", "")),
        "trades": str(len(values)),
        "overall_pf": fmt(profit_factor(values)),
        "total_r": fmt(sum(values)),
        "max_drawdown_r": fmt(max_drawdown(values)),
        "min_half_pf": fmt(min(halves)),
        "min_quarter_pf": fmt(min(quarters)),
        "rolling20_pf_p25": fmt(percentile(rolling, 0.25)),
        "bootstrap_pf_p05": fmt(simple_bootstrap),
        "block_bootstrap_pf_p05": fmt(block_bootstrap),
        "annual_windows": str(annual_windows),
        "annual_pass_rate": fmt(annual_pass_rate),
        "worst_annual_pf": fmt(worst_annual_pf),
        "min_planned_rr": fmt(rr),
        "status": status,
        "failed_checks": ",".join(key for key, passed in checks.items() if not passed),
    }


def main() -> int:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    rows = [validate_folder(folder, index) for index, folder in enumerate(loader_folders())]
    csv_path = REPORT_ROOT / "stress_validation_catalog.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    counts: dict[str, int] = defaultdict(int)
    for row in rows:
        counts[row["status"]] += 1
    summary = {
        "strategies": len(rows),
        "statusCounts": dict(counts),
        "minOverallPf": min(float(row["overall_pf"]) for row in rows),
        "minQuarterPf": min(float(row["min_quarter_pf"]) for row in rows),
        "minBootstrapPfP05": min(float(row["bootstrap_pf_p05"]) for row in rows),
        "minBlockBootstrapPfP05": min(float(row["block_bootstrap_pf_p05"]) for row in rows),
        "minAnnualPassRate": min(float(row["annual_pass_rate"]) for row in rows),
        "methods": [
            "chronological half and quarter folds",
            "rolling 20-trade PF lower-quartile",
            "ordinary bootstrap PF p05",
            "5-trade block bootstrap PF p05",
            "calendar-year walk-forward pass rate",
            "drawdown and planned RR audit",
        ],
    }
    summary_path = REPORT_ROOT / "stress_validation_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
