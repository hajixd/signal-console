import assert from "node:assert/strict";
import test from "node:test";

import { formatTelegramMessage } from "@/lib/telegram";
import type { TradeAlert } from "@/lib/types";

function trade(overrides: Partial<TradeAlert> = {}): TradeAlert {
  return {
    createdAt: "2026-08-10T11:45:00.000Z",
    entryMode: "test",
    entryPrice: 0.00631,
    estimatedWinRatePct: 45.2,
    id: "notification-size-test",
    liveProfitFactor: 3.08,
    market: "futures",
    side: "long",
    signalTime: "2026-08-10T11:45:00.000Z",
    sizeMultiplier: 13,
    slUnits: 6,
    status: "alerted",
    stopLossPrice: 0.006307,
    strategy: "Notification size test",
    symbol: "6J",
    takeProfitPrice: 0.006325,
    telegramStatus: "skipped",
    tpUnits: 30,
    unitLabel: "ticks",
    ...overrides
  };
}

test("notification hides internal guard wording and uses final futures execution size", () => {
  const message = formatTelegramMessage(
    trade({
      autoTradeContractName: "6JU6",
      autoTradeOrders: [
        {
          accountBalance: 50_772,
          accountGroupName: "Foofs",
          accountId: 23187369,
          size: 5,
          status: "placed"
        }
      ],
      autoTradeSizeAdjustment: "Topstep risk guard reduced units from 13 FX future to 10 FX future.",
      autoTradeStatus: "placed"
    })
  );

  assert.match(message, /Units: <b>5 6JU6<\/b>/);
  assert.match(message, /Take Profit: <code>[^<]+ \/ \$938<\/code>/);
  assert.match(message, /Stop Loss: <code>[^<]+ \/ -\$188<\/code>/);
  assert.match(message, /Account 23187369 \| Balance \$50,772 \| 5 units/);
  assert.doesNotMatch(message, /Topstep risk guard/i);
  assert.doesNotMatch(message, /reduced units from/i);
});

test("notification uses exact final MT5 lots even when the broker symbol is suffixed", () => {
  const message = formatTelegramMessage(
    trade({
      autoTradeContractName: "EURUSD.a",
      autoTradeOrders: [
        { accountId: 1001, accountName: "Korra", contractName: "EURUSD.a", size: 0.37, sizeUnit: "lots", status: "placed" },
        { accountId: 1002, accountName: "Itachi", contractName: "EURUSD.a", size: 0.21, sizeUnit: "lots", status: "placed" }
      ],
      autoTradeStatus: "placed",
      entryPrice: 1.16,
      market: "forex",
      sizeMultiplier: 20,
      slUnits: 10,
      stopLossPrice: 1.159,
      symbol: "EURUSD",
      takeProfitPrice: 1.162,
      tpUnits: 20,
      unitLabel: "pips"
    })
  );

  assert.match(message, /Units: <b>0\.58 FX lot<\/b>/);
  assert.match(message, /Take Profit: <code>[^<]+ \/ \$116<\/code>/);
  assert.match(message, /Stop Loss: <code>[^<]+ \/ -\$58\.00<\/code>/);
  assert.match(message, /Korra:\n- Account 1001 \| 0\.37 FX lot/);
  assert.match(message, /Itachi:\n- Account 1002 \| 0\.21 FX lot/);
  assert.doesNotMatch(message, /Units: <b>5\.8 EURUSD\.a<\/b>/);
});
