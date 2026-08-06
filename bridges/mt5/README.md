# MT5 Bridge

This bridge receives auto-trade requests from the Vercel app and places them through a locally running MetaTrader 5 terminal.

MT5 must run on the same Windows machine as this bridge. A normal Vercel function cannot talk to the MT5 terminal directly.

## Setup

1. Install MetaTrader 5 on a Windows VPS or desktop.
2. Open MT5 once so the terminal is initialized; client accounts are connected securely with their submitted credentials.
3. Install Python 3.11+ for Windows.
4. Install the bridge dependency:

```powershell
cd bridges\mt5
python -m pip install -r requirements.txt
```

5. Copy `.env.example` to `.env` and fill in the values:

```powershell
Copy-Item .env.example .env
notepad .env
```

6. Start the bridge:

```powershell
.\run.ps1
```

The bridge listens on:

```txt
http://127.0.0.1:8787/place-order
```

For Vercel to reach it, put it behind HTTPS with a tunnel or reverse proxy, then use that public URL as `MT5_BRIDGE_URL` in the app.

## App Settings

In the app's Add Account form for MT5, the client enters only:

- `MT5 username / login`: the account login from the prop firm or broker
- `MT5 master password`: the trading password from the prop firm or broker, not the investor/read-only password
- `MT5 server`: the server name from the prop firm or broker
- `Symbol map`: broker symbol names, for example `EURUSD:EURUSD.,XAUUSD:XAUUSDm`
- `Lot map`: trade sizes, for example `EURUSD:0.1,XAUUSD:0.05`

The bridge URL and secret are infrastructure settings. Configure them once in Vercel as `MT5_BRIDGE_URL` and
`MT5_BRIDGE_SECRET`; do not ask clients to enter them.

The bridge serializes account switches, verifies the reported login/server, and rejects read-only credentials before
an account is saved or an order is placed.

## Security

Do not expose this bridge publicly without HTTPS and a strong `MT5_BRIDGE_SECRET`.
