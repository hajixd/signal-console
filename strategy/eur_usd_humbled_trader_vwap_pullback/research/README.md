## Research Note

- Source playbook: Humbled Trader VWAP pullback / reclaim logic, cross-checked with FTMO x OANDA's January 23, 2026 VWAP pullback writeup.
- Repo evidence: `strategy/research_summary.csv` showed `forward_pf=1.0542995`, `forward_trades=529`, `total_r=18.045583`.
- Variant selected: `vwap_pullback|all|threshold=0.1|rr=2|sl_atr=1|max_bars=24|trend=all|one_trade=1`.
