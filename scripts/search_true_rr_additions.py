from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backtest-engine"))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

import research_competition_session_candidates as research  # noqa: E402
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
    label: str
    summary: str
    risk_reward: float


@dataclass(frozen=True)
class Candidate:
    strategy: runner.BacktestStrategy
    asset: runner.AssetConfig
    spec: Spec
    train: Metrics
    forward: Metrics
    trades: list[runner.BacktestTradeRow]
    avg_planned_rr: float
    score: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Add true bracket RR>=2 competition strategies.")
    parser.add_argument("--asset", action="append")
    parser.add_argument("--filter-set", choices=["narrow", "broad"], default="narrow")
    parser.add_argument("--risk-reward", default="2,3")
    parser.add_argument("--min-forward-pf", type=float, default=2.0)
    parser.add_argument("--min-forward-trades", type=int, default=21)
    parser.add_argument("--min-train-trades", type=int, default=10)
    parser.add_argument("--min-train-pf", type=float, default=0.70)
    parser.add_argument("--min-split-pf", type=float, default=0.0)
    parser.add_argument("--min-split-trades", type=int, default=1)
    parser.add_argument("--max-fast-per-asset", type=int, default=30)
    parser.add_argument("--max-add-per-asset", type=int, default=2)
    parser.add_argument("--max-total-additions", type=int, default=20)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def parse_rr(raw: str) -> tuple[str, ...]:
    values: list[float] = []
    for item in raw.split(","):
        try:
            value = float(item.strip())
        except ValueError:
            continue
        if math.isfinite(value) and value >= 2:
            values.append(value)
    return tuple(str(int(value)) if value.is_integer() else str(value) for value in sorted(set(values))) or ("2",)


def loader_folders() -> list[str]:
    return re.findall(r'@strategy/([^/]+)/strategy', LOADER_PATH.read_text(encoding="utf-8"))


def params_from_variant(variant_id: str) -> dict[str, str]:
    output: dict[str, str] = {}
    for token in variant_id.split("|")[1:]:
        if "=" not in token:
            continue
        key, value = token.split("=", 1)
        output[key] = value
    return output


def canonical_variant(variant_id: str, include_exit: bool = True) -> str:
    tokens = [token for token in variant_id.split("|") if token]
    if not tokens:
        return ""
    keyed: dict[str, str] = {}
    for token in tokens[1:]:
        if "=" not in token:
            continue
        key, value = token.split("=", 1)
        if not include_exit and key in {"risk_reward", "rr", "managed_exit"}:
            continue
        keyed[key] = value
    return "|".join([tokens[0], *(f"{key}={keyed[key]}" for key in sorted(keyed))])


def existing_variants() -> set[tuple[str, str]]:
    output: set[tuple[str, str]] = set()
    for folder in loader_folders():
        metadata_path = STRATEGY_ROOT / folder / "machine_learning" / "selection.json"
        if not metadata_path.exists():
            continue
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        asset_key = str(payload.get("assetKey") or "")
        variant_id = str(payload.get("variantId") or "")
        output.add((asset_key, canonical_variant(variant_id, include_exit=True)))
    return output


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


def split_values(values: list[float]) -> list[list[float]]:
    if not values:
        return [[]]
    cuts = [math.ceil(len(values) * index / 4) for index in range(1, 4)]
    return [values[: cuts[0]], values[cuts[0] : cuts[1]], values[cuts[1] : cuts[2]], values[cuts[2] :]]


def metrics_for(trades: list[runner.BacktestTradeRow]) -> Metrics:
    values = [float(trade.r_multiple) for trade in sorted(trades, key=lambda item: item.entry_time)]
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


def planned_rr(trades: list[runner.BacktestTradeRow]) -> float:
    ratios = [abs(trade.tp_units) / abs(trade.sl_units) for trade in trades if abs(trade.tp_units) > 0 and abs(trade.sl_units) > 0]
    return sum(ratios) / len(ratios) if ratios else 0.0


