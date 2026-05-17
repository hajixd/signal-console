from __future__ import annotations

import csv
import json
import math
import random
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from itertools import groupby
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
STRATEGY_ROOT = PROJECT_ROOT / "strategy"
ASSETS_PATH = PROJECT_ROOT / "config" / "assets.json"
LOADER_PATH = PROJECT_ROOT / "src" / "lib" / "strategy-loader.ts"
REPORT_ROOT = PROJECT_ROOT / "Research" / "reports"

TARGET_PER_MARKET = 50
MIN_OVERALL_PROFIT_FACTOR = 2.0
MIN_TOTAL_TRADES = 20
SPLIT_COUNT = 4
MIN_SPLIT_TRADES = 5
MIN_SPLIT_PROFIT_FACTOR = 1.0
BOOTSTRAP_SAMPLES = 400
NEAR_DUPLICATE_SECONDS = 15 * 60
MIN_BOOTSTRAP_P05 = 1.0
MIN_ODD_EVEN_PROFIT_FACTOR = 1.0
MIN_ANNUAL_PASS_RATE = 0.6


@dataclass(frozen=True)
class SplitMetrics:
    trades: int
    profit_factor: float
    total_r: float


@dataclass
class Candidate:
    strategy_id: str
    folder: str
    label: str
    asset_key: str
    symbol: str
    market: str
    phase: str
    variant_id: str
    source: str
    profit_factor: float
    trades: int
    total_r: float
    win_rate_pct: float
    max_drawdown_r: float
    pf_bootstrap_p05: float
    odd_even_min_profit_factor: float
    annual_pass_rate: float
    worst_annual_profit_factor: float
    split_metrics: list[SplitMetrics]
    trade_signature: set[tuple[str, str, str]]
    trade_signature_times: list[tuple[str, str, int]]
    strategy_dir: Path
    rejection_reason: str | None = None
    duplicate_of: str | None = None
    duplicate_overlap_trades: int = 0

    @property
    def min_split_profit_factor(self) -> float:
        return min(split.profit_factor for split in self.split_metrics)

    @property
    def min_split_trades(self) -> int:
        return min(split.trades for split in self.split_metrics)

    @property
    def selection_score(self) -> float:
        bounded_pf = min(self.profit_factor, 6.0)
        bounded_split = min(self.min_split_profit_factor, 4.0)
        bounded_bootstrap = min(self.pf_bootstrap_p05, 4.0)
        return math.log1p(self.trades) * (bounded_pf + bounded_split + bounded_bootstrap)


def load_assets() -> dict[str, dict[str, Any]]:
    return json.loads(ASSETS_PATH.read_text(encoding="utf-8"))


def metadata_path(strategy_dir: Path) -> Path | None:
    for relative in (
        Path("machine_learning") / "selection.json",
        Path("bayes") / "selection.json",
        Path("parameters") / "backtest.json",
    ):
        path = strategy_dir / relative
        if path.exists():
            return path
    return None


def load_metadata(strategy_dir: Path) -> dict[str, Any]:
    path = metadata_path(strategy_dir)
    if path is None:
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def parse_float(value: object) -> float | None:
    try:
        parsed = float(str(value))
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


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
    cuts = [math.ceil(len(values) * index / SPLIT_COUNT) for index in range(1, SPLIT_COUNT)]
    return [
        values[: cuts[0]],
        values[cuts[0] : cuts[1]],
        values[cuts[1] : cuts[2]],
        values[cuts[2] :],
    ]


def split_metric(values: list[float]) -> SplitMetrics:
    return SplitMetrics(trades=len(values), profit_factor=profit_factor(values), total_r=sum(values))


def bootstrap_pf_p05(values: list[float]) -> float:
    if not values:
        return 0.0
    rng = random.Random(20260516 + len(values))
    sampled: list[float] = []
    for _ in range(BOOTSTRAP_SAMPLES):
        draw = [values[rng.randrange(len(values))] for _ in range(len(values))]
        sampled.append(profit_factor(draw))
    sampled.sort()
    value = sampled[max(0, int(len(sampled) * 0.05) - 1)]
    return 999.0 if math.isinf(value) else value


def annual_walk_forward_metrics(rows: list[tuple[str, int, dict[str, str], float]]) -> tuple[float, float]:
    annual: dict[int, list[float]] = {}
    for timestamp, _index, row, r_multiple in rows:
        parsed = parse_timestamp(row.get("entry_time") or row.get("signal_time") or timestamp)
        if parsed < 0:
            continue
        year = datetime.fromtimestamp(parsed, tz=timezone.utc).year
        annual.setdefault(year, []).append(r_multiple)
    windows = [values for _year, values in sorted(annual.items()) if len(values) >= MIN_SPLIT_TRADES]
    if not windows:
        return 0.0, 0.0
    pfs = [profit_factor(values) for values in windows]
    return sum(1 for value in pfs if value > 1.0) / len(pfs), min(pfs)


