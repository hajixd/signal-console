# SignalConsoleEA — pull-based MT5 executor

The app queues orders; this EA polls for them, places them on the local terminal,
and reports results back. **Every call goes outbound over HTTPS**, so the machine
running MT5 needs no public port and the token is never sent in cleartext.

This is why it is preferred over `bridges/mt5` (push): that one is plain
`http.server` with the shared secret in the request *body*, which would require
exposing a cleartext HTTP port on a box holding live broker credentials.

## App-side env

```
EA_INGEST_TOKEN=<generate: openssl rand -hex 32>
AUTO_TRADE_FOREX_PROVIDER=mt5_ea
MT5_EA_AUTO_TRADE_ENABLED=true
MT5_EA_AUTO_TRADE_DRY_RUN=true          # flip to false once fills look right
MT5_EA_DEMO_ACCOUNT_ID=mt5-demo-100k    # must equal the EA's BridgeAccountId
```

## Terminal-side

1. Copy `SignalConsoleEA.mq5` into `MQL5\Experts\` of the terminal's **data folder**
   (File > Open Data Folder), then compile it in MetaEditor (F7).
2. `Tools > Options > Expert Advisors`:
   - tick **Allow algorithmic trading**
   - tick **Allow WebRequest for listed URL** and add the app's base URL
     (exactly as passed to `BridgeUrl`, no trailing slash)
3. Attach the EA to any chart and set the inputs:

| input | value |
|---|---|
| `BridgeUrl` | the Vercel URL, no trailing slash |
| `BridgeAccountId` | same as `MT5_EA_DEMO_ACCOUNT_ID` |
| `IngestToken` | same as `EA_INGEST_TOKEN` |
| `DryRun` | **true** for the first session |

## Endpoints used

| method | path |
|---|---|
| GET | `/api/ea/orders/pending/{bridgeAccountId}` |
| POST | `/api/ea/orders/result/{orderId}` |
| POST | `/api/ea/state/{bridgeAccountId}` |
| POST | `/api/ea/heartbeat/{bridgeAccountId}` |

Supported order kinds: `market`, `limit`, `stop`. Anything else is reported back
as `rejected` with a reason rather than silently dropped.

## Before pointing a copier at a funded account

The forex path has **no risk cap**. `AUTO_TRADE_MAX_ALERTS_PER_CHECK` and
`AUTO_TRADE_MAX_RISK_PER_CHECK` exist in `.env.example` but only the `TOPSTEP_`
futures equivalents were set live — which is how three EURJPY entries fired at an
identical price and stop and stopped out together. Set both generic vars.
