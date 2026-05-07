# Auto-Trade Bridge API

Bridge providers receive the same `POST /place-order` payload from the Next app.

```json
{
  "accountId": "123456",
  "action": "buy",
  "customTag": "tb_signal_id",
  "entryPrice": 1.2345,
  "entryType": "market",
  "login": "optional-platform-login",
  "password": "optional-platform-password",
  "secret": "shared-bridge-secret",
  "server": "optional-platform-server",
  "size": 0.1,
  "stopLossPrice": 1.23,
  "symbol": "EURUSD",
  "takeProfitPrice": 1.24,
  "tradeId": "signal-id"
}
```

Success response:

```json
{
  "status": "placed",
  "accountId": "123456",
  "accountName": "Trading account",
  "contractId": "EURUSD",
  "contractName": "EURUSD",
  "orderId": 123456789
}
```

Failure response:

```json
{
  "status": "failed",
  "error": "Reason the platform rejected the order"
}
```

The Next app treats any non-2xx response, `status: "failed"`, or `error` field as a failed auto-trade.
