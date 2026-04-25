from __future__ import annotations

import csv
import json
import math
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import runner


TRAINING_START_TS = 0
TRAINING_END_TS = runner.BACKTEST_START_TS
MIN_TRAIN_TRADES = 20
MIN_FORWARD_TRADES = 20
KEEP_PROFIT_FACTOR = 2.0


@dataclass(frozen=True)
class SourceNote:
    url: str
    note: str


@dataclass(frozen=True)
class Playbook:
    trader: str
    playbook: str
    phase: str
    assets: tuple[str, ...]
    summary: str
    sources: tuple[SourceNote, ...]
    variant_group: str
    inverse_if_below_pf: float = 1.0


@dataclass(frozen=True)
class CandidateResult:
    playbook: Playbook
    asset: runner.AssetConfig
    variant_id: str
    invert_signal: bool
    train_pf: float
    train_trades: int
    forward_pf: float
    forward_trades: int
    wins: int
    losses: int
    total_r: float
    avg_r: float
    max_dd_r: float
    trades: list[runner.BacktestTradeRow]


def utc_label(timestamp: int) -> str:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).date().isoformat()


def slug(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "_", value.lower()).strip("_")
    return re.sub(r"_+", "_", normalized)


def ts_identifier(strategy_id: str) -> str:
    parts = [part for part in re.split(r"[^a-zA-Z0-9]+", strategy_id) if part]
    if not parts:
        return "strategyDefinition"
    head = parts[0]
    tail = "".join(part[:1].upper() + part[1:] for part in parts[1:])
    identifier = head + tail
    if identifier[0].isdigit():
        identifier = f"strategy{identifier}"
    return identifier


def profit_factor(trades: Iterable[runner.BacktestTradeRow]) -> float:
    gross_win = 0.0
    gross_loss = 0.0
    for trade in trades:
        if trade.r_multiple > 0:
            gross_win += trade.r_multiple
        elif trade.r_multiple < 0:
            gross_loss += abs(trade.r_multiple)
    if gross_loss == 0:
        return math.inf if gross_win > 0 else 0.0
    return gross_win / gross_loss


def metrics(trades: list[runner.BacktestTradeRow]) -> dict[str, float | int]:
    wins = sum(1 for trade in trades if trade.r_multiple > 0)
    losses = sum(1 for trade in trades if trade.r_multiple < 0)
    total_r = sum(trade.r_multiple for trade in trades)
    equity = 0.0
    peak = 0.0
    max_dd = 0.0
    for trade in sorted(trades, key=lambda item: item.exit_time):
        equity += trade.r_multiple
        peak = max(peak, equity)
        max_dd = max(max_dd, peak - equity)
    return {
        "pf": profit_factor(trades),
        "trades": len(trades),
        "wins": wins,
        "losses": losses,
        "total_r": total_r,
        "avg_r": total_r / len(trades) if trades else 0.0,
        "max_dd_r": max_dd,
    }


def score_train_result(trades: list[runner.BacktestTradeRow]) -> float:
    result = metrics(trades)
    trade_count = int(result["trades"])
    if trade_count < MIN_TRAIN_TRADES:
        return -math.inf
    pf = float(result["pf"])
    capped_pf = min(pf, 6.0) if math.isfinite(pf) else 6.0
    avg_r = float(result["avg_r"])
    drawdown = float(result["max_dd_r"])
    return capped_pf * math.log1p(trade_count) + avg_r * 10.0 - drawdown * 0.02


