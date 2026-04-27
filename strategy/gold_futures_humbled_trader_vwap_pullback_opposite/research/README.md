## Research Note

- Source playbook: Humbled Trader VWAP pullback / reclaim logic, cross-checked with FTMO x OANDA's January 23, 2026 VWAP pullback writeup.
- Repo evidence: `strategy/research_summary.csv` showed the inverse candidate at `forward_pf=1.1775752`, `forward_trades=210`, `total_r=10.229019`.
- Variant selected: `vwap_pullback|ny|threshold=0.05|rr=2|sl_atr=0.75|max_bars=24|trend=all|one_trade=1`, materialized as an opposite-signal strategy.
