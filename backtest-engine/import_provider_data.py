from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import time
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from runner import prepare_data


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = PROJECT_ROOT / "config" / "assets.json"
DATA_15M_ROOT = PROJECT_ROOT / "data" / "15m"
ENV_FALLBACK_PATH = PROJECT_ROOT / ".env.local"
DEFAULT_START = datetime(2020, 1, 1, tzinfo=UTC)
PROJECTX_WINDOW = timedelta(days=120)
TWELVE_DATA_WINDOW = timedelta(days=50)
TWELVE_DATA_CALLS_PER_MINUTE = 7
PACIFIC_TZ = ZoneInfo("America/Los_Angeles")
WEEKEND_CLOSED_MARKETS = {"forex", "futures", "gold_spot", "crypto"}


@dataclass(frozen=True)
class AssetConfig:
    key: str
    symbol: str
    name: str
    market: str
    data_file: str
    twelve_data_symbol: str | None = None


@dataclass
class CandleBar:
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


class TwelveDataKeyRing:
    def __init__(self, keys: list[str], calls_per_minute: int = TWELVE_DATA_CALLS_PER_MINUTE) -> None:
        if not keys:
            raise ValueError("Missing TWELVEDATA_API_KEYS")
        self._keys = keys
        self._calls_per_minute = max(1, calls_per_minute)
        self._usage: dict[str, deque[float]] = {key: deque() for key in keys}
        self._cooldown_until: dict[str, float] = {key: 0.0 for key in keys}
        self._cursor = 0

    def acquire(self) -> str:
        while True:
            now = time.monotonic()
            next_ready = now + 60.0
            for offset in range(len(self._keys)):
                key = self._keys[(self._cursor + offset) % len(self._keys)]
                usage = self._usage[key]
                while usage and now - usage[0] >= 60.0:
                    usage.popleft()
                if now < self._cooldown_until[key]:
                    next_ready = min(next_ready, self._cooldown_until[key])
                    continue
                if len(usage) >= self._calls_per_minute:
                    next_ready = min(next_ready, usage[0] + 60.0)
                    continue
                usage.append(now)
                self._cursor = (self._cursor + offset + 1) % len(self._keys)
                return key
            time.sleep(max(0.5, next_ready - now))

    def penalize(self, key: str, seconds: float) -> None:
        self._cooldown_until[key] = max(self._cooldown_until[key], time.monotonic() + seconds)


def load_env_fallback() -> dict[str, str]:
    values: dict[str, str] = {}
    if not ENV_FALLBACK_PATH.exists():
        return values
    for raw_line in ENV_FALLBACK_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


ENV_FALLBACK = load_env_fallback()


def env_value(name: str) -> str | None:
    value = os.environ.get(name)
    if value is not None and value.strip():
        return value.strip()
    fallback = ENV_FALLBACK.get(name)
    return fallback.strip() if fallback and fallback.strip() else None


def load_assets() -> dict[str, AssetConfig]:
    payload = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    assets: dict[str, AssetConfig] = {}
    for key, raw in payload.items():
        assets[key] = AssetConfig(
            key=key,
            symbol=raw["symbol"],
            name=raw["name"],
            market=raw["market"],
            data_file=raw["dataFile"],
            twelve_data_symbol=raw.get("twelveDataSymbol"),
        )
    return assets


def parse_start_date(value: str | None) -> datetime:
    if not value:
        return DEFAULT_START
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def default_end_date() -> datetime:
    return datetime.now(UTC).replace(second=0, microsecond=0)


def csv_number(value: float) -> str:
    return f"{value:.10f}".rstrip("0").rstrip(".") or "0"


def market_is_open_at(asset: AssetConfig, timestamp: int) -> bool:
    if asset.market not in WEEKEND_CLOSED_MARKETS:
        return True

    local = datetime.fromtimestamp(int(timestamp), tz=PACIFIC_TZ)
    weekday = local.weekday()
    minutes = local.hour * 60 + local.minute
    if weekday == 5:
        return False
    if weekday == 6:
        return minutes >= 14 * 60
    if weekday == 4:
        return minutes < 14 * 60
    return True


