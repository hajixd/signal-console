# Trading Bot

Trading Bot is a mixed TypeScript + Python trading research workspace built around one shared asset catalog, one shared candle store, one folder per strategy, one shared backtest engine, and one Next.js dashboard for reviewing results and live alerts.

This repo is set up so strategy research, backtests, live signal checks, Telegram alerts, and UI reporting all point at the same organized file layout.

For deploys, the app is now designed to keep heavy runtime CSV assets out of Vercel and Git when desired:

- Firebase Storage holds market CSVs, backtest CSVs, and the generated backtest manifest.
- Firestore holds alert history, cron run history, and the saved live strategy config.
- The app falls back to local files only when Firebase Admin is not configured.

## Repo Snapshot

- Current asset catalog: 39 assets
- Stored candle timeframes: 15m, 30m, 45m, 1h, 4h, 1d, 1w
- Current strategy folders: 65
- Current live/runtime strategy families in `src/lib/strategy-runtime/`: 8
- Hard rule: every strategy trades exactly one `assetKey` / symbol

## High-Level Architecture

1. `config/assets.json` defines every tradable asset and its pricing metadata.
2. `data/15m/*.csv` is the base candle store.
3. `backtest-engine/runner.py prepare-data` rebuilds the higher timeframe folders from the 15m base files.
4. Each `strategy/<folder>/` stores one strategy definition, one metadata file, and its generated backtest output.
5. The Python backtest engine reads strategy metadata and writes `backtest_trades.csv` back into each strategy folder.
6. The Next.js app reads those CSVs to build the dashboard.
7. The cron APIs split runtime work into market-data sync and signal/trade checks.

## Project Structure

```text
tradingBot/
  AI_README.md
  README.md
  backtest-engine/
  config/
  data/
    15m/
    30m/
    45m/
    1h/
    4h/
    1d/
    1w/
  src/
    app/
    components/
    lib/
  strategy/
    <strategy-folder>/
      strategy.ts
      backtest_trades.csv
      machine_learning/selection.json
      or parameters/backtest.json
  .env.example
  launch_tradingBot.bat
  next.config.ts
  package.json
  requirements.txt
  tsconfig.json
  vercel.json
```

## File Map

### Root files

- `README.md`: human-facing project documentation.
- `AI_README.md`: AI / LLM / agent-oriented repo guide.
- `.env.example`: environment variable template for providers, Telegram, Firebase Admin, cron auth, and Topstep risk limits.
- `.gitignore`: ignore rules for generated files and local artifacts.
- `.vercelignore`: keeps local-only research datasets out of direct Vercel uploads.
- `firebase.json`: Firebase deploy config for Firestore and Storage rules.
- `firestore.rules`: locked-down Firestore rules for server-only use.
- `launch_tradingBot.bat`: Windows launcher that installs dependencies if needed, finds a free port, starts Next dev, and opens the site.
- `next.config.ts`: small Next.js config file.
- `next-env.d.ts`: Next.js TypeScript environment types.
- `package.json`: Node scripts and frontend dependencies.
- `package-lock.json`: npm lockfile.
- `requirements.txt`: Python backtest dependencies.
- `storage.rules`: locked-down Firebase Storage rules for server-only use.
- `tsconfig.json`: TypeScript compiler config and repo path aliases.
- `vercel.json`: Vercel Pro cron schedule for market-data sync and signal checks.

### `config/`

- `config/assets.json`: the central asset catalog. This is where symbols, names, markets, tick sizes, dollar-per-unit values, display labels, and provider symbols live.

### `backtest-engine/`

- `backtest-engine/runner.py`: the main Python engine. It prepares data, loads strategy metadata, enriches candles, runs backtests, handles TP/SL logic, and writes trade CSVs.
- `backtest-engine/tune_strategy_metadata.py`: retunes strategy metadata and rewrites per-strategy metadata plus `backtest_trades.csv`.
- `backtest-engine/research_trader_strategies.py`: generates research-driven strategy folders from playbooks, rewrites the strategy loader, and writes research-based metadata.
- `backtest-engine/research_cross_market_strategies.py`: runs cross-market experiments and writes CSV reports under `backtest-engine/research/`.
- `backtest-engine/materialize_cross_market_candidates.py`: turns strong cross-market research rows into real strategy folders and updates the loader.
- `backtest-engine/materialize_opposite_strategies.py`: clones selected strategies as opposite-signal variants and updates the loader.
- `backtest-engine/validate_catalog.py`: validates that strategy folders, metadata, and `src/lib/strategy-loader.ts` all agree.
- `backtest-engine/research/cross_market_results.csv`: generated research output with all tested cross-market results.
- `backtest-engine/research/cross_market_best.csv`: generated filtered cross-market candidates.
- `backtest-engine/research/*.log`: generated research logs.
- `backtest-engine/__pycache__/`: generated Python cache files.

