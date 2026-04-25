from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import runner


IMPORT_PREFIX = "simple_import_"
SUMMARY_JSON = "import-summary.json"
WINNERS_CSV = "validated-winners.csv"

SUPPORTED_FAMILIES = {
    "Momentum.ts": "momentum",
    "EMA_Pullback.ts": "reddit_ema_pullback",
    "ORB_Breakout.ts": "reddit_orb_breakout",
    "ORB_Retest.ts": "reddit_orb_retest",
    "Capitulation_Reversion.ts": "reddit_capitulation_reversion",
    "ICT_Sweep_FVG.ts": "ict_sweep_fvg",
    "ICT_Turtle_Soup.ts": "ict_turtle_soup",
}

SUPPORTED_PHASE_LABELS = {
    "momentum": "Momentum",
    "reddit_ema_pullback": "EMA Pullback",
    "reddit_orb_breakout": "ORB Breakout",
    "reddit_orb_retest": "ORB Retest",
    "reddit_capitulation_reversion": "Capitulation Reversion",
    "ict_sweep_fvg": "ICT Sweep FVG",
    "ict_turtle_soup": "ICT Turtle Soup",
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
    trades_per_day: float
    trades_per_week: float


@dataclass
class Candidate:
    family: str
    phase: str
    asset_key: str
    symbol: str
    market: str
    parameter_set_name: str
    variant_id: str
    signal_atr_mult: float | None = None
    recent_signal_lookback: int | None = None
    abs_close_ema200_atr_max: float | None = None
    trade_rsi_min: float | None = None
    trade_rsi_max: float | None = None
    ict_risk_reward: float | None = None
    tp_units: float | None = None
    sl_units: float | None = None
    one_trade_per_day: bool = False
    cost_units: float = 0.0
    invert_signal: bool = False
    source_folders: list[str] = field(default_factory=list)
    source_paths: list[str] = field(default_factory=list)
    source_file_name: str = ""
    source_code: str = ""
    raw_params: dict[str, Any] = field(default_factory=dict)

    def signature(self) -> tuple[Any, ...]:
        return (
            self.asset_key,
            self.phase,
            self.variant_id,
            self.signal_atr_mult,
            self.recent_signal_lookback,
            self.abs_close_ema200_atr_max,
            self.trade_rsi_min,
            self.trade_rsi_max,
            self.ict_risk_reward,
            self.tp_units,
            self.sl_units,
            self.one_trade_per_day,
            self.cost_units,
            self.invert_signal,
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import and revalidate Desktop/simple strategies.")
    parser.add_argument("--input-dir", required=True, help="Path to the Desktop/simple folder")
    parser.add_argument("--output-dir", required=True, help="Where to write import summaries")
    parser.add_argument("--min-profit-factor", type=float, default=2.0)
    parser.add_argument("--min-trades", type=int, default=30)
    parser.add_argument("--momentum-top-per-symbol", type=int, default=5)
    return parser.parse_args()


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def safe_rmtree(path: Path, root: Path) -> None:
    resolved = path.resolve()
    root_resolved = root.resolve()
    if resolved.parent != root_resolved:
        raise ValueError(f"Refusing to delete outside strategy root: {resolved}")
    shutil.rmtree(resolved)


def cleanup_previous_imports(strategy_root: Path) -> None:
    for child in strategy_root.iterdir():
        if child.is_dir() and child.name.startswith(IMPORT_PREFIX):
            safe_rmtree(child, strategy_root)


def parse_scalar(raw: str) -> Any:
    value = raw.strip()
    if value == "true":
        return True
    if value == "false":
        return False
    if value.startswith('"') and value.endswith('"'):
        return json.loads(value)
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1].encode("utf-8").decode("unicode_escape")
    if "." in value:
        return float(value)
    return int(value)


def extract_parameter_block(source_code: str) -> tuple[str, dict[str, Any]]:
    match = re.search(
        r"createStaticParameterSet\(\s*(?P<quote>['\"])(?P<name>.+?)(?P=quote)\s*,\s*\{(?P<body>.*?)\}\s*\)",
        source_code,
        flags=re.DOTALL,
    )
    if not match:
        raise ValueError("Could not find createStaticParameterSet(...) block")

    parameter_name = match.group("name").strip()
    body = match.group("body")
    params: dict[str, Any] = {}
    for key, raw_value in re.findall(
        r"(\w+)\s*:\s*(\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'|true|false|-?\d+(?:\.\d+)?)",
        body,
    ):
        params[key] = parse_scalar(raw_value)
    return parameter_name, params


def metrics_from_trades(trades: list[runner.BacktestTradeRow]) -> Metrics:
    wins = [trade.r_multiple for trade in trades if trade.r_multiple > 0]
    losses = [trade.r_multiple for trade in trades if trade.r_multiple < 0]
    gross_wins = sum(wins)
    gross_losses = sum(abs(value) for value in losses)
    total_r = sum(trade.r_multiple for trade in trades)
    profit_factor = math.inf if gross_losses == 0 and gross_wins > 0 else (gross_wins / gross_losses if gross_losses else 0.0)

    equity_r = 0.0
    peak_r = 0.0
    max_drawdown_r = 0.0
    times = [trade.entry_time for trade in trades]
    if times:
        start_ts = min(times)
        end_ts = max(times)
        days = max((end_ts - start_ts) / 86_400, 1.0)
    else:
        days = 1.0

    for trade in sorted(trades, key=lambda item: item.exit_time):
        equity_r += trade.r_multiple
        peak_r = max(peak_r, equity_r)
        max_drawdown_r = max(max_drawdown_r, peak_r - equity_r)

    trade_count = len(trades)
    return Metrics(
        trades=trade_count,
        wins=len(wins),
        losses=len(losses),
        win_rate_pct=((len(wins) / trade_count) * 100.0) if trade_count else 0.0,
        profit_factor=profit_factor,
        total_r=total_r,
        avg_r=(total_r / trade_count) if trade_count else 0.0,
        max_drawdown_r=max_drawdown_r,
        trades_per_day=trade_count / days,
        trades_per_week=trade_count / (days / 7.0),
    )


def candidate_hash(candidate: Candidate) -> str:
    payload = json.dumps(candidate.signature(), sort_keys=False, default=str)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:10]