def closed_15m_cutoff() -> int:
    return int(time.time()) - 75


def read_existing_candles(asset: AssetConfig) -> list[CandleBar]:
    input_path = DATA_15M_ROOT / asset.data_file
    if not input_path.exists():
        return []

    bars: list[CandleBar] = []
    with input_path.open("r", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            try:
                bars.append(
                    CandleBar(
                        time=int(float(row["time"])),
                        open=float(row["open"]),
                        high=float(row["high"]),
                        low=float(row["low"]),
                        close=float(row["close"]),
                        volume=float(row.get("volume", 0) or 0),
                    )
                )
            except (KeyError, TypeError, ValueError):
                continue
    return sorted(bars, key=lambda item: item.time)


def merge_candles(existing: list[CandleBar], incoming: list[CandleBar]) -> list[CandleBar]:
    bars_by_time = {bar.time: bar for bar in existing}
    for bar in incoming:
        bars_by_time[bar.time] = bar
    return [bars_by_time[timestamp] for timestamp in sorted(bars_by_time)]


def incremental_start(asset: AssetConfig, lookback_days: int) -> datetime | None:
    existing = read_existing_candles(asset)
    if not existing:
        return None
    last_timestamp = existing[-1].time
    return datetime.fromtimestamp(last_timestamp, tz=UTC) - timedelta(days=max(0, lookback_days))


def write_candles(asset: AssetConfig, bars: list[CandleBar]) -> None:
    output_path = DATA_15M_ROOT / asset.data_file
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["time", "open", "high", "low", "close", "volume"])
        for bar in bars:
            writer.writerow(
                [
                    bar.time,
                    csv_number(bar.open),
                    csv_number(bar.high),
                    csv_number(bar.low),
                    csv_number(bar.close),
                    csv_number(bar.volume),
                ]
            )


def daterange(start: datetime, end: datetime, step: timedelta) -> list[tuple[datetime, datetime]]:
    windows: list[tuple[datetime, datetime]] = []
    cursor = start
    while cursor < end:
        next_cursor = min(cursor + step, end)
        windows.append((cursor, next_cursor))
        cursor = next_cursor
    return windows


def projectx_bridge_command(asset: AssetConfig, start: datetime, end: datetime) -> list[str]:
    return [
        "node",
        "--env-file=.env.local",
        "--import",
        "tsx",
        "scripts/projectx-fetch-bars.ts",
        f"--asset={asset.key}",
        f"--start={start.isoformat().replace('+00:00', 'Z')}",
        f"--end={end.isoformat().replace('+00:00', 'Z')}",
        "--unit=2",
        "--unit-number=15",
        "--limit=20000",
    ]


