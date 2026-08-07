# Portfolio PF/Frequency Trade-off — 2026-08-06

## Method

All 150 registered strategies were offered to the exact MILP subset optimizer: 77 Forex and 73 Futures candidates. Both targets used the `all_stress_tested` policy and the current per-trade custom sizing ranges.

For each target, the optimizer maximized completed full-history trade count subject to all of the following constraints:

- development PF at or above the requested target;
- full-history PF at or above the requested target;
- sealed 2025–2026 holdout PF at or above the requested target;
- each full calendar year PF at or above 1.0;
- selected strategies drawn only from the stress-screened catalog.

The resulting portfolios were then checked with ordinary bootstrap PF p05, block-bootstrap PF p05, a sign-flip test and the existing strict history engine.

## Exact comparison

| Target | Market | Strategies | Full trades | Full PF | Trades / active day | Trades / calendar day | Holdout PF | Block-bootstrap PF p05 | Worst full-year PF |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3.0 | Forex | 18 | 1,289 | 3.011432 | 2.436673 | 0.799638 | 3.014296 | 2.561418 | 2.035097 |
| 3.0 | Futures | 12 | 656 | 3.002341 | 1.392781 | 0.405695 | 3.005572 | 2.488352 | 2.365983 |
| 2.5 | Forex | 35 | 2,416 | 2.500762 | 2.581197 | 1.493350 | 2.500303 | 2.239231 | 1.651825 |
| 2.5 | Futures | 26 | 1,835 | 2.502537 | 2.411301 | 1.134833 | 2.505396 | 2.207439 | 1.939728 |
| 2.0 | Forex | 53 | 3,943 | 2.018218 | 3.758818 | 2.436981 | 2.052360 | 1.872771 | 1.478271 |
| 2.0 | Futures | 51 | 3,862 | 2.004940 | 3.653737 | 2.386151 | 2.001187 | 1.839168 | 1.646994 |

All PF 2.0 and PF 2.5 portfolios passed the aggregate development/full/holdout gates, the annual-positive constraint and the portfolio significance checks. The sign-flip p-value was 0.000999 in each market/target result.

## Live decision

PF 2.0 was selected because the user explicitly prioritized maximum frequency. Compared with PF 2.5, it adds:

- 1,527 Forex trades (+63.2%);
- 2,027 Futures trades (+110.5%);
- 1.18 additional Forex trades per active trading day;
- 1.24 additional Futures trades per active trading day.

The PF 2.0 selection was applied to live configuration. It is the exact maximum full-history trade count supported by the completed catalog under the PF 2.0 development/full/holdout and annual-positive constraints.

Historical, bootstrap and challenge-replay results are research estimates, not guarantees of future profitability or prop-firm outcomes.