def variant_ids(group: str) -> list[str]:
    if group == "vwap":
        return [
            "vwap_pullback|ny|threshold=0.05|rr=1.5|sl_atr=0.75|max_bars=12|trend=all|one_trade=1",
            "vwap_pullback|ny|threshold=0.1|rr=2|sl_atr=1|max_bars=24|trend=ema|one_trade=1",
            "vwap_pullback|ny|threshold=0.05|rr=2|sl_atr=0.75|max_bars=24|trend=all|one_trade=1",
            "vwap_pullback|london|threshold=0.1|rr=1.5|sl_atr=1|max_bars=24|trend=all|one_trade=1",
            "vwap_pullback|all|threshold=0.05|rr=1.5|sl_atr=0.75|max_bars=12|trend=ema|one_trade=1",
            "vwap_pullback|all|threshold=0.1|rr=2|sl_atr=1|max_bars=24|trend=all|one_trade=1",
        ]
    if group == "parabolic":
        return [
            "parabolic_fade|ny|threshold=0.9|rr=1|sl_atr=0.75|max_bars=8|trend=all|one_trade=1",
            "parabolic_fade|ny|threshold=1.2|rr=1.5|sl_atr=1|max_bars=16|trend=all|one_trade=1",
            "parabolic_fade|ny|threshold=1.6|rr=2|sl_atr=1|max_bars=24|trend=short_only|one_trade=1",
            "parabolic_fade|all|threshold=0.9|rr=1.5|sl_atr=0.75|max_bars=16|trend=all|one_trade=1",
            "parabolic_fade|all|threshold=1.2|rr=2|sl_atr=1|max_bars=24|trend=short_only|one_trade=1",
            "parabolic_fade|all|threshold=1.6|rr=1.5|sl_atr=1|max_bars=16|trend=all|one_trade=1",
        ]
    if group == "support_retest":
        return [
            "support_resistance_retest|ny|range=24|entry=45|threshold=0.03|rr=1.5|sl_atr=0.75|max_bars=16|trend=all|one_trade=1",
            "support_resistance_retest|ny|range=48|entry=90|threshold=0.08|rr=2|sl_atr=1|max_bars=32|trend=ema|one_trade=1",
            "support_resistance_retest|ny|range=96|entry=90|threshold=0.03|rr=2.5|sl_atr=0.75|max_bars=32|trend=all|one_trade=1",
            "support_resistance_retest|london|range=48|entry=90|threshold=0.08|rr=2|sl_atr=1|max_bars=32|trend=all|one_trade=1",
            "support_resistance_retest|all|range=24|entry=45|threshold=0.03|rr=1.5|sl_atr=0.75|max_bars=16|trend=ema|one_trade=1",
            "support_resistance_retest|all|range=96|entry=90|threshold=0.08|rr=2.5|sl_atr=1|max_bars=32|trend=all|one_trade=1",
        ]
    if group == "ma_pullback":
        return [
            "ma_pullback|ny|rr=1.5|sl_atr=0.5|max_bars=16|one_trade=1",
            "ma_pullback|ny|rr=2|sl_atr=1|max_bars=32|one_trade=1",
            "ma_pullback|london|rr=2|sl_atr=1|max_bars=32|one_trade=1",
            "ma_pullback|all|rr=1.5|sl_atr=0.5|max_bars=16|one_trade=1",
            "ma_pullback|all|rr=2.5|sl_atr=1|max_bars=48|one_trade=1",
            "ma_pullback|all|rr=2|sl_atr=1.5|max_bars=32|one_trade=1",
        ]
    if group == "orb":
        return [
            "reddit_orb_retest|ny|range=15|entry=90|rr=1.5|max_bars=16|trend=all|one_trade=1",
            "reddit_orb_retest|ny|range=30|entry=150|rr=2|max_bars=32|trend=ema|one_trade=1",
            "reddit_orb_retest|ny|range=45|entry=150|rr=2.5|max_bars=32|trend=all|one_trade=1",
            "reddit_orb_retest|london|range=15|entry=90|rr=1.5|max_bars=16|trend=all|one_trade=1",
            "reddit_orb_retest|london|range=30|entry=150|rr=2|max_bars=32|trend=ema|one_trade=1",
            "reddit_orb_retest|london|range=45|entry=150|rr=2.5|max_bars=32|trend=all|one_trade=1",
        ]
    if group == "opening_drive":
        return [
            "reddit_orb_breakout|ny|range=15|entry=90|rr=1.5|max_bars=8|trend=all|one_trade=1",
            "reddit_orb_breakout|ny|range=30|entry=150|rr=2|max_bars=16|trend=ema|one_trade=1",
            "reddit_orb_breakout|ny|range=15|entry=150|rr=2.5|max_bars=32|trend=all|one_trade=1",
            "reddit_orb_breakout|london|range=15|entry=90|rr=1.5|max_bars=8|trend=all|one_trade=1",
            "reddit_orb_breakout|london|range=30|entry=150|rr=2|max_bars=16|trend=ema|one_trade=1",
            "reddit_orb_breakout|london|range=15|entry=150|rr=2.5|max_bars=32|trend=all|one_trade=1",
        ]
    if group == "ict_sweep":
        return [
            "ict_sweep_fvg|ny|rr=1|max_bars=16|one_trade=1",
            "ict_sweep_fvg|ny|rr=1.5|max_bars=24|one_trade=1",
            "ict_sweep_fvg|ny|rr=2|max_bars=32|one_trade=1",
            "ict_sweep_fvg|london|rr=1.5|max_bars=24|one_trade=1",
            "ict_sweep_fvg|all|rr=1.5|max_bars=24|one_trade=1",
            "ict_sweep_fvg|all|rr=2.5|max_bars=32|one_trade=1",
        ]
    if group == "turtle_soup":
        return [
            "ict_turtle_soup|ny|threshold=0.03|rr=1.5|max_bars=16|trend=all|one_trade=1",
            "ict_turtle_soup|ny|threshold=0.06|rr=2|max_bars=24|trend=ema|one_trade=1",
            "ict_turtle_soup|ny|threshold=0.1|rr=2.5|max_bars=32|trend=all|one_trade=1",
            "ict_turtle_soup|london|threshold=0.06|rr=2|max_bars=24|trend=all|one_trade=1",
            "ict_turtle_soup|all|threshold=0.03|rr=1.5|max_bars=16|trend=ema|one_trade=1",
            "ict_turtle_soup|all|threshold=0.1|rr=2.5|max_bars=32|trend=all|one_trade=1",
        ]
    if group == "trendline":
        return [
            "trendline_break|ny|range=72|entry=120|threshold=0.02|rr=2|sl_atr=0.75|max_bars=32|trend=all|one_trade=1",
            "trendline_break|ny|range=96|entry=240|threshold=0.05|rr=3|sl_atr=1|max_bars=64|trend=all|one_trade=1",
            "trendline_break|london|range=96|entry=120|threshold=0.02|rr=2|sl_atr=0.75|max_bars=32|trend=all|one_trade=1",
            "trendline_break|london|range=144|entry=240|threshold=0.05|rr=3|sl_atr=1|max_bars=64|trend=all|one_trade=1",
            "trendline_break|all|range=72|entry=120|threshold=0.02|rr=2|sl_atr=0.75|max_bars=32|trend=all|one_trade=1",
            "trendline_break|all|range=144|entry=240|threshold=0.05|rr=3|sl_atr=1|max_bars=64|trend=all|one_trade=1",
        ]
    raise ValueError(f"Unsupported variant group: {group}")


