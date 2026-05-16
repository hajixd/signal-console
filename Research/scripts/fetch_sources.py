from __future__ import annotations

import argparse
import html
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from common import PAGES_ROOT, SEARCH_RESULTS_ROOT, ensure_research_dirs, iter_json_files, read_json, slug, write_json


USER_AGENT = "tradingbot-research-center/1.0"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch pages referenced by Research search results.")
    parser.add_argument("--limit", type=int, default=50, help="Max URLs to fetch in this run.")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def fetch_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        content_type = response.headers.get("content-type", "")
        raw = response.read(1_500_000)
    if "pdf" in content_type.lower() or url.lower().endswith(".pdf"):
        return f"[PDF source, not text-extracted by stdlib fetcher]\n{url}\n"
    text = raw.decode("utf-8", errors="replace")
    text = re.sub(r"(?is)<script.*?</script>|<style.*?</style>|<noscript.*?</noscript>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:120_000]


def search_result_items() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for path in iter_json_files(SEARCH_RESULTS_ROOT):
        if path.name.startswith("_"):
            continue
        payload = read_json(path)
        for result in payload.get("results", []):
            url = str(result.get("url", "")).strip()
            if not url:
                continue
            items.append(
                {
                    "topic": payload.get("topic"),
                    "query": payload.get("query"),
                    "title": result.get("title"),
                    "url": url,
                    "snippet": result.get("snippet"),
                    "searchFile": path.name,
                }
            )
    return items


def main() -> None:
    args = parse_args()
    ensure_research_dirs()
    fetched = []
    seen: set[str] = set()
    for item in search_result_items():
        url = item["url"]
        if url in seen:
            continue
        seen.add(url)
        page_id = slug(f"{item.get('topic', 'source')}_{item.get('title') or url}", 70)
        output_path = PAGES_ROOT / f"{page_id}.json"
        if output_path.exists() and not args.overwrite:
            continue
        try:
            print(f"Fetching {url}")
            text = fetch_text(url)
        except Exception as exc:
            text = f"[fetch_error] {exc}"
        payload = {
            **item,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
            "text": text,
        }
        write_json(output_path, payload)
        fetched.append({"url": url, "file": output_path.name, "characters": len(text)})
        if len(fetched) >= args.limit:
            break
    write_json(PAGES_ROOT / "_latest_manifest.json", {"fetched": fetched})
    print(f"Fetched {len(fetched)} page(s) into {PAGES_ROOT}")


if __name__ == "__main__":
    main()
