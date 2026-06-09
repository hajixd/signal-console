# Dynamic Range Addition Search

- Status: dry run
- Qualified additions: 0
- Scope tested: all configured futures assets with the broad dynamic-range search grid, including unfiltered, month-filtered, and weekday-side variants.
- Gates: post-2022 PF/RR/trade-count filters, pre-2022 train diagnostics, strict anti-cheat rerun with 1-minute execution exits where source data allowed, split PF, bootstrap PF p05, block-bootstrap PF p05, annual pass rate, duplicate same-asset variant rejection, and same-asset entry-overlap rejection.
- Outcome: no dynamic-range futures additions were materialized; the qualified set stayed empty after the stricter 1-minute-exit validation.

| Strategy | Asset | PF | Trades | Avg RR | Train PF | Bootstrap p05 | Variant |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