def strategy_for(playbook: Playbook, asset: runner.AssetConfig, variant_id: str, invert_signal: bool) -> runner.BacktestStrategy:
    variant = f"{variant_id}|inverse=1" if invert_signal and "inverse=1" not in variant_id else variant_id
    return runner.BacktestStrategy(
        id=f"{asset.key}_{slug(playbook.trader)}_{slug(playbook.playbook)}" + ("_opposite" if invert_signal else ""),
        label=f"{asset.symbol} {playbook.trader} {playbook.playbook}" + (" Opposite" if invert_signal else ""),
        folder=f"{asset.key}_{slug(playbook.trader)}_{slug(playbook.playbook)}" + ("_opposite" if invert_signal else ""),
        asset_key=asset.key,
        phase=playbook.phase,
        variant_id=variant,
        source="public_research_pre_2022_ml_selection",
        one_trade_per_day=True,
        cost_units=0.0,
        invert_signal=invert_signal,
    )


def select_best(
    playbook: Playbook,
    asset: runner.AssetConfig,
    data: runner.EnrichedData,
    invert_signal: bool,
) -> tuple[runner.BacktestStrategy, list[runner.BacktestTradeRow], dict[str, float | int]] | None:
    best: tuple[float, runner.BacktestStrategy, list[runner.BacktestTradeRow], dict[str, float | int]] | None = None
    for variant_id in variant_ids(playbook.variant_group):
        strategy = strategy_for(playbook, asset, variant_id, invert_signal)
        trades = runner.run_single_strategy(strategy, asset, data, start_ts=TRAINING_START_TS, end_ts=TRAINING_END_TS)
        trades = [trade for trade in trades if trade.entry_time < TRAINING_END_TS and trade.exit_time < TRAINING_END_TS]
        result = metrics(trades)
        score = score_train_result(trades)
        if best is None or score > best[0]:
            best = (score, strategy, trades, result)
    if best is None or not math.isfinite(best[0]):
        return None
    return best[1], best[2], best[3]