def fallback_label(strategy_id: str, symbol: str, phase: str) -> str:
    readable_phase = phase.replace("_", " ").title()
    return f"{symbol} {readable_phase}" if symbol else strategy_id.replace("_", " ").title()


def read_candidate(strategy_dir: Path, assets: dict[str, dict[str, Any]]) -> Candidate | None:
    csv_path = strategy_dir / "backtest_trades.csv"
    if not csv_path.exists():
        return None

    rows: list[tuple[str, int, dict[str, str], float]] = []
    with csv_path.open(newline="", encoding="utf-8") as handle:
        for index, row in enumerate(csv.DictReader(handle)):
            r_multiple = parse_float(row.get("r_multiple"))
            if r_multiple is None:
                continue
            timestamp = row.get("entry_time") or row.get("signal_time") or f"{index:08d}"
            rows.append((timestamp, index, row, r_multiple))

    if not rows:
        return None

    rows.sort(key=lambda item: (item[0], item[1]))
    first = rows[0][2]
    values = [item[3] for item in rows]
    asset_key = first.get("asset_key", "")
    asset = assets.get(asset_key, {})
    market = first.get("market") or str(asset.get("market", ""))
    symbol = (first.get("symbol") or str(asset.get("symbol", ""))).upper()
    phase = first.get("phase", "")
    strategy_id = first.get("strategy_id") or strategy_dir.name
    metadata = load_metadata(strategy_dir)
    label = str(metadata.get("label") or fallback_label(strategy_id, symbol, phase))
    variant_id = str(first.get("variant_id") or metadata.get("variantId") or strategy_id)
    source = str(first.get("source") or metadata.get("source") or "backtest_trades")
    wins = sum(1 for value in values if value > 0)
    splits = [split_metric(split) for split in split_values(values)]
    annual_pass_rate, worst_annual_pf = annual_walk_forward_metrics(rows)
    signature = {
        (row.get("asset_key", ""), row.get("side", ""), row.get("entry_time") or row.get("signal_time") or "")
        for _, _, row, _ in rows
    }
    signature_times = [
        (
            row.get("asset_key", ""),
            row.get("side", ""),
            parse_timestamp(row.get("entry_time") or row.get("signal_time") or ""),
        )
        for _, _, row, _ in rows
    ]

    return Candidate(
        strategy_id=strategy_id,
        folder=strategy_dir.name,
        label=label,
        asset_key=asset_key,
        symbol=symbol,
        market=market,
        phase=phase,
        variant_id=variant_id,
        source=source,
        profit_factor=profit_factor(values),
        trades=len(values),
        total_r=sum(values),
        win_rate_pct=(wins / len(values) * 100) if values else 0.0,
        max_drawdown_r=max_drawdown(values),
        pf_bootstrap_p05=bootstrap_pf_p05(values),
        odd_even_min_profit_factor=min(profit_factor(values[::2]), profit_factor(values[1::2])),
        annual_pass_rate=annual_pass_rate,
        worst_annual_profit_factor=worst_annual_pf,
        split_metrics=splits,
        trade_signature=signature,
        trade_signature_times=signature_times,
        strategy_dir=strategy_dir,
    )


def parse_timestamp(value: str) -> int:
    if not value:
        return -1
    try:
        return int(float(value))
    except ValueError:
        pass
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return -1
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


def qualification_reason(candidate: Candidate) -> str | None:
    if candidate.market not in {"forex", "futures"}:
        return f"market {candidate.market or 'unknown'} is outside forex/futures"
    if not candidate.profit_factor > MIN_OVERALL_PROFIT_FACTOR:
        return f"profit factor {candidate.profit_factor:.6f} is not above {MIN_OVERALL_PROFIT_FACTOR:.1f}"
    if candidate.trades < MIN_TOTAL_TRADES:
        return f"{candidate.trades} trades is below {MIN_TOTAL_TRADES}"
    if candidate.min_split_trades < MIN_SPLIT_TRADES:
        return f"thin chronological quarter: {candidate.min_split_trades} trades"
    if not candidate.min_split_profit_factor > MIN_SPLIT_PROFIT_FACTOR:
        return f"quarter PF {candidate.min_split_profit_factor:.6f} is not above {MIN_SPLIT_PROFIT_FACTOR:.1f}"
    if not candidate.pf_bootstrap_p05 > MIN_BOOTSTRAP_P05:
        return f"bootstrap PF p05 {candidate.pf_bootstrap_p05:.6f} is not above {MIN_BOOTSTRAP_P05:.1f}"
    if not candidate.odd_even_min_profit_factor > MIN_ODD_EVEN_PROFIT_FACTOR:
        return f"odd/even PF {candidate.odd_even_min_profit_factor:.6f} is not above {MIN_ODD_EVEN_PROFIT_FACTOR:.1f}"
    if not candidate.annual_pass_rate >= MIN_ANNUAL_PASS_RATE:
        return f"annual walk-forward pass rate {candidate.annual_pass_rate:.6f} is below {MIN_ANNUAL_PASS_RATE:.1f}"
    return None


