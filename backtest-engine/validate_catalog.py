from __future__ import annotations

import json
import re
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
STRATEGY_ROOT = PROJECT_ROOT / "strategy"
LOADER_PATH = PROJECT_ROOT / "src" / "lib" / "strategy-loader.ts"
METADATA_FILES = (
    Path("machine_learning") / "selection.json",
    Path("bayes") / "selection.json",
    Path("parameters") / "backtest.json",
)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def metadata_path_for(strategy_dir: Path) -> Path | None:
    for relative in METADATA_FILES:
        candidate = strategy_dir / relative
        if candidate.exists():
            return candidate
    return None


def extract_field(code: str, field: str) -> str | None:
    match = re.search(rf'{field}\s*:\s*"([^"]+)"', code)
    return match.group(1) if match else None


def loader_folders() -> list[str]:
    code = read_text(LOADER_PATH)
    return re.findall(r'@strategy/([^/]+)/strategy', code)


def main() -> int:
    errors: list[str] = []
    folders_on_disk = sorted(path.name for path in STRATEGY_ROOT.iterdir() if path.is_dir() and (path / "strategy.ts").exists())
    folders_in_loader = loader_folders()

    duplicate_loader_folders = sorted({name for name in folders_in_loader if folders_in_loader.count(name) > 1})
    if duplicate_loader_folders:
        errors.append(f"Duplicate strategy-loader imports: {', '.join(duplicate_loader_folders)}")

    missing_in_loader = sorted(set(folders_on_disk) - set(folders_in_loader))
    if missing_in_loader:
        errors.append(f"Strategy folders missing from loader: {', '.join(missing_in_loader)}")

    missing_on_disk = sorted(set(folders_in_loader) - set(folders_on_disk))
    if missing_on_disk:
        errors.append(f"Loader imports missing on disk: {', '.join(missing_on_disk)}")

    seen_ids: dict[str, str] = {}
    for folder in folders_on_disk:
        strategy_dir = STRATEGY_ROOT / folder
        strategy_code = read_text(strategy_dir / "strategy.ts")
        strategy_id = extract_field(strategy_code, "id")
        folder_value = extract_field(strategy_code, "folder")
        asset_key = extract_field(strategy_code, "assetKey")
        if strategy_id is None:
            errors.append(f"{folder}: missing id in strategy.ts")
        elif strategy_id in seen_ids:
            errors.append(f"Duplicate strategy id '{strategy_id}' in {folder} and {seen_ids[strategy_id]}")
        else:
            seen_ids[strategy_id] = folder

        if folder_value != folder:
            errors.append(f"{folder}: strategy.ts folder field '{folder_value}' does not match directory name")
        if asset_key is None:
            errors.append(f"{folder}: missing assetKey in strategy.ts")
        phase = extract_field(strategy_code, "phase")
        label = extract_field(strategy_code, "label")
        if phase is None:
            errors.append(f"{folder}: missing phase in strategy.ts")
        if label is None:
            errors.append(f"{folder}: missing label in strategy.ts")
        if "runtimeDefaultsFromMetadata(" not in strategy_code:
            errors.append(f"{folder}: strategy.ts should derive defaults via runtimeDefaultsFromMetadata(...)")

        metadata_path = metadata_path_for(strategy_dir)
        if metadata_path is None:
            errors.append(f"{folder}: missing metadata file under machine_learning/, bayes/, or parameters/")
            continue

        payload = json.loads(read_text(metadata_path))
        if payload.get("folder") != folder:
            errors.append(f"{folder}: metadata folder '{payload.get('folder')}' does not match directory name")
        if strategy_id is not None and payload.get("strategyId") != strategy_id:
            errors.append(f"{folder}: metadata strategyId '{payload.get('strategyId')}' does not match strategy.ts id '{strategy_id}'")
        if asset_key is not None and payload.get("assetKey") != asset_key:
            errors.append(f"{folder}: metadata assetKey '{payload.get('assetKey')}' does not match strategy.ts assetKey '{asset_key}'")
        if phase is not None and payload.get("phase") != phase:
            errors.append(f"{folder}: metadata phase '{payload.get('phase')}' does not match strategy.ts phase '{phase}'")
        if label is not None and payload.get("label") != label:
            errors.append(f"{folder}: metadata label '{payload.get('label')}' does not match strategy.ts label '{label}'")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print(f"Validated {len(folders_on_disk)} strategy folders against {LOADER_PATH.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