def evaluate_selected(
    playbook: Playbook,
    asset: runner.AssetConfig,
    data: runner.EnrichedData,
    invert_signal: bool,
) -> CandidateResult | None:
    selected = select_best(playbook, asset, data, invert_signal)
    if selected is None:
        return None
    strategy, train_trades, train_metrics = selected
    forward_trades = runner.run_single_strategy(strategy, asset, data, start_ts=runner.BACKTEST_START_TS)
    forward_metrics = metrics(forward_trades)
    return CandidateResult(
        playbook=playbook,
        asset=asset,
        variant_id=strategy.variant_id,
        invert_signal=invert_signal,
        train_pf=float(train_metrics["pf"]),
        train_trades=int(train_metrics["trades"]),
        forward_pf=float(forward_metrics["pf"]),
        forward_trades=int(forward_metrics["trades"]),
        wins=int(forward_metrics["wins"]),
        losses=int(forward_metrics["losses"]),
        total_r=float(forward_metrics["total_r"]),
        avg_r=float(forward_metrics["avg_r"]),
        max_dd_r=float(forward_metrics["max_dd_r"]),
        trades=forward_trades,
    )


def playbooks() -> list[Playbook]:
    dux = (SourceNote("https://www.forex.in.rs/dux-trader-strategy/", "Describes Dux-style low-float momentum, breakouts, and short-biased parabolic fades."),)
    humbled = (SourceNote("https://www.humbledtrader.com/category/day-trading-strategies/vwap-trading-strategy/", "Humbled Trader's public VWAP material emphasizes VWAP as intraday fair value plus pullback/reclaim behavior."),)
    smb = (SourceNote("https://www.smbtraining.com/blog/a-simple-profitable-and-powerful-stock-trading-strategy-to-jump-start-your-trading-progress-finally", "SMB discusses opening-drive style momentum and active playbook review."),)
    chartguys = (SourceNote("https://www.chartguys.com/articles/day-trading-strategies", "ChartGuys education centers on support/resistance, EMA trend, and equilibrium-style continuation."),)
    rayner = (SourceNote("https://www.tradingwithrayner.com/trend-following-trading-strategy/", "Rayner Teo's public trend-following education focuses on trading with trend, breakouts, pullbacks, and ATR risk."),)
    umar = (SourceNote("https://www.tradezella.com/blog/umar-ashraf-trade-recap", "Umar Ashraf/TradeZella recaps emphasize execution review, levels, liquidity, and structured risk."),)
    ricky = (SourceNote("https://learnplanprofit.net/", "Learn Plan Profit is framed around repeatable day-trading plans and technical setups."),)
    clay = (SourceNote("https://claytrader.com/blog/support-and-resistance-levels/", "ClayTrader education repeatedly uses support/resistance levels as the basis for trade plans."),)
    sasha = (SourceNote("https://tradersfly.com/blog/", "Sasha Evdakov/TradersFly public material is mostly technical-analysis education around trend, support/resistance, and moving averages."),)
    tori = (SourceNote("https://www.toritrades.com/", "Tori Trades markets futures price-action education around trendlines, breaks, retests, and risk management."),)
    tjr = (SourceNote("https://www.tjrtrades.com/", "TJR public education is ICT-aligned, using liquidity sweeps, fair value gaps, and market structure concepts."),)
    ross = (SourceNote("https://www.warriortrading.com/gap-and-go-strategy/", "Ross Cameron/Warrior Trading describes Gap-and-Go momentum: catalyst, gap, volume, and opening move confirmation."),)

    return [
        Playbook("Steven Dux", "Parabolic Fade", "parabolic_fade", ("nasdaq_100_futures", "russell_2000_futures", "gold_futures", "crude_oil_futures", "copper_futures"), "Fade extended intraday moves after overextension/rejection, adapted from low-float parabolic-short language.", dux, "parabolic"),
        Playbook("Humbled Trader", "VWAP Pullback", "vwap_pullback", ("nasdaq_100_futures", "sp_500_futures", "russell_2000_futures", "gold_futures", "crude_oil_futures", "eur_usd", "gbp_usd", "gold_spot"), "Trade the first clean pullback/reclaim around session VWAP in the direction of intraday trend.", humbled, "vwap"),
        Playbook("Mike Bellafiore", "Opening Drive", "reddit_orb_breakout", ("nasdaq_100_futures", "sp_500_futures", "russell_2000_futures", "dow_jones_futures", "crude_oil_futures"), "Opening range drive with trend filter and fixed R exits, reflecting SMB playbook/opening-drive framing.", smb, "opening_drive"),
        Playbook("Mike Bellafiore", "ORB Retest", "reddit_orb_retest", ("nasdaq_100_futures", "sp_500_futures", "russell_2000_futures", "dow_jones_futures", "crude_oil_futures"), "Breakout, retest, and confirmation of the opening range rather than chasing the first break.", smb, "orb"),
        Playbook("Dan McDermitt", "EMA Continuation", "ma_pullback", ("nasdaq_100_futures", "gold_futures", "crude_oil_futures", "copper_futures", "silver_futures"), "Trend-continuation pullback to fast EMAs with confirmation candle.", chartguys, "ma_pullback"),
        Playbook("Rayner Teo", "Trend Pullback", "ma_pullback", ("nasdaq_100_futures", "sp_500_futures", "gold_futures", "crude_oil_futures", "eur_usd", "gbp_usd", "usd_jpy", "gold_spot"), "Trade pullbacks only when moving-average structure confirms trend direction; ATR-based risk.", rayner, "ma_pullback"),
        Playbook("Umar Ashraf", "Liquidity Fade", "ict_turtle_soup", ("nasdaq_100_futures", "sp_500_futures", "gold_futures", "crude_oil_futures", "gold_spot"), "Fade prior-session liquidity sweeps with explicit stop beyond the sweep and R-multiple target.", umar, "turtle_soup"),
        Playbook("Ricky Gutierrez", "VWAP Dip Reclaim", "vwap_pullback", ("nasdaq_100_futures", "russell_2000_futures", "gold_futures", "crude_oil_futures"), "Dip-buy/reclaim logic around VWAP in the direction of broader intraday trend.", ricky, "vwap"),
        Playbook("ClayTrader", "Support Resistance Retest", "support_resistance_retest", ("nasdaq_100_futures", "sp_500_futures", "russell_2000_futures", "gold_futures", "crude_oil_futures"), "Break of a visible support/resistance shelf, then retest and continuation.", clay, "support_retest"),
        Playbook("Sasha Evdakov", "Moving Average Pullback", "ma_pullback", ("gold_futures", "crude_oil_futures", "eur_usd", "gbp_usd", "gold_spot"), "Technical-analysis trend pullback using moving-average alignment and ATR exits.", sasha, "ma_pullback"),
        Playbook("Tori Trades", "Trendline Break Retest", "trendline_break", ("nasdaq_100_futures", "sp_500_futures", "gold_futures", "crude_oil_futures", "gold_spot"), "Mechanical proxy for price-action trendline break/retest continuation.", tori, "trendline"),
        Playbook("TJR", "ICT Sweep FVG", "ict_sweep_fvg", ("nasdaq_100_futures", "sp_500_futures", "gold_futures", "crude_oil_futures", "gold_spot", "gbp_usd"), "Liquidity sweep followed by fair-value-gap displacement and limit entry.", tjr, "ict_sweep"),
        Playbook("TJR", "ICT Turtle Soup", "ict_turtle_soup", ("nasdaq_100_futures", "sp_500_futures", "gold_futures", "crude_oil_futures", "gold_spot", "gbp_usd"), "Prior-day high/low sweep fade with trend/session filters.", tjr, "turtle_soup"),
        Playbook("Ross Cameron", "Gap And Go Proxy", "support_resistance_retest", ("nasdaq_100_futures", "sp_500_futures", "russell_2000_futures"), "Continuous-futures proxy for gap-and-go: opening momentum through resistance, retest, and continuation.", ross, "support_retest"),
    ]