def exact_overlap(left: Candidate, right: Candidate) -> int:
    if left.asset_key != right.asset_key:
        return 0
    exact = len(left.trade_signature & right.trade_signature)
    near = 0
    right_by_side: dict[str, list[int]] = {}
    for _, side, timestamp in right.trade_signature_times:
        if timestamp >= 0:
            right_by_side.setdefault(side, []).append(timestamp)
    for timestamps in right_by_side.values():
        timestamps.sort()
    for _, side, timestamp in left.trade_signature_times:
        if timestamp < 0:
            continue
        for other in right_by_side.get(side, []):
            delta = other - timestamp
            if delta < -NEAR_DUPLICATE_SECONDS:
                continue
            if delta > NEAR_DUPLICATE_SECONDS:
                break
            near += 1
            break
    return max(exact, near)


def independent_set_for_asset(candidates: list[Candidate]) -> list[Candidate]:
    if not candidates:
        return []

    ordered = sorted(candidates, key=lambda item: item.selection_score, reverse=True)
    count = len(ordered)
    adjacency = [0] * count
    for left_index, left in enumerate(ordered):
        for right_index in range(left_index + 1, count):
            if exact_overlap(left, ordered[right_index]):
                adjacency[left_index] |= 1 << right_index
                adjacency[right_index] |= 1 << left_index

    @lru_cache(maxsize=None)
    def solve(mask: int) -> tuple[int, float, tuple[int, ...]]:
        if mask == 0:
            return 0, 0.0, ()
        bit = mask & -mask
        index = bit.bit_length() - 1

        without_count, without_score, without_items = solve(mask & ~bit)
        with_count, with_score, with_items = solve(mask & ~bit & ~adjacency[index])
        with_count += 1
        with_score += ordered[index].selection_score
        with_items = (index,) + with_items

        if (with_count, with_score) > (without_count, without_score):
            return with_count, with_score, with_items
        return without_count, without_score, without_items

    _, _, selected_indexes = solve((1 << count) - 1)
    return [ordered[index] for index in selected_indexes]


def select_exact_non_overlapping(candidates: list[Candidate]) -> tuple[list[Candidate], list[Candidate]]:
    selected: list[Candidate] = []
    duplicate_rejections: list[Candidate] = []

    sorted_candidates = sorted(candidates, key=lambda item: (item.asset_key, item.selection_score), reverse=True)
    for _, group_iter in groupby(sorted_candidates, key=lambda item: item.asset_key):
        group = list(group_iter)
        asset_selected = independent_set_for_asset(group)
        selected.extend(asset_selected)
        selected_ids = {item.strategy_id for item in asset_selected}
        for candidate in group:
            if candidate.strategy_id in selected_ids:
                continue
            overlaps = [
                (exact_overlap(candidate, existing), existing.strategy_id)
                for existing in asset_selected
                if exact_overlap(candidate, existing)
            ]
            if overlaps:
                overlap_count, duplicate_of = max(overlaps)
                candidate.duplicate_of = duplicate_of
                candidate.duplicate_overlap_trades = overlap_count
                candidate.rejection_reason = "exact overlapping trade signature"
                duplicate_rejections.append(candidate)

    selected.sort(key=lambda item: (item.market, -item.selection_score, item.strategy_id))
    duplicate_rejections.sort(key=lambda item: (item.market, item.asset_key, item.strategy_id))
    return selected, duplicate_rejections


def market_counts(candidates: list[Candidate]) -> dict[str, int]:
    return {
        "forex": sum(1 for candidate in candidates if candidate.market == "forex"),
        "futures": sum(1 for candidate in candidates if candidate.market == "futures"),
    }


def fmt(value: float) -> str:
    if math.isinf(value):
        return "Infinity"
    return f"{value:.6f}"