def strategy_id_for(candidate: Candidate) -> str:
    return f"{IMPORT_PREFIX}{candidate.asset_key}_{candidate.phase}_{candidate_hash(candidate)}"


def label_for(candidate: Candidate) -> str:
    phase_label = SUPPORTED_PHASE_LABELS.get(candidate.phase, candidate.phase.replace("_", " ").title())
    return f"{candidate.symbol} Simple Import {phase_label} {candidate.parameter_set_name}"


def metadata_payload(candidate: Candidate, strategy_id: str, metrics: Metrics, canonical_folder: str) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "strategyId": strategy_id,
        "label": label_for(candidate),
        "folder": strategy_id,
        "assetKey": candidate.asset_key,
        "phase": candidate.phase,
        "variantId": candidate.variant_id,
        "source": "simple_import_revalidated",
        "selectionMethod": "desktop_simple_dedupe_then_strict_rerun",
        "recoveredFrom": canonical_folder,
        "recoveredForwardProfitFactor": metrics.profit_factor,
        "recoveredForwardTrades": metrics.trades,
        "recoveredForwardTotalR": metrics.total_r,
        "recoveredForwardMaxDrawdownR": metrics.max_drawdown_r,
        "oneTradePerDay": candidate.one_trade_per_day,
        "costUnits": candidate.cost_units,
    }
    if candidate.signal_atr_mult is not None:
        payload["signalAtrMult"] = candidate.signal_atr_mult
    if candidate.recent_signal_lookback is not None:
        payload["recentSignalLookback"] = candidate.recent_signal_lookback
    if candidate.abs_close_ema200_atr_max is not None:
        payload["absCloseEma200AtrMax"] = candidate.abs_close_ema200_atr_max
    if candidate.trade_rsi_min is not None:
        payload["tradeRsiMin"] = candidate.trade_rsi_min
    if candidate.trade_rsi_max is not None:
        payload["tradeRsiMax"] = candidate.trade_rsi_max
    if candidate.ict_risk_reward is not None:
        payload["ictRiskReward"] = candidate.ict_risk_reward
    if candidate.tp_units is not None:
        payload["tpUnits"] = candidate.tp_units
    if candidate.sl_units is not None:
        payload["slUnits"] = candidate.sl_units
    if candidate.invert_signal:
        payload["invertSignal"] = True
    return payload


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def build_symbol_map(assets: dict[str, runner.AssetConfig]) -> dict[str, runner.AssetConfig]:
    mapping: dict[str, runner.AssetConfig] = {}
    for asset in assets.values():
        mapping[asset.symbol.upper()] = asset
    return mapping


