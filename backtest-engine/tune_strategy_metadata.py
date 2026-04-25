from __future__ import annotations

import csv
import json
import math
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import research_trader_strategies as research
import runner


RECENT_START_TS = int(datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp())
SUMMARY_PATH = runner.STRATEGY_ROOT / "tuning_summary.csv"
SESSION_NAMES = {"asia", "london", "pre_ny", "ny", "all"}

PHASE_VARIANT_GROUP = {
    "reddit_orb_breakout": "opening_drive",
    "reddit_orb_retest": "orb",
    "reddit_ema_pullback": "ma_pullback",
    "ict_turtle_soup": "turtle_soup",
    "ict_sweep_fvg": "ict_sweep",
}

CAMEL_CASE_KEYS = {
    "buffer_units": "bufferUnits",
    "reward_multiple": "rewardMultiple",
    "min_multiplier": "minMultiplier",
    "max_multiplier": "maxMultiplier",
    "min_confidence": "minConfidence",
    "max_confidence": "maxConfidence",
}


@dataclass(frozen=True)
class TradeMetrics:
    trades: int
    wins: int
    losses: int
    win_rate: float
    profit_factor: float
    total_r: float
    avg_r: float
    avg_win_r: float
    avg_loss_r: float
    max_drawdown_r: float
    tp_pct: float
    sl_pct: float
    timeout_pct: float


@dataclass(frozen=True)
class Evaluation:
    full: TradeMetrics
    recent: TradeMetrics
    trades: list[runner.BacktestTradeRow]


@dataclass(frozen=True)
class Candidate:
    strategy: runner.BacktestStrategy
    evaluation: Evaluation
    score: float


def limited_profit_factor(wins: float, losses: float) -> float:
    if losses <= 0:
        return math.inf if wins > 0 else 0.0
    return wins / losses


def compute_metrics(trades: Iterable[runner.BacktestTradeRow]) -> TradeMetrics:
    ordered = list(trades)
    wins = [trade.r_multiple for trade in ordered if trade.r_multiple > 0]
    losses = [trade.r_multiple for trade in ordered if trade.r_multiple < 0]
    gross_wins = sum(wins)
    gross_losses = sum(abs(loss) for loss in losses)
    total_r = sum(trade.r_multiple for trade in ordered)
    equity = 0.0
    peak = 0.0
    drawdown = 0.0
    tp = 0
    sl = 0
    timeout = 0
    for trade in ordered:
        equity += trade.r_multiple
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
        if trade.exit_reason.startswith("tp"):
            tp += 1
        elif trade.exit_reason.startswith("sl"):
            sl += 1
        elif trade.exit_reason in {"max_bars", "end"}:
            timeout += 1
    trade_count = len(ordered)
    return TradeMetrics(
        trades=trade_count,
        wins=len(wins),
        losses=len(losses),
        win_rate=(len(wins) / trade_count) if trade_count else 0.0,
        profit_factor=limited_profit_factor(gross_wins, gross_losses),
        total_r=total_r,
        avg_r=(total_r / trade_count) if trade_count else 0.0,
        avg_win_r=(gross_wins / len(wins)) if wins else 0.0,
        avg_loss_r=(sum(losses) / len(losses)) if losses else 0.0,
        max_drawdown_r=drawdown,
        tp_pct=(tp / trade_count) if trade_count else 0.0,
        sl_pct=(sl / trade_count) if trade_count else 0.0,
        timeout_pct=(timeout / trade_count) if trade_count else 0.0,
    )


def evaluate_trades(trades: list[runner.BacktestTradeRow]) -> Evaluation:
    recent = [trade for trade in trades if trade.entry_time >= RECENT_START_TS]
    return Evaluation(full=compute_metrics(trades), recent=compute_metrics(recent), trades=trades)


def metric_score(metrics: TradeMetrics, trade_weight: float) -> float:
    capped_pf = 0.0 if not math.isfinite(metrics.profit_factor) else min(metrics.profit_factor, 3.0)
    return (
        metrics.total_r
        + trade_weight * metrics.trades
        + capped_pf * 12.0
        + metrics.win_rate * 8.0
        - metrics.max_drawdown_r * 0.3
    )


