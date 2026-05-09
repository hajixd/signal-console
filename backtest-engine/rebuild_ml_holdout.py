from __future__ import annotations

import argparse
import csv
import json
import math
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from sklearn.neural_network import MLPClassifier

import runner
import tune_strategy_metadata as tuner


TRAINING_START_LABEL = "asset_start"
TRAINING_END_LABEL = "2021-12-31"
FORWARD_START_LABEL = "2022-01-01"
FORWARD_END_LABEL = "asset_latest"
REBUILD_SOURCE = "pre_2022_ml_holdout_rebuild_2026_05"


def compute_metrics(trades: Iterable[runner.BacktestTradeRow]) -> dict[str, float | int]:
    ordered = list(trades)
    wins = [trade.r_multiple for trade in ordered if trade.r_multiple > 0]
    losses = [trade.r_multiple for trade in ordered if trade.r_multiple < 0]
    gross_wins = sum(wins)
    gross_losses = abs(sum(losses))
    total_r = sum(trade.r_multiple for trade in ordered)
    equity = 0.0
    peak = 0.0
    max_drawdown = 0.0
    for trade in ordered:
        equity += trade.r_multiple
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, peak - equity)
    profit_factor = math.inf if gross_losses == 0 and gross_wins > 0 else gross_wins / gross_losses if gross_losses else 0.0
    return {
        "trades": len(ordered),
        "wins": len(wins),
        "losses": len(losses),
        "profit_factor": profit_factor,
        "total_r": total_r,
        "average_r": total_r / len(ordered) if ordered else 0.0,
        "max_drawdown_r": max_drawdown,
    }


def training_score(metrics: dict[str, float | int]) -> float:
    trades = int(metrics["trades"])
    if trades <= 0:
        return -1_000_000.0
    profit_factor = float(metrics["profit_factor"])
    capped_pf = min(profit_factor if math.isfinite(profit_factor) else 3.0, 3.0)
    sparse_penalty = max(0, 8 - trades) * 4.0
    return (
        float(metrics["total_r"])
        + capped_pf * 10.0
        + math.sqrt(trades) * 1.5
        - float(metrics["max_drawdown_r"]) * 0.35
        - sparse_penalty
    )


def finite_json_number(value: float | int) -> float | int:
    if isinstance(value, int):
        return value
    if not math.isfinite(value):
        return 999999.0
    rounded = round(float(value), 6)
    return int(rounded) if math.isclose(rounded, round(rounded)) else rounded


def metric_value(metrics: dict[str, float | int], key: str) -> float | int:
    return finite_json_number(metrics[key])


def feature_training_rows(
    strategy: runner.BacktestStrategy,
    asset: runner.AssetConfig,
    data: runner.EnrichedData,
) -> tuple[np.ndarray, np.ndarray, list[runner.BacktestTradeRow]]:
    base_strategy = replace(strategy, echo_model=None, size_policy=None)
    raw_trades = runner.run_single_strategy(
        base_strategy,
        asset,
        data,
        start_ts=0,
        end_ts=runner.BACKTEST_START_TS,
        strict_anti_cheat=False,
    )
    time_to_index = {int(timestamp): index for index, timestamp in enumerate(data.times)}
    features: list[tuple[float, ...]] = []
    labels: list[int] = []
    kept_trades: list[runner.BacktestTradeRow] = []
    for trade in raw_trades:
        signal_index = time_to_index.get(trade.signal_time)
        if signal_index is None:
            continue
        row = runner.echo_model_features(data, signal_index, trade.side)
        if row is None:
            continue
        features.append(row)
        labels.append(1 if trade.r_multiple > 0 else 0)
        kept_trades.append(trade)
    return np.asarray(features, dtype=float), np.asarray(labels, dtype=int), kept_trades