def momentum_signature(
    symbol: str,
    signal_atr_mult: float | None,
    recent_signal_lookback: int | None,
    abs_close_ema200_atr_max: float | None,
    tp_units: float | None,
    sl_units: float | None,
) -> tuple[Any, ...]:
    return (
        symbol.upper(),
        signal_atr_mult,
        recent_signal_lookback,
        abs_close_ema200_atr_max,
        tp_units,
        sl_units,
    )


def load_momentum_prescreen(input_dir: Path, top_per_symbol: int) -> set[tuple[Any, ...]]:
    import csv

    selected_summary_path = input_dir / "strategy-results" / "live_realistic_selected_summary_2y.csv"
    if selected_summary_path.exists():
        allowed: set[tuple[Any, ...]] = set()
        with selected_summary_path.open(newline="", encoding="utf-8") as handle:
            csv_reader = csv.DictReader(handle)
            for row in csv_reader:
                if row.get("phase") != "momentum":
                    continue
                try:
                    allowed.add(
                        momentum_signature(
                            str(row["symbol"]).strip().upper(),
                            float(row["signal_atr_mult"]) if row["signal_atr_mult"] else None,
                            int(float(row["recent_signal_lookback"])) if row["recent_signal_lookback"] else None,
                            float(row["abs_close_ema200_atr_max"]) if row["abs_close_ema200_atr_max"] else None,
                            float(row["tp_units"]) if row["tp_units"] else None,
                            float(row["sl_units"]) if row["sl_units"] else None,
                        )
                    )
                except Exception:  # noqa: BLE001
                    continue
        if allowed:
            return allowed

    sweep_path = input_dir / "strategy-results" / "phase_entry_exit_optimization_sweep_2y.csv"
    if not sweep_path.exists():
        return set()

    rows_by_symbol: dict[str, list[tuple[float, int, tuple[Any, ...]]]] = {}
    with sweep_path.open(newline="", encoding="utf-8") as handle:
        csv_reader = csv.DictReader(handle)
        for row in csv_reader:
            if row.get("phase") != "momentum":
                continue
            try:
                symbol = str(row["symbol"]).strip().upper()
                signature = momentum_signature(
                    symbol,
                    float(row["signal_atr_mult"]) if row["signal_atr_mult"] else None,
                    int(float(row["recent_signal_lookback"])) if row["recent_signal_lookback"] else None,
                    float(row["abs_close_ema200_atr_max"]) if row["abs_close_ema200_atr_max"] else None,
                    float(row["tp_units"]) if row["tp_units"] else None,
                    float(row["sl_units"]) if row["sl_units"] else None,
                )
                pf = float(row["profit_factor"]) if str(row["profit_factor"]).lower() != "inf" else math.inf
                trades = int(float(row["trades"])) if row["trades"] else 0
            except Exception:  # noqa: BLE001
                continue
            rows_by_symbol.setdefault(symbol, []).append((pf, trades, signature))

    allowed: set[tuple[Any, ...]] = set()
    for entries in rows_by_symbol.values():
        ranked = sorted(entries, key=lambda item: (item[0], item[1]), reverse=True)
        unique: list[tuple[Any, ...]] = []
        seen: set[tuple[Any, ...]] = set()
        for _pf, _trades, signature in ranked:
            if signature in seen:
                continue
            seen.add(signature)
            unique.append(signature)
            if len(unique) >= top_per_symbol:
                break
        allowed.update(unique)
    return allowed