def tune_mode(metrics: TradeMetrics) -> str:
    if metrics.profit_factor < 1.05 or metrics.total_r <= 0:
        return "repair"
    if metrics.trades < 60 and metrics.profit_factor >= 1.2 and metrics.total_r > 0:
        return "expand"
    if metrics.profit_factor < 1.2 or metrics.timeout_pct > 0.35:
        return "refine"
    return "keep"


def candidate_score(evaluation: Evaluation, mode: str, baseline_trades: int) -> float:
    full = evaluation.full
    recent = evaluation.recent
    if mode == "repair":
        return metric_score(full, 0.08) + 0.7 * metric_score(recent, 0.10)
    if mode == "expand":
        if full.profit_factor < 1.15 or full.total_r <= 0:
            return -math.inf
        return metric_score(full, 0.12) + 0.5 * metric_score(recent, 0.10) + max(0, full.trades - baseline_trades) * 0.18
    if mode == "refine":
        return metric_score(full, 0.10) + 0.8 * metric_score(recent, 0.12)
    return metric_score(full, 0.06)


def changed_enough(mode: str, baseline: Candidate, selected: Candidate) -> bool:
    if selected.score <= baseline.score:
        return False
    before = baseline.evaluation.full
    after = selected.evaluation.full
    if mode == "repair":
        return after.profit_factor >= before.profit_factor + 0.03 or after.total_r >= before.total_r + 2.0
    if mode == "expand":
        return after.trades >= before.trades + 5 and after.profit_factor >= 1.15 and after.total_r > 0
    if mode == "refine":
        return (
            after.total_r >= before.total_r + 1.0
            and after.profit_factor >= before.profit_factor - 0.02
            and after.max_drawdown_r <= before.max_drawdown_r + 6.0
        )
    return False


def format_number(value: float) -> str:
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if not math.isfinite(float(value)):
        return "0"
    rounded = round(float(value), 6)
    if math.isclose(rounded, round(rounded)):
        return str(int(round(rounded)))
    return f"{rounded:.6f}".rstrip("0").rstrip(".")


def parse_variant(variant_id: str) -> tuple[str, str | None, dict[str, str]]:
    parts = [part for part in variant_id.split("|") if part]
    if not parts:
        return "", None, {}
    head = parts[0]
    cursor = 1
    session: str | None = None
    if len(parts) > 1 and "=" not in parts[1] and parts[1] in SESSION_NAMES:
        session = parts[1]
        cursor = 2
    tokens: dict[str, str] = {}
    for part in parts[cursor:]:
        if "=" not in part:
            tokens[part] = "1"
            continue
        key, value = part.split("=", 1)
        tokens[key] = value
    return head, session, tokens


def build_variant(head: str, session: str | None, tokens: dict[str, str | int | float | None], key_order: list[str]) -> str:
    parts = [head]
    if session:
        parts.append(session)
    for key in key_order:
        if key not in tokens:
            continue
        value = tokens[key]
        if value is None:
            continue
        parts.append(f"{key}={format_number(value) if isinstance(value, (int, float, bool)) else value}")
    for key in sorted(key for key in tokens.keys() if key not in key_order):
        value = tokens[key]
        if value is None:
            continue
        parts.append(f"{key}={format_number(value) if isinstance(value, (int, float, bool)) else value}")
    return "|".join(parts)


def variant_with_one_trade(variant_id: str, enabled: bool) -> str:
    head, session, tokens = parse_variant(variant_id)
    tokens["one_trade"] = "1" if enabled else "0"
    return build_variant(head, session, tokens, ["range", "entry", "threshold", "rr", "sl_atr", "tp_atr", "adx_max", "adx_min", "rsi2", "trend", "max_bars", "one_trade"])


