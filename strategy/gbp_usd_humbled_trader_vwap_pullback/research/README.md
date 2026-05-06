## Research Note

- Source playbook: Humbled Trader VWAP pullback / reclaim logic, cross-checked with FTMO x OANDA's January 23, 2026 VWAP pullback writeup.
- Repo evidence: `strategy/research_summary.csv` showed `forward_pf=1.0621731`, `forward_trades=201`, `total_r=7.7365282`.
- Variant selected: `vwap_pullback|ny|threshold=0.1|rr=2|sl_atr=1|max_bars=24|trend=ema|one_trade=1`.
