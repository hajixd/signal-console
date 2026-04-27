from __future__ import annotations

import argparse
import base64
import csv
import json
import os
import re
import time
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from runner import prepare_data


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = PROJECT_ROOT / "config" / "assets.json"
DATA_15M_ROOT = PROJECT_ROOT / "data" / "15m"
ENV_FALLBACK_PATH = PROJECT_ROOT / ".env.local"
DEFAULT_START = datetime(2020, 1, 1, tzinfo=UTC)
DATABENTO_WINDOW = timedelta(days=120)
TWELVE_DATA_WINDOW = timedelta(days=50)
TWELVE_DATA_CALLS_PER_MINUTE = 7


@dataclass(frozen=True)
class AssetConfig:
    key: str
    symbol: str
    name: str
    market: str
    data_file: str
    databento_symbol: str | None = None
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
            databento_symbol=raw.get("databentoSymbol"),
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


def normalize_numeric(value: Any) -> float:
    numeric = float(value)
    if abs(numeric) > 1_000_000:
        return numeric / 1_000_000_000
    return numeric


def csv_number(value: float) -> str:
    return f"{value:.10f}".rstrip("0").rstrip(".") or "0"


def floor_to_15m(epoch_seconds: int) -> int:
    return epoch_seconds - (epoch_seconds % 900)


def closed_15m_cutoff() -> int:
    return int(time.time()) - 75


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


def parse_databento_available_end(body: str) -> datetime | None:
    match = re.search(r"available up to '([^']+)'", body)
    if not match:
        return None
    parsed = datetime.fromisoformat(match.group(1))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def databento_request(api_key: str, params: dict[str, str]) -> Any:
    request = Request(f"https://hist.databento.com/v0/timeseries.get_range?{urlencode(params)}")
    encoded = base64.b64encode(f"{api_key}:".encode("utf-8")).decode("ascii")
    request.add_header("Authorization", f"Basic {encoded}")
    return urlopen(request, timeout=120)


def fetch_databento_15m(asset: AssetConfig, start: datetime, end: datetime) -> list[CandleBar]:
    api_key = env_value("DATABENTO_API_KEY")
    if not api_key:
        raise RuntimeError("Missing DATABENTO_API_KEY")
    if not asset.databento_symbol:
        raise RuntimeError(f"Missing Databento symbol for {asset.key}")

    bars_by_time: dict[int, CandleBar] = {}
    windows = daterange(start, end, DATABENTO_WINDOW)

    for window_start, window_end in windows:
        effective_end = window_end
        while True:
            params = {
                "dataset": "GLBX.MDP3",
                "schema": "ohlcv-1m",
                "stype_in": "continuous",
                "symbols": asset.databento_symbol,
                "start": window_start.isoformat().replace("+00:00", "Z"),
                "end": effective_end.isoformat().replace("+00:00", "Z"),
                "encoding": "json",
            }
            print(
                f"[databento] {asset.key}: {window_start.date().isoformat()} -> {effective_end.date().isoformat()}",
                flush=True,
            )
            try:
                with databento_request(api_key, params) as response:
                    current_bucket: CandleBar | None = None
                    for raw_line in response:
                        line = raw_line.decode("utf-8", "replace").strip()
                        if not line or line.startswith("{\"symbol_mapping\""):
                            continue
                        item = json.loads(line)
                        raw_time = item.get("hd", {}).get("ts_event")
                        if raw_time is None:
                            continue
                        event_seconds = int(str(raw_time).strip()) // 1_000_000_000
                        bucket = floor_to_15m(event_seconds)
                        if bucket + 900 > closed_15m_cutoff():
                            continue
                        open_ = normalize_numeric(item["open"])
                        high = normalize_numeric(item["high"])
                        low = normalize_numeric(item["low"])
                        close = normalize_numeric(item["close"])
                        volume = float(item.get("volume", 0) or 0)
                        if current_bucket is None or current_bucket.time != bucket:
                            if current_bucket is not None:
                                bars_by_time[current_bucket.time] = current_bucket
                            current_bucket = CandleBar(bucket, open_, high, low, close, volume)
                            continue
                        current_bucket.high = max(current_bucket.high, high)
                        current_bucket.low = min(current_bucket.low, low)
                        current_bucket.close = close
                        current_bucket.volume += volume
                    if current_bucket is not None:
                        bars_by_time[current_bucket.time] = current_bucket
                break
            except HTTPError as exc:
                body = exc.read().decode("utf-8", "replace")
                available_end = parse_databento_available_end(body)
                if exc.code == 422 and available_end and available_end > window_start and available_end < effective_end:
                    effective_end = available_end
                    continue
                raise RuntimeError(f"Databento {exc.code} for {asset.key}: {body[:240]}") from exc
            except URLError as exc:
                raise RuntimeError(f"Databento request failed for {asset.key}: {exc}") from exc

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
            open_ = float(raw_bar["open"])
            high = float(raw_bar["high"])
            low = float(raw_bar["low"])
            close = float(raw_bar["close"])
            volume = float(raw_bar.get("volume", 0) or 0)
            bars_by_time[timestamp] = CandleBar(timestamp, open_, high, low, close, volume)

    return [bars_by_time[timestamp] for timestamp in sorted(bars_by_time)]


def fetch_asset(asset: AssetConfig, start: datetime, end: datetime) -> list[CandleBar]:
    if asset.market == "futures":
        return fetch_databento_15m(asset, start, end)
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
    parser = argparse.ArgumentParser(description="Download 15m candles from Databento and Twelve Data")
    parser.add_argument("--asset", action="append", help="Asset key to import. Repeat to import multiple assets.")
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
    import_start = parse_start_date(args.start_date)
    import_end = parse_end_date(args.end_date)
    if import_end <= import_start:
        raise ValueError("end-date must be greater than start-date")

    targets = selected_assets(assets, args.asset)
    print(f"Importing {len(targets)} asset(s) from {import_start.date().isoformat()} to {import_end.date().isoformat()}", flush=True)

    for asset in targets:
        print(f"Starting {asset.key} ({asset.name})", flush=True)
        bars = fetch_asset(asset, import_start, import_end)
        if not bars:
            raise RuntimeError(f"No 15m candles were returned for {asset.key}")
        write_candles(asset, bars)
        print(f"Wrote {len(bars)} 15m candles to data/15m/{asset.data_file}", flush=True)

    if args.prepare_data:
        print("Rebuilding derived timeframes from data/15m", flush=True)
        prepare_data()


if __name__ == "__main__":
    main()