def variant_float(variant_id: str, key: str, fallback: float) -> float:
    raw_value = runner.variant_value(variant_id, key)
    if raw_value is None or raw_value == "none":
        return fallback
    try:
        return float(raw_value)
    except ValueError:
        return fallback


def variant_text(variant_id: str, key: str, fallback: str) -> str:
    raw_value = runner.variant_value(variant_id, key)
    return raw_value if raw_value is not None else fallback


def nice_units(value: float, floor_value: float = 1.0) -> float:
    rounded = max(floor_value, round(value))
    return float(int(rounded)) if rounded >= 1 else round(rounded, 2)


def metadata_path(strategy: runner.BacktestStrategy) -> Path:
    if strategy.metadata_path is None:
        raise FileNotFoundError(f"Missing metadata path for {strategy.id}")
    return strategy.metadata_path


def load_metadata(strategy: runner.BacktestStrategy) -> dict[str, object]:
    return json.loads(metadata_path(strategy).read_text(encoding="utf-8"))


def serialize_dataclass(value: object) -> dict[str, object] | None:
    if value is None:
        return None
    payload = {
        CAMEL_CASE_KEYS.get(key, key): field
        for key, field in asdict(value).items()
        if field is not None
    }
    return payload or None


def set_or_remove(payload: dict[str, object], key: str, value: object) -> None:
    if value is None:
        payload.pop(key, None)
        return
    payload[key] = value


def write_strategy_metadata(strategy: runner.BacktestStrategy, trades: list[runner.BacktestTradeRow]) -> None:
    payload = load_metadata(strategy)
    payload["variantId"] = strategy.variant_id
    payload["source"] = strategy.source
    set_or_remove(payload, "signalAtrMult", strategy.signal_atr_mult)
    set_or_remove(payload, "recentSignalLookback", strategy.recent_signal_lookback)
    set_or_remove(payload, "absCloseEma200AtrMax", strategy.abs_close_ema200_atr_max)
    set_or_remove(payload, "ictRiskReward", strategy.ict_risk_reward)
    set_or_remove(payload, "tpUnits", strategy.tp_units)
    set_or_remove(payload, "slUnits", strategy.sl_units)
    set_or_remove(payload, "sizeMultiplier", strategy.size_multiplier)
    set_or_remove(payload, "stopLossPolicy", serialize_dataclass(strategy.stop_loss_policy))
    set_or_remove(payload, "takeProfitPolicy", serialize_dataclass(strategy.take_profit_policy))
    set_or_remove(payload, "sizePolicy", serialize_dataclass(strategy.size_policy))
    set_or_remove(payload, "dynamicStopLossPolicy", serialize_dataclass(strategy.dynamic_stop_loss_policy))
    set_or_remove(payload, "dynamicTakeProfitPolicy", serialize_dataclass(strategy.dynamic_take_profit_policy))
    payload["oneTradePerDay"] = bool(strategy.one_trade_per_day)
    payload["costUnits"] = strategy.cost_units
    if strategy.invert_signal:
        payload["invertSignal"] = True
    else:
        payload.pop("invertSignal", None)
    metadata_path(strategy).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    runner.write_strategy_backtest_csv(metadata_path(strategy).parent.parent / "backtest_trades.csv", trades)


def evaluate_strategy(
    strategy: runner.BacktestStrategy,
    asset: runner.AssetConfig,
    data: runner.EnrichedData,
    mode: str,
    baseline_trades: int,
) -> Candidate:
    trades = runner.run_single_strategy(strategy, asset, data)
    evaluation = evaluate_trades(trades)
    return Candidate(strategy=strategy, evaluation=evaluation, score=candidate_score(evaluation, mode, baseline_trades))


def phase_variant_candidates(strategy: runner.BacktestStrategy, mode: str) -> list[runner.BacktestStrategy]:
    group = PHASE_VARIANT_GROUP.get(strategy.phase)
    if not group:
        return []
    variants = research.variant_ids(group)
    candidates: list[runner.BacktestStrategy] = []
    one_trade_values = [True, False] if mode in {"repair", "expand", "refine"} else [True]
    for variant in variants:
        for one_trade in one_trade_values:
            adjusted = variant_with_one_trade(variant, one_trade)
            candidates.append(replace(strategy, variant_id=adjusted, one_trade_per_day=False))
    return candidates


