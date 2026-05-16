from __future__ import annotations

import argparse
from datetime import datetime, timezone

from common import PROMOTIONS_ROOT, QUALIFIED_ROOT, ensure_research_dirs, iter_json_files, read_json, write_json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare qualified Research strategies for manual promotion review.")
    parser.add_argument("--limit", type=int, default=20)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ensure_research_dirs()
    candidates = []
    for path in iter_json_files(QUALIFIED_ROOT):
        if path.name.startswith("_"):
            continue
        payload = read_json(path)
        candidates.append(payload)
    # Qualified strategies are stored in subfolders, so include those too.
    for folder in sorted(path for path in QUALIFIED_ROOT.iterdir() if path.is_dir()):
        strategy_path = folder / "strategy.json"
        if strategy_path.exists():
            candidates.append(read_json(strategy_path))
    candidates.sort(
        key=lambda item: (
            float("inf") if item.get("metrics", {}).get("profit_factor") == "inf" else float(item.get("metrics", {}).get("profit_factor", 0)),
            int(item.get("metrics", {}).get("trades", 0)),
        ),
        reverse=True,
    )
    selected = candidates[: args.limit]
    manifest = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "note": "Manual review package only. This script does not modify the live strategy catalog.",
        "count": len(selected),
        "strategies": selected,
    }
    output = PROMOTIONS_ROOT / f"promotion_review_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    write_json(output, manifest)
    print(f"Wrote promotion review package: {output}")


if __name__ == "__main__":
    main()
