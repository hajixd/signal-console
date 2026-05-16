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
  -> LLM research, including YouTube/web source synthesis
  -> ideas/inbox
  -> LLM idea formalization reports
  -> ideas/approved
  -> LLM-coded rule specs
  -> strategies/ready_to_backtest
  -> deterministic backtest engine
  -> strategies/backtested
  -> deterministic PF/trade-count gate
  -> strategies/qualified
  -> reports
```

The intended stage ownership is:

1. **Idea Discovery:** an LLM reads online and YouTube-sourced search results
   and adds rough discoveries to `ideas/inbox/`.
2. **Idea Formalization:** an LLM turns new ideas into organized formal reports
   with timeframe, assets, setup, entry conditions, exit conditions, TP, SL,
   limit-order handling, filters, and notes, then moves them to
   `ideas/approved/`.
3. **Strategy Coding:** an LLM turns formalized ideas into constrained `llm_rule_code`
   strategy specs with explicit entry conditions, stop-loss, take-profit,
   risk/reward, session, and exit controls.
4. **Backtest Review:** no LLM is used. The Python backtest engine runs the
   coded spec against historical candles and writes detailed stats.
5. **Finished Strategies:** no LLM is used. A strategy is finished only when PF
   is greater than `2.0`, trades are greater than `20`, and total R is positive.

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

Convert formalized ideas into many ready-to-backtest specs:

```powershell
python Research\scripts\build_ready_to_backtest.py --markets futures,forex
```

Convert formalized ideas into Nebius Token Factory LLM-coded rule specs:

```powershell
python Research\scripts\llm_strategy_factory.py code --markets futures,forex --max-per-idea 3 --limit 25
```

Run the LLM-driven staged pipeline locally:

```powershell
python Research\scripts\research_center.py stage --stage research
python Research\scripts\research_center.py stage --stage idea
python Research\scripts\research_center.py stage --stage coding --max-per-idea 3 --limit 25
python Research\scripts\research_center.py stage --stage backtest --min-pf 2 --min-trades 21
```

Run the whole LLM local flow:

```powershell
python Research\scripts\research_center.py llm-cycle --min-pf 2 --min-trades 21 --limit 25
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
- `ideas/inbox/` stores new ideas that have not been formalized for testing.
- `ideas/approved/` stores formalized executable ideas.
- `reports/*_summary.md` stores LLM summaries for research, idea, coding,
  backtest, and pipeline stages.
- `strategies/ready_to_backtest/` stores coded single-asset strategy specs,
  including LLM-coded `llm_rule_code` specs.
- `strategies/backtested/` stores all completed backtest results.
- `strategies/qualified/` stores finished strategies meeting the configured PF and
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

Stage 1 online discovery uses the You.com/YDC Search API via `YOU_API_KEY` or
`YDC_API_KEY`, which lets the research step discover web and YouTube sources.
Nebius Token Factory integration reads `NEBIUS_API_KEY` from the environment for
idea structuring, coding, and summaries. Do not commit API keys. The LLM code
stage writes constrained rule expressions that the research backtester evaluates
against historical candles; it does not execute arbitrary generated Python or
TypeScript.
