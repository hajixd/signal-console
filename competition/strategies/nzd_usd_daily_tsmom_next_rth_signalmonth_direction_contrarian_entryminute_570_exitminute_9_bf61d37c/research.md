# NZDUSD Daily Tsmom Next Rth Signalmonth

- Status: isolated competition candidate, not live.
- Asset: NZD/USD (NZDUSD).
- Family: daily_tsmom_next_rth_signalmonth.
- Forward profit factor: 3.61.
- Forward trades: 102.
- Forward total R: 229.00.
- Training profit factor: 1.56.
- Training trades: 37.

## Hypothesis

Tests short-horizon own-return continuation/reversal inspired by time-series momentum literature. Filtered by signalMonth=2.

## Split Protocol

- Parameter ranking uses trades completed before 2022-01-01.
- Qualification metrics use trades entered on or after 2022-01-01.
- This folder is not imported by the live strategy catalog.

## Sources

- https://pages.stern.nyu.edu/~lpederse/papers/TimeSeriesMomentum.pdf
