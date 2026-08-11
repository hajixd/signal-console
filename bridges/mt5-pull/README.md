# mt5-pull — Python pull executor (EA protocol parity)

`poller.py` is a headless stand-in for `bridges/mt5-ea/`'s EA: same endpoints,
same bearer token, same queue semantics (v1.01: fills reporting, replay
dedup, symbol resolution, volume normalization, magic 260809). The app cannot
tell them apart.

**Why it exists:** EAs need a chart window; MT5 cannot create chart windows in
a non-interactive session (SSH, Session 0). On a headless Windows VPS the EA
fails with `open chart failed`. The MetaTrader5 Python IPC API needs no
charts, so this poller attaches (or launches) the terminal and executes the
queue directly. This is what runs in production on the bridge VM.

## Production layout (bridge VM)

```
C:\signal-poller\poller.py      this file
C:\signal-poller\config.env     KEY=VALUE lines (see below)
C:\signal-poller\run-poller.ps1 loads config.env, runs poller via the shared venv
C:\signal-poller\state.json     replay memory (order ids + reported deal tickets)
C:\mt5-exec\                    portable MT5 terminal the poller owns
```

Runs as Scheduled Task **KorraPoller** (AtLogOn + machine auto-logon), NOT as
an SSH child — a process started over SSH dies with the SSH session, which is
exactly how the first deployment silently stopped. Restart with
`Stop-ScheduledTask KorraPoller; Start-ScheduledTask KorraPoller`.

## config.env keys

```
BRIDGE_URL=https://www.korra.space   # canonical host — apex 308s and MT5/urllib must not chase redirects
CONNECTION_ID=mt5-demo-100k          # must match MT5_EA_DEMO_ACCOUNT_ID app-side
INGEST_TOKEN=<EA_INGEST_TOKEN>
MT5_PATH=C:\mt5-exec\terminal64.exe
MT5_LOGIN=... MT5_PASSWORD=... MT5_SERVER=...   # poller owns the terminal login
DRY_RUN=false                        # true = log orders, consume nothing
POLL_SECONDS=2
HEARTBEAT_SECONDS=10
# optional second reporter — external measurement journal (not this app):
V2_URL=...
V2_TOKEN=...
```

## Operational notes

- `mt5.initialize` against an already-running terminal it didn't launch can
  fail with `(-10005, IPC timeout)`. The loop retries; killing the orphan
  terminal and letting the poller relaunch it is the reliable reset.
- Dry-run intentionally leaves queue items pending (nothing consumed while
  testing). Flipping `DRY_RUN=false` executes whatever is queued *then*.
- One Python process per terminal: the spread recorder holds its own IPC to a
  different terminal; never point two processes at the same one.
