# YM Daily Tsmom Next Overnight Signalweekdayside

- Status: isolated competition candidate, not live.
- Asset: Dow Jones Futures (YM).
- Family: daily_tsmom_next_overnight_signalweekdayside.
- Forward profit factor: 2.46.
- Forward trades: 145.
- Forward total R: 168.76.
- Training profit factor: 1.37.
- Training trades: 416.

## Hypothesis

Tests short-horizon own-return continuation/reversal inspired by time-series momentum literature. Filtered by signalWeekdaySide=1_long.

## Split Protocol

- Parameter ranking uses trades completed before 2022-01-01.
- Qualification metrics use trades entered on or after 2022-01-01.
- This folder is not imported by the live strategy catalog.

## Sources

- https://pages.stern.nyu.edu/~lpederse/papers/TimeSeriesMomentum.pdf
