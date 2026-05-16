# MBT Daily Tsmom Next Overnight Signalweekdayside

- Status: isolated competition candidate, not live.
- Asset: Micro Bitcoin Futures (MBT).
- Family: daily_tsmom_next_overnight_signalweekdayside.
- Forward profit factor: 3.51.
- Forward trades: 104.
- Forward total R: 215.63.
- Training profit factor: 2.09.
- Training trades: 20.

## Hypothesis

Tests short-horizon own-return continuation/reversal inspired by time-series momentum literature. Filtered by signalWeekdaySide=1_long.

## Split Protocol

- Parameter ranking uses trades completed before 2022-01-01.
- Qualification metrics use trades entered on or after 2022-01-01.
- This folder is not imported by the live strategy catalog.

## Sources

- https://pages.stern.nyu.edu/~lpederse/papers/TimeSeriesMomentum.pdf
