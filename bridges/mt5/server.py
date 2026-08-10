from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from typing import Any

import MetaTrader5 as mt5


ROOT = Path(__file__).resolve().parent
MT5_LOCK = Lock()
MAX_REQUEST_BYTES = 64 * 1024
SUCCESS_RETCODES = {
    value
    for value in (
        getattr(mt5, "TRADE_RETCODE_DONE", None),
        getattr(mt5, "TRADE_RETCODE_DONE_PARTIAL", None),
        getattr(mt5, "TRADE_RETCODE_PLACED", None),
    )
    if value is not None
}
RETRYABLE_RETCODES = {
    value
    for value in (
        getattr(mt5, "TRADE_RETCODE_INVALID_FILL", None),
        getattr(mt5, "TRADE_RETCODE_INVALID_VOLUME", None),
        getattr(mt5, "TRADE_RETCODE_LIMIT_VOLUME", None),
        getattr(mt5, "TRADE_RETCODE_NO_MONEY", None),
    )
    if value is not None
}


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
    if not math.isfinite(number) or number <= 0:
        raise ValueError("Expected a positive number.")
    return number


def text(payload: dict[str, Any], key: str, env_name: str | None = None) -> str | None:
    value = payload.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return env_text(env_name) if env_name else None


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    handler.send_response(status)
    handler.send_header("cache-control", "no-store")
    handler.send_header("content-type", "application/json")
    handler.send_header("content-length", str(len(raw)))
    handler.send_header("x-content-type-options", "nosniff")
    handler.end_headers()
    handler.wfile.write(raw)


def last_error(label: str) -> RuntimeError:
    code, message = mt5.last_error()
    return RuntimeError(f"{label} ({code}): {message}")


def connect_mt5_account(payload: dict[str, Any]) -> Any:
    login_value = text(payload, "login", "MT5_LOGIN")
    password = text(payload, "password", "MT5_PASSWORD")
    server = text(payload, "server", "MT5_SERVER")
    path = env_text("MT5_PATH")

    if not login_value or not password or not server:
        raise ValueError("MT5 login, master password, and server are required.")
    if not login_value.isdigit():
        raise ValueError("MT5 login must be numeric.")

    mt5.shutdown()
    initialize_options = {
        "login": int(login_value),
        "password": password,
        "server": server,
        "timeout": env_int("MT5_CONNECT_TIMEOUT_MS", 20_000),
    }
    initialized = mt5.initialize(path, **initialize_options) if path else mt5.initialize(**initialize_options)
    if not initialized:
        raise last_error("MT5 initialize failed")

    terminal = mt5.terminal_info()
    if terminal is None or not bool(getattr(terminal, "connected", False)):
        raise RuntimeError("MT5 terminal is not connected to the broker.")
    account = mt5.account_info()
    if account is None:
        raise last_error("MT5 returned no account information")
    if str(account.login) != login_value:
        raise RuntimeError(f"MT5 connected to login {account.login}, not {login_value}.")
    if str(account.server).strip().casefold() != server.strip().casefold():
        raise RuntimeError(f"MT5 connected to server {account.server}, not {server}.")
    return account


def supplied_secret(payload: dict[str, Any], authorization: str | None) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return text(payload, "secret") or ""


def authorize(payload: dict[str, Any], authorization: str | None = None) -> dict[str, Any] | None:
    expected_secret = env_text("MT5_BRIDGE_SECRET") or ""
    if not expected_secret or not hmac.compare_digest(supplied_secret(payload, authorization), expected_secret):
        return {"status": "failed", "error": "Unauthorized bridge request."}
    return None


def account_can_trade(account: Any) -> bool:
    terminal = mt5.terminal_info()
    return bool(
        getattr(account, "trade_allowed", False)
        and getattr(account, "trade_expert", True)
        and (terminal is None or getattr(terminal, "trade_allowed", True))
    )


def verify_account(payload: dict[str, Any], authorization: str | None = None) -> dict[str, Any]:
    unauthorized = authorize(payload, authorization)
    if unauthorized:
        return unauthorized

    account = connect_mt5_account(payload)
    if not account_can_trade(account):
        return {
            "status": "failed",
            "error": "This login is read-only or automated trading is disabled. Use the master trading password and enable algorithmic trading on the bridge terminal.",
        }
    return {
        "status": "connected",
        "connected": True,
        "accountId": int(account.login),
        "accountName": str(account.name),
        "server": str(account.server),
        "tradeAllowed": True,
        "balance": float(account.balance),
        "equity": float(account.equity),
        "currency": str(account.currency),
    }


