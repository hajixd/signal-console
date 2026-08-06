from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import sys
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Callable

import numpy as np
from sklearn.base import clone
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backtest-engine"))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

import runner  # noqa: E402
import research_competition_session_candidates as session  # noqa: E402
import research_nested_walk_forward_strategies as nested  # noqa: E402
import search_higher_timeframe_strategies as statistics  # noqa: E402

try:
    from xgboost import XGBClassifier
except Exception:  # pragma: no cover - optional local dependency
    XGBClassifier = None  # type: ignore[assignment]


REPORT_ROOT = PROJECT_ROOT / "Research" / "reports"
SOURCE = "nested_ml_session_sizing_2026_08"
ROUND_TRIP_COST_TICKS = 2.0
MIN_MULTIPLIER = 0.5
MAX_MULTIPLIER = 1.5
LOW_CONFIDENCE = 0.30
HIGH_CONFIDENCE = 0.70
SOURCE_URLS = [
    "https://www.kaggle.com/code/mortezataleblou/lightgbm-model-for-financial-predictions",
    "https://www.kaggle.com/datasets/kanchana1990/algorithmic-trading-macro-stress-and-asset-regimes",
    "https://www.reddit.com/r/algotrading/comments/1bg6xx5/where_are_we_with_ml_in_2024/",
    "https://www.reddit.com/r/algotrading/comments/1siny35/where_does_ml_fit_in_algorithmic_trading/",
    "https://www.reddit.com/r/quant/comments/1kc9nch/offpiste_quant_post_regime_detection_momentum_or/",
]


@dataclass(frozen=True)
class ModelSpec:
    name: str
    factory: Callable[[], Any]


@dataclass(frozen=True)
class Candidate:
    asset: runner.AssetConfig
    spec: session.VariantSpec
    model_name: str
    train_oof: statistics.Metrics
    validation: statistics.Metrics
    holdout: statistics.Metrics
    overall: statistics.Metrics
    validation_baseline_pf: float
    holdout_baseline_pf: float
    validation_auc: float
    validation_brier: float
    holdout_auc: float
    holdout_brier: float
    holdout_p_value: float
    holdout_q_value: float
    minimum_regime_pf: float
    multiplier_mean: float
    entry_parity: float
    trades: list[runner.BacktestTradeRow]
    score: float
    training_trials: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Nested ML research for bounded confidence sizing of session strategies.")
    parser.add_argument("--market", choices=["forex", "futures"], required=True)
    parser.add_argument("--asset", action="append", help="Asset key or symbol; repeat or comma-separate.")
    parser.add_argument("--risk-reward", default="2,3")
    parser.add_argument("--max-base-strategies-per-asset", type=int, default=6)
    parser.add_argument("--max-holdout-tests-per-asset", type=int, default=4)
    parser.add_argument("--min-train-trades", type=int, default=160)
    parser.add_argument("--min-validation-trades", type=int, default=80)
    parser.add_argument("--min-holdout-trades", type=int, default=100)
    parser.add_argument("--false-discovery-rate", type=float, default=0.10)
    parser.add_argument("--cost-ticks", type=float, default=ROUND_TRIP_COST_TICKS)
    return parser.parse_args()


def requested_assets(values: list[str] | None) -> set[str]:
    return {
        item.strip().lower()
        for value in values or []
        for item in value.split(",")
        if item.strip()
    }


def selected_assets(args: argparse.Namespace) -> list[runner.AssetConfig]:
    requested = requested_assets(args.asset)
    return [
        asset
        for asset in runner.load_assets()
        if asset.market == args.market
        and (not requested or asset.key.lower() in requested or asset.symbol.lower() in requested)
        and (runner.DATA_ROOT / "15m" / asset.data_file).exists()
        and (runner.DATA_ROOT / "1m" / asset.data_file).exists()
    ]


def entry_parity(
    fast: list[runner.BacktestTradeRow], strict: list[runner.BacktestTradeRow], tolerance_seconds: int = 15 * 60
) -> float:
    if not fast:
        return 1.0 if not strict else 0.0
    strict_entries = [(trade.side, trade.entry_time) for trade in strict]
    matched = sum(
        1
        for trade in fast
        if any(side == trade.side and abs(entry_time - trade.entry_time) <= tolerance_seconds for side, entry_time in strict_entries)
    )
    return matched / len(fast)


