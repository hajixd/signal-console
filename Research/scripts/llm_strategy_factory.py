from __future__ import annotations

import argparse
import json
import textwrap
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from common import (
    IDEAS_APPROVED,
    IDEAS_INBOX,
    PAGES_ROOT,
    READY_ROOT,
    REPORTS_ROOT,
    SEARCH_RESULTS_ROOT,
    ensure_research_dirs,
    iter_json_files,
    load_assets,
    read_json,
    split_csv_arg,
    slug,
    stable_id,
    write_json,
)
from nebius_token_factory import NebiusError, chat_json, resolve_task_models, write_summary


RULE_ENGINE = "llm_rule_code"
DEFAULT_MARKETS = ["futures", "forex"]
ALLOWED_SERIES = ["open", "high", "low", "close", "ema50", "ema200", "atr"]
ALLOWED_FUNCTIONS = ["highest", "lowest", "change", "abs", "min", "max"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Nebius Token Factory LLM strategy factory.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("models", help="Resolve and record the best configured Nebius model per task.")

    research = subparsers.add_parser("research", help="Use LLM research synthesis to add new inbox ideas from web and YouTube sources.")
    research.add_argument("--limit", type=int, default=8)
    research.add_argument("--offline", action="store_true")

    ideas = subparsers.add_parser("ideas", help="Summarize inbox ideas and optionally promote LLM-normalized ideas.")
    ideas.add_argument("--limit", type=int, default=8)
    ideas.add_argument("--approve", action="store_true")
    ideas.add_argument("--offline", action="store_true")

    code = subparsers.add_parser("code", help="Turn approved ideas into LLM-coded ready-to-backtest rule specs.")
    code.add_argument("--idea", action="append", help="Idea id filter. Repeatable.")
    code.add_argument("--markets", default="futures,forex")
    code.add_argument("--asset", action="append")
    code.add_argument("--limit", type=int, default=6)
    code.add_argument("--max-per-idea", type=int, default=2)
    code.add_argument("--offline", action="store_true")

    summary = subparsers.add_parser("summarize", help="Summarize the current research pipeline state.")
    summary.add_argument("--stage", default="pipeline", choices=["research", "idea", "coding", "backtest", "pipeline"])
    summary.add_argument("--offline", action="store_true")

    return parser.parse_args()


def idea_time(idea: dict[str, Any]) -> str:
    return str(idea.get("createdAt") or "")


def selected_ideas(filters: list[str] | None, include_inbox: bool = False, limit: int = 0) -> list[dict[str, Any]]:
    requested = {item.strip().lower() for raw in (filters or []) for item in split_csv_arg(raw)}
    paths = list(iter_json_files(IDEAS_APPROVED))
    if include_inbox:
        paths.extend(iter_json_files(IDEAS_INBOX))
    ideas: list[dict[str, Any]] = []
    for path in paths:
        idea = read_json(path)
        idea_id = str(idea.get("ideaId", path.stem)).lower()
        if requested and idea_id not in requested and path.stem.lower() not in requested:
            continue
        if not include_inbox and idea.get("status") not in {None, "approved"}:
            continue
        idea.setdefault("ideaId", path.stem)
        idea["__path"] = str(path)
        ideas.append(idea)
    ideas.sort(key=idea_time, reverse=True)
    return ideas[:limit] if limit else ideas


def public_idea(idea: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in idea.items() if not key.startswith("__")}


def source_items(limit: int) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for path in iter_json_files(PAGES_ROOT):
        if path.name.startswith("_"):
            continue
        payload = read_json(path)
        items.append(
            {
                "title": payload.get("title"),
                "url": payload.get("url"),
                "query": payload.get("query"),
                "topic": payload.get("topic"),
                "snippet": payload.get("snippet"),
                "text": str(payload.get("text", ""))[:5000],
                "sourceFile": path.name,
            }
        )
        if len(items) >= limit:
            return items
    for path in iter_json_files(SEARCH_RESULTS_ROOT):
        if path.name.startswith("_"):
            continue
        payload = read_json(path)
        results = payload.get("results", [])
        if not results:
            items.append(
                {
                    "title": payload.get("query"),
                    "url": "",
                    "query": payload.get("query"),
                    "topic": payload.get("topic"),
                    "snippet": "No fetched result text was available; use the query as the research lead.",
                    "provider": "query_fallback",
                    "sourceFile": path.name,
                }
            )
            if len(items) >= limit:
                return items
        for result in results:
            items.append(
                {
                    "title": result.get("title"),
                    "url": result.get("url"),
                    "query": payload.get("query"),
                    "topic": payload.get("topic"),
                    "snippet": result.get("snippet"),
                    "provider": result.get("provider"),
                    "sourceFile": path.name,
                }
            )
            if len(items) >= limit:
                return items
    return items


def write_inbox_idea(raw: dict[str, Any], model_id: str) -> Path:
    title = str(raw.get("title") or "LLM research idea").strip()[:160]
    idea_id = str(raw.get("ideaId") or slug(title, 90) or stable_id(title, raw, prefix="llm_"))
    source_urls = [str(item) for item in raw.get("sourceUrls", []) if str(item).strip()][:8] if isinstance(raw.get("sourceUrls"), list) else []
    timeframes = [str(item) for item in raw.get("timeframes", []) if str(item).strip()][:8] if isinstance(raw.get("timeframes"), list) else ["15m"]
    markets = [str(item) for item in raw.get("markets", []) if str(item) in {"futures", "forex"}] if isinstance(raw.get("markets"), list) else ["futures", "forex"]
    payload = {
        "assetKeys": [str(item) for item in raw.get("assetKeys", []) if str(item).strip()][:12] if isinstance(raw.get("assetKeys"), list) else [],
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "engines": [],
        "hypothesis": str(raw.get("hypothesis") or raw.get("summary") or "LLM-researched trading idea.")[:1200],
        "ideaId": idea_id,
        "llm": {
            "model": model_id,
            "stage": "research",
        },
        "markets": markets or ["futures", "forex"],
        "provenance": str(raw.get("provenance") or "youtube_research")[:80],
        "sourceUrls": source_urls,
        "status": "inbox",
        "structure": raw.get("structure", {}),
        "timeframes": timeframes,
        "title": title,
    }
    path = IDEAS_INBOX / f"{slug(idea_id, 100)}.json"
    write_json(path, payload)
    return path


def offline_research_payload(limit: int) -> dict[str, Any]:
    ideas: list[dict[str, Any]] = []
    for item in source_items(limit):
        title = str(item.get("title") or item.get("query") or "YouTube strategy research").strip()
        if not title:
            continue
        ideas.append(
            {
                "title": title[:140],
                "hypothesis": f"Research source suggests a strategy worth structuring and testing: {str(item.get('snippet') or item.get('query') or '')[:500]}",
                "provenance": "youtube_research" if "youtube.com" in str(item.get("url", "")).lower() else "web_research",
                "sourceUrls": [item.get("url")] if item.get("url") else [],
                "timeframes": ["15m"],
                "markets": ["futures", "forex"],
                "assetKeys": [],
                "structure": {
                    "sourceTitle": title[:160],
                    "researchNote": str(item.get("snippet") or "")[:500],
                },
            }
        )
        if len(ideas) >= limit:
            break
    return {"ideas": ideas, "summary": {"research": [f"Created {len(ideas)} inbox idea(s) from available research sources."]}}


def prompt_for_research(sources: list[dict[str, Any]], limit: int) -> str:
    return textwrap.dedent(
        f"""
        Read these online and YouTube trading research sources and turn them into new strategy ideas.
        Return JSON only:
        {{
          "ideas": [
            {{
              "title": "concise idea title",
              "hypothesis": "what market behavior should be tested",
              "provenance": "youtube_research or web_research",
              "sourceUrls": ["source URL"],
              "timeframes": ["1m", "5m", "15m", "1h", "1d", "overnight"],
              "markets": ["futures", "forex"],
              "assetKeys": [],
              "structure": {{
                "setup": "plain-English setup",
                "entry": "entry concept",
                "stop": "stop concept",
                "target": "target concept",
                "filters": ["filter ideas"]
              }}
            }}
          ],
          "summary": {{
            "research": ["brief notes"]
          }}
        }}

        Prefer concrete, testable ideas. Avoid vague mentorship advice or discretionary-only claims.
        Generate at most {limit} ideas.

        Sources:
        {json.dumps(sources, indent=2)}
        """
    ).strip()


def command_research(args: argparse.Namespace) -> None:
    ensure_research_dirs()
    sources = source_items(args.limit * 2)
    model_id = "offline-research-fallback"
    if args.offline:
        payload = offline_research_payload(args.limit)
    else:
        try:
            model = resolve_task_models(["research"])["research"]
            model_id = model.id
            payload = chat_json(
                model,
                "You are a trading research analyst. Return valid JSON only.",
                prompt_for_research(sources, args.limit),
            )
        except NebiusError as exc:
            print(f"[nebius] research failed; using offline fallback: {exc}")
            payload = offline_research_payload(args.limit)

    written: list[Path] = []
    for raw in payload.get("ideas", []):
        if isinstance(raw, dict):
            written.append(write_inbox_idea(raw, model_id))
        if len(written) >= args.limit:
            break
    notes = payload.get("summary", {}).get("research", []) if isinstance(payload.get("summary"), dict) else []
    lines = [f"Added {len(written)} new idea(s) to the inbox from online/YouTube research.", ""]
    lines.extend(f"- {note}" for note in notes if str(note).strip())
    lines.extend(f"- `{path.name}`" for path in written[:20])
    write_summary("research", "Research Summary", lines)
    print(f"Added {len(written)} inbox idea(s).")


def asset_lookup(markets: list[str], asset_filters: list[str]) -> dict[str, Any]:
    assets = load_assets(markets, asset_filters)
    lookup: dict[str, Any] = {}
    for asset in assets:
        lookup[asset.key.lower()] = asset
        lookup[asset.symbol.lower()] = asset
    return lookup


def idea_assets(idea: dict[str, Any], markets: list[str], asset_filters: list[str]) -> list[Any]:
    idea_markets = [str(item) for item in idea.get("markets", []) if str(item)]
    selected_markets = [market for market in markets if not idea_markets or market in idea_markets]
    assets = load_assets(selected_markets, asset_filters)
    requested = {str(item).lower() for item in idea.get("assetKeys", []) if str(item)}
    if requested:
        assets = [asset for asset in assets if asset.key.lower() in requested or asset.symbol.lower() in requested]
    return assets


def clean_condition(value: Any, fallback: str) -> str:
    text = str(value or "").strip()
    if not text:
        return fallback
    return text.replace("\n", " ")[:500]


def rule_code_from_payload(raw: dict[str, Any], idea: dict[str, Any]) -> dict[str, Any]:
    title = f"{idea.get('title', '')} {idea.get('hypothesis', '')}".lower()
    fallback_long = "minute >= 570 and minute <= 945 and close > ema50 and change('close', 4) > 0"
    fallback_short = "minute >= 570 and minute <= 945 and close < ema50 and change('close', 4) < 0"
    if "range" in title or "break" in title or "london" in title:
        fallback_long = "minute >= 570 and minute <= 720 and close > highest('high', 8) and close > ema50"
        fallback_short = "minute >= 570 and minute <= 720 and close < lowest('low', 8) and close < ema50"
    if "overnight" in title or "gap" in title:
        fallback_long = "minute >= 570 and minute <= 660 and change('close', 12) < 0 and close > ema200"
        fallback_short = "minute >= 570 and minute <= 660 and change('close', 12) > 0 and close < ema200"
    if "time-series" in title or "tsmom" in title or "momentum" in title:
        fallback_long = "minute >= 570 and minute <= 945 and change('close', 20) > 0 and close > ema50"
        fallback_short = "minute >= 570 and minute <= 945 and change('close', 20) < 0 and close < ema50"
    return {
        "longWhen": clean_condition(raw.get("longWhen"), fallback_long),
        "shortWhen": clean_condition(raw.get("shortWhen"), fallback_short),
        "riskAtrMult": max(0.25, min(float(raw.get("riskAtrMult", 1.0) or 1.0), 6.0)),
        "riskReward": max(0.5, min(float(raw.get("riskReward", 1.5) or 1.5), 6.0)),
        "maxBars": max(1, min(int(raw.get("maxBars", 24) or 24), 288)),
        "oneTradePerDay": bool(raw.get("oneTradePerDay", True)),
        "sessionStartMinute": max(0, min(int(raw.get("sessionStartMinute", 0) or 0), 1439)),
        "sessionEndMinute": max(0, min(int(raw.get("sessionEndMinute", 1439) or 1439), 1439)),
        "exitMinute": max(0, min(int(raw.get("exitMinute", 945) or 945), 1439)),
    }


def offline_strategy_payloads(ideas: list[dict[str, Any]], markets: list[str], asset_filters: list[str], max_per_idea: int, limit: int) -> dict[str, Any]:
    strategies: list[dict[str, Any]] = []
    for idea in ideas:
        for asset in idea_assets(idea, markets, asset_filters)[:max_per_idea]:
            strategies.append(
                {
                    "ideaId": idea.get("ideaId"),
                    "title": idea.get("title"),
                    "assetKey": asset.key,
                    "symbol": asset.symbol,
                    "market": asset.market,
                    "summary": "Offline rule-code fallback generated from idea text.",
                    "rationale": "Used when NEBIUS_API_KEY is absent or the LLM call fails.",
                    "ruleCode": rule_code_from_payload({}, idea),
                }
            )
            if limit and len(strategies) >= limit:
                break
        if limit and len(strategies) >= limit:
            break
    return {
        "strategies": strategies,
        "summary": {
            "coding": [
                f"Prepared {len(strategies)} LLM-rule strategy spec(s).",
                "The generated engine is flexible rule-code evaluated by the research backtester.",
            ]
        },
    }


def prompt_for_strategy_code(ideas: list[dict[str, Any]], assets: list[Any], max_per_idea: int, limit: int) -> str:
    asset_rows = [
        {
            "key": asset.key,
            "symbol": asset.symbol,
            "name": asset.name,
            "market": asset.market,
            "tickSize": asset.tick_size,
        }
        for asset in assets[:32]
    ]
    compact_ideas = [
        {
            "ideaId": idea.get("ideaId"),
            "title": idea.get("title"),
            "hypothesis": idea.get("hypothesis"),
            "markets": idea.get("markets", []),
            "assetKeys": idea.get("assetKeys", []),
            "timeframes": idea.get("timeframes", []),
            "sourceUrls": idea.get("sourceUrls", []),
            "structure": idea.get("structure", {}),
        }
        for idea in [public_idea(item) for item in ideas]
    ]
    return textwrap.dedent(
        f"""
        Convert these trading ideas into backtestable strategy rule-code.

        Return JSON only with:
        {{
          "strategies": [
            {{
              "ideaId": "source idea id",
              "title": "short strategy title",
              "assetKey": "one asset key from the provided assets",
              "summary": "one sentence",
              "rationale": "why this code expresses the idea",
              "ruleCode": {{
                "longWhen": "boolean expression",
                "shortWhen": "boolean expression",
                "stopLoss": "ATR stop, structure stop, or invalidation rule",
                "takeProfit": "fixed R target, session exit, or structure target",
                "riskAtrMult": 1.0,
                "riskReward": 1.5,
                "maxBars": 24,
                "oneTradePerDay": true,
                "sessionStartMinute": 570,
                "sessionEndMinute": 945,
                "exitMinute": 945
              }}
            }}
          ],
          "summary": {{
            "coding": ["brief notes about what was coded"]
          }}
        }}

        The rule-code expression language supports names:
        open, high, low, close, close_1, atr, ema50, ema200, minute, weekday.
        It supports functions: highest("high", n), lowest("low", n), change("close", n), abs(x), min(a,b), max(a,b).
        Do not use unavailable indicators, imports, loops, future bars, or portfolio/multi-symbol state.
        Each strategy must trade exactly one asset. Generate at most {max_per_idea} strategy specs per idea and {limit} total.

        Ideas:
        {json.dumps(compact_ideas, indent=2)}

        Assets:
        {json.dumps(asset_rows, indent=2)}
        """
    ).strip()


def write_ready_strategy(raw: dict[str, Any], idea_by_id: dict[str, dict[str, Any]], assets: dict[str, Any], model_id: str) -> Path | None:
    idea_id = str(raw.get("ideaId") or "").strip()
    idea = idea_by_id.get(idea_id) or next(iter(idea_by_id.values()), {})
    asset_key = str(raw.get("assetKey") or "").strip().lower()
    asset = assets.get(asset_key)
    if asset is None:
        return None
    rule_code = rule_code_from_payload(raw.get("ruleCode", {}) if isinstance(raw.get("ruleCode"), dict) else {}, idea)
    spec_id = stable_id(idea_id or str(idea.get("ideaId")), asset.key, RULE_ENGINE, rule_code, prefix="rs_llm_")
    folder = READY_ROOT / spec_id
    payload = {
        "assetKey": asset.key,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "engine": RULE_ENGINE,
        "hypothesis": idea.get("hypothesis"),
        "ideaId": idea.get("ideaId") or idea_id,
        "llm": {
            "model": model_id,
            "rationale": str(raw.get("rationale") or ""),
            "summary": str(raw.get("summary") or ""),
        },
        "market": asset.market,
        "params": {
            "ruleCode": rule_code,
            "stopLoss": str(raw.get("ruleCode", {}).get("stopLoss", "") if isinstance(raw.get("ruleCode"), dict) else "")[:240],
            "takeProfit": str(raw.get("ruleCode", {}).get("takeProfit", "") if isinstance(raw.get("ruleCode"), dict) else "")[:240],
        },
        "provenance": idea.get("provenance", "llm"),
        "sourceUrls": idea.get("sourceUrls", []),
        "status": "ready_to_backtest",
        "strategyId": spec_id,
        "symbol": asset.symbol,
        "thresholds": {
            "minProfitFactor": 2.0,
            "minTrades": 21,
        },
        "title": str(raw.get("title") or idea.get("title") or "LLM-coded strategy")[:160],
    }
    write_json(folder / "strategy.json", payload)
    return folder


def command_models() -> None:
    models = resolve_task_models(["research", "idea", "coding", "summary", "pipeline"])
    for task, model in models.items():
        print(f"{task}: {model.id}")


def command_code(args: argparse.Namespace) -> None:
    ensure_research_dirs()
    markets = split_csv_arg(args.markets) or DEFAULT_MARKETS
    asset_filters = [item for raw in (args.asset or []) for item in split_csv_arg(raw)]
    ideas = [public_idea(idea) for idea in selected_ideas(args.idea, limit=max(args.limit, 1))]
    if not ideas:
        write_summary("coding", "Coding Summary", ["No approved ideas were available for LLM coding."])
        print("No approved ideas available.")
        return

    assets = load_assets(markets, asset_filters)
    if not assets:
        raise SystemExit("No assets with local data match the requested filters.")

    model_id = "offline-rule-fallback"
    payload: dict[str, Any]
    if args.offline:
        payload = offline_strategy_payloads(ideas, markets, asset_filters, args.max_per_idea, args.limit)
    else:
        try:
            model = resolve_task_models(["coding"])["coding"]
            model_id = model.id
            payload = chat_json(
                model,
                "You are a trading strategy coding agent. Return valid JSON only. Avoid lookahead bias.",
                prompt_for_strategy_code(ideas, assets, args.max_per_idea, args.limit),
            )
        except NebiusError as exc:
            print(f"[nebius] coding failed; using offline fallback: {exc}")
            payload = offline_strategy_payloads(ideas, markets, asset_filters, args.max_per_idea, args.limit)

    idea_by_id = {str(idea.get("ideaId")): idea for idea in ideas if idea.get("ideaId")}
    assets_by_key = asset_lookup(markets, asset_filters)
    written: list[Path] = []
    for raw in payload.get("strategies", []):
        if not isinstance(raw, dict):
            continue
        path = write_ready_strategy(raw, idea_by_id, assets_by_key, model_id)
        if path:
            written.append(path)
        if args.limit and len(written) >= args.limit:
            break

    notes = payload.get("summary", {}).get("coding", []) if isinstance(payload.get("summary"), dict) else []
    lines = [f"Wrote {len(written)} LLM-coded ready-to-backtest strategy spec(s).", ""]
    lines.extend(f"- {note}" for note in notes if str(note).strip())
    lines.extend(f"- `{path.name}`" for path in written[:20])
    write_summary("coding", "Coding Summary", lines)
    print(f"Wrote {len(written)} LLM-coded ready-to-backtest strategy folder(s).")


def command_ideas(args: argparse.Namespace) -> None:
    ideas = [idea for idea in selected_ideas(None, include_inbox=True, limit=args.limit) if idea.get("status") != "approved"]
    if args.approve:
        structured = structure_ideas_with_llm(ideas, args)
        written: list[Path] = []
        for promoted in structured:
            target = IDEAS_APPROVED / f"{slug(str(promoted.get('ideaId', 'idea')), 100)}.json"
            write_json(target, promoted)
            written.append(target)
        for idea in ideas:
            source_path = idea.get("__path")
            if source_path:
                Path(str(source_path)).unlink(missing_ok=True)
        lines = [f"Structured {len(written)} new idea(s) into approved idea-board output.", ""]
        lines.extend(f"- `{path.name}`" for path in written[:20])
        write_idea_board_report(structured)
        write_summary("idea", "Idea Summary", lines)
        print(f"Structured {len(written)} idea(s).")
        return
    lines = [f"Reviewed {len(ideas)} new inbox idea(s)."]
    for idea in ideas[:12]:
        lines.append(f"- {idea.get('ideaId')}: {idea.get('title')} ({idea.get('status', 'unknown')})")
    write_summary("idea", "Idea Summary", lines)
    print(f"Summarized {len(ideas)} new idea(s).")


def offline_structured_ideas(ideas: list[dict[str, Any]], model_id: str) -> list[dict[str, Any]]:
    structured: list[dict[str, Any]] = []
    for idea in ideas:
        clean = public_idea(idea)
        structure = clean.get("structure", {}) if isinstance(clean.get("structure"), dict) else {}
        timeframes = clean.get("timeframes") if isinstance(clean.get("timeframes"), list) and clean.get("timeframes") else ["15m"]
        payload = {
            **clean,
            "engines": [],
            "ideaReport": {
                "summary": clean.get("hypothesis", "Structured LLM idea."),
                "timeframes": timeframes,
                "setup": structure.get("setup", "Test the described source behavior with explicit rule-code."),
                "entry": structure.get("entry", "Enter when the coded condition confirms the setup."),
                "stop": structure.get("stop", "Use ATR or structure invalidation."),
                "target": structure.get("target", "Use fixed R target and session/time exit."),
                "filters": structure.get("filters", []),
                "invalidations": ["Reject if PF <= 2 or trades <= 20."],
            },
            "llm": {
                **(clean.get("llm", {}) if isinstance(clean.get("llm"), dict) else {}),
                "ideaModel": model_id,
                "stage": "idea",
            },
            "status": "approved",
        }
        structured.append(payload)
    return structured


def prompt_for_idea_structuring(ideas: list[dict[str, Any]]) -> str:
    compact = [public_idea(idea) for idea in ideas]
    return textwrap.dedent(
        f"""
        Turn these raw new trading ideas into clean idea-board outputs.
        Return JSON only:
        {{
          "ideas": [
            {{
              "ideaId": "stable id",
              "title": "clear title",
              "hypothesis": "testable hypothesis",
              "provenance": "youtube_research or web_research or manual",
              "sourceUrls": [],
              "markets": ["futures", "forex"],
              "assetKeys": [],
              "timeframes": ["1m", "5m", "15m", "30m", "1h", "1d", "overnight"],
              "engines": [],
              "ideaReport": {{
                "summary": "organized research summary",
                "timeframes": ["exact timeframes to test"],
                "setup": "complete setup structure",
                "entry": "entry rule concept",
                "stop": "stop-loss/invalidation concept",
                "target": "take-profit concept",
                "filters": ["filters"],
                "invalidations": ["what would disprove it"]
              }}
            }}
          ]
        }}

        Keep each idea single-strategy and backtestable. Do not code yet.

        Raw ideas:
        {json.dumps(compact, indent=2)}
        """
    ).strip()


def structure_ideas_with_llm(ideas: list[dict[str, Any]], args: argparse.Namespace) -> list[dict[str, Any]]:
    model_id = "offline-idea-fallback"
    if args.offline:
        return offline_structured_ideas(ideas, model_id)
    try:
        model = resolve_task_models(["idea"])["idea"]
        model_id = model.id
        payload = chat_json(
            model,
            "You are a trading research editor. Structure raw ideas into backtestable reports. Return JSON only.",
            prompt_for_idea_structuring(ideas),
        )
        raw_ideas = payload.get("ideas", [])
        structured = []
        for raw, original in zip(raw_ideas, ideas, strict=False):
            if not isinstance(raw, dict):
                continue
            merged = {
                **public_idea(original),
                **raw,
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "llm": {
                    **(public_idea(original).get("llm", {}) if isinstance(public_idea(original).get("llm"), dict) else {}),
                    "ideaModel": model_id,
                    "stage": "idea",
                },
                "status": "approved",
            }
            structured.append(merged)
        return structured or offline_structured_ideas(ideas, model_id)
    except NebiusError as exc:
        print(f"[nebius] idea structuring failed; using offline fallback: {exc}")
        return offline_structured_ideas(ideas, model_id)


def write_idea_board_report(ideas: list[dict[str, Any]]) -> None:
    lines = ["# Idea Board Report", "", f"Generated: {datetime.now(timezone.utc).isoformat()}", ""]
    if not ideas:
        lines.append("No new ideas were structured.")
    for idea in ideas:
        report = idea.get("ideaReport", {}) if isinstance(idea.get("ideaReport"), dict) else {}
        lines.extend(
            [
                f"## {idea.get('title', idea.get('ideaId', 'Untitled idea'))}",
                "",
                f"- Idea ID: `{idea.get('ideaId', 'n/a')}`",
                f"- Timeframes: {', '.join(str(item) for item in report.get('timeframes', idea.get('timeframes', [])))}",
                f"- Setup: {report.get('setup', 'n/a')}",
                f"- Entry: {report.get('entry', 'n/a')}",
                f"- Stop: {report.get('stop', 'n/a')}",
                f"- Target: {report.get('target', 'n/a')}",
                "",
                str(report.get("summary", idea.get("hypothesis", ""))),
                "",
            ]
        )
    (REPORTS_ROOT / "idea_board_report.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def command_summarize(args: argparse.Namespace) -> None:
    rows: list[str] = []
    summary_path = REPORTS_ROOT / "latest_candidate_report.md"
    if summary_path.exists():
        rows.extend(summary_path.read_text(encoding="utf-8").splitlines()[:80])
    else:
        rows.append("No candidate report exists yet.")
    if args.offline:
        write_summary(args.stage, f"{args.stage.title()} Summary", rows)
        print(f"Wrote offline {args.stage} summary.")
        return
    try:
        model = resolve_task_models(["summary"])["summary"]
        payload = chat_json(
            model,
            "Summarize the research pipeline state. Return JSON with a lines array only.",
            json.dumps({"stage": args.stage, "reportLines": rows}, indent=2),
        )
        lines = payload.get("lines", rows)
        if not isinstance(lines, list):
            lines = rows
    except NebiusError as exc:
        print(f"[nebius] summary failed; writing offline summary: {exc}")
        lines = rows
    write_summary(args.stage, f"{args.stage.title()} Summary", [str(line) for line in lines[:40]])
    print(f"Wrote {args.stage} summary.")


def main() -> None:
    args = parse_args()
    if args.command == "models":
        command_models()
    elif args.command == "research":
        command_research(args)
    elif args.command == "ideas":
        command_ideas(args)
    elif args.command == "code":
        command_code(args)
    elif args.command == "summarize":
        command_summarize(args)


if __name__ == "__main__":
    main()
