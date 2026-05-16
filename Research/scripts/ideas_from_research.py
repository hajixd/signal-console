from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from common import CONFIG_ROOT, IDEAS_APPROVED, IDEAS_INBOX, PAGES_ROOT, ensure_research_dirs, iter_json_files, read_json, slug, stable_id, write_json


KEYWORD_TO_ENGINE = {
    "overnight": "overnight_bias",
    "close-to-open": "overnight_bias",
    "gap": "open_gap",
    "first half": "intraday_momentum",
    "first-half": "intraday_momentum",
    "last half": "intraday_momentum",
    "intraday momentum": "intraday_momentum",
    "london": "intraday_momentum",
    "opening range": "range_break",
    "range breakout": "range_break",
    "time series momentum": "daily_tsmom",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Turn research sources into executable idea files.")
    parser.add_argument("--seed", action="store_true", help="Copy config/seed_ideas.json into approved idea files.")
    parser.add_argument("--from-pages", action="store_true", help="Create draft inbox ideas from fetched page text/snippets.")
    parser.add_argument("--approve-drafts", action="store_true", help="Move generated drafts straight into approved.")
    return parser.parse_args()


def idea_path(directory: Path, idea: dict[str, Any]) -> Path:
    idea_id = idea.get("ideaId") or stable_id(str(idea.get("title", "idea")), idea, prefix="idea_")
    return directory / f"{slug(str(idea_id), 100)}.json"


def write_idea(directory: Path, idea: dict[str, Any]) -> Path:
    payload = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        **idea,
    }
    path = idea_path(directory, payload)
    write_json(path, payload)
    return path


def seed_ideas() -> list[Path]:
    seeds = read_json(CONFIG_ROOT / "seed_ideas.json")
    written: list[Path] = []
    for idea in seeds:
        target = IDEAS_APPROVED if idea.get("status") == "approved" else IDEAS_INBOX
        written.append(write_idea(target, idea))
    return written


def engines_from_text(text: str) -> list[str]:
    lowered = text.lower()
    engines: list[str] = []
    for keyword, engine in KEYWORD_TO_ENGINE.items():
        if keyword in lowered and engine not in engines:
            engines.append(engine)
    return engines


def draft_from_page(path: Path) -> dict[str, Any] | None:
    payload = read_json(path)
    text = " ".join(str(payload.get(key, "")) for key in ("title", "snippet", "text"))
    engines = engines_from_text(text)
    if not engines:
        return None
    title = str(payload.get("title") or payload.get("query") or "Research draft")
    return {
        "ideaId": stable_id("draft", title, payload.get("url"), prefix="draft_"),
        "title": title[:160],
        "provenance": "public_research",
        "status": "approved" if False else "inbox",
        "hypothesis": f"Draft idea extracted from source text matching engines: {', '.join(engines)}.",
        "sourceUrls": [payload.get("url")],
        "engines": engines,
        "markets": ["futures", "forex"],
        "assetKeys": [],
        "parameterGrid": {},
        "sourceFile": path.name,
    }


def ideas_from_pages(approve: bool) -> list[Path]:
    written: list[Path] = []
    target = IDEAS_APPROVED if approve else IDEAS_INBOX
    for path in iter_json_files(PAGES_ROOT):
        if path.name.startswith("_"):
            continue
        idea = draft_from_page(path)
        if idea is None:
            continue
        if approve:
            idea["status"] = "approved"
        written.append(write_idea(target, idea))
    return written


def main() -> None:
    args = parse_args()
    ensure_research_dirs()
    written: list[Path] = []
    if args.seed or not args.from_pages:
        written.extend(seed_ideas())
    if args.from_pages:
        written.extend(ideas_from_pages(args.approve_drafts))
    print(f"Wrote {len(written)} idea file(s).")
    for path in written:
        print(path)


if __name__ == "__main__":
    main()
