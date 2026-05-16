from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
STRATEGY_ROOT = PROJECT_ROOT / "strategy"
SUMMARY_PATH = PROJECT_ROOT / "competition" / "promoted-strategies-summary.csv"


def metrics(csv_path: Path) -> dict[str, Any]:
    values: list[float] = []
    with csv_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            values.append(float(row["r_multiple"]))
    wins = [value for value in values if value > 0]
    losses = [value for value in values if value < 0]
    gross_wins = sum(wins)
    gross_losses = sum(abs(value) for value in losses)
    total_r = sum(values)
    equity = 0.0
    peak = 0.0
    max_drawdown = 0.0
    for value in values:
        equity += value
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, peak - equity)
    profit_factor = math.inf if gross_losses == 0 and gross_wins > 0 else gross_wins / gross_losses if gross_losses else 0.0
    return {
        "profit_factor": profit_factor,
        "trades": len(values),
        "wins": len(wins),
        "losses": len(losses),
        "total_r": total_r,
        "average_r": total_r / len(values) if values else 0.0,
        "win_rate_pct": len(wins) / len(values) * 100.0 if values else 0.0,
        "max_drawdown_r": max_drawdown,
    }


def finite(value: float) -> float:
    if not math.isfinite(value):
        return 999999.0
    rounded = round(value, 6)
    return int(rounded) if math.isclose(rounded, round(rounded)) else rounded


def family_from_variant(variant_id: str) -> str:
    for token in variant_id.split("|"):
        if token.startswith("family="):
            return token.split("=", 1)[1]
    return ""


def main() -> int:
    rows: list[dict[str, Any]] = []
    for strategy_dir in sorted(STRATEGY_ROOT.glob("competition_*")):
        metadata_path = strategy_dir / "machine_learning" / "selection.json"
        backtest_path = strategy_dir / "backtest_trades.csv"
        if not metadata_path.exists() or not backtest_path.exists():
            continue
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        result = metrics(backtest_path)
        payload["selectedForwardProfitFactor"] = finite(result["profit_factor"])
        payload["selectedForwardTrades"] = result["trades"]
        payload["forwardWins"] = result["wins"]
        payload["forwardLosses"] = result["losses"]
        payload["forwardTotalR"] = finite(result["total_r"])
        payload["forwardAverageR"] = finite(result["average_r"])
        payload["forwardMaxDrawdownR"] = finite(result["max_drawdown_r"])
        payload["verificationSummary"] = (
            f"Verified by backtest-engine runner output: PF {result['profit_factor']:.2f}, "
            f"{result['trades']} trades, {result['total_r']:.2f}R total."
        )
        metadata_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        rows.append(
            {
                "strategy_id": payload["strategyId"],
                "asset_key": payload["assetKey"],
                "label": payload["label"],
                "family": family_from_variant(str(payload.get("variantId", ""))),
                "profit_factor": finite(result["profit_factor"]),
                "trades": result["trades"],
                "total_r": finite(result["total_r"]),
                "win_rate_pct": finite(result["win_rate_pct"]),
                "max_drawdown_r": finite(result["max_drawdown_r"]),
                "variant_id": payload.get("variantId", ""),
            }
        )
    rows.sort(key=lambda row: (float(row["profit_factor"]), int(row["trades"])), reverse=True)
    SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    with SUMMARY_PATH.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    bad = [row for row in rows if float(row["profit_factor"]) <= 2.0 or int(row["trades"]) < 20]
    print(f"Audited {len(rows)} competition strategies; bad={len(bad)}")
    if bad:
        for row in bad:
            print(f"BAD {row['strategy_id']} PF={row['profit_factor']} trades={row['trades']}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