def momentum_candidates(strategy: runner.BacktestStrategy, mode: str) -> list[runner.BacktestStrategy]:
    current_signal = strategy.signal_atr_mult or 2.0
    current_lookback = strategy.recent_signal_lookback or 10
    current_abs = strategy.abs_close_ema200_atr_max or 1.0
    current_sl = strategy.sl_units or 100.0
    rr_choices = sorted({0.75, 1.0, max(0.75, min(1.25, (strategy.tp_units or current_sl) / current_sl))})
    signal_choices = sorted({max(1.5, current_signal - 0.5), current_signal, current_signal + 0.5})
    lookback_choices = sorted({max(4, current_lookback - 8), current_lookback, max(4, current_lookback - 16 if current_lookback > 16 else 8)})
    abs_choices = sorted({current_abs, 1.0, 1.5})
    sl_choices = sorted({nice_units(current_sl * factor) for factor in (0.35, 0.5, 0.75)})
    candidates: list[runner.BacktestStrategy] = []
    for signal_mult in signal_choices:
        for lookback in lookback_choices:
            for abs_limit in abs_choices:
                for sl_units in sl_choices:
                    for rr in rr_choices:
                        tp_units = nice_units(sl_units * rr)
                        one_trade_choices = (True, False) if mode == "repair" else (strategy.one_trade_per_day,)
                        for one_trade in one_trade_choices:
                            variant_id = build_variant(
                                "momentum_tuned",
                                None,
                                {
                                    "sig": signal_mult,
                                    "lookback": lookback,
                                    "abs": abs_limit,
                                    "tp": tp_units,
                                    "sl": sl_units,
                                    "one_trade": 1 if one_trade else 0,
                                },
                                ["sig", "lookback", "abs", "tp", "sl", "one_trade"],
                            )
                            candidates.append(
                                replace(
                                    strategy,
                                    variant_id=variant_id,
                                    signal_atr_mult=float(signal_mult),
                                    recent_signal_lookback=int(lookback),
                                    abs_close_ema200_atr_max=float(abs_limit),
                                    tp_units=float(tp_units),
                                    sl_units=float(sl_units),
                                    one_trade_per_day=one_trade,
                                )
                            )
    return candidates


def ny_sweep_candidates(strategy: runner.BacktestStrategy, mode: str) -> list[runner.BacktestStrategy]:
    model = variant_text(strategy.variant_id, "model", "logit")
    threshold = variant_float(strategy.variant_id, "min", 0.60)
    rr = variant_float(strategy.variant_id, "rr", 2.0)
    start = int(variant_float(strategy.variant_id, "start", 7 * 60))
    end = int(variant_float(strategy.variant_id, "end", 10 * 60))
    max_tests = int(variant_float(strategy.variant_id, "max_tests", 3))
    risk_min = variant_float(strategy.variant_id, "risk_min", 0.0)
    risk_max = variant_float(strategy.variant_id, "risk_max", 30.0)
    min_wick = variant_float(strategy.variant_id, "min_wick", 0.0)
    max_bars = int(variant_float(strategy.variant_id, "max_bars", 96))

    candidates: list[runner.BacktestStrategy] = []
    variant_specs = [
        (threshold, rr, end, risk_min, risk_max, max_bars, True),
        (threshold, rr, end, risk_min, risk_max, max_bars, False),
        (max(0.50, threshold - 0.02), rr, min(600, end + 30), max(0.0, risk_min - 2.0), risk_max + 5.0, max(96, max_bars), False),
        (max(0.48, threshold - 0.04), max(1.25, rr - 0.25), min(600, end + 30), max(0.0, risk_min - 2.0), risk_max + 5.0, 96, False),
        (max(0.50, threshold - 0.02), max(1.25, rr - 0.25), end, risk_min, risk_max, 96, False),
        (threshold, max(1.25, rr - 0.25), min(600, end + 30), risk_min, risk_max + 5.0, 144, False),
    ]
    if mode != "expand":
        variant_specs = variant_specs[:3]

    for threshold_value, rr_value, end_value, risk_min_value, risk_max_value, max_bars_value, one_trade in variant_specs:
        variant_id = build_variant(
            "ny_sweep_v4",
            None,
            {
                "model": model,
                "min": threshold_value,
                "start": start,
                "end": end_value,
                "max_tests": max_tests,
                "risk_min": risk_min_value,
                "risk_max": risk_max_value,
                "min_wick": min_wick,
                "rr": rr_value,
                "max_bars": max_bars_value,
                "one_trade": 1 if one_trade else 0,
            },
            ["model", "min", "start", "end", "max_tests", "risk_min", "risk_max", "min_wick", "rr", "max_bars", "one_trade"],
        )
        candidates.append(replace(strategy, variant_id=variant_id, one_trade_per_day=False))
    return candidates


