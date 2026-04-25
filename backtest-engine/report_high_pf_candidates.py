from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
STRATEGY_ROOT = PROJECT_ROOT / "strategy"
METADATA_FILES = (
    Path("machine_learning/selection.json"),
    Path("bayes/selection.json"),
    Path("parameters/backtest.json"),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Report high-PF strategy candidates and missing tuned winners")
    parser.add_argument("--min-pf", type=float, default=2.0, help="Minimum profit factor required to report a strategy")
    parser.add_argument("--min-trades", type=int, default=50, help="Minimum trade count required to report a strategy")
    return parser.parse_args()


def first_existing_metadata(strategy_dir: Path) -> Path | None:
    for relative_path in METADATA_FILES:
        candidate = strategy_dir / relative_path
        if candidate.exists():
            return candidate
    return None


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def trade_metrics(csv_path: Path) -> tuple[float, int, float] | None:
    if not csv_path.exists():
        return None

    values: list[float] = []
    with csv_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            try:
                values.append(float(row["r_multiple"]))
            except (KeyError, TypeError, ValueError):
                continue
    if not values:
        return None

    wins = [value for value in values if value > 0]
    losses = [value for value in values if value < 0]
    gross_wins = sum(wins)
    gross_losses = sum(abs(value) for value in losses)
    profit_factor = math.inf if gross_losses == 0 and gross_wins > 0 else (gross_wins / gross_losses if gross_losses else 0.0)
    return profit_factor, len(values), sum(values)


def qualifying_materialized(min_pf: float, min_trades: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for strategy_dir in sorted(STRATEGY_ROOT.iterdir()):
        if not strategy_dir.is_dir():
            continue
        metadata_path = first_existing_metadata(strategy_dir)
        if metadata_path is None:
            continue
        payload = load_json(metadata_path)
        pf = next(
            (
                float(payload[key])
                for key in ("selectedForwardProfitFactor", "recoveredForwardProfitFactor")
                if key in payload and payload[key] is not None
            ),
            None,
        )
        trades = next(
            (
                int(payload[key])
                for key in ("selectedForwardTrades", "recoveredForwardTrades")
                if key in payload and payload[key] is not None
            ),
            None,
        )
        metric_source = "metadata"
        total_r = next(
            (
                float(payload[key])
                for key in ("forwardTotalR", "recoveredForwardTotalR")
                if key in payload and payload[key] is not None
            ),
            None,
        )
        if pf is None or trades is None:
            fallback = trade_metrics(strategy_dir / "backtest_trades.csv")
            if fallback is not None:
                pf, trades, total_r = fallback
                metric_source = "backtest_trades.csv"
        if pf is None or trades is None or pf < min_pf or trades < min_trades:
            continue
        rows.append(
            {
                "strategy_id": payload.get("strategyId", strategy_dir.name),
                "label": payload.get("label", strategy_dir.name),
                "asset_key": payload.get("assetKey"),
                "phase": payload.get("phase"),
                "profit_factor": pf,
                "trades": trades,
                "total_r": total_r,
                "source": payload.get("source"),
                "metric_source": metric_source,
            }
        )
    rows.sort(key=lambda row: (row["profit_factor"], row["trades"]), reverse=True)
    return rows


def materialized_strategy_ids() -> set[str]:
    ids: set[str] = set()
    for strategy_dir in sorted(STRATEGY_ROOT.iterdir()):
        if not strategy_dir.is_dir():
            continue
        metadata_path = first_existing_metadata(strategy_dir)
        if metadata_path is None:
            continue
        payload = load_json(metadata_path)
        ids.add(str(payload.get("strategyId", strategy_dir.name)))
    return ids


def qualifying_tuning_rows(min_pf: float, min_trades: int) -> list[dict[str, Any]]:
    path = STRATEGY_ROOT / "tuning_summary.csv"
    if not path.exists():
        return []

    rows: list[dict[str, Any]] = []
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            try:
                pf = float(row["after_pf"])
                trades = int(row["after_trades"])
            except (KeyError, TypeError, ValueError):
                continue
            if pf < min_pf or trades < min_trades:
                continue
            rows.append(
                {
                    "strategy_id": row["strategy_id"],
                    "phase": row["phase"],
                    "profit_factor": pf,
                    "trades": trades,
                    "variant_id": row["after_variant_id"],
                }
            )
    rows.sort(key=lambda row: (row["profit_factor"], row["trades"]), reverse=True)
    return rows


def print_section(title: str, rows: list[dict[str, Any]], keys: list[str]) -> None:
    print(title)
    if not rows:
        print("  (none)")
        return
    for row in rows:
        parts = [f"{key}={row[key]}" for key in keys if key in row and row[key] is not None]
        print(f"  - {' | '.join(parts)}")


def main() -> None:
    args = parse_args()
    materialized = qualifying_materialized(args.min_pf, args.min_trades)
    tuned = qualifying_tuning_rows(args.min_pf, args.min_trades)
    all_materialized_ids = materialized_strategy_ids()
    qualifying_materialized_ids = {row["strategy_id"] for row in materialized}
    undocumented = [
        row
        for row in tuned
        if row["strategy_id"] in all_materialized_ids and row["strategy_id"] not in qualifying_materialized_ids
    ]
    missing = [row for row in tuned if row["strategy_id"] not in all_materialized_ids]

    print(f"Qualifying threshold: PF >= {args.min_pf} and trades >= {args.min_trades}")
    print_section(
        "\nMaterialized strategies",
        materialized,
        ["strategy_id", "phase", "profit_factor", "trades", "total_r", "source", "metric_source"],
    )
    print_section(
        "\nHigh-PF tuning rows already in the catalog but not reflected in qualifying metadata",
        undocumented,
        ["strategy_id", "phase", "profit_factor", "trades", "variant_id"],
    )
    print_section(
        "\nHigh-PF tuning rows not materialized yet",
        missing,
        ["strategy_id", "phase", "profit_factor", "trades", "variant_id"],
    )


if __name__ == "__main__":
    main()
