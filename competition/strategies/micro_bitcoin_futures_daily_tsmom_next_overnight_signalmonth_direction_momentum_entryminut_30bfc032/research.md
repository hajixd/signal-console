# MBT Daily Tsmom Next Overnight Signalmonth

- Status: isolated competition candidate, not live.
- Asset: Micro Bitcoin Futures (MBT).
- Family: daily_tsmom_next_overnight_signalmonth.
- Forward profit factor: 2.01.
- Forward trades: 85.
- Forward total R: 118.45.
- Training profit factor: 2.53.
- Training trades: 20.

## Hypothesis

Tests short-horizon own-return continuation/reversal inspired by time-series momentum literature. Filtered by signalMonth=10.

## Split Protocol

- Parameter ranking uses trades completed before 2022-01-01.
- Qualification metrics use trades entered on or after 2022-01-01.
- This folder is not imported by the live strategy catalog.

## Sources

- https://pages.stern.nyu.edu/~lpederse/papers/TimeSeriesMomentum.pdf
