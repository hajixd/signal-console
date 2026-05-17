from __future__ import annotations

import csv
import json
import math
import random
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
REPORT_ROOT = PROJECT_ROOT / "Research" / "reports"
SELECTED_REPORT = REPORT_ROOT / "top_strategy_pf_split_report.csv"
STRATEGY_ROOT = PROJECT_ROOT / "strategy"
NEAR_DUPLICATE_SECONDS = 15 * 60
BOOTSTRAP_SAMPLES = 600


@dataclass(frozen=True)
class Trade:
    strategy_id: str
    asset_key: str
    side: str
    entry_time: int
    r_multiple: float


def parse_timestamp(value: str) -> int:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return int(float(value))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


def iso_year(timestamp: int) -> int:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).year


def profit_factor(values: list[float]) -> float:
    gross_profit = sum(value for value in values if value > 0)
    gross_loss = sum(abs(value) for value in values if value < 0)
    if gross_loss == 0:
        return math.inf if gross_profit > 0 else 0.0
    return gross_profit / gross_loss


def fmt(value: float) -> str:
    if math.isinf(value):
        return "Infinity"
    return f"{value:.6f}"


def split_values(values: list[float], parts: int) -> list[list[float]]:
    cuts = [math.ceil(len(values) * index / parts) for index in range(1, parts)]
    output: list[list[float]] = []
    start = 0
    for cut in cuts + [len(values)]:
        output.append(values[start:cut])
        start = cut
    return output


def bootstrap_pf_p05(values: list[float], seed: int) -> float:
    if not values:
        return 0.0
    rng = random.Random(seed)
    samples: list[float] = []
    for _ in range(BOOTSTRAP_SAMPLES):
        draw = [values[rng.randrange(len(values))] for _ in range(len(values))]
        samples.append(profit_factor(draw))
    samples.sort()
    return samples[max(0, int(len(samples) * 0.05) - 1)]


def max_drawdown(values: list[float]) -> float:
    equity = 0.0
    peak = 0.0
    drawdown = 0.0
    for value in values:
        equity += value
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
    return drawdown


def read_selected_rows() -> list[dict[str, str]]:
    with SELECTED_REPORT.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def read_trades(folder: str) -> list[Trade]:
    path = STRATEGY_ROOT / folder / "backtest_trades.csv"
    trades: list[Trade] = []
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            trades.append(
                Trade(
                    strategy_id=row["strategy_id"],
                    asset_key=row["asset_key"],
                    side=row["side"].lower(),
                    entry_time=parse_timestamp(row["entry_time"]),
                    r_multiple=float(row["r_multiple"]),
                )
            )
    trades.sort(key=lambda trade: trade.entry_time)
    return trades


def near_duplicate_pairs(all_trades: list[Trade]) -> dict[tuple[str, str], int]:
    by_asset_side: dict[tuple[str, str], list[Trade]] = defaultdict(list)
    for trade in all_trades:
        by_asset_side[(trade.asset_key, trade.side)].append(trade)

    pair_counts: dict[tuple[str, str], int] = defaultdict(int)
    for trades in by_asset_side.values():
        trades.sort(key=lambda trade: trade.entry_time)
        for index, trade in enumerate(trades):
            cursor = index + 1
            while cursor < len(trades) and trades[cursor].entry_time - trade.entry_time <= NEAR_DUPLICATE_SECONDS:
                other = trades[cursor]
                if other.strategy_id != trade.strategy_id:
                    pair_counts[tuple(sorted((trade.strategy_id, other.strategy_id)))] += 1
                cursor += 1
    return dict(pair_counts)