def candidate_from_source(path: Path, asset_by_symbol: dict[str, runner.AssetConfig]) -> Candidate:
    family = path.name
    phase = SUPPORTED_FAMILIES.get(family)
    if phase is None:
        raise ValueError(f"Unsupported strategy family '{family}' for current backtest engine")

    source_code = read_text(path)
    parameter_name, params = extract_parameter_block(source_code)
    symbol = str(params.get("targetSymbol", "")).strip().upper()
    if not symbol:
        raise ValueError("Missing targetSymbol in strategy source")

    asset = asset_by_symbol.get(symbol)
    if asset is None:
        raise ValueError(f"Unsupported symbol '{symbol}' in strategy source")

    variant_id = str(params.get("variantId", parameter_name)).strip()
    if not variant_id:
        raise ValueError("Missing variantId after normalization")

    return Candidate(
        family=family,
        phase=phase,
        asset_key=asset.key,
        symbol=asset.symbol,
        market=asset.market,
        parameter_set_name=parameter_name,
        variant_id=variant_id,
        signal_atr_mult=float(params["signalAtrMult"]) if "signalAtrMult" in params else None,
        recent_signal_lookback=int(params["recentSignalLookback"]) if "recentSignalLookback" in params else None,
        abs_close_ema200_atr_max=float(params["absCloseEma200AtrMax"]) if "absCloseEma200AtrMax" in params else None,
        trade_rsi_min=float(params["tradeRsiMin"]) if "tradeRsiMin" in params else None,
        trade_rsi_max=float(params["tradeRsiMax"]) if "tradeRsiMax" in params else None,
        ict_risk_reward=float(params["ictRiskReward"]) if "ictRiskReward" in params else None,
        tp_units=float(params["tpUnits"]) if "tpUnits" in params else None,
        sl_units=float(params["slUnits"]) if "slUnits" in params else None,
        one_trade_per_day=bool(params.get("oneTradePerDay", False)),
        cost_units=float(params.get("costUnits", 0.0)),
        invert_signal=bool(params.get("invertSignal", False)),
        source_folders=[path.parent.name],
        source_paths=[str(path.parent)],
        source_file_name=path.name,
        source_code=source_code,
        raw_params=params,
    )


def scan_candidates(
    input_dir: Path,
    asset_by_symbol: dict[str, runner.AssetConfig],
    allowed_momentum_signatures: set[tuple[Any, ...]],
) -> tuple[list[Candidate], list[dict[str, str]], list[dict[str, str]]]:
    deduped: dict[tuple[Any, ...], Candidate] = {}
    unsupported: list[dict[str, str]] = []
    prescreen_skipped: list[dict[str, str]] = []

    for strategy_dir in sorted(path for path in input_dir.iterdir() if path.is_dir() and path.name != "strategy-results"):
        ts_files = sorted(strategy_dir.glob("*.ts"))
        if not ts_files:
            unsupported.append(
                {
                    "folder": strategy_dir.name,
                    "path": str(strategy_dir),
                    "reason": "Missing TypeScript strategy file",
                }
            )
            continue

        strategy_file = ts_files[0]
        try:
            candidate = candidate_from_source(strategy_file, asset_by_symbol)
        except Exception as exc:  # noqa: BLE001
            unsupported.append(
                {
                    "folder": strategy_dir.name,
                    "path": str(strategy_dir),
                    "reason": str(exc),
                }
            )
            continue

        if candidate.phase == "momentum" and allowed_momentum_signatures:
            signature = momentum_signature(
                candidate.symbol,
                candidate.signal_atr_mult,
                candidate.recent_signal_lookback,
                candidate.abs_close_ema200_atr_max,
                candidate.tp_units,
                candidate.sl_units,
            )
            if signature not in allowed_momentum_signatures:
                prescreen_skipped.append(
                    {
                        "folder": strategy_dir.name,
                        "path": str(strategy_dir),
                        "reason": "Skipped by momentum historical pre-screen",
                    }
                )
                continue

        signature = candidate.signature()
        existing = deduped.get(signature)
        if existing is None:
            deduped[signature] = candidate
            continue

        existing.source_folders.append(strategy_dir.name)
        existing.source_paths.append(str(strategy_dir))
        if strategy_dir.name < existing.source_folders[0]:
            existing.source_code = candidate.source_code
            existing.source_file_name = candidate.source_file_name
            existing.raw_params = candidate.raw_params

    return list(deduped.values()), unsupported, prescreen_skipped