def normalized_symbol(value: str) -> str:
    return "".join(character for character in value.upper() if character.isalnum())


def symbol_score(candidate: Any, requested: str) -> tuple[int, int, int, int, str]:
    name = str(getattr(candidate, "name", ""))
    normalized_name = normalized_symbol(name)
    normalized_requested = normalized_symbol(requested)
    exact = name.casefold() == requested.casefold()
    begins = normalized_name.startswith(normalized_requested)
    visible = bool(getattr(candidate, "visible", False))
    return (0 if exact else 1, 0 if begins else 1, 0 if visible else 1, len(name), name)


def resolve_symbol(requested: str) -> tuple[str, Any]:
    exact = mt5.symbol_info(requested)
    candidates = [exact] if exact is not None else []
    requested_normalized = normalized_symbol(requested)
    matches = mt5.symbols_get(f"*{requested}*") or ()
    candidates.extend(
        candidate
        for candidate in matches
        if requested_normalized and requested_normalized in normalized_symbol(str(getattr(candidate, "name", "")))
    )
    unique_candidates = {str(getattr(candidate, "name", "")): candidate for candidate in candidates if candidate is not None}
    disabled_mode = getattr(mt5, "SYMBOL_TRADE_MODE_DISABLED", 0)
    candidates = [
        candidate
        for candidate in unique_candidates.values()
        if getattr(candidate, "trade_mode", None) != disabled_mode
    ]
    if not candidates:
        raise RuntimeError(f"MT5 could not find a broker symbol matching {requested}.")

    candidate = sorted(candidates, key=lambda item: symbol_score(item, requested))[0]
    symbol = str(candidate.name)
    if not mt5.symbol_select(symbol, True):
        raise RuntimeError(f"MT5 could not select symbol {symbol}.")
    info = mt5.symbol_info(symbol)
    if info is None:
        raise RuntimeError(f"MT5 returned no symbol information for {symbol}.")
    if getattr(info, "trade_mode", None) == disabled_mode:
        raise RuntimeError(f"Trading is disabled for {symbol} on this account.")
    return symbol, info


def volume_decimals(step: float) -> int:
    rendered = f"{step:.8f}".rstrip("0")
    return len(rendered.split(".", 1)[1]) if "." in rendered else 0


def normalize_volume_down(value: float, symbol_info: Any) -> float:
    minimum = numeric(getattr(symbol_info, "volume_min", 0.01))
    maximum = numeric(getattr(symbol_info, "volume_max", value), value)
    step = numeric(getattr(symbol_info, "volume_step", minimum), minimum)
    if value + 1e-12 < minimum:
        raise ValueError(f"Requested {value:g} lots is below the broker minimum of {minimum:g} lots.")
    capped = min(value, maximum)
    steps = math.floor((capped + 1e-12) / step)
    normalized = round(steps * step, volume_decimals(step))
    if normalized + 1e-12 < minimum:
        raise ValueError("No executable lot size remains within the broker minimum.")
    return normalized


def adaptive_volumes(value: float, symbol_info: Any) -> list[float]:
    first = normalize_volume_down(value, symbol_info)
    minimum = numeric(getattr(symbol_info, "volume_min", 0.01))
    step = numeric(getattr(symbol_info, "volume_step", minimum), minimum)
    attempts = [first]
    current = first
    for _ in range(max(1, env_int("MT5_SIZE_ATTEMPTS", 8)) - 1):
        if current <= minimum + 1e-12:
            break
        candidate = normalize_volume_down(max(minimum, current / 2), symbol_info)
        if candidate >= current:
            candidate = round(current - step, volume_decimals(step))
        if candidate + 1e-12 < minimum or candidate >= current:
            break
        attempts.append(candidate)
        current = candidate
    if attempts[-1] > minimum + 1e-12:
        attempts.append(minimum)
    return attempts


def order_type(action: str, entry_type: str) -> int:
    if entry_type == "limit":
        return mt5.ORDER_TYPE_BUY_LIMIT if action == "buy" else mt5.ORDER_TYPE_SELL_LIMIT
    return mt5.ORDER_TYPE_BUY if action == "buy" else mt5.ORDER_TYPE_SELL