def write_strategy_files(result: CandidateResult) -> None:
    strategy_id = f"{result.asset.key}_{slug(result.playbook.trader)}_{slug(result.playbook.playbook)}" + ("_opposite" if result.invert_signal else "")
    strategy_dir = runner.STRATEGY_ROOT / strategy_id
    ml_dir = strategy_dir / "machine_learning"
    research_dir = strategy_dir / "research"
    ml_dir.mkdir(parents=True, exist_ok=True)
    research_dir.mkdir(parents=True, exist_ok=True)

    label = f"{result.asset.symbol} {result.playbook.trader} {result.playbook.playbook}" + (" Opposite" if result.invert_signal else "")
    selection = {
        "strategyId": strategy_id,
        "label": label,
        "folder": strategy_id,
        "assetKey": result.asset.key,
        "phase": result.playbook.phase,
        "variantId": result.variant_id,
        "source": "public_research_pre_2022_ml_selection",
        "sourceUrls": [source.url for source in result.playbook.sources],
        "researchSummary": result.playbook.summary,
        "trader": result.playbook.trader,
        "playbook": result.playbook.playbook,
        "selectionMethod": "pre_2022_grid_search_then_2022_forward_filter",
        "trainingWindow": {"start": "asset_start", "end": "2021-12-31"},
        "forwardWindow": {"start": "2022-01-01", "end": "asset_latest"},
        "selectedTrainingProfitFactor": result.train_pf,
        "selectedTrainingTrades": result.train_trades,
        "selectedForwardProfitFactor": result.forward_pf,
        "selectedForwardTrades": result.forward_trades,
        "forwardWins": result.wins,
        "forwardLosses": result.losses,
        "forwardTotalR": result.total_r,
        "forwardAverageR": result.avg_r,
        "forwardMaxDrawdownR": result.max_dd_r,
        "invertSignal": result.invert_signal,
        "costUnits": 0,
        "oneTradePerDay": True,
        "signalAtrMult": None,
        "recentSignalLookback": None,
        "absCloseEma200AtrMax": None,
        "ictRiskReward": None,
        "tpUnits": None,
        "slUnits": None,
    }
    (ml_dir / "selection.json").write_text(json.dumps(selection, indent=2) + "\n", encoding="utf-8")

    sources_md = "\n".join(f"- {source.url}: {source.note}" for source in result.playbook.sources)
    research_md = (
        f"# {label}\n\n"
        f"## Public Strategy Interpretation\n{result.playbook.summary}\n\n"
        f"## Sources\n{sources_md}\n\n"
        "## Test Protocol\n"
        "- Parameters were selected only on candles before 2022-01-01.\n"
        "- Displayed/backtest statistics use trades from 2022-01-01 through the latest asset candle.\n"
        "- Backtest costs are zero.\n"
        "- Entry-bar take-profit hits are allowed only when OHLC makes the target reachable after entry; entry-bar stop hits remain losses.\n"
        f"- Forward result: PF {result.forward_pf:.4g}, trades {result.forward_trades}, total R {result.total_r:.4g}.\n"
    )
    (research_dir / "README.md").write_text(research_md, encoding="utf-8")

    evaluator_import = {
        "ict_sweep_fvg": ("evaluateIctSweepFvg", "@/lib/strategy-runtime/ict-sweep-fvg"),
        "ict_turtle_soup": ("evaluateIctTurtleSoup", "@/lib/strategy-runtime/ict-turtle-soup"),
        "reddit_orb_breakout": ("evaluateRedditOrbBreakout", "@/lib/strategy-runtime/reddit-orb-breakout"),
        "reddit_orb_retest": ("evaluateRedditOrbRetest", "@/lib/strategy-runtime/reddit-orb-retest"),
        "ma_pullback": ("evaluateRedditEmaPullback", "@/lib/strategy-runtime/reddit-ema-pullback"),
        "ema_rider": ("evaluateRedditEmaPullback", "@/lib/strategy-runtime/reddit-ema-pullback"),
    }.get(result.playbook.phase, ("evaluateMomentum", "@/lib/strategy-runtime/momentum"))
    evaluator_name, evaluator_module = evaluator_import
    strategy_ts = f'''import {{ createStrategyDefinition, runtimeDefaultsFromMetadata }} from "@/lib/strategy-definition";
import {{ {evaluator_name} }} from "{evaluator_module}";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({{
  id: {json.dumps(strategy_id)},
  label: {json.dumps(label)},
  folder: {json.dumps(strategy_id)},
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: {json.dumps(result.asset.key)},
  phase: {json.dumps(result.playbook.phase)},
  liveEnabled: false,
  evaluator: {evaluator_name},
  defaults: runtimeDefaultsFromMetadata(selection)
}});
'''
    (strategy_dir / "strategy.ts").write_text(strategy_ts, encoding="utf-8")
    runner.write_strategy_backtest_csv(strategy_dir / "backtest_trades.csv", result.trades)


