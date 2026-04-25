# AI README

This file is for LLMs, agents, and automated strategy workers operating inside this repo.

The goal is simple: let an agent research, add, tune, backtest, and review strategies without misunderstanding where the real source of truth lives.

## Hard Rules

- Every strategy trades exactly one symbol.
- The authoritative traded instrument is `assetKey`, not just the folder name.
- `backtest_trades.csv` is generated output. Do not treat it as source code.
- The Python backtester reads strategy metadata JSON and `phase`. It does not import the TypeScript `strategy.ts` file.
- The website and live signal path do use `strategy.ts` and `src/lib/strategy-loader.ts`.
- A new strategy folder will not appear in the app until it is imported in `src/lib/strategy-loader.ts`.
- If you add a new `phase`, you need matching logic in both the TypeScript runtime and the Python backtest engine if you want live/backtest parity.
- `research_trader_strategies.py` clears and rebuilds the entire `strategy/` directory. Do not run it casually.

## Source Of Truth By Concern

### Asset definitions

- `config/assets.json`

This controls:

- `symbol`
- `name`
- `market`
- `dataFile`
- `tickSize`
- `dollarPerUnit`
- `sizeLabel`
- `unitLabel`
- provider symbols like Databento / OANDA / TwelveData mappings

### Candle storage

- `data/15m/<asset>.csv` is the base shared dataset
- `data/30m`, `data/45m`, `data/1h`, `data/4h`, `data/1d`, `data/1w` are derived datasets

### Backtest strategy inputs

The Python engine scans strategy folders for one metadata file in this order:

1. `strategy/<folder>/machine_learning/selection.json`
2. `strategy/<folder>/bayes/selection.json`
3. `strategy/<folder>/parameters/backtest.json`

Those metadata files are the source of truth for Python backtests.

### Live / UI strategy inputs

- `strategy/<folder>/strategy.ts`
- `src/lib/strategy-loader.ts`

These are the source of truth for the Next.js UI and live signal evaluation.

### Generated outputs

- `strategy/<folder>/backtest_trades.csv`
- `strategy/research_summary.csv`
- `strategy/tuning_summary.csv`
- `backtest-engine/research/*.csv`
- `backtest-engine/research/*.log`

## Current Assets Available To Strategies

### Futures

- `australian_dollar_futures` (`6A`)
- `british_pound_futures` (`6B`)
- `canadian_dollar_futures` (`6C`)
- `euro_futures` (`6E`)
- `japanese_yen_futures` (`6J`)
- `crude_oil_futures` (`CL`)
- `sp_500_futures` (`ES`)
- `gold_futures` (`GC`)
- `copper_futures` (`HG`)
- `natural_gas_futures` (`NG`)
- `nasdaq_100_futures` (`NQ`)
- `russell_2000_futures` (`RTY`)
- `silver_futures` (`SI`)
- `dow_jones_futures` (`YM`)
- `us_treasury_30y_bond_futures` (`ZB`)
- `us_treasury_10y_note_futures` (`ZN`)

### Forex

- `aud_usd` (`AUDUSD`)
- `eur_usd` (`EURUSD`)
- `gbp_usd` (`GBPUSD`)
- `nzd_usd` (`NZDUSD`)
- `usd_cad` (`USDCAD`)
- `usd_chf` (`USDCHF`)
- `usd_jpy` (`USDJPY`)

### Spot

- `gold_spot` (`XAUUSD`)

## Timeframes Available For Strategy Building

Available stored timeframes:

- `15m`
- `30m`
- `45m`
- `1h`
- `4h`
- `1d`
- `1w`

Important nuance:

- The shared backtest/live engine currently executes on enriched 15m candles as its primary decision stream.
- Prior-day structure is already available from that stream.
- The higher timeframe CSVs are still present and usable for research, offline feature engineering, and future engine expansion.
- If you want true multi-timeframe execution inside the shared engine, extend both the TypeScript runtime and the Python runner so they both understand the extra timeframe inputs.

## Current Strategy Families

### TypeScript runtime evaluators already present

- `momentum`
- `ny_sweep_playbook`
- `ict_sweep_fvg`
- `ict_turtle_soup`
- `reddit_ema_pullback`
- `reddit_capitulation_reversion`
- `reddit_orb_breakout`
- `reddit_orb_retest`

### Python backtest engine also supports extra research phases

- `parabolic_fade`
- `vwap_pullback`
- `support_resistance_retest`
- `trendline_break`
- `ma_pullback`
- `ema_rider`

If you use one of those Python-only research phases and want the strategy to be live-capable in the app, add or verify the matching TypeScript runtime evaluator first.

## Strategy Folder Contract

Every strategy folder should follow this pattern:

```text
strategy/<folder>/
  strategy.ts
  backtest_trades.csv
  machine_learning/selection.json
  or parameters/backtest.json
  optional research/README.md
```

### Minimum live/UI file