def filling_modes(symbol_info: Any, entry_type: str) -> list[int]:
    modes: list[int] = []
    flags = int(getattr(symbol_info, "filling_mode", 0) or 0)
    if entry_type == "limit" and hasattr(mt5, "ORDER_FILLING_RETURN"):
        modes.append(mt5.ORDER_FILLING_RETURN)
    if flags & int(getattr(mt5, "SYMBOL_FILLING_IOC", 2)):
        modes.append(mt5.ORDER_FILLING_IOC)
    if flags & int(getattr(mt5, "SYMBOL_FILLING_FOK", 1)):
        modes.append(mt5.ORDER_FILLING_FOK)
    market_execution = getattr(mt5, "SYMBOL_TRADE_EXECUTION_MARKET", None)
    if getattr(symbol_info, "trade_exemode", None) != market_execution and hasattr(mt5, "ORDER_FILLING_RETURN"):
        modes.append(mt5.ORDER_FILLING_RETURN)
    modes.extend([getattr(mt5, "ORDER_FILLING_IOC", 1), getattr(mt5, "ORDER_FILLING_FOK", 0)])
    return list(dict.fromkeys(modes))


def validate_bracket(action: str, entry_price: float, stop_loss: float, take_profit: float) -> None:
    valid = stop_loss < entry_price < take_profit if action == "buy" else take_profit < entry_price < stop_loss
    if not valid:
        raise ValueError("Stop loss and take profit are on the wrong side of the entry price.")


def ledger_path() -> Path:
    configured = env_text("MT5_LEDGER_PATH")
    return Path(configured).expanduser().resolve() if configured else ROOT / "bridge-ledger.sqlite3"


def ledger_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(ledger_path(), timeout=10)
    connection.execute(
        "CREATE TABLE IF NOT EXISTS completed_requests (request_key TEXT PRIMARY KEY, response_json TEXT NOT NULL, created_at INTEGER NOT NULL)"
    )
    connection.execute("DELETE FROM completed_requests WHERE created_at < ?", (int(time.time()) - 7 * 24 * 60 * 60,))
    connection.commit()
    return connection


def idempotency_key(payload: dict[str, Any]) -> str:
    login = text(payload, "login", "MT5_LOGIN") or ""
    server = text(payload, "server", "MT5_SERVER") or ""
    tag = text(payload, "tradeId") or text(payload, "customTag")
    if not login or not tag:
        raise ValueError("MT5 order requests require a login and trade ID.")
    return hashlib.sha256(f"{login}\n{server.casefold()}\n{tag}".encode("utf-8")).hexdigest()


def cached_response(request_key: str) -> dict[str, Any] | None:
    connection = ledger_connection()
    try:
        row = connection.execute(
            "SELECT response_json FROM completed_requests WHERE request_key = ?", (request_key,)
        ).fetchone()
    finally:
        connection.close()
    if not row:
        return None
    response = json.loads(row[0])
    response["deduped"] = True
    return response


def save_response(request_key: str, response: dict[str, Any]) -> None:
    connection = ledger_connection()
    try:
        connection.execute(
            "INSERT OR REPLACE INTO completed_requests (request_key, response_json, created_at) VALUES (?, ?, ?)",
            (request_key, json.dumps(response, separators=(",", ":")), int(time.time())),
        )
        connection.commit()
    finally:
        connection.close()


def check_succeeded(check: Any) -> bool:
    return check is not None and int(getattr(check, "retcode", -1)) in {0, *SUCCESS_RETCODES}


def result_error(prefix: str, result: Any) -> str:
    if result is None:
        code, message = mt5.last_error()
        return f"{prefix} ({code}): {message}"
    return f"{prefix}: retcode {getattr(result, 'retcode', 'unknown')}, {getattr(result, 'comment', 'no details')}"


