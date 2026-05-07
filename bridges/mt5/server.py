from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import MetaTrader5 as mt5


ROOT = Path(__file__).resolve().parent


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


def initialize_mt5(payload: dict[str, Any]) -> None:
    login_value = text(payload, "login", "MT5_LOGIN")
    password = text(payload, "password", "MT5_PASSWORD")
    server = text(payload, "server", "MT5_SERVER")
    path = env_text("MT5_PATH")

    kwargs: dict[str, Any] = {}
    if path:
        kwargs["path"] = path
    if login_value:
        kwargs["login"] = int(login_value)
    if password:
        kwargs["password"] = password
    if server:
        kwargs["server"] = server

    if not mt5.initialize(**kwargs):
        code, message = mt5.last_error()
        raise RuntimeError(f"MT5 initialize failed ({code}): {message}")


def order_type(action: str, entry_type: str) -> int:
    if entry_type == "limit":
        return mt5.ORDER_TYPE_BUY_LIMIT if action == "buy" else mt5.ORDER_TYPE_SELL_LIMIT
    return mt5.ORDER_TYPE_BUY if action == "buy" else mt5.ORDER_TYPE_SELL


def place_order(payload: dict[str, Any]) -> dict[str, Any]:
    expected_secret = env_text("MT5_BRIDGE_SECRET")
    supplied_secret = text(payload, "secret")
    if not expected_secret or supplied_secret != expected_secret:
        return {"status": "failed", "error": "Unauthorized bridge request."}

    initialize_mt5(payload)

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

    account = mt5.account_info()
    return {
        "status": "placed",
        "accountId": account.login if account else payload.get("accountId"),
        "accountName": account.name if account else str(payload.get("accountId") or "MT5"),
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
        initialized = mt5.initialize()
        account = mt5.account_info() if initialized else None
        json_response(
            self,
            200,
            {
                "accountId": account.login if account else None,
                "connected": bool(account),
                "status": "ok",
            },
        )

    def do_POST(self) -> None:
        if self.path != "/place-order":
            json_response(self, 404, {"error": "Not found."})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            json_response(self, 200, place_order(payload))
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
