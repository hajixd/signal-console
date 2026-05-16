# EURJPY Ny Open Gap Continuation Signalmonth

- Status: isolated competition candidate, not live.
- Asset: EUR/JPY (EURJPY).
- Family: ny_open_gap_continuation_signalmonth.
- Forward profit factor: 2.56.
- Forward trades: 62.
- Forward total R: 33.94.
- Training profit factor: 1.76.
- Training trades: 40.

## Hypothesis

Tests whether the overnight gap fades or continues during a specific NY cash-session window. Filtered by signalMonth=11.

## Split Protocol

- Parameter ranking uses trades completed before 2022-01-01.
- Qualification metrics use trades entered on or after 2022-01-01.
- This folder is not imported by the live strategy catalog.

## Sources

- https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1004081