def place_order(payload: dict[str, Any], authorization: str | None = None) -> dict[str, Any]:
    unauthorized = authorize(payload, authorization)
    if unauthorized:
        return unauthorized

    request_key = idempotency_key(payload)
    cached = cached_response(request_key)
    if cached:
        return cached

    account = connect_mt5_account(payload)
    if not account_can_trade(account):
        return {"status": "failed", "error": "Trading is disabled for this MT5 login."}

    requested_symbol = text(payload, "symbol")
    if not requested_symbol:
        raise ValueError("Missing symbol.")
    symbol, symbol_info = resolve_symbol(requested_symbol)

    action = text(payload, "action") or ""
    if action not in {"buy", "sell"}:
        raise ValueError("Action must be buy or sell.")
    entry_type = text(payload, "entryType") or "market"
    if entry_type not in {"market", "limit"}:
        raise ValueError("Entry type must be market or limit.")

    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        raise RuntimeError(f"MT5 has no tick data for {symbol}.")
    market_price = numeric(tick.ask if action == "buy" else tick.bid)
    entry_price = numeric(payload.get("entryPrice"), market_price) if entry_type == "limit" else market_price
    stop_loss = numeric(payload.get("stopLossPrice"))
    take_profit = numeric(payload.get("takeProfitPrice"))
    validate_bracket(action, entry_price, stop_loss, take_profit)

    requested_size = numeric(payload.get("size"))
    last_failure = "MT5 could not validate this order."
    for volume in adaptive_volumes(requested_size, symbol_info):
        for fill_mode in filling_modes(symbol_info, entry_type):
            request = {
                "action": mt5.TRADE_ACTION_PENDING if entry_type == "limit" else mt5.TRADE_ACTION_DEAL,
                "symbol": symbol,
                "volume": volume,
                "type": order_type(action, entry_type),
                "price": entry_price,
                "sl": stop_loss,
                "tp": take_profit,
                "deviation": env_int("MT5_DEVIATION", 20),
                "magic": env_int("MT5_MAGIC", 260507),
                "comment": str(payload.get("customTag") or payload.get("tradeId") or "korra")[:31],
                "type_time": mt5.ORDER_TIME_GTC,
                "type_filling": fill_mode,
            }
            check = mt5.order_check(request)
            if not check_succeeded(check):
                last_failure = result_error("MT5 order check failed", check)
                continue

            result = mt5.order_send(request)
            if result is None or int(getattr(result, "retcode", -1)) not in SUCCESS_RETCODES:
                last_failure = result_error("MT5 rejected order", result)
                if result is None or int(getattr(result, "retcode", -1)) not in RETRYABLE_RETCODES:
                    return {"status": "failed", "error": last_failure, "contractId": symbol, "contractName": symbol}
                continue

            filled_size = float(getattr(result, "volume", 0) or volume)
            response = {
                "status": "placed",
                "accountId": int(account.login),
                "accountName": str(account.name),
                "contractId": symbol,
                "contractName": symbol,
                "orderId": int(getattr(result, "order", 0) or getattr(result, "deal", 0)),
                "dealId": int(getattr(result, "deal", 0) or 0),
                "filledPrice": float(getattr(result, "price", 0) or entry_price),
                "requestedSize": requested_size,
                "size": filled_size,
                "sizeReduced": filled_size + 1e-12 < requested_size,
            }
            save_response(request_key, response)
            return response

    return {"status": "failed", "error": last_failure, "contractId": symbol, "contractName": symbol}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}")

    def do_GET(self) -> None:
        if self.path != "/health":
            json_response(self, 404, {"error": "Not found."})
            return
        unauthorized = authorize({}, self.headers.get("authorization"))
        if unauthorized:
            json_response(self, 401, unauthorized)
            return
        path = env_text("MT5_PATH")
        with MT5_LOCK:
            try:
                initialized = mt5.initialize(path, timeout=env_int("MT5_CONNECT_TIMEOUT_MS", 20_000)) if path else mt5.initialize(timeout=env_int("MT5_CONNECT_TIMEOUT_MS", 20_000))
                terminal = mt5.terminal_info() if initialized else None
                json_response(
                    self,
                    200 if initialized else 503,
                    {"status": "ok" if initialized else "failed", "terminalReady": bool(terminal)},
                )
            finally:
                mt5.shutdown()

    def do_POST(self) -> None:
        route = self.path.split("?", 1)[0]
        if route not in {"/place-order", "/verify-account"}:
            json_response(self, 404, {"error": "Not found."})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > MAX_REQUEST_BYTES:
                json_response(self, 413, {"status": "failed", "error": "Invalid request size."})
                return
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("Request body must be a JSON object.")
            with MT5_LOCK:
                try:
                    response = (
                        verify_account(payload, self.headers.get("authorization"))
                        if route == "/verify-account"
                        else place_order(payload, self.headers.get("authorization"))
                    )
                finally:
                    mt5.shutdown()
            status = 401 if response.get("error") == "Unauthorized bridge request." else 200 if response.get("status") != "failed" else 400
            json_response(self, status, response)
        except Exception as exc:
            json_response(self, 400, {"status": "failed", "error": str(exc)})


def main() -> None:
    load_dotenv()
    if not env_text("MT5_BRIDGE_SECRET"):
        raise RuntimeError("MT5_BRIDGE_SECRET is required.")
    host = env_text("MT5_BRIDGE_HOST") or "127.0.0.1"
    port = env_int("MT5_BRIDGE_PORT", 8787)
    print(f"Korra MT5 credential bridge listening on http://{host}:{port}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