def model_specs() -> list[ModelSpec]:
    output = [
        ModelSpec(
            "logistic_l2_c025",
            lambda: make_pipeline(StandardScaler(), LogisticRegression(C=0.25, max_iter=2000, class_weight="balanced")),
        ),
        ModelSpec(
            "logistic_l2_c1",
            lambda: make_pipeline(StandardScaler(), LogisticRegression(C=1.0, max_iter=2000, class_weight="balanced")),
        ),
        ModelSpec(
            "extra_trees_depth3",
            lambda: ExtraTreesClassifier(
                n_estimators=120, max_depth=3, min_samples_leaf=20, max_features=0.75,
                class_weight="balanced", random_state=20260806, n_jobs=-1,
            ),
        ),
        ModelSpec(
            "extra_trees_depth5",
            lambda: ExtraTreesClassifier(
                n_estimators=160, max_depth=5, min_samples_leaf=20, max_features=0.75,
                class_weight="balanced", random_state=20260807, n_jobs=-1,
            ),
        ),
        ModelSpec(
            "hist_gradient_depth2",
            lambda: HistGradientBoostingClassifier(
                learning_rate=0.05, max_iter=120, max_depth=2, min_samples_leaf=20,
                l2_regularization=1.0, random_state=20260806,
            ),
        ),
        ModelSpec(
            "hist_gradient_depth3",
            lambda: HistGradientBoostingClassifier(
                learning_rate=0.04, max_iter=140, max_depth=3, min_samples_leaf=24,
                l2_regularization=2.0, random_state=20260807,
            ),
        ),
    ]
    if XGBClassifier is not None:
        output.extend([
            ModelSpec(
                "xgboost_depth2",
                lambda: XGBClassifier(
                    n_estimators=100, max_depth=2, learning_rate=0.04, min_child_weight=12,
                    subsample=0.8, colsample_bytree=0.8, reg_alpha=0.5, reg_lambda=2.0,
                    objective="binary:logistic", eval_metric="logloss", random_state=20260806, n_jobs=2,
                ),
            ),
            ModelSpec(
                "xgboost_depth3",
                lambda: XGBClassifier(
                    n_estimators=120, max_depth=3, learning_rate=0.03, min_child_weight=16,
                    subsample=0.75, colsample_bytree=0.75, reg_alpha=1.0, reg_lambda=3.0,
                    objective="binary:logistic", eval_metric="logloss", random_state=20260807, n_jobs=2,
                ),
            ),
        ])
    return output


def base_specs(raw_rr: str) -> list[session.VariantSpec]:
    risk_rewards = session.parse_risk_rewards([raw_rr])
    output: list[session.VariantSpec] = []
    for spec in session.variant_specs("broad", risk_rewards):
        params = dict(spec.params)
        keys = set(params)
        if keys.intersection({"signal_weekday", "signal_weekday_side", "signal_month", "side_filter"}):
            continue
        if params.get("min_signal_atr", "0") not in {"0", "0.35"}:
            continue
        if params.get("min_gap_atr", "0") not in {"0", "0.25"}:
            continue
        output.append(spec)
    return output


def strategy_for(asset: runner.AssetConfig, spec: session.VariantSpec, cost_ticks: float) -> runner.BacktestStrategy:
    return replace(
        session.build_strategy(asset, spec),
        source=SOURCE,
        cost_units=max(0.0, cost_ticks),
        one_trade_per_day=False,
    )


def feature_rows(
    trades: list[runner.BacktestTradeRow], data: runner.EnrichedData
) -> tuple[np.ndarray, np.ndarray, list[runner.BacktestTradeRow], np.ndarray]:
    time_index = {int(timestamp): index for index, timestamp in enumerate(data.times)}
    features: list[tuple[float, ...]] = []
    labels: list[int] = []
    kept: list[runner.BacktestTradeRow] = []
    volatility: list[float] = []
    for trade in sorted(trades, key=lambda item: (item.entry_time, item.exit_time)):
        index = time_index.get(int(trade.signal_time))
        if index is None:
            continue
        row = runner.echo_model_features(data, index, trade.side)
        if row is None:
            continue
        close = abs(float(data.close[index]))
        atr = runner.safe_feature(data.atr14[index])
        features.append(row)
        labels.append(1 if trade.r_multiple > 0 else 0)
        kept.append(trade)
        volatility.append(atr / close if close > 0 else 0.0)
    return np.asarray(features, dtype=float), np.asarray(labels, dtype=int), kept, np.asarray(volatility, dtype=float)


def probability(model: Any, features: np.ndarray) -> np.ndarray:
    values = np.asarray(model.predict_proba(features), dtype=float)
    return values[:, 1]


