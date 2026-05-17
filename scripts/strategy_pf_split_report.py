from __future__ import annotations

import argparse
import csv
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
STRATEGY_ROOT = PROJECT_ROOT / "strategy"
REPORT_ROOT = PROJECT_ROOT / "Research" / "reports"
METADATA_FILES = (
    Path("machine_learning/selection.json"),
    Path("bayes/selection.json"),
    Path("parameters/backtest.json"),
)


@dataclass(frozen=True)
class MetricSet:
    trades: int
    profit_factor: float | None
    total_r: float
    win_rate_pct: float | None
    max_drawdown_r: float


@dataclass(frozen=True)
class Trade:
    timestamp: datetime
    r_multiple: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build top strategy PF, split, ML, and overfit report.")
    parser.add_argument("--top", type=int, default=20, help="Number of strategies to include.")
    parser.add_argument("--output-name", default="top_strategy_pf_split_report", help="Output filename stem.")
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def first_existing_metadata(strategy_dir: Path) -> tuple[Path, dict[str, Any]] | None:
    for relative_path in METADATA_FILES:
        path = strategy_dir / relative_path
        if path.exists():
            return relative_path, load_json(path)
    return None


def parse_timestamp(value: str) -> datetime:
    raw = value.strip()
    if not raw:
        return datetime.fromtimestamp(0, tz=timezone.utc)
    if raw.isdigit():
        return datetime.fromtimestamp(int(raw), tz=timezone.utc)
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    parsed = datetime.fromisoformat(raw)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def read_trades(csv_path: Path) -> list[Trade]:
    trades: list[Trade] = []
    with csv_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            try:
                r_multiple = float(row["r_multiple"])
            except (KeyError, TypeError, ValueError):
                continue
            timestamp_value = row.get("entry_time") or row.get("signal_time") or row.get("exit_time") or "0"
            try:
                timestamp = parse_timestamp(str(timestamp_value))
            except ValueError:
                timestamp = datetime.fromtimestamp(0, tz=timezone.utc)
            trades.append(Trade(timestamp=timestamp, r_multiple=r_multiple))
    return sorted(trades, key=lambda trade: trade.timestamp)


def profit_factor(values: Iterable[float]) -> float | None:
    values = list(values)
    gross_profit = sum(value for value in values if value > 0)
    gross_loss = sum(abs(value) for value in values if value < 0)
    if gross_loss == 0:
        return math.inf if gross_profit > 0 else None
    return gross_profit / gross_loss


def max_drawdown(values: Iterable[float]) -> float:
    peak = 0.0
    equity = 0.0
    drawdown = 0.0
    for value in values:
        equity += value
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
    return drawdown


def metrics_for(values: Iterable[float]) -> MetricSet:
    values = list(values)
    trades = len(values)
    wins = sum(1 for value in values if value > 0)
    return MetricSet(
        trades=trades,
        profit_factor=profit_factor(values),
        total_r=sum(values),
        win_rate_pct=(wins / trades * 100.0) if trades else None,
        max_drawdown_r=max_drawdown(values),
    )


def split_observed_trades(trades: list[Trade]) -> tuple[list[Trade], list[Trade]]:
    if len(trades) < 2:
        return trades, []
    split_index = max(1, min(len(trades) - 1, math.ceil(len(trades) * 0.70)))
    return trades[:split_index], trades[split_index:]


def finite_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return numeric if math.isfinite(numeric) else numeric


