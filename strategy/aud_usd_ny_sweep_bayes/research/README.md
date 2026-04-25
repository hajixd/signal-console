# AUD/USD NY Sweep V4 Naive Bayes

## Why this was added

This strategy was recovered from [`strategy/tuning_summary.csv`](../../../strategy/tuning_summary.csv) after filtering for:

- forward profit factor `> 2`
- forward trades `> 50`

Recovered holdout stats:

- Forward profit factor: `2.357143`
- Forward trades: `61`
- Variant: `ny_sweep_v4|model=bayes|min=0.5|start=420|end=510|max_tests=3|risk_min=10|risk_max=20|min_wick=0.35|rr=2|max_bars=144|one_trade=1`

## Public playbook mapping

This is not a verbatim copy of any single educator's private rulebook.

It is the repo's `ny_sweep_playbook` implementation mapped to the public NY-session liquidity-sweep motif:

- mark prior session highs/lows and other obvious liquidity pools
- wait for New York to run that liquidity
- require rejection / structure confirmation after the sweep
- use imbalance / FVG-style continuation logic rather than blindly fading every breakout

## Sources

- TJR indicator guide: shows the same core confluences used in this mapping, including buy/sell-side liquidity, break of structure, fair value gaps, and session levels.
  https://www.tjrtrades.com/lto/opt-in-a?dub_id=87GnBNgzxXlKVEen&el=tiktok-indicators
- Liquidity Finder NY session guide: explicitly frames New York as the session that can sweep London highs/lows, then confirms with MSS and FVG retests.
  https://liquidityfinder.com/news/mastering-the-new-york-session-smart-money-concepts-guide-f37d0
- Liquidity Finder confirmation model: describes the three-step chain of liquidity sweep, structural confirmation, and FVG / order-block follow-through.
  https://liquidityfinder.com/news/the-confirmation-model-ob-fvg-liquidity-sweep-smart-money-concepts-50fe3
- FXOpen liquidity sweep explainer: defines the sweep as a move beyond a clear high/low that is followed by rejection or reversal, and discusses FVG/order-block confluence.
  https://fxopen.com/blog/en/liquidity-sweep-in-trading-basics-components-and-application/