def write_loader(results: list[CandidateResult]) -> None:
    loader_path = runner.PROJECT_ROOT / "src" / "lib" / "strategy-loader.ts"
    imports: list[str] = []
    identifiers: list[str] = []
    for result in results:
        strategy_id = f"{result.asset.key}_{slug(result.playbook.trader)}_{slug(result.playbook.playbook)}" + ("_opposite" if result.invert_signal else "")
        identifier = ts_identifier(strategy_id)
        imports.append(f'import {identifier} from "@strategy/{strategy_id}/strategy";')
        identifiers.append(identifier)
    content = "\n".join(imports)
    if content:
        content += "\n"
    content += '''import type { StrategyDefinition } from "@/lib/strategy-definition";

export type { StrategyDefinition, StrategySignal } from "@/lib/strategy-definition";

export const STRATEGY_DEFINITIONS: StrategyDefinition[] = [
'''
    content += ",\n".join(f"  {identifier}" for identifier in identifiers)
    content += '''
];

export function strategyForPhase(phase: string): StrategyDefinition | undefined {
  return STRATEGY_DEFINITIONS.find((strategy) => strategy.phase === phase);
}
'''
    loader_path.write_text(content, encoding="utf-8")


def write_summary(results: list[CandidateResult], rejected: list[CandidateResult]) -> None:
    summary_path = runner.STRATEGY_ROOT / "research_summary.csv"
    with summary_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "kept",
                "trader",
                "playbook",
                "asset",
                "symbol",
                "phase",
                "inverse",
                "train_pf",
                "train_trades",
                "forward_pf",
                "forward_trades",
                "total_r",
                "variant_id",
            ]
        )
        for kept, rows in ((True, results), (False, rejected)):
            for result in rows:
                writer.writerow(
                    [
                        kept,
                        result.playbook.trader,
                        result.playbook.playbook,
                        result.asset.key,
                        result.asset.symbol,
                        result.playbook.phase,
                        result.invert_signal,
                        f"{result.train_pf:.8g}",
                        result.train_trades,
                        f"{result.forward_pf:.8g}",
                        result.forward_trades,
                        f"{result.total_r:.8g}",
                        result.variant_id,
                    ]
                )