def fetch_projectx_window_15m(asset: AssetConfig, start: datetime, end: datetime) -> list[CandleBar]:
    result = subprocess.run(
        projectx_bridge_command(asset, start, end),
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "Unknown ProjectX bridge error").strip()
        raise RuntimeError(f"ProjectX bridge failed for {asset.key}: {detail[-800:]}")

    try:
        payload = json.loads(result.stdout or "[]")
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"ProjectX bridge returned unreadable JSON for {asset.key}: {result.stdout[:240]}") from exc

    bars: list[CandleBar] = []
    for raw_bar in payload:
        try:
            timestamp = int(raw_bar["time"])
            if timestamp + 900 > closed_15m_cutoff():
                continue
            if not market_is_open_at(asset, timestamp):
                continue
            bars.append(
                CandleBar(
                    time=timestamp,
                    open=float(raw_bar["open"]),
                    high=float(raw_bar["high"]),
                    low=float(raw_bar["low"]),
                    close=float(raw_bar["close"]),
                    volume=float(raw_bar.get("volume", 0) or 0),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue

    return bars


def fetch_projectx_15m(asset: AssetConfig, start: datetime, end: datetime) -> list[CandleBar]:
    bars_by_time: dict[int, CandleBar] = {}
    windows = daterange(start, end, PROJECTX_WINDOW)

    for window_start, window_end in windows:
        print(
            f"[projectx] {asset.key}: {window_start.date().isoformat()} -> {window_end.date().isoformat()}",
            flush=True,
        )
        for bar in fetch_projectx_window_15m(asset, window_start, window_end):
            bars_by_time[bar.time] = bar

    return [bars_by_time[timestamp] for timestamp in sorted(bars_by_time)]


def twelvedata_request(key_ring: TwelveDataKeyRing, params: dict[str, str]) -> dict[str, Any]:
    failures: list[str] = []
    attempts = 0
    while attempts < len(key_ring._keys) * 2:
        api_key = key_ring.acquire()
        attempts += 1
        url = f"https://api.twelvedata.com/time_series?{urlencode({**params, 'apikey': api_key})}"
        request = Request(url)
        try:
            with urlopen(request, timeout=60) as response:
                payload = json.loads(response.read().decode("utf-8", "replace"))
        except HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")
            failures.append(f"...{api_key[-4:]}: HTTP {exc.code} {body[:120]}")
            if exc.code == 429:
                key_ring.penalize(api_key, 65)
                continue
            raise RuntimeError(f"Twelve Data HTTP {exc.code}: {body[:240]}") from exc
        except URLError as exc:
            failures.append(f"...{api_key[-4:]}: {exc}")
            key_ring.penalize(api_key, 5)
            continue

        if payload.get("status") == "ok":
            return payload
        message = str(payload.get("message") or payload.get("status") or "unknown error")
        if "No data is available on the specified dates" in message:
            return {"status": "ok", "values": []}
        failures.append(f"...{api_key[-4:]}: {message}")
        if int(payload.get("code", 0) or 0) == 429 or "API credits" in message:
            key_ring.penalize(api_key, 65)
            continue
        raise RuntimeError(f"Twelve Data rejected the request: {message}")

    raise RuntimeError(f"Twelve Data failed after retries: {' | '.join(failures[:8])}")


def fetch_twelvedata_15m(asset: AssetConfig, start: datetime, end: datetime) -> list[CandleBar]:
    raw_keys = env_value("TWELVEDATA_API_KEYS")
    if not raw_keys:
        raise RuntimeError("Missing TWELVEDATA_API_KEYS")
    keys = [item.strip() for item in raw_keys.split(",") if item.strip()]
    if not keys:
        raise RuntimeError("Missing TWELVEDATA_API_KEYS")
    if not asset.twelve_data_symbol:
        raise RuntimeError(f"Missing Twelve Data symbol for {asset.key}")

    key_ring = TwelveDataKeyRing(keys)
    bars_by_time: dict[int, CandleBar] = {}
    windows = daterange(start, end, TWELVE_DATA_WINDOW)

    for window_start, window_end in windows:
        params = {
            "symbol": asset.twelve_data_symbol,
            "interval": "15min",
            "outputsize": "5000",
            "order": "ASC",
            "timezone": "UTC",
            "start_date": window_start.strftime("%Y-%m-%dT%H:%M:%S"),
            "end_date": window_end.strftime("%Y-%m-%dT%H:%M:%S"),
        }
        print(
            f"[twelvedata] {asset.key}: {window_start.date().isoformat()} -> {window_end.date().isoformat()}",
            flush=True,
        )
        payload = twelvedata_request(key_ring, params)
        for raw_bar in payload.get("values", []):
            raw_dt = raw_bar.get("datetime")
            if not raw_dt:
                continue
            opened_at = datetime.fromisoformat(raw_dt).replace(tzinfo=UTC)
            timestamp = int(opened_at.timestamp())
            if timestamp + 900 > closed_15m_cutoff():
                continue
            if not market_is_open_at(asset, timestamp):
                continue
            open_ = float(raw_bar["open"])
            high = float(raw_bar["high"])
            low = float(raw_bar["low"])
            close = float(raw_bar["close"])
            volume = float(raw_bar.get("volume", 0) or 0)
            bars_by_time[timestamp] = CandleBar(timestamp, open_, high, low, close, volume)

    return [bars_by_time[timestamp] for timestamp in sorted(bars_by_time)]


def fetch_asset(asset: AssetConfig, start: datetime, end: datetime) -> list[CandleBar]:
    if asset.market == "futures":
        return fetch_projectx_15m(asset, start, end)
    if asset.market in {"forex", "gold_spot", "crypto"}:
        return fetch_twelvedata_15m(asset, start, end)
    raise RuntimeError(f"Unsupported market for import: {asset.market}")


def selected_assets(all_assets: dict[str, AssetConfig], requested: list[str] | None) -> list[AssetConfig]:
    if not requested:
        raise ValueError("Pass at least one --asset key so the import stays intentional.")
    selected: list[AssetConfig] = []
    missing: list[str] = []
    for key in requested:
        asset = all_assets.get(key)
        if asset is None:
            missing.append(key)
            continue
        selected.append(asset)
    if missing:
        raise ValueError(f"Unknown asset key(s): {', '.join(missing)}")
    return selected


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download 15m candles from ProjectX and Twelve Data")
    parser.add_argument("--asset", action="append", help="Asset key to import. Repeat to import multiple assets.")
    parser.add_argument("--all-assets", action="store_true", help="Import every asset in config/assets.json.")
    parser.add_argument("--incremental", action="store_true", help="Start from the existing local CSV tail and merge new bars into it.")
    parser.add_argument("--continue-on-error", action="store_true", help="Log per-asset provider failures and continue importing the rest.")
    parser.add_argument("--lookback-days", type=int, default=7, help="When --incremental is used, refetch this many days before the local tail.")
    parser.add_argument("--start-date", help="Inclusive UTC start date in YYYY-MM-DD or ISO format. Defaults to 2020-01-01.")
    parser.add_argument("--end-date", help="Exclusive UTC end date in YYYY-MM-DD or ISO format. Defaults to now.")
    parser.add_argument("--prepare-data", action="store_true", help="Rebuild 30m/45m/1h/4h/1d/1w folders after import.")
    return parser.parse_args()


def parse_end_date(value: str | None) -> datetime:
    if not value:
        return default_end_date()
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def main() -> None:
    args = parse_args()
    assets = load_assets()
    import_end = parse_end_date(args.end_date)

    if args.all_assets and args.asset:
        raise ValueError("Use either --all-assets or repeated --asset, not both.")

    targets = list(assets.values()) if args.all_assets else selected_assets(assets, args.asset)
    print(f"Importing {len(targets)} asset(s) through {import_end.isoformat()}", flush=True)
    failures: list[tuple[str, str]] = []

    for asset in targets:
        try:
            import_start = parse_start_date(args.start_date)
            if args.incremental and not args.start_date:
                import_start = incremental_start(asset, args.lookback_days) or import_start
            if import_end <= import_start:
                print(f"Skipping {asset.key}; existing data is already newer than the requested end.", flush=True)
                continue

            print(f"Starting {asset.key} ({asset.name})", flush=True)
            print(f"Window {import_start.isoformat()} -> {import_end.isoformat()}", flush=True)
            incoming_bars = fetch_asset(asset, import_start, import_end)
            bars = merge_candles(read_existing_candles(asset), incoming_bars) if args.incremental else incoming_bars
            if not bars:
                raise RuntimeError(f"No 15m candles were returned for {asset.key}")
            write_candles(asset, bars)
            print(
                f"Wrote {len(bars)} 15m candles to data/15m/{asset.data_file} ({len(incoming_bars)} fetched)",
                flush=True,
            )
        except Exception as exc:
            if not args.continue_on_error:
                raise
            message = str(exc)
            failures.append((asset.key, message))
            print(f"Failed {asset.key}: {message}", flush=True)

    if args.prepare_data:
        print("Rebuilding derived timeframes from data/15m", flush=True)
        prepare_data(asset_filters=[asset.key for asset in targets])

    if failures:
        print("Completed with provider failures:", flush=True)
        for key, message in failures:
            print(f"- {key}: {message}", flush=True)


if __name__ == "__main__":
    main()