def multipliers(probabilities: np.ndarray) -> np.ndarray:
    clipped = np.clip(probabilities, LOW_CONFIDENCE, HIGH_CONFIDENCE)
    pct = (clipped - LOW_CONFIDENCE) / (HIGH_CONFIDENCE - LOW_CONFIDENCE)
    return np.round(MIN_MULTIPLIER + (MAX_MULTIPLIER - MIN_MULTIPLIER) * pct, 2)


def sized_trades(
    trades: list[runner.BacktestTradeRow], probabilities: np.ndarray, effective_r: bool
) -> list[runner.BacktestTradeRow]:
    scales = multipliers(probabilities)
    return [
        replace(
            trade,
            size_multiplier=float(scale),
            r_multiple=float(trade.r_multiple) * float(scale) if effective_r else float(trade.r_multiple),
        )
        for trade, scale in zip(trades, scales, strict=True)
    ]


def metric_seed(asset: runner.AssetConfig, spec: session.VariantSpec, model: str, suffix: str) -> int:
    return int(hashlib.sha1(f"{asset.key}|{spec.variant_id}|{model}|{suffix}".encode()).hexdigest()[:8], 16)


def metrics(
    trades: list[runner.BacktestTradeRow], asset: runner.AssetConfig, spec: session.VariantSpec, model: str, suffix: str
) -> statistics.Metrics:
    return statistics.metrics_for(trades, metric_seed(asset, spec, model, suffix), min_split_trades=8)


def baseline_pf(trades: list[runner.BacktestTradeRow]) -> float:
    return statistics.profit_factor([float(trade.r_multiple) for trade in trades])


def safe_auc(labels: np.ndarray, probabilities: np.ndarray) -> float:
    return float(roc_auc_score(labels, probabilities)) if len(set(labels.tolist())) > 1 else 0.5


def safe_brier(labels: np.ndarray, probabilities: np.ndarray) -> float:
    return float(brier_score_loss(labels, probabilities)) if labels.shape[0] else 1.0


