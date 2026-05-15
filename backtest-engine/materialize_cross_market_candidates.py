from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

import runner


BEST_CSV = runner.PROJECT_ROOT / "backtest-engine" / "research" / "cross_market_best.csv"
STRATEGY_ROOT = runner.PROJECT_ROOT / "strategy"
LOADER_PATH = runner.PROJECT_ROOT / "src" / "lib" / "strategy-loader.ts"


@dataclass(frozen=True)
class CandidateRow:
    base_strategy_id: str
    base_label: str
    target_asset_key: str
    variant_id: str
    best_inverted: bool
    best_pf: float
    best_trades: int
    best_total_r: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Materialize strong cross-market candidates as first-class strategies")
    parser.add_argument("--min-pf", type=float, default=1.75, help="Minimum best profit factor to materialize")
    parser.add_argument("--min-trades", type=int, default=20, help="Minimum best trade count to materialize")
    parser.add_argument("--min-total-r", type=float, default=8.0, help="Minimum best total R to materialize")
    parser.add_argument("--base-strategy", action="append", help="Only materialize candidates from this base strategy id. Repeat to include multiple.")
    parser.add_argument("--target-asset", action="append", help="Only materialize candidates for this target asset key. Repeat to include multiple.")
    parser.add_argument("--limit", type=int, help="Optional max number of candidates to materialize after filtering")
    parser.add_argument("--backtest-only", action="store_true", help="Mark generated strategies as backtest-only in the app")
    parser.add_argument("--overwrite", action="store_true", help="Regenerate candidate folders even if they already exist")
    return parser.parse_args()


def clean_variant_id(variant_id: str) -> str:
    tokens = [token for token in variant_id.split("|") if token and token != "inverse=1"]
    return "|".join(tokens)


def camel_case(value: str) -> str:
    parts = [part for part in value.split("_") if part]
    if not parts:
        return "generatedStrategy"
    name = parts[0]
    for part in parts[1:]:
        name += part[:1].upper() + part[1:]
    if name[:1].isdigit():
        name = f"s{name}"
    return re.sub(r"[^A-Za-z0-9]", "", name)


def find_metadata_path(strategy_dir: Path) -> Path:
    for relative_path in runner.STRATEGY_METADATA_FILES:
        candidate = strategy_dir / relative_path
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"Missing metadata file in {strategy_dir}")


def strategy_folder_name(base_strategy_id: str, target_asset_key: str, inverted: bool) -> str:
    return f"{base_strategy_id}_on_{target_asset_key}" + ("_opposite" if inverted else "")


def strategy_label(base_label: str, target_asset_name: str, inverted: bool) -> str:
    return f"{base_label} on {target_asset_name}" + (" Opposite" if inverted else "")


def load_candidates(args: argparse.Namespace) -> list[CandidateRow]:
    with BEST_CSV.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    requested_base_strategies = {
        value.strip().lower()
        for value in (args.base_strategy or [])
        if value and value.strip()
    }
    requested_target_assets = {
        value.strip().lower()
        for value in (args.target_asset or [])
        if value and value.strip()
    }

    selected = [
        CandidateRow(
            base_strategy_id=row["base_strategy_id"],
            base_label=row["base_label"],
            target_asset_key=row["target_asset_key"],
            variant_id=row["variant_id"],
            best_inverted=str(row["best_inverted"]).lower() == "true",
            best_pf=float(row["best_pf"]),
            best_trades=int(row["best_trades"]),
            best_total_r=float(row["best_total_r"]),
        )
        for row in rows
        if float(row["best_pf"]) >= args.min_pf
        and int(row["best_trades"]) >= args.min_trades
        and float(row["best_total_r"]) >= args.min_total_r
        and (not requested_base_strategies or row["base_strategy_id"].lower() in requested_base_strategies)
        and (not requested_target_assets or row["target_asset_key"].lower() in requested_target_assets)
    ]
    if args.limit is not None:
        selected = selected[: args.limit]
    return selected


def copy_strategy_scaffold(source_dir: Path, target_dir: Path) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    for source_path in source_dir.rglob("*"):
        relative_path = source_path.relative_to(source_dir)
        if relative_path == Path("backtest_trades.csv"):
            continue
        target_path = target_dir / relative_path
        if source_path.is_dir():
            target_path.mkdir(parents=True, exist_ok=True)
            continue
        target_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, target_path)
    stale_backtest = target_dir / "backtest_trades.csv"
    if stale_backtest.exists():
        stale_backtest.unlink()