def int_number(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def format_number(value: float | int | None, decimals: int = 2) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isinf(value):
        return "inf"
    return f"{value:.{decimals}f}"


def format_int(value: int | None) -> str:
    return "" if value is None else str(value)


def parse_variant_params(variant_id: str) -> dict[str, str]:
    params: dict[str, str] = {}
    for piece in variant_id.split("|")[1:]:
        if "=" not in piece:
            continue
        key, value = piece.split("=", 1)
        params[key.strip()] = value.strip()
    return params


def infer_model(metadata_path: Path, metadata: dict[str, Any], variant_params: dict[str, str], strategy_id: str) -> tuple[str, str]:
    variant_model = variant_params.get("model")
    lower_id = strategy_id.lower()
    lower_variant = str(metadata.get("variantId", "")).lower()
    metadata_path_text = metadata_path.as_posix()

    if variant_model == "bayes" or "bayes" in lower_id:
        return "yes", "Bayes scorer"
    if variant_model == "logit" or "logit" in lower_id:
        return "yes", "Logit scorer"
    if variant_model == "stump" or "stump" in lower_id:
        return "yes", "Decision stump"
    if "echo_neural" in lower_id or "neural" in lower_variant:
        return "yes", "Echo neural"
    if metadata_path_text.startswith("machine_learning/") or metadata_path_text.startswith("bayes/"):
        return "yes", variant_model or "ML scorer"
    return "no", "rule-based"


def split_values(
    metadata: dict[str, Any],
    observed_pre: MetricSet,
    observed_post: MetricSet,
    overall: MetricSet,
) -> tuple[str, float | None, int | None, float | None, int | None]:
    training_pf = finite_number(metadata.get("selectedTrainingProfitFactor"))
    training_trades = int_number(metadata.get("selectedTrainingTrades"))
    if training_pf is not None or training_trades is not None:
        post_pf = finite_number(metadata.get("selectedForwardProfitFactor")) or overall.profit_factor
        post_trades = int_number(metadata.get("selectedForwardTrades")) or overall.trades
        return "true_pre2022_vs_2022_forward", training_pf, training_trades, post_pf, post_trades
    return "proxy_first70_vs_last30", observed_pre.profit_factor, observed_pre.trades, observed_post.profit_factor, observed_post.trades


def overfit_estimate(
    split_basis: str,
    pre_pf: float | None,
    pre_trades: int | None,
    post_pf: float | None,
    post_trades: int | None,
    overall: MetricSet,
    ml_model: str,
) -> tuple[str, str]:
    issues: list[str] = []
    ratio = None
    if pre_pf and post_pf and pre_pf > 0 and math.isfinite(pre_pf) and math.isfinite(post_pf):
        ratio = post_pf / pre_pf

    if split_basis.startswith("proxy"):
        issues.append("no true train/forward metadata")
    if overall.trades < 30:
        issues.append("very small total sample")
    elif overall.trades < 50:
        issues.append("small total sample")
    if pre_trades is not None and pre_trades < 20:
        issues.append("thin pre-split sample")
    if post_trades is not None and post_trades < 30:
        issues.append("thin post-split sample")
    if post_pf is not None and post_pf < 1.0:
        issues.append("post-split PF below 1")
    if ratio is not None and ratio < 0.50:
        issues.append("large PF decay")
    elif ratio is not None and ratio < 0.75:
        issues.append("moderate PF decay")

    if post_pf is not None and pre_pf is not None and post_pf > pre_pf * 1.25 and split_basis.startswith("true"):
        issues.append("forward stronger than fit sample")

    high_signals = {
        "very small total sample",
        "thin pre-split sample",
        "post-split PF below 1",
        "large PF decay",
    }
    if any(issue in high_signals for issue in issues):
        risk = "High"
    elif split_basis.startswith("proxy") or any(issue in {"small total sample", "thin post-split sample", "moderate PF decay"} for issue in issues):
        risk = "Medium"
    else:
        risk = "Low"

    if ml_model != "rule-based" and risk == "Low" and pre_trades is not None and pre_trades < 50:
        risk = "Medium"
        issues.append("ML fit sample under 50 trades")

    if not issues:
        issues.append("pre/post evidence is stable")
    return risk, "; ".join(issues)


def compact_params(variant_params: dict[str, str], limit: int = 6) -> str:
    preferred = [
        "model",
        "tf",
        "direction",
        "risk_reward",
        "rr",
        "entry",
        "exit",
        "start",
        "end",
        "max_bars",
        "one_trade",
    ]
    ordered_keys = [key for key in preferred if key in variant_params]
    ordered_keys.extend(key for key in variant_params if key not in ordered_keys)
    pieces = [f"{key}={variant_params[key]}" for key in ordered_keys[:limit]]
    return "; ".join(pieces)


def build_rows(top: int) -> list[dict[str, str]]:
    rows: list[dict[str, Any]] = []
    for strategy_dir in sorted(STRATEGY_ROOT.iterdir()):
        if not strategy_dir.is_dir():
            continue
        metadata_result = first_existing_metadata(strategy_dir)
        if metadata_result is None:
            continue
        metadata_path, metadata = metadata_result
        csv_path = strategy_dir / "backtest_trades.csv"
        if not csv_path.exists():
            continue

        trades = read_trades(csv_path)
        if not trades:
            continue

        overall = metrics_for(trade.r_multiple for trade in trades)
        observed_pre_trades, observed_post_trades = split_observed_trades(trades)
        observed_pre = metrics_for(trade.r_multiple for trade in observed_pre_trades)
        observed_post = metrics_for(trade.r_multiple for trade in observed_post_trades)
        variant_id = str(metadata.get("variantId", ""))
        variant_params = parse_variant_params(variant_id)
        ml_used, model = infer_model(metadata_path, metadata, variant_params, str(metadata.get("strategyId", strategy_dir.name)))
        split_basis, pre_pf, pre_trades, post_pf, post_trades = split_values(metadata, observed_pre, observed_post, overall)
        risk, risk_notes = overfit_estimate(split_basis, pre_pf, pre_trades, post_pf, post_trades, overall, model)

        rows.append(
            {
                "strategy_id": str(metadata.get("strategyId", strategy_dir.name)),
                "label": str(metadata.get("label", strategy_dir.name)),
                "folder": strategy_dir.name,
                "asset_key": str(metadata.get("assetKey", "")),
                "phase": str(metadata.get("phase", "")),
                "source": str(metadata.get("source", "")),
                "metadata_file": metadata_path.as_posix(),
                "overall_pf": overall.profit_factor,
                "overall_trades": overall.trades,
                "overall_total_r": overall.total_r,
                "win_rate_pct": overall.win_rate_pct,
                "max_drawdown_r": overall.max_drawdown_r,
                "ml_used": ml_used,
                "model": model,
                "split_basis": split_basis,
                "pre_split_pf": pre_pf,
                "pre_split_trades": pre_trades,
                "post_split_pf": post_pf,
                "post_split_trades": post_trades,
                "observed_first70_pf": observed_pre.profit_factor,
                "observed_first70_trades": observed_pre.trades,
                "observed_last30_pf": observed_post.profit_factor,
                "observed_last30_trades": observed_post.trades,
                "overfit_risk": risk,
                "overfit_notes": risk_notes,
                "variant_id": variant_id,
                "key_params": compact_params(variant_params),
            }
        )

    rows.sort(key=lambda row: (row["overall_pf"] or -1, row["overall_trades"]), reverse=True)
    return [
        {
            "rank": str(index),
            **serialize_row(row),
        }
        for index, row in enumerate(rows[:top], start=1)
    ]


def serialize_row(row: dict[str, Any]) -> dict[str, str]:
    return {
        "strategy_id": row["strategy_id"],
        "label": row["label"],
        "folder": row["folder"],
        "asset_key": row["asset_key"],
        "phase": row["phase"],
        "source": row["source"],
        "metadata_file": row["metadata_file"],
        "overall_pf": format_number(row["overall_pf"], 3),
        "overall_trades": str(row["overall_trades"]),
        "overall_total_r": format_number(row["overall_total_r"], 2),
        "win_rate_pct": format_number(row["win_rate_pct"], 1),
        "max_drawdown_r": format_number(row["max_drawdown_r"], 2),
        "ml_used": row["ml_used"],
        "model": row["model"],
        "split_basis": row["split_basis"],
        "pre_split_pf": format_number(row["pre_split_pf"], 3),
        "pre_split_trades": format_int(row["pre_split_trades"]),
        "post_split_pf": format_number(row["post_split_pf"], 3),
        "post_split_trades": format_int(row["post_split_trades"]),
        "observed_first70_pf": format_number(row["observed_first70_pf"], 3),
        "observed_first70_trades": str(row["observed_first70_trades"]),
        "observed_last30_pf": format_number(row["observed_last30_pf"], 3),
        "observed_last30_trades": str(row["observed_last30_trades"]),
        "overfit_risk": row["overfit_risk"],
        "overfit_notes": row["overfit_notes"],
        "variant_id": row["variant_id"],
        "key_params": row["key_params"],
    }


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(rows[0].keys()) if rows else []
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def markdown_table(rows: list[dict[str, str]]) -> str:
    columns = [
        ("rank", "#"),
        ("strategy_id", "Strategy"),
        ("asset_key", "Asset"),
        ("phase", "Phase"),
        ("overall_pf", "PF"),
        ("overall_trades", "Trades"),
        ("overall_total_r", "Total R"),
        ("ml_used", "ML"),
        ("model", "Model"),
        ("pre_split_pf", "Pre PF"),
        ("pre_split_trades", "Pre N"),
        ("post_split_pf", "Post PF"),
        ("post_split_trades", "Post N"),
        ("overfit_risk", "Overfit"),
    ]
    lines = [
        "| " + " | ".join(title for _, title in columns) + " |",
        "| " + " | ".join("---" for _ in columns) + " |",
    ]
    for row in rows:
        values = [row[key].replace("|", "\\|") for key, _ in columns]
        lines.append("| " + " | ".join(values) + " |")
    return "\n".join(lines)


def write_markdown(path: Path, rows: list[dict[str, str]]) -> None:
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    notes = [
        "# Top Strategy PF Split Report",
        "",
        f"Generated at `{generated_at}`.",
        "",
        "Scope: materialized catalog strategy folders under `strategy/` that have metadata and `backtest_trades.csv`.",
        "Excluded: `Potential Strategies/` and CSV-only `competition_*` folders without strategy metadata.",
        "",
        "Split logic: true pre/post values come from metadata when `selectedTraining*` metrics exist; otherwise the report uses a chronological proxy split of the available trade log: first 70% vs last 30%.",
        "",
        markdown_table(rows),
        "",
        "## Overfit Notes",
        "",
    ]
    for row in rows:
        notes.append(f"- **#{row['rank']} {row['strategy_id']}**: {row['overfit_risk']} - {row['overfit_notes']}")
    path.write_text("\n".join(notes) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    rows = build_rows(args.top)
    if not rows:
        raise SystemExit("No strategies with metadata and backtest trades were found.")

    csv_path = REPORT_ROOT / f"{args.output_name}.csv"
    md_path = REPORT_ROOT / f"{args.output_name}.md"
    write_csv(csv_path, rows)
    write_markdown(md_path, rows)
    print(f"Wrote {len(rows)} row(s) to {csv_path}")
    print(f"Wrote markdown report to {md_path}")


if __name__ == "__main__":
    main()