def add_bracket_exit(raw: research.VariantSpec) -> Spec:
    params = list(raw.params)
    params = [(key, value) for key, value in params if key != "managed_exit"]
    params.append(("managed_exit", "bracket"))
    variant_id = "|".join(["competition_session_edge", f"family={raw.family}", *(f"{key}={value}" for key, value in params)])
    rr = float(params_from_variant(variant_id).get("risk_reward") or 2)
    return Spec(
        variant_id=variant_id,
        label=raw.label.replace(" 2R", " true 2R").replace(" 3R", " true 3R"),
        summary=f"{raw.summary} True bracket exit: stop is ATR/session risk at entry and target is {rr:g}:1 of realized risk.",
        risk_reward=rr,
    )


def symbol_label(asset: runner.AssetConfig) -> str:
    return asset.symbol.upper().replace("/", "")


def slug(value: str, max_len: int = 78) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")[:max_len].strip("_")


def strategy_id_for(asset: runner.AssetConfig, spec: Spec) -> str:
    digest = hashlib.sha1(f"{asset.key}|{canonical_variant(spec.variant_id)}".encode("utf-8")).hexdigest()[:8]
    family = params_from_variant(spec.variant_id).get("family", "session_edge")
    rr = params_from_variant(spec.variant_id).get("risk_reward", "2").replace(".", "_")
    return f"competition_{asset.key}_{slug(family, 58)}_true_rr_{rr}_{digest}"


def build_strategy(asset: runner.AssetConfig, spec: Spec) -> runner.BacktestStrategy:
    strategy_id = strategy_id_for(asset, spec)
    return runner.BacktestStrategy(
        id=strategy_id,
        label=f"{symbol_label(asset)} {spec.label}",
        folder=strategy_id,
        asset_key=asset.key,
        phase="competition_session_edge",
        variant_id=spec.variant_id,
        source="true_rr_addition_search_2026_05",
        one_trade_per_day=False,
        cost_units=0.0,
    )


def load_data(asset: runner.AssetConfig) -> runner.EnrichedData:
    frame = runner.load_candle_csv(runner.DATA_ROOT / "15m" / asset.data_file)
    return runner.build_enriched_data(frame, asset)


def qualifies(metrics: Metrics, min_pf: float, min_trades: int, args: argparse.Namespace) -> bool:
    return (
        metrics.trades >= min_trades
        and metrics.profit_factor >= min_pf
        and metrics.min_split_trades >= args.min_split_trades
        and metrics.min_split_pf >= args.min_split_pf
    )


