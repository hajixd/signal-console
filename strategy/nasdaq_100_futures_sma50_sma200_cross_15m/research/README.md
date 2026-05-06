# NQ Moving Average Response Study

Study date: 2026-05-01

Instrument: Nasdaq 100 futures (`NQ`)

The first pass measured what happens after price touches well-known moving averages. A support touch means price was above the average, traded into it, and closed back above it. A resistance touch is the inverse. Forward response was measured in NQ ticks over the next 1-10 bars.

## Touch Response

The strongest raw touch responses were mostly support bounces:

| Timeframe | Best Touch | Horizon | Avg Forward Ticks | Win Rate |
| --- | --- | ---: | ---: | ---: |
| 1m | EMA200 support | 5 bars | 0.42 | 48.4% |
| 5m | EMA200 support | 10 bars | 3.28 | 52.6% |
| 15m | SMA100 support | 10 bars | 11.47 | 54.2% |
| 30m | SMA50 support | 10 bars | 18.68 | 54.4% |
| 1h | SMA20 support | 10 bars | 24.68 | 55.5% |

The 1h SMA20 support touch looked best as a raw forward-response study, but it did not survive as a fixed-stop strategy. The default execution test returned about `PF 0.75`, so the touch itself was not clean enough.

## Crossover Follow-Up

Since touch entries were weak mechanically, the follow-up checked common fast/slow moving-average crosses:

| Timeframe | Setup | Direction | Max Hold | TP | SL | Fast PF |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 15m | SMA50/SMA200 | Long | 20 bars | 160 ticks | 220 ticks | 1.30 |
| 15m | SMA50/SMA200 | Short | 10 bars | 120 ticks | 160 ticks | 1.24 |
| 30m | EMA50/EMA200 | Long | 14 bars | 160 ticks | 220 ticks | 1.21 |
| 5m | EMA9/EMA21 | Long | 5 bars | 160 ticks | 220 ticks | 1.19 |

Selected strategy:

- `15m SMA50/SMA200` long cross
- Enter next bar after SMA50 crosses above SMA200
- Max hold: 20 bars
- Take profit: 160 ticks
- Stop loss: 220 ticks
- One trade per day

Backtest check:

- Full fast run: `283` trades, `62.5%` win rate, `PF 1.33`, `+28.74R`, `6.77R` max drawdown
- Strict recent 20k-bar sample: `58` trades, `67.2%` win rate, `PF 1.56`, `+9.74R`, `5.02R` max drawdown
