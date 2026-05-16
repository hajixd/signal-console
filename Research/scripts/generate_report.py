from __future__ import annotations

import argparse
import math
from datetime import datetime, timezone

from common import BACKTESTED_ROOT, QUALIFIED_ROOT, REPORTS_ROOT, ensure_research_dirs, read_csv


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Research center candidate reports.")
    parser.add_argument("--top", type=int, default=30)
    return parser.parse_args()


def pf_value(raw: object) -> float:
    if raw == "inf":
        return math.inf
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 0.0


def main() -> None:
    args = parse_args()
    ensure_research_dirs()
    rows = read_csv(BACKTESTED_ROOT / "_summary.csv")
    rows.sort(key=lambda row: (pf_value(row.get("profit_factor")), int(row.get("trades") or 0)), reverse=True)
    qualified = [row for row in rows if str(row.get("qualified")).lower() == "true"]
    lines = [
        "# Research Candidate Report",
        "",
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        "",
        f"Backtested strategies: {len(rows)}",
        f"Qualified strategies: {len(qualified)}",
        "",
        "## Top Backtests",
        "",
        "| Strategy | Asset | Market | Engine | PF | Trades | Total R | Qualified |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in rows[: args.top]:
        lines.append(
            "| {strategy_id} | {asset_key} | {market} | {engine} | {profit_factor} | {trades} | {total_r} | {qualified} |".format(
                **row
            )
        )
    lines.extend(["", "## Qualified", ""])
    if not qualified:
        lines.append("No qualified strategies yet.")
    else:
        for row in qualified[: args.top]:
            lines.append(f"- {row['strategy_id']} ({row['asset_key']}): PF {row['profit_factor']}, trades {row['trades']}")
    output = REPORTS_ROOT / "latest_candidate_report.md"
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