def research_asset(asset: runner.AssetConfig, specs: list[Spec], existing: set[tuple[str, str]], args: argparse.Namespace) -> list[Candidate]:
    data = load_data(asset)
    fast_rows: list[tuple[float, runner.BacktestStrategy, Spec, Metrics]] = []
    for spec in specs:
        if (asset.key, canonical_variant(spec.variant_id)) in existing:
            continue
        strategy = build_strategy(asset, spec)
        trades = runner.run_competition_session_edge_strategy(strategy, asset, data, FORWARD_START_TS, None)
        fast = metrics_for(trades)
        rr = planned_rr(trades)
        if not qualifies(fast, args.min_forward_pf, args.min_forward_trades, args) or rr < 1.95:
            continue
        score = min(fast.profit_factor, 8) * 10 + math.log1p(fast.trades) * 4 + rr
        fast_rows.append((score, strategy, spec, fast))
    fast_rows.sort(key=lambda row: (row[0], row[3].profit_factor, row[3].trades), reverse=True)

    selected: list[Candidate] = []
    used_base: set[str] = set()
    for _score, strategy, spec, _fast in fast_rows[: args.max_fast_per_asset]:
        if len(selected) >= args.max_add_per_asset:
            break
        base = canonical_variant(spec.variant_id, include_exit=False)
        if base in used_base:
            continue
        train_trades = runner.run_single_strategy(strategy, asset, data, 0, FORWARD_START_TS, strict_anti_cheat=True)
        train = metrics_for(train_trades)
        if train.trades < args.min_train_trades or train.profit_factor < args.min_train_pf:
            continue
        strict_trades = runner.run_single_strategy(strategy, asset, data, FORWARD_START_TS, None, strict_anti_cheat=True)
        forward = metrics_for(strict_trades)
        rr = planned_rr(strict_trades)
        if not qualifies(forward, args.min_forward_pf, args.min_forward_trades, args) or rr < 1.95:
            continue
        used_base.add(base)
        score = min(forward.profit_factor, 8) * 10 + math.log1p(forward.trades) * 4 + min(train.profit_factor, 3)
        selected.append(Candidate(strategy, asset, spec, train, forward, strict_trades, rr, score))
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
        "selectionMethod": "Add-only true-RR search: candidate grid was generated before forward validation; pre-2022 train diagnostics and post-2022 strict anti-cheat forward results are stored separately.",
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
        "forwardAverageR": round(candidate.forward.total_r / candidate.forward.trades if candidate.forward.trades else 0.0, 6),
        "forwardMaxDrawdownR": round(candidate.forward.max_drawdown_r, 6),
        "verificationSummary": f"Strict true-bracket forward PF {candidate.forward.profit_factor:.2f}, {candidate.forward.trades} trades, average planned RR {candidate.avg_planned_rr:.2f}; pre-2022 train PF {candidate.train.profit_factor:.2f} over {candidate.train.trades} trades.",
        "costUnits": candidate.strategy.cost_units,
        "oneTradePerDay": False,
    }
    (metadata_dir / "selection.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    runner.write_strategy_backtest_csv(strategy_dir / "backtest_trades.csv", candidate.trades)


def update_loader(candidates: list[Candidate]) -> None:
    if not candidates:
        return
    text = LOADER_PATH.read_text(encoding="utf-8")
    next_index = len(loader_folders())
    imports = []
    items = []
    for offset, candidate in enumerate(candidates):
        name = f"strategy{next_index + offset:03d}"
        imports.append(f'import {name} from "@strategy/{candidate.strategy.folder}/strategy";')
        items.append(f"  {name}")
    insert_at = text.index("\nimport type { StrategyDefinition }")
    text = text[:insert_at] + "\n" + "\n".join(imports) + text[insert_at:]
    text = re.sub(r"\n\s*strategy\d{3}\n\];", lambda match: match.group(0).replace("\n];", ",\n" + ",\n".join(items) + "\n];"), text, count=1)
    LOADER_PATH.write_text(text, encoding="utf-8")


def write_report(candidates: list[Candidate], dry_run: bool) -> None:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    path = REPORT_ROOT / "true_rr_addition_search.csv"
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["status", "strategy_id", "asset_key", "forward_pf", "forward_trades", "avg_rr", "train_pf", "train_trades", "variant_id"])
        writer.writeheader()
        for candidate in candidates:
            writer.writerow({
                "status": "selected" if dry_run else "applied",
                "strategy_id": candidate.strategy.id,
                "asset_key": candidate.asset.key,
                "forward_pf": f"{candidate.forward.profit_factor:.6f}",
                "forward_trades": candidate.forward.trades,
                "avg_rr": f"{candidate.avg_planned_rr:.6f}",
                "train_pf": f"{candidate.train.profit_factor:.6f}",
                "train_trades": candidate.train.trades,
                "variant_id": candidate.strategy.variant_id,
            })
    print(f"report={path.relative_to(PROJECT_ROOT)}")


def main() -> int:
    args = parse_args()
    requested = {item.lower() for raw in args.asset or [] for item in raw.split(",") if item.strip()}
    assets = [
        asset
        for asset in runner.load_assets()
        if asset.market in {"forex", "futures"}
        and (not requested or asset.key.lower() in requested or asset.symbol.lower() in requested)
        and (runner.DATA_ROOT / "15m" / asset.data_file).exists()
    ]
    raw_specs = research.variant_specs(args.filter_set, parse_rr(args.risk_reward))
    specs = [add_bracket_exit(spec) for spec in raw_specs]
    existing = existing_variants()
    selected: list[Candidate] = []
    print(f"Scanning {len(assets)} asset(s), {len(specs)} true-bracket specs", flush=True)
    for asset in assets:
        if len(selected) >= args.max_total_additions:
            break
        print(f"  asset={asset.key}", flush=True)
        additions = research_asset(asset, specs, existing, args)
        selected.extend(additions)
        print(f"    selected={len(additions)}", flush=True)
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
