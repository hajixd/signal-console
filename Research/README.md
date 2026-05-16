# Research Center

This is an isolated strategy research pipeline. It does not modify the live
`strategy/` catalog, `src/lib/strategy-loader.ts`, or app flow.

The goal is fast, repeatable discovery of futures and forex strategies with:

- profit factor greater than `2.0`
- more than `20` trades
- clear provenance: academic, institutional, public research, or cross-asset
  transfer
- a clean path from raw research to backtested candidates

## Pipeline

```text
internet / papers / notes
  -> sources/search_results
  -> sources/pages
  -> ideas/inbox
  -> ideas/approved
  -> strategies/ready_to_backtest
  -> strategies/backtested
  -> strategies/qualified
  -> reports
```

## Fast Commands

Show the research center status:

```powershell
python Research\scripts\research_center.py status
```

Seed the idea inbox with research-derived session and market-structure ideas:

```powershell
python Research\scripts\ideas_from_research.py --seed
```

Search the internet for configured research topics:

```powershell
python Research\scripts\search_internet.py --topic session_effects --limit 8
```

Dedicated search shortcuts:

```powershell
python Research\scripts\search_academic.py
python Research\scripts\search_institutional.py
```

Search supports these providers:

- `BRAVE_SEARCH_API_KEY`
- `SERPAPI_API_KEY`
- `TAVILY_API_KEY`
- DuckDuckGo Lite fallback, when no API key is present

Fetch saved search-result pages into local source text:

```powershell
python Research\scripts\fetch_sources.py
```

Convert approved ideas into many ready-to-backtest specs:

```powershell
python Research\scripts\build_ready_to_backtest.py --markets futures,forex
```

Backtest everything waiting in the ready queue:

```powershell
python Research\scripts\backtest_ready.py --min-pf 2 --min-trades 21
```

Generate a candidate report:

```powershell
python Research\scripts\generate_report.py --top 30
```

Run the whole local flow, skipping internet search:

```powershell
python Research\scripts\research_center.py local-cycle --min-pf 2 --min-trades 21
```

## Stage Rules

- `sources/` stores raw research artifacts and search manifests.
- `ideas/inbox/` stores ideas that have not been approved for testing.
- `ideas/approved/` stores executable ideas.
- `strategies/ready_to_backtest/` stores expanded single-asset strategy specs.
- `strategies/backtested/` stores all completed backtests.
- `strategies/qualified/` stores only strategies meeting the configured PF and
  trade-count threshold.
- `reports/` stores aggregate summaries.

## Provenance Types

- `academic`: paper or formal study.
- `institutional`: exchange, broker, bank, or prop/research desk article.
- `public_research`: credible public trading research or practitioner article.
- `cross_asset_transfer`: existing idea moved to a new asset; useful, but kept
  separate from genuinely new research logic.

## Safety

The promotion script writes only to `Research/promotions/` by default. It does
not touch the live `strategy/` folder unless you intentionally adapt and run a
manual promotion workflow.