def filtered_training_score(raw_trades: list[runner.BacktestTradeRow], scores: np.ndarray, threshold: float) -> float:
    selected = [trade for trade, score in zip(raw_trades, scores, strict=True) if score >= threshold]
    metrics = compute_metrics(selected)
    trades = int(metrics["trades"])
    if trades < 5:
        return -1_000_000.0
    profit_factor = float(metrics["profit_factor"])
    capped_pf = min(profit_factor if math.isfinite(profit_factor) else 3.0, 3.0)
    return float(metrics["total_r"]) + capped_pf * 8.0 + trades * 0.12 - float(metrics["max_drawdown_r"]) * 0.4


def train_echo_model(
    strategy: runner.BacktestStrategy,
    asset: runner.AssetConfig,
    data: runner.EnrichedData,
) -> runner.EchoModel | None:
    if strategy.echo_model is None:
        return None

    features, labels, raw_trades = feature_training_rows(strategy, asset, data)
    if features.shape[0] < 10 or len(set(labels.tolist())) < 2:
        raise ValueError(f"{strategy.id}: not enough pre-2022 Echo training rows/classes")

    means = features.mean(axis=0)
    scales = features.std(axis=0)
    scales = np.where(scales <= 1e-9, 1.0, scales)
    normalized = (features - means) / scales

    best: tuple[float, float, MLPClassifier] | None = None
    for alpha in (0.0001, 0.01, 0.1, 0.25):
        for seed in (7, 20, 28, 42):
            classifier = MLPClassifier(
                hidden_layer_sizes=(6,),
                activation="tanh",
                solver="lbfgs",
                alpha=alpha,
                random_state=seed,
                max_iter=3000,
            )
            classifier.fit(normalized, labels)
            probabilities = classifier.predict_proba(normalized)[:, 1]
            for threshold in np.arange(0.45, 0.951, 0.01):
                score = filtered_training_score(raw_trades, probabilities, float(threshold))
                if best is None or score > best[0]:
                    best = (score, float(threshold), classifier)

    if best is None:
        raise ValueError(f"{strategy.id}: failed to fit a pre-2022 Echo model")

    _, threshold, classifier = best
    return runner.EchoModel(
        kind="neural",
        threshold=threshold,
        feature_names=runner.ECHO_MODEL_FEATURE_NAMES,
        feature_means=tuple(float(value) for value in means),
        feature_scales=tuple(float(value) for value in scales),
        hidden_weights=tuple(tuple(float(value) for value in row) for row in classifier.coefs_[0].T),
        hidden_bias=tuple(float(value) for value in classifier.intercepts_[0]),
        output_weights=tuple(float(value) for value in classifier.coefs_[1][:, 0]),
        output_bias=float(classifier.intercepts_[1][0]),
    )


def echo_model_payload(model: runner.EchoModel) -> dict[str, Any]:
    return {
        "kind": model.kind,
        "threshold": finite_json_number(model.threshold),
        "featureNames": list(model.feature_names),
        "featureMeans": [finite_json_number(value) for value in model.feature_means],
        "featureScales": [finite_json_number(value) for value in model.feature_scales],
        "hiddenWeights": [[finite_json_number(value) for value in row] for row in model.hidden_weights],
        "hiddenBias": [finite_json_number(value) for value in model.hidden_bias],
        "outputWeights": [finite_json_number(value) for value in model.output_weights],
        "outputBias": finite_json_number(model.output_bias),
    }


def update_size_policy_for_model(payload: dict[str, Any], model: runner.EchoModel) -> None:
    policy = payload.get("sizePolicy")
    if not isinstance(policy, dict) or policy.get("mode") != "confidence":
        return
    policy["minConfidence"] = finite_json_number(model.threshold)
    max_confidence = float(policy.get("maxConfidence", max(model.threshold + 0.1, 0.8)))
    policy["maxConfidence"] = finite_json_number(max(max_confidence, min(0.99, model.threshold + 0.1)))


