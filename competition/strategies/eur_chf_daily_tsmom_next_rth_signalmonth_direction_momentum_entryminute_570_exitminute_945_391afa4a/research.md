# EURCHF Daily Tsmom Next Rth Signalmonth

- Status: isolated competition candidate, not live.
- Asset: EUR/CHF (EURCHF).
- Family: daily_tsmom_next_rth_signalmonth.
- Forward profit factor: 3.23.
- Forward trades: 101.
- Forward total R: 133.81.
- Training profit factor: 2.12.
- Training trades: 37.

## Hypothesis

Tests short-horizon own-return continuation/reversal inspired by time-series momentum literature. Filtered by signalMonth=2.

## Split Protocol

- Parameter ranking uses trades completed before 2022-01-01.
- Qualification metrics use trades entered on or after 2022-01-01.
- This folder is not imported by the live strategy catalog.

## Sources

- https://pages.stern.nyu.edu/~lpederse/papers/TimeSeriesMomentum.pdf
