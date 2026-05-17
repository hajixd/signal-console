from __future__ import annotations

import csv
import json
import re
from calendar import month_name
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
REPORT_PATH = PROJECT_ROOT / "Research" / "reports" / "top_strategy_pf_split_report.csv"
STRATEGY_ROOT = PROJECT_ROOT / "strategy"
ASSETS_PATH = PROJECT_ROOT / "config" / "assets.json"
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]


def params_from_variant(variant_id: str) -> dict[str, str]:
    params: dict[str, str] = {}
    for token in variant_id.split("|"):
        if "=" not in token:
            continue
        key, value = token.split("=", 1)
        params[key] = value
    return params


def asset_symbol(asset_key: str, assets: dict[str, dict[str, object]]) -> str:
    return str(assets.get(asset_key, {}).get("symbol") or asset_key).upper().replace("/", "")


def family_core(params: dict[str, str]) -> str:
    family = params.get("family", "")
    direction = params.get("direction", "")
    side = params.get("side", "")
    lookback = params.get("lookback")
    exit_minute = params.get("exit")

    if family.startswith("daily_tsmom_next_overnight"):
        mode = "momentum" if direction == "momentum" else "mean reversion"
        tail = f"{lookback}-day " if lookback else ""
        return f"{tail}daily {mode} overnight"
    if family.startswith("daily_tsmom_next_rth"):
        mode = "momentum" if direction == "momentum" else "mean reversion"
        tail = f"{lookback}-day " if lookback else ""
        return f"{tail}daily {mode} into RTH"
    if family.startswith("ny_open_gap"):
        mode = "fade" if direction == "fade" else "follow-through"
        return f"NY open gap {mode}"
    if family.startswith("overnight_close_to_open_bias"):
        return f"overnight {side or 'directional'} close-to-open bias"
    if family.startswith("us_first30_last30"):
        mode = "continuation" if direction in {"same", "momentum"} else "reversal"
        return f"US opening-range {mode} into the close"
    if family.startswith("us_first30_midday"):
        mode = "continuation" if direction in {"same", "momentum"} else "reversal"
        return f"US opening-range {mode} into midday"
    if family.startswith("london_first30_ny_open"):
        mode = "continuation" if direction in {"same", "momentum"} else "reversal"
        return f"London opening-range {mode} into New York"
    if family.startswith("london_first30_last30"):
        mode = "continuation" if direction in {"same", "momentum"} else "reversal"
        return f"London opening-range {mode} into the US close"
    if family.startswith("asia_range"):
        mode = params.get("direction", "breakout").replace("_", " ")
        return f"Asia range {mode} into London"
    return family.replace("_", " ").strip() or "systematic session edge"


def filter_label(params: dict[str, str]) -> str:
    if params.get("signal_month"):
        month_index = int(float(params["signal_month"]))
        return f"{month_name[month_index]} filter"
    if params.get("signal_weekday_side"):
        weekday_raw, _, side = params["signal_weekday_side"].partition("_")
        weekday = WEEKDAYS[int(float(weekday_raw))] if weekday_raw else "weekday"
        return f"{weekday} {side}s"
    if params.get("signal_weekday"):
        weekday = WEEKDAYS[int(float(params["signal_weekday"]))]
        return f"{weekday} filter"
    if params.get("side_filter"):
        return f"{params['side_filter']}-only"
    return ""


def normalized_label(metadata: dict[str, object], assets: dict[str, dict[str, object]]) -> str:
    variant_id = str(metadata.get("variantId") or "")
    asset_key = str(metadata.get("assetKey") or "")
    symbol = asset_symbol(asset_key, assets)
    if variant_id.startswith("competition_session_edge"):
        params = params_from_variant(variant_id)
        core = family_core(params)
        suffix = filter_label(params)
        return f"{symbol} {core}" + (f" ({suffix})" if suffix else "")
    current = str(metadata.get("label") or metadata.get("strategyId") or "")
    current = re.sub(r"\bCompetition\s+", "", current, flags=re.IGNORECASE).strip()
    return current or str(metadata.get("strategyId") or asset_key)


def replace_strategy_ts_label(path: Path, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(r'(label:\s*)"[^"]*"', rf'\1"{label}"', text, count=1)
    if count != 1:
        raise ValueError(f"Could not update label in {path}")
    path.write_text(updated, encoding="utf-8")


def main() -> None:
    assets = json.loads(ASSETS_PATH.read_text(encoding="utf-8"))
    with REPORT_PATH.open(newline="", encoding="utf-8") as handle:
        folders = [row["folder"] for row in csv.DictReader(handle)]

    updated = 0
    for folder in folders:
        strategy_dir = STRATEGY_ROOT / folder
        metadata_path = next(
            (candidate for candidate in (strategy_dir / "machine_learning" / "selection.json", strategy_dir / "bayes" / "selection.json", strategy_dir / "parameters" / "backtest.json") if candidate.exists()),
            None,
        )
        if metadata_path is None:
            continue
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        label = normalized_label(metadata, assets)
        if metadata.get("label") != label:
            metadata["label"] = label
            metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
            updated += 1
        strategy_ts = strategy_dir / "strategy.ts"
        if strategy_ts.exists():
            replace_strategy_ts_label(strategy_ts, label)
    print(f"Normalized {updated} selected strategy label(s)")


if __name__ == "__main__":
    main()
