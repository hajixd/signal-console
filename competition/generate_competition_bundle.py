from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import math
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
POTENTIAL_BACKTESTER = PROJECT_ROOT / "Potential Strategies" / "research_backtester.py"
OUTPUT_ROOT = PROJECT_ROOT / "competition" / "strategies"
TRAIN_END_TS = int(datetime(2022, 1, 1, tzinfo=timezone.utc).timestamp())

DEFAULT_ASSETS = (
    "crude_oil_futures",
    "dow_jones_futures",
    "us_treasury_10y_note_futures",
    "micro_bitcoin_futures",
    "micro_ether_futures",
    "us_treasury_2y_note_futures",
    "eur_chf",
    "eur_jpy",
    "gbp_jpy",
    "nzd_usd",
    "usd_jpy",
)


@dataclass(frozen=True)
class SplitMetrics:
    profit_factor: float
    trades: int
    wins: int
    losses: int
    total_r: float
    win_rate_pct: float
    max_drawdown_r: float


@dataclass(frozen=True)
class SelectedCandidate:
    candidate: Any
    train_trades: list[Any]
    forward_trades: list[Any]
    train_metrics: SplitMetrics
    forward_metrics: SplitMetrics
    train_score: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build an isolated competition strategy bundle.")
    parser.add_argument("--min-forward-pf", type=float, default=2.0)
    parser.add_argument("--min-forward-trades", type=int, default=21)
    parser.add_argument("--min-train-pf", type=float, default=1.1)
    parser.add_argument("--min-train-trades", type=int, default=20)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--asset", action="append", help="Asset key/symbol filter. Repeat or comma-separate.")
    parser.add_argument("--family-cap", type=int, default=5)
    parser.add_argument("--asset-cap", type=int, default=4)
    parser.add_argument("--output-dir", default=str(OUTPUT_ROOT))
    parser.add_argument("--no-write", action="store_true", help="Print results without writing the bundle.")
    return parser.parse_args()