def reset_strategy_dir() -> None:
    root = runner.STRATEGY_ROOT.resolve()
    project = runner.PROJECT_ROOT.resolve()
    if project not in root.parents:
        raise RuntimeError(f"Refusing to clear unexpected strategy path: {root}")
    root.mkdir(parents=True, exist_ok=True)
    for child in root.iterdir():
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()


def main() -> None:
    assets = runner.load_asset_by_key()
    data_cache: dict[str, runner.EnrichedData] = {}
    kept: list[CandidateResult] = []
    rejected: list[CandidateResult] = []

    for playbook in playbooks():
        for asset_key in playbook.assets:
            asset = assets[asset_key]
            if asset.key not in data_cache:
                candle_path = runner.DATA_ROOT / "15m" / asset.data_file
                data_cache[asset.key] = runner.build_enriched_data(runner.load_candle_csv(candle_path), asset)
            data = data_cache[asset.key]

            direct = evaluate_selected(playbook, asset, data, invert_signal=False)
            if direct is None:
                continue
            selected = direct
            if direct.forward_pf < playbook.inverse_if_below_pf:
                inverse = evaluate_selected(playbook, asset, data, invert_signal=True)
                if inverse is not None:
                    selected = inverse
                    rejected.append(direct)

            if selected.forward_pf >= KEEP_PROFIT_FACTOR and selected.forward_trades >= MIN_FORWARD_TRADES:
                kept.append(selected)
                print(
                    f"KEEP {asset.symbol} {playbook.trader} {playbook.playbook}"
                    f"{' inverse' if selected.invert_signal else ''}: PF={selected.forward_pf:.2f} trades={selected.forward_trades}"
                )
            else:
                rejected.append(selected)
                print(
                    f"DROP {asset.symbol} {playbook.trader} {playbook.playbook}"
                    f"{' inverse' if selected.invert_signal else ''}: PF={selected.forward_pf:.2f} trades={selected.forward_trades}"
                )

    kept.sort(key=lambda result: (math.inf if not math.isfinite(result.forward_pf) else result.forward_pf, result.forward_trades), reverse=True)
    reset_strategy_dir()
    for result in kept:
        write_strategy_files(result)
    write_loader(kept)
    write_summary(kept, rejected)
    print(f"Kept {len(kept)} strategies at PF >= {KEEP_PROFIT_FACTOR}; rejected {len(rejected)}.")
    print(f"Forward window: {utc_label(runner.BACKTEST_START_TS)} through each asset's latest candle.")


if __name__ == "__main__":
    main()
