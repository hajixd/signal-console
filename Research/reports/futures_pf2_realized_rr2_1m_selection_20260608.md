# Futures PF > 2 / Realized R:R > 2 / 1m Exit Selection

Generated: 2026-06-08T01:40:11.278Z

Selected 10 non-duplicate futures strategies. Criteria: PF > 2, realized average R:R > 2, at least 40 trades, and every saved trade has execution_timeframe=1m.

| Symbol | PF | Win % | Trades | Avg Win R | Avg Loss R | Realized R:R | Strategy |
|---|---:|---:|---:|---:|---:|---:|---|
| HG | 3.20 | 53.2 | 77 | 0.69 | 0.29 | 2.34 | HG cross-asset London opening-range reversal into the US close (January filter) true 5R |
| YM | 3.15 | 59.0 | 61 | 1.46 | 0.70 | 2.10 | YM cross-asset cross-asset USDCAD March US first30 last30 momentum true 5R true 5R |
| SI | 2.99 | 55.2 | 58 | 0.54 | 0.26 | 2.06 | SI cross-asset US opening-range reversal into the close (December filter) true 5R |
| YM | 2.72 | 40.0 | 90 | 2.17 | 0.90 | 2.42 | YM 20-day daily mean reversion overnight (Tuesday longs true 4R) |
| ZF | 2.39 | 45.2 | 93 | 2.02 | 0.79 | 2.56 | ZF cross-asset 5-day daily mean reversion overnight (Friday shorts true 5R) true 5R |
| 6A | 2.37 | 50.5 | 95 | 2.12 | 0.91 | 2.32 | 6A cross-asset cross-asset London opening-range continuation into New York (Monday shorts) true 5R true 5R |
| 6C | 2.33 | 42.9 | 98 | 3.01 | 1.00 | 3.00 | 6C cross-asset cross-asset London opening-range continuation into New York (Monday shorts) true 5R true 5R |
| ZT | 2.21 | 48.9 | 90 | 2.01 | 0.91 | 2.21 | ZT cross-asset 5-day daily mean reversion overnight (Friday shorts true 5R) true 5R |
| ZN | 2.21 | 46.7 | 90 | 1.84 | 0.90 | 2.05 | ZN cross-asset 5-day daily mean reversion overnight (Friday shorts true 5R) true 5R |
| NQ | 2.02 | 45.3 | 53 | 2.37 | 0.97 | 2.44 | NQ Round Hundred Rejection 15m |

## Rejections

- competition_gold_futures_daily_tsmom_next_overnight_weekday_side_3_long_648d544b: Strict 1m refinement dropped PF to 1.13 and realized R:R to 1.02.
- competition_micro_bitcoin_futures_daily_tsmom_next_overnight_signalweekdayside_direction_contrarian_en_6003fc2d: Strict 1m refinement dropped PF to 1.42 and realized R:R to 1.00.
- competition_micro_bitcoin_futures_daily_tsmom_next_rth_weekday_side_2_short_4be5774f: Could not refine at least one entry against 1m data; preserved old CSV and excluded.
- competition_silver_futures_daily_tsmom_next_overnight_weekday_side_4_long_xasset_rr_5_e11e58c1: Could not refine at least one entry against 1m data; preserved old CSV and excluded.
- competition_dow_jones_futures_daily_tsmom_next_overnight_weekday_side_1_long_xasset_rr_4_373963bd: Duplicate of competition_dow_jones_futures_daily_tsmom_next_overnight_signalweekdayside_direction_momentum_entrymin_c2a8817b with 100% trade overlap.