def selection_method(strategy: runner.BacktestStrategy, retrained_echo: bool) -> str:
    if retrained_echo:
        return (
            "Echo neural gate retrained only on completed setup features before 2022-01-01; "
            "threshold selected on that pre-2022 training set; post-2022 backtest output regenerated without refitting."
        )
    model_name = runner.variant_value(strategy.variant_id, "model") or "deterministic"
    return (
        f"Deterministic lightweight {model_name} scorer/parameter set selected on candles before 2022-01-01; "
        "post-2022 backtest output regenerated without refitting."
    )


def research_summary(strategy: runner.BacktestStrategy, retrained_echo: bool) -> str:
    if retrained_echo:
        return (
            f"Pre-2022 rebuilt {strategy.label} Echo neural gate. Model weights and threshold were fit only on "
            "completed setup outcomes before 2022-01-01; post-2022 trades are forward output."
        )
    model_name = runner.variant_value(strategy.variant_id, "model") or "deterministic"
    return (
        f"Pre-2022 rebuilt {strategy.label} lightweight {model_name} configuration. The deterministic scorer/parameters "
        "were selected on history before 2022-01-01; post-2022 trades are forward output."
    )


def variant_with_threshold(variant_id: str, threshold: float) -> str:
    parts = []
    replaced = False
    for part in variant_id.split("|"):
        if part.startswith("min="):
            parts.append(f"min={finite_json_number(threshold)}")
            replaced = True
        else:
            parts.append(part)
    return "|".join(parts) if replaced else variant_id


def update_payload_stats(
    payload: dict[str, Any],
    strategy: runner.BacktestStrategy,
    train_metrics: dict[str, float | int],
    forward_metrics: dict[str, float | int],
    retrained_echo: bool,
    strict: bool,
) -> None:
    payload["source"] = REBUILD_SOURCE
    payload["researchSummary"] = research_summary(strategy, retrained_echo)
    payload["trainingWindow"] = {"start": TRAINING_START_LABEL, "end": TRAINING_END_LABEL}
    payload["forwardWindow"] = {"start": FORWARD_START_LABEL, "end": FORWARD_END_LABEL}
    payload["selectionMethod"] = selection_method(strategy, retrained_echo)
    payload["selectedTrainingProfitFactor"] = metric_value(train_metrics, "profit_factor")
    payload["selectedTrainingTrades"] = metric_value(train_metrics, "trades")
    payload["selectedForwardProfitFactor"] = metric_value(forward_metrics, "profit_factor")
    payload["selectedForwardTrades"] = metric_value(forward_metrics, "trades")
    payload["forwardWins"] = metric_value(forward_metrics, "wins")
    payload["forwardLosses"] = metric_value(forward_metrics, "losses")
    payload["forwardTotalR"] = metric_value(forward_metrics, "total_r")
    payload["forwardAverageR"] = metric_value(forward_metrics, "average_r")
    payload["forwardMaxDrawdownR"] = metric_value(forward_metrics, "max_drawdown_r")
    mode = "strict anti-cheat" if strict else "fast deterministic"
    payload["verificationSummary"] = (
        f"Rebuilt ML holdout with {mode} engine mode. Training/certification uses only data before "
        f"{FORWARD_START_LABEL}; generated CSV and displayed stats use trades from {FORWARD_START_LABEL} onward. "
        f"Training: {int(train_metrics['trades'])} trades, PF {float(train_metrics['profit_factor']):.2f}, "
        f"{float(train_metrics['total_r']):.2f}R. Forward: {int(forward_metrics['trades'])} trades, "
        f"PF {float(forward_metrics['profit_factor']):.2f}, {float(forward_metrics['total_r']):.2f}R."
    )


def set_or_remove(payload: dict[str, Any], key: str, value: object) -> None:
    if value is None:
        payload.pop(key, None)
        return
    payload[key] = value


def serialize_policy(value: object) -> dict[str, Any] | None:
    if value is None:
        return None
    payload: dict[str, Any] = {}
    for key, field in vars(value).items():
        if field is None:
            continue
        camel_key = tuner.CAMEL_CASE_KEYS.get(key, key)
        payload[camel_key] = field
    return payload or None


