from __future__ import annotations

import argparse
import html
import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from common import CONFIG_ROOT, SEARCH_RESULTS_ROOT, ensure_research_dirs, read_json, slug, write_json


USER_AGENT = "tradingbot-research-center/1.0"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Search the internet for strategy research sources.")
    parser.add_argument("--topic", action="append", help="Topic key from config/query_sets.json. Repeatable.")
    parser.add_argument("--query", action="append", help="Ad hoc query. Repeatable.")
    parser.add_argument("--limit", type=int, default=8, help="Max results per query.")
    parser.add_argument("--provider", choices=["auto", "brave", "serpapi", "tavily", "duckduckgo"], default="auto")
    return parser.parse_args()


def request_json(url: str, headers: dict[str, str] | None = None, body: bytes | None = None) -> dict[str, Any]:
    request = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def request_text(url: str, headers: dict[str, str] | None = None) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(request, timeout=25) as response:
        return response.read().decode("utf-8", errors="replace")


def brave_search(query: str, limit: int) -> list[dict[str, str]]:
    api_key = os.environ.get("BRAVE_SEARCH_API_KEY")
    if not api_key:
        raise RuntimeError("BRAVE_SEARCH_API_KEY is not set")
    params = urllib.parse.urlencode({"q": query, "count": min(limit, 20)})
    payload = request_json(
        f"https://api.search.brave.com/res/v1/web/search?{params}",
        headers={"Accept": "application/json", "X-Subscription-Token": api_key},
    )
    results = []
    for item in payload.get("web", {}).get("results", [])[:limit]:
        results.append(
            {
                "title": str(item.get("title", "")),
                "url": str(item.get("url", "")),
                "snippet": str(item.get("description", "")),
                "provider": "brave",
            }
        )
    return results


def serpapi_search(query: str, limit: int) -> list[dict[str, str]]:
    api_key = os.environ.get("SERPAPI_API_KEY")
    if not api_key:
        raise RuntimeError("SERPAPI_API_KEY is not set")
    params = urllib.parse.urlencode({"engine": "google", "q": query, "num": limit, "api_key": api_key})
    payload = request_json(f"https://serpapi.com/search.json?{params}")
    results = []
    for item in payload.get("organic_results", [])[:limit]:
        results.append(
            {
                "title": str(item.get("title", "")),
                "url": str(item.get("link", "")),
                "snippet": str(item.get("snippet", "")),
                "provider": "serpapi",
            }
        )
    return results


def tavily_search(query: str, limit: int) -> list[dict[str, str]]:
    api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key:
        raise RuntimeError("TAVILY_API_KEY is not set")
    body = json.dumps({"api_key": api_key, "query": query, "max_results": limit}).encode("utf-8")
    payload = request_json("https://api.tavily.com/search", headers={"Content-Type": "application/json"}, body=body)
    results = []
    for item in payload.get("results", [])[:limit]:
        results.append(
            {
                "title": str(item.get("title", "")),
                "url": str(item.get("url", "")),
                "snippet": str(item.get("content", "")),
                "provider": "tavily",
            }
        )
    return results


def duckduckgo_search(query: str, limit: int) -> list[dict[str, str]]:
    params = urllib.parse.urlencode({"q": query})
    text = request_text(f"https://duckduckgo.com/html/?{params}")
    pattern = re.compile(
        r'<a rel="nofollow" class="result__a" href="(?P<href>.*?)".*?>(?P<title>.*?)</a>.*?'
        r'<a class="result__snippet".*?>(?P<snippet>.*?)</a>',
        re.DOTALL,
    )
    results = []
    for match in pattern.finditer(text):
        href = html.unescape(re.sub(r"<.*?>", "", match.group("href")))
        title = html.unescape(re.sub(r"<.*?>", "", match.group("title"))).strip()
        snippet = html.unescape(re.sub(r"<.*?>", "", match.group("snippet"))).strip()
        parsed = urllib.parse.urlparse(href)
        if parsed.netloc.endswith("duckduckgo.com"):
            query_params = urllib.parse.parse_qs(parsed.query)
            href = query_params.get("uddg", [href])[0]
        results.append({"title": title, "url": href, "snippet": snippet, "provider": "duckduckgo"})
        if len(results) >= limit:
            break
    return results


def search(query: str, limit: int, provider: str) -> list[dict[str, str]]:
    providers = [provider] if provider != "auto" else ["brave", "serpapi", "tavily", "duckduckgo"]
    errors: list[str] = []
    for candidate in providers:
        try:
            if candidate == "brave":
                results = brave_search(query, limit)
            elif candidate == "serpapi":
                results = serpapi_search(query, limit)
            elif candidate == "tavily":
                results = tavily_search(query, limit)
            else:
                results = duckduckgo_search(query, limit)
            if results:
                return results
        except Exception as exc:
            errors.append(f"{candidate}: {exc}")
    if errors:
        print(f"WARNING: no provider returned results for {query!r}: {' | '.join(errors)}")
    else:
        print(f"WARNING: no provider returned results for {query!r}")
    return []


def selected_queries(args: argparse.Namespace) -> list[tuple[str, str]]:
    query_sets = read_json(CONFIG_ROOT / "query_sets.json")
    selected: list[tuple[str, str]] = []
    topics = args.topic or ([] if args.query else list(query_sets.keys()))
    for topic in topics:
        for query in query_sets.get(topic, []):
            selected.append((topic, query))
    for index, query in enumerate(args.query or [], start=1):
        selected.append((f"adhoc_{index}", query))
    return selected


def main() -> None:
    args = parse_args()
    ensure_research_dirs()
    manifest_rows = []
    for topic, query in selected_queries(args):
        print(f"Searching [{topic}] {query}")
        results = search(query, args.limit, args.provider)
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "topic": topic,
            "query": query,
            "searchedAt": now,
            "limit": args.limit,
            "results": results,
        }
        file_name = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}_{slug(topic)}_{slug(query, 48)}.json"
        output_path = SEARCH_RESULTS_ROOT / file_name
        write_json(output_path, payload)
        manifest_rows.append({"topic": topic, "query": query, "resultCount": len(results), "file": str(output_path.relative_to(SEARCH_RESULTS_ROOT))})
        time.sleep(0.25)
    write_json(SEARCH_RESULTS_ROOT / "_latest_manifest.json", {"runs": manifest_rows})
    print(f"Wrote {len(manifest_rows)} search result file(s) to {SEARCH_RESULTS_ROOT}")


if __name__ == "__main__":
    main()