def capitulation_candidates(strategy: runner.BacktestStrategy) -> list[runner.BacktestStrategy]:
    current_threshold = variant_float(strategy.variant_id, "threshold", 1.75)
    current_rr = variant_float(strategy.variant_id, "rr", 2.5)
    current_rsi2 = runner.variant_value(strategy.variant_id, "rsi2")
    current_trend = variant_text(strategy.variant_id, "trend", "long_only")
    current_max_bars = int(variant_float(strategy.variant_id, "max_bars", 24))
    thresholds = sorted({1.5, current_threshold})
    rrs = sorted({1.5, current_rr})
    rsi2_values = ["none", "10"] if current_rsi2 != "none" else ["none", "5"]
    trends = ["long_only", "both"] if current_trend != "both" else ["both", "long_only"]
    max_bars_choices = sorted({current_max_bars, 24})
    candidates: list[runner.BacktestStrategy] = []
    for threshold_value in thresholds:
        for rr_value in rrs:
            for rsi2_value in rsi2_values:
                for trend in trends:
                    for max_bars_value in max_bars_choices:
                        for one_trade in (True, False):
                            variant_id = build_variant(
                                "reddit_capitulation_reversion",
                                "ny",
                                {
                                    "rr": rr_value,
                                    "threshold": threshold_value,
                                    "rsi2": rsi2_value,
                                    "trend": trend,
                                    "max_bars": max_bars_value,
                                    "one_trade": 1 if one_trade else 0,
                                },
                                ["rr", "threshold", "rsi2", "trend", "max_bars", "one_trade"],
                            )
                            candidates.append(replace(strategy, variant_id=variant_id, one_trade_per_day=False))
    return candidates


def strategy_candidates(strategy: runner.BacktestStrategy, mode: str) -> list[runner.BacktestStrategy]:
    candidates: list[runner.BacktestStrategy] = [strategy]
    if strategy.phase == "momentum":
        candidates.extend(momentum_candidates(strategy, mode))
    elif strategy.phase == "ny_sweep_playbook":
        candidates.extend(ny_sweep_candidates(strategy, mode))
    elif strategy.phase == "reddit_capitulation_reversion":
        candidates.extend(capitulation_candidates(strategy))
    else:
        candidates.extend(phase_variant_candidates(strategy, mode))

    deduped: list[runner.BacktestStrategy] = []
    seen: set[tuple[object, ...]] = set()
    for candidate in candidates:
        signature = (
            candidate.variant_id,
            candidate.signal_atr_mult,
            candidate.recent_signal_lookback,
            candidate.abs_close_ema200_atr_max,
            candidate.ict_risk_reward,
            candidate.tp_units,
            candidate.sl_units,
            candidate.one_trade_per_day,
        )
        if signature in seen:
            continue
        seen.add(signature)
        deduped.append(candidate)
    return deduped


