from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from typing import Any

import MetaTrader5 as mt5


ROOT = Path(__file__).resolve().parent
MT5_LOCK = Lock()


def load_dotenv() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def env_text(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


def env_int(name: str, fallback: int) -> int:
    try:
        return int(os.environ.get(name, ""))
    except ValueError:
        return fallback


def numeric(value: Any, fallback: float | None = None) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        if fallback is None:
            raise ValueError("Expected a number.")
        return fallback
    if number <= 0:
        raise ValueError("Expected a positive number.")
    return number


def text(payload: dict[str, Any], key: str, env_name: str | None = None) -> str | None:
    value = payload.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return env_text(env_name) if env_name else None


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    raw = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json")
    handler.send_header("content-length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


def connect_mt5_account(payload: dict[str, Any]) -> Any:
    login_value = text(payload, "login", "MT5_LOGIN")
    password = text(payload, "password", "MT5_PASSWORD")
    server = text(payload, "server", "MT5_SERVER")
    path = env_text("MT5_PATH")

    if not login_value or not password or not server:
        raise ValueError("MT5 login, master password, and server are required.")
    initialized = mt5.initialize(path=path) if path else mt5.initialize()
    if not initialized:
        code, message = mt5.last_error()
        raise RuntimeError(f"MT5 initialize failed ({code}): {message}")
    if not mt5.login(int(login_value), password=password, server=server):
        code, message = mt5.last_error()
        raise RuntimeError(f"MT5 login failed ({code}): {message}")

    account = mt5.account_info()
    if account is None:
        code, message = mt5.last_error()
        raise RuntimeError(f"MT5 returned no account information ({code}): {message}")
    if str(account.login) != login_value:
        raise RuntimeError(f"MT5 connected to login {account.login}, not {login_value}.")
    if str(account.server).strip().lower() != server.strip().lower():
        raise RuntimeError(f"MT5 connected to server {account.server}, not {server}.")
    return account


def order_type(action: str, entry_type: str) -> int:
    if entry_type == "limit":
        return mt5.ORDER_TYPE_BUY_LIMIT if action == "buy" else mt5.ORDER_TYPE_SELL_LIMIT
    return mt5.ORDER_TYPE_BUY if action == "buy" else mt5.ORDER_TYPE_SELL


def authorize(payload: dict[str, Any]) -> dict[str, Any] | None:
    expected_secret = env_text("MT5_BRIDGE_SECRET")
    supplied_secret = text(payload, "secret")
    if not expected_secret or supplied_secret != expected_secret:
        return {"status": "failed", "error": "Unauthorized bridge request."}
    return None


def verify_account(payload: dict[str, Any]) -> dict[str, Any]:
    unauthorized = authorize(payload)
    if unauthorized:
        return unauthorized

    account = connect_mt5_account(payload)
    if not bool(account.trade_allowed):
        return {
            "status": "failed",
            "error": "This login is read-only or trading is disabled. Use the master trading password.",
        }
    return {
        "status": "connected",
        "connected": True,
        "accountId": int(account.login),
        "accountName": str(account.name),
        "server": str(account.server),
        "tradeAllowed": bool(account.trade_allowed),
        "balance": float(account.balance),
        "equity": float(account.equity),
        "currency": str(account.currency),
    }


def place_order(payload: dict[str, Any]) -> dict[str, Any]:
    unauthorized = authorize(payload)
    if unauthorized:
        return unauthorized

    account = connect_mt5_account(payload)
    if not bool(account.trade_allowed):
        return {"status": "failed", "error": "Trading is disabled for this MT5 login."}

    symbol = text(payload, "symbol")
    if not symbol:
        raise ValueError("Missing symbol.")
    if not mt5.symbol_select(symbol, True):
        raise RuntimeError(f"MT5 could not select symbol {symbol}.")

    action = text(payload, "action") or ""
    if action not in {"buy", "sell"}:
        raise ValueError("Action must be buy or sell.")

    entry_type = text(payload, "entryType") or "market"
    if entry_type not in {"market", "limit"}:
        raise ValueError("Entry type must be market or limit.")

    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        raise RuntimeError(f"MT5 has no tick data for {symbol}.")

    price = numeric(payload.get("entryPrice"), tick.ask if action == "buy" else tick.bid)
    if entry_type == "market":
        price = tick.ask if action == "buy" else tick.bid

    request = {
        "action": mt5.TRADE_ACTION_PENDING if entry_type == "limit" else mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": numeric(payload.get("size")),
        "type": order_type(action, entry_type),
        "price": price,
        "sl": numeric(payload.get("stopLossPrice")),
        "tp": numeric(payload.get("takeProfitPrice")),
        "deviation": env_int("MT5_DEVIATION", 20),
        "magic": env_int("MT5_MAGIC", 260507),
        "comment": str(payload.get("customTag") or payload.get("tradeId") or "tradingbot")[:31],
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(request)
    if result is None:
        code, message = mt5.last_error()
        raise RuntimeError(f"MT5 order_send returned no result ({code}): {message}")
    if result.retcode != mt5.TRADE_RETCODE_DONE and result.retcode != mt5.TRADE_RETCODE_PLACED:
        return {
            "status": "failed",
            "error": f"MT5 rejected order: retcode {result.retcode}, {result.comment}",
            "contractId": symbol,
            "contractName": symbol,
        }

    return {
        "status": "placed",
        "accountId": account.login,
        "accountName": account.name,
        "contractId": symbol,
        "contractName": symbol,
        "orderId": int(result.order),
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}")

    def do_GET(self) -> None:
        if self.path != "/health":
            json_response(self, 404, {"error": "Not found."})
            return
        json_response(
            self,
            200,
            {
                "connected": bool(mt5.initialize()),
                "status": "ok",
            },
        )

    def do_POST(self) -> None:
        if self.path not in {"/place-order", "/verify-account"}:
            json_response(self, 404, {"error": "Not found."})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            with MT5_LOCK:
                response = verify_account(payload) if self.path == "/verify-account" else place_order(payload)
            status = 200 if response.get("status") != "failed" else 400
            json_response(self, status, response)
        except Exception as exc:
            json_response(self, 400, {"status": "failed", "error": str(exc)})


def main() -> None:
    load_dotenv()
    host = env_text("MT5_BRIDGE_HOST") or "127.0.0.1"
    port = env_int("MT5_BRIDGE_PORT", 8787)
    print(f"MT5 bridge listening on http://{host}:{port}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