def report_row(candidate: Candidate, rank: int | str = "") -> dict[str, str]:
    split_pfs = [split.profit_factor for split in candidate.split_metrics]
    split_trades = [split.trades for split in candidate.split_metrics]
    return {
        "rank": str(rank),
        "strategy_id": candidate.strategy_id,
        "label": candidate.label,
        "folder": candidate.folder,
        "asset_key": candidate.asset_key,
        "symbol": candidate.symbol,
        "market": candidate.market,
        "phase": candidate.phase,
        "source": candidate.source,
        "overall_pf": fmt(candidate.profit_factor),
        "overall_trades": str(candidate.trades),
        "total_r": fmt(candidate.total_r),
        "win_rate_pct": fmt(candidate.win_rate_pct),
        "max_drawdown_r": fmt(candidate.max_drawdown_r),
        "pf_bootstrap_p05": fmt(candidate.pf_bootstrap_p05),
        "odd_even_min_pf": fmt(candidate.odd_even_min_profit_factor),
        "annual_pass_rate": fmt(candidate.annual_pass_rate),
        "worst_annual_pf": fmt(candidate.worst_annual_profit_factor),
        "split1_pf": fmt(split_pfs[0]),
        "split1_trades": str(split_trades[0]),
        "split2_pf": fmt(split_pfs[1]),
        "split2_trades": str(split_trades[1]),
        "split3_pf": fmt(split_pfs[2]),
        "split3_trades": str(split_trades[2]),
        "split4_pf": fmt(split_pfs[3]),
        "split4_trades": str(split_trades[3]),
        "min_split_pf": fmt(candidate.min_split_profit_factor),
        "min_split_trades": str(candidate.min_split_trades),
        "duplicate_of": candidate.duplicate_of or "",
        "duplicate_overlap_trades": str(candidate.duplicate_overlap_trades or ""),
        "rejection_reason": candidate.rejection_reason or "",
        "variant_id": candidate.variant_id,
    }


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "rank",
        "strategy_id",
        "label",
        "folder",
        "asset_key",
        "symbol",
        "market",
        "phase",
        "source",
        "overall_pf",
        "overall_trades",
        "total_r",
        "win_rate_pct",
        "max_drawdown_r",
        "pf_bootstrap_p05",
        "odd_even_min_pf",
        "annual_pass_rate",
        "worst_annual_pf",
        "split1_pf",
        "split1_trades",
        "split2_pf",
        "split2_trades",
        "split3_pf",
        "split3_trades",
        "split4_pf",
        "split4_trades",
        "min_split_pf",
        "min_split_trades",
        "duplicate_of",
        "duplicate_overlap_trades",
        "rejection_reason",
        "variant_id",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_missing_csv(path: Path, rows: list[dict[str, str]]) -> None:
    fieldnames = ["strategy_id", "folder", "asset_key", "market", "phase", "rejection_reason"]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_markdown(path: Path, selected: list[Candidate], rejected: list[Candidate], duplicates: list[Candidate], missing: list[dict[str, str]]) -> None:
    counts = market_counts(selected)
    raw_counts = market_counts(selected + duplicates)
    shortfalls = {
        market: max(0, TARGET_PER_MARKET - counts.get(market, 0))
        for market in ("forex", "futures")
    }
    lines = [
        "# High-Confidence Strategy Selection",
        "",
        f"Generated from completed strict backtest CSVs at the restored `publish-main`/`main` branch state.",
        "",
        "## Result",
        "",
        f"- Selected: {len(selected)} strategies ({counts['forex']} forex, {counts['futures']} futures).",
        f"- Target: {TARGET_PER_MARKET} forex and {TARGET_PER_MARKET} futures.",
        f"- Shortfall: {shortfalls['forex']} forex and {shortfalls['futures']} futures.",
        f"- Qualified before exact-trade de-duplication: {len(selected) + len(duplicates)} ({raw_counts['forex']} forex, {raw_counts['futures']} futures).",
        f"- Rule rejections: {len(rejected)}.",
        f"- Missing/unfinished trade CSVs: {len(missing)}.",
        f"- Exact-overlap duplicate rejections: {len(duplicates)}.",
        "",
        "## Gates",
        "",
        f"- Overall profit factor > {MIN_OVERALL_PROFIT_FACTOR:.1f}.",
        f"- At least {MIN_TOTAL_TRADES} trades.",
        f"- {SPLIT_COUNT} chronological quarters, each with at least {MIN_SPLIT_TRADES} trades.",
        f"- Every chronological quarter must have PF > {MIN_SPLIT_PROFIT_FACTOR:.1f}.",
        f"- Bootstrap resampling 5th percentile PF must be > {MIN_BOOTSTRAP_P05:.1f}.",
        f"- Odd/even trade-order PF must both be > {MIN_ODD_EVEN_PROFIT_FACTOR:.1f}.",
        f"- At least {MIN_ANNUAL_PASS_RATE:.0%} of calendar-year walk-forward windows with enough trades must have PF > 1.0.",
        f"- Strategies on the same asset may not share exact entries or same-side entries within {NEAR_DUPLICATE_SECONDS // 60} minutes.",
        "- Per-asset selection maximizes count first, then robustness score.",
        "",
        "## Selected",
        "",
        "| Rank | Market | Symbol | Strategy | PF | Trades | Min Quarter PF | Bootstrap PF p05 |",
        "| ---: | --- | --- | --- | ---: | ---: | ---: | ---: |",
    ]
    for rank, candidate in enumerate(selected, start=1):
        lines.append(
            f"| {rank} | {candidate.market} | {candidate.symbol} | {candidate.label} | "
            f"{fmt(candidate.profit_factor)} | {candidate.trades} | {fmt(candidate.min_split_profit_factor)} | {fmt(candidate.pf_bootstrap_p05)} |"
        )
    lines.append("")
    lines.append("The 100-strategy target is not reachable from the completed non-cheating backtests under these gates.")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_loader(selected: list[Candidate]) -> None:
    imports: list[str] = []
    names: list[str] = []
    for index, candidate in enumerate(selected):
        name = f"strategy{index:03d}"
        imports.append(f'import {name} from "@strategy/{candidate.folder}/strategy";')
        names.append(name)
    body = "\n".join(imports)
    definitions = ",\n  ".join(names)
    LOADER_PATH.write_text(
        f"""{body}

import type {{ StrategyDefinition }} from "@/lib/strategy-definition";

export type {{ StrategyDefinition, StrategySignal }} from "@/lib/strategy-definition";

export const STRATEGY_DEFINITIONS: StrategyDefinition[] = [
  {definitions}
];
""",
        encoding="utf-8",
    )


