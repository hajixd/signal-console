from __future__ import annotations

import argparse
import csv
import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
LOADER_PATH = PROJECT_ROOT / "src" / "lib" / "strategy-loader.ts"
STRATEGY_ROOT = PROJECT_ROOT / "strategy"
DEFAULT_REPORT = PROJECT_ROOT / "Research" / "reports" / "history_stat_integrity.json"
REQUIRED_COLUMNS = {
    "strategy_id",
    "asset_key",
    "market",
    "side",
    "signal_time",
    "entry_time",
    "exit_time",
    "entry_price",
    "exit_price",
    "net_units",
    "r_multiple",
    "tp_units",
    "sl_units",
    "cost_units",
    "size_multiplier",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit the catalog rows used by History and Statistics.")
    parser.add_argument("--output", type=Path, default=DEFAULT_REPORT)
    return parser.parse_args()


def finite(row: dict[str, str], key: str) -> float:
    value = float(row[key])
    if not math.isfinite(value):
        raise ValueError(f"{key} is not finite")
    return value


def timestamp(row: dict[str, str], key: str) -> datetime:
    return datetime.fromisoformat(row[key].replace("Z", "+00:00"))


def issue(issues: list[dict[str, object]], folder: str, line: int, message: str) -> None:
    if len(issues) < 200:
        issues.append({"strategy": folder, "line": line, "message": message})


def main() -> int:
    args = parse_args()
    loader = LOADER_PATH.read_text(encoding="utf-8")
    folders = list(dict.fromkeys(re.findall(r'@strategy/([^/]+)/strategy', loader)))
    issues: list[dict[str, object]] = []
    market_r: dict[str, list[float]] = defaultdict(list)
    market_rows: Counter[str] = Counter()
    source_rows: Counter[str] = Counter()
    strategy_rows: Counter[str] = Counter()

    for folder in folders:
        csv_path = STRATEGY_ROOT / folder / "backtest_trades.csv"
        if not csv_path.exists():
            issue(issues, folder, 0, "backtest_trades.csv is missing")
            continue
        identities: set[tuple[str, str, str, str]] = set()
        with csv_path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            missing = sorted(REQUIRED_COLUMNS.difference(reader.fieldnames or []))
            if missing:
                issue(issues, folder, 1, f"missing columns: {', '.join(missing)}")
                continue
            for line, row in enumerate(reader, start=2):
                strategy_rows[folder] += 1
                market = row["market"].strip().lower()
                market_rows[market] += 1
                source_rows[row.get("source", "").strip() or "unknown"] += 1
                try:
                    if row["strategy_id"] != folder:
                        raise ValueError("strategy_id does not match its registered folder")
                    if market not in {"forex", "futures"}:
                        raise ValueError(f"invalid market {market!r}")
                    if row["side"].strip().lower() not in {"long", "short"}:
                        raise ValueError("side is not long or short")
                    signal_at = timestamp(row, "signal_time")
                    entry_at = timestamp(row, "entry_time")
                    exit_at = timestamp(row, "exit_time")
                    if signal_at > entry_at:
                        raise ValueError("signal_time is after entry_time")
                    if entry_at > exit_at:
                        raise ValueError("entry_time is after exit_time")

                    entry_price = finite(row, "entry_price")
                    exit_price = finite(row, "exit_price")
                    net_units = finite(row, "net_units")
                    r_multiple = finite(row, "r_multiple")
                    tp_units = finite(row, "tp_units")
                    sl_units = finite(row, "sl_units")
                    cost_units = finite(row, "cost_units")
                    size_multiplier = finite(row, "size_multiplier")
                    if entry_price <= 0 or exit_price <= 0:
                        raise ValueError("entry/exit price must be positive")
                    if tp_units <= 0 or sl_units <= 0 or cost_units < 0:
                        raise ValueError("target/stop must be positive and cost non-negative")
                    if size_multiplier <= 0:
                        raise ValueError("size_multiplier must be positive")
                    risk_units = sl_units + cost_units
                    expected_r = net_units / risk_units
                    if not math.isclose(r_multiple, expected_r, rel_tol=1e-6, abs_tol=1e-7):
                        raise ValueError(f"r_multiple mismatch: stored={r_multiple:.8g}, computed={expected_r:.8g}")

                    identity = (row["asset_key"], row["side"], row["entry_time"], row["exit_time"])
                    if identity in identities:
                        raise ValueError("duplicate trade identity within strategy")
                    identities.add(identity)
                    market_r[market].append(r_multiple * size_multiplier)
                except (KeyError, TypeError, ValueError) as error:
                    issue(issues, folder, line, str(error))

    market_summary: dict[str, dict[str, float | int | None]] = {}
    for market in ("forex", "futures"):
        values = market_r.get(market, [])
        gross_profit = sum(value for value in values if value > 0)
        gross_loss = -sum(value for value in values if value < 0)
        market_summary[market] = {
            "rows": market_rows[market],
            "verifiedRows": len(values),
            "rawRProfitFactor": gross_profit / gross_loss if gross_loss > 0 else None,
            "netR": sum(values),
        }

    report = {
        "status": "pass" if not issues else "fail",
        "registeredStrategies": len(folders),
        "strategiesWithRows": sum(1 for count in strategy_rows.values() if count > 0),
        "totalRows": sum(strategy_rows.values()),
        "verifiedRows": sum(len(values) for values in market_r.values()),
        "markets": market_summary,
        "sources": dict(source_rows.most_common()),
        "issues": issues,
        "checks": [
            "registered file presence and schema",
            "strategy/folder and market identity",
            "finite positive prices and valid side",
            "signal <= entry <= exit timing",
            "positive target/stop/size and non-negative friction",
            "r_multiple = net_units / (sl_units + cost_units)",
            "no duplicate trade identity within a strategy",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("status", "registeredStrategies", "totalRows", "verifiedRows", "markets")}, indent=2))
    if issues:
        print(f"Integrity failures: {len(issues)} (first {min(10, len(issues))} shown)")
        for row in issues[:10]:
            print(f"  {row['strategy']}:{row['line']} {row['message']}")
    return 0 if not issues else 1


if __name__ == "__main__":
    raise SystemExit(main())
