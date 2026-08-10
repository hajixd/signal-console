from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from types import SimpleNamespace


class FakeMetaTrader5(types.ModuleType):
    TRADE_ACTION_DEAL = 1
    TRADE_ACTION_PENDING = 5
    TRADE_RETCODE_DONE = 10009
    TRADE_RETCODE_DONE_PARTIAL = 10010
    TRADE_RETCODE_PLACED = 10008
    TRADE_RETCODE_INVALID_FILL = 10030
    TRADE_RETCODE_INVALID_VOLUME = 10014
    TRADE_RETCODE_LIMIT_VOLUME = 10034
    TRADE_RETCODE_NO_MONEY = 10019
    ORDER_TYPE_BUY = 0
    ORDER_TYPE_SELL = 1
    ORDER_TYPE_BUY_LIMIT = 2
    ORDER_TYPE_SELL_LIMIT = 3
    ORDER_TIME_GTC = 0
    ORDER_FILLING_FOK = 0
    ORDER_FILLING_IOC = 1
    ORDER_FILLING_RETURN = 2
    SYMBOL_FILLING_FOK = 1
    SYMBOL_FILLING_IOC = 2
    SYMBOL_TRADE_EXECUTION_MARKET = 2
    SYMBOL_TRADE_MODE_DISABLED = 0

    def __init__(self) -> None:
        super().__init__("MetaTrader5")
        self.initialize_options: list[dict[str, object]] = []
        self.order_send_calls: list[dict[str, object]] = []
        self.current_login = 0
        self.current_server = ""

    def initialize(self, *_args, **kwargs):
        self.initialize_options.append(kwargs)
        self.current_login = int(kwargs.get("login", 12345678))
        self.current_server = str(kwargs.get("server", "Broker-Demo"))
        return True

    def shutdown(self):
        return None

    def last_error(self):
        return (0, "ok")

    def terminal_info(self):
        return SimpleNamespace(connected=True, trade_allowed=True)

    def account_info(self):
        return SimpleNamespace(
            balance=100_000,
            currency="USD",
            equity=100_100,
            login=self.current_login,
            name="Korra",
            server=self.current_server,
            trade_allowed=True,
            trade_expert=True,
        )

    def symbol_info(self, symbol):
        if symbol != "EURUSD.a":
            return None
        return SimpleNamespace(
            filling_mode=self.SYMBOL_FILLING_FOK | self.SYMBOL_FILLING_IOC,
            name="EURUSD.a",
            trade_exemode=self.SYMBOL_TRADE_EXECUTION_MARKET,
            trade_mode=1,
            visible=True,
            volume_max=100.0,
            volume_min=0.01,
            volume_step=0.01,
        )

    def symbols_get(self, _pattern):
        return (SimpleNamespace(name="EURUSD.a", visible=True),)

    def symbol_select(self, _symbol, _selected):
        return True

    def symbol_info_tick(self, _symbol):
        return SimpleNamespace(ask=1.16, bid=1.15998)

    def order_check(self, request):
        if float(request["volume"]) > 0.25:
            return SimpleNamespace(retcode=self.TRADE_RETCODE_NO_MONEY, comment="Not enough money")
        return SimpleNamespace(retcode=0, comment="Done")

    def order_send(self, request):
        self.order_send_calls.append(request)
        return SimpleNamespace(
            comment="Done",
            deal=777,
            order=888,
            price=1.16002,
            retcode=self.TRADE_RETCODE_DONE,
            volume=request["volume"],
        )


FAKE_MT5 = FakeMetaTrader5()
sys.modules["MetaTrader5"] = FAKE_MT5
SPEC = importlib.util.spec_from_file_location("korra_mt5_bridge", Path(__file__).with_name("server.py"))
assert SPEC and SPEC.loader
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)


class CredentialBridgeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        os.environ["MT5_BRIDGE_SECRET"] = "test-secret"
        os.environ["MT5_LEDGER_PATH"] = str(Path(self.temp.name) / "ledger.sqlite3")
        FAKE_MT5.initialize_options.clear()
        FAKE_MT5.order_send_calls.clear()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_verifies_any_submitted_login_without_an_ea(self) -> None:
        result = SERVER.verify_account(
            {"login": "87654321", "password": "master", "server": "Firm-Server"},
            "Bearer test-secret",
        )
        self.assertEqual(result["status"], "connected")
        self.assertEqual(result["accountId"], 87654321)
        self.assertEqual(FAKE_MT5.initialize_options[-1]["login"], 87654321)
        self.assertEqual(FAKE_MT5.initialize_options[-1]["server"], "Firm-Server")

    def test_keeps_multiple_accounts_independent(self) -> None:
        first = SERVER.verify_account(
            {"login": "11111111", "password": "first-master", "server": "First-Broker"},
            "Bearer test-secret",
        )
        second = SERVER.verify_account(
            {"login": "22222222", "password": "second-master", "server": "Second-Broker"},
            "Bearer test-secret",
        )

        self.assertEqual(first["accountId"], 11111111)
        self.assertEqual(first["server"], "First-Broker")
        self.assertEqual(second["accountId"], 22222222)
        self.assertEqual(second["server"], "Second-Broker")
        self.assertEqual(FAKE_MT5.initialize_options[-2]["login"], 11111111)
        self.assertEqual(FAKE_MT5.initialize_options[-2]["password"], "first-master")
        self.assertEqual(FAKE_MT5.initialize_options[-1]["login"], 22222222)
        self.assertEqual(FAKE_MT5.initialize_options[-1]["password"], "second-master")

    def test_auto_maps_symbol_reduces_size_and_deduplicates_retries(self) -> None:
        payload = {
            "action": "buy",
            "entryPrice": 1.16,
            "entryType": "market",
            "login": "12345678",
            "password": "master",
            "server": "Broker-Demo",
            "size": 1.0,
            "stopLossPrice": 1.159,
            "symbol": "EURUSD",
            "takeProfitPrice": 1.162,
            "tradeId": "signal-123",
        }
        first = SERVER.place_order(payload, "Bearer test-secret")
        second = SERVER.place_order(payload, "Bearer test-secret")

        self.assertEqual(first["status"], "placed")
        self.assertEqual(first["contractName"], "EURUSD.a")
        self.assertEqual(first["size"], 0.25)
        self.assertTrue(first["sizeReduced"])
        self.assertEqual(second["orderId"], first["orderId"])
        self.assertTrue(second["deduped"])
        self.assertEqual(len(FAKE_MT5.order_send_calls), 1)


if __name__ == "__main__":
    unittest.main()