def apply_strategy_fields_to_payload(payload: dict[str, Any], strategy: runner.BacktestStrategy) -> None:
    payload["variantId"] = strategy.variant_id
    set_or_remove(payload, "signalAtrMult", strategy.signal_atr_mult)
    set_or_remove(payload, "recentSignalLookback", strategy.recent_signal_lookback)
    set_or_remove(payload, "absCloseEma200AtrMax", strategy.abs_close_ema200_atr_max)
    set_or_remove(payload, "tradeRsiMin", strategy.trade_rsi_min)
    set_or_remove(payload, "tradeRsiMax", strategy.trade_rsi_max)
    set_or_remove(payload, "ictRiskReward", strategy.ict_risk_reward)
    set_or_remove(payload, "tpUnits", strategy.tp_units)
    set_or_remove(payload, "slUnits", strategy.sl_units)
    set_or_remove(payload, "sizeMultiplier", strategy.size_multiplier)
    set_or_remove(payload, "stopLossPolicy", serialize_policy(strategy.stop_loss_policy))
    set_or_remove(payload, "takeProfitPolicy", serialize_policy(strategy.take_profit_policy))
    set_or_remove(payload, "sizePolicy", serialize_policy(strategy.size_policy))
    set_or_remove(payload, "dynamicStopLossPolicy", serialize_policy(strategy.dynamic_stop_loss_policy))
    set_or_remove(payload, "dynamicTakeProfitPolicy", serialize_policy(strategy.dynamic_take_profit_policy))
    payload["oneTradePerDay"] = bool(strategy.one_trade_per_day)
    payload["costUnits"] = strategy.cost_units
    if strategy.invert_signal:
        payload["invertSignal"] = True
    else:
        payload.pop("invertSignal", None)


def candidate_signature(strategy: runner.BacktestStrategy) -> tuple[object, ...]:
    return (
        strategy.variant_id,
        strategy.signal_atr_mult,
        strategy.recent_signal_lookback,
        strategy.abs_close_ema200_atr_max,
        strategy.trade_rsi_min,
        strategy.trade_rsi_max,
        strategy.ict_risk_reward,
        strategy.tp_units,
        strategy.sl_units,
        strategy.one_trade_per_day,
    )


def lightweight_candidate_strategies(strategy: runner.BacktestStrategy) -> list[runner.BacktestStrategy]:
    candidates: list[runner.BacktestStrategy] = []
    for mode in ("repair", "expand", "refine"):
        candidates.extend(tuner.strategy_candidates(strategy, mode))
    deduped: list[runner.BacktestStrategy] = []
    seen: set[tuple[object, ...]] = set()
    for candidate in candidates:
        signature = candidate_signature(candidate)
        if signature in seen:
            continue
        seen.add(signature)
        deduped.append(candidate)
    return deduped or [strategy]


def select_pre_2022_lightweight_strategy(
    strategy: runner.BacktestStrategy,
    asset: runner.AssetConfig,
    data: runner.EnrichedData,
) -> runner.BacktestStrategy:
    best_strategy = strategy
    best_score = -1_000_000.0
    for candidate in lightweight_candidate_strategies(strategy):
        train_trades = runner.run_single_strategy(
            candidate,
            asset,
            data,
            start_ts=0,
            end_ts=runner.BACKTEST_START_TS,
            strict_anti_cheat=False,
        )
        score = training_score(compute_metrics(train_trades))
        if score > best_score:
            best_score = score
            best_strategy = candidate
    return replace(best_strategy, source=REBUILD_SOURCE)