def prune_strategy_dirs(selected: list[Candidate]) -> None:
    keep = {candidate.folder for candidate in selected}
    for strategy_dir in STRATEGY_ROOT.iterdir():
        if strategy_dir.is_dir() and strategy_dir.name not in keep:
            shutil.rmtree(strategy_dir)


def main() -> None:
    assets = load_assets()
    candidates: list[Candidate] = []
    rejected: list[Candidate] = []
    missing: list[dict[str, str]] = []

    for strategy_dir in sorted(path for path in STRATEGY_ROOT.iterdir() if path.is_dir()):
        candidate = read_candidate(strategy_dir, assets)
        if candidate is None:
            metadata = load_metadata(strategy_dir)
            asset_key = str(metadata.get("assetKey") or "")
            asset = assets.get(asset_key, {})
            missing.append(
                {
                    "strategy_id": str(metadata.get("strategyId") or strategy_dir.name),
                    "folder": strategy_dir.name,
                    "asset_key": asset_key,
                    "market": str(asset.get("market", "")),
                    "phase": str(metadata.get("phase") or ""),
                    "rejection_reason": "missing or unfinished backtest_trades.csv",
                }
            )
            continue

        reason = qualification_reason(candidate)
        if reason:
            candidate.rejection_reason = reason
            rejected.append(candidate)
            continue
        candidates.append(candidate)

    selected, duplicates = select_exact_non_overlapping(candidates)

    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    write_csv(REPORT_ROOT / "top_strategy_pf_split_report.csv", [report_row(item, index) for index, item in enumerate(selected, start=1)])
    write_csv(REPORT_ROOT / "robust_strategy_rule_rejections.csv", [report_row(item) for item in rejected])
    write_csv(REPORT_ROOT / "robust_strategy_duplicate_rejections.csv", [report_row(item) for item in duplicates])
    write_missing_csv(REPORT_ROOT / "robust_strategy_missing_backtests.csv", missing)
    write_markdown(REPORT_ROOT / "top_strategy_pf_split_report.md", selected, rejected, duplicates, missing)
    write_loader(selected)
    prune_strategy_dirs(selected)

    counts = market_counts(selected)
    print(f"Selected {len(selected)} strategies: {counts['forex']} forex, {counts['futures']} futures")
    print(f"Target shortfall: {max(0, TARGET_PER_MARKET - counts['forex'])} forex, {max(0, TARGET_PER_MARKET - counts['futures'])} futures")
    print(f"Rejected {len(duplicates)} exact-overlap duplicates, {len(rejected)} rule failures, {len(missing)} missing backtests")


if __name__ == "__main__":
    main()
