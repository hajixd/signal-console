# Competition Strategy Bundle

This directory is intentionally separate from the live strategy catalog.

- Nothing here is imported by `src/lib/strategy-loader.ts`.
- Parameters are ranked on pre-2022 training trades.
- Qualification stats use post-2022 forward trades only.
- Firebase sync should target a separate collection/namespace.

Generated at: 2026-05-16T05:11:38.082926+00:00
Strategies: 20

Run:

```powershell
python competition/generate_competition_bundle.py
node --env-file=.env.local --import tsx scripts/sync-competition-strategies.ts
```