### `data/`

- `data/15m/*.csv`: the primary candle source files the engine uses.
- `data/30m/*.csv`: resampled 30-minute candles generated from 15m.
- `data/45m/*.csv`: resampled 45-minute candles generated from 15m.
- `data/1h/*.csv`: resampled 1-hour candles generated from 15m.
- `data/4h/*.csv`: resampled 4-hour candles generated from 15m.
- `data/1d/*.csv`: resampled daily candles generated from 15m.
- `data/1w/*.csv`: resampled weekly candles generated from 15m.

### `src/app/`

- `src/app/layout.tsx`: root HTML shell and theme bootstrapping.
- `src/app/page.tsx`: main dashboard page that loads strategy catalog data, backtest stats, live rules, alerts, and challenge replay data.
- `src/app/globals.css`: app-wide styling.
- `src/app/favicon.ico`: site icon.
- `src/app/api/trade-chart/route.ts`: returns a 15m candle window around a selected trade for charting.
- `src/app/api/cron/market-data-sync/route.ts`: 5-minute live market data refresh endpoint.
- `src/app/api/cron/check-signals/route.ts`: 15-minute live signal/trade check endpoint used by cron and manual calls.

### `src/components/`

- `src/components/ui/theme-toggle.tsx`: theme switcher.
- `src/components/strategies/strategy-selector.tsx`: searchable strategy picker and strategy metadata display.
- `src/components/strategies/selected-strategy-stats.tsx`: aggregated stats and summary UI for the selected strategies.
- `src/components/strategies/strategy-edits-store.ts`: localStorage-backed contract sizing edits and helpers used by the dashboard.
- `src/components/challenge/challenge-rules-form.tsx`: form for editing challenge / prop-firm replay rules.
- `src/components/challenge/challenge-replay.tsx`: challenge replay and Monte Carlo pass-rate UI.
- `src/components/trades/trade-history.tsx`: detailed trade table and supporting chart UI.
- `src/components/trades/editable-trade-history.tsx`: trade history wrapper that applies user-editable sizing overrides.
- `src/components/trades/trade-price-chart.tsx`: candlestick chart rendering built on `lightweight-charts`.

### `src/lib/`

- `src/lib/assets.ts`: loads the asset catalog and exports asset lookup helpers and timeframe constants.
- `src/lib/backtest.ts`: reads the generated backtest manifest when Firebase is configured, otherwise falls back to local `backtest_trades.csv` files.
- `src/lib/challenge.ts`: historical and Monte Carlo challenge replay math.
- `src/lib/firebase-admin.ts`: initializes the server-only Firebase Admin app and Storage bucket.
- `src/lib/indicators.ts`: enriches bars with shared indicators and session metadata.
- `src/lib/live-config.ts`: persists saved live strategy config, dataset sync metadata, and cron run history in Firestore or `.local/`.
- `src/lib/instruments.ts`: dollar-per-unit math, instrument size labels, and recommended size multipliers.
- `src/lib/live-signals.ts`: converts backtest stats into live `StrategyRule` objects and evaluates the latest signal.
- `src/lib/market-data.ts`: fetches live futures / forex / gold bars from Databento, OANDA, or TwelveData.
- `src/lib/project-assets.ts`: reads runtime assets from Firebase Storage first, then local files as a fallback.
- `src/lib/storage.ts`: stores alert history in Firestore or a local JSON file under `.local/`.
- `src/lib/strategy-definition.ts`: core TypeScript strategy types and `createStrategyDefinition`.
- `src/lib/strategy-loader.ts`: explicit import list of every strategy folder used by the UI / live path.
- `src/lib/telegram.ts`: Telegram message formatting and sending.
- `src/lib/topstep.ts`: Topstep-specific futures risk guards, scoring, and session checks.
- `src/lib/trade-planner.ts`: turns raw strategy signals into final entry / TP / SL / size plans.
- `src/lib/types.ts`: shared types for bars, rules, alerts, policies, and challenge results.

### `src/lib/strategy-runtime/`

