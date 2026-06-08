from __future__ import annotations

import csv
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
STRATEGY_ROOT = PROJECT_ROOT / "strategy"
LOADER_PATH = PROJECT_ROOT / "src" / "lib" / "strategy-loader.ts"
ASSET_CONFIG_PATH = PROJECT_ROOT / "config" / "assets.json"
REPORT_ROOT = PROJECT_ROOT / "Research" / "reports"
STRESS_REPORT_PATH = REPORT_ROOT / "stress_validation_catalog.csv"
SPLIT_AUDIT_PATH = REPORT_ROOT / "futures_strategy_pf_split_audit_20260607.csv"
OUTPUT_STEM = "futures_pf2_rr2_nonduplicate_selection_20260607"
MIN_PROFIT_FACTOR = 2.0
MIN_PLANNED_RR = 2.0
MIN_TRADES = 40
NEAR_OVERLAP_MINUTES = 15
DUPLICATE_CONTAINMENT_THRESHOLD = 0.80


@dataclass(frozen=True)
class Trade:
    asset_key: str
    side: str
    signal_time: datetime
    entry_time: datetime
    exit_time: datetime
    r_multiple: float


def parse_timestamp(value: str) -> datetime:
    raw = value.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    parsed = datetime.fromisoformat(raw)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def parse_float(value: str | None, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        numeric = float(value)
    except ValueError:
        return default
    return numeric


def parse_int(value: str | None, default: int = 0) -> int:
    if value is None or value == "":
        return default
    try:
        return int(float(value))
    except ValueError:
        return default


def fmt(value: float | None, decimals: int = 3) -> str:
    if value is None:
        return ""
    if math.isinf(value):
        return "Infinity"
    return f"{value:.{decimals}f}"


def read_loader_strategy_ids() -> set[str]:
    text = LOADER_PATH.read_text(encoding="utf-8")
    return set(re.findall(r'@strategy/([^/]+)/strategy', text))


def read_futures_asset_keys() -> set[str]:
    assets = json.loads(ASSET_CONFIG_PATH.read_text(encoding="utf-8"))
    return {key for key, value in assets.items() if value.get("market") == "futures"}


def read_csv_by_id(path: Path) -> dict[str, dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return {row["strategy_id"]: row for row in csv.DictReader(handle)}


def read_label(strategy_id: str) -> str:
    path = STRATEGY_ROOT / strategy_id / "machine_learning" / "selection.json"
    if not path.exists():
        return strategy_id
    metadata = json.loads(path.read_text(encoding="utf-8"))
    return str(metadata.get("label") or strategy_id)


def read_trades(strategy_id: str) -> list[Trade]:
    path = STRATEGY_ROOT / strategy_id / "backtest_trades.csv"
    trades: list[Trade] = []
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            signal_time = parse_timestamp(row.get("signal_time") or row.get("entry_time") or row["exit_time"])
            entry_time = parse_timestamp(row.get("entry_time") or row.get("signal_time") or row["exit_time"])
            exit_time = parse_timestamp(row.get("exit_time") or row.get("entry_time") or row["signal_time"])
            trades.append(
                Trade(
                    asset_key=row.get("asset_key", ""),
                    side=row.get("side", "").lower(),
                    signal_time=signal_time,
                    entry_time=entry_time,
                    exit_time=exit_time,
                    r_multiple=parse_float(row.get("r_multiple")),
                )
            )
    return sorted(trades, key=lambda trade: (trade.entry_time, trade.exit_time, trade.side))


def trade_signature(trade: Trade) -> tuple[str, str, str, str, str]:
    return (
        trade.asset_key,
        trade.side,
        trade.signal_time.isoformat(),
        trade.entry_time.isoformat(),
        trade.exit_time.isoformat(),
    )


def exact_overlap(left: list[Trade], right: list[Trade]) -> tuple[int, float, float]:
    left_set = {trade_signature(trade) for trade in left}
    right_set = {trade_signature(trade) for trade in right}
    if not left_set or not right_set:
        return 0, 0.0, 0.0
    intersection = len(left_set & right_set)
    union = len(left_set | right_set)
    containment = max(intersection / len(left_set), intersection / len(right_set))
    jaccard = intersection / union if union else 0.0
    return intersection, containment, jaccard


def near_overlap(left: list[Trade], right: list[Trade], window_minutes: int = NEAR_OVERLAP_MINUTES) -> tuple[int, float]:
    if not left or not right:
        return 0, 0.0
    remaining = list(right)
    matched = 0
    window_seconds = window_minutes * 60
    for trade in left:
        best_index: int | None = None
        best_delta: float | None = None
        for index, candidate in enumerate(remaining):
            if trade.asset_key != candidate.asset_key or trade.side != candidate.side:
                continue
            delta = abs((trade.entry_time - candidate.entry_time).total_seconds())
            if delta > window_seconds:
                continue
            if best_delta is None or delta < best_delta:
                best_delta = delta
                best_index = index
        if best_index is not None:
            matched += 1
            remaining.pop(best_index)
    containment = max(matched / len(left), matched / len(right))
    return matched, containment


def score(row: dict[str, str], split_row: dict[str, str]) -> float:
    pf = parse_float(row["overall_pf"])
    min_quarter = parse_float(row["min_quarter_pf"])
    bootstrap = parse_float(row["bootstrap_pf_p05"])
    block_bootstrap = parse_float(row["block_bootstrap_pf_p05"])
    trades = parse_int(row["trades"])
    rr = parse_float(row["min_planned_rr"])
    explicit_rr_bonus = 0.12 if "xasset_rr" in row["strategy_id"] or "true_rr" in row["strategy_id"] else 0.0
    last30 = parse_float(split_row.get("observed_last30_pf"), 1.0)
    return pf + 0.35 * min_quarter + 0.25 * bootstrap + 0.20 * block_bootstrap + 0.08 * last30 + 0.01 * min(trades, 150) + 0.04 * min(rr, 5.0) + explicit_rr_bonus


def failure_reasons(row: dict[str, str], split_row: dict[str, str], futures_keys: set[str], loader_ids: set[str]) -> list[str]:
    reasons: list[str] = []
    if row["strategy_id"] not in loader_ids:
        reasons.append("not_loaded")
    if row["asset_key"] not in futures_keys:
        reasons.append("not_futures")
    if parse_float(row["overall_pf"]) <= MIN_PROFIT_FACTOR:
        reasons.append("pf_lte_2")
    if parse_float(row["min_planned_rr"]) <= MIN_PLANNED_RR:
        reasons.append("planned_rr_lte_2")
    if parse_int(row["trades"]) < MIN_TRADES:
        reasons.append("trades_lt_40")
    if row.get("status") != "pass":
        reasons.append("stress_status_watch")
    if split_row.get("overfit_risk", "").strip().lower() != "low":
        reasons.append("overfit_risk_not_low")
    return reasons


def selected_fieldnames() -> list[str]:
    return [
        "selection_status",
        "selection_reason",
        "rank",
        "strategy_id",
        "label",
        "asset_key",
        "trades",
        "overall_pf",
        "total_r",
        "max_drawdown_r",
        "win_rate_pct",
        "min_planned_rr",
        "min_half_pf",
        "min_quarter_pf",
        "rolling20_pf_p25",
        "bootstrap_pf_p05",
        "block_bootstrap_pf_p05",
        "annual_windows",
        "annual_pass_rate",
        "worst_annual_pf",
        "split_first70_pf",
        "split_last30_pf",
        "overfit_risk",
        "duplicate_of",
        "exact_overlap",
        "exact_containment",
        "near_overlap",
        "near_containment",
        "score",
    ]


def build_output_row(
    status: str,
    reason: str,
    rank: int | None,
    row: dict[str, str],
    split_row: dict[str, str],
    duplicate_of: str = "",
    exact_overlap_count: int = 0,
    exact_containment: float = 0.0,
    near_overlap_count: int = 0,
    near_containment_value: float = 0.0,
) -> dict[str, str]:
    return {
        "selection_status": status,
        "selection_reason": reason,
        "rank": "" if rank is None else str(rank),
        "strategy_id": row["strategy_id"],
        "label": read_label(row["strategy_id"]),
        "asset_key": row["asset_key"],
        "trades": row["trades"],
        "overall_pf": fmt(parse_float(row["overall_pf"])),
        "total_r": fmt(parse_float(row["total_r"])),
        "max_drawdown_r": fmt(parse_float(row["max_drawdown_r"])),
        "win_rate_pct": split_row.get("win_rate_pct", ""),
        "min_planned_rr": fmt(parse_float(row["min_planned_rr"])),
        "min_half_pf": fmt(parse_float(row["min_half_pf"])),
        "min_quarter_pf": fmt(parse_float(row["min_quarter_pf"])),
        "rolling20_pf_p25": fmt(parse_float(row["rolling20_pf_p25"])),
        "bootstrap_pf_p05": fmt(parse_float(row["bootstrap_pf_p05"])),
        "block_bootstrap_pf_p05": fmt(parse_float(row["block_bootstrap_pf_p05"])),
        "annual_windows": row["annual_windows"],
        "annual_pass_rate": fmt(parse_float(row["annual_pass_rate"])),
        "worst_annual_pf": fmt(parse_float(row["worst_annual_pf"])),
        "split_first70_pf": split_row.get("observed_first70_pf", ""),
        "split_last30_pf": split_row.get("observed_last30_pf", ""),
        "overfit_risk": split_row.get("overfit_risk", ""),
        "duplicate_of": duplicate_of,
        "exact_overlap": str(exact_overlap_count),
        "exact_containment": fmt(exact_containment),
        "near_overlap": str(near_overlap_count),
        "near_containment": fmt(near_containment_value),
        "score": fmt(score(row, split_row)),
    }


def write_markdown(output_rows: list[dict[str, str]], summary: dict[str, object], path: Path) -> None:
    selected = [row for row in output_rows if row["selection_status"] == "selected"]
    duplicates = [row for row in output_rows if row["selection_status"] == "duplicate_rejected"]
    watch = [row for row in output_rows if row["selection_status"] == "watch_rejected"]
    lines = [
        "# Futures PF>2 / RR>2 Nonduplicate Selection - 2026-06-07",
        "",
        "This report filters the loaded strategy catalog to futures strategies only, then requires PF > 2, planned RR > 2, stress-validation pass, at least 40 trades, low split-audit overfit risk, and no same-trade duplicate overlap.",
        "",
        "## Summary",
        "",
        f"- Loaded futures stress rows: {summary['loaded_futures_rows']}",
        f"- PF/RR/stress candidates before overfit and duplicate rejection: {summary['raw_pf_rr_stress_candidates']}",
        f"- Selected strict nonduplicates: {summary['selected']}",
        f"- Exact/near duplicate rejections: {summary['duplicates']}",
        f"- Watch rejections: {summary['watch_rejections']}",
        "",
        "## Selected",
        "",
        "| Rank | Strategy | Asset | Trades | PF | Min RR | Quarter PF | Bootstrap p05 | Block p05 | Annual pass | First70 PF | Last30 PF |",
        "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in selected:
        lines.append(
            f"| {row['rank']} | `{row['strategy_id']}` | {row['asset_key']} | {row['trades']} | {row['overall_pf']} | {row['min_planned_rr']} | {row['min_quarter_pf']} | {row['bootstrap_pf_p05']} | {row['block_bootstrap_pf_p05']} | {row['annual_pass_rate']} | {row['split_first70_pf']} | {row['split_last30_pf']} |"
        )

    lines.extend(["", "## Duplicate Rejections", ""])
    if duplicates:
        lines.extend([
            "| Strategy | Duplicate Of | Exact Containment | Near Containment |",
            "| --- | --- | ---: | ---: |",
        ])
        for row in duplicates:
            lines.append(
                f"| `{row['strategy_id']}` | `{row['duplicate_of']}` | {row['exact_containment']} | {row['near_containment']} |"
            )
    else:
        lines.append("None.")

    lines.extend(["", "## Watch Rejections", ""])
    if watch:
        lines.extend([
            "| Strategy | Asset | Reason | Trades | PF | Min RR | Overfit Risk |",
            "| --- | --- | --- | ---: | ---: | ---: | --- |",
        ])
        for row in watch:
            lines.append(
                f"| `{row['strategy_id']}` | {row['asset_key']} | {row['selection_reason']} | {row['trades']} | {row['overall_pf']} | {row['min_planned_rr']} | {row['overfit_risk']} |"
            )
    else:
        lines.append("None.")

    lines.extend(["", "## Tests Used", ""])
    lines.extend(
        [
            "- Chronological half-split PF > 1.",
            "- Chronological quarter-split PF > 1.",
            "- Rolling 20-trade PF lower quartile > 1.",
            "- Ordinary bootstrap PF p05 > 1.",
            "- Five-trade block bootstrap PF p05 > 0.9.",
            "- Calendar-year walk-forward pass rate >= 60%.",
            "- Split-audit overfit risk must be Low.",
            f"- Same-trade duplicate containment must stay below {DUPLICATE_CONTAINMENT_THRESHOLD:.0%}; near duplicate window is {NEAR_OVERLAP_MINUTES} minutes.",
        ]
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    if not STRESS_REPORT_PATH.exists():
        raise FileNotFoundError(f"Missing {STRESS_REPORT_PATH}. Run scripts/stress_validate_strategy_catalog.py first.")
    if not SPLIT_AUDIT_PATH.exists():
        raise FileNotFoundError(f"Missing {SPLIT_AUDIT_PATH}. Run scripts/strategy_pf_split_report.py first.")

    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    loader_ids = read_loader_strategy_ids()
    futures_keys = read_futures_asset_keys()
    stress_rows = read_csv_by_id(STRESS_REPORT_PATH)
    split_rows = read_csv_by_id(SPLIT_AUDIT_PATH)
    loaded_futures = [
        row
        for row in stress_rows.values()
        if row["strategy_id"] in loader_ids and row["asset_key"] in futures_keys
    ]
    candidates: list[dict[str, str]] = []
    watch_rows: list[tuple[dict[str, str], list[str]]] = []
    for row in loaded_futures:
        split_row = split_rows.get(row["strategy_id"], {})
        reasons = failure_reasons(row, split_row, futures_keys, loader_ids)
        raw_pf_rr_stress = (
            parse_float(row["overall_pf"]) > MIN_PROFIT_FACTOR
            and parse_float(row["min_planned_rr"]) > MIN_PLANNED_RR
            and row.get("status") == "pass"
        )
        if not raw_pf_rr_stress:
            continue
        if reasons:
            watch_rows.append((row, reasons))
        else:
            candidates.append(row)

    trades_by_id = {row["strategy_id"]: read_trades(row["strategy_id"]) for row in candidates}
    candidates.sort(key=lambda row: score(row, split_rows.get(row["strategy_id"], {})), reverse=True)

    selected_rows: list[dict[str, str]] = []
    duplicate_rows: list[dict[str, str]] = []
    selected_ids: list[str] = []
    for row in candidates:
        strategy_id = row["strategy_id"]
        duplicate_match: tuple[str, int, float, int, float] | None = None
        for selected_id in selected_ids:
            exact_count, exact_containment_value, _ = exact_overlap(trades_by_id[strategy_id], trades_by_id[selected_id])
            near_count, near_containment_value = near_overlap(trades_by_id[strategy_id], trades_by_id[selected_id])
            if (
                exact_containment_value >= DUPLICATE_CONTAINMENT_THRESHOLD
                or near_containment_value >= DUPLICATE_CONTAINMENT_THRESHOLD
            ):
                duplicate_match = (
                    selected_id,
                    exact_count,
                    exact_containment_value,
                    near_count,
                    near_containment_value,
                )
                break
        if duplicate_match:
            duplicate_rows.append(
                build_output_row(
                    "duplicate_rejected",
                    "same_trade_overlap",
                    None,
                    row,
                    split_rows.get(strategy_id, {}),
                    duplicate_of=duplicate_match[0],
                    exact_overlap_count=duplicate_match[1],
                    exact_containment=duplicate_match[2],
                    near_overlap_count=duplicate_match[3],
                    near_containment_value=duplicate_match[4],
                )
            )
            continue
        selected_ids.append(strategy_id)
        selected_rows.append(
            build_output_row(
                "selected",
                "pf_rr_stress_low_overfit_nonduplicate",
                len(selected_rows) + 1,
                row,
                split_rows.get(strategy_id, {}),
            )
        )

    watch_output_rows = [
        build_output_row("watch_rejected", ",".join(reasons), None, row, split_rows.get(row["strategy_id"], {}))
        for row, reasons in sorted(watch_rows, key=lambda item: score(item[0], split_rows.get(item[0]["strategy_id"], {})), reverse=True)
    ]
    output_rows = selected_rows + duplicate_rows + watch_output_rows

    csv_path = REPORT_ROOT / f"{OUTPUT_STEM}.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=selected_fieldnames())
        writer.writeheader()
        writer.writerows(output_rows)

    summary = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "loaded_futures_rows": len(loaded_futures),
        "raw_pf_rr_stress_candidates": len(candidates) + len(watch_rows),
        "selected": len(selected_rows),
        "duplicates": len(duplicate_rows),
        "watch_rejections": len(watch_output_rows),
        "selectedStrategyIds": selected_ids,
        "thresholds": {
            "minProfitFactor": MIN_PROFIT_FACTOR,
            "minPlannedRiskReward": MIN_PLANNED_RR,
            "minTrades": MIN_TRADES,
            "duplicateContainment": DUPLICATE_CONTAINMENT_THRESHOLD,
            "nearOverlapMinutes": NEAR_OVERLAP_MINUTES,
        },
    }
    summary_path = REPORT_ROOT / f"{OUTPUT_STEM}.json"
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    write_markdown(output_rows, summary, REPORT_ROOT / f"{OUTPUT_STEM}.md")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