def replace_literal(text: str, key: str, value: str) -> str:
    pattern = rf'({key}:\s*)"[^"]*"'
    updated_text, replacements = re.subn(pattern, rf'\1"{value}"', text, count=1)
    if replacements != 1:
        raise ValueError(f"Could not rewrite {key} in strategy.ts")
    return updated_text


def replace_boolean(text: str, key: str, value: bool) -> str:
    pattern = rf"({key}:\s*)(true|false)"
    replacement = "true" if value else "false"
    updated_text, replacements = re.subn(pattern, rf"\1{replacement}", text, count=1)
    if replacements != 1:
        raise ValueError(f"Could not rewrite {key} in strategy.ts")
    return updated_text


def rewrite_strategy_ts(
    strategy_path: Path,
    strategy_id: str,
    label: str,
    folder: str,
    asset_key: str,
    live_enabled: bool,
    inverted: bool = False,
) -> None:
    text = strategy_path.read_text(encoding="utf-8")
    text = replace_literal(text, "id", strategy_id)
    text = replace_literal(text, "label", label)
    text = replace_literal(text, "folder", folder)
    text = replace_literal(text, "assetKey", asset_key)
    text = replace_boolean(text, "liveEnabled", live_enabled)
    if inverted and "invertSignal:" not in text and "defaults: {" in text:
        updated_text, replacements = re.subn(
            r"\n  }\n\}\);$",
            "\n    invertSignal: true,\n  }\n});",
            text,
            count=1,
        )
        if replacements != 1:
            raise ValueError(f"Could not inject invertSignal in {strategy_path}")
        text = updated_text
    strategy_path.write_text(text, encoding="utf-8")


def rewrite_metadata(
    metadata_path: Path,
    strategy_id: str,
    label: str,
    folder: str,
    asset_key: str,
    variant_id: str,
    inverted: bool,
    candidate: CandidateRow,
) -> None:
    payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    stop_loss_policy = payload.get("stopLossPolicy")
    if isinstance(stop_loss_policy, dict):
        if "buffer_units" in stop_loss_policy and "bufferUnits" not in stop_loss_policy:
            stop_loss_policy["bufferUnits"] = stop_loss_policy.pop("buffer_units")

    take_profit_policy = payload.get("takeProfitPolicy")
    if isinstance(take_profit_policy, dict):
        if "buffer_units" in take_profit_policy and "bufferUnits" not in take_profit_policy:
            take_profit_policy["bufferUnits"] = take_profit_policy.pop("buffer_units")
        if "reward_multiple" in take_profit_policy and "rewardMultiple" not in take_profit_policy:
            take_profit_policy["rewardMultiple"] = take_profit_policy.pop("reward_multiple")

    size_policy = payload.get("sizePolicy")
    if isinstance(size_policy, dict):
        if "min_multiplier" in size_policy and "minMultiplier" not in size_policy:
            size_policy["minMultiplier"] = size_policy.pop("min_multiplier")
        if "max_multiplier" in size_policy and "maxMultiplier" not in size_policy:
            size_policy["maxMultiplier"] = size_policy.pop("max_multiplier")
        if "min_confidence" in size_policy and "minConfidence" not in size_policy:
            size_policy["minConfidence"] = size_policy.pop("min_confidence")
        if "max_confidence" in size_policy and "maxConfidence" not in size_policy:
            size_policy["maxConfidence"] = size_policy.pop("max_confidence")

    dynamic_stop_loss_policy = payload.get("dynamicStopLossPolicy")
    if isinstance(dynamic_stop_loss_policy, dict):
        if "buffer_units" in dynamic_stop_loss_policy and "bufferUnits" not in dynamic_stop_loss_policy:
            dynamic_stop_loss_policy["bufferUnits"] = dynamic_stop_loss_policy.pop("buffer_units")

    dynamic_take_profit_policy = payload.get("dynamicTakeProfitPolicy")
    if isinstance(dynamic_take_profit_policy, dict):
        if "buffer_units" in dynamic_take_profit_policy and "bufferUnits" not in dynamic_take_profit_policy:
            dynamic_take_profit_policy["bufferUnits"] = dynamic_take_profit_policy.pop("buffer_units")
        if "reward_multiple" in dynamic_take_profit_policy and "rewardMultiple" not in dynamic_take_profit_policy:
            dynamic_take_profit_policy["rewardMultiple"] = dynamic_take_profit_policy.pop("reward_multiple")

    payload["strategyId"] = strategy_id
    payload["label"] = label
    payload["folder"] = folder
    payload["assetKey"] = asset_key
    payload["variantId"] = clean_variant_id(variant_id)
    payload["crossMarketSourceStrategyId"] = candidate.base_strategy_id
    payload["crossMarketBestProfitFactor"] = candidate.best_pf
    payload["crossMarketBestTrades"] = candidate.best_trades
    payload["crossMarketBestTotalR"] = candidate.best_total_r
    payload["selectedForwardProfitFactor"] = candidate.best_pf
    payload["selectedForwardTrades"] = candidate.best_trades
    payload["forwardTotalR"] = candidate.best_total_r
    payload["forwardAverageR"] = candidate.best_total_r / candidate.best_trades if candidate.best_trades else 0
    payload.pop("forwardWins", None)
    payload.pop("forwardLosses", None)
    payload.pop("forwardMaxDrawdownR", None)
    payload["verificationSummary"] = (
        f"Cross-market transfer from {candidate.base_strategy_id}; target asset backtest "
        f"qualified with PF {candidate.best_pf:.2f}, {candidate.best_trades} trades, "
        f"and {candidate.best_total_r:.2f}R total."
    )
    payload["researchSummary"] = (
        f"Cross-market candidate generated from {candidate.base_label}; same strategy concept "
        f"and variant applied to the target asset after filtering for PF >= 1.5."
    )
    if inverted:
        payload["invertSignal"] = True
    else:
        payload.pop("invertSignal", None)
    metadata_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def rewrite_strategy_loader() -> None:
    folders = sorted(path.parent.name for path in STRATEGY_ROOT.glob("*/strategy.ts"))
    import_lines = [
        f'import {camel_case(folder)}Strategy from "@strategy/{folder}/strategy";'
        for folder in folders
    ]
    strategy_lines = [f"  {camel_case(folder)}Strategy," for folder in folders]
    loader_text = "\n".join(import_lines)
    loader_text += '\n\nimport type { StrategyDefinition } from "@/lib/strategy-definition";\n\n'
    loader_text += 'export type { StrategyDefinition, StrategySignal } from "@/lib/strategy-definition";\n\n'
    loader_text += "export const STRATEGY_DEFINITIONS: StrategyDefinition[] = [\n"
    loader_text += "\n".join(strategy_lines)
    loader_text += "\n];\n\n"
    loader_text += "export function strategyForPhase(phase: string): StrategyDefinition | undefined {\n"
    loader_text += "  return STRATEGY_DEFINITIONS.find((strategy) => strategy.phase === phase);\n"
    loader_text += "}\n"
    LOADER_PATH.write_text(loader_text, encoding="utf-8")