def validation_row(selected: dict[str, str], trades: list[Trade]) -> dict[str, str]:
    values = [trade.r_multiple for trade in trades]
    quarters = split_values(values, 4)
    quarter_pfs = [profit_factor(quarter) for quarter in quarters]
    quarter_trades = [len(quarter) for quarter in quarters]
    odd_pf = profit_factor(values[::2])
    even_pf = profit_factor(values[1::2])

    annual: dict[int, list[float]] = defaultdict(list)
    for trade in trades:
        annual[iso_year(trade.entry_time)].append(trade.r_multiple)
    annual_windows = [(year, vals) for year, vals in sorted(annual.items()) if len(vals) >= 5]
    annual_pfs = [profit_factor(vals) for _, vals in annual_windows]
    annual_passes = sum(1 for value in annual_pfs if value > 1.0)
    annual_pass_rate = annual_passes / len(annual_pfs) if annual_pfs else 0.0
    worst_annual_pf = min(annual_pfs) if annual_pfs else 0.0

    bootstrap = bootstrap_pf_p05(values, 20260516 + len(values))
    checks = {
        "overall_pf": profit_factor(values) > 2.0,
        "trade_count": len(values) >= 20,
        "quarter_pf": min(quarter_pfs) > 1.0,
        "quarter_trades": min(quarter_trades) >= 5,
        "bootstrap_pf": bootstrap > 1.0,
        "odd_even_pf": min(odd_pf, even_pf) > 1.0,
        "annual_walk_forward": annual_pass_rate >= 0.6,
    }
    status = "pass" if all(checks.values()) else "watch"
    return {
        "strategy_id": selected["strategy_id"],
        "folder": selected["folder"],
        "market": selected.get("market", ""),
        "asset_key": selected["asset_key"],
        "overall_pf": fmt(profit_factor(values)),
        "trades": str(len(values)),
        "total_r": fmt(sum(values)),
        "max_drawdown_r": fmt(max_drawdown(values)),
        "min_quarter_pf": fmt(min(quarter_pfs)),
        "min_quarter_trades": str(min(quarter_trades)),
        "bootstrap_pf_p05": fmt(bootstrap),
        "odd_pf": fmt(odd_pf),
        "even_pf": fmt(even_pf),
        "annual_windows": str(len(annual_windows)),
        "annual_pass_rate": fmt(annual_pass_rate),
        "worst_annual_pf": fmt(worst_annual_pf),
        "status": status,
        "failed_checks": ",".join(key for key, passed in checks.items() if not passed),
    }


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    fieldnames = list(rows[0].keys()) if rows else ["strategy_id"]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    selected = read_selected_rows()
    all_trades: list[Trade] = []
    rows: list[dict[str, str]] = []
    for row in selected:
        trades = read_trades(row["folder"])
        all_trades.extend(trades)
        rows.append(validation_row(row, trades))

    duplicate_pairs = near_duplicate_pairs(all_trades)
    write_csv(REPORT_ROOT / "anti_overfit_validation.csv", rows)
    duplicate_path = REPORT_ROOT / "anti_overfit_near_duplicate_pairs.csv"
    duplicate_rows = [
        {"left_strategy_id": left, "right_strategy_id": right, "near_overlap_trades": str(count)}
        for (left, right), count in sorted(duplicate_pairs.items(), key=lambda item: item[1], reverse=True)
    ]
    write_csv(duplicate_path, duplicate_rows or [{"left_strategy_id": "", "right_strategy_id": "", "near_overlap_trades": "0"}])

    counts: dict[str, int] = defaultdict(int)
    for row in rows:
        counts[row["status"]] += 1
    summary = {
        "selectedStrategies": len(rows),
        "statusCounts": dict(counts),
        "nearDuplicatePairs": len(duplicate_pairs),
        "minOverallProfitFactor": min(float(row["overall_pf"]) for row in rows),
        "minBootstrapPfP05": min(float(row["bootstrap_pf_p05"]) for row in rows),
        "minQuarterPf": min(float(row["min_quarter_pf"]) for row in rows),
        "minTrades": min(int(row["trades"]) for row in rows),
        "methods": [
            "overall PF and trade-count gate",
            "chronological quarter split validation",
            "bootstrap resampling PF p05",
            "odd/even trade stability",
            "calendar-year walk-forward pass rate",
            "same-asset same-side near-duplicate scan",
        ],
    }
    (REPORT_ROOT / "anti_overfit_validation_summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    if duplicate_pairs:
        raise SystemExit(f"Found {len(duplicate_pairs)} near-duplicate strategy pair(s)")


if __name__ == "__main__":
    main()