def load_data_for_asset(asset: runner.AssetConfig, cache: dict[str, runner.EnrichedData]) -> runner.EnrichedData:
    existing = cache.get(asset.key)
    if existing is not None:
        return existing

    candle_path = runner.DATA_ROOT / "15m" / asset.data_file
    if not candle_path.exists():
        raise FileNotFoundError(f"Missing 15m candle file for {asset.key}: {candle_path}")

    frame = runner.load_candle_csv(candle_path)
    enriched = runner.build_enriched_data(frame, asset)
    cache[asset.key] = enriched
    return enriched


def build_runtime_strategy(candidate: Candidate, strategy_id: str) -> runner.BacktestStrategy:
    return runner.BacktestStrategy(
        id=strategy_id,
        label=label_for(candidate),
        folder=strategy_id,
        asset_key=candidate.asset_key,
        phase=candidate.phase,
        variant_id=candidate.variant_id,
        source="simple_import_revalidated",
        signal_atr_mult=candidate.signal_atr_mult,
        recent_signal_lookback=candidate.recent_signal_lookback,
        abs_close_ema200_atr_max=candidate.abs_close_ema200_atr_max,
        trade_rsi_min=candidate.trade_rsi_min,
        trade_rsi_max=candidate.trade_rsi_max,
        ict_risk_reward=candidate.ict_risk_reward,
        tp_units=candidate.tp_units,
        sl_units=candidate.sl_units,
        one_trade_per_day=candidate.one_trade_per_day,
        cost_units=candidate.cost_units,
        invert_signal=candidate.invert_signal,
        metadata_path=None,
    )