```ts
import { createStrategyDefinition } from "@/lib/strategy-definition";
import { evaluateMomentum } from "@/lib/strategy-runtime/momentum";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "example_strategy_id",
  label: "Example Strategy",
  folder: "example_strategy_id",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gold_futures",
  phase: "momentum",
  liveEnabled: true,
  evaluator: evaluateMomentum,
  defaults: {
    variantId: parameters.variantId,
    source: parameters.source,
    tpUnits: parameters.tpUnits ?? undefined,
    slUnits: parameters.slUnits ?? undefined,
    sizeMultiplier: parameters.sizeMultiplier ?? undefined
  }
});
```

### Minimum metadata file

```json
{
  "strategyId": "example_strategy_id",
  "label": "Example Strategy",
  "folder": "example_strategy_id",
  "assetKey": "gold_futures",
  "phase": "momentum",
  "variantId": "momentum_tuned|sig=2|lookback=10|abs=1|tp=75|sl=200|one_trade=1",
  "source": "manual_agent_build",
  "tpUnits": 75,
  "slUnits": 200,
  "oneTradePerDay": true,
  "costUnits": 0.0
}
```

## Strategy Metadata Capabilities

This repo already supports fixed, custom, and moving trade management. Use the built-in metadata model instead of inventing new ad hoc fields unless the engine truly needs new behavior.

### Fixed TP / SL

Use:

- `tpUnits`
- `slUnits`

These are the simplest set take-profit / stop-loss controls.

### Custom static stop losses

Supported `stopLossPolicy.mode` values:

- `signal_extreme`
- `prior_day_extreme`

Example:

```json
"stopLossPolicy": {
  "mode": "signal_extreme",
  "bufferUnits": 5.0
}
```

### Custom static take profits

Supported `takeProfitPolicy.mode` values:

- `risk_multiple`
- `signal_extreme`
- `prior_day_extreme`

Examples:

```json
"takeProfitPolicy": {
  "mode": "risk_multiple",
  "rewardMultiple": 2.0
}
```

```json
"takeProfitPolicy": {
  "mode": "prior_day_extreme",
  "bufferUnits": 0.0
}
```

### Moving stop losses

Supported `dynamicStopLossPolicy.mode` values:

- `trail_prior_bar`

Example:

```json
"dynamicStopLossPolicy": {
  "mode": "trail_prior_bar",
  "bufferUnits": 2.0
}
```

### Moving take profits

Supported `dynamicTakeProfitPolicy.mode` values:

- `trail_prior_bar`
- `risk_multiple`

Examples:

```json
"dynamicTakeProfitPolicy": {
  "mode": "trail_prior_bar",
  "bufferUnits": 0.0
}
```

```json
"dynamicTakeProfitPolicy": {
  "mode": "risk_multiple",
  "rewardMultiple": 2.5
}
```

### Position sizing / units

You can size trades in three ways:

- auto size via the shared `recommendedSizeMultiplier`
- fixed size via `sizeMultiplier`
- dynamic confidence-based size via `sizePolicy`

Supported `sizePolicy.mode` values:

- `confidence`

Example:

```json
"sizePolicy": {
  "mode": "confidence",
  "minMultiplier": 0.75,
  "maxMultiplier": 1.25,
  "minConfidence": 0.6,
  "maxConfidence": 0.8
}
```

Important:

- If you use `sizePolicy`, the evaluator must emit `score` or `confidence` in the range `0..1`.
- The Python engine will reject invalid confidence policy ranges or missing confidence outputs.

## Universal Strategy Variables

These are the most reusable repo-wide variables and controls for strategy building.

### Universal metadata fields

- `phase`
- `variantId`
- `source`
- `signalAtrMult`
- `recentSignalLookback`
- `absCloseEma200AtrMax`
- `ictRiskReward`
- `tpUnits`
- `slUnits`
- `sizeMultiplier`
- `oneTradePerDay`
- `costUnits`
- `invertSignal`

### Common `variantId` tokens already in use

- session and structure tokens like `ny`, `london`, `all`, `range`, `entry`
- risk / exit tokens like `rr`, `sl_atr`, `tp_atr`, `max_bars`
- filter tokens like `threshold`, `adx_max`, `adx_min`, `rsi2`, `trend`
- NY sweep / classifier tokens like `model`, `min`, `start`, `end`, `max_tests`, `risk_min`, `risk_max`, `min_wick`
- momentum tuning tokens like `sig`, `lookback`, `abs`, `tp`, `sl`
- behavior flags like `one_trade=1` and `inverse=1`

### Shared enriched bar features

The repo already computes a strong universal feature set. Reuse these before inventing new preprocessing:

- EMA 9 / 12 / 21 / 30 / 34 / 50 / 200
- ATR 14 / 100
- RSI 2
- centered RSI 14
- ADX 14
- Bollinger Z-score and Bollinger width metrics
- close location in the candle
- 3-bar and 6-bar ATR-normalized returns
- candle body vs ATR
- session VWAP
- VWAP Z-score and VWAP slope vs ATR
- New York date, minute, weekday
- close-vs-EMA200 ATR distance
- prior-day highs and lows
- rolling prior high windows