def rebuild_strategy(
    strategy: runner.BacktestStrategy,
    asset: runner.AssetConfig,
    data: runner.EnrichedData,
    strict: bool,
    write: bool,
) -> tuple[dict[str, float | int], dict[str, float | int]]:
    if strategy.metadata_path is None:
        raise FileNotFoundError(f"{strategy.id}: missing metadata path")

    payload = json.loads(strategy.metadata_path.read_text(encoding="utf-8"))
    retrained_echo = strategy.echo_model is not None
    if retrained_echo:
        model = train_echo_model(strategy, asset, data)
        if model is None:
            raise ValueError(f"{strategy.id}: expected an Echo model")
        variant_id = variant_with_threshold(strategy.variant_id, model.threshold)
        strategy = replace(strategy, echo_model=model, source=REBUILD_SOURCE, variant_id=variant_id)
        payload["variantId"] = variant_id
        payload["echoModel"] = echo_model_payload(model)
    else:
        strategy = select_pre_2022_lightweight_strategy(strategy, asset, data)

    apply_strategy_fields_to_payload(payload, strategy)
    if retrained_echo and strategy.echo_model is not None:
        update_size_policy_for_model(payload, strategy.echo_model)

    train_trades = runner.run_single_strategy(
        strategy,
        asset,
        data,
        start_ts=0,
        end_ts=runner.BACKTEST_START_TS,
        strict_anti_cheat=strict,
    )
    forward_trades = runner.run_single_strategy(
        strategy,
        asset,
        data,
        start_ts=runner.BACKTEST_START_TS,
        strict_anti_cheat=strict,
    )
    train_metrics = compute_metrics(train_trades)
    forward_metrics = compute_metrics(forward_trades)
    update_payload_stats(payload, strategy, train_metrics, forward_metrics, retrained_echo, strict)

    if write:
        strategy.metadata_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        runner.write_strategy_backtest_csv(strategy.metadata_path.parent.parent / "backtest_trades.csv", forward_trades)

    return train_metrics, forward_metrics


def selected_machine_learning_strategies(filters: list[str] | None) -> list[runner.BacktestStrategy]:
    strategies = [
        strategy
        for strategy in runner.selected_backtest_strategies(filters)
        if strategy.metadata_path is not None and strategy.metadata_path.parts[-2:] == ("machine_learning", "selection.json")
    ]
    if not strategies:
        raise ValueError("No machine_learning strategies matched the requested filters")
    return strategies


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild ML strategy holdouts with pre-2022 training and post-2022 output.")
    parser.add_argument("--strategy", action="append", help="Optional strategy id/folder/asset filter. Repeat to include multiple.")
    parser.add_argument("--strict", action="store_true", help="Use strict anti-cheat window slicing. Much slower on full history.")
    parser.add_argument("--dry-run", action="store_true", help="Compute without writing metadata or CSV files.")
    args = parser.parse_args()

    assets = runner.load_asset_by_key()
    data_cache: dict[tuple[str, str], runner.EnrichedData] = {}
    strategies = selected_machine_learning_strategies(args.strategy)
    print(f"Rebuilding {len(strategies)} ML strategy holdout(s)")
    print(f"Mode: {'strict anti-cheat' if args.strict else 'fast deterministic'}")
    print(f"Write output: {'no' if args.dry_run else 'yes'}")

    for strategy in strategies:
        asset = assets[strategy.asset_key]
        timeframe = runner.strategy_timeframe(strategy)
        cache_key = (asset.key, timeframe)
        if cache_key not in data_cache:
            candle_path = runner.DATA_ROOT / timeframe / asset.data_file
            frame = runner.load_candle_csv(candle_path)
            data_cache[cache_key] = runner.build_enriched_data(frame, asset)
        train_metrics, forward_metrics = rebuild_strategy(
            strategy,
            asset,
            data_cache[cache_key],
            strict=bool(args.strict),
            write=not bool(args.dry_run),
        )
        print(
            f"{strategy.id}: train {int(train_metrics['trades'])} trades PF {float(train_metrics['profit_factor']):.2f}; "
            f"forward {int(forward_metrics['trades'])} trades PF {float(forward_metrics['profit_factor']):.2f}"
        )


if __name__ == "__main__":
    main()
