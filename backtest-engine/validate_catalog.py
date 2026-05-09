from __future__ import annotations

import csv
from datetime import datetime, timezone
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
ML_TRAINING_CUTOFF = datetime(2022, 1, 1, tzinfo=timezone.utc)


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


def parse_metadata_date(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    if value in {"asset_start", "asset_latest"}:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def metadata_window_dates(value: object) -> tuple[datetime | None, datetime | None]:
    if isinstance(value, dict):
        return parse_metadata_date(value.get("start")), parse_metadata_date(value.get("end"))
    if isinstance(value, str):
        dates = re.findall(r"\d{4}-\d{2}-\d{2}", value)
        start = parse_metadata_date(dates[0]) if dates else None
        end = parse_metadata_date(dates[1]) if len(dates) > 1 else None
        return start, end
    return None, None


def first_backtest_entry_time(csv_path: Path) -> datetime | None:
    if not csv_path.exists():
        return None
    with csv_path.open("r", newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            raw = row.get("entry_time") or row.get("signal_time")
            if not raw:
                continue
            try:
                parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            except ValueError:
                return None
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed
    return None


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
        if metadata_path.relative_to(strategy_dir) == Path("machine_learning") / "selection.json":
            training_start, training_end = metadata_window_dates(payload.get("trainingWindow"))
            forward_start, _ = metadata_window_dates(payload.get("forwardWindow"))
            if payload.get("trainingWindow") is None:
                errors.append(f"{folder}: machine_learning metadata must declare trainingWindow")
            elif training_end is None or training_end >= ML_TRAINING_CUTOFF:
                errors.append(f"{folder}: machine_learning trainingWindow must end before 2022-01-01")
            if payload.get("forwardWindow") is None:
                errors.append(f"{folder}: machine_learning metadata must declare forwardWindow")
            elif forward_start is None or forward_start < ML_TRAINING_CUTOFF:
                errors.append(f"{folder}: machine_learning forwardWindow must start on or after 2022-01-01")
            if training_start is not None and training_start >= ML_TRAINING_CUTOFF:
                errors.append(f"{folder}: machine_learning trainingWindow start must be before 2022-01-01")
            first_entry_time = first_backtest_entry_time(strategy_dir / "backtest_trades.csv")
            if first_entry_time is not None and first_entry_time < ML_TRAINING_CUTOFF:
                errors.append(f"{folder}: machine_learning backtest_trades.csv contains pre-2022 output rows")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print(f"Validated {len(folders_on_disk)} strategy folders against {LOADER_PATH.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
