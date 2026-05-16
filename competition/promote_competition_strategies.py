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
STRATEGY_ROOT = PROJECT_ROOT / "strategy"
LOADER_PATH = PROJECT_ROOT / "src" / "lib" / "strategy-loader.ts"
SUMMARY_PATH = PROJECT_ROOT / "competition" / "promoted-strategies-summary.csv"
TRAIN_END_TS = int(datetime(2022, 1, 1, tzinfo=timezone.utc).timestamp())
SOURCE = "competition_session_edge_train_forward_2026"


PARAM_KEY_MAP = {
    "signalStartMinute": "signal_start",
    "signalEndBarMinute": "signal_end",
    "entryMinute": "entry",
    "exitBarMinute": "exit",
    "exitMinute": "exit",
    "minSignalAtr": "min_signal_atr",
    "signalWeekday": "signal_weekday",
    "signalWeekdaySide": "signal_weekday_side",
    "sideFilter": "side_filter",
    "signalMonth": "signal_month",
    "minGapAtr": "min_gap_atr",
    "lookbackDays": "lookback",
    "rangeStartMinute": "range_start",
    "rangeEndMinute": "range_end",
    "breakStartMinute": "break_start",
    "breakEndMinute": "break_end",
    "forcedExitMinute": "forced_exit",
    "riskReward": "risk_reward",
}


@dataclass(frozen=True)
class Metrics:
    profit_factor: float
    trades: int
    wins: int
    losses: int
    total_r: float
    average_r: float
    win_rate_pct: float
    max_drawdown_r: float


@dataclass(frozen=True)
class Selected:
    candidate: Any
    train_metrics: Metrics
    forward_metrics: Metrics
    train_score: float
    variant_id: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Promote competition strategies into the live strategy catalog.")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--min-forward-pf", type=float, default=2.0)
    parser.add_argument("--min-forward-trades", type=int, default=20)
    parser.add_argument("--min-train-pf", type=float, default=1.1)
    parser.add_argument("--min-train-trades", type=int, default=20)
    parser.add_argument("--family-cap", type=int, default=8)
    parser.add_argument("--asset-cap", type=int, default=6)
    parser.add_argument("--asset", action="append", help="Optional asset key/symbol filter. Repeat or comma-separate.")
    parser.add_argument("--exclude-id", action="append", help="Raw or competition-prefixed strategy id to skip.")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def split_csv_args(values: Iterable[str] | None) -> list[str]:
    return [
        item.strip()
        for raw in (values or [])
        for item in raw.split(",")
        if item.strip()
    ]


