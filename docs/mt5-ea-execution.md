# MT5 EA Execution (forex)

Pull-based MetaTrader 5 execution for forex signals. The in-terminal Expert
Advisor polls this app for orders, executes them, and reports fills back. All
traffic is **outbound from MT5 → this app**, so there is no inbound tunnel to the
Windows VM — that is the reliability win over the old push bridge.

## Flow

```
forex signal fires
  → executeAutoTrade routes to mt5_ea (AUTO_TRADE_FOREX_PROVIDER=mt5_ea)
  → risk-based lots computed, order enqueued (mt5_pending_orders, status=queued)
EA on MT5 terminal:
  → GET /ea/orders/pending/:account   (claims queued → claimed)
  → OrderSend()                       (executes on the broker)
  → POST /ea/orders/result/:orderId   (filled/rejected; alert mirror updated)
  → POST /ea/state, /ea/heartbeat     (balance + liveness, ~every 2s/10s)
position closes (SL/TP/manual):
  → POST /ea/fills/:account           (realized P&L reconciled onto the order + alert)
```

Dashboard: forex **Auto-Trade** drawer → **MT5 EA Execution** panel (connection,
balance/equity, fill rate, slippage, win rate, realized R/P&L, recent orders).

## Go-live steps

### 1. Environment (local `.env.local` + Vercel project env)

Required:

| Var | Value |
|---|---|
| `EA_INGEST_TOKEN` | a long random secret (the EA must send this as a bearer token) |
| `AUTO_TRADE_FOREX_PROVIDER` | `mt5_ea` |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | already set (the queue lives in Turso) |

Tuning (sensible defaults shown — see `.env.example`):

| Var | Default | Notes |
|---|---|---|
| `MT5_EA_DEMO_ACCOUNT_ID` | `mt5-demo-100k` | must match the EA's `BridgeAccountId` input |
| `MT5_EA_RISK_PER_TRADE_PCT` | `0.5` | percent of balance risked per trade (0.5 = 0.5%) |
| `MT5_EA_ACCOUNT_BALANCE` | `100000` | fallback until the EA reports live balance via `/ea/state` |
| `MT5_EA_MIN_LOT` / `MT5_EA_LOT_STEP` / `MT5_EA_MAX_LOT` | `0.01` / `0.01` / `50` | broker lot constraints + hard cap |
| `MT5_EA_SYMBOL_MAP` | — | broker symbol remap, e.g. `EURUSD:EURUSD.r,GBPJPY:GBPJPYm` |
| `MT5_EA_LOT_OVERRIDE` | — | fixed lots per symbol (bypasses risk calc) |
| `MT5_EA_PIP_VALUE_OVERRIDE` | — | calibrated USD-per-pip-per-1.0-lot per symbol (broker-exact sizing) |
| `MT5_EA_AUTO_TRADE_DRY_RUN` | `false` | **set `true` first** — computes + logs orders without enqueueing |
| `MT5_EA_ORDER_TTL_SECONDS` | `120` | queued orders expire if not claimed in time |

The existing `AUTO_TRADE_MAX_ALERTS_PER_CHECK` (2) and `AUTO_TRADE_MAX_RISK_PER_CHECK`
($1250) caps still apply. At 0.5%/trade, two concurrent alerts = $1000, under the cap.

### 2. Point the EA at this app

Download `public/mt5/KorraMT5ExecutionEA.mq5` from the website's MT5 Execution panel. In its inputs:

- `BackendBaseUrl` = `https://www.korra.space`
- `IngestToken` = the **same** value as `EA_INGEST_TOKEN`
- `ConnectionId` can stay blank. The EA automatically uses the signed-in MT5 account login, matching the ID created when the account was added on the website.

In MT5: **Tools → Options → Expert Advisors** → enable algo trading + **Allow
WebRequest for listed URL** and add `https://www.korra.space`. No `.mq5` code changes — the
EA speaks this contract already.

### 3. Verify (before flipping dry-run off)

1. Start the EA; confirm the green smiley. A row should appear in `ea_heartbeats`
   and the panel badge should show **live**.
2. With `MT5_EA_AUTO_TRADE_DRY_RUN=true`, wait for a forex signal (or trigger a
   test) and confirm the computed lots / SL / TP look right in the logs.
3. Set `MT5_EA_AUTO_TRADE_DRY_RUN=false` to begin real (demo) execution.
4. After the first few fills, back out actual risk (fill price vs stop) and set
   `MT5_EA_PIP_VALUE_OVERRIDE` per pair if sizing drifts from target.

## Disable / rollback

- **Stop new orders**: set `MT5_EA_AUTO_TRADE_ENABLED=false`, or repoint
  `AUTO_TRADE_FOREX_PROVIDER` away from `mt5_ea`.
- **Stop execution at the terminal**: set EA input `EnableOrderExecution=false`
  (it then reports orders as rejected/dry-run) or remove the EA from the chart.
- The schema is additive; no destructive rollback needed.

## Endpoints (bearer `EA_INGEST_TOKEN` on all)

| Method | Path | Purpose |
|---|---|---|
| GET | `/ea/orders/pending/:account` | claim queued orders |
| POST | `/ea/orders/result/:orderId` | report fill/reject (idempotent) |
| POST | `/ea/state/:account` | balance/equity snapshot |
| POST | `/ea/fills/:account` | SL/TP/manual close → realized P&L |
| POST | `/ea/heartbeat/:account` | liveness ping |
| GET | `/api/auto-trading/mt5-ea-status` | dashboard read (admin-authed) |

## Tables

- `mt5_pending_orders` — order queue + execution result + reconciled close P&L
- `mt5_account_state` — latest balance/equity/floating P&L per account
- `ea_heartbeats` — EA liveness + terminal state

## Known limits / next

- Realized P&L correlates a close deal to its open by `positionTicket = brokerTicket`;
  if a broker's position id differs from the opening order ticket, capture the
  position ticket on the result instead.
- Server-side pip values come from `config/assets.json` (close, not broker-exact)
  until calibrated via `MT5_EA_PIP_VALUE_OVERRIDE`.
- Stale `claimed` orders (EA crashed after claim, before reporting) are only
  re-delivered when the EA polls with `?includeStaleClaimed=true`; a reaper cron
  could be added if needed.
