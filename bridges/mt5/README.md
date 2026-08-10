# Korra MT5 Credential Bridge

This is the one central Windows execution service behind Korra's credential-only MT5 connection flow. Friends enter only their MT5 login, master trading password, and exact broker server on `korra.space`; they do not install an EA or keep their own terminal open.

The service must run continuously on one Windows VM with MetaTrader 5 installed. Vercel cannot load the native MT5 terminal, so it sends authenticated HTTPS requests to this bridge.

## What it handles

- switches safely between saved MT5 accounts, one request at a time;
- verifies the exact login and server and rejects investor/read-only credentials;
- discovers broker symbol suffixes such as `EURUSD.a` automatically;
- respects broker lot minimums, maximums, steps, and fill modes;
- reduces lots when the broker's margin check requires a smaller order;
- records the broker's final lot size and fill price for Korra notifications;
- stores a local idempotency ledger so a network retry cannot duplicate a successful trade;
- never stores client passwords in the bridge ledger or logs request bodies.

## One-time VM setup

1. Install the broker-compatible MetaTrader 5 terminal on a Windows VM and open it once.
2. Install Python 3.11 or newer.
3. Copy `.env.example` to `.env`.
4. Set a long random `MT5_BRIDGE_SECRET` and the full `MT5_PATH` to `terminal64.exe`.
5. Run PowerShell as the Windows user that owns the MT5 terminal session:

```powershell
cd bridges\mt5
.\install-service.ps1
```

The installer creates an isolated Python environment and a restartable Windows scheduled task. It starts whenever that Windows user logs in.

## HTTPS exposure

Keep the bridge bound to `127.0.0.1`. Put it behind an authenticated HTTPS tunnel or reverse proxy; do not open port 8787 directly to the internet.

Configure the resulting public service root and the same secret in Vercel:

```txt
MT5_BRIDGE_URL=https://your-private-bridge.example.com
MT5_BRIDGE_SECRET=the-same-long-random-secret
AUTO_TRADE_FOREX_PROVIDER=mt5_ea
MT5_AUTO_TRADE_ENABLED=true
```

Korra derives `/verify-account` and `/place-order` from that service root. Once those variables are deployed, new MT5 accounts use credential mode automatically.

## Verification

From the VM:

```powershell
$secret = (Get-Content .env | Where-Object { $_ -match '^MT5_BRIDGE_SECRET=' }) -replace '^MT5_BRIDGE_SECRET=', ''
Invoke-RestMethod http://127.0.0.1:8787/health -Headers @{ Authorization = "Bearer $secret" }
Get-ScheduledTask -TaskName "Korra MT5 Credential Bridge"
```

Then add an MT5 account on Korra. A successful save means the service logged into that exact account, confirmed the broker server, and confirmed trading permission.

## Security

- Use only the master trading password, never an investor password.
- Protect the VM and HTTPS tunnel with strict access controls.
- Keep `.env`, the bridge secret, and Korra's encrypted connection-storage secret private.
- Rotate the bridge secret if it is ever exposed.
