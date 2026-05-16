# Competition ZF Us First30 Last30 Momentum Signalmonth

- Asset: US Treasury 5Y Note Futures (ZF)
- Family: us_first30_last30_momentum_signalmonth
- Training PF: 1.16 over 31 trades
- Forward PF: 2.22 over 59 trades

## Hypothesis

Session-window return predicts a later same-day session return. Filtered by signalMonth=9.

## Split

- Parameters were ranked on trades completed before 2022-01-01.
- Forward metrics are trades entered on or after 2022-01-01.

## Sources

- https://www.sciencedirect.com/science/article/abs/pii/S0304405X18301351