- `src/lib/strategy-runtime/constants.ts`: shared constants like long / short and session opens.
- `src/lib/strategy-runtime/helpers.ts`: tick rounding, trend filters, prior-day range logic, and ORB window helpers.
- `src/lib/strategy-runtime/runtime-config.ts`: parses `variantId` tokens into runtime config.
- `src/lib/strategy-runtime/echo-style.ts`: reusable momentum / echo-style evaluator logic.
- `src/lib/strategy-runtime/momentum.ts`: momentum strategy entry point that delegates to the shared echo-style evaluator.
- `src/lib/strategy-runtime/reddit-ema-pullback.ts`: EMA pullback evaluator.
- `src/lib/strategy-runtime/reddit-capitulation-reversion.ts`: capitulation / mean-reversion evaluator.
- `src/lib/strategy-runtime/reddit-orb-breakout.ts`: opening range breakout evaluator.
- `src/lib/strategy-runtime/reddit-orb-retest.ts`: opening range retest evaluator.
- `src/lib/strategy-runtime/ict-sweep-fvg.ts`: ICT sweep plus FVG evaluator.
- `src/lib/strategy-runtime/ict-turtle-soup.ts`: ICT turtle soup evaluator.
- `src/lib/strategy-runtime/ny-sweep-playbook.ts`: NY sweep evaluator with lightweight scoring models like `logit`, `bayes`, and `stump`.

### `strategy/`

- `strategy/<folder>/strategy.ts`: the TypeScript strategy definition used by the UI / live runtime.
- `strategy/<folder>/backtest_trades.csv`: generated backtest output for that strategy.
- `strategy/<folder>/machine_learning/selection.json`: common metadata file for ML-selected or classifier-based strategies.
- `strategy/<folder>/parameters/backtest.json`: common metadata file for non-ML parameterized strategies.
- `strategy/<folder>/bayes/selection.json`: also recognized by the Python engine if used.
- `strategy/<folder>/research/README.md`: optional research note written by some generation flows.
- `strategy/research_summary.csv`: generated summary of strategy research results.
- `strategy/tuning_summary.csv`: generated summary of tuning results.

### Generated / runtime-only directories

- `.next/`: generated Next.js build artifacts.
- `node_modules/`: installed npm packages.
- `.local/`: local alert storage fallback.
- `tsconfig.tsbuildinfo`: generated TypeScript incremental cache.
- `.codex-next-dev.log`: local dev log file.

## Strategy Model

### One strategy, one symbol

- Every strategy folder is meant to represent exactly one traded instrument.
- The authoritative traded instrument is the `assetKey` inside metadata and `strategy.ts`.
- Folder names can include research history such as `_on_<asset>` or `_opposite`, but the actual traded symbol is still whatever `assetKey` says.
- `validate_catalog.py` checks that folder names, metadata, and strategy definitions stay aligned.

### Two parallel strategy paths

- TypeScript path: `strategy/<folder>/strategy.ts` plus `src/lib/strategy-loader.ts` powers the website and live signal evaluation.
- Python path: `backtest-engine/runner.py` does not import `strategy.ts`. It discovers strategy metadata under `strategy/*/{machine_learning,bayes,parameters}` and backtests by `phase`, `variantId`, and shared metadata fields.
- Generated output: `strategy/<folder>/backtest_trades.csv` is output, not source code.

### Current phase families in the repo

- `momentum`
- `ny_sweep_playbook`
- `ict_sweep_fvg`
- `ict_turtle_soup`
- `reddit_ema_pullback`
- `reddit_capitulation_reversion`
- `reddit_orb_breakout`
- `reddit_orb_retest`
- `support_resistance_retest`
- `vwap_pullback`

The Python engine also contains extra research/backtest-only phase implementations such as `parabolic_fade`, `vwap_pullback`, `support_resistance_retest`, `trendline_break`, and some aliases like `ma_pullback` and `ema_rider`.

## Data and Timeframes

### Timeframes

- Available candle folders: `15m`, `30m`, `45m`, `1h`, `4h`, `1d`, `1w`
- `15m` is the base source-of-truth dataset for the shared engine.
- Higher timeframes are rebuilt from the 15m files by `npm run prepare:data`.
- The current shared live/backtest runtime primarily executes on enriched 15m bars and derives prior-day structure from that stream, but the higher timeframe CSVs are stored and available for research, feature engineering, and future multi-timeframe expansion.

### Asset catalog