def write_summary(rows: list[dict[str, object]]) -> None:
    SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    columns = [
        "strategy_id",
        "phase",
        "mode",
        "changed",
        "before_trades",
        "after_trades",
        "before_pf",
        "after_pf",
        "before_total_r",
        "after_total_r",
        "before_recent_pf",
        "after_recent_pf",
        "before_recent_total_r",
        "after_recent_total_r",
        "before_variant_id",
        "after_variant_id",
    ]
    with SUMMARY_PATH.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def main() -> None:
    assets = runner.load_asset_by_key()
    data_cache: dict[str, runner.EnrichedData] = {}
    summary_rows: list[dict[str, object]] = []
    strategies = runner.load_backtest_strategies()

    for strategy in strategies:
        asset = assets[strategy.asset_key]
        if asset.key not in data_cache:
            candle_path = runner.DATA_ROOT / "15m" / asset.data_file
            data_cache[asset.key] = runner.build_enriched_data(runner.load_candle_csv(candle_path), asset)
        data = data_cache[asset.key]

        baseline_eval = evaluate_strategy(strategy, asset, data, "keep", 0)
        mode = tune_mode(baseline_eval.evaluation.full)
        baseline = Candidate(
            strategy=baseline_eval.strategy,
            evaluation=baseline_eval.evaluation,
            score=candidate_score(baseline_eval.evaluation, mode, baseline_eval.evaluation.full.trades),
        )

        selected = baseline
        if mode != "keep":
            for candidate_strategy in strategy_candidates(strategy, mode):
                candidate = evaluate_strategy(candidate_strategy, asset, data, mode, baseline.evaluation.full.trades)
                if candidate.score > selected.score:
                    selected = candidate

        changed = mode != "keep" and selected.strategy != baseline.strategy and changed_enough(mode, baseline, selected)
        if changed:
            tuned_strategy = replace(selected.strategy, source="metadata_tuner_holdout_2026")
            write_strategy_metadata(tuned_strategy, selected.evaluation.trades)
            selected = replace(selected, strategy=tuned_strategy)
            print(
                f"TUNED {strategy.id}: PF {baseline.evaluation.full.profit_factor:.3f} -> {selected.evaluation.full.profit_factor:.3f}, "
                f"trades {baseline.evaluation.full.trades} -> {selected.evaluation.full.trades}, "
                f"total R {baseline.evaluation.full.total_r:.1f} -> {selected.evaluation.full.total_r:.1f}"
            )
        else:
            write_strategy_metadata(strategy, baseline.evaluation.trades)

        summary_rows.append(
            {
                "strategy_id": strategy.id,
                "phase": strategy.phase,
                "mode": mode,
                "changed": changed,
                "before_trades": baseline.evaluation.full.trades,
                "after_trades": selected.evaluation.full.trades if changed else baseline.evaluation.full.trades,
                "before_pf": f"{baseline.evaluation.full.profit_factor:.6f}",
                "after_pf": f"{(selected.evaluation.full.profit_factor if changed else baseline.evaluation.full.profit_factor):.6f}",
                "before_total_r": f"{baseline.evaluation.full.total_r:.6f}",
                "after_total_r": f"{(selected.evaluation.full.total_r if changed else baseline.evaluation.full.total_r):.6f}",
                "before_recent_pf": f"{baseline.evaluation.recent.profit_factor:.6f}",
                "after_recent_pf": f"{(selected.evaluation.recent.profit_factor if changed else baseline.evaluation.recent.profit_factor):.6f}",
                "before_recent_total_r": f"{baseline.evaluation.recent.total_r:.6f}",
                "after_recent_total_r": f"{(selected.evaluation.recent.total_r if changed else baseline.evaluation.recent.total_r):.6f}",
                "before_variant_id": baseline.strategy.variant_id,
                "after_variant_id": selected.strategy.variant_id if changed else baseline.strategy.variant_id,
            }
        )

    write_summary(summary_rows)
    print(f"Wrote tuning summary to {SUMMARY_PATH}")


if __name__ == "__main__":
    main()
