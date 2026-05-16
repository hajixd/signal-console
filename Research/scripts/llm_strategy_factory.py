from __future__ import annotations

import argparse
import html
import json
import re
import textwrap
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fetch_sources import fetch_text
from search_internet import you_search
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
SUPPORTED_TIMEFRAMES = ["1m", "5m", "15m", "30m", "45m", "1h", "4h", "1d", "overnight"]
URL_PATTERN = re.compile(r"https?://[^\s<>\"')\]]+")


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


def clean_url(value: str) -> str:
    return value.strip().rstrip(".,;:!?")


def urls_from_text(value: Any) -> list[str]:
    return [clean_url(match.group(0)) for match in URL_PATTERN.finditer(str(value or ""))]


def idea_source_urls(idea: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    if isinstance(idea.get("sourceUrls"), list):
        urls.extend(str(item) for item in idea.get("sourceUrls", []) if str(item).strip())
    for key in ["title", "hypothesis", "notes"]:
        urls.extend(urls_from_text(idea.get(key)))
    return list(dict.fromkeys(clean_url(url) for url in urls if clean_url(url)))[:12]


def youtube_video_id(url: str) -> str | None:
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc.lower().replace("www.", "")
    if host == "youtu.be":
        return parsed.path.strip("/").split("/")[0] or None
    if host.endswith("youtube.com"):
        query_id = urllib.parse.parse_qs(parsed.query).get("v", [""])[0]
        if query_id:
            return query_id
        parts = [part for part in parsed.path.split("/") if part]
        for marker in ["embed", "shorts", "live"]:
            if marker in parts:
                index = parts.index(marker)
                if len(parts) > index + 1:
                    return parts[index + 1]
    return None


def request_text(url: str, timeout: int = 30) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "tradingbot-research-center/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(1_500_000).decode("utf-8", errors="replace")


def caption_base_urls(page_text: str) -> list[str]:
    urls: list[str] = []
    patterns = [
        r'"baseUrl":"(https://www\.youtube\.com/api/timedtext[^"]+)"',
        r'"baseUrl":"(https:\\/\\/www\.youtube\.com\\/api\\/timedtext[^"]+)"',
    ]
    for raw in [match for pattern in patterns for match in re.findall(pattern, page_text)]:
        decoded = raw.encode("utf-8").decode("unicode_escape").replace("\\/", "/")
        if decoded not in urls:
            urls.append(decoded)
    return urls


def transcript_from_caption_url(url: str) -> str:
    xml_text = request_text(url, timeout=30)
    root = ET.fromstring(xml_text)
    lines: list[str] = []
    for node in root.iter():
        if node.tag.endswith("text") and node.text:
            lines.append(html.unescape(node.text).strip())
    return " ".join(line for line in lines if line)[:120_000]


def fetch_youtube_transcript(url: str) -> str:
    video_id = youtube_video_id(url)
    if not video_id:
        return ""
    page_text = request_text(f"https://www.youtube.com/watch?v={urllib.parse.quote(video_id)}", timeout=30)
    for caption_url in caption_base_urls(page_text):
        try:
            transcript = transcript_from_caption_url(caption_url)
            if transcript:
                return transcript
        except Exception:
            continue
    return ""


def fetched_source_for_url(url: str) -> dict[str, Any]:
    is_youtube = youtube_video_id(url) is not None
    try:
        text = fetch_youtube_transcript(url) if is_youtube else ""
        kind = "youtube_transcript" if text else "web_page"
        if not text:
            text = fetch_text(url)
        return {
            "kind": kind,
            "title": "YouTube transcript" if kind == "youtube_transcript" else url,
            "url": url,
            "text": text[:120_000],
        }
    except Exception as exc:
        return {
            "kind": "fetch_error",
            "title": url,
            "url": url,
            "text": f"[fetch_error] {exc}",
        }


def persist_enrichment_source(idea_id: str, source: dict[str, Any]) -> None:
    url = str(source.get("url") or "")
    if not url:
        return
    page_id = slug(f"idea_{idea_id}_{source.get('kind', 'source')}_{url}", 88)
    write_json(
        PAGES_ROOT / f"{page_id}.json",
        {
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
            "ideaId": idea_id,
            "query": f"direct source for {idea_id}",
            "snippet": str(source.get("text", ""))[:1000],
            "text": str(source.get("text", "")),
            "title": source.get("title"),
            "topic": "idea_enrichment",
            "url": url,
        },
    )


def source_items_for_idea(idea: dict[str, Any], limit: int = 6) -> list[dict[str, Any]]:
    idea_id = str(idea.get("ideaId") or slug(str(idea.get("title", "idea")), 80))
    sources: list[dict[str, Any]] = []
    for url in idea_source_urls(idea)[:limit]:
        source = fetched_source_for_url(url)
        persist_enrichment_source(idea_id, source)
        sources.append(source)
    return sources


def asset_rows_for_prompt() -> list[dict[str, Any]]:
    return [
        {
            "key": asset.key,
            "symbol": asset.symbol,
            "name": asset.name,
            "market": asset.market,
            "tickSize": asset.tick_size,
        }
        for asset in load_assets(DEFAULT_MARKETS, [])
    ]


def infer_timeframes_from_text(value: str) -> list[str]:
    text = value.lower()
    frames: list[str] = []
    for timeframe in SUPPORTED_TIMEFRAMES:
        if timeframe in text:
            frames.append(timeframe)
    if "scalp" in text or "opening range" in text or "orb" in text:
        frames.extend(["1m", "5m", "15m"])
    if "overnight" in text or "close to open" in text:
        frames.append("overnight")
    if "daily" in text or "swing" in text:
        frames.append("1d")
    return list(dict.fromkeys(frames)) or ["5m", "15m"]


def infer_engines_from_text(value: str, timeframes: list[str]) -> list[str]:
    text = value.lower()
    engines: list[str] = []
    if "overnight" in text or "close to open" in text:
        engines.append("overnight_bias")
    if "gap" in text:
        engines.append("open_gap")
    if "range" in text or "orb" in text or "breakout" in text:
        engines.append("range_break")
    if "daily" in text or "time-series" in text or "tsmom" in text or "1d" in timeframes:
        engines.append("daily_tsmom")
    if not engines:
        engines.append("intraday_momentum")
    return list(dict.fromkeys(engines))


def infer_asset_keys_from_text(value: str, assets: list[dict[str, Any]]) -> list[str]:
    text = value.lower()
    matches: list[str] = []
    aliases = {
        "sp_500_futures": ["s&p", "sp500", "spy", "es ", "mes", "equity index"],
        "nasdaq_100_futures": ["nasdaq", "qqq", "nq ", "mnq"],
        "dow_jones_futures": ["dow", "ym ", "mym"],
        "russell_2000_futures": ["russell", "rt y", "rty", "m2k"],
        "crude_oil_futures": ["crude", "oil", "cl ", "mcl", "wti"],
        "gold_futures": ["gold", "gc ", "mgc", "xau"],
        "euro_futures": ["euro futures", "6e"],
        "australian_dollar_futures": ["aussie", "aud", "6a"],
        "british_pound_futures": ["pound", "gbp", "6b"],
        "japanese_yen_futures": ["yen", "jpy", "6j"],
        "eur_usd": ["eurusd", "eur/usd", "euro dollar"],
        "gbp_usd": ["gbpusd", "gbp/usd", "cable"],
        "usd_jpy": ["usdjpy", "usd/jpy"],
        "aud_usd": ["audusd", "aud/usd"],
    }
    available = {asset["key"] for asset in assets}
    for key, needles in aliases.items():
        if key in available and any(needle in text for needle in needles):
            matches.append(key)
    for asset in assets:
        haystacks = [asset["key"], asset["symbol"], asset["name"]]
        if any(str(item).lower() in text for item in haystacks if str(item).strip()):
            matches.append(str(asset["key"]))
    return list(dict.fromkeys(matches))[:8]


def research_query_fallback(idea: dict[str, Any]) -> list[str]:
    title = str(idea.get("title") or "")
    hypothesis = str(idea.get("hypothesis") or "")
    base = " ".join(part for part in [title, hypothesis] if part).strip() or "trading strategy"
    base = re.sub(URL_PATTERN, "", base).strip()
    return [
        f"{base} trading strategy rules timeframe entry exit",
        f"{base} backtest trading strategy",
        f"{base} YouTube trading strategy transcript entry stop target",
    ][:3]


def prompt_for_idea_research_enrichment(idea: dict[str, Any], sources: list[dict[str, Any]], assets: list[dict[str, Any]]) -> str:
    compact_sources = [
        {
            "kind": source.get("kind"),
            "title": source.get("title"),
            "url": source.get("url"),
            "text": str(source.get("text", ""))[:9000],
        }
        for source in sources
    ]
    return textwrap.dedent(
        f"""
        Investigate this raw trading idea before formalization.

        Return JSON only:
        {{
          "searchQueries": ["3 to 6 precise You.com search queries"],
          "sourceFindings": ["specific extracted facts from source text or transcript"],
          "strategyClues": {{
            "assets": ["candidate asset keys from the asset catalog"],
            "timeframes": ["candidate timeframes"],
            "setup": "what the setup appears to be",
            "entry": "likely entry trigger",
            "exit": "likely exit, stop, target, or invalidation",
            "missingPieces": ["what still needs inference"]
          }}
        }}

        Prefer exact strategy mechanics over vague trading advice. If a YouTube transcript is present,
        infer the actionable rules from it. Use only asset keys available in the provided catalog.

        Raw idea:
        {json.dumps(public_idea(idea), indent=2)}

        Direct sources:
        {json.dumps(compact_sources, indent=2)}

        Asset catalog:
        {json.dumps(assets[:48], indent=2)}
        """
    ).strip()


def enrich_idea_with_research(idea: dict[str, Any], model: Any | None, offline: bool) -> dict[str, Any]:
    assets = asset_rows_for_prompt()
    direct_sources = source_items_for_idea(idea)
    text_blob = " ".join([json.dumps(public_idea(idea)), *(str(source.get("text", ""))[:3000] for source in direct_sources)])
    enrichment: dict[str, Any] = {
        "directSources": direct_sources,
        "searchQueries": research_query_fallback(idea),
        "sourceFindings": [],
        "strategyClues": {
            "assets": infer_asset_keys_from_text(text_blob, assets),
            "timeframes": infer_timeframes_from_text(text_blob),
        },
        "youComResults": [],
    }

    if not offline and model is not None:
        try:
            payload = chat_json(
                model,
                "You are a trading research investigator. Return JSON only.",
                prompt_for_idea_research_enrichment(idea, direct_sources, assets),
                "idea_research_enrichment",
            )
            if isinstance(payload, dict):
                enrichment.update({key: value for key, value in payload.items() if key in {"searchQueries", "sourceFindings", "strategyClues"}})
        except NebiusError as exc:
            print(f"[nebius] idea research enrichment failed for {idea.get('ideaId')}: {exc}")

    queries = [str(item).strip() for item in enrichment.get("searchQueries", []) if str(item).strip()]
    if not queries:
        queries = research_query_fallback(idea)
    seen_urls: set[str] = set()
    you_results: list[dict[str, Any]] = []
    for query in queries[:6]:
        try:
            for result in you_search(query, 5):
                url = str(result.get("url", "")).strip()
                if url and url in seen_urls:
                    continue
                if url:
                    seen_urls.add(url)
                you_results.append({"query": query, **result})
        except Exception as exc:
            you_results.append({"query": query, "provider": "you", "error": str(exc)})
    enrichment["youComResults"] = you_results[:20]
    return enrichment


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
            "ideaReport": idea.get("ideaReport", {}),
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
        "ideaReport": idea.get("ideaReport", {}),
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
    assets = asset_rows_for_prompt()
    structured: list[dict[str, Any]] = []
    for idea in ideas:
        clean = public_idea(idea)
        structure = clean.get("structure", {}) if isinstance(clean.get("structure"), dict) else {}
        text_blob = json.dumps(clean, default=str)
        timeframes = clean.get("timeframes") if isinstance(clean.get("timeframes"), list) and clean.get("timeframes") else infer_timeframes_from_text(text_blob)
        asset_keys = clean.get("assetKeys") if isinstance(clean.get("assetKeys"), list) and clean.get("assetKeys") else infer_asset_keys_from_text(text_blob, assets)
        engines = clean.get("engines") if isinstance(clean.get("engines"), list) and clean.get("engines") else infer_engines_from_text(text_blob, timeframes)
        payload = {
            **clean,
            "assetKeys": asset_keys,
            "engines": engines,
            "ideaReport": {
                "overallDescription": clean.get("hypothesis", "Structured LLM idea."),
                "summary": clean.get("hypothesis", "Structured LLM idea."),
                "timeframes": timeframes,
                "sourceInterpretation": "Offline fallback inferred the formal idea from the raw inbox text and any saved source URLs.",
                "assetSelection": "Offline fallback inferred assets from title, symbol mentions, source URLs, and local asset catalog aliases.",
                "setup": structure.get("setup", "Test the described source behavior with explicit rule-code."),
                "entry": structure.get("entry", "Enter when the coded condition confirms the setup."),
                "entryConditions": structure.get("entry", "Enter when the coded condition confirms the setup in the selected session and timeframe."),
                "exit": structure.get("exit", "Exit on target, stop, invalidation, or session close."),
                "exitConditions": structure.get("exit", "Exit on target, stop, invalidation, or session close."),
                "stop": structure.get("stop", "Use ATR or structure invalidation."),
                "stopLossPlan": structure.get("stop", "Use ATR or structure invalidation with a small buffer."),
                "target": structure.get("target", "Use fixed R target and session/time exit."),
                "takeProfitPlan": structure.get("target", "Use fixed R target and session/time exit."),
                "useLimitOrder": "No by default; add a limit-order variant only if the source gives a retest price.",
                "limitOrderPlan": "First pass should use market entries so the deterministic backtester can measure the base idea.",
                "filters": structure.get("filters", []),
                "parameterNotes": ["Coding stage should convert the setup into explicit rule-code and parameter ranges."],
                "invalidations": ["Reject if PF <= 2 or trades <= 20.", "Reject if the coded conditions cannot be expressed without lookahead."],
                "implementationNotes": ["Prefer simple session, price-action, trend, range, ATR, and time filters available to the research backtester."],
                "extraNotes": "Offline fallback should be reviewed once richer source text is available.",
            },
            "llm": {
                **(clean.get("llm", {}) if isinstance(clean.get("llm"), dict) else {}),
                "ideaModel": model_id,
                "stage": "idea",
            },
            "status": "approved",
            "timeframes": timeframes,
        }
        structured.append(payload)
    return structured


def normalize_list(value: Any, allowed: set[str] | None = None, limit: int = 16) -> list[str]:
    if not isinstance(value, list):
        return []
    items = [str(item).strip() for item in value if str(item).strip()]
    if allowed is not None:
        items = [item for item in items if item in allowed]
    return list(dict.fromkeys(items))[:limit]


def normalize_asset_keys(value: Any, assets: list[dict[str, Any]], fallback_text: str) -> list[str]:
    allowed = {str(asset["key"]) for asset in assets}
    requested = normalize_list(value, allowed, limit=12)
    if requested:
        return requested
    return infer_asset_keys_from_text(fallback_text, assets)


def prompt_for_single_idea_structuring(idea: dict[str, Any], enrichment: dict[str, Any], assets: list[dict[str, Any]]) -> str:
    compact_sources = [
        {
            "kind": source.get("kind"),
            "title": source.get("title"),
            "url": source.get("url"),
            "text": str(source.get("text", ""))[:9000],
        }
        for source in enrichment.get("directSources", [])
        if isinstance(source, dict)
    ]
    return textwrap.dedent(
        f"""
        Turn this raw trading idea into an excellent formal idea-board output.
        Return JSON only:
        {{
          "idea": {{
            "ideaId": "stable id",
            "title": "clear title",
            "hypothesis": "testable hypothesis",
            "provenance": "youtube_research or web_research or manual",
            "sourceUrls": [],
            "markets": ["futures", "forex"],
            "assetKeys": ["asset keys from catalog"],
            "timeframes": ["1m", "5m", "15m", "30m", "45m", "1h", "4h", "1d", "overnight"],
            "engines": ["intraday_momentum", "overnight_bias", "open_gap", "range_break", "daily_tsmom"],
            "ideaReport": {{
              "overallDescription": "complete natural-language overview of the strategy idea",
              "summary": "detailed but concise research synthesis",
              "sourceInterpretation": "what the source/transcript actually implies",
              "timeframes": ["exact timeframes to test and why"],
              "assetSelection": "why these assets are appropriate",
              "setup": "complete setup structure",
              "entry": "entry rule concept with trigger, confirmation, and timing",
              "entryConditions": "detailed natural-language entry conditions with session, trigger, filters, confirmation, and side logic",
              "exit": "time exit or condition exit",
              "exitConditions": "detailed natural-language exit conditions including target, stop, time exit, invalidation, and no-trade cases",
              "stop": "stop-loss/invalidation concept",
              "stopLossPlan": "how SL is determined in practice",
              "target": "take-profit concept",
              "takeProfitPlan": "how TP is determined in practice",
              "useLimitOrder": "yes, no, or conditional, with a short reason",
              "limitOrderPlan": "if limit orders are useful, describe where they sit and when they expire",
              "filters": ["filters"],
              "parameterNotes": ["candidate parameter ranges for coding/backtest"],
              "invalidations": ["what would disprove it"],
              "implementationNotes": ["how the coding stage should express it without lookahead"],
              "extraNotes": "any research caveats, source uncertainties, or follow-up tests"
            }}
          }}
        }}

        Requirements:
        - Infer the real strategy even if the raw idea is lazy, short, messy, or only a YouTube URL.
        - If a transcript or page text is available, extract entry, exit, timeframe, stop, target, limit-order suitability, filters, and assets from it.
        - If the source is vague, make a coherent testable version and state what you inferred.
        - Use only asset keys from the asset catalog.
        - Prefer single-strategy, backtestable ideas. Do not write code yet.
        - Be detailed enough that the coding stage can produce rule-code without guessing, especially entry conditions, exit conditions, TP, SL, and limit-order handling.

        Raw idea:
        {json.dumps(public_idea(idea), indent=2)}

        Direct source text and transcripts:
        {json.dumps(compact_sources, indent=2)}

        You.com search results:
        {json.dumps(enrichment.get("youComResults", []), indent=2)}

        Research model findings:
        {json.dumps({key: enrichment.get(key) for key in ["sourceFindings", "strategyClues", "searchQueries"]}, indent=2)}

        Asset catalog:
        {json.dumps(assets[:64], indent=2)}
        """
    ).strip()


def prompt_for_idea_review(idea: dict[str, Any], original: dict[str, Any], enrichment: dict[str, Any], assets: list[dict[str, Any]]) -> str:
    return textwrap.dedent(
        f"""
        Review this formalized trading idea for completeness and coherence.
        Return JSON only with a single "idea" object. Preserve the same ideaId.

        Strengthen weak parts, fill missing details from the evidence, and make sure:
        - assetKeys are valid catalog keys,
        - timeframes are explicit,
        - setup, entry conditions, exit conditions, stop/SL plan, target/TP plan, limit-order plan, filters, parameters, and invalidations are detailed,
        - the idea remains backtestable without lookahead or discretionary chart-reading.

        Original raw idea:
        {json.dumps(public_idea(original), indent=2)}

        Draft formal idea:
        {json.dumps(idea, indent=2)}

        Evidence:
        {json.dumps({key: enrichment.get(key) for key in ["sourceFindings", "strategyClues", "youComResults"]}, indent=2)}

        Asset catalog:
        {json.dumps(assets[:64], indent=2)}
        """
    ).strip()


def normalized_structured_idea(
    raw: dict[str, Any],
    original: dict[str, Any],
    enrichment: dict[str, Any],
    model_ids: dict[str, str],
) -> dict[str, Any]:
    assets = asset_rows_for_prompt()
    original_public = public_idea(original)
    source_urls = list(dict.fromkeys([*idea_source_urls(original_public), *normalize_list(raw.get("sourceUrls"), None, 16)]))
    text_blob = json.dumps({"original": original_public, "raw": raw, "enrichment": enrichment}, default=str)
    timeframes = normalize_list(raw.get("timeframes"), set(SUPPORTED_TIMEFRAMES), 10)
    report = raw.get("ideaReport", {}) if isinstance(raw.get("ideaReport"), dict) else {}
    report_timeframes = normalize_list(report.get("timeframes"), set(SUPPORTED_TIMEFRAMES), 10)
    timeframes = timeframes or report_timeframes or infer_timeframes_from_text(text_blob)
    asset_keys = normalize_asset_keys(raw.get("assetKeys"), assets, text_blob)
    engines = normalize_list(raw.get("engines"), {"intraday_momentum", "overnight_bias", "open_gap", "range_break", "daily_tsmom"}, 6)
    engines = engines or infer_engines_from_text(text_blob, timeframes)
    markets = normalize_list(raw.get("markets"), {"futures", "forex"}, 4)
    if not markets and isinstance(original_public.get("markets"), list):
        markets = [str(item) for item in original_public.get("markets", []) if str(item) in {"futures", "forex"}]
    markets = markets or ["futures", "forex"]
    idea_id = str(raw.get("ideaId") or original_public.get("ideaId") or stable_id(str(raw.get("title") or original_public.get("title")), raw, prefix="idea_"))
    merged_report = {
        "overallDescription": str(report.get("overallDescription") or report.get("summary") or raw.get("hypothesis") or original_public.get("hypothesis") or "Formalized strategy idea.")[:2400],
        "summary": str(report.get("summary") or raw.get("hypothesis") or original_public.get("hypothesis") or "Formalized strategy idea.")[:2200],
        "sourceInterpretation": str(report.get("sourceInterpretation") or "Formalization inferred from raw idea text, direct sources, and You.com search results.")[:1800],
        "timeframes": timeframes,
        "assetSelection": str(report.get("assetSelection") or "Assets were selected from the local research catalog based on source symbols, market family, and testability.")[:1600],
        "setup": str(report.get("setup") or "Trade only when the described market behavior is present and measurable.")[:1800],
        "entry": str(report.get("entry") or "Enter when the setup condition confirms in the selected session and timeframe.")[:1800],
        "entryConditions": str(report.get("entryConditions") or report.get("entry") or "Enter when the setup condition confirms in the selected session and timeframe.")[:2200],
        "exit": str(report.get("exit") or "Exit on target, stop, invalidation, or session close.")[:1400],
        "exitConditions": str(report.get("exitConditions") or report.get("exit") or "Exit on target, stop, invalidation, or session close.")[:2200],
        "stop": str(report.get("stop") or "Use ATR or structure invalidation.")[:1400],
        "stopLossPlan": str(report.get("stopLossPlan") or report.get("stop") or "Use ATR or structure invalidation with a small buffer beyond the signal structure.")[:1800],
        "target": str(report.get("target") or "Use fixed R target and session/time exit.")[:1400],
        "takeProfitPlan": str(report.get("takeProfitPlan") or report.get("target") or "Use a fixed R target first, then fall back to session/time exit if the target is not reached.")[:1800],
        "useLimitOrder": str(report.get("useLimitOrder") or "No, unless the source explicitly requires entry at a retest or midpoint.")[:320],
        "limitOrderPlan": str(report.get("limitOrderPlan") or "Default to market entries for the first deterministic backtest; add limit-order variants only when the source defines a retest price.")[:1800],
        "filters": normalize_list(report.get("filters"), None, 12),
        "parameterNotes": normalize_list(report.get("parameterNotes"), None, 12),
        "invalidations": normalize_list(report.get("invalidations"), None, 12) or ["Reject if PF <= 2 or trades <= 20."],
        "implementationNotes": normalize_list(report.get("implementationNotes"), None, 12),
        "extraNotes": str(report.get("extraNotes") or "Keep the first coded version simple and compare variants only after the base hypothesis is measurable.")[:2200],
        "evidence": [
            {
                "kind": source.get("kind"),
                "url": source.get("url"),
                "title": source.get("title"),
            }
            for source in enrichment.get("directSources", [])
            if isinstance(source, dict)
        ][:8],
        "youComQueries": normalize_list(enrichment.get("searchQueries"), None, 8),
    }
    return {
        **original_public,
        **raw,
        "assetKeys": asset_keys,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "engines": engines,
        "hypothesis": str(raw.get("hypothesis") or original_public.get("hypothesis") or merged_report["summary"])[:1600],
        "ideaId": idea_id,
        "ideaReport": merged_report,
        "llm": {
            **(original_public.get("llm", {}) if isinstance(original_public.get("llm"), dict) else {}),
            "ideaModel": model_ids.get("idea"),
            "internetEnriched": True,
            "researchModel": model_ids.get("research"),
            "reviewModel": model_ids.get("pipeline"),
            "stage": "idea",
            "youComResultCount": len(enrichment.get("youComResults", [])),
        },
        "markets": markets,
        "provenance": str(raw.get("provenance") or original_public.get("provenance") or ("youtube_research" if any("youtu" in url for url in source_urls) else "web_research")),
        "sourceUrls": source_urls,
        "status": "approved",
        "timeframes": timeframes,
        "title": str(raw.get("title") or original_public.get("title") or "Formalized trading idea")[:160],
    }


def structure_ideas_with_llm(ideas: list[dict[str, Any]], args: argparse.Namespace) -> list[dict[str, Any]]:
    model_id = "offline-idea-fallback"
    if args.offline:
        return offline_structured_ideas(ideas, model_id)
    assets = asset_rows_for_prompt()
    try:
        models = resolve_task_models(["research", "idea", "pipeline"])
    except NebiusError as exc:
        print(f"[nebius] model resolution failed; using offline fallback: {exc}")
        return offline_structured_ideas(ideas, model_id)
    model_ids = {task: model.id for task, model in models.items()}
    model_id = model_ids.get("idea", model_id)
    structured: list[dict[str, Any]] = []
    for original in ideas:
        try:
            clean = public_idea(original)
            enrichment = enrich_idea_with_research(clean, models.get("research"), args.offline)
            payload = chat_json(
                models["idea"],
                "You are a trading research editor. Formalize raw ideas into excellent backtestable reports. Return JSON only.",
                prompt_for_single_idea_structuring(clean, enrichment, assets),
                "idea_formalization",
            )
            raw = payload.get("idea", payload) if isinstance(payload, dict) else {}
            if not isinstance(raw, dict):
                raise NebiusError("Idea model returned no idea object.")
            formal = normalized_structured_idea(raw, original, enrichment, model_ids)
            try:
                review_payload = chat_json(
                    models["pipeline"],
                    "You are a senior trading strategy reviewer. Return JSON only.",
                    prompt_for_idea_review(formal, original, enrichment, assets),
                    "idea_formalization_review",
                )
                reviewed_raw = review_payload.get("idea", review_payload) if isinstance(review_payload, dict) else {}
                if isinstance(reviewed_raw, dict) and reviewed_raw:
                    formal = normalized_structured_idea(reviewed_raw, formal, enrichment, model_ids)
            except NebiusError as exc:
                print(f"[nebius] idea review failed for {original.get('ideaId')}: {exc}")
            structured.append(formal)
        except NebiusError as exc:
            print(f"[nebius] idea structuring failed for {original.get('ideaId')}; using offline fallback: {exc}")
            structured.extend(offline_structured_ideas([original], model_id))
    return structured or offline_structured_ideas(ideas, model_id)


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
                f"- Assets: {', '.join(str(item) for item in idea.get('assetKeys', [])) or 'n/a'}",
                f"- Engines: {', '.join(str(item) for item in idea.get('engines', [])) or 'n/a'}",
                f"- Overall: {report.get('overallDescription', report.get('summary', 'n/a'))}",
                f"- Setup: {report.get('setup', 'n/a')}",
                f"- Entry Conditions: {report.get('entryConditions', report.get('entry', 'n/a'))}",
                f"- Exit Conditions: {report.get('exitConditions', report.get('exit', 'n/a'))}",
                f"- Stop Loss Plan: {report.get('stopLossPlan', report.get('stop', 'n/a'))}",
                f"- Take Profit Plan: {report.get('takeProfitPlan', report.get('target', 'n/a'))}",
                f"- Use Limit Order: {report.get('useLimitOrder', 'n/a')}",
                f"- Limit Order Plan: {report.get('limitOrderPlan', 'n/a')}",
                f"- Filters: {', '.join(str(item) for item in report.get('filters', [])) or 'n/a'}",
                f"- Parameters: {', '.join(str(item) for item in report.get('parameterNotes', [])) or 'n/a'}",
                f"- Invalidations: {', '.join(str(item) for item in report.get('invalidations', [])) or 'n/a'}",
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
