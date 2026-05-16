from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


RESEARCH_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = RESEARCH_ROOT.parent
CONFIG_ROOT = RESEARCH_ROOT / "config"
SOURCES_ROOT = RESEARCH_ROOT / "sources"
SEARCH_RESULTS_ROOT = SOURCES_ROOT / "search_results"
PAGES_ROOT = SOURCES_ROOT / "pages"
IDEAS_ROOT = RESEARCH_ROOT / "ideas"
IDEAS_INBOX = IDEAS_ROOT / "inbox"
IDEAS_APPROVED = IDEAS_ROOT / "approved"
IDEAS_REJECTED = IDEAS_ROOT / "rejected"
STRATEGIES_ROOT = RESEARCH_ROOT / "strategies"
READY_ROOT = STRATEGIES_ROOT / "ready_to_backtest"
BACKTESTED_ROOT = STRATEGIES_ROOT / "backtested"
QUALIFIED_ROOT = STRATEGIES_ROOT / "qualified"
REJECTED_ROOT = STRATEGIES_ROOT / "rejected"
REPORTS_ROOT = RESEARCH_ROOT / "reports"
PROMOTIONS_ROOT = RESEARCH_ROOT / "promotions"
ASSET_CONFIG_PATH = PROJECT_ROOT / "config" / "assets.json"
DATA_ROOT = PROJECT_ROOT / "data" / "15m"
LIVE_STRATEGY_ROOT = PROJECT_ROOT / "strategy"
BACKTEST_ENGINE_ROOT = PROJECT_ROOT / "backtest-engine"

STAGE_LABELS = {
    "research": "Idea Discovery",
    "idea": "Idea Formalization",
    "coding": "Strategy Coding",
    "backtest": "Backtest Review",
    "pipeline": "Research Pipeline",
}

STAGE_OUTPUT_LABELS = {
    "research": "new ideas",
    "idea": "formalized ideas",
    "coding": "coded strategies",
    "backtest": "backtest results",
}

STAGE_DIRS = [
    SEARCH_RESULTS_ROOT,
    PAGES_ROOT,
    IDEAS_INBOX,
    IDEAS_APPROVED,
    IDEAS_REJECTED,
    READY_ROOT,
    BACKTESTED_ROOT,
    QUALIFIED_ROOT,
    REJECTED_ROOT,
    REPORTS_ROOT,
    PROMOTIONS_ROOT,
]


def ensure_research_dirs() -> None:
    for directory in STAGE_DIRS:
        directory.mkdir(parents=True, exist_ok=True)


def add_backtest_engine_to_path() -> None:
    path = str(BACKTEST_ENGINE_ROOT)
    if path not in sys.path:
        sys.path.insert(0, path)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows and fieldnames is None:
        path.write_text("", encoding="utf-8")
        return
    columns = fieldnames or list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def slug(value: str, max_length: int = 96) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", value).strip("_").lower()
    return cleaned[:max_length].strip("_") or "item"


def short_hash(value: Any, length: int = 10) -> str:
    raw = json.dumps(value, sort_keys=True, default=str) if not isinstance(value, str) else value
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:length]


def stable_id(*parts: Any, prefix: str = "", max_slug_length: int = 80) -> str:
    raw = "|".join(json.dumps(part, sort_keys=True, default=str) for part in parts)
    head = slug("_".join(str(part) for part in parts if isinstance(part, str)), max_slug_length)
    return f"{prefix}{head}_{short_hash(raw, 8)}"


@dataclass(frozen=True)
class Asset:
    key: str
    symbol: str
    name: str
    market: str
    data_file: str
    tick_size: float


def load_assets(markets: Iterable[str] | None = None, asset_keys: Iterable[str] | None = None) -> list[Asset]:
    requested_markets = {item.strip().lower() for item in (markets or []) if item.strip()}
    requested_assets = {item.strip().lower() for item in (asset_keys or []) if item.strip()}
    payload = read_json(ASSET_CONFIG_PATH)
    assets: list[Asset] = []
    for key, raw in payload.items():
        asset = Asset(
            key=key,
            symbol=str(raw["symbol"]),
            name=str(raw["name"]),
            market=str(raw["market"]),
            data_file=str(raw["dataFile"]),
            tick_size=float(raw["tickSize"]),
        )
        if requested_markets and asset.market.lower() not in requested_markets:
            continue
        if requested_assets and asset.key.lower() not in requested_assets and asset.symbol.lower() not in requested_assets:
            continue
        if not (DATA_ROOT / asset.data_file).exists():
            continue
        assets.append(asset)
    return assets


def split_csv_arg(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def iter_json_files(directory: Path) -> list[Path]:
    return sorted(path for path in directory.glob("*.json") if path.is_file())


def copy_into_stage(source: Path, target_dir: Path) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / source.name
    shutil.copy2(source, target)
    return target


def remove_if_inside(path: Path, root: Path) -> None:
    resolved_path = path.resolve()
    resolved_root = root.resolve()
    if resolved_path == resolved_root or resolved_root not in resolved_path.parents:
        raise ValueError(f"Refusing to remove outside {resolved_root}: {resolved_path}")
    if resolved_path.is_dir():
        shutil.rmtree(resolved_path)
    elif resolved_path.exists():
        resolved_path.unlink()


def env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}