def load_potential_backtester():
    spec = importlib.util.spec_from_file_location("competition_potential_research_backtester", POTENTIAL_BACKTESTER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {POTENTIAL_BACKTESTER}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous
    module.BACKTEST_START_TS = 0
    return module


def metrics(module: Any, trades: list[Any]) -> Metrics:
    pf, total_r, win_rate, max_drawdown = module.trade_metrics(trades)
    wins = sum(1 for trade in trades if float(trade.r_multiple) > 0)
    losses = sum(1 for trade in trades if float(trade.r_multiple) < 0)
    trade_count = len(trades)
    return Metrics(
        profit_factor=float(pf),
        trades=trade_count,
        wins=wins,
        losses=losses,
        total_r=float(total_r),
        average_r=float(total_r) / trade_count if trade_count else 0.0,
        win_rate_pct=float(win_rate) * 100.0,
        max_drawdown_r=float(max_drawdown),
    )


def train_score(value: Metrics) -> float:
    capped_pf = min(value.profit_factor if math.isfinite(value.profit_factor) else 5.0, 5.0)
    return capped_pf * math.log1p(value.trades) + value.total_r * 0.03 - value.max_drawdown_r * 0.05


def format_value(value: Any) -> str:
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            return "0"
        rounded = round(value, 6)
        if math.isclose(rounded, round(rounded)):
            return str(int(round(rounded)))
        return f"{rounded:.6f}".rstrip("0").rstrip(".")
    return str(value).replace("|", "_").replace("=", "_").replace(" ", "_")


def variant_id_for(candidate: Any) -> str:
    tokens = ["competition_session_edge", f"family={candidate.family}"]
    for raw_key, raw_value in sorted(candidate.params.items()):
        key = PARAM_KEY_MAP.get(raw_key)
        if key is None:
            if raw_key in {"entry", "exit"}:
                continue
            key = raw_key
        tokens.append(f"{key}={format_value(raw_value)}")
    return "|".join(tokens)


def finite_json(value: float) -> float:
    if not math.isfinite(value):
        return 999999.0
    rounded = round(value, 6)
    return int(rounded) if math.isclose(rounded, round(rounded)) else rounded


def split_candidate(module: Any, candidate: Any, variant_id: str, args: argparse.Namespace) -> Selected | None:
    train_trades = [
        trade
        for trade in candidate.trades
        if int(trade.entry_time) < TRAIN_END_TS and int(trade.exit_time) < TRAIN_END_TS
    ]
    forward_trades = [trade for trade in candidate.trades if int(trade.entry_time) >= TRAIN_END_TS]
    train = metrics(module, train_trades)
    forward = metrics(module, forward_trades)
    if train.trades < args.min_train_trades or train.profit_factor < args.min_train_pf or train.total_r <= 0:
        return None
    if forward.trades < args.min_forward_trades or forward.profit_factor <= args.min_forward_pf or forward.total_r <= 0:
        return None
    return Selected(candidate=candidate, train_metrics=train, forward_metrics=forward, train_score=train_score(train), variant_id=variant_id)


def existing_signatures() -> set[tuple[str, str, str]]:
    signatures: set[tuple[str, str, str]] = set()
    for folder in STRATEGY_ROOT.iterdir():
        if not folder.is_dir():
            continue
        for relative in ("machine_learning/selection.json", "bayes/selection.json", "parameters/backtest.json"):
            path = folder / relative
            if not path.exists():
                continue
            payload = json.loads(path.read_text(encoding="utf-8"))
            signatures.add((str(payload.get("assetKey")), str(payload.get("phase")), str(payload.get("variantId"))))
            break
    return signatures


def scan_all(module: Any, assets: list[Any]) -> list[Any]:
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
    candidates.extend(refined)
    print(f"Added {len(refined)} filtered candidates", flush=True)
    return candidates


def select_candidates(module: Any, candidates: list[Any], args: argparse.Namespace) -> list[Selected]:
    signatures = existing_signatures()
    excluded_ids = {
        value.removeprefix("competition_")
        for value in split_csv_args(args.exclude_id)
    }
    scored: list[Selected] = []
    seen: set[tuple[str, str, str]] = set()
    for candidate in candidates:
        if candidate.strategy_id in excluded_ids:
            continue
        variant_id = variant_id_for(candidate)
        signature = (candidate.asset.key, "competition_session_edge", variant_id)
        if signature in signatures or signature in seen:
            continue
        selected = split_candidate(module, candidate, variant_id, args)
        if selected is not None:
            scored.append(selected)
            seen.add(signature)
    scored.sort(key=lambda item: item.train_score, reverse=True)

    selected: list[Selected] = []
    family_counts: dict[str, int] = {}
    asset_counts: dict[str, int] = {}
    chosen_ids: set[str] = set()

    def try_add(item: Selected, relaxed: bool = False) -> None:
        if len(selected) >= args.limit or item.candidate.strategy_id in chosen_ids:
            return
        if not relaxed:
            if family_counts.get(item.candidate.family, 0) >= args.family_cap:
                return
            if asset_counts.get(item.candidate.asset.key, 0) >= args.asset_cap:
                return
        selected.append(item)
        chosen_ids.add(item.candidate.strategy_id)
        family_counts[item.candidate.family] = family_counts.get(item.candidate.family, 0) + 1
        asset_counts[item.candidate.asset.key] = asset_counts.get(item.candidate.asset.key, 0) + 1

    for item in scored:
        try_add(item)
    for item in scored:
        try_add(item, relaxed=True)

    return selected


def camel_case(value: str) -> str:
    parts = [part for part in value.split("_") if part]
    if not parts:
        return "strategyDefinition"
    name = parts[0]
    for part in parts[1:]:
        name += part[:1].upper() + part[1:]
    if name[:1].isdigit():
        name = f"s{name}"
    return "".join(character for character in name if character.isalnum())


def write_strategy(item: Selected, rank: int, overwrite: bool) -> str:
    candidate = item.candidate
    strategy_id = f"competition_{candidate.strategy_id}"
    strategy_dir = STRATEGY_ROOT / strategy_id
    if strategy_dir.exists() and not overwrite:
        raise FileExistsError(f"{strategy_dir} already exists; rerun with --overwrite")
    if strategy_dir.exists():
        shutil.rmtree(strategy_dir)
    metadata_dir = strategy_dir / "machine_learning"
    research_dir = strategy_dir / "research"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    research_dir.mkdir(parents=True, exist_ok=True)

    label = f"Competition {candidate.label}"
    metadata = {
        "strategyId": strategy_id,
        "label": label,
        "folder": strategy_id,
        "assetKey": candidate.asset.key,
        "phase": "competition_session_edge",
        "variantId": item.variant_id,
        "source": SOURCE,
        "sourceUrls": candidate.source_urls,
        "researchSummary": candidate.hypothesis,
        "selectionMethod": (
            "Pre-2022 train-score rank, then post-2022 forward qualification. "
            "No parameters were fit on post-2022 data."
        ),
        "trainingWindow": {"start": "asset_start", "end": "2021-12-31"},
        "forwardWindow": {"start": "2022-01-01", "end": "asset_latest"},
        "selectedTrainingProfitFactor": finite_json(item.train_metrics.profit_factor),
        "selectedTrainingTrades": item.train_metrics.trades,
        "selectedForwardProfitFactor": finite_json(item.forward_metrics.profit_factor),
        "selectedForwardTrades": item.forward_metrics.trades,
        "forwardWins": item.forward_metrics.wins,
        "forwardLosses": item.forward_metrics.losses,
        "forwardTotalR": finite_json(item.forward_metrics.total_r),
        "forwardAverageR": finite_json(item.forward_metrics.average_r),
        "forwardMaxDrawdownR": finite_json(item.forward_metrics.max_drawdown_r),
        "verificationSummary": (
            f"Promoted rank {rank}. Training PF {item.train_metrics.profit_factor:.2f} over "
            f"{item.train_metrics.trades} trades. Forward PF {item.forward_metrics.profit_factor:.2f} "
            f"over {item.forward_metrics.trades} trades."
        ),
        "costUnits": 0,
        "oneTradePerDay": False,
    }
    (metadata_dir / "selection.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    strategy_ts = f'''import {{ createStrategyDefinition, runtimeDefaultsFromMetadata }} from "@/lib/strategy-definition";
import {{ evaluateCompetitionSessionEdge }} from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({{
  id: {json.dumps(strategy_id)},
  label: {json.dumps(label)},
  folder: {json.dumps(strategy_id)},
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: {json.dumps(candidate.asset.key)},
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
}});
'''
    (strategy_dir / "strategy.ts").write_text(strategy_ts, encoding="utf-8")
    research_lines = [
        f"# {label}",
        "",
        f"- Asset: {candidate.asset.name} ({candidate.asset.symbol})",
        f"- Family: {candidate.family}",
        f"- Training PF: {item.train_metrics.profit_factor:.2f} over {item.train_metrics.trades} trades",
        f"- Forward PF: {item.forward_metrics.profit_factor:.2f} over {item.forward_metrics.trades} trades",
        "",
        "## Hypothesis",
        "",
        candidate.hypothesis,
        "",
        "## Split",
        "",
        "- Parameters were ranked on trades completed before 2022-01-01.",
        "- Forward metrics are trades entered on or after 2022-01-01.",
        "",
        "## Sources",
        "",
    ]
    research_lines.extend(f"- {url}" for url in candidate.source_urls)
    (research_dir / "README.md").write_text("\n".join(research_lines) + "\n", encoding="utf-8")
    return strategy_id


def rewrite_strategy_loader() -> None:
    folders = sorted(path.parent.name for path in STRATEGY_ROOT.glob("*/strategy.ts"))
    imports = [f'import {camel_case(folder)}Strategy from "@strategy/{folder}/strategy";' for folder in folders]
    entries = [f"  {camel_case(folder)}Strategy," for folder in folders]
    content = "\n".join(imports)
    content += '\n\nimport type { StrategyDefinition } from "@/lib/strategy-definition";\n\n'
    content += 'export type { StrategyDefinition, StrategySignal } from "@/lib/strategy-definition";\n\n'
    content += "export const STRATEGY_DEFINITIONS: StrategyDefinition[] = [\n"
    content += "\n".join(entries)
    content += "\n];\n\n"
    content += "export function strategyForPhase(phase: string): StrategyDefinition | undefined {\n"
    content += "  return STRATEGY_DEFINITIONS.find((strategy) => strategy.phase === phase);\n"
    content += "}\n"
    LOADER_PATH.write_text(content, encoding="utf-8")


def write_summary(selected: list[Selected], strategy_ids: list[str]) -> None:
    rows = []
    for rank, (item, strategy_id) in enumerate(zip(selected, strategy_ids, strict=True), start=1):
        rows.append(
            {
                "rank": rank,
                "strategy_id": strategy_id,
                "asset_key": item.candidate.asset.key,
                "symbol": item.candidate.asset.symbol,
                "family": item.candidate.family,
                "train_score": finite_json(item.train_score),
                "train_pf": finite_json(item.train_metrics.profit_factor),
                "train_trades": item.train_metrics.trades,
                "forward_pf": finite_json(item.forward_metrics.profit_factor),
                "forward_trades": item.forward_metrics.trades,
                "forward_total_r": finite_json(item.forward_metrics.total_r),
                "variant_id": item.variant_id,
            }
        )
    SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    with SUMMARY_PATH.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    args = parse_args()
    module = load_potential_backtester()
    assets = module.load_assets(split_csv_args(args.asset) or None)
    candidates = scan_all(module, assets)
    selected = select_candidates(module, candidates, args)
    if len(selected) < args.limit:
        raise RuntimeError(f"Only found {len(selected)} candidates; requested {args.limit}")

    strategy_ids = [write_strategy(item, rank, args.overwrite) for rank, item in enumerate(selected, start=1)]
    rewrite_strategy_loader()
    write_summary(selected, strategy_ids)

    print(f"Promoted {len(strategy_ids)} competition strategies.")
    print(",".join(strategy_ids))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
