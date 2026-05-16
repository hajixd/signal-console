# CL Overnight Close To Open Bias Signalmonth

- Status: isolated competition candidate, not live.
- Asset: Crude Oil Futures (CL).
- Family: overnight_close_to_open_bias_signalmonth.
- Forward profit factor: 4.04.
- Forward trades: 80.
- Forward total R: 157.01.
- Training profit factor: 1.31.
- Training trades: 176.

## Hypothesis

Tests the close-to-open leg emphasized by overnight return research. Filtered by signalMonth=1.

## Split Protocol

- Parameter ranking uses trades completed before 2022-01-01.
- Qualification metrics use trades entered on or after 2022-01-01.
- This folder is not imported by the live strategy catalog.

## Sources

- https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1004081