def oof_probabilities(model: Any, features: np.ndarray, labels: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    splits = min(5, max(3, features.shape[0] // 80))
    splitter = TimeSeriesSplit(n_splits=splits, gap=5)
    output = np.full(features.shape[0], np.nan, dtype=float)
    for train_indexes, test_indexes in splitter.split(features):
        if len(set(labels[train_indexes].tolist())) < 2:
            continue
        fitted = clone(model)
        fitted.fit(features[train_indexes], labels[train_indexes])
        output[test_indexes] = probability(fitted, features[test_indexes])
    mask = np.isfinite(output)
    return output[mask], mask


def minimum_regime_pf(
    trades: list[runner.BacktestTradeRow], volatility: np.ndarray, probabilities: np.ndarray
) -> float:
    if len(trades) < 30 or volatility.shape[0] != len(trades):
        return 0.0
    cuts = np.quantile(volatility, [1 / 3, 2 / 3])
    scales = multipliers(probabilities)
    pfs: list[float] = []
    for low, high in ((-math.inf, cuts[0]), (cuts[0], cuts[1]), (cuts[1], math.inf)):
        values = [
            float(trade.r_multiple) * float(scale)
            for trade, scale, regime in zip(trades, scales, volatility, strict=True)
            if low < regime <= high
        ]
        if len(values) >= 10:
            pfs.append(statistics.profit_factor(values))
    return min(pfs, default=0.0)


def research_asset(
    asset: runner.AssetConfig, specs: list[session.VariantSpec], models: list[ModelSpec], args: argparse.Namespace
) -> list[Candidate]:
    plan = nested.window_plan(args.market)
    data = session.load_asset_data(asset)
    raw_ranked: list[tuple[float, session.VariantSpec, runner.BacktestStrategy, list[runner.BacktestTradeRow]]] = []
    for spec in specs:
        strategy = strategy_for(asset, spec, args.cost_ticks)
        raw = session.run_competition_candidate(strategy, asset, data, plan.train_start, plan.train_end, strict=False)
        if len(raw) < args.min_train_trades:
            continue
        pf = baseline_pf(raw)
        if pf < 0.75:
            continue
        raw_ranked.append((min(pf, 3.0) * math.log1p(len(raw)), spec, strategy, raw))
    raw_ranked.sort(key=lambda item: item[0], reverse=True)
    raw_ranked = raw_ranked[: args.max_base_strategies_per_asset]
    print(f"    ranked base signals={len(raw_ranked)}", flush=True)

    validation_candidates: list[tuple[float, session.VariantSpec, Any, str, statistics.Metrics, int]] = []
    validation_diagnostics: list[tuple[float, str, str, float, float, int, float, float]] = []
    training_trials = 0
    for _raw_score, spec, _strategy, train_raw in raw_ranked:
        features, labels, kept, _volatility = feature_rows(train_raw, data)
        if features.shape[0] < args.min_train_trades or len(set(labels.tolist())) < 2:
            continue
        for model_spec in models:
            training_trials += 1
            model = model_spec.factory()
            try:
                oof, mask = oof_probabilities(model, features, labels)
            except Exception:
                continue
            if oof.shape[0] < max(60, args.min_train_trades // 2):
                continue
            oof_trades = [trade for trade, include in zip(kept, mask, strict=True) if include]
            effective = sized_trades(oof_trades, oof, effective_r=True)
            oof_metrics = metrics(effective, asset, spec, model_spec.name, "train_oof")
            base = baseline_pf(oof_trades)
            if (
                oof_metrics.profit_factor < max(1.05, base + 0.03)
                or oof_metrics.block_bootstrap_pf_p05 < 0.70
                or oof_metrics.odd_even_min_pf < 0.80
            ):
                continue
            model.fit(features, labels)
            strategy = strategy_for(asset, spec, args.cost_ticks)
            validation_raw = session.run_competition_candidate(
                strategy, asset, data, plan.train_end, plan.validation_end, strict=False
            )
            val_x, val_y, val_trades, _val_volatility = feature_rows(validation_raw, data)
            if val_x.shape[0] < args.min_validation_trades or len(set(val_y.tolist())) < 2:
                continue
            val_prob = probability(model, val_x)
            val_metrics = metrics(
                sized_trades(val_trades, val_prob, effective_r=True), asset, spec, model_spec.name, "validation"
            )
            val_base = baseline_pf(val_trades)
            auc = safe_auc(val_y, val_prob)
            brier = safe_brier(val_y, val_prob)
            validation_diagnostics.append((
                val_metrics.profit_factor - val_base,
                spec.family,
                model_spec.name,
                val_metrics.profit_factor,
                val_base,
                val_metrics.trades,
                auc,
                val_metrics.block_bootstrap_pf_p05,
            ))
            if (
                val_metrics.profit_factor < max(1.15, val_base + 0.03)
                or val_metrics.min_split_pf < 0.70
                or val_metrics.bootstrap_pf_p05 < 0.75
                or val_metrics.block_bootstrap_pf_p05 < 0.70
                or val_metrics.odd_even_min_pf < 0.80
                or val_metrics.sign_flip_p_value > 0.20
                or auc < 0.51
                or brier > 0.27
            ):
                continue
            score = (
                min(val_metrics.profit_factor, 4.0) * 2
                + min(val_metrics.block_bootstrap_pf_p05, 2.5)
                + math.log1p(val_metrics.trades)
                + (auc - 0.5) * 8
            )
            validation_candidates.append((score, spec, model, model_spec.name, oof_metrics, training_trials))

    validation_candidates.sort(key=lambda item: item[0], reverse=True)
    print(f"    untouched validation passes={len(validation_candidates)} from {training_trials} ML trials", flush=True)
    for improvement, family, model_name, pf, base_pf, trades, auc, block_pf in sorted(validation_diagnostics, reverse=True)[:3]:
        print(
            f"      best {family} {model_name}: PF={pf:.2f} vs {base_pf:.2f}, "
            f"delta={improvement:+.2f}, trades={trades}, AUC={auc:.3f}, block={block_pf:.2f}",
            flush=True,
        )
    output: list[Candidate] = []
    execution_data = nested.load_execution_data(asset, plan.train_end) if validation_candidates else None
    for score, spec, model, model_name, train_oof, trial_count in validation_candidates[: args.max_holdout_tests_per_asset]:
        strategy = strategy_for(asset, spec, args.cost_ticks)
        validation_fast = session.run_competition_candidate(strategy, asset, data, plan.train_end, plan.validation_end, strict=False)
        validation_raw = runner.run_single_strategy(
            strategy,
            asset,
            data,
            start_ts=plan.train_end,
            end_ts=plan.validation_end,
            strict_anti_cheat=True,
            execution_data=[("1m", execution_data)],
        )
        parity = entry_parity(validation_fast, validation_raw)
        if parity < 0.90:
            continue
        val_x, val_y, val_trades, _val_volatility = feature_rows(validation_raw, data)
        if val_x.shape[0] < args.min_validation_trades or len(set(val_y.tolist())) < 2:
            continue
        val_prob = probability(model, val_x)
        validation = metrics(sized_trades(val_trades, val_prob, True), asset, spec, model_name, "validation_final")
        holdout_raw = runner.run_single_strategy(
            strategy,
            asset,
            data,
            start_ts=plan.validation_end,
            end_ts=plan.holdout_end,
            strict_anti_cheat=True,
            execution_data=[("1m", execution_data)],
        )
        hold_x, hold_y, hold_trades, hold_volatility = feature_rows(holdout_raw, data)
        if hold_x.shape[0] < args.min_holdout_trades or len(set(hold_y.tolist())) < 2:
            continue
        hold_prob = probability(model, hold_x)
        holdout = metrics(sized_trades(hold_trades, hold_prob, True), asset, spec, model_name, "holdout")
        sized_oos = [
            *sized_trades(val_trades, val_prob, effective_r=False),
            *sized_trades(hold_trades, hold_prob, effective_r=False),
        ]
        effective_oos = [
            *sized_trades(val_trades, val_prob, effective_r=True),
            *sized_trades(hold_trades, hold_prob, effective_r=True),
        ]
        overall = metrics(effective_oos, asset, spec, model_name, "overall")
        output.append(Candidate(
            asset=asset,
            spec=spec,
            model_name=model_name,
            train_oof=train_oof,
            validation=validation,
            holdout=holdout,
            overall=overall,
            validation_baseline_pf=baseline_pf(val_trades),
            holdout_baseline_pf=baseline_pf(hold_trades),
            validation_auc=safe_auc(val_y, val_prob),
            validation_brier=safe_brier(val_y, val_prob),
            holdout_auc=safe_auc(hold_y, hold_prob),
            holdout_brier=safe_brier(hold_y, hold_prob),
            holdout_p_value=holdout.sign_flip_p_value,
            holdout_q_value=1.0,
            minimum_regime_pf=minimum_regime_pf(hold_trades, hold_volatility, hold_prob),
            multiplier_mean=float(np.mean(multipliers(np.concatenate([val_prob, hold_prob])))),
            entry_parity=parity,
            trades=sorted(sized_oos, key=lambda item: (item.entry_time, item.exit_time)),
            score=score + min(holdout.profit_factor, 4.0) * 2 + math.log1p(holdout.trades),
            training_trials=trial_count,
        ))
    return output


def false_discovery_correction(candidates: list[Candidate]) -> list[Candidate]:
    if not candidates:
        return []
    ordered = sorted(candidates, key=lambda item: item.holdout_p_value)
    count = len(ordered)
    q_values = [1.0] * count
    running = 1.0
    for index in range(count - 1, -1, -1):
        running = min(running, ordered[index].holdout_p_value * count / (index + 1))
        q_values[index] = min(1.0, running)
    return [replace(candidate, holdout_q_value=q_values[index]) for index, candidate in enumerate(ordered)]


def passes(candidate: Candidate, args: argparse.Namespace) -> bool:
    return (
        candidate.holdout.trades >= args.min_holdout_trades
        and candidate.holdout.profit_factor >= max(1.20, candidate.holdout_baseline_pf + 0.02)
        and candidate.holdout.bootstrap_pf_p05 >= 0.80
        and candidate.holdout.block_bootstrap_pf_p05 >= 0.75
        and candidate.holdout.odd_even_min_pf >= 0.80
        and candidate.holdout_q_value <= args.false_discovery_rate
        and candidate.holdout_auc >= 0.51
        and candidate.holdout_brier <= 0.27
        and candidate.minimum_regime_pf >= 0.75
        and candidate.entry_parity >= 0.90
        and candidate.overall.profit_factor >= 1.30
        and candidate.overall.annual_pass_rate >= 0.60
    )


def write_report(candidates: list[Candidate], eligible: list[Candidate], args: argparse.Namespace) -> Path:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    eligible_keys = {(item.asset.key, item.spec.variant_id, item.model_name) for item in eligible}
    path = REPORT_ROOT / f"nested_ml_session_sizing_{args.market}.csv"
    fields = [
        "status", "asset_key", "model", "family", "train_oof_pf", "train_oof_trades", "validation_pf",
        "validation_baseline_pf", "validation_trades", "validation_auc", "validation_brier", "holdout_pf",
        "holdout_baseline_pf", "holdout_trades", "holdout_auc", "holdout_brier", "holdout_p_value",
        "holdout_q_value", "minimum_regime_pf", "overall_pf", "overall_trades", "overall_bootstrap_p05",
        "overall_block_bootstrap_p05", "annual_pass_rate", "mean_size_multiplier", "entry_parity",
        "training_trials", "variant_id",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for item in sorted(candidates, key=lambda candidate: candidate.score, reverse=True):
            writer.writerow({
                "status": "eligible" if (item.asset.key, item.spec.variant_id, item.model_name) in eligible_keys else "rejected",
                "asset_key": item.asset.key,
                "model": item.model_name,
                "family": item.spec.family,
                "train_oof_pf": f"{item.train_oof.profit_factor:.6f}",
                "train_oof_trades": item.train_oof.trades,
                "validation_pf": f"{item.validation.profit_factor:.6f}",
                "validation_baseline_pf": f"{item.validation_baseline_pf:.6f}",
                "validation_trades": item.validation.trades,
                "validation_auc": f"{item.validation_auc:.6f}",
                "validation_brier": f"{item.validation_brier:.6f}",
                "holdout_pf": f"{item.holdout.profit_factor:.6f}",
                "holdout_baseline_pf": f"{item.holdout_baseline_pf:.6f}",
                "holdout_trades": item.holdout.trades,
                "holdout_auc": f"{item.holdout_auc:.6f}",
                "holdout_brier": f"{item.holdout_brier:.6f}",
                "holdout_p_value": f"{item.holdout_p_value:.6f}",
                "holdout_q_value": f"{item.holdout_q_value:.6f}",
                "minimum_regime_pf": f"{item.minimum_regime_pf:.6f}",
                "overall_pf": f"{item.overall.profit_factor:.6f}",
                "overall_trades": item.overall.trades,
                "overall_bootstrap_p05": f"{item.overall.bootstrap_pf_p05:.6f}",
                "overall_block_bootstrap_p05": f"{item.overall.block_bootstrap_pf_p05:.6f}",
                "annual_pass_rate": f"{item.overall.annual_pass_rate:.6f}",
                "mean_size_multiplier": f"{item.multiplier_mean:.6f}",
                "entry_parity": f"{item.entry_parity:.6f}",
                "training_trials": item.training_trials,
                "variant_id": item.spec.variant_id,
            })
    summary = {
        "market": args.market,
        "source": SOURCE,
        "sourceUrls": SOURCE_URLS,
        "models": [model.name for model in model_specs()],
        "sizingRange": [MIN_MULTIPLIER, MAX_MULTIPLIER],
        "testedHoldouts": len(candidates),
        "eligible": len(eligible),
        "method": (
            "Purged expanding time-series OOF training; untouched validation ranks model/base-signal pairs; sealed holdout "
            "uses Benjamini-Hochberg correction, bootstrap/block-bootstrap, odd-even, annual, calibration, AUC, volatility-regime "
            "strict one-minute execution parity and bounded-size stability gates. ML never rejects a qualified base signal; "
            "it sizes every trade from 0.5x to 1.5x."
        ),
    }
    (REPORT_ROOT / f"nested_ml_session_sizing_{args.market}_summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    return path


def main() -> int:
    args = parse_args()
    assets = selected_assets(args)
    specs = base_specs(args.risk_reward)
    models = model_specs()
    print(f"ML sizing research: {args.market}, {len(assets)} assets, {len(specs)} base signals, {len(models)} models")
    candidates: list[Candidate] = []
    for asset in assets:
        print(f"  {asset.key}", flush=True)
        rows = research_asset(asset, specs, models, args)
        candidates.extend(rows)
        print(f"    sealed holdout tests={len(rows)}", flush=True)
    corrected = false_discovery_correction(candidates)
    eligible = [candidate for candidate in corrected if passes(candidate, args)]
    report = write_report(corrected, eligible, args)
    print(f"Completed {len(corrected)} sealed holdout tests; {len(eligible)} eligible. Report: {report}")
    for item in sorted(eligible, key=lambda candidate: candidate.score, reverse=True):
        print(
            f"  {item.asset.key} {item.model_name} {item.spec.family}: "
            f"validation {item.validation.profit_factor:.2f}/{item.validation.trades}, "
            f"holdout {item.holdout.profit_factor:.2f}/{item.holdout.trades}, "
            f"q={item.holdout_q_value:.3f}, regime floor={item.minimum_regime_pf:.2f}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