def main() -> None:
    args = parse_args()
    live_enabled = not args.backtest_only
    assets = runner.load_asset_by_key()
    candidates = load_candidates(args)
    if not candidates:
        raise ValueError("No cross-market candidates matched the requested thresholds")

    created_folders: list[str] = []
    skipped_existing_folders: list[str] = []
    skipped_missing_sources: list[str] = []
    for candidate in candidates:
        target_asset = assets.get(candidate.target_asset_key)
        if target_asset is None:
            raise KeyError(f"Missing target asset config for {candidate.target_asset_key}")

        source_dir = STRATEGY_ROOT / candidate.base_strategy_id
        if not source_dir.exists():
            skipped_missing_sources.append(candidate.base_strategy_id)
            continue

        folder = strategy_folder_name(candidate.base_strategy_id, target_asset.key, candidate.best_inverted)
        label = strategy_label(candidate.base_label, target_asset.name, candidate.best_inverted)
        target_dir = STRATEGY_ROOT / folder
        if target_dir.exists() and not args.overwrite:
            skipped_existing_folders.append(folder)
            continue

        copy_strategy_scaffold(source_dir, target_dir)
        rewrite_metadata(
            find_metadata_path(target_dir),
            folder,
            label,
            folder,
            target_asset.key,
            candidate.variant_id,
            candidate.best_inverted,
            candidate,
        )
        rewrite_strategy_ts(target_dir / "strategy.ts", folder, label, folder, target_asset.key, live_enabled, candidate.best_inverted)
        created_folders.append(folder)

    rewrite_strategy_loader()

    print(
        f"Materialized {len(created_folders)} cross-market strategies "
        f"(min_pf={args.min_pf}, min_trades={args.min_trades}, min_total_r={args.min_total_r})"
    )
    for folder in created_folders:
        print(folder)
    if skipped_existing_folders:
        print(f"Skipped {len(skipped_existing_folders)} existing strategy folders (use --overwrite to regenerate)")
    if skipped_missing_sources:
        print(f"Skipped {len(set(skipped_missing_sources))} missing source strategy folders")


if __name__ == "__main__":
    main()