- Futures: `6A` Australian Dollar Futures, `6B` British Pound Futures, `6C` Canadian Dollar Futures, `6E` Euro Futures, `6J` Japanese Yen Futures, `CL` Crude Oil Futures, `ES` S&P 500 Futures, `GC` Gold Futures, `HG` Copper Futures, `NG` Natural Gas Futures, `NQ` Nasdaq 100 Futures, `RTY` Russell 2000 Futures, `SI` Silver Futures, `YM` Dow Jones Futures, `ZB` US Treasury 30Y Bond Futures, `ZN` US Treasury 10Y Note Futures
- Forex: `AUDUSD`, `EURUSD`, `GBPUSD`, `NZDUSD`, `USDCAD`, `USDCHF`, `USDJPY`
- Spot: `XAUUSD` Gold Spot

## Universal Strategy Controls

The repo already supports a shared, reusable strategy metadata model across many strategies.

### Shared strategy metadata fields

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

### Supported TP / SL / size policies

- Fixed TP / SL via `tpUnits` and `slUnits`
- Custom stop losses via `stopLossPolicy.mode = signal_extreme` or `prior_day_extreme`
- Custom take profits via `takeProfitPolicy.mode = risk_multiple`, `signal_extreme`, or `prior_day_extreme`
- Dynamic stop losses via `dynamicStopLossPolicy.mode = trail_prior_bar`
- Dynamic take profits via `dynamicTakeProfitPolicy.mode = trail_prior_bar` or `risk_multiple`
- Fixed size via `sizeMultiplier`
- Dynamic size via `sizePolicy.mode = confidence`

### Shared enriched candle variables

`src/lib/indicators.ts` and the Python engine both expose a broad set of reusable bar features:

- EMA 9, 12, 21, 30, 34, 50, 200
- ATR 14 and ATR 100
- RSI 2 and centered RSI 14
- ADX 14
- Bollinger Z-score / width metrics
- close-location metrics
- short-horizon ATR-normalized returns
- body-vs-ATR
- session VWAP, VWAP Z-score, and VWAP slope
- New York session date / minute / weekday
- close-vs-EMA200 ATR distance
- prior-day high / low context
- rolling `priorHigh55`

## Backtest Engine

The Python backtest engine is the shared execution core for strategy testing.

### What it does

- loads strategy metadata from strategy folders
- loads 15m candles
- enriches bars with shared indicators and session metadata
- evaluates phase-specific signal logic
- supports market entries on the next bar open
- supports limit entries via pending orders
- supports fixed, custom, and dynamic TP / SL handling
- supports fixed or confidence-scaled sizing
- supports one-trade-per-day rules
- supports signal inversion
- applies gap-aware exit handling
- supports a strict anti-cheat mode that slices the visible data window before each decision
- writes results back to `strategy/<folder>/backtest_trades.csv`

### Important implementation detail

- If you add a new strategy instance that uses an existing supported `phase`, the Python engine can usually backtest it from metadata alone.
- If you add a brand-new `phase`, you need matching support in both `src/lib/strategy-runtime/` and `backtest-engine/runner.py` if you want live/backtest parity.

## Research and Materialization Scripts

- `python backtest-engine/validate_catalog.py`: checks that strategy folders, metadata, and the loader stay in sync.
- `python backtest-engine/tune_strategy_metadata.py`: retunes existing strategy metadata and rewrites backtest outputs.
- `python backtest-engine/research_cross_market_strategies.py`: explores how existing strategies behave on other assets.
- `python backtest-engine/materialize_cross_market_candidates.py`: converts strong cross-market research rows into strategy folders.
- `python backtest-engine/materialize_opposite_strategies.py --strategy <id>`: clones opposite-signal versions of strategies.
- `python backtest-engine/research_trader_strategies.py`: rebuilds the strategy catalog from research playbooks.

Important: `research_trader_strategies.py` clears and rebuilds the `strategy/` directory before writing new results. Treat it as a catalog-regeneration script, not a harmless report script.

## Website and Live Signal Flow

- The dashboard reads strategy catalog data and backtest CSVs through `src/lib/backtest.ts`.
- `src/lib/live-signals.ts` converts backtest stats into live `StrategyRule` objects.
- `/api/cron/market-data-sync` refreshes recent provider bars for enabled live assets and updates chart data.
- `/api/cron/check-signals` fetches recent market bars once per live asset, evaluates live-enabled strategies, runs Topstep-style risk guards, deduplicates alerts, stores them, and optionally sends Telegram messages or auto-trades.
- Alert storage lives in Firestore if Firebase Admin is configured, otherwise `.local/trading-bot-alerts.json`.

## Vercel And Firebase Runtime

The intended production path is:

1. Keep large local CSV folders out of the deployment payload and Git history.
2. Upload `data/**/*.csv`, `strategy/**/*.csv`, and strategy metadata JSON to Firebase Storage.
3. Generate and upload `cache/backtest-manifest.json` so the dashboard can read one runtime manifest instead of scanning the filesystem.
4. Let Firestore store:
   - `signalConsoleAlerts`
   - `signalConsoleConfig`
   - `signalConsoleCronRuns`
   - `signalConsoleDatasets`

The app already supports this layout. Once Firebase Admin env vars are present, it automatically prefers Storage + Firestore over local `.local/` files.

## Commands

Install frontend dependencies:

```bash
npm install
```

Install Python dependencies:

```bash
python -m pip install -r requirements.txt
```

Run the website:

```bash
npm run dev
```

Or launch with the Windows helper:

```bash
launch_tradingBot.bat
```

Rebuild higher timeframes from `data/15m`:

```bash
npm run prepare:data
```

Run all backtests:

```bash
npm run backtest
```

Run a single strategy:

```bash
python backtest-engine/runner.py run-backtests --strategy <strategy-id-or-folder>
```

Run a smoke test without overwriting CSVs:

```bash
python backtest-engine/runner.py run-backtests --strategy <strategy-id-or-folder> --tail-bars 1500 --no-write
```

Run strict anti-cheat mode:

```bash
python backtest-engine/runner.py run-backtests --strategy <strategy-id-or-folder> --strict-anti-cheat
```

List available backtests:

```bash
python backtest-engine/runner.py list-backtests
```

Validate folder / loader consistency:

```bash
python backtest-engine/validate_catalog.py
```

Type-check the app:

```bash
npm run typecheck
```

Build the production app:

```bash
npm run build
```

Upload runtime CSVs and refresh the Firebase manifest:

```bash
npm run firebase:sync
```

Update the saved live selection:

```bash
npm run firebase:live-config -- --enabled strategy_a,strategy_b --dashboard strategy_a
```

## Environment Variables

Market data:

- `DATABENTO_API_KEY`
- `TWELVEDATA_API_KEYS`
- `OANDA_API_TOKEN`
- `OANDA_API_BASE_URL`

Telegram:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME`
- `TELEGRAM_CHAT_ID`

Cron auth:

- `CRON_SECRET`
- `APP_ADMIN_SECRET`

Firebase Admin:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_PRIVATE_KEY_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `SIGNAL_CONSOLE_STORAGE_PREFIX`

Optional Topstep-style live limits:

- `TOPSTEP_MAX_ALERTS_PER_CHECK`
- `TOPSTEP_MAX_RISK_PER_CHECK`

Telegram alerts:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_GROUP_CHAT_ID`
- `TELEGRAM_GROUP_INVITE_LINK`
- `TELEGRAM_GROUP_TITLE`
- `TELEGRAM_TRADE_UPDATE_LOOKBACK_HOURS`
- `TELEGRAM_BOT_USERNAME`

Create the Telegram group in Telegram, add the bot as a member, make it an admin if you want it to post without restrictions, then set `TELEGRAM_GROUP_CHAT_ID` to the group chat id. Set `TELEGRAM_GROUP_INVITE_LINK` to the group's public or invite link so dashboard users can join from the header. The signal cron sends organized entry alerts and one TP/SL follow-up when a recent stored trade reaches its level. `TELEGRAM_TRADE_UPDATE_LOOKBACK_HOURS` defaults to 72 to avoid backfilling old alerts into a new group.

## Admin Routes

Both admin routes require `Authorization: Bearer <APP_ADMIN_SECRET>` and fall back to `CRON_SECRET` if `APP_ADMIN_SECRET` is unset.

- `GET/POST /api/admin/live-config`: inspect or update the saved live strategy config.
- `GET/POST /api/admin/test-telegram`: inspect Telegram setup or send a manual test message.

## Recommended Workflow For Adding Or Updating A Strategy

1. Decide whether the strategy uses an existing `phase` or needs a new one.
2. Make sure the target asset exists in `config/assets.json`.
3. Make sure the asset has a valid `data/15m/<asset>.csv`.
4. Run `npm run prepare:data` if candle inputs changed.
5. Create or update `strategy/<folder>/strategy.ts`.
6. Create or update the strategy metadata JSON under `machine_learning/selection.json` or `parameters/backtest.json`.
7. Register the strategy in `src/lib/strategy-loader.ts` if it should appear in the app and live path.
8. Run `python backtest-engine/validate_catalog.py`.
9. Run the backtest engine.
10. Review the generated `backtest_trades.csv`, the dashboard, and the cron/live behavior.

For agent-specific instructions, see `AI_README.md`.
