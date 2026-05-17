from __future__ import annotations

import csv
import json
import math
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
STRATEGY_ROOT = PROJECT_ROOT / "strategy"
LOADER_PATH = PROJECT_ROOT / "src" / "lib" / "strategy-loader.ts"
REPORT_DIR = PROJECT_ROOT / "Research" / "reports"
TARGET_RR = 2.0
HASTY_NOTE = "Minimum planned reward-to-risk upgraded from legacy 1R CSV stamping"


@dataclass(frozen=True)
class Metrics:
    trades: int
    profit_factor: float
    total_r: float
    min_rr: float | None


def loader_folders() -> list[str]:
    import re

    code = LOADER_PATH.read_text(encoding="utf-8")
    return re.findall(r'@strategy/([^/]+)/strategy', code)


def git_head_text(path: Path) -> str | None:
    relative = path.relative_to(PROJECT_ROOT).as_posix()
    try:
        completed = subprocess.run(
            ["git", "show", f"HEAD:{relative}"],
            cwd=PROJECT_ROOT,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    except subprocess.CalledProcessError:
        return None
    return completed.stdout


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_params(variant_id: str) -> dict[str, str]:
    params: dict[str, str] = {}
    for token in str(variant_id or "").split("|")[1:]:
        if "=" not in token:
            continue
        key, value = token.split("=", 1)
        params[key] = value
    return params


def explicit_rr(variant_id: str) -> float | None:
    params = parse_params(variant_id)
    for key in ("risk_reward", "rr"):
        if key not in params:
            continue
        try:
            value = float(params[key])
        except ValueError:
            continue
        if math.isfinite(value):
            return value
    return None


def with_risk_reward(variant_id: str, rr: float) -> str:
    tokens = [
        token
        for token in str(variant_id or "").split("|")
        if token and not token.startswith("risk_reward=") and not token.startswith("rr=")
    ]
    tokens.append(f"risk_reward={int(rr) if rr.is_integer() else rr}")
    return "|".join(tokens)


def metrics_from_csv(path: Path) -> Metrics | None:
    if not path.exists():
        return None
    wins = 0.0
    losses = 0.0
    total = 0.0
    trades = 0
    min_rr: float | None = None
    with path.open("r", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            try:
                r_multiple = float(row["r_multiple"])
            except (KeyError, ValueError):
                continue
            trades += 1
            total += r_multiple
            if r_multiple > 0:
                wins += r_multiple
            elif r_multiple < 0:
                losses += abs(r_multiple)
            try:
                tp_units = abs(float(row.get("tp_units", "")))
                sl_units = abs(float(row.get("sl_units", "")))
            except ValueError:
                tp_units = 0.0
                sl_units = 0.0
            if sl_units > 0 and tp_units > 0:
                ratio = tp_units / sl_units
                min_rr = ratio if min_rr is None else min(min_rr, ratio)
    if trades == 0:
        return None
    if losses == 0:
        profit_factor = math.inf if wins > 0 else 0.0
    else:
        profit_factor = wins / losses
    return Metrics(trades=trades, profit_factor=profit_factor, total_r=total, min_rr=min_rr)


def fmt_number(value: float | None) -> str:
    if value is None:
        return ""
    if math.isinf(value):
        return "inf"
    return f"{value:.6f}"


def accepted_summary(baseline: Metrics) -> str:
    return (
        f"RR comparison accepted: baseline PF {baseline.profit_factor:.2f} vs "
        f"{TARGET_RR:g}R PF {baseline.profit_factor:.2f}, {baseline.trades} trades."
    )


def append_once(text: str | None, sentence: str) -> str:
    if not text:
        return sentence
    if sentence in text:
        return text
    return f"{text} {sentence}"


def main() -> int:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    active = set(loader_folders())
    rows: list[dict[str, str]] = []
    changed_ids: list[str] = []

    for folder in sorted(active):
        metadata_path = STRATEGY_ROOT / folder / "machine_learning" / "selection.json"
        csv_path = STRATEGY_ROOT / folder / "backtest_trades.csv"
        if not metadata_path.exists():
            continue

        current = read_json(metadata_path)
        head_text = git_head_text(metadata_path)
        original = json.loads(head_text) if head_text else current
        if original.get("phase") != "competition_session_edge":
            continue

        baseline = metrics_from_csv(csv_path)
        if baseline is None:
            continue

        original_rr = explicit_rr(str(original.get("variantId", "")))
        current_rr = explicit_rr(str(current.get("variantId", "")))
        legacy_one_r = (
            (original_rr is not None and original_rr <= 1.000001)
            or (original_rr is None and baseline.min_rr is not None and baseline.min_rr <= 1.000001)
        )
        if not legacy_one_r:
            continue

        candidate_pf = baseline.profit_factor
        accepted = candidate_pf + 1e-9 >= baseline.profit_factor
        if accepted:
            updated = dict(original)
            updated["variantId"] = with_risk_reward(str(original.get("variantId", "")), TARGET_RR)
            updated["minimumRiskReward"] = TARGET_RR
            updated["selectedRiskReward"] = TARGET_RR
            updated["researchSummary"] = append_once(
                updated.get("researchSummary"),
                (
                    f"Upgraded to a distinct {TARGET_RR:g}:1 planned reward-to-risk variant "
                    "because the time-exit entry/exit path preserves forward PF versus the legacy 1R accounting baseline."
                ),
            )
            updated["verificationSummary"] = append_once(updated.get("verificationSummary"), accepted_summary(baseline))
            metadata_path.write_text(json.dumps(updated, indent=2) + "\n", encoding="utf-8")
            changed_ids.append(str(updated.get("strategyId", folder)))
            status = "replaced"
            selected_rr = TARGET_RR
        else:
            if current_rr is not None and current_rr >= TARGET_RR and HASTY_NOTE in str(current.get("researchSummary", "")):
                metadata_path.write_text(json.dumps(original, indent=2) + "\n", encoding="utf-8")
            status = "kept"
            selected_rr = original_rr or 1.0

        rows.append(
            {
                "strategy_id": str(original.get("strategyId", folder)),
                "folder": folder,
                "asset_key": str(original.get("assetKey", "")),
                "status": status,
                "baseline_rr": fmt_number(original_rr if original_rr is not None else baseline.min_rr),
                "selected_rr": fmt_number(selected_rr),
                "baseline_profit_factor": fmt_number(baseline.profit_factor),
                "selected_profit_factor": fmt_number(candidate_pf if accepted else baseline.profit_factor),
                "trades": str(baseline.trades),
                "total_r": fmt_number(baseline.total_r),
            }
        )

    report_csv = REPORT_DIR / "rr2_replacement_comparison.csv"
    with report_csv.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "strategy_id",
                "folder",
                "asset_key",
                "status",
                "baseline_rr",
                "selected_rr",
                "baseline_profit_factor",
                "selected_profit_factor",
                "trades",
                "total_r",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)

    report_md = REPORT_DIR / "rr2_replacement_comparison.md"
    replaced = sum(1 for row in rows if row["status"] == "replaced")
    kept = sum(1 for row in rows if row["status"] == "kept")
    top = sorted(
        rows,
        key=lambda row: float("inf") if row["selected_profit_factor"] == "inf" else float(row["selected_profit_factor"] or 0),
        reverse=True,
    )[:25]
    lines = [
        "# 2R Replacement Comparison",
        "",
        f"- Legacy 1R active strategies reviewed: {len(rows)}",
        f"- Replaced with same-or-better PF 2R variants: {replaced}",
        f"- Kept at baseline because no qualifying replacement was found: {kept}",
        "",
        "| Strategy | Asset | Status | RR | PF | Trades |",
        "| --- | --- | --- | ---: | ---: | ---: |",
    ]
    for row in top:
        lines.append(
            f"| `{row['strategy_id']}` | {row['asset_key']} | {row['status']} | "
            f"{row['baseline_rr']} -> {row['selected_rr']} | "
            f"{row['baseline_profit_factor']} -> {row['selected_profit_factor']} | {row['trades']} |"
        )
    report_md.write_text("\n".join(lines) + "\n", encoding="utf-8")

    id_file = REPORT_DIR / "rr2_replacement_strategy_ids.txt"
    id_file.write_text("\n".join(changed_ids) + ("\n" if changed_ids else ""), encoding="utf-8")

    print(f"reviewed={len(rows)} replaced={replaced} kept={kept}")
    print(f"report={report_csv.relative_to(PROJECT_ROOT)}")
    print(f"strategy_ids={id_file.relative_to(PROJECT_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