def evaluate_candidates(
    candidates: list[Candidate],
    assets: dict[str, runner.AssetConfig],
    min_profit_factor: float,
    min_trades: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    winners: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    data_cache: dict[str, runner.EnrichedData] = {}

    for index, candidate in enumerate(candidates, start=1):
        if index == 1 or index % 25 == 0:
            print(f"Evaluating candidate {index}/{len(candidates)}: {candidate.symbol} {candidate.phase} {candidate.parameter_set_name}")
        strategy_id = strategy_id_for(candidate)
        asset = assets[candidate.asset_key]
        data = load_data_for_asset(asset, data_cache)
        strategy = build_runtime_strategy(candidate, strategy_id)
        strict_trades = runner.run_single_strategy(strategy, asset, data, strict_anti_cheat=True)
        strict_metrics = metrics_from_trades(strict_trades)

        if strict_metrics.profit_factor <= min_profit_factor or strict_metrics.trades <= min_trades:
            rejected.append(
                {
                    "strategyId": strategy_id,
                    "folder": candidate.source_folders[0],
                    "phase": candidate.phase,
                    "symbol": candidate.symbol,
                    "profitFactor": strict_metrics.profit_factor,
                    "trades": strict_metrics.trades,
                    "reason": "Did not pass profit factor / trades thresholds on strict rerun",
                }
            )
            continue

        fast_trades = runner.run_single_strategy(strategy, asset, data, strict_anti_cheat=False)
        drifted, reason = runner.anti_cheat_drift(fast_trades, strict_trades)
        if drifted:
            rejected.append(
                {
                    "strategyId": strategy_id,
                    "folder": candidate.source_folders[0],
                    "phase": candidate.phase,
                    "symbol": candidate.symbol,
                    "profitFactor": strict_metrics.profit_factor,
                    "trades": strict_metrics.trades,
                    "reason": reason or "Anti-cheat drift detected",
                }
            )
            continue

        winners.append(
            {
                "strategyId": strategy_id,
                "candidate": candidate,
                "metrics": strict_metrics,
                "strictTrades": strict_trades,
                "fastTrades": fast_trades,
                "antiCheatPassed": True,
                "ordinal": index,
            }
        )

    winners.sort(
        key=lambda item: (
            item["metrics"].profit_factor,
            item["metrics"].trades,
            item["metrics"].total_r,
        ),
        reverse=True,
    )
    return winners, rejected


def materialize_winners(winners: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cleanup_previous_imports(runner.STRATEGY_ROOT)
    output: list[dict[str, Any]] = []

    for item in winners:
        candidate: Candidate = item["candidate"]
        metrics: Metrics = item["metrics"]
        strategy_id = item["strategyId"]
        strategy_dir = runner.STRATEGY_ROOT / strategy_id
        metadata_path = strategy_dir / "parameters" / "backtest.json"
        context_path = strategy_dir / "parameters" / "import_context.json"

        payload = metadata_payload(candidate, strategy_id, metrics, candidate.source_folders[0])
        write_json(metadata_path, payload)
        write_json(
            context_path,
            {
                "strategyId": strategy_id,
                "family": candidate.family,
                "phase": candidate.phase,
                "symbol": candidate.symbol,
                "market": candidate.market,
                "parameterSetName": candidate.parameter_set_name,
                "sourceFolders": candidate.source_folders,
                "sourcePaths": candidate.source_paths,
                "sourceFileName": candidate.source_file_name,
                "sourceCode": candidate.source_code,
                "rawParams": candidate.raw_params,
                "dedupeSignature": list(candidate.signature()),
            },
        )

        output.append(
            {
                "strategyId": strategy_id,
                "strategyDir": strategy_dir,
                "metadataPath": metadata_path,
                "contextPath": context_path,
                "candidate": candidate,
                "metrics": metrics,
            }
        )

    return output


def verify_materialized(
    materialized: list[dict[str, Any]],
    assets: dict[str, runner.AssetConfig],
    min_profit_factor: float,
    min_trades: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    loaded = {strategy.id: strategy for strategy in runner.load_backtest_strategies() if strategy.id.startswith(IMPORT_PREFIX)}
    data_cache: dict[str, runner.EnrichedData] = {}
    verified: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for item in materialized:
        strategy_id = item["strategyId"]
        strategy = loaded.get(strategy_id)
        if strategy is None:
            failed.append({"strategyId": strategy_id, "reason": "Materialized strategy was not loadable by runner"})
            continue

        asset = assets[strategy.asset_key]
        data = load_data_for_asset(asset, data_cache)
        strict_trades = runner.run_single_strategy(strategy, asset, data, strict_anti_cheat=True)
        runner.write_strategy_backtest_csv(strategy.metadata_path.parent.parent / "backtest_trades.csv", strict_trades)
        strict_metrics = metrics_from_trades(strict_trades)

        fast_trades = runner.run_single_strategy(strategy, asset, data, strict_anti_cheat=False)
        drifted, reason = runner.anti_cheat_drift(fast_trades, strict_trades)
        passes_thresholds = strict_metrics.profit_factor > min_profit_factor and strict_metrics.trades > min_trades

        if drifted or not passes_thresholds:
            safe_rmtree(strategy.metadata_path.parent.parent, runner.STRATEGY_ROOT)
            failed.append(
                {
                    "strategyId": strategy_id,
                    "reason": reason or "Failed final threshold verification",
                    "profitFactor": strict_metrics.profit_factor,
                    "trades": strict_metrics.trades,
                }
            )
            continue

        verified.append(
            {
                "strategyId": strategy_id,
                "folder": strategy.folder,
                "label": strategy.label,
                "assetKey": strategy.asset_key,
                "phase": strategy.phase,
                "variantId": strategy.variant_id,
                "source": strategy.source,
                "metadataPath": str(strategy.metadata_path),
                "backtestPath": str(strategy.metadata_path.parent.parent / "backtest_trades.csv"),
                "antiCheatPassed": True,
                "metrics": strict_metrics,
                "candidate": item["candidate"],
            }
        )

    verified.sort(
        key=lambda item: (
            item["metrics"].profit_factor,
            item["metrics"].trades,
            item["metrics"].total_r,
        ),
        reverse=True,
    )
    return verified, failed


def metrics_payload(metrics: Metrics) -> dict[str, Any]:
    payload = asdict(metrics)
    if math.isinf(payload["profit_factor"]):
        payload["profit_factor"] = "Infinity"
    return payload


def write_winners_csv(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    header = [
        "strategy_id",
        "symbol",
        "asset_key",
        "phase",
        "family",
        "parameter_set_name",
        "profit_factor",
        "trades",
        "wins",
        "losses",
        "win_rate_pct",
        "total_r",
        "avg_r",
        "max_drawdown_r",
        "source_folder_count",
        "canonical_source_folder",
    ]
    lines = [",".join(header)]
    for record in records:
        candidate: Candidate = record["candidate"]
        metrics: Metrics = record["metrics"]
        values = [
            record["strategyId"],
            candidate.symbol,
            candidate.asset_key,
            candidate.phase,
            candidate.family,
            candidate.parameter_set_name,
            str(metrics.profit_factor),
            str(metrics.trades),
            str(metrics.wins),
            str(metrics.losses),
            f"{metrics.win_rate_pct:.6f}",
            f"{metrics.total_r:.6f}",
            f"{metrics.avg_r:.6f}",
            f"{metrics.max_drawdown_r:.6f}",
            str(len(candidate.source_folders)),
            candidate.source_folders[0],
        ]
        lines.append(",".join(value.replace(",", ";") for value in values))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    input_dir = Path(args.input_dir).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    assets = runner.load_asset_by_key()
    asset_by_symbol = build_symbol_map(assets)
    allowed_momentum_signatures = load_momentum_prescreen(input_dir, args.momentum_top_per_symbol)

    candidates, unsupported, prescreen_skipped = scan_candidates(input_dir, asset_by_symbol, allowed_momentum_signatures)
    winners, rejected = evaluate_candidates(candidates, assets, args.min_profit_factor, args.min_trades)
    materialized = materialize_winners(winners)
    verified, final_failures = verify_materialized(materialized, assets, args.min_profit_factor, args.min_trades)

    batch_id = datetime.now(timezone.utc).strftime("simple_import_%Y%m%dT%H%M%SZ")
    summary_records: list[dict[str, Any]] = []
    for record in verified:
        candidate: Candidate = record["candidate"]
        metrics: Metrics = record["metrics"]
        summary_records.append(
            {
                "strategyId": record["strategyId"],
                "label": record["label"],
                "folder": record["folder"],
                "assetKey": record["assetKey"],
                "symbol": candidate.symbol,
                "market": candidate.market,
                "phase": candidate.phase,
                "family": candidate.family,
                "parameterSetName": candidate.parameter_set_name,
                "variantId": record["variantId"],
                "source": record["source"],
                "sourceFolders": candidate.source_folders,
                "sourcePaths": candidate.source_paths,
                "sourceFolderCount": len(candidate.source_folders),
                "canonicalSourceFolder": candidate.source_folders[0],
                "sourceFileName": candidate.source_file_name,
                "sourceCode": candidate.source_code,
                "rawParams": candidate.raw_params,
                "metrics": metrics_payload(metrics),
                "antiCheatPassed": record["antiCheatPassed"],
                "metadataPath": record["metadataPath"],
                "backtestPath": record["backtestPath"],
            }
        )

    write_json(
        output_dir / SUMMARY_JSON,
        {
            "batchId": batch_id,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "inputDir": str(input_dir),
            "outputDir": str(output_dir),
            "thresholds": {
                "profitFactorGreaterThan": args.min_profit_factor,
                "tradesGreaterThan": args.min_trades,
            },
            "counts": {
                "scannedFolders": len([path for path in input_dir.iterdir() if path.is_dir() and path.name != "strategy-results"]),
                "supportedDedupedCandidates": len(candidates),
                "unsupportedFolders": len(unsupported),
                "prescreenSkippedFolders": len(prescreen_skipped),
                "prevalidatedWinners": len(winners),
                "finalValidatedStrategies": len(summary_records),
                "rejectedDuringRerun": len(rejected),
                "failedAfterMaterialization": len(final_failures),
            },
            "validatedStrategies": summary_records,
            "unsupportedFolders": unsupported,
            "prescreenSkippedFolders": prescreen_skipped,
            "rejectedDuringRerun": rejected,
            "failedAfterMaterialization": final_failures,
        },
    )
    write_winners_csv(output_dir / WINNERS_CSV, verified)

    print(
        f"Simple import scan complete: scanned={len([path for path in input_dir.iterdir() if path.is_dir() and path.name != 'strategy-results'])}, "
        f"supported_deduped={len(candidates)}, prescreen_skipped={len(prescreen_skipped)}, validated={len(summary_records)}"
    )
    print(f"Summary written to {output_dir / SUMMARY_JSON}")


if __name__ == "__main__":
    main()
