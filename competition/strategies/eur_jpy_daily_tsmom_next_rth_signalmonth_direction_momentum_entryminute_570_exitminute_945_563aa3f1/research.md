# EURJPY Daily Tsmom Next Rth Signalmonth

- Status: isolated competition candidate, not live.
- Asset: EUR/JPY (EURJPY).
- Family: daily_tsmom_next_rth_signalmonth.
- Forward profit factor: 2.94.
- Forward trades: 85.
- Forward total R: 94.55.
- Training profit factor: 1.71.
- Training trades: 44.

## Hypothesis

Tests short-horizon own-return continuation/reversal inspired by time-series momentum literature. Filtered by signalMonth=6.

## Split Protocol

- Parameter ranking uses trades completed before 2022-01-01.
- Qualification metrics use trades entered on or after 2022-01-01.
- This folder is not imported by the live strategy catalog.

## Sources

- https://pages.stern.nyu.edu/~lpederse/papers/TimeSeriesMomentum.pdf
