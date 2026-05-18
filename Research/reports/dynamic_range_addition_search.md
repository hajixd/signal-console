# Dynamic Range Addition Search

- Status: dry run
- Qualified additions: 0
- Scope tested: unfiltered 3R range variants on 13 promising assets, month-filtered 3R variants on USDJPY/6J/AUDUSD/GBPJPY/YM, and weekday-side 3R variants on the same five-asset subset.
- Gates: post-2022 PF >= 3.0, at least 50 forward trades, average planned RR >= 2.0, pre-2022 train PF >= 1.0, strict anti-cheat rerun, split PF > 1.0, bootstrap PF p05 > 1.0, block-bootstrap PF p05 > 0.90, annual pass rate >= 60%, no duplicate same-asset variant, and no same-asset entry overlap.
- Outcome: no dynamic range additions were materialized; adding them would have lowered the truthfulness of the catalog.

| Strategy | Asset | PF | Trades | Avg RR | Train PF | Bootstrap p05 | Variant |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
