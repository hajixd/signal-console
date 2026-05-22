from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import sys
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backtest-engine"))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

import runner  # noqa: E402
import rebuild_ml_holdout as ml_rebuild  # noqa: E402
import search_higher_timeframe_strategies as base  # noqa: E402


SOURCE = "ml_bayes_higher_timeframe_search_2026_05"
REPORT_ROOT = base.REPORT_ROOT
EXECUTION_TIMEFRAME = base.EXECUTION_TIMEFRAME
TIMEFRAME_SECONDS = base.TIMEFRAME_SECONDS

base.EVALUATORS.update(
    {
        "ny_sweep_playbook": ("evaluateNySweepPlaybook", "@/lib/strategy-runtime/ny-sweep-playbook"),
        "momentum": ("evaluateMomentum", "@/lib/strategy-runtime/momentum"),
        "mean_reversion": ("evaluateMeanReversion", "@/lib/strategy-runtime/mean-reversion"),
    }
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fast Bayesian/ML higher-timeframe strategy search with normal backtest exits.")
    parser.add_argument("--asset", action="append", help="Asset key or symbol to scan. Repeat or comma-separate.")
    parser.add_argument("--market", choices=["all", "forex", "futures", "crypto", "gold_spot"], default="all")
    parser.add_argument("--timeframe", action="append", help="Analysis timeframe(s). Defaults to 10m,15m,30m,45m,1h,4h,1d.")
    parser.add_argument("--risk-reward", default="2,3", help="Comma-separated RR values. Values below 2 are ignored.")
    parser.add_argument("--min-forward-pf", type=float, default=2.0)
    parser.add_argument("--min-overall-pf", type=float, default=2.0)
    parser.add_argument("--min-forward-trades", type=int, default=20)
    parser.add_argument("--min-train-trades", type=int, default=8)
    parser.add_argument("--min-train-pf", type=float, default=1.0)
    parser.add_argument("--min-split-trades", type=int, default=3)
    parser.add_argument("--min-split-pf", type=float, default=1.0)
    parser.add_argument("--min-bootstrap-p05", type=float, default=1.0)
    parser.add_argument("--min-block-bootstrap-p05", type=float, default=0.9)
    parser.add_argument("--min-annual-pass-rate", type=float, default=0.6)
    parser.add_argument("--max-sign-flip-p", type=float, default=0.10)
    parser.add_argument("--prefer-win-rate", type=float, default=60.0)
    parser.add_argument("--near-overlap-minutes", type=int, default=45)
    parser.add_argument("--max-fast-per-asset-timeframe", type=int, default=18)
    parser.add_argument("--max-add-per-asset", type=int, default=2)
    parser.add_argument("--max-total-additions", type=int, default=10)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def selected_timeframes(args: argparse.Namespace) -> list[str]:
    requested = base.parse_csv_list(args.timeframe)
    values = requested or ["10m", "15m", "30m", "45m", "1h", "4h", "1d"]
    return [value for value in values if value in {"10m", "15m", "30m", "45m", "1h", "4h", "1d"}]


def strategy_id_for(asset: runner.AssetConfig, spec: base.Spec) -> str:
    digest = hashlib.sha1(f"{asset.key}|{base.canonical_variant(spec.variant_id)}".encode("utf-8")).hexdigest()[:8]
    return f"ml_bayes_tf_{base.slug(asset.key, 34)}_{base.slug(spec.phase, 22)}_{base.slug(spec.timeframe, 6)}_{digest}"


def build_strategy(asset: runner.AssetConfig, spec: base.Spec) -> runner.BacktestStrategy:
    strategy_id = strategy_id_for(asset, spec)
    echo_phase = spec.phase in {"momentum", "mean_reversion"}
    abs_limit = runner.variant_float(spec.variant_id, "abs", 0.0)
    return runner.BacktestStrategy(
        id=strategy_id,
        label=f"{base.symbol_label(asset)} {spec.label}",
        folder=strategy_id,
        asset_key=asset.key,
        phase=spec.phase,
        variant_id=spec.variant_id,
        source=SOURCE,
        signal_atr_mult=runner.variant_float(spec.variant_id, "signal", 0.0) or None,
        recent_signal_lookback=runner.variant_int(spec.variant_id, "recent", 0) or None,
        abs_close_ema200_atr_max=abs_limit if abs_limit > 0 else None,
        trade_rsi_min=runner.variant_float(spec.variant_id, "rsi_min", -999.0) if spec.phase == "mean_reversion" else None,
        trade_rsi_max=runner.variant_float(spec.variant_id, "rsi_max", 999.0) if spec.phase == "mean_reversion" else None,
        tp_units=spec.tp_units,
        sl_units=spec.sl_units,
        echo_model=dummy_echo_model() if echo_phase else None,
        one_trade_per_day=True,
        cost_units=0.0,
    )


def dummy_echo_model() -> runner.EchoModel:
    feature_count = len(runner.ECHO_MODEL_FEATURE_NAMES)
    return runner.EchoModel(
        kind="neural",
        threshold=0.5,
        feature_names=runner.ECHO_MODEL_FEATURE_NAMES,
        feature_means=tuple(0.0 for _ in range(feature_count)),
        feature_scales=tuple(1.0 for _ in range(feature_count)),
        hidden_weights=(tuple(0.0 for _ in range(feature_count)),),
        hidden_bias=(0.0,),
        output_weights=(0.0,),
        output_bias=0.0,
    )


def robust_units(value: float) -> float:
    if value < 10:
        step = 1.0
    elif value < 80:
        step = 5.0
    else:
        step = 10.0
    return max(2.0, round(value / step) * step)


def bayes_specs(asset: runner.AssetConfig, timeframe: str, data: runner.EnrichedData, rr_values: list[float]) -> list[base.Spec]:
    atr_units = base.median_atr_units(data, asset)
    tf_seconds = TIMEFRAME_SECONDS[timeframe]
    max_bars_values = sorted({max(4, min(120, round((8 * 60 * 60) / tf_seconds))), max(3, min(96, round((16 * 60 * 60) / tf_seconds)))})
    if timeframe in {"4h", "1d"}:
        max_bars_values = [6, 12, 18] if timeframe == "4h" else [3, 5, 8]

    risk_windows = []
    for lo_mult, hi_mult in ((0.22, 0.70), (0.40, 1.10)):
        risk_windows.append((robust_units(atr_units * lo_mult), robust_units(atr_units * hi_mult)))

    specs: list[base.Spec] = []
    for rr in rr_values:
        rr_text = base.fmt_rr(rr)
        for model in ("bayes", "logit"):
            for threshold in (0.58, 0.64):
                for start, end in ((420, 540), (570, 720)):
                    for max_tests in (2,):
                        for min_wick in (0.30, 0.50):
                            for risk_min, risk_max in risk_windows:
                                for max_bars in max_bars_values:
                                    execution_tokens = [("exec_tf", EXECUTION_TIMEFRAME)] if EXECUTION_TIMEFRAME else []
                                    variant_id = base.variant(
                                        "ny_sweep_mtf_bayes",
                                        ("tf", timeframe),
                                        *execution_tokens,
                                        ("model", model),
                                        ("min", threshold),
                                        ("start", start),
                                        ("end", end),
                                        ("max_tests", max_tests),
                                        ("risk_min", risk_min),
                                        ("risk_max", max(risk_max, risk_min + 2)),
                                        ("min_wick", min_wick),
                                        ("rr", rr_text),
                                        ("max_bars", max_bars),
                                        ("one_trade", 1),
                                    )
                                    specs.append(
                                        base.Spec(
                                            phase="ny_sweep_playbook",
                                            variant_id=variant_id,
                                            label=f"Bayesian NY sweep {timeframe} {rr_text}R",
                                            summary=(
                                                "Liquidity-sweep candidate scored by a fixed naive-Bayes/logit feature model, "
                                                "selected with normal exits and strict forward anti-overfit tests."
                                            ),
                                            timeframe=timeframe,
                                            risk_reward=rr,
                                            tp_units=None,
                                            sl_units=None,
                                            family_key=f"ny_sweep_{model}_{start}_{end}_{max_tests}_{min_wick}",
                                        )
                                    )
    return specs


def echo_specs(asset: runner.AssetConfig, timeframe: str, data: runner.EnrichedData, rr_values: list[float]) -> list[base.Spec]:
    atr_units = base.median_atr_units(data, asset)
    specs: list[base.Spec] = []
    for rr in rr_values:
        rr_text = base.fmt_rr(rr)
        for phase in ("momentum", "mean_reversion"):
            for signal_mult in (0.9, 1.2):
                for recent in (4, 8):
                    for abs_limit in (0.0, 4.0):
                        for sl_mult in (0.75, 1.05):
                            sl_units = robust_units(atr_units * sl_mult)
                            tp_units = sl_units * rr
                            execution_tokens = [("exec_tf", EXECUTION_TIMEFRAME)] if EXECUTION_TIMEFRAME else []
                            tokens: list[tuple[str, str | int | float]] = [
                                ("tf", timeframe),
                                *execution_tokens,
                                ("signal", signal_mult),
                                ("recent", recent),
                                ("abs", abs_limit),
                                ("sl_mult", sl_mult),
                                ("rr", rr_text),
                            ]
                            if phase == "mean_reversion":
                                tokens.extend([("rsi_min", -10), ("rsi_max", 45)])
                            variant_id = base.variant(f"echo_neural_{phase}", *tokens)
                            specs.append(
                                base.Spec(
                                    phase=phase,
                                    variant_id=variant_id,
                                    label=f"Echo neural {phase.replace('_', ' ')} {timeframe} {rr_text}R",
                                    summary=(
                                        "Echo-style neural setup filter trained only on pre-2022 completed-signal features; "
                                        "post-2022 validation uses strict replay and normal strategy exits."
                                    ),
                                    timeframe=timeframe,
                                    risk_reward=rr,
                                    tp_units=tp_units,
                                    sl_units=sl_units,
                                    family_key=f"echo_{phase}_{signal_mult}_{recent}_{abs_limit}_{sl_mult}",
                                )
                            )
    return specs


def fast_score(metrics: base.Metrics) -> float:
    return min(metrics.profit_factor, 10.0) * 12.0 + math.log1p(metrics.trades) * 5.0 + metrics.win_rate_pct / 8.0 + metrics.total_r * 0.4


def final_candidate(
    strategy: runner.BacktestStrategy,
    asset: runner.AssetConfig,
    data: runner.EnrichedData,
    execution_data: runner.EnrichedData,
    spec: base.Spec,
    args: argparse.Namespace,
) -> base.Candidate | None:
    if strategy.phase in {"momentum", "mean_reversion"}:
        try:
            model = train_fast_echo_model(strategy, asset, data)
        except Exception:
            return None
        strategy = replace(strategy, echo_model=model, variant_id=ml_rebuild.variant_with_threshold(strategy.variant_id, model.threshold))
        probe_trades = runner.run_single_strategy(strategy, asset, data, runner.BACKTEST_START_TS, None, strict_anti_cheat=True)
        if len(probe_trades) > 420:
            return None

    train_trades = runner.run_single_strategy(strategy, asset, data, 0, runner.BACKTEST_START_TS, strict_anti_cheat=True, execution_data=execution_data)
    forward_trades = runner.run_single_strategy(
        strategy,
        asset,
        data,
        runner.BACKTEST_START_TS,
        None,
        strict_anti_cheat=True,
        execution_data=execution_data,
    )
    overall_trades = sorted([*train_trades, *forward_trades], key=lambda item: (item.entry_time, item.exit_time))
    seed = int(hashlib.sha1(f"{asset.key}|{spec.variant_id}".encode("utf-8")).hexdigest()[:8], 16)
    train = base.metrics_for(train_trades, seed ^ 0x1A2B3C4D, args.min_split_trades)
    forward = base.metrics_for(forward_trades, seed, args.min_split_trades)
    overall = base.metrics_for(overall_trades, seed ^ 0x55667788, args.min_split_trades)
    avg_rr, min_rr = base.planned_rr(forward_trades)
    candidate = base.Candidate(
        strategy=strategy,
        asset=asset,
        spec=spec,
        train=train,
        forward=forward,
        overall=overall,
        trades=forward_trades,
        avg_planned_rr=avg_rr,
        min_planned_rr=min_rr,
        score=0.0,
    )
    if base.final_rejection_reason(candidate, args) is not None:
        return None
    return replace(candidate, score=base.score_candidate(candidate, args))


def train_fast_echo_model(strategy: runner.BacktestStrategy, asset: runner.AssetConfig, data: runner.EnrichedData) -> runner.EchoModel:
    features, labels, raw_trades = ml_rebuild.feature_training_rows(strategy, asset, data)
    if features.shape[0] < 14 or len(set(labels.tolist())) < 2:
        raise ValueError("not enough Echo training rows/classes")

    means = features.mean(axis=0)
    scales = features.std(axis=0)
    scales = (scales > 1e-9) * scales + (scales <= 1e-9) * 1.0
    normalized = (features - means) / scales

    if normalized.shape[0] > 1800:
        indexes = [round(i * (normalized.shape[0] - 1) / 1799) for i in range(1800)]
        fit_x = normalized[indexes]
        fit_y = labels[indexes]
    else:
        fit_x = normalized
        fit_y = labels

    classifier = ml_rebuild.MLPClassifier(
        hidden_layer_sizes=(4,),
        activation="tanh",
        solver="lbfgs",
        alpha=0.05,
        random_state=23,
        max_iter=700,
    )
    classifier.fit(fit_x, fit_y)
    probabilities = classifier.predict_proba(normalized)[:, 1]
    best_threshold = 0.5
    best_score = -1_000_000.0
    for step in range(0, 21):
        threshold = 0.50 + step * 0.02
        score = ml_rebuild.filtered_training_score(raw_trades, probabilities, threshold)
        if score > best_score:
            best_score = score
            best_threshold = threshold

    return runner.EchoModel(
        kind="neural",
        threshold=float(best_threshold),
        feature_names=runner.ECHO_MODEL_FEATURE_NAMES,
        feature_means=tuple(float(value) for value in means),
        feature_scales=tuple(float(value) for value in scales),
        hidden_weights=tuple(tuple(float(value) for value in row) for row in classifier.coefs_[0].T),
        hidden_bias=tuple(float(value) for value in classifier.intercepts_[0]),
        output_weights=tuple(float(value) for value in classifier.coefs_[1][:, 0]),
        output_bias=float(classifier.intercepts_[1][0]),
    )


def scan_asset_timeframe(
    asset: runner.AssetConfig,
    timeframe: str,
    rr_values: list[float],
    existing_keys: set[tuple[str, str]],
    existing_trades: dict[tuple[str, str], list[tuple[int, int, str]]],
    cache: dict[tuple[str, str], runner.EnrichedData],
    args: argparse.Namespace,
) -> list[base.Candidate]:
    if not base.data_exists(asset, timeframe):
        return []
    data = base.load_enriched(asset, timeframe, cache)
    specs = [*bayes_specs(asset, timeframe, data, rr_values), *echo_specs(asset, timeframe, data, rr_values)]
    print(f"    {timeframe}: ml_bayes_specs={len(specs)}", flush=True)

    fast_rows: list[tuple[float, runner.BacktestStrategy, base.Spec, base.Metrics]] = []
    for spec in specs:
        canonical = base.canonical_variant(spec.variant_id)
        if (asset.key, canonical) in existing_keys:
            continue
        strategy = build_strategy(asset, spec)
        if spec.phase in {"momentum", "mean_reversion"}:
            raw_strategy = replace(strategy, echo_model=None)
            trades = runner.run_single_strategy(raw_strategy, asset, data, 0, runner.BACKTEST_START_TS, strict_anti_cheat=False)
            min_trades = max(args.min_train_trades * 2, 16)
            min_pf = 0.8
        else:
            trades = runner.run_single_strategy(strategy, asset, data, runner.BACKTEST_START_TS, None, strict_anti_cheat=False)
            min_trades = args.min_forward_trades
            min_pf = args.min_forward_pf
        seed = int(hashlib.sha1(f"{asset.key}|{spec.variant_id}|fast".encode("utf-8")).hexdigest()[:8], 16)
        metrics = base.metrics_for(trades, seed, args.min_split_trades)
        if metrics.trades < min_trades or metrics.profit_factor < min_pf or (spec.phase in {"momentum", "mean_reversion"} and metrics.trades > 900):
            continue
        avg_rr, min_rr = base.planned_rr(trades)
        if avg_rr < 2.0 or min_rr < 1.95:
            continue
        fast_rows.append((fast_score(metrics), strategy, spec, metrics))

    fast_rows.sort(key=lambda row: (row[0], row[3].profit_factor, row[3].trades), reverse=True)
    fast_rows = fast_rows[: args.max_fast_per_asset_timeframe]
    if not fast_rows:
        return []

    execution_data = base.load_enriched(asset, EXECUTION_TIMEFRAME, cache) if EXECUTION_TIMEFRAME else None
    near_seconds = max(args.near_overlap_minutes * 60, TIMEFRAME_SECONDS.get(timeframe, 0))
    selected: list[base.Candidate] = []
    seen_family: set[str] = set()
    for _score, strategy, spec, _metrics in fast_rows:
        if len(selected) >= args.max_add_per_asset:
            break
        if spec.family_key in seen_family:
            continue
        candidate = final_candidate(strategy, asset, data, execution_data, spec, args)
        if candidate is None:
            continue
        if base.selected_trade_overlaps(candidate.trades, existing_trades, near_seconds):
            continue
        selected.append(candidate)
        seen_family.add(spec.family_key)
        base.register_trades(candidate.trades, existing_trades, candidate.strategy.folder)
        existing_keys.add((asset.key, base.canonical_variant(spec.variant_id)))
    return selected


def write_report(candidates: list[base.Candidate], dry_run: bool) -> None:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    csv_path = REPORT_ROOT / "ml_bayes_higher_timeframe_strategy_search.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "status",
                "strategy_id",
                "asset_key",
                "timeframe",
                "phase",
                "forward_pf",
                "forward_trades",
                "forward_win_rate_pct",
                "avg_rr",
                "train_pf",
                "train_trades",
                "overall_pf",
                "bootstrap_pf_p05",
                "block_bootstrap_pf_p05",
                "annual_pass_rate",
                "sign_flip_p_value",
                "variant_id",
            ],
        )
        writer.writeheader()
        for candidate in candidates:
            writer.writerow(
                {
                    "status": "selected" if dry_run else "applied",
                    "strategy_id": candidate.strategy.id,
                    "asset_key": candidate.asset.key,
                    "timeframe": candidate.spec.timeframe,
                    "phase": candidate.strategy.phase,
                    "forward_pf": f"{candidate.forward.profit_factor:.6f}",
                    "forward_trades": candidate.forward.trades,
                    "forward_win_rate_pct": f"{candidate.forward.win_rate_pct:.6f}",
                    "avg_rr": f"{candidate.avg_planned_rr:.6f}",
                    "train_pf": f"{candidate.train.profit_factor:.6f}",
                    "train_trades": candidate.train.trades,
                    "overall_pf": f"{candidate.overall.profit_factor:.6f}",
                    "bootstrap_pf_p05": f"{candidate.forward.bootstrap_pf_p05:.6f}",
                    "block_bootstrap_pf_p05": f"{candidate.forward.block_bootstrap_pf_p05:.6f}",
                    "annual_pass_rate": f"{candidate.forward.annual_pass_rate:.6f}",
                    "sign_flip_p_value": f"{candidate.forward.sign_flip_p_value:.6f}",
                    "variant_id": candidate.strategy.variant_id,
                }
            )

    summary = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "dryRun": dry_run,
        "selected": len(candidates),
        "method": "NY liquidity sweep Bayesian/logit/stump model search",
        "requirements": {
            "minForwardProfitFactor": 2.0,
            "minRiskReward": 2.0,
            "minForwardTrades": 20,
            "executionTimeframe": "normal",
        },
        "antiOverfitGates": [
            "strict anti-cheat replay",
            "pre-2022 train / post-2022 forward split",
            "chronological split PF",
            "annual walk-forward pass rate",
            "bootstrap and block-bootstrap PF p05",
            "odd/even stability",
            "sign-flip p-value",
            "same-asset same-side no-overlap",
        ],
    }
    (REPORT_ROOT / "ml_bayes_higher_timeframe_strategy_search_summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(f"report={csv_path.relative_to(base.PROJECT_ROOT)}")


def materialize(candidate: base.Candidate) -> None:
    strategy_dir = base.STRATEGY_ROOT / candidate.strategy.folder
    metadata_dir = strategy_dir / "machine_learning"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    base.write_strategy_ts(strategy_dir / "strategy.ts", candidate)
    payload = {
        "strategyId": candidate.strategy.id,
        "label": candidate.strategy.label,
        "folder": candidate.strategy.folder,
        "assetKey": candidate.asset.key,
        "phase": candidate.strategy.phase,
        "variantId": candidate.strategy.variant_id,
        "source": candidate.strategy.source,
        "sourceUrls": base.SOURCE_URLS,
        "researchSummary": candidate.spec.summary,
        "selectionMethod": (
            "Timed higher-timeframe ML/Bayes search. Bayesian/liquidity-sweep variants use fixed feature likelihood scores; "
            "Echo neural variants train weights and thresholds only on pre-2022 setup outcomes. Promotion requires strict "
            "anti-cheat replay, post-2022 forward PF/trade/RR gates, normal strategy exits, chronological "
            "split tests, annual walk-forward pass rate, bootstrap and block-bootstrap PF stress, odd/even stability, "
            "sign-flip significance, and same-asset same-side no-overlap filtering."
        ),
        "trainingWindow": {"start": "asset_start", "end": "2021-12-31"},
        "forwardWindow": {"start": "2022-01-01", "end": "asset_latest"},
        "selectedTrainingProfitFactor": base.json_metric(candidate.train.profit_factor),
        "selectedTrainingTrades": candidate.train.trades,
        "selectedForwardProfitFactor": base.json_metric(candidate.forward.profit_factor),
        "selectedForwardTrades": candidate.forward.trades,
        "minimumRiskReward": 2,
        "selectedRiskReward": round(candidate.avg_planned_rr, 6),
        "forwardWins": candidate.forward.wins,
        "forwardLosses": candidate.forward.losses,
        "forwardTotalR": round(candidate.forward.total_r, 6),
        "forwardAverageR": round(candidate.forward.avg_r, 6),
        "forwardMaxDrawdownR": round(candidate.forward.max_drawdown_r, 6),
        "verificationSummary": (
            f"Forward PF {candidate.forward.profit_factor:.2f}, win rate {candidate.forward.win_rate_pct:.1f}%, "
            f"{candidate.forward.trades} trades, average RR {candidate.avg_planned_rr:.2f}, "
            f"min split PF {candidate.forward.min_split_pf:.2f}, annual pass {candidate.forward.annual_pass_rate:.0%}, "
            f"bootstrap p05 {candidate.forward.bootstrap_pf_p05:.2f}, block-bootstrap p05 {candidate.forward.block_bootstrap_pf_p05:.2f}, "
            f"sign-flip p={candidate.forward.sign_flip_p_value:.3f}; exits use the normal strategy timeframe."
        ),
        "costUnits": candidate.strategy.cost_units,
        "oneTradePerDay": True,
    }
    if candidate.strategy.signal_atr_mult is not None:
        payload["signalAtrMult"] = candidate.strategy.signal_atr_mult
    if candidate.strategy.recent_signal_lookback is not None:
        payload["recentSignalLookback"] = candidate.strategy.recent_signal_lookback
    if candidate.strategy.abs_close_ema200_atr_max is not None:
        payload["absCloseEma200AtrMax"] = candidate.strategy.abs_close_ema200_atr_max
    if candidate.strategy.trade_rsi_min is not None:
        payload["tradeRsiMin"] = candidate.strategy.trade_rsi_min
    if candidate.strategy.trade_rsi_max is not None:
        payload["tradeRsiMax"] = candidate.strategy.trade_rsi_max
    if candidate.strategy.tp_units is not None:
        payload["tpUnits"] = round(candidate.strategy.tp_units, 6)
    if candidate.strategy.sl_units is not None:
        payload["slUnits"] = round(candidate.strategy.sl_units, 6)
    if candidate.strategy.echo_model is not None:
        payload["echoModel"] = ml_rebuild.echo_model_payload(candidate.strategy.echo_model)
    (metadata_dir / "selection.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    runner.write_strategy_backtest_csv(strategy_dir / "backtest_trades.csv", candidate.trades)


def main() -> int:
    args = parse_args()
    rr_values = base.parse_rr(args.risk_reward)
    timeframes = selected_timeframes(args)
    assets = base.selected_assets(args)
    existing_keys = base.existing_variant_keys()
    existing_trades = base.load_existing_trade_times()
    cache: dict[tuple[str, str], runner.EnrichedData] = {}
    selected: list[base.Candidate] = []
    additions_by_asset: dict[str, int] = {}
    print(f"ML/Bayes scan assets={len(assets)} timeframes={','.join(timeframes)} rr={','.join(base.fmt_rr(value) for value in rr_values)}", flush=True)

    for asset in assets:
        if len(selected) >= args.max_total_additions:
            break
        additions_by_asset.setdefault(asset.key, 0)
        print(f"  asset={asset.key}", flush=True)
        for timeframe in timeframes:
            if len(selected) >= args.max_total_additions or additions_by_asset[asset.key] >= args.max_add_per_asset:
                break
            additions = scan_asset_timeframe(asset, timeframe, rr_values, existing_keys, existing_trades, cache, args)
            slots = max(0, min(args.max_add_per_asset - additions_by_asset[asset.key], args.max_total_additions - len(selected)))
            additions = sorted(additions, key=lambda item: item.score, reverse=True)[:slots]
            if additions:
                selected.extend(additions)
                additions_by_asset[asset.key] += len(additions)
                print(f"      selected={len(additions)}", flush=True)

    selected = sorted(selected, key=lambda item: item.score, reverse=True)[: args.max_total_additions]
    if not args.dry_run:
        for candidate in selected:
            materialize(candidate)
        base.update_loader(selected)
    write_report(selected, args.dry_run)
    print(f"qualified={len(selected)} applied={not args.dry_run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
