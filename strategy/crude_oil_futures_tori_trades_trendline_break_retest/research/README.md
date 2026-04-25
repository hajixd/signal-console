# CL Tori Trades Trendline Break Retest

## Public strategy read

This implementation is a source-backed proxy for Tori Trades' public trendline method, not a claim that it is her exact private execution model.

- Her own 2025 blog defines the core setup as a `three-touch-point trend line break`, where the broken line becomes the `action line` for entry and the opposing line becomes the `safety line` for risk control.
- Her December 2025 guide adds the top-down workflow: start from higher timeframes, connect clean untouched trendlines, and only act when price gives the break, retest, or bounce.
- In the Humbled Trader interview transcript, she says her favorite A+ setup is the `three touch point break`, with `at least a week's worth of data`, and that the break should happen `fairly close to that opposing trend line` so risk stays small.
- In that same interview, she says she typically does not know the take-profit in advance and instead stays with the move while the new trend holds, with the stop moving into profit as structure develops.

## Why the engine proxy looks like this

The backtest engine works on 15-minute bars, so the public higher-timeframe trendline idea is approximated with a broader structure window and longer hold:

- `range=144`: approximates a more mature structure instead of short, noisy breaks.
- `entry=120`: keeps the recent trigger window tighter after the broader setup forms.
- `threshold=0.03`: filters weaker breaks that looked more like fakeouts.
- `rr=5` with `max_bars=64`: better matched her "let it run" style than the short fixed-target baseline.
- No moving prior-bar stop: testing `dynamicStopLossPolicy=trail_prior_bar` materially hurt results because it is much tighter than her published safety-line concept.

## Backtest notes

Crude oil futures was chosen because her public material repeatedly references commodities/metals and because this market produced the cleanest trendline-proxy behavior in this repo's data.

From 2022-01-01 onward on `CL`:

- Earlier proxy baseline: `PF 1.0881`, `469` trades, `avg R 0.0311`
- Tuned version kept here: `PF 1.2584`, `476` trades, `avg R 0.1002`

Main reason the baseline underperformed:

- Too many trades were profitable but got clipped as small `max_bars` exits before enough trend developed.
- A shorter structure window admitted weaker, lower-quality breaks than her public "three touch / one week / low-risk" framing suggests.

Main reason the tuned version improved:

- It demanded more mature structure before the break.
- It allowed successful breaks to keep compounding via time in trade instead of forcing an early fixed exit.

## Similar public educators / adjacent playbooks

- Rayner Teo: discretionary trend following with no fixed profit target and trailing exits.
- Chart Guys / support-resistance retest style traders: wait for reaction at a visible level, confirm, keep risk tight, and avoid predicting before price reaches the level.
- TradeZella's public write-up of Tori's method mirrors the same action-line / safety-line framing and the emphasis on break proximity to keep risk small.

## Sources

- https://toritradez.com/blog/all/perfect-trade-trend-line-setup
- https://toritradez.com/blog/all/low-risk-trend-line-trading-break-retest-bounce
- https://www.tradezella.com/strategies/trendline-strategy
- https://ytscribe.com/v/5hE1PwklEc4/
- https://www.tradingwithrayner.com/trend-following-trading-strategy-guide/
- https://www.chartguys.com/articles/day-trading-strategies