def load_potential_backtester():
    spec = importlib.util.spec_from_file_location("competition_potential_research_backtester", POTENTIAL_BACKTESTER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {POTENTIAL_BACKTESTER}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    previous_bytecode_setting = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous_bytecode_setting
    # Force the scanner to return the complete history; this script owns the split.
    module.BACKTEST_START_TS = 0
    return module


def split_csv_args(values: Iterable[str] | None) -> list[str]:
    return [
        item.strip()
        for raw in (values or [])
        for item in raw.split(",")
        if item.strip()
    ]


def finite_number(value: float) -> float | str:
    if math.isinf(value):
        return "inf"
    rounded = round(float(value), 6)
    return int(rounded) if math.isclose(rounded, round(rounded)) else rounded


def metric_from_trades(module: Any, trades: list[Any]) -> SplitMetrics:
    profit_factor, total_r, win_rate, max_drawdown = module.trade_metrics(trades)
    wins = sum(1 for trade in trades if float(trade.r_multiple) > 0)
    losses = sum(1 for trade in trades if float(trade.r_multiple) < 0)
    return SplitMetrics(
        profit_factor=float(profit_factor),
        trades=len(trades),
        wins=wins,
        losses=losses,
        total_r=float(total_r),
        win_rate_pct=float(win_rate) * 100.0,
        max_drawdown_r=float(max_drawdown),
    )


def train_score(metrics: SplitMetrics) -> float:
    capped_pf = min(metrics.profit_factor if math.isfinite(metrics.profit_factor) else 5.0, 5.0)
    return (
        capped_pf * math.log1p(metrics.trades)
        + metrics.total_r * 0.03
        - metrics.max_drawdown_r * 0.05
    )


def trade_row(trade: Any) -> dict[str, Any]:
    return {
        "strategy_id": trade.strategy_id,
        "asset_key": trade.asset_key,
        "market": trade.market,
        "family": trade.family,
        "signal_time": int(trade.signal_time),
        "entry_time": int(trade.entry_time),
        "exit_time": int(trade.exit_time),
        "side": int(trade.side),
        "entry_price": float(trade.entry_price),
        "exit_price": float(trade.exit_price),
        "r_multiple": float(trade.r_multiple),
        "exit_reason": trade.exit_reason,
    }


def metric_payload(metrics: SplitMetrics) -> dict[str, Any]:
    return {
        "profitFactor": finite_number(metrics.profit_factor),
        "trades": metrics.trades,
        "wins": metrics.wins,
        "losses": metrics.losses,
        "totalR": finite_number(metrics.total_r),
        "winRatePct": finite_number(metrics.win_rate_pct),
        "maxDrawdownR": finite_number(metrics.max_drawdown_r),
    }


def scan_candidates(module: Any, assets: list[Any]) -> list[Any]:
    scanners = [
        module.scan_intraday_momentum,
        module.scan_overnight_and_gap,
        module.scan_range_breakouts,
        module.scan_daily_time_series_momentum,
    ]
    candidates: list[Any] = []
    for asset in assets:
        print(f"Loading {asset.key} ({asset.market})", flush=True)
        data = module.load_asset_data(asset)
        before = len(candidates)
        for scanner in scanners:
            produced = scanner(data)
            candidates.extend(produced)
            print(f"  {scanner.__name__}: {len(produced)}", flush=True)
        print(f"  asset candidates: {len(candidates) - before}", flush=True)

    refined = module.refine_session_filters(candidates)
    if refined:
        print(f"Added {len(refined)} train/test filter candidates", flush=True)
        candidates.extend(refined)
    return candidates


def qualify_candidates(module: Any, candidates: list[Any], args: argparse.Namespace) -> list[SelectedCandidate]:
    qualified: list[SelectedCandidate] = []
    for candidate in candidates:
        train_trades = [
            trade
            for trade in candidate.trades
            if int(trade.entry_time) < TRAIN_END_TS and int(trade.exit_time) < TRAIN_END_TS
        ]
        forward_trades = [
            trade
            for trade in candidate.trades
            if int(trade.entry_time) >= TRAIN_END_TS
        ]
        train_metrics = metric_from_trades(module, train_trades)
        forward_metrics = metric_from_trades(module, forward_trades)
        if train_metrics.trades < args.min_train_trades:
            continue
        if train_metrics.total_r <= 0 or train_metrics.profit_factor < args.min_train_pf:
            continue
        if forward_metrics.trades < args.min_forward_trades:
            continue
        if forward_metrics.total_r <= 0 or forward_metrics.profit_factor <= args.min_forward_pf:
            continue
        qualified.append(
            SelectedCandidate(
                candidate=candidate,
                train_trades=train_trades,
                forward_trades=forward_trades,
                train_metrics=train_metrics,
                forward_metrics=forward_metrics,
                train_score=train_score(train_metrics),
            )
        )
    qualified.sort(key=lambda item: item.train_score, reverse=True)
    return qualified


def select_with_diversity(
    qualified: list[SelectedCandidate],
    limit: int,
    family_cap: int,
    asset_cap: int,
) -> list[SelectedCandidate]:
    selected: list[SelectedCandidate] = []
    seen: set[str] = set()
    family_counts: dict[str, int] = {}
    asset_counts: dict[str, int] = {}

    def add(item: SelectedCandidate, relaxed: bool = False) -> None:
        strategy_id = str(item.candidate.strategy_id)
        if strategy_id in seen or len(selected) >= limit:
            return
        if not relaxed:
            if family_counts.get(item.candidate.family, 0) >= family_cap:
                return
            if asset_counts.get(item.candidate.asset.key, 0) >= asset_cap:
                return
        selected.append(item)
        seen.add(strategy_id)
        family_counts[item.candidate.family] = family_counts.get(item.candidate.family, 0) + 1
        asset_counts[item.candidate.asset.key] = asset_counts.get(item.candidate.asset.key, 0) + 1

    for item in qualified:
        add(item)
    for item in qualified:
        add(item, relaxed=True)
    return selected


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def write_trade_csv(path: Path, trades: list[Any]) -> None:
    rows = [trade_row(trade) for trade in trades]
    columns = [
        "strategy_id",
        "asset_key",
        "market",
        "family",
        "signal_time",
        "entry_time",
        "exit_time",
        "side",
        "entry_price",
        "exit_price",
        "r_multiple",
        "exit_reason",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def summary_row(rank: int, item: SelectedCandidate) -> dict[str, Any]:
    candidate = item.candidate
    return {
        "rank": rank,
        "strategy_id": candidate.strategy_id,
        "label": candidate.label,
        "asset_key": candidate.asset.key,
        "symbol": candidate.asset.symbol,
        "market": candidate.asset.market,
        "family": candidate.family,
        "provenance": candidate.provenance,
        "train_score": finite_number(item.train_score),
        "train_pf": finite_number(item.train_metrics.profit_factor),
        "train_trades": item.train_metrics.trades,
        "train_total_r": finite_number(item.train_metrics.total_r),
        "forward_pf": finite_number(item.forward_metrics.profit_factor),
        "forward_trades": item.forward_metrics.trades,
        "forward_total_r": finite_number(item.forward_metrics.total_r),
        "forward_win_rate_pct": finite_number(item.forward_metrics.win_rate_pct),
        "forward_max_drawdown_r": finite_number(item.forward_metrics.max_drawdown_r),
        "params": json.dumps(candidate.params, sort_keys=True),
    }


def write_candidate(output_dir: Path, rank: int, item: SelectedCandidate) -> dict[str, Any]:
    candidate = item.candidate
    folder = output_dir / candidate.strategy_id
    folder.mkdir(parents=True, exist_ok=True)
    metadata = {
        "namespace": "isolated_competition_2026",
        "rank": rank,
        "strategyId": candidate.strategy_id,
        "label": candidate.label,
        "assetKey": candidate.asset.key,
        "symbol": candidate.asset.symbol,
        "market": candidate.asset.market,
        "family": candidate.family,
        "provenance": candidate.provenance,
        "status": "competition_isolated_not_live",
        "hypothesis": candidate.hypothesis,
        "sourceUrls": candidate.source_urls,
        "params": candidate.params,
        "trainingWindow": {"start": "asset_start", "end": "2021-12-31"},
        "forwardWindow": {"start": "2022-01-01", "end": "asset_latest"},
        "selectionMethod": (
            "Candidate parameters are ranked by pre-2022 training score only. "
            "Post-2022 forward results are used only for competition qualification "
            "against the requested PF/trade thresholds."
        ),
        "trainScore": finite_number(item.train_score),
        "trainMetrics": metric_payload(item.train_metrics),
        "forwardMetrics": metric_payload(item.forward_metrics),
        "isolationNote": (
            "Stored under competition/strategies only. Not imported into src/lib/strategy-loader.ts "
            "and not part of the live strategy catalog."
        ),
        "files": {
            "metadata": f"competition/strategies/{candidate.strategy_id}/strategy.json",
            "forwardTrades": f"competition/strategies/{candidate.strategy_id}/backtest_trades.csv",
            "trainingTrades": f"competition/strategies/{candidate.strategy_id}/train_trades.csv",
            "research": f"competition/strategies/{candidate.strategy_id}/research.md",
        },
    }
    (folder / "strategy.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    write_trade_csv(folder / "backtest_trades.csv", item.forward_trades)
    write_trade_csv(folder / "train_trades.csv", item.train_trades)

    research_lines = [
        f"# {candidate.label}",
        "",
        "- Status: isolated competition candidate, not live.",
        f"- Asset: {candidate.asset.name} ({candidate.asset.symbol}).",
        f"- Family: {candidate.family}.",
        f"- Forward profit factor: {item.forward_metrics.profit_factor:.2f}.",
        f"- Forward trades: {item.forward_metrics.trades}.",
        f"- Forward total R: {item.forward_metrics.total_r:.2f}.",
        f"- Training profit factor: {item.train_metrics.profit_factor:.2f}.",
        f"- Training trades: {item.train_metrics.trades}.",
        "",
        "## Hypothesis",
        "",
        candidate.hypothesis,
        "",
        "## Split Protocol",
        "",
        "- Parameter ranking uses trades completed before 2022-01-01.",
        "- Qualification metrics use trades entered on or after 2022-01-01.",
        "- This folder is not imported by the live strategy catalog.",
        "",
        "## Sources",
        "",
    ]
    research_lines.extend(f"- {url}" for url in candidate.source_urls)
    (folder / "research.md").write_text("\n".join(research_lines) + "\n", encoding="utf-8")
    return metadata


def write_bundle(output_dir: Path, selected: list[SelectedCandidate], args: argparse.Namespace) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for child in output_dir.iterdir():
        if child.is_dir():
            shutil.rmtree(child)
        elif child.name in {"summary.csv", "manifest.json", "firebase_payload.json", "README.md"}:
            child.unlink()

    generated_at = datetime.now(timezone.utc).isoformat()
    strategy_payloads = [
        write_candidate(output_dir, rank, item)
        for rank, item in enumerate(selected, start=1)
    ]
    summary_rows = [summary_row(rank, item) for rank, item in enumerate(selected, start=1)]
    write_csv(output_dir / "summary.csv", summary_rows)
    manifest = {
        "namespace": "isolated_competition_2026",
        "generatedAt": generated_at,
        "note": "Isolated research bundle; no live catalog registration.",
        "thresholds": {
            "minForwardProfitFactor": args.min_forward_pf,
            "minForwardTrades": args.min_forward_trades,
            "minTrainingProfitFactor": args.min_train_pf,
            "minTrainingTrades": args.min_train_trades,
        },
        "trainingWindow": {"start": "asset_start", "end": "2021-12-31"},
        "forwardWindow": {"start": "2022-01-01", "end": "asset_latest"},
        "count": len(strategy_payloads),
        "strategies": strategy_payloads,
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (output_dir / "firebase_payload.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    readme = [
        "# Competition Strategy Bundle",
        "",
        "This directory is intentionally separate from the live strategy catalog.",
        "",
        "- Nothing here is imported by `src/lib/strategy-loader.ts`.",
        "- Parameters are ranked on pre-2022 training trades.",
        "- Qualification stats use post-2022 forward trades only.",
        "- Firebase sync should target a separate collection/namespace.",
        "",
        f"Generated at: {generated_at}",
        f"Strategies: {len(strategy_payloads)}",
        "",
        "Run:",
        "",
        "```powershell",
        "python competition/generate_competition_bundle.py",
        "node --env-file=.env.local --import tsx scripts/sync-competition-strategies.ts",
        "```",
        "",
    ]
    (output_dir / "README.md").write_text("\n".join(readme), encoding="utf-8")


def main() -> int:
    args = parse_args()
    if args.limit <= 0:
        raise ValueError("--limit must be positive")
    module = load_potential_backtester()
    asset_filters = split_csv_args(args.asset) or list(DEFAULT_ASSETS)
    assets = module.load_assets(asset_filters)
    candidates = scan_candidates(module, assets)
    qualified = qualify_candidates(module, candidates, args)
    selected = select_with_diversity(qualified, args.limit, args.family_cap, args.asset_cap)

    print(f"Scanned {len(candidates)} all-history candidates.")
    print(f"Qualified {len(qualified)} candidates after train/forward filters.")
    print(f"Selected {len(selected)} isolated competition strategies.")
    for rank, item in enumerate(selected, start=1):
        candidate = item.candidate
        print(
            f"{rank:02d}. {candidate.strategy_id}: "
            f"train PF={item.train_metrics.profit_factor:.2f} trades={item.train_metrics.trades}; "
            f"forward PF={item.forward_metrics.profit_factor:.2f} trades={item.forward_metrics.trades}"
        )

    if len(selected) < args.limit:
        raise RuntimeError(f"Only selected {len(selected)} strategies; requested {args.limit}.")

    if not args.no_write:
        write_bundle(Path(args.output_dir), selected, args)
        print(f"Wrote isolated bundle to {Path(args.output_dir)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
