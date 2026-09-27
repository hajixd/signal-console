# Interaction polish — September 27, 2026

The accepted chart-led layout remains unchanged. No sample trades or synthetic prices are published.

| Change | Evidence and application |
| --- | --- |
| Chart drag and pointer capture | [MDN Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events): capture maintains dragging outside the target; pan-y preserves vertical scrolling and pointercancel clears interrupted gestures. |
| Keyboard chart inspection | [WAI Slider pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/): native range input supplies arrow/Home/End behavior; value text includes date, amount and event. |
| Modal focus | [WAI Dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): background navigation is inert, Escape closes, focus returns to trigger. |
| Haptics | [Apple Playing haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics) and [MDN Vibration API](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API): optional short, throttled selection feedback; feature detection and an honest unsupported state. No promise of native Safari haptics. |
| Hover and pressed feedback | [NN/g Visibility of system status](https://www.nngroup.com/articles/visibility-system-status/): immediate lightweight feedback; selected filters expose aria-pressed; hover applies only to capable pointers. |
| Motion | [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion): suppress transitions and animated scrolling for reduced-motion preferences. |
| Empty chart and scan health | [NN/g Empty states](https://www.nngroup.com/articles/empty-state-interface-design/): starting-capital chart is labeled; incomplete runs remain visible, not disguised as healthy. |

## Verification
Local DOM tests cover seven-page navigation, chart range input and reset, per-category equity, overall drawdown independence, zero-price option exits, research separation, modal inert state, unsupported haptics and feed failure retention. Browser verification checks the deployed UI separately. No claim of physical-device haptic testing.

## Alert limitations
Scheduled tasks and completed feed writes are distinct. A last_run timestamp alone is not proof that a final report was saved. Revised scanner instructions avoid preliminary running writes, bound unavailable-source retries, and require a final merged report or explicit sync-failure notification. Live wallet/social/option-flow coverage and exact hourly execution remain external dependencies.


## Futures opportunities (2026-09-27)
- Preserve Investing/Discover/navigation; add Futures to existing category controls and scanner health. No fabricated positions or prices.
- NQ/MNQ, ES/MES, GC/MGC and CL/MCL require exact dated contracts, supported point values, integer size, direction and reported initial margin before paper inclusion. P&L uses price difference × direction × point value × contracts; buying power reserves margin rather than notional. Display returns as percentage of notional, not leveraged margin return.
- Research details show trigger, invalidation, targets, dated sources and missing evidence. Hourly scans cannot simulate real-time stop execution or guarantee directional outcomes.
- Official contract references: https://www.cmegroup.com/education/courses/micro-e-mini-futures/micro-e-mini-futures-products-overview ; https://www.cmegroup.com/markets/metals/precious/e-micro-gold.contractSpecs.html ; https://www.cmegroup.com/markets/metals/precious/gold-futures.html ; https://www.cmegroup.com/education/courses/understanding-micro-futures-contracts-at-cme-group/micro-crude-futures/micro-wti-crude-oil-futures-overview
- Verification: node signal-site/tests/futures.cjs. No fixtures are placed in the live alert feed.
