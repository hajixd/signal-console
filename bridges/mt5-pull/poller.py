"""Korra MT5 pull executor (Python) — protocol parity with KorraMT5ExecutionEA v1.01.

Runs where the EA cannot: headless hosts whose MT5 terminal has no chart
windows (EAs require a chart; the MetaTrader5 IPC API does not). Speaks the
same endpoints with the same bearer token, so the app cannot tell it apart:

  GET  /api/ea/orders/pending/{connectionId}?includeStaleClaimed=true
  POST /api/ea/orders/result/{orderId}
  POST /api/ea/heartbeat/{connectionId}
  POST /api/ea/state/{connectionId}
  POST /api/ea/fills/{connectionId}          (closing deals, magic-matched)

Config via environment (see config.env):
  BRIDGE_URL, CONNECTION_ID, INGEST_TOKEN, MT5_PATH,
  MT5_LOGIN, MT5_PASSWORD, MT5_SERVER,
  DRY_RUN (default true: log orders, place nothing, report nothing),
  POLL_SECONDS (default 2), HEARTBEAT_SECONDS (default 10)
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta

import MetaTrader5 as mt5

BRIDGE_URL = os.environ.get("BRIDGE_URL", "").rstrip("/")
CONNECTION_ID = os.environ.get("CONNECTION_ID") or os.environ.get("BRIDGE_ACCOUNT_ID", "")
TOKEN = os.environ.get("INGEST_TOKEN", "")
MT5_PATH = os.environ.get("MT5_PATH", r"C:\mt5-exec\terminal64.exe")
MT5_LOGIN = int(os.environ.get("MT5_LOGIN", "0") or 0)
MT5_PASSWORD = os.environ.get("MT5_PASSWORD", "")
MT5_SERVER = os.environ.get("MT5_SERVER", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").strip().lower() != "false"
POLL_SECONDS = max(1, int(os.environ.get("POLL_SECONDS", "2")))
HEARTBEAT_SECONDS = max(2, int(os.environ.get("HEARTBEAT_SECONDS", "10")))
MAGIC = 260809
SLIPPAGE_POINTS = 20
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state.json")

# Optional second reporter: our V2 trading system's external-book journal
# (TRA-80). Independent measurement off the broker tape — one POST per
# closed position. Skipped entirely unless both vars are configured.
V2_URL = os.environ.get("V2_URL", "").rstrip("/")
V2_TOKEN = os.environ.get("V2_TOKEN", "")


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


# --- replay memory (mirrors the EA's GlobalVariable dedup) -------------------

def load_state() -> dict:
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"orders": {}, "reported_deals": []}


def save_state(state: dict) -> None:
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f)
    os.replace(tmp, STATE_FILE)


STATE = load_state()


# --- http --------------------------------------------------------------------

def http(method: str, path: str, body: dict | None = None) -> tuple[int, str]:
    req = urllib.request.Request(
        BRIDGE_URL + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-EA-Version": "py-1.01",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return resp.status, resp.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:200]
    except Exception as e:
        return 0, str(e)


# --- terminal ----------------------------------------------------------------

def ensure_mt5() -> bool:
    if mt5.terminal_info() is not None:
        return True
    kwargs = {"path": MT5_PATH, "portable": True}
    if MT5_LOGIN and MT5_PASSWORD and MT5_SERVER:
        kwargs.update(login=MT5_LOGIN, password=MT5_PASSWORD, server=MT5_SERVER)
    if not mt5.initialize(**kwargs):
        log(f"mt5 initialize failed: {mt5.last_error()}")
        return False
    a = mt5.account_info()
    t = mt5.terminal_info()
    log(f"mt5 attached: login={a.login if a else None} server={a.server if a else None} "
        f"algo_trading={'ON' if t and t.trade_allowed else 'OFF'}")
    return True


# --- symbol + volume helpers (EA v1.01 parity) -------------------------------

def normalized_symbol(value: str) -> str:
    return "".join(c for c in value.upper() if c.isalnum())


def resolve_symbol(requested: str) -> str:
    requested = (requested or "").strip()
    if not requested:
        return ""
    if mt5.symbol_select(requested, True):
        return requested
    want = normalized_symbol(requested)
    best, best_extra, best_offset = "", 1 << 31, 1 << 31
    for s in mt5.symbols_get() or []:
        cand = normalized_symbol(s.name)
        offset = cand.find(want)
        if offset < 0:
            continue
        extra = len(cand) - len(want)
        if extra < best_extra or (extra == best_extra and offset < best_offset):
            best, best_extra, best_offset = s.name, extra, offset
    return best or requested


def normalize_volume(symbol: str, requested: float) -> float:
    info = mt5.symbol_info(symbol)
    vmin = info.volume_min if info and info.volume_min > 0 else 0.01
    vmax = info.volume_max if info and info.volume_max >= vmin else vmin
    step = info.volume_step if info and info.volume_step > 0 else 0.01
    volume = max(vmin, min(vmax, requested))
    volume = vmin + int((volume - vmin) / step + 1e-9) * step
    return round(volume, 8)


# --- reporting ---------------------------------------------------------------

def report_result(order_id: str, status: str, ticket: int, fill_price: float,
                  retcode: int, label: str, err: str) -> None:
    code, out = http("POST", f"/api/ea/orders/result/{urllib.request.quote(order_id, safe='')}", {
        "status": status,
        "brokerTicket": ticket,
        "fillPrice": fill_price,
        "retcode": retcode,
        "retcodeLabel": label,
        "errorMessage": err,
    })
    if code != 200:
        log(f"result HTTP {code} for {order_id}: {out[:120]}")


def push_heartbeat_state() -> None:
    t = mt5.terminal_info()
    a = mt5.account_info()
    if t is None or a is None:
        return
    trade_allowed = bool(t.trade_allowed) and bool(a.trade_allowed) and not DRY_RUN
    cid = urllib.request.quote(CONNECTION_ID, safe="")
    code, out = http("POST", f"/api/ea/heartbeat/{cid}", {
        "eaVersion": "py-1.01",
        "terminalBuild": t.build,
        "terminalConnected": bool(t.connected),
        "tradeAllowed": trade_allowed,
        "accountLogin": a.login,
        "accountServer": a.server,
    })
    if code != 200:
        log(f"heartbeat HTTP {code}: {out[:120]}")
    code, out = http("POST", f"/api/ea/state/{cid}", {
        "bridgeStatus": "connected" if t.connected else "offline",
        "balance": a.balance,
        "equity": a.equity,
        "margin": a.margin,
        "freeMargin": a.margin_free,
        "marginLevelPct": a.margin_level,
        "floatingPnL": a.profit,
        "openPositionCount": mt5.positions_total() or 0,
    })
    if code != 200:
        log(f"state HTTP {code}: {out[:120]}")


def push_fills() -> None:
    """Report closing deals for our magic, once each (EA OnTradeTransaction parity)."""
    deals = mt5.history_deals_get(datetime.now() - timedelta(days=2), datetime.now() + timedelta(days=1))
    if not deals:
        return
    reported = set(STATE.get("reported_deals", []))
    dirty = False
    for d in deals:
        if d.magic != MAGIC or d.ticket in reported:
            continue
        if d.entry not in (mt5.DEAL_ENTRY_OUT, mt5.DEAL_ENTRY_OUT_BY):
            continue
        code, out = http("POST", f"/api/ea/fills/{urllib.request.quote(CONNECTION_ID, safe='')}", {
            "ticket": d.ticket,
            "dealType": d.type,
            "symbol": d.symbol,
            "volume": d.volume,
            "price": d.price,
            "profit": d.profit,
            "commission": d.commission,
            "swap": d.swap,
            "reason": d.reason,
            "positionTicket": d.position_id,
        })
        if code == 200:
            reported.add(d.ticket)
            dirty = True
        else:
            log(f"fill HTTP {code} for deal {d.ticket}: {out[:120]}")
    if dirty:
        STATE["reported_deals"] = sorted(reported)[-500:]
        save_state(STATE)


def push_v2_journal() -> None:
    """Report each closed position once to the V2 external-book journal."""
    if not V2_URL or len(V2_TOKEN) < 16:
        return
    deals = mt5.history_deals_get(datetime.now() - timedelta(days=2), datetime.now() + timedelta(days=1))
    if not deals:
        return
    reported = set(STATE.get("v2_deals", []))
    by_position: dict[int, list] = {}
    for d in deals:
        by_position.setdefault(d.position_id, []).append(d)
    a = mt5.account_info()
    balance = a.balance if a else 0.0
    order_by_ticket = {int(v): k for k, v in STATE.get("orders", {}).items() if isinstance(v, (int, float)) and v > 0}
    dirty = False
    for pos_id, pos_deals in by_position.items():
        entry_deal = next((d for d in pos_deals if d.entry == mt5.DEAL_ENTRY_IN), None)
        if entry_deal is None or entry_deal.magic != MAGIC:
            continue
        sl = tp = 0.0
        orders = mt5.history_orders_get(position=pos_id)
        for o in orders or []:
            if o.sl > 0:
                sl = o.sl
            if o.tp > 0:
                tp = o.tp
        for out in pos_deals:
            if out.entry not in (mt5.DEAL_ENTRY_OUT, mt5.DEAL_ENTRY_OUT_BY) or out.ticket in reported:
                continue
            payload = {
                "dealTicket": out.ticket,
                "positionTicket": pos_id,
                "korraOrderId": order_by_ticket.get(pos_id),
                "symbol": out.symbol,
                "direction": "long" if entry_deal.type == mt5.DEAL_TYPE_BUY else "short",
                "lots": out.volume,
                "entry": entry_deal.price,
                "exit": out.price,
                "sl": sl or None,
                "tp": tp or None,
                "openTime": int(entry_deal.time),
                "closeTime": int(out.time),
                "profitUsd": out.profit,
                "commissionUsd": (out.commission or 0.0) + (entry_deal.commission or 0.0),
                "swapUsd": out.swap or 0.0,
                "balanceAfter": balance,
                "reason": out.reason,
            }
            req = urllib.request.Request(
                f"{V2_URL}/api/lab/journal/external",
                method="POST",
                data=json.dumps(payload).encode(),
                headers={"Authorization": f"Bearer {V2_TOKEN}", "Content-Type": "application/json"},
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    ok = resp.status == 200
            except Exception as e:
                log(f"v2 journal post failed for deal {out.ticket}: {e}")
                ok = False
            if ok:
                reported.add(out.ticket)
                dirty = True
                log(f"V2-JOURNAL reported deal {out.ticket} {out.symbol} profit={out.profit}")
    if dirty:
        STATE["v2_deals"] = sorted(reported)[-500:]
        save_state(STATE)


# --- execution ---------------------------------------------------------------

def execute(order: dict) -> None:
    oid = str(order.get("_id", ""))
    if not oid:
        return
    kind = str(order.get("kind") or "market")
    side = str(order.get("side", ""))
    requested_symbol = str(order.get("symbol", ""))
    volume_req = float(order.get("volume") or 0)
    sl = float(order.get("sl") or 0)
    tp = float(order.get("tp") or 0)
    entry = float(order.get("entryPrice") or 0)

    remembered = STATE["orders"].get(oid)
    if remembered is not None:
        if remembered > 0:
            report_result(oid, "filled", int(remembered), 0.0, 10009, "replayed",
                          "replayed result; order was already accepted")
        else:
            report_result(oid, "rejected", 0, 0.0, int(-remembered), "replayed",
                          "replayed result; order was already rejected")
        return

    if DRY_RUN:
        log(f"DRY  {kind} {side} {requested_symbol} vol={volume_req} entry={entry} sl={sl} tp={tp}")
        return  # leave the order pending so nothing is consumed during dry-run

    symbol = resolve_symbol(requested_symbol)
    if not symbol or not mt5.symbol_select(symbol, True):
        STATE["orders"][oid] = -2
        save_state(STATE)
        report_result(oid, "rejected", 0, 0.0, 2, "symbol", f"MT5 could not select symbol {symbol}")
        return

    volume = normalize_volume(symbol, volume_req)
    is_buy = side == "buy"
    request = {
        "symbol": symbol,
        "volume": volume,
        "deviation": SLIPPAGE_POINTS,
        "magic": MAGIC,
        "type_time": mt5.ORDER_TIME_GTC,
        "comment": "Korra auto-trade",
    }
    if sl > 0:
        request["sl"] = sl
    if tp > 0:
        request["tp"] = tp
    if kind == "limit":
        request["action"] = mt5.TRADE_ACTION_PENDING
        request["type"] = mt5.ORDER_TYPE_BUY_LIMIT if is_buy else mt5.ORDER_TYPE_SELL_LIMIT
        request["price"] = entry
    else:  # EA v1.01 treats every non-limit kind as market
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            STATE["orders"][oid] = -3
            save_state(STATE)
            report_result(oid, "rejected", 0, 0.0, 3, "tick", "no tick for symbol")
            return
        request["action"] = mt5.TRADE_ACTION_DEAL
        request["type"] = mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL
        request["price"] = tick.ask if is_buy else tick.bid

    info = mt5.symbol_info(symbol)
    if info is not None:
        # filling_mode is a bitmask: 1 = FOK allowed, 2 = IOC allowed. Older
        # MetaTrader5 packages don't export SYMBOL_FILLING_* constants, so use
        # getattr with the documented values rather than the attributes.
        fok = getattr(mt5, "SYMBOL_FILLING_FOK", 1)
        request["type_filling"] = (mt5.ORDER_FILLING_FOK
                                   if info.filling_mode & fok else mt5.ORDER_FILLING_IOC)

    result = mt5.order_send(request)
    if result is None:
        STATE["orders"][oid] = -1
        save_state(STATE)
        report_result(oid, "rejected", 0, 0.0, 1, "none", f"order_send None: {mt5.last_error()}")
        return
    ok = result.retcode in (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_PLACED,
                            mt5.TRADE_RETCODE_DONE_PARTIAL)
    ticket = result.order or getattr(result, "deal", 0)
    if ok:
        STATE["orders"][oid] = max(1, int(ticket))
        save_state(STATE)
        report_result(oid, "filled", int(ticket), result.price or 0.0, result.retcode, str(result.retcode), "")
        log(f"FILLED {kind} {side} {symbol} vol={volume} ticket={ticket} @ {result.price}")
    else:
        STATE["orders"][oid] = -max(1, int(result.retcode))
        save_state(STATE)
        report_result(oid, "rejected", 0, 0.0, result.retcode, str(result.retcode), result.comment or "")
        log(f"REJECTED {kind} {side} {symbol}: {result.retcode} {result.comment}")


def self_test() -> None:
    """One-shot pipe test: open+close a tiny position with a non-korra magic
    so neither fills reporter picks it up. Enabled by SELF_TEST_LOT env."""
    lot = float(os.environ.get("SELF_TEST_LOT", "0") or 0)
    if lot <= 0:
        return
    sym = "EURUSD.sim"
    if not mt5.symbol_select(sym, True):
        log("SELF-TEST: symbol select failed")
        return
    info = mt5.symbol_info(sym)
    tick = mt5.symbol_info_tick(sym)
    fok = getattr(mt5, "SYMBOL_FILLING_FOK", 1)
    filling = mt5.ORDER_FILLING_FOK if info and info.filling_mode & fok else mt5.ORDER_FILLING_IOC
    r = mt5.order_send({"action": mt5.TRADE_ACTION_DEAL, "symbol": sym, "volume": lot,
                        "type": mt5.ORDER_TYPE_BUY, "price": tick.ask, "deviation": 20,
                        "magic": 999999, "type_filling": filling, "comment": "self-test"})
    log(f"SELF-TEST open: retcode={r.retcode if r else None} {getattr(r, 'comment', '')}")
    if r and r.retcode == mt5.TRADE_RETCODE_DONE:
        ours = [p for p in mt5.positions_get(symbol=sym) or [] if p.magic == 999999]
        if ours:
            t2 = mt5.symbol_info_tick(sym)
            c = mt5.order_send({"action": mt5.TRADE_ACTION_DEAL, "symbol": sym, "volume": lot,
                                "type": mt5.ORDER_TYPE_SELL, "position": ours[0].ticket,
                                "price": t2.bid, "deviation": 20, "magic": 999999,
                                "type_filling": filling, "comment": "self-test-close"})
            log(f"SELF-TEST close: retcode={c.retcode if c else None}")


# --- main loop ---------------------------------------------------------------

def main() -> int:
    global CONNECTION_ID
    if not BRIDGE_URL or len(TOKEN) < 16:
        log("BRIDGE_URL and a real INGEST_TOKEN are required")
        return 2
    log(f"korra-poller starting connection={CONNECTION_ID or '(account login)'} dry_run={DRY_RUN} url={BRIDGE_URL}")
    last_heartbeat = 0.0
    tested = False
    while True:
        try:
            if ensure_mt5():
                if not tested:
                    ti = mt5.terminal_info()
                    if ti and ti.trade_allowed:
                        tested = True
                        self_test()
                if not CONNECTION_ID:
                    a = mt5.account_info()
                    CONNECTION_ID = str(a.login) if a else ""
                now = time.monotonic()
                if now - last_heartbeat >= HEARTBEAT_SECONDS:
                    push_heartbeat_state()
                    push_fills()
                    push_v2_journal()
                    last_heartbeat = now
                cid = urllib.request.quote(CONNECTION_ID, safe="")
                code, out = http("GET", f"/api/ea/orders/pending/{cid}?includeStaleClaimed=true")
                if code == 200:
                    for order in (json.loads(out).get("orders") or []):
                        execute(order)
                elif code != 0 and now - last_heartbeat < 1:
                    log(f"pending HTTP {code}: {out[:120]}")
        except Exception as e:
            log(f"loop error: {e}")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    sys.exit(main())