This means agents can build:

- pure rules-based strategies
- threshold filters
- classifier filters
- candle-pattern detectors
- hybrid rule + lightweight-ML strategies

## Machine Learning Guidance

Lightweight is better in this repo.

Prefer:

- small deterministic scoring models
- naive Bayes style classifiers
- simple logistic-style scorers
- decision stumps
- compact rule-based classifiers

Current examples already use:

- `model=logit`
- `model=bayes`
- `model=stump`

These models are used mainly as:

- entry filters
- pattern-quality classifiers
- candle-structure scoring layers

The existing NY sweep implementation is a good template. It scores features like:

- wick size
- reclaim quality
- freshness of the swing
- prior test count
- candle body strength
- trend alignment
- close location
- RSI context
- ATR-relative risk

That same pattern can be reused for:

- candle-pattern classification
- breakout quality filters
- mean-reversion confirmation filters
- session-specific setup grading

If you add heavier ML:

- keep the output deterministic for backtests
- keep metadata compact
- prefer writing final selected parameters into JSON metadata
- avoid making the shared backtest path depend on large opaque model files unless it is truly necessary

## Strategy Signal Interface

### TypeScript evaluators can emit

- side
- entry price
- take-profit price
- stop-loss price
- TP / SL units
- signal time
- market or limit entry hints
- take-profit mode including risk-multiple logic
- score / confidence
- size multiplier
- notes

### Python backtest normalization can consume

- market entries
- limit entries
- explicit stop / TP prices
- TP via risk multiple
- fixed TP / SL units
- score / confidence for confidence-based sizing
- optional inversion

## Single-Symbol Invariant

Each strategy still applies to one symbol even if the folder name looks cross-market.

Examples:

- A folder name can include `_on_copper_futures`.
- That does not make it multi-asset at execution time.
- The real traded symbol is still the `assetKey` inside metadata and `strategy.ts`.

So the correct rule is:

- one folder
- one `assetKey`
- one traded symbol

Cross-market research in this repo means "take a strategy idea and materialize it onto another single target asset", not "trade multiple symbols at once in one strategy instance".

## Safe Workflow For An Agent

1. Decide whether the strategy is an existing `phase` or a new `phase`.
2. If it is an existing `phase`, prefer creating a new folder plus metadata instead of inventing a new engine path.
3. If it is a new `phase`, add the TypeScript evaluator and the Python backtest evaluator together.
4. Make sure the target asset exists in `config/assets.json`.
5. Make sure the target asset has a valid `data/15m/<asset>.csv`.
6. Run `npm run prepare:data` if candle inputs changed.
7. Create the strategy folder with `strategy.ts` and metadata JSON.
8. Add the strategy import to `src/lib/strategy-loader.ts`.
9. Run `python backtest-engine/validate_catalog.py`.
10. Run the backtest for just that strategy first.
11. Use strict anti-cheat mode for audit runs.
12. Only after validation should you trust the generated `backtest_trades.csv`.

## Important Commands For Agents

Rebuild higher timeframe data:

```bash
npm run prepare:data
```

Run all backtests:

```bash
npm run backtest
```

Run one strategy:

```bash
python backtest-engine/runner.py run-backtests --strategy <strategy-id-or-folder>
```

Run a no-write smoke test:

```bash
python backtest-engine/runner.py run-backtests --strategy <strategy-id-or-folder> --tail-bars 1500 --no-write
```

Run strict anti-cheat:

```bash
python backtest-engine/runner.py run-backtests --strategy <strategy-id-or-folder> --strict-anti-cheat
```

List discovered backtests:

```bash
python backtest-engine/runner.py list-backtests
```

Validate strategy folder / loader consistency:

```bash
python backtest-engine/validate_catalog.py
```

## Scripts With Side Effects

### Safe or mostly safe

- `runner.py prepare-data`: rewrites timeframe CSVs from `data/15m`
- `runner.py run-backtests`: rewrites per-strategy `backtest_trades.csv`
- `validate_catalog.py`: read-only validation
- `research_cross_market_strategies.py`: writes research CSVs and logs under `backtest-engine/research/`

### Mutates strategy metadata or strategy folders

- `tune_strategy_metadata.py`: rewrites metadata and backtest CSVs
- `materialize_opposite_strategies.py`: creates cloned strategy folders and rewrites the loader
- `materialize_cross_market_candidates.py`: creates strategy folders and rewrites the loader

### Destructive to the current strategy catalog

- `research_trader_strategies.py`: clears `strategy/` and regenerates strategy folders plus the loader

## Final Mental Model

Think of the repo as four layers:

1. `config/assets.json` defines what can be traded.
2. `data/` stores candles for those assets across multiple timeframes.
3. `strategy/` stores one-symbol strategy instances plus their metadata and generated backtest results.
4. `src/` and `backtest-engine/` are the two execution layers.

`src/` handles UI and live checks. `backtest-engine/` handles research and backtests.

If an agent respects that layout, it can safely research strategies, test them, tune them, and add them without breaking the catalog.
