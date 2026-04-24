# Signal Console

Standalone Next.js app for the Signal Console.

This repo is organized around one app with one clear source tree:

- the Signal Console UI
- cron-based live signal checks
- Telegram alert delivery
- historical trade replay and prop-firm challenge analysis
- local CSV-backed market and strategy result data

## Project Layout

- `src/app/`: Next.js routes and API handlers
- `src/components/`: UI components grouped by feature
- `src/core/`: live strategy runtime, config, and strategy registry
- `src/lib/`: shared data loading, storage, Telegram, challenge, and type helpers
- `data/market/`: local chart CSVs used by the console
- `data/strategy-results/`: backtest summaries and trade-history CSVs

## Local Setup

```bash
npm install
npm run dev
```

Windows shortcut:

```bat
start_signal_console.bat
```

The launcher clears port `3000`, starts the dev server, and opens the site automatically. Keep the launcher window open while the website is running.

Optional checks:

```bash
npm run typecheck
npm run build
npm run market:update-volume
```

## Environment

Copy `.env.example` into `.env.local` and fill in the keys you want to use.

- `DATABENTO_API_KEY` for futures cron data
- `TWELVEDATA_API_KEYS` for forex and spot cron data
- `OANDA_API_TOKEN` for forex and spot candles with volume
- `OANDA_API_BASE_URL` defaults to `https://api-fxpractice.oanda.com` and can be set to `https://api-fxtrade.oanda.com` for a live token
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_CHAT_ID` for Telegram alerts
- `CRON_SECRET` to protect `/api/cron/check-trades`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` for persistent hosted storage

Without Upstash configured, local trade history falls back to `.local/signal-console-alerts.json`.

## Refreshing Market CSVs

Use the built-in refresh script to backfill `volume` into the local market CSVs:

```bash
npm run market:update-volume
```

Notes:

- futures CSVs are rebuilt from Databento 1-minute OHLCV and aggregated to 15-minute bars
- a full futures rebuild can consume a noticeable amount of Databento historical credits because it backfills the existing date range from 1-minute bars
- forex and `XAUUSD` CSVs are rebuilt from OANDA `M15` candles, where `volume` is OANDA candle activity count rather than centralized exchange volume
- pass `-- --group=futures` or `-- --symbols=ES,NQ,EURUSD` to limit the refresh scope
