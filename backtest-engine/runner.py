from __future__ import annotations

import argparse
import csv
import json
import math
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from time import perf_counter
from typing import Any, Iterable
from zoneinfo import ZoneInfo

import numpy as np
import polars as pl
from numba import njit


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = PROJECT_ROOT / "config" / "assets.json"
DATA_ROOT = PROJECT_ROOT / "data"
STRATEGY_ROOT = PROJECT_ROOT / "strategy"
NEW_YORK = ZoneInfo("America/New_York")
PACIFIC_TZ = ZoneInfo("America/Los_Angeles")
BACKTEST_START_TS = int(datetime(2022, 1, 1, tzinfo=timezone.utc).timestamp())

TIMEFRAME_EVERY = {
    "5m": "5m",
    "10m": "10m",
    "15m": "15m",
    "30m": "30m",
    "45m": "45m",
    "1h": "1h",
    "4h": "4h",
    "1d": "1d",
    "1w": "1w",
}
TIMEFRAME_SECONDS = {
    "1m": 60,
    "5m": 5 * 60,
    "10m": 10 * 60,
    "15m": 15 * 60,
    "30m": 30 * 60,
    "45m": 45 * 60,
    "1h": 60 * 60,
    "4h": 4 * 60 * 60,
    "1d": 24 * 60 * 60,
    "1w": 7 * 24 * 60 * 60,
}
TIMEFRAME_ORDER = ["1m", "5m", "10m", "15m", "30m", "45m", "1h", "4h", "1d", "1w"]
LOWER_TIMEFRAME_EXIT_PREFERENCE = ["1m"]
WEEKEND_CLOSED_MARKETS = {"forex", "futures", "gold_spot", "crypto"}

EXIT_REASON = {
    0: "tp",
    1: "sl",
    2: "tp_gap",
    3: "sl_gap",
    4: "max_bars",
    5: "end",
}

LEGACY_SOURCE_FILES = {
    "6A": "6a_databento_volume_front_15m.csv",
    "6B": "6b_databento_volume_front_15m.csv",
    "6C": "6c_databento_volume_front_15m.csv",
    "6E": "6e_databento_volume_front_15m.csv",
    "6J": "6j_databento_volume_front_15m.csv",
    "CL": "cl_databento_volume_front_15m.csv",
    "ES": "es_databento_volume_front_15m.csv",
    "GC": "gc_databento_volume_front_15m.csv",
    "HG": "hg_databento_volume_front_15m.csv",
    "NG": "ng_databento_volume_front_15m.csv",
    "NQ": "nq_databento_volume_front_15m.csv",
    "RTY": "rty_databento_volume_front_15m.csv",
    "SI": "si_databento_volume_front_15m.csv",
    "YM": "ym_databento_volume_front_15m.csv",
    "ZB": "zb_databento_volume_front_15m.csv",
    "ZN": "zn_databento_volume_front_15m.csv",
    "AUDUSD": "audusd_twelvedata_15m.csv",
    "EURUSD": "eurusd_twelvedata_15m.csv",
    "GBPUSD": "gbpusd_twelvedata_15m.csv",
    "NZDUSD": "nzdusd_twelvedata_15m.csv",
    "USDCAD": "usdcad_twelvedata_15m.csv",
    "USDCHF": "usdchf_twelvedata_15m.csv",
    "USDJPY": "usdjpy_twelvedata_15m.csv",
    "XAUUSD": "xauusd_oanda_15m.csv",
}


@dataclass(frozen=True)
class AssetConfig:
    key: str
    symbol: str
    name: str
    market: str
    data_file: str
    tick_size: float
    dollar_per_unit: float


def load_assets() -> list[AssetConfig]:
    payload = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    assets: list[AssetConfig] = []
    for key, raw in payload.items():
        assets.append(
            AssetConfig(
                key=key,
                symbol=raw["symbol"],
                name=raw["name"],
                market=raw["market"],
                data_file=raw["dataFile"],
                tick_size=float(raw["tickSize"]),
                dollar_per_unit=float(raw.get("dollarPerUnit", 1.0)),
            )
        )
    return assets


def load_asset_by_key() -> dict[str, AssetConfig]:
    return {asset.key: asset for asset in load_assets()}


def read_legacy_csv(csv_path: Path) -> pl.DataFrame:
    frame = pl.read_csv(
        csv_path,
        schema_overrides={
            "time": pl.Int64,
            "open": pl.Float64,
            "high": pl.Float64,
            "low": pl.Float64,
            "close": pl.Float64,
            "volume": pl.Float64,
        },
    )
    if "volume" not in frame.columns:
        frame = frame.with_columns(pl.lit(0.0).alias("volume"))
    return frame.select("time", "open", "high", "low", "close", "volume").sort("time")


def write_candle_csv(csv_path: Path, frame: pl.DataFrame) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    frame.select("time", "open", "high", "low", "close", "volume").write_csv(csv_path)


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


def filter_market_hours_frame(frame: pl.DataFrame, asset: AssetConfig) -> pl.DataFrame:
    if asset.market not in WEEKEND_CLOSED_MARKETS or frame.is_empty():
        return frame
    return frame.filter(
        pl.col("time").map_elements(lambda value: market_is_open_at(asset, int(value)), return_dtype=pl.Boolean)
    )


def resample_timeframe(frame: pl.DataFrame, every: str) -> pl.DataFrame:
    with_timestamp = frame.with_columns(pl.from_epoch("time", time_unit="s").alias("timestamp"))
    grouped = (
        with_timestamp.group_by_dynamic("timestamp", every=every, period=every, closed="left", label="left")
        .agg(
            pl.col("time").first().alias("time"),
            pl.col("open").first().alias("open"),
            pl.col("high").max().alias("high"),
            pl.col("low").min().alias("low"),
            pl.col("close").last().alias("close"),
            pl.col("volume").sum().fill_null(0).alias("volume"),
        )
        .drop_nulls(["time", "open", "high", "low", "close"])
        .sort("time")
    )
    return grouped


def source_csv_path(asset: AssetConfig, source_dir: Path) -> Path:
    clean_path = source_dir / asset.data_file
    if clean_path.exists():
        return clean_path

    legacy_name = LEGACY_SOURCE_FILES.get(asset.symbol)
    if legacy_name:
        legacy_path = source_dir / legacy_name
        if legacy_path.exists():
            return legacy_path

    raise FileNotFoundError(f"Missing source file for {asset.symbol} in {source_dir}")


def csv_time_from_line(line: str) -> int | None:
    raw_time = line.strip().split(",", 1)[0]
    if not raw_time or raw_time == "time":
        return None
    try:
        return int(float(raw_time))
    except ValueError:
        return None


def candle_csv_time_bounds(csv_path: Path) -> tuple[int, int] | None:
    if not csv_path.exists() or csv_path.stat().st_size <= 0:
        return None

    first: int | None = None
    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        for line in handle:
            first = csv_time_from_line(line)
            if first is not None:
                break

    last: int | None = None
    with csv_path.open("rb") as handle:
        handle.seek(0, 2)
        size = handle.tell()
        handle.seek(max(0, size - 65536))
        tail = handle.read().decode("utf-8", errors="ignore")
    for line in reversed(tail.strip().splitlines()):
        last = csv_time_from_line(line)
        if last is not None:
            break

    if first is None or last is None:
        return None
    return first, last


def best_prepare_source_dir(asset: AssetConfig, fallback_dirs: list[Path]) -> Path:
    one_minute_dir = DATA_ROOT / "1m"
    one_minute_bounds = candle_csv_time_bounds(one_minute_dir / asset.data_file)
    fallback_dir = next((candidate for candidate in fallback_dirs if (candidate / asset.data_file).exists()), fallback_dirs[-1])
    fallback_bounds = candle_csv_time_bounds(fallback_dir / asset.data_file)

    if one_minute_bounds is None:
        return fallback_dir
    if fallback_bounds is None:
        return one_minute_dir

    one_minute_first, one_minute_last = one_minute_bounds
    fallback_first, fallback_last = fallback_bounds
    covers_existing_start = one_minute_first <= fallback_first + 60
    covers_backtest_start = one_minute_first <= BACKTEST_START_TS + 3 * 24 * 60 * 60
    if one_minute_last >= fallback_last and (covers_existing_start or covers_backtest_start):
        return one_minute_dir
    return fallback_dir


def normalize_asset_filters(asset_filters: Iterable[str] | None) -> set[str]:
    if not asset_filters:
        return set()
    return {
        item.strip()
        for raw_filter in asset_filters
        for item in raw_filter.split(",")
        if item.strip()
    }


def select_assets_for_prepare(assets: list[AssetConfig], asset_filters: Iterable[str] | None) -> list[AssetConfig]:
    requested = normalize_asset_filters(asset_filters)
    if not requested:
        return assets

    selected = [asset for asset in assets if asset.key in requested or asset.symbol in requested or asset.data_file in requested]
    matched = {asset.key for asset in selected} | {asset.symbol for asset in selected} | {asset.data_file for asset in selected}
    missing = sorted(requested - matched)
    if missing:
        raise ValueError(f"No configured asset matched prepare-data filter(s): {', '.join(missing)}")
    return selected


def prepare_data(source_dir: Path | None = None, asset_filters: Iterable[str] | None = None) -> None:
    assets = load_assets()
    selected_assets = select_assets_for_prepare(assets, asset_filters)
    five_minute_dir = DATA_ROOT / "5m"
    fifteen_minute_dir = DATA_ROOT / "15m"
    five_minute_dir.mkdir(parents=True, exist_ok=True)
    fifteen_minute_dir.mkdir(parents=True, exist_ok=True)
    resolved_source_dir = source_dir.resolve() if source_dir else None

    for asset in selected_assets:
        asset_source_dir = resolved_source_dir
        if asset_source_dir is None:
            asset_source_dir = best_prepare_source_dir(asset, [five_minute_dir, fifteen_minute_dir])
        source_timeframe = asset_source_dir.name if asset_source_dir.name in {"1m", "5m", "15m"} else "15m"
        source_path = source_csv_path(asset, asset_source_dir)
        base_frame = filter_market_hours_frame(read_legacy_csv(source_path), asset)
        write_candle_csv(DATA_ROOT / source_timeframe / asset.data_file, base_frame)

        for timeframe, every in TIMEFRAME_EVERY.items():
            timeframe_dir = DATA_ROOT / timeframe
            timeframe_dir.mkdir(parents=True, exist_ok=True)
            if timeframe == source_timeframe:
                write_candle_csv(timeframe_dir / asset.data_file, base_frame)
                continue
            if source_timeframe == "15m" and timeframe in {"5m", "10m"}:
                continue
            write_candle_csv(timeframe_dir / asset.data_file, resample_timeframe(base_frame, every))

        print(f"Prepared candles for {asset.name}")


@njit(cache=True)
def round_to_tick(value: float, tick_size: float) -> float:
    return np.round(value / tick_size) * tick_size


@njit(cache=True)
def ema(values: np.ndarray, span: int) -> np.ndarray:
    output = np.empty(values.shape[0], dtype=np.float64)
    alpha = 2.0 / (span + 1.0)
    current = values[0]
    output[0] = current
    for index in range(1, values.shape[0]):
        current = alpha * values[index] + (1.0 - alpha) * current
        output[index] = current
    return output


@njit(cache=True)
def rma(values: np.ndarray, length: int) -> np.ndarray:
    output = np.empty(values.shape[0], dtype=np.float64)
    output[:] = np.nan
    if values.shape[0] < length:
        return output

    seed = 0.0
    for index in range(length):
        seed += values[index]
    current = seed / length
    output[length - 1] = current

    for index in range(length, values.shape[0]):
        current = ((current * (length - 1)) + values[index]) / length
        output[index] = current
    return output


@njit(cache=True)
def build_true_range(high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
    output = np.empty(close.shape[0], dtype=np.float64)
    output[0] = high[0] - low[0]
    for index in range(1, close.shape[0]):
        output[index] = max(high[index] - low[index], abs(high[index] - close[index - 1]), abs(low[index] - close[index - 1]))
    return output


@njit(cache=True)
def build_move_signals(close: np.ndarray, atr100: np.ndarray, multiplier: float) -> tuple[np.ndarray, np.ndarray]:
    up = np.zeros(close.shape[0], dtype=np.bool_)
    down = np.zeros(close.shape[0], dtype=np.bool_)
    for index in range(5, close.shape[0]):
        atr = atr100[index]
        if np.isnan(atr):
            continue
        up[index] = close[index] > close[index - 5] + atr * multiplier
        down[index] = close[index] < close[index - 5] - atr * multiplier
    return up, down


@njit(cache=True)
def no_recent_signal(signals: np.ndarray, index: int, lookback: int) -> bool:
    start = 0
    if index - lookback > 0:
        start = index - lookback
    for cursor in range(start, index):
        if signals[cursor]:
            return False
    return True


@njit(cache=True)
def run_momentum_backtest(
    times: np.ndarray,
    ny_days: np.ndarray,
    open_: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    tick_size: float,
    signal_mult: float,
    lookback: int,
    abs_limit: float,
    tp_units: float,
    sl_units: float,
    start_ts: int,
    max_bars: int,
) -> tuple[np.ndarray, np.ndarray]:
    ema30 = ema(close, 30)
    ema200 = ema(close, 200)
    atr100 = rma(build_true_range(high, low, close), 100)
    close_ema200_atr = np.empty(close.shape[0], dtype=np.float64)
    close_ema200_atr[:] = np.nan
    for index in range(close.shape[0]):
        if np.isnan(atr100[index]) or atr100[index] == 0.0:
            continue
        close_ema200_atr[index] = (close[index] - ema200[index]) / atr100[index]

    up_signal, down_signal = build_move_signals(close, atr100, signal_mult)
    trade_rows = np.full((close.shape[0], 15), np.nan, dtype=np.float64)
    trade_reasons = np.full(close.shape[0], -1, dtype=np.int64)
    trade_count = 0

    has_open_trade = False
    side = 0
    signal_time = 0.0
    entry_index = -1
    entry_price = 0.0
    take_profit = 0.0
    stop_loss = 0.0
    max_exit_index = 0
    last_entry_day = -1

    start_index = 260
    if start_index >= close.shape[0]:
        return trade_rows[:0], trade_reasons[:0]

    for index in range(start_index, close.shape[0]):
        if has_open_trade:
            exit_price = np.nan
            exit_reason = -1

            if index > entry_index:
                if side == 1 and open_[index] <= stop_loss:
                    exit_price = stop_loss
                    exit_reason = 3
                elif side == -1 and open_[index] >= stop_loss:
                    exit_price = stop_loss
                    exit_reason = 3
                elif side == 1 and open_[index] >= take_profit:
                    exit_price = take_profit
                    exit_reason = 2
                elif side == -1 and open_[index] <= take_profit:
                    exit_price = take_profit
                    exit_reason = 2

            if np.isnan(exit_price):
                stop_hit = low[index] <= stop_loss if side == 1 else high[index] >= stop_loss
                tp_hit = high[index] >= take_profit if side == 1 else low[index] <= take_profit
                if stop_hit:
                    exit_price = stop_loss
                    exit_reason = 1
                elif tp_hit:
                    exit_price = take_profit
                    exit_reason = 0
                elif index >= max_exit_index:
                    exit_price = close[index]
                    exit_reason = 4

            if not np.isnan(exit_price):
                net_units = ((exit_price - entry_price) * side) / tick_size
                trade_rows[trade_count, 0] = side
                trade_rows[trade_count, 1] = signal_time
                trade_rows[trade_count, 2] = entry_index
                trade_rows[trade_count, 3] = index
                trade_rows[trade_count, 4] = times[entry_index]
                trade_rows[trade_count, 5] = times[index]
                trade_rows[trade_count, 6] = entry_price
                trade_rows[trade_count, 7] = exit_price
                trade_rows[trade_count, 8] = net_units
                trade_rows[trade_count, 9] = net_units / sl_units if sl_units else 0.0
                trade_rows[trade_count, 10] = tp_units
                trade_rows[trade_count, 11] = sl_units
                trade_rows[trade_count, 12] = 0.0
                trade_rows[trade_count, 13] = index - entry_index + 1
                trade_rows[trade_count, 14] = times[index]
                trade_reasons[trade_count] = exit_reason
                trade_count += 1
                has_open_trade = False

        if has_open_trade or index >= close.shape[0] - 1:
            continue

        if times[index + 1] < start_ts:
            continue
        if ny_days[index + 1] == last_entry_day:
            continue
        if np.isnan(atr100[index]) or np.isnan(close_ema200_atr[index]):
            continue
        if abs(close_ema200_atr[index]) > abs_limit:
            continue

        next_side = 0
        if ema30[index] > ema200[index] and down_signal[index] and no_recent_signal(down_signal, index, lookback):
            next_side = 1
        elif ema30[index] < ema200[index] and up_signal[index] and no_recent_signal(up_signal, index, lookback):
            next_side = -1

        if next_side == 0:
            continue

        has_open_trade = True
        side = next_side
        signal_time = times[index]
        entry_index = index + 1
        entry_price = round_to_tick(open_[entry_index], tick_size)
        take_profit = round_to_tick(entry_price + side * tp_units * tick_size, tick_size)
        stop_loss = round_to_tick(entry_price - side * sl_units * tick_size, tick_size)
        max_exit_index = min(close.shape[0] - 1, entry_index + max_bars - 1)
        last_entry_day = ny_days[entry_index]
    if has_open_trade:
        final_index = close.shape[0] - 1
        net_units = ((close[final_index] - entry_price) * side) / tick_size
        trade_rows[trade_count, 0] = side
        trade_rows[trade_count, 1] = signal_time
        trade_rows[trade_count, 2] = entry_index
        trade_rows[trade_count, 3] = final_index
        trade_rows[trade_count, 4] = times[entry_index]
        trade_rows[trade_count, 5] = times[final_index]
        trade_rows[trade_count, 6] = entry_price
        trade_rows[trade_count, 7] = close[final_index]
        trade_rows[trade_count, 8] = net_units
        trade_rows[trade_count, 9] = net_units / sl_units if sl_units else 0.0
        trade_rows[trade_count, 10] = tp_units
        trade_rows[trade_count, 11] = sl_units
        trade_rows[trade_count, 12] = 0.0
        trade_rows[trade_count, 13] = final_index - entry_index + 1
        trade_rows[trade_count, 14] = times[final_index]
        trade_reasons[trade_count] = 5
        trade_count += 1

    return trade_rows[:trade_count], trade_reasons[:trade_count]


def load_candle_csv(csv_path: Path) -> pl.DataFrame:
    frame = pl.read_csv(
        csv_path,
        schema_overrides={
            "time": pl.Int64,
            "open": pl.Float64,
            "high": pl.Float64,
            "low": pl.Float64,
            "close": pl.Float64,
            "volume": pl.Float64,
        },
    )
    if "volume" not in frame.columns:
        frame = frame.with_columns(pl.lit(0.0).alias("volume"))
    return frame.sort("time")


def new_york_day_ids(timestamps: Iterable[int]) -> np.ndarray:
    return np.asarray(
        [datetime.fromtimestamp(int(timestamp), tz=timezone.utc).astimezone(NEW_YORK).date().toordinal() for timestamp in timestamps],
        dtype=np.int64,
    )


def write_backtest_csv(csv_path: Path, asset: AssetConfig, trades: np.ndarray, reasons: np.ndarray) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "strategy_id",
                "asset_key",
                "asset_name",
                "market",
                "symbol",
                "phase",
                "side",
                "signal_time",
                "entry_index",
                "exit_index",
                "entry_time",
                "exit_time",
                "entry_price",
                "exit_price",
                "net_units",
                "r_multiple",
                "tp_units",
                "sl_units",
                "cost_units",
                "exit_reason",
                "bars_held",
                "source",
            ]
        )
        for row, reason in zip(trades, reasons, strict=True):
            writer.writerow(
                [
                    "us_treasury_10y_note_futures_momentum",
                    asset.key,
                    asset.name,
                    asset.market,
                    asset.symbol,
                    "momentum",
                    "long" if int(row[0]) == 1 else "short",
                    datetime.fromtimestamp(int(row[1]), tz=timezone.utc).isoformat().replace("+00:00", "Z"),
                    int(row[2]),
                    int(row[3]),
                    datetime.fromtimestamp(int(row[4]), tz=timezone.utc).isoformat().replace("+00:00", "Z"),
                    datetime.fromtimestamp(int(row[5]), tz=timezone.utc).isoformat().replace("+00:00", "Z"),
                    f"{row[6]:.10f}".rstrip("0").rstrip("."),
                    f"{row[7]:.10f}".rstrip("0").rstrip("."),
                    f"{row[8]:.10f}".rstrip("0").rstrip("."),
                    f"{row[9]:.10f}".rstrip("0").rstrip("."),
                    f"{row[10]:.10f}".rstrip("0").rstrip("."),
                    f"{row[11]:.10f}".rstrip("0").rstrip("."),
                    f"{row[12]:.10f}".rstrip("0").rstrip("."),
                    EXIT_REASON[int(reason)],
                    int(row[13]),
                    "python_numba_backtest",
                ]
            )


@dataclass(frozen=True)
class EchoModel:
    kind: str
    threshold: float
    feature_names: tuple[str, ...]
    feature_means: tuple[float, ...]
    feature_scales: tuple[float, ...]
    hidden_weights: tuple[tuple[float, ...], ...]
    hidden_bias: tuple[float, ...]
    output_weights: tuple[float, ...]
    output_bias: float


@dataclass(frozen=True)
class BacktestStrategy:
    id: str
    label: str
    folder: str
    asset_key: str
    phase: str
    variant_id: str
    source: str
    signal_atr_mult: float | None = None
    recent_signal_lookback: int | None = None
    abs_close_ema200_atr_max: float | None = None
    trade_rsi_min: float | None = None
    trade_rsi_max: float | None = None
    ict_risk_reward: float | None = None
    tp_units: float | None = None
    sl_units: float | None = None
    size_multiplier: float | None = None
    stop_loss_policy: "StopLossPolicy | None" = None
    take_profit_policy: "TakeProfitPolicy | None" = None
    size_policy: "SizePolicy | None" = None
    dynamic_stop_loss_policy: "DynamicStopLossPolicy | None" = None
    dynamic_take_profit_policy: "DynamicTakeProfitPolicy | None" = None
    echo_model: EchoModel | None = None
    one_trade_per_day: bool = False
    cost_units: float = 0.0
    invert_signal: bool = False
    metadata_path: Path | None = None


@dataclass(frozen=True)
class RuntimeConfig:
    session: str = "ny"
    range_minutes: int = 15
    entry_minutes: int = 150
    rr: float = 1.5
    sl_atr: float = 1.0
    tp_atr: float = 1.5
    threshold: float = 0.05
    adx_max: float | None = None
    adx_min: float | None = None
    rsi2_max: float | None = None
    trend: str = "all"
    max_bars: int = 24
    one_trade_per_day: bool = True


@dataclass(frozen=True)
class StopLossPolicy:
    mode: str
    buffer_units: float = 0.0


@dataclass(frozen=True)
class TakeProfitPolicy:
    mode: str
    buffer_units: float = 0.0
    reward_multiple: float | None = None


@dataclass(frozen=True)
class SizePolicy:
    mode: str
    min_multiplier: float
    max_multiplier: float
    min_confidence: float = 0.5
    max_confidence: float = 0.8


@dataclass(frozen=True)
class DynamicStopLossPolicy:
    mode: str
    buffer_units: float = 0.0
    trigger_multiple: float = 1.0
    lock_multiple: float = 0.0


@dataclass(frozen=True)
class DynamicTakeProfitPolicy:
    mode: str
    buffer_units: float = 0.0
    reward_multiple: float | None = None


@dataclass(frozen=True)
class TimeframeData:
    times: np.ndarray
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    ema20: np.ndarray
    ema21: np.ndarray
    ema50: np.ndarray
    ema200: np.ndarray
    atr14: np.ndarray
    pivot_high_1: np.ndarray
    pivot_low_1: np.ndarray
    pivot_high_2: np.ndarray
    pivot_low_2: np.ndarray


@dataclass(frozen=True)
class EnrichedData:
    times: np.ndarray
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    ny_dates: list[str]
    ny_days: np.ndarray
    ny_minutes: np.ndarray
    ny_weekdays: np.ndarray
    day_bounds: dict[str, tuple[int, int]]
    prior_day_high: np.ndarray
    prior_day_low: np.ndarray
    ema9: np.ndarray
    ema21: np.ndarray
    ema30: np.ndarray
    ema34: np.ndarray
    ema50: np.ndarray
    ema200: np.ndarray
    atr14: np.ndarray
    atr100: np.ndarray
    session_vwap: np.ndarray
    rsi2: np.ndarray
    rsi14_centered: np.ndarray
    bb_z20: np.ndarray
    close_location: np.ndarray
    ret3_atr: np.ndarray
    body_atr: np.ndarray
    close_ema200_atr: np.ndarray
    hourly: TimeframeData | None
    daily: TimeframeData | None


@dataclass
class PendingOrder:
    side: int
    signal_time: int
    created_index: int
    active_index: int
    expires_index: int
    entry_price: float
    take_profit: float
    stop_loss: float
    tp_units: float
    sl_units: float
    tp_mode: str
    sl_mode: str
    size_mode: str
    size_multiplier: float


@dataclass
class OpenTrade:
    side: int
    signal_time: int
    entry_index: int
    entry_price: float
    initial_take_profit: float
    initial_stop_loss: float
    initial_tp_units: float
    initial_sl_units: float
    take_profit: float
    stop_loss: float
    tp_units: float
    sl_units: float
    tp_mode: str
    sl_mode: str
    size_mode: str
    size_multiplier: float
    max_exit_index: int
    forced_exit_minute: int | None = None
    forced_exit_day_offset: int = 0
    forced_exit_reason: str = "time_exit"
    management_events: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class BacktestTradeRow:
    strategy_id: str
    asset_key: str
    asset_name: str
    market: str
    symbol: str
    phase: str
    variant_id: str
    side: int
    signal_time: int
    entry_index: int
    exit_index: int
    entry_time: int
    exit_time: int
    entry_price: float
    exit_price: float
    net_units: float
    r_multiple: float
    tp_units: float
    sl_units: float
    cost_units: float
    exit_reason: str
    bars_held: int
    source: str
    tp_mode: str
    sl_mode: str
    size_mode: str
    size_multiplier: float
    execution_timeframe: str = ""
    management_events: tuple[dict[str, Any], ...] = ()


STRATEGY_METADATA_FILES = (
    Path("machine_learning") / "selection.json",
    Path("bayes") / "selection.json",
    Path("parameters") / "backtest.json",
)

ALLOWED_METADATA_KEYS = {
    "strategyId",
    "label",
    "folder",
    "assetKey",
    "phase",
    "variantId",
    "source",
    "signalAtrMult",
    "recentSignalLookback",
    "absCloseEma200AtrMax",
    "tradeRsiMin",
    "tradeRsiMax",
    "ictRiskReward",
    "tpUnits",
    "slUnits",
    "sizeMultiplier",
    "stopLossPolicy",
    "takeProfitPolicy",
    "sizePolicy",
    "dynamicStopLossPolicy",
    "dynamicTakeProfitPolicy",
    "echoModel",
    "oneTradePerDay",
    "costUnits",
    "invertSignal",
    # Optional research/provenance fields are allowed so generators can attach
    # audit context without breaking the executable backtest contract.
    "sourceUrls",
    "researchSummary",
    "crossMarketSourceStrategyId",
    "crossMarketBestProfitFactor",
    "crossMarketBestTrades",
    "crossMarketBestTotalR",
    "trader",
    "playbook",
    "selectionMethod",
    "trainingWindow",
    "forwardWindow",
    "selectedTrainingProfitFactor",
    "selectedTrainingTrades",
    "selectedForwardProfitFactor",
    "selectedForwardTrades",
    "minimumRiskReward",
    "selectedRiskReward",
    "forwardWins",
    "forwardLosses",
    "forwardTotalR",
    "forwardAverageR",
    "forwardMaxDrawdownR",
    "recoveredFrom",
    "recoveredTrader",
    "recoveredPlaybook",
    "recoveredSummaryPhase",
    "recoveredForwardProfitFactor",
    "recoveredForwardTrades",
    "recoveredForwardTotalR",
    "recoveredForwardMaxDrawdownR",
    "verificationSummary",
}

STOP_LOSS_POLICY_MODES = {"signal_extreme", "prior_day_extreme"}
TAKE_PROFIT_POLICY_MODES = {"risk_multiple", "signal_extreme", "prior_day_extreme"}
SIZE_POLICY_MODES = {"confidence"}
DYNAMIC_STOP_LOSS_POLICY_MODES = {"breakeven", "trail_prior_bar", "trail_hourly_pivot"}
DYNAMIC_TAKE_PROFIT_POLICY_MODES = {"trail_prior_bar", "risk_multiple", "trail_hourly_extreme"}
ENTRY_MODES = {"market", "limit"}
PRICE_MODE_FIXED = "fixed"
PRICE_MODE_CUSTOM = "custom"
SIZE_MODE_AUTO = "auto"
SIZE_MODE_CUSTOM = "custom"
ECHO_MODEL_FEATURE_NAMES = (
    "trend_ema30_ema200_atr100",
    "close_ema200_atr",
    "ret5_atr100",
    "ret3_atr14",
    "body_atr14",
    "rsi14_centered",
    "rsi2_centered",
    "bb_z20",
    "close_location",
    "vwap_distance_atr14",
    "ny_minute",
    "ny_weekday",
)


def required_text(payload: dict[str, Any], key: str, metadata_path: Path) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"Missing {key} in {metadata_path}")
    return value


def optional_payload_float(payload: dict[str, Any], key: str) -> float | None:
    value = payload.get(key)
    if value is None:
        return None
    parsed = float(value)
    return parsed if math.isfinite(parsed) else None


def optional_payload_int(payload: dict[str, Any], key: str) -> int | None:
    value = optional_payload_float(payload, key)
    return int(value) if value is not None else None


def validate_metadata_keys(payload: dict[str, Any], metadata_path: Path) -> None:
    unknown = sorted(key for key in payload.keys() if key not in ALLOWED_METADATA_KEYS)
    if unknown:
        raise ValueError(f"Unsupported keys in {metadata_path}: {', '.join(unknown)}")


def optional_payload_object(payload: dict[str, Any], key: str, metadata_path: Path) -> dict[str, Any] | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError(f"Expected {key} to be an object in {metadata_path}")
    return value


def optional_object_float(payload: dict[str, Any], key: str, metadata_path: Path) -> float | None:
    value = payload.get(key)
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Expected {key} to be numeric in {metadata_path}") from exc
    return parsed if math.isfinite(parsed) else None


def required_object_text(payload: dict[str, Any], key: str, metadata_path: Path) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"Missing {key} in {metadata_path}")
    return value


def parse_stop_loss_policy(payload: dict[str, Any], metadata_path: Path) -> StopLossPolicy | None:
    policy = optional_payload_object(payload, "stopLossPolicy", metadata_path)
    if policy is None:
        return None
    mode = required_object_text(policy, "mode", metadata_path)
    if mode not in STOP_LOSS_POLICY_MODES:
        raise ValueError(f"Unsupported stopLossPolicy.mode '{mode}' in {metadata_path}")
    buffer_units = optional_object_float(policy, "bufferUnits", metadata_path) or 0.0
    return StopLossPolicy(mode=mode, buffer_units=buffer_units)


def parse_take_profit_policy(payload: dict[str, Any], metadata_path: Path) -> TakeProfitPolicy | None:
    policy = optional_payload_object(payload, "takeProfitPolicy", metadata_path)
    if policy is None:
        return None
    mode = required_object_text(policy, "mode", metadata_path)
    if mode not in TAKE_PROFIT_POLICY_MODES:
        raise ValueError(f"Unsupported takeProfitPolicy.mode '{mode}' in {metadata_path}")
    buffer_units = optional_object_float(policy, "bufferUnits", metadata_path) or 0.0
    reward_multiple = optional_object_float(policy, "rewardMultiple", metadata_path)
    if mode == "risk_multiple" and (reward_multiple is None or reward_multiple <= 0):
        raise ValueError(f"takeProfitPolicy.rewardMultiple must be > 0 in {metadata_path}")
    return TakeProfitPolicy(mode=mode, buffer_units=buffer_units, reward_multiple=reward_multiple)


def parse_size_policy(payload: dict[str, Any], metadata_path: Path) -> SizePolicy | None:
    policy = optional_payload_object(payload, "sizePolicy", metadata_path)
    if policy is None:
        return None
    mode = required_object_text(policy, "mode", metadata_path)
    if mode not in SIZE_POLICY_MODES:
        raise ValueError(f"Unsupported sizePolicy.mode '{mode}' in {metadata_path}")
    min_multiplier = optional_object_float(policy, "minMultiplier", metadata_path)
    max_multiplier = optional_object_float(policy, "maxMultiplier", metadata_path)
    if min_multiplier is None or max_multiplier is None or min_multiplier <= 0 or max_multiplier <= 0:
        raise ValueError(f"sizePolicy minMultiplier/maxMultiplier must be > 0 in {metadata_path}")
    if min_multiplier > max_multiplier:
        raise ValueError(f"sizePolicy minMultiplier cannot exceed maxMultiplier in {metadata_path}")
    min_confidence = optional_object_float(policy, "minConfidence", metadata_path)
    max_confidence = optional_object_float(policy, "maxConfidence", metadata_path)
    if min_confidence is None:
        min_confidence = 0.5
    if max_confidence is None:
        max_confidence = 0.8
    if min_confidence < 0 or max_confidence > 1 or min_confidence >= max_confidence:
        raise ValueError(f"sizePolicy confidence range must satisfy 0 <= min < max <= 1 in {metadata_path}")
    return SizePolicy(
        mode=mode,
        min_multiplier=min_multiplier,
        max_multiplier=max_multiplier,
        min_confidence=min_confidence,
        max_confidence=max_confidence,
    )


def parse_dynamic_stop_loss_policy(payload: dict[str, Any], metadata_path: Path) -> DynamicStopLossPolicy | None:
    policy = optional_payload_object(payload, "dynamicStopLossPolicy", metadata_path)
    if policy is None:
        return None
    mode = required_object_text(policy, "mode", metadata_path)
    if mode not in DYNAMIC_STOP_LOSS_POLICY_MODES:
        raise ValueError(f"Unsupported dynamicStopLossPolicy.mode '{mode}' in {metadata_path}")
    buffer_units = optional_object_float(policy, "bufferUnits", metadata_path) or 0.0
    trigger_multiple = optional_object_float(policy, "triggerMultiple", metadata_path)
    lock_multiple = optional_object_float(policy, "lockMultiple", metadata_path)
    trigger_multiple = 1.0 if trigger_multiple is None else trigger_multiple
    lock_multiple = 0.0 if lock_multiple is None else lock_multiple
    if trigger_multiple <= 0:
        raise ValueError(f"dynamicStopLossPolicy.triggerMultiple must be > 0 in {metadata_path}")
    if lock_multiple < 0 or lock_multiple >= trigger_multiple:
        raise ValueError(
            f"dynamicStopLossPolicy.lockMultiple must satisfy 0 <= lockMultiple < triggerMultiple in {metadata_path}"
        )
    return DynamicStopLossPolicy(
        mode=mode,
        buffer_units=buffer_units,
        trigger_multiple=trigger_multiple,
        lock_multiple=lock_multiple,
    )


def parse_dynamic_take_profit_policy(payload: dict[str, Any], metadata_path: Path) -> DynamicTakeProfitPolicy | None:
    policy = optional_payload_object(payload, "dynamicTakeProfitPolicy", metadata_path)
    if policy is None:
        return None
    mode = required_object_text(policy, "mode", metadata_path)
    if mode not in DYNAMIC_TAKE_PROFIT_POLICY_MODES:
        raise ValueError(f"Unsupported dynamicTakeProfitPolicy.mode '{mode}' in {metadata_path}")
    buffer_units = optional_object_float(policy, "bufferUnits", metadata_path) or 0.0
    reward_multiple = optional_object_float(policy, "rewardMultiple", metadata_path)
    if mode == "risk_multiple" and (reward_multiple is None or reward_multiple <= 0):
        raise ValueError(f"dynamicTakeProfitPolicy.rewardMultiple must be > 0 in {metadata_path}")
    return DynamicTakeProfitPolicy(mode=mode, buffer_units=buffer_units, reward_multiple=reward_multiple)


def required_float_list(payload: dict[str, Any], key: str, metadata_path: Path) -> tuple[float, ...]:
    value = payload.get(key)
    if not isinstance(value, list) or not value:
        raise ValueError(f"Expected {key} to be a non-empty numeric array in {metadata_path}")
    output: list[float] = []
    for item in value:
        try:
            parsed = float(item)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Expected {key} to contain only numbers in {metadata_path}") from exc
        if not math.isfinite(parsed):
            raise ValueError(f"Expected {key} to contain only finite numbers in {metadata_path}")
        output.append(parsed)
    return tuple(output)


def required_float_matrix(payload: dict[str, Any], key: str, metadata_path: Path) -> tuple[tuple[float, ...], ...]:
    value = payload.get(key)
    if not isinstance(value, list) or not value:
        raise ValueError(f"Expected {key} to be a non-empty numeric matrix in {metadata_path}")
    rows: list[tuple[float, ...]] = []
    for row in value:
        if not isinstance(row, list) or not row:
            raise ValueError(f"Expected each {key} row to be a non-empty numeric array in {metadata_path}")
        rows.append(tuple(required_float_list({"row": row}, "row", metadata_path)))
    return tuple(rows)


def parse_echo_model(payload: dict[str, Any], metadata_path: Path) -> EchoModel | None:
    model = optional_payload_object(payload, "echoModel", metadata_path)
    if model is None:
        return None
    kind = required_object_text(model, "kind", metadata_path)
    if kind != "neural":
        raise ValueError(f"Unsupported echoModel.kind '{kind}' in {metadata_path}")
    threshold = optional_object_float(model, "threshold", metadata_path)
    if threshold is None or threshold < 0 or threshold > 1:
        raise ValueError(f"echoModel.threshold must be between 0 and 1 in {metadata_path}")

    raw_names = model.get("featureNames")
    if raw_names is None:
        feature_names = ECHO_MODEL_FEATURE_NAMES
    elif isinstance(raw_names, list) and all(isinstance(item, str) and item for item in raw_names):
        feature_names = tuple(raw_names)
    else:
        raise ValueError(f"echoModel.featureNames must be an array of strings in {metadata_path}")

    feature_means = required_float_list(model, "featureMeans", metadata_path)
    feature_scales = required_float_list(model, "featureScales", metadata_path)
    hidden_weights = required_float_matrix(model, "hiddenWeights", metadata_path)
    hidden_bias = required_float_list(model, "hiddenBias", metadata_path)
    output_weights = required_float_list(model, "outputWeights", metadata_path)
    output_bias = optional_object_float(model, "outputBias", metadata_path)
    if output_bias is None:
        raise ValueError(f"echoModel.outputBias must be numeric in {metadata_path}")

    feature_count = len(ECHO_MODEL_FEATURE_NAMES)
    if feature_names != ECHO_MODEL_FEATURE_NAMES:
        raise ValueError(f"echoModel.featureNames must match the shared Echo feature order in {metadata_path}")
    if len(feature_means) != feature_count or len(feature_scales) != feature_count:
        raise ValueError(f"echoModel feature mean/scale lengths must be {feature_count} in {metadata_path}")
    if any(scale <= 0 for scale in feature_scales):
        raise ValueError(f"echoModel.featureScales must be positive in {metadata_path}")
    if len(hidden_weights) != len(hidden_bias) or len(output_weights) != len(hidden_weights):
        raise ValueError(f"echoModel hidden/output dimensions do not align in {metadata_path}")
    if any(len(row) != feature_count for row in hidden_weights):
        raise ValueError(f"Each echoModel.hiddenWeights row must have {feature_count} entries in {metadata_path}")

    return EchoModel(
        kind=kind,
        threshold=threshold,
        feature_names=feature_names,
        feature_means=feature_means,
        feature_scales=feature_scales,
        hidden_weights=hidden_weights,
        hidden_bias=hidden_bias,
        output_weights=output_weights,
        output_bias=output_bias,
    )


def strategy_from_metadata(metadata_path: Path) -> BacktestStrategy:
    payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    validate_metadata_keys(payload, metadata_path)
    strategy_id = required_text(payload, "strategyId", metadata_path)
    variant_id = payload.get("variantId")
    if not isinstance(variant_id, str) or not variant_id:
        variant_id = strategy_id
    return BacktestStrategy(
        id=strategy_id,
        label=required_text(payload, "label", metadata_path),
        folder=required_text(payload, "folder", metadata_path),
        asset_key=required_text(payload, "assetKey", metadata_path),
        phase=required_text(payload, "phase", metadata_path),
        variant_id=variant_id,
        source=required_text(payload, "source", metadata_path),
        signal_atr_mult=optional_payload_float(payload, "signalAtrMult"),
        recent_signal_lookback=optional_payload_int(payload, "recentSignalLookback"),
        abs_close_ema200_atr_max=optional_payload_float(payload, "absCloseEma200AtrMax"),
        trade_rsi_min=optional_payload_float(payload, "tradeRsiMin"),
        trade_rsi_max=optional_payload_float(payload, "tradeRsiMax"),
        ict_risk_reward=optional_payload_float(payload, "ictRiskReward"),
        tp_units=optional_payload_float(payload, "tpUnits"),
        sl_units=optional_payload_float(payload, "slUnits"),
        size_multiplier=optional_payload_float(payload, "sizeMultiplier"),
        stop_loss_policy=parse_stop_loss_policy(payload, metadata_path),
        take_profit_policy=parse_take_profit_policy(payload, metadata_path),
        size_policy=parse_size_policy(payload, metadata_path),
        dynamic_stop_loss_policy=parse_dynamic_stop_loss_policy(payload, metadata_path),
        dynamic_take_profit_policy=parse_dynamic_take_profit_policy(payload, metadata_path),
        echo_model=parse_echo_model(payload, metadata_path),
        one_trade_per_day=bool(payload.get("oneTradePerDay", False)),
        cost_units=optional_payload_float(payload, "costUnits") if "costUnits" in payload else 0.0,
        invert_signal=bool(payload.get("invertSignal", False)),
        metadata_path=metadata_path,
    )


def load_backtest_strategies() -> list[BacktestStrategy]:
    strategies: list[BacktestStrategy] = []
    for strategy_dir in sorted(path for path in STRATEGY_ROOT.iterdir() if path.is_dir()):
        metadata_path = next((strategy_dir / relative for relative in STRATEGY_METADATA_FILES if (strategy_dir / relative).exists()), None)
        if metadata_path is None:
            continue
        try:
            strategies.append(strategy_from_metadata(metadata_path))
        except Exception as exc:
            print(f"Skipped {strategy_dir.name}: {exc}")
    if not strategies:
        raise FileNotFoundError("No strategy metadata files found under strategy/*/{machine_learning,bayes,parameters}")
    return strategies


SESSION_OPEN_MINUTES = {
    "asia": 18 * 60,
    "london": 3 * 60,
    "pre_ny": 8 * 60 + 30,
    "ny": 9 * 60 + 30,
}


def optional_float(value: str | None) -> float | None:
    if not value or value == "none":
        return None
    parsed = float(value)
    return parsed if math.isfinite(parsed) else None


def runtime_config(variant_id: str) -> RuntimeConfig:
    if not variant_id:
        return RuntimeConfig()

    parts = [part for part in variant_id.split("|") if part]
    session = "ny"
    cursor = 1
    if len(parts) > cursor and "=" not in parts[cursor] and (parts[cursor] in SESSION_OPEN_MINUTES or parts[cursor] == "all"):
        session = parts[cursor]
        cursor += 1

    values: dict[str, Any] = {"session": session}
    for part in parts[cursor:]:
        key, raw_value = (part.split("=", 1) + [""])[:2]
        if key == "range":
            parsed = optional_float(raw_value)
            if parsed is not None:
                values["range_minutes"] = int(parsed)
        elif key == "entry":
            parsed = optional_float(raw_value)
            if parsed is not None:
                values["entry_minutes"] = int(parsed)
        elif key == "rr":
            parsed = optional_float(raw_value)
            if parsed is not None:
                values["rr"] = parsed
        elif key == "sl_atr":
            parsed = optional_float(raw_value)
            if parsed is not None:
                values["sl_atr"] = parsed
        elif key == "tp_atr":
            parsed = optional_float(raw_value)
            if parsed is not None:
                values["tp_atr"] = parsed
        elif key == "threshold":
            parsed = optional_float(raw_value)
            if parsed is not None:
                values["threshold"] = parsed
        elif key == "adx_max":
            values["adx_max"] = optional_float(raw_value)
        elif key == "adx_min":
            values["adx_min"] = optional_float(raw_value)
        elif key == "rsi2":
            values["rsi2_max"] = optional_float(raw_value)
        elif key == "trend" and raw_value in {"all", "ema", "both", "long_only", "short_only"}:
            values["trend"] = raw_value
        elif key == "max_bars":
            parsed = optional_float(raw_value)
            if parsed is not None:
                values["max_bars"] = int(parsed)
        elif key == "one_trade":
            values["one_trade_per_day"] = raw_value != "0"

    return RuntimeConfig(**values)


@lru_cache(maxsize=8192)
def variant_key_values(variant_id: str) -> tuple[tuple[str, str], ...]:
    pairs: list[tuple[str, str]] = []
    for token in variant_id.split("|"):
        token_key, raw_value = (token.split("=", 1) + [""])[:2]
        if token_key and raw_value:
            pairs.append((token_key, raw_value))
    return tuple(pairs)


def variant_value(variant_id: str, key: str) -> str | None:
    for token_key, raw_value in variant_key_values(variant_id):
        if token_key == key:
            return raw_value
    return None


def variant_float(variant_id: str, key: str, fallback: float) -> float:
    raw_value = variant_value(variant_id, key)
    parsed = optional_float(raw_value)
    return parsed if parsed is not None else fallback


def variant_deciles(variant_id: str, key: str, fallback: set[int]) -> set[int]:
    raw_value = variant_value(variant_id, key)
    if not raw_value:
        return set(fallback)
    deciles: set[int] = set()
    for token in raw_value.split(","):
        try:
            decile = int(token.strip())
        except ValueError:
            continue
        if 1 <= decile <= 10:
            deciles.add(decile)
    return deciles or set(fallback)


def strategy_timeframe(strategy: BacktestStrategy) -> str:
    timeframe = variant_value(strategy.variant_id, "tf") or "15m"
    if timeframe not in {"1m", "5m", "10m", "15m", "30m", "45m", "1h", "4h", "1d", "1w"}:
        raise ValueError(f"Unsupported timeframe '{timeframe}' for {strategy.id}")
    return timeframe


def strategy_execution_timeframe(strategy: BacktestStrategy) -> str | None:
    timeframe = variant_value(strategy.variant_id, "exec_tf")
    if timeframe is None:
        return None
    if timeframe not in {"1m", "5m"}:
        raise ValueError(f"Unsupported execution timeframe '{timeframe}' for {strategy.id}")
    return timeframe


def timeframe_rank(timeframe: str) -> int:
    try:
        return TIMEFRAME_ORDER.index(timeframe)
    except ValueError:
        return len(TIMEFRAME_ORDER)


def candle_file_has_rows(csv_path: Path) -> bool:
    try:
        return csv_path.exists() and csv_path.stat().st_size > 64
    except OSError:
        return False


def execution_timeframe_candidates(strategy: BacktestStrategy, asset: AssetConfig, source_timeframe: str) -> list[str]:
    explicit_timeframe = strategy_execution_timeframe(strategy)
    if explicit_timeframe is not None:
        explicit_path = DATA_ROOT / explicit_timeframe / asset.data_file
        if candle_file_has_rows(explicit_path):
            return [explicit_timeframe]

    source_rank = timeframe_rank(source_timeframe)
    candidates: list[str] = []
    for timeframe in LOWER_TIMEFRAME_EXIT_PREFERENCE:
        if timeframe_rank(timeframe) >= source_rank:
            continue
        if timeframe == explicit_timeframe:
            continue
        if candle_file_has_rows(DATA_ROOT / timeframe / asset.data_file):
            candidates.append(timeframe)
    return candidates


def best_execution_timeframe(strategy: BacktestStrategy, asset: AssetConfig, source_timeframe: str) -> str | None:
    candidates = execution_timeframe_candidates(strategy, asset, source_timeframe)
    return candidates[0] if candidates else None


def rolling_mean(values: np.ndarray, length: int) -> np.ndarray:
    output = np.full(values.shape[0], np.nan, dtype=np.float64)
    if values.shape[0] < length:
        return output
    cumulative = np.concatenate((np.asarray([0.0]), np.cumsum(values, dtype=np.float64)))
    window_sum = cumulative[length:] - cumulative[:-length]
    output[length - 1 :] = window_sum / length
    return output


def rolling_std(values: np.ndarray, length: int) -> np.ndarray:
    output = np.full(values.shape[0], np.nan, dtype=np.float64)
    if values.shape[0] < length:
        return output
    cumulative = np.concatenate((np.asarray([0.0]), np.cumsum(values, dtype=np.float64)))
    cumulative_sq = np.concatenate((np.asarray([0.0]), np.cumsum(values * values, dtype=np.float64)))
    window_sum = cumulative[length:] - cumulative[:-length]
    window_sq_sum = cumulative_sq[length:] - cumulative_sq[:-length]
    mean = window_sum / length
    variance = np.maximum(0.0, window_sq_sum / length - mean * mean)
    output[length - 1 :] = np.sqrt(variance)
    return output


def pivot_flags(high: np.ndarray, low: np.ndarray, swing: int) -> tuple[np.ndarray, np.ndarray]:
    pivot_high = np.zeros(high.shape[0], dtype=np.bool_)
    pivot_low = np.zeros(low.shape[0], dtype=np.bool_)
    if swing <= 0 or high.shape[0] <= swing * 2:
        return pivot_high, pivot_low

    for index in range(swing, high.shape[0] - swing):
        if high[index] > np.max(high[index - swing : index]) and high[index] >= np.max(high[index + 1 : index + swing + 1]):
            pivot_high[index] = True
        if low[index] < np.min(low[index - swing : index]) and low[index] <= np.min(low[index + 1 : index + swing + 1]):
            pivot_low[index] = True
    return pivot_high, pivot_low


def build_timeframe_data(frame: pl.DataFrame) -> TimeframeData:
    times = frame["time"].to_numpy().astype(np.int64)
    open_ = frame["open"].to_numpy().astype(np.float64)
    high = frame["high"].to_numpy().astype(np.float64)
    low = frame["low"].to_numpy().astype(np.float64)
    close = frame["close"].to_numpy().astype(np.float64)
    atr14 = rma(build_true_range(high, low, close), 14)
    pivot_high_1, pivot_low_1 = pivot_flags(high, low, 1)
    pivot_high_2, pivot_low_2 = pivot_flags(high, low, 2)
    return TimeframeData(
        times=times,
        open=open_,
        high=high,
        low=low,
        close=close,
        ema20=ema(close, 20),
        ema21=ema(close, 21),
        ema50=ema(close, 50),
        ema200=ema(close, 200),
        atr14=atr14,
        pivot_high_1=pivot_high_1,
        pivot_low_1=pivot_low_1,
        pivot_high_2=pivot_high_2,
        pivot_low_2=pivot_low_2,
    )


def load_timeframe_data(asset: AssetConfig, timeframe: str) -> TimeframeData:
    csv_path = DATA_ROOT / timeframe / asset.data_file
    return build_timeframe_data(load_candle_csv(csv_path))


def slice_timeframe_data(data: TimeframeData | None, stop_time: int) -> TimeframeData | None:
    if data is None:
        return None
    stop = int(np.searchsorted(data.times, stop_time, side="right"))
    return TimeframeData(
        times=data.times[:stop],
        open=data.open[:stop],
        high=data.high[:stop],
        low=data.low[:stop],
        close=data.close[:stop],
        ema20=data.ema20[:stop],
        ema21=data.ema21[:stop],
        ema50=data.ema50[:stop],
        ema200=data.ema200[:stop],
        atr14=data.atr14[:stop],
        pivot_high_1=data.pivot_high_1[:stop],
        pivot_low_1=data.pivot_low_1[:stop],
        pivot_high_2=data.pivot_high_2[:stop],
        pivot_low_2=data.pivot_low_2[:stop],
    )


def build_enriched_data(frame: pl.DataFrame, asset: AssetConfig | None = None) -> EnrichedData:
    times = frame["time"].to_numpy().astype(np.int64)
    open_ = frame["open"].to_numpy().astype(np.float64)
    high = frame["high"].to_numpy().astype(np.float64)
    low = frame["low"].to_numpy().astype(np.float64)
    close = frame["close"].to_numpy().astype(np.float64)
    volume = frame["volume"].to_numpy().astype(np.float64) if "volume" in frame.columns else np.ones(close.shape[0], dtype=np.float64)

    ny_dates: list[str] = []
    ny_days = np.empty(times.shape[0], dtype=np.int64)
    ny_minutes = np.empty(times.shape[0], dtype=np.int64)
    ny_weekdays = np.empty(times.shape[0], dtype=np.int64)
    for index, timestamp in enumerate(times):
        ny_dt = datetime.fromtimestamp(int(timestamp), tz=timezone.utc).astimezone(NEW_YORK)
        ny_dates.append(ny_dt.date().isoformat())
        ny_days[index] = ny_dt.date().toordinal()
        ny_minutes[index] = ny_dt.hour * 60 + ny_dt.minute
        ny_weekdays[index] = ny_dt.weekday()

    day_bounds: dict[str, tuple[int, int]] = {}
    prior_day_high = np.full(times.shape[0], np.nan, dtype=np.float64)
    prior_day_low = np.full(times.shape[0], np.nan, dtype=np.float64)
    prior_high = np.nan
    prior_low = np.nan
    cursor = 0
    while cursor < len(ny_dates):
        day = ny_dates[cursor]
        start = cursor
        while cursor < len(ny_dates) and ny_dates[cursor] == day:
            cursor += 1
        end = cursor
        day_bounds[day] = (start, end)
        prior_day_high[start:end] = prior_high
        prior_day_low[start:end] = prior_low
        prior_high = float(np.max(high[start:end]))
        prior_low = float(np.min(low[start:end]))

    true_range = build_true_range(high, low, close)
    atr14 = rma(true_range, 14)
    atr100 = rma(true_range, 100)
    ema9_values = ema(close, 9)
    ema21_values = ema(close, 21)
    ema30_values = ema(close, 30)
    ema34_values = ema(close, 34)
    ema50_values = ema(close, 50)
    ema200_values = ema(close, 200)

    deltas = np.empty(close.shape[0], dtype=np.float64)
    deltas[0] = 0.0
    deltas[1:] = close[1:] - close[:-1]
    gains = np.maximum(deltas, 0.0)
    losses = np.maximum(-deltas, 0.0)
    avg_gain2 = rma(gains, 2)
    avg_loss2 = rma(losses, 2)
    avg_gain14 = rma(gains, 14)
    avg_loss14 = rma(losses, 14)

    rsi2 = np.full(close.shape[0], np.nan, dtype=np.float64)
    rsi14_centered = np.full(close.shape[0], np.nan, dtype=np.float64)
    rsi2_mask = ~np.isnan(avg_gain2) & ~np.isnan(avg_loss2)
    rsi2[rsi2_mask & (avg_loss2 == 0.0)] = 100.0
    rsi2_regular = rsi2_mask & (avg_loss2 != 0.0)
    rsi2[rsi2_regular] = 100.0 - 100.0 / (1.0 + avg_gain2[rsi2_regular] / avg_loss2[rsi2_regular])

    rsi14_mask = ~np.isnan(avg_gain14) & ~np.isnan(avg_loss14)
    rsi14_centered[rsi14_mask & (avg_loss14 == 0.0)] = 1.0
    rsi14_regular = rsi14_mask & (avg_loss14 != 0.0)
    rsi14 = 100.0 - 100.0 / (1.0 + avg_gain14[rsi14_regular] / avg_loss14[rsi14_regular])
    rsi14_centered[rsi14_regular] = (rsi14 - 50.0) / 50.0

    sma20 = rolling_mean(close, 20)
    std20 = rolling_std(close, 20)
    bb_z20 = np.full(close.shape[0], np.nan, dtype=np.float64)
    bb_mask = ~np.isnan(sma20) & ~np.isnan(std20) & (std20 != 0.0)
    bb_z20[bb_mask] = (close[bb_mask] - sma20[bb_mask]) / std20[bb_mask]

    candle_range = high - low
    close_location = np.full(close.shape[0], 0.5, dtype=np.float64)
    range_mask = candle_range != 0.0
    close_location[range_mask] = (close[range_mask] - low[range_mask]) / candle_range[range_mask]
    ret3_atr = np.full(close.shape[0], np.nan, dtype=np.float64)
    ret_mask = np.arange(close.shape[0]) >= 3
    ret_mask &= ~np.isnan(atr14) & (atr14 != 0.0)
    ret3_atr[ret_mask] = (close[ret_mask] - close[np.where(ret_mask)[0] - 3]) / atr14[ret_mask]

    body_atr = np.full(close.shape[0], np.nan, dtype=np.float64)
    body_mask = ~np.isnan(atr14) & (atr14 != 0.0)
    body_atr[body_mask] = (close[body_mask] - open_[body_mask]) / atr14[body_mask]

    close_ema200_atr = np.full(close.shape[0], np.nan, dtype=np.float64)
    close_ema_mask = ~np.isnan(atr100) & (atr100 != 0.0)
    close_ema200_atr[close_ema_mask] = (close[close_ema_mask] - ema200_values[close_ema_mask]) / atr100[close_ema_mask]

    session_vwap = np.full(close.shape[0], np.nan, dtype=np.float64)
    current_day = -1
    cumulative_value = 0.0
    cumulative_volume = 0.0
    for index in range(close.shape[0]):
        if ny_days[index] != current_day:
            current_day = int(ny_days[index])
            cumulative_value = 0.0
            cumulative_volume = 0.0
        bar_volume = float(volume[index]) if math.isfinite(float(volume[index])) and float(volume[index]) > 0 else 1.0
        typical_price = (high[index] + low[index] + close[index]) / 3.0
        cumulative_value += typical_price * bar_volume
        cumulative_volume += bar_volume
        if cumulative_volume > 0:
            session_vwap[index] = cumulative_value / cumulative_volume

    hourly = load_timeframe_data(asset, "1h") if asset is not None else None
    daily = load_timeframe_data(asset, "1d") if asset is not None else None

    return EnrichedData(
        times=times,
        open=open_,
        high=high,
        low=low,
        close=close,
        ny_dates=ny_dates,
        ny_days=ny_days,
        ny_minutes=ny_minutes,
        ny_weekdays=ny_weekdays,
        day_bounds=day_bounds,
        prior_day_high=prior_day_high,
        prior_day_low=prior_day_low,
        ema9=ema9_values,
        ema21=ema21_values,
        ema30=ema30_values,
        ema34=ema34_values,
        ema50=ema50_values,
        ema200=ema200_values,
        atr14=atr14,
        atr100=atr100,
        session_vwap=session_vwap,
        rsi2=rsi2,
        rsi14_centered=rsi14_centered,
        bb_z20=bb_z20,
        close_location=close_location,
        ret3_atr=ret3_atr,
        body_atr=body_atr,
        close_ema200_atr=close_ema200_atr,
        hourly=hourly,
        daily=daily,
    )


def anti_cheat_window(data: EnrichedData, end_index: int) -> EnrichedData:
    stop = end_index + 1
    if stop <= 0 or stop > data.times.shape[0]:
        raise IndexError(f"Signal window end {end_index} is outside the available candle history")
    stop_time = int(data.times[stop - 1])

    day_bounds = {
        day: (start, min(end, stop))
        for day, (start, end) in data.day_bounds.items()
        if start < stop
    }

    return EnrichedData(
        times=data.times[:stop],
        open=data.open[:stop],
        high=data.high[:stop],
        low=data.low[:stop],
        close=data.close[:stop],
        ny_dates=data.ny_dates[:stop],
        ny_days=data.ny_days[:stop],
        ny_minutes=data.ny_minutes[:stop],
        ny_weekdays=data.ny_weekdays[:stop],
        day_bounds=day_bounds,
        prior_day_high=data.prior_day_high[:stop],
        prior_day_low=data.prior_day_low[:stop],
        ema9=data.ema9[:stop],
        ema21=data.ema21[:stop],
        ema30=data.ema30[:stop],
        ema34=data.ema34[:stop],
        ema50=data.ema50[:stop],
        ema200=data.ema200[:stop],
        atr14=data.atr14[:stop],
        atr100=data.atr100[:stop],
        session_vwap=data.session_vwap[:stop],
        rsi2=data.rsi2[:stop],
        rsi14_centered=data.rsi14_centered[:stop],
        bb_z20=data.bb_z20[:stop],
        close_location=data.close_location[:stop],
        ret3_atr=data.ret3_atr[:stop],
        body_atr=data.body_atr[:stop],
        close_ema200_atr=data.close_ema200_atr[:stop],
        hourly=slice_timeframe_data(data.hourly, stop_time),
        daily=slice_timeframe_data(data.daily, stop_time),
    )


def competition_anti_cheat_window(strategy: BacktestStrategy, data: EnrichedData, end_index: int) -> EnrichedData:
    stop = end_index + 1
    if stop <= 0 or stop > data.times.shape[0]:
        raise IndexError(f"Signal window end {end_index} is outside the available candle history")

    is_daily_tsmom = competition_param_text(strategy, "family", "").startswith("daily_tsmom")
    required_daily_closes = max(competition_tsmom_lookbacks(strategy)) + 5 if is_daily_tsmom else 0
    recent_days: list[str] = []
    seen: set[str] = set()
    daily_closes = 0
    cursor = end_index
    while cursor >= 0 and (len(recent_days) < 30 or daily_closes < required_daily_closes):
        day = data.ny_dates[cursor]
        if day not in seen:
            recent_days.append(day)
            seen.add(day)
        if is_daily_tsmom and int(data.ny_minutes[cursor]) == 945:
            daily_closes += 1
        cursor -= 1

    day_bounds = {
        day: (start, min(end, stop))
        for day in reversed(recent_days)
        if (bounds := data.day_bounds.get(day)) is not None
        for start, end in (bounds,)
        if start < stop
    }

    return EnrichedData(
        times=data.times[:stop],
        open=data.open[:stop],
        high=data.high[:stop],
        low=data.low[:stop],
        close=data.close[:stop],
        ny_dates=data.ny_dates,
        ny_days=data.ny_days[:stop],
        ny_minutes=data.ny_minutes[:stop],
        ny_weekdays=data.ny_weekdays[:stop],
        day_bounds=day_bounds,
        prior_day_high=data.prior_day_high[:stop],
        prior_day_low=data.prior_day_low[:stop],
        ema9=data.ema9[:stop],
        ema21=data.ema21[:stop],
        ema30=data.ema30[:stop],
        ema34=data.ema34[:stop],
        ema50=data.ema50[:stop],
        ema200=data.ema200[:stop],
        atr14=data.atr14[:stop],
        atr100=data.atr100[:stop],
        session_vwap=data.session_vwap[:stop],
        rsi2=data.rsi2[:stop],
        rsi14_centered=data.rsi14_centered[:stop],
        bb_z20=data.bb_z20[:stop],
        close_location=data.close_location[:stop],
        ret3_atr=data.ret3_atr[:stop],
        body_atr=data.body_atr[:stop],
        close_ema200_atr=data.close_ema200_atr[:stop],
        hourly=None,
        daily=None,
    )


def anti_cheat_signal_index(data: EnrichedData, index: int, strict: bool = True) -> int:
    expected = data.times.shape[0] - 1
    if strict and index != expected:
        raise ValueError(
            f"Signal evaluation must use an anti-cheat window ending at the current bar (expected index {expected}, got {index})"
        )
    return index


def round_price(value: float, tick_size: float) -> float:
    if tick_size <= 0:
        return value
    return math.floor(value / tick_size + 0.5) * tick_size


def side_name(side: int) -> str:
    return "long" if side == 1 else "short"


def price_units(entry_price: float, exit_price: float, side: int, tick_size: float) -> float:
    return ((exit_price - entry_price) * side) / tick_size


def signal_units(entry_price: float, target_price: float, tick_size: float) -> float:
    return abs(target_price - entry_price) / tick_size


def maybe_number(value: float) -> bool:
    return math.isfinite(value) and not math.isnan(value)


def allowed_by_trend(data: EnrichedData, index: int, side: int, trend: str) -> bool:
    if trend in {"all", "both"}:
        return True
    if trend == "long_only":
        return side == 1
    if trend == "short_only":
        return side == -1
    if trend != "ema":
        return True
    if np.isnan(data.ema30[index]) or np.isnan(data.ema200[index]):
        return False
    return data.ema30[index] > data.ema200[index] if side == 1 else data.ema30[index] < data.ema200[index]


def session_minutes(config: RuntimeConfig) -> tuple[int, int]:
    if config.session == "all":
        return 7 * 60, 15 * 60 + 30
    open_minutes = SESSION_OPEN_MINUTES[config.session]
    return open_minutes, min(open_minutes + max(60, config.entry_minutes), 15 * 60 + 30)


def move_signal(data: EnrichedData, index: int, multiplier: float, upward: bool) -> bool:
    if index < 5 or np.isnan(data.atr100[index]):
        return False
    threshold = data.atr100[index] * multiplier
    if upward:
        return data.close[index] > data.close[index - 5] + threshold
    return data.close[index] < data.close[index - 5] - threshold


def no_recent_move_signal(data: EnrichedData, index: int, lookback: int, multiplier: float, upward: bool) -> bool:
    for cursor in range(max(0, index - lookback), index):
        if move_signal(data, cursor, multiplier, upward):
            return False
    return True


def strategy_entry_window(data: EnrichedData, index: int, config: RuntimeConfig) -> bool:
    session_start, session_end = session_minutes(config)
    return session_start <= data.ny_minutes[index] <= session_end


def price_target_signal(entry_price: float, stop_loss: float, side: int, rr: float, asset: AssetConfig) -> dict[str, Any] | None:
    risk = abs(entry_price - stop_loss)
    if not maybe_number(risk) or risk <= 0:
        return None
    return {
        "entry_mode": "market",
        "side": side,
        "reference_entry_price": round_price(entry_price, asset.tick_size),
        "stop_loss": round_price(stop_loss, asset.tick_size),
        "risk_reward": rr,
    }


def variant_int(variant_id: str, key: str, fallback: int) -> int:
    return int(round(variant_float(variant_id, key, float(fallback))))


def timeframe_pivot_arrays(data: TimeframeData, swing: int) -> tuple[np.ndarray, np.ndarray]:
    if swing <= 1:
        return data.pivot_high_1, data.pivot_low_1
    return data.pivot_high_2, data.pivot_low_2


def select_descending_pivots(indices: list[int], prices: np.ndarray, touches: int, min_gap: int) -> list[int]:
    selected: list[int] = []
    last_price = math.inf
    last_index = math.inf
    for index in reversed(indices):
        price = float(prices[index])
        if price < last_price and (not selected or last_index - index >= min_gap):
            selected.append(index)
            last_price = price
            last_index = index
            if len(selected) == touches:
                break
    return list(reversed(selected)) if len(selected) == touches else []


def select_ascending_pivots(indices: list[int], prices: np.ndarray, touches: int, min_gap: int) -> list[int]:
    selected: list[int] = []
    last_price = -math.inf
    last_index = math.inf
    for index in reversed(indices):
        price = float(prices[index])
        if price > last_price and (not selected or last_index - index >= min_gap):
            selected.append(index)
            last_price = price
            last_index = index
            if len(selected) == touches:
                break
    return list(reversed(selected)) if len(selected) == touches else []


def trendline_value(index_a: int, price_a: float, index_b: int, price_b: float, target_index: int) -> float:
    if index_b == index_a:
        return price_b
    return price_a + (price_b - price_a) * ((target_index - index_a) / (index_b - index_a))


def touches_near_line(indices: list[int], prices: np.ndarray, atr_values: np.ndarray, tolerance_mult: float) -> bool:
    if len(indices) < 2:
        return False
    index_a = indices[0]
    index_b = indices[-1]
    price_a = float(prices[index_a])
    price_b = float(prices[index_b])
    for index in indices[1:-1]:
        tolerance = float(atr_values[index]) * tolerance_mult
        if not maybe_number(tolerance) or abs(float(prices[index]) - trendline_value(index_a, price_a, index_b, price_b, index)) > tolerance:
            return False
    return True


def prior_completed_daily_index(daily: TimeframeData, current_time: int) -> int:
    current_day_start = current_time - (current_time % 86_400)
    return int(np.searchsorted(daily.times, current_day_start - 1, side="right") - 1)


def signal_confidence_tori(hourly: TimeframeData, hour_index: int, risk_atr: float, touches: int) -> float:
    trend_strength = 0.0
    ema50 = float(hourly.ema50[hour_index])
    ema200 = float(hourly.ema200[hour_index])
    atr = float(hourly.atr14[hour_index])
    if maybe_number(ema50) and maybe_number(ema200) and maybe_number(atr) and atr > 0:
        trend_strength = min(abs(ema50 - ema200) / atr, 2.0) / 2.0

    confidence = 0.45
    confidence += 0.12 if touches >= 3 else 0.07
    confidence += max(0.0, 0.18 - max(0.0, risk_atr - 1.5) * 0.08)
    confidence += trend_strength * 0.18
    return max(0.35, min(confidence, 0.92))


def evaluate_tori_trendline_mtf(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig
) -> dict[str, Any] | None:
    hourly = data.hourly
    daily = data.daily
    if hourly is None or daily is None or index <= 0:
        return None

    current_time = int(data.times[index])
    if current_time % 3600 != 2700:
        return None

    hour_start = current_time - (current_time % 3600)
    hour_index = int(np.searchsorted(hourly.times, hour_start, side="left"))
    if hour_index <= 0 or hour_index >= hourly.times.shape[0] or int(hourly.times[hour_index]) != hour_start:
        return None

    daily_index = prior_completed_daily_index(daily, hour_start)
    if daily_index < 60:
        return None

    swing = max(1, min(2, variant_int(strategy.variant_id, "swing", 2)))
    lookback = max(12, variant_int(strategy.variant_id, "lookback", 24))
    touch_count = max(2, variant_int(strategy.variant_id, "touch", 2))
    min_gap = max(1, variant_int(strategy.variant_id, "gap", 1))
    lead_bars = max(1, variant_int(strategy.variant_id, "lead", 4))
    target_lookback = max(12, variant_int(strategy.variant_id, "target_lookback", 48))
    break_buffer = max(0.0, variant_float(strategy.variant_id, "break", 0.02))
    touch_tolerance = max(0.05, variant_float(strategy.variant_id, "tol", 0.30))
    stop_buffer = max(0.0, variant_float(strategy.variant_id, "stop_buf", 0.10))
    max_risk_atr = max(0.5, variant_float(strategy.variant_id, "risk", 3.0))
    reward_multiple = max(1.0, variant_float(strategy.variant_id, "rr", 2.0))

    hour_atr = float(hourly.atr14[hour_index])
    if not maybe_number(hour_atr) or hour_atr <= 0:
        return None

    macro_up = (
        float(daily.close[daily_index]) > float(daily.ema20[daily_index]) > float(daily.ema50[daily_index])
        and float(hourly.ema21[hour_index]) > float(hourly.ema50[hour_index]) > float(hourly.ema200[hour_index])
    )
    macro_down = (
        float(daily.close[daily_index]) < float(daily.ema20[daily_index]) < float(daily.ema50[daily_index])
        and float(hourly.ema21[hour_index]) < float(hourly.ema50[hour_index]) < float(hourly.ema200[hour_index])
    )
    if not macro_up and not macro_down:
        return None

    confirmed_limit = hour_index - swing
    window_start = max(0, hour_index - lookback)
    if confirmed_limit <= window_start:
        return None

    pivot_high, pivot_low = timeframe_pivot_arrays(hourly, swing)
    high_indices = [cursor for cursor in range(window_start, confirmed_limit + 1) if bool(pivot_high[cursor])]
    low_indices = [cursor for cursor in range(window_start, confirmed_limit + 1) if bool(pivot_low[cursor])]
    if len(high_indices) < touch_count or len(low_indices) < 2:
        return None

    side = 0
    action_indices: list[int] = []
    safety_indices: list[int] = []
    action_now = math.nan
    action_prev = math.nan
    safety_now = math.nan

    if macro_up:
        action_indices = select_descending_pivots(high_indices, hourly.high, touch_count, min_gap)
        safety_indices = select_descending_pivots(low_indices, hourly.low, 2, min_gap)
        if action_indices and safety_indices and action_indices[0] < safety_indices[0] < action_indices[-1]:
            if touches_near_line(action_indices, hourly.high, hourly.atr14, touch_tolerance) and touches_near_line(
                safety_indices, hourly.low, hourly.atr14, touch_tolerance
            ):
                action_now = trendline_value(
                    action_indices[0],
                    float(hourly.high[action_indices[0]]),
                    action_indices[-1],
                    float(hourly.high[action_indices[-1]]),
                    hour_index,
                )
                action_prev = trendline_value(
                    action_indices[0],
                    float(hourly.high[action_indices[0]]),
                    action_indices[-1],
                    float(hourly.high[action_indices[-1]]),
                    hour_index - 1,
                )
                safety_now = trendline_value(
                    safety_indices[0],
                    float(hourly.low[safety_indices[0]]),
                    safety_indices[-1],
                    float(hourly.low[safety_indices[-1]]),
                    hour_index + lead_bars,
                )
                if (
                    float(hourly.close[hour_index - 1]) <= action_prev
                    and float(hourly.close[hour_index]) > action_now + hour_atr * break_buffer
                    and (action_now - safety_now) > hour_atr * 0.2
                ):
                    side = 1

    if macro_down and side == 0:
        action_indices = select_ascending_pivots(low_indices, hourly.low, touch_count, min_gap)
        safety_indices = select_ascending_pivots(high_indices, hourly.high, 2, min_gap)
        if action_indices and safety_indices and action_indices[0] < safety_indices[0] < action_indices[-1]:
            if touches_near_line(action_indices, hourly.low, hourly.atr14, touch_tolerance) and touches_near_line(
                safety_indices, hourly.high, hourly.atr14, touch_tolerance
            ):
                action_now = trendline_value(
                    action_indices[0],
                    float(hourly.low[action_indices[0]]),
                    action_indices[-1],
                    float(hourly.low[action_indices[-1]]),
                    hour_index,
                )
                action_prev = trendline_value(
                    action_indices[0],
                    float(hourly.low[action_indices[0]]),
                    action_indices[-1],
                    float(hourly.low[action_indices[-1]]),
                    hour_index - 1,
                )
                safety_now = trendline_value(
                    safety_indices[0],
                    float(hourly.high[safety_indices[0]]),
                    safety_indices[-1],
                    float(hourly.high[safety_indices[-1]]),
                    hour_index + lead_bars,
                )
                if (
                    float(hourly.close[hour_index - 1]) >= action_prev
                    and float(hourly.close[hour_index]) < action_now - hour_atr * break_buffer
                    and (safety_now - action_now) > hour_atr * 0.2
                ):
                    side = -1

    if side == 0:
        return None

    reference_entry = float(data.close[index])
    stop_loss = safety_now - hour_atr * stop_buffer if side == 1 else safety_now + hour_atr * stop_buffer
    risk = abs(reference_entry - stop_loss)
    if not maybe_number(risk) or risk <= 0 or risk > hour_atr * max_risk_atr:
        return None

    history_start = max(0, action_indices[0] - target_lookback)
    if side == 1:
        prior_structure = float(np.max(hourly.high[history_start : action_indices[0] + 1]))
        take_profit = max(reference_entry + risk * reward_multiple, prior_structure)
        if take_profit <= reference_entry:
            return None
    else:
        prior_structure = float(np.min(hourly.low[history_start : action_indices[0] + 1]))
        take_profit = min(reference_entry - risk * reward_multiple, prior_structure)
        if take_profit >= reference_entry:
            return None

    confidence = signal_confidence_tori(hourly, hour_index, risk / hour_atr, touch_count)
    direction_text = "daily bias + hourly descending channel break" if side == 1 else "daily bias + hourly ascending channel break"
    return {
        "entry_mode": "market",
        "side": side,
        "reference_entry_price": round_price(reference_entry, asset.tick_size),
        "stop_loss": round_price(stop_loss, asset.tick_size),
        "take_profit": round_price(take_profit, asset.tick_size),
        "confidence": confidence,
        "notes": (
            f"Tori MTF proxy: prior-day trend filter, hourly action/safety lines, and next-15m execution after the hourly break. "
            f"Setup={direction_text}."
        ),
    }


def evaluate_parabolic_fade(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig, config: RuntimeConfig
) -> dict[str, Any] | None:
    if not strategy_entry_window(data, index, config):
        return None
    required = [data.atr14[index], data.ret3_atr[index], data.bb_z20[index], data.close_location[index]]
    if any(np.isnan(value) for value in required):
        return None

    extension = max(0.75, config.threshold)
    upper_z = 1.65 + extension * 0.1
    lower_z = -upper_z
    atr = float(data.atr14[index])
    side = 0
    if data.ret3_atr[index] >= extension and data.bb_z20[index] >= upper_z and data.close_location[index] <= 0.48:
        side = -1
    elif data.ret3_atr[index] <= -extension and data.bb_z20[index] <= lower_z and data.close_location[index] >= 0.52:
        side = 1
    if side == 0 or not allowed_by_trend(data, index, side, config.trend):
        return None

    entry_price = round_price(float(data.close[index]), asset.tick_size)
    stop_loss = round_price(float(data.high[index] + atr * config.sl_atr * 0.35) if side == -1 else float(data.low[index] - atr * config.sl_atr * 0.35), asset.tick_size)
    return price_target_signal(entry_price, stop_loss, side, config.rr, asset)


def evaluate_vwap_pullback(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig, config: RuntimeConfig
) -> dict[str, Any] | None:
    if not strategy_entry_window(data, index, config):
        return None
    required = [data.atr14[index], data.session_vwap[index], data.ema30[index], data.ema200[index], data.body_atr[index]]
    if any(np.isnan(value) for value in required):
        return None
    if data.ny_minutes[index] < session_minutes(config)[0] + 30:
        return None

    atr = float(data.atr14[index])
    vwap = float(data.session_vwap[index])
    proximity = max(0.05, config.threshold)
    had_up_drive = data.close[index - 1] > vwap + atr * proximity if index > 0 else False
    had_down_drive = data.close[index - 1] < vwap - atr * proximity if index > 0 else False

    long_setup = (
        had_up_drive
        and data.ema30[index] >= data.ema200[index]
        and data.low[index] <= vwap + atr * proximity
        and data.close[index] > vwap
        and data.body_atr[index] > -0.1
    )
    short_setup = (
        had_down_drive
        and data.ema30[index] <= data.ema200[index]
        and data.high[index] >= vwap - atr * proximity
        and data.close[index] < vwap
        and data.body_atr[index] < 0.1
    )
    side = 1 if long_setup else -1 if short_setup else 0
    if side == 0 or not allowed_by_trend(data, index, side, config.trend):
        return None

    entry_price = round_price(float(data.close[index]), asset.tick_size)
    stop_distance = max(abs(entry_price - vwap) + atr * 0.15, atr * config.sl_atr * 0.35)
    stop_loss = round_price(entry_price - side * stop_distance, asset.tick_size)
    return price_target_signal(entry_price, stop_loss, side, config.rr, asset)


def evaluate_support_resistance_retest(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig, config: RuntimeConfig
) -> dict[str, Any] | None:
    if not strategy_entry_window(data, index, config):
        return None
    if np.isnan(data.atr14[index]):
        return None

    lookback = max(12, int(config.range_minutes))
    retest_bars = max(2, min(24, int(config.entry_minutes / 15)))
    if index < lookback + retest_bars + 2:
        return None

    base_start = index - lookback - retest_bars
    base_end = index - retest_bars
    resistance = float(np.max(data.high[base_start:base_end]))
    support = float(np.min(data.low[base_start:base_end]))
    atr = float(data.atr14[index])
    breakout_buffer = atr * max(0.02, config.threshold)
    retest_buffer = atr * max(0.05, config.threshold * 1.5)

    recent_start = index - retest_bars
    long_break = np.max(data.close[recent_start:index]) > resistance + breakout_buffer
    short_break = np.min(data.close[recent_start:index]) < support - breakout_buffer
    long_setup = long_break and data.low[index] <= resistance + retest_buffer and data.close[index] > resistance
    short_setup = short_break and data.high[index] >= support - retest_buffer and data.close[index] < support

    side = 1 if long_setup else -1 if short_setup else 0
    if side == 0 or not allowed_by_trend(data, index, side, config.trend):
        return None

    entry_price = round_price(float(data.close[index]), asset.tick_size)
    stop_loss = round_price(
        min(float(data.low[index]), resistance - atr * config.sl_atr * 0.25)
        if side == 1
        else max(float(data.high[index]), support + atr * config.sl_atr * 0.25),
        asset.tick_size,
    )
    return price_target_signal(entry_price, stop_loss, side, config.rr, asset)


def round_number_levels(low: float, high: float, step: float, reach: float) -> list[float]:
    first = math.floor((low - reach) / step) * step
    last = math.ceil((high + reach) / step) * step
    levels: list[float] = []
    level = first
    while level <= last + step * 0.5:
        levels.append(level)
        level += step
    return levels


def round_rejection_signal(
    strategy: BacktestStrategy,
    data: EnrichedData,
    index: int,
    asset: AssetConfig,
    side: int,
    level: float,
    stop_buffer_points: float,
    min_risk_points: float,
    max_risk_points: float,
    rr: float,
    bar_range: float,
    wick_pct: float,
) -> dict[str, Any] | None:
    score = round_number_model_score(strategy, data, index, asset, side, level, bar_range, wick_pct)
    if score < variant_float(strategy.variant_id, "min", 0.0):
        return None

    entry_price = round_price(float(data.close[index]), asset.tick_size)
    stop_reference = min(float(data.low[index]), level) if side == 1 else max(float(data.high[index]), level)
    stop_loss = round_price(stop_reference - side * stop_buffer_points, asset.tick_size)
    risk_points = abs(entry_price - stop_loss)
    if risk_points < min_risk_points or risk_points > max_risk_points:
        return None

    signal = price_target_signal(entry_price, stop_loss, side, rr, asset)
    if signal is None:
        return None
    signal["score"] = score
    signal["confidence"] = score
    signal["min_risk_units"] = min_risk_points / asset.tick_size
    signal["max_risk_units"] = max_risk_points / asset.tick_size
    return signal


def round_number_model(strategy: BacktestStrategy) -> str:
    model = variant_value(strategy.variant_id, "model") or "none"
    return model if model in {"none", "stump", "bayes", "logit"} else "none"


def round_number_model_score(
    strategy: BacktestStrategy,
    data: EnrichedData,
    index: int,
    asset: AssetConfig,
    side: int,
    level: float,
    bar_range: float,
    wick_pct: float,
) -> float:
    model = round_number_model(strategy)
    if model == "none":
        return 1.0

    prior_close_distance = float(data.close[index - 1] - level) if side == 1 else float(level - data.close[index - 1])
    close_distance = float(data.close[index] - level) if side == 1 else float(level - data.close[index])
    high_low_distance = float(level - data.low[index]) if side == 1 else float(data.high[index] - level)
    previous_max = max(asset.tick_size, variant_float(strategy.variant_id, "prev_max", math.inf))
    reclaim_points = max(asset.tick_size, variant_float(strategy.variant_id, "reclaim", 3.0))
    touch_points = max(asset.tick_size, variant_float(strategy.variant_id, "touch", 12.0))
    min_wick_pct = min(0.9, max(0.05, variant_float(strategy.variant_id, "wick", 0.36)))
    atr = float(data.atr14[index]) if maybe_number(data.atr14[index]) and data.atr14[index] > 0 else bar_range
    trend = (
        side * (float(data.ema30[index]) - float(data.ema200[index])) / atr
        if maybe_number(data.ema30[index]) and maybe_number(data.ema200[index]) and atr > 0
        else 0.0
    )
    rsi2 = float(data.rsi2[index]) if maybe_number(data.rsi2[index]) else 50.0
    directional_rsi = (50.0 - rsi2) / 50.0 if side == 1 else (rsi2 - 50.0) / 50.0

    if model == "stump":
        return 0.74 if prior_close_distance <= previous_max and close_distance >= reclaim_points else 0.42

    if model == "bayes":
        log_odds = -0.70
        log_odds += 1.10 if prior_close_distance <= previous_max else -0.55
        log_odds += 0.25 if wick_pct >= min_wick_pct + 0.20 else -0.05
        log_odds += 0.20 if high_low_distance >= touch_points else -0.05
        log_odds += 0.15 if close_distance >= reclaim_points * 2.0 else 0.0
        log_odds += 0.12 if directional_rsi > 0.0 else -0.06
        log_odds += 0.12 if trend < -0.50 else -0.12 if trend > 1.50 else 0.0
        return sigmoid(log_odds)

    return sigmoid(
        -1.15
        - 0.055 * prior_close_distance
        + 0.018 * close_distance
        + 1.20 * wick_pct
        + 0.012 * high_low_distance
        + 0.15 * directional_rsi
        - 0.04 * max(0.0, trend)
    )


def evaluate_round_number_rejection(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig, config: RuntimeConfig
) -> dict[str, Any] | None:
    if index < 1 or not strategy_entry_window(data, index, config):
        return None
    if np.isnan(data.atr14[index]) or np.isnan(data.close_location[index]) or asset.tick_size <= 0:
        return None

    step = max(10.0, variant_float(strategy.variant_id, "step", 100.0))
    touch_points = max(asset.tick_size, variant_float(strategy.variant_id, "touch", 12.0))
    sweep_points = max(touch_points, variant_float(strategy.variant_id, "sweep", touch_points * 2.0))
    reclaim_points = max(asset.tick_size, variant_float(strategy.variant_id, "reclaim", 3.0))
    min_wick_pct = min(0.9, max(0.05, variant_float(strategy.variant_id, "wick", 0.36)))
    min_range_atr = max(0.0, variant_float(strategy.variant_id, "atr_min", 0.25))
    max_range_atr = max(0.5, variant_float(strategy.variant_id, "atr_max", 2.75))
    min_risk_points = max(asset.tick_size, variant_float(strategy.variant_id, "risk_min", 10.0))
    max_risk_points = max(asset.tick_size, variant_float(strategy.variant_id, "risk_max", 80.0))
    stop_buffer_points = max(asset.tick_size, variant_float(strategy.variant_id, "stop", 4.0))

    low = float(data.low[index])
    high = float(data.high[index])
    open_ = float(data.open[index])
    close = float(data.close[index])
    previous_close = float(data.close[index - 1])
    bar_range = high - low
    if not maybe_number(bar_range) or bar_range <= 0:
        return None

    range_atr = bar_range / float(data.atr14[index])
    if range_atr < min_range_atr or range_atr > max_range_atr:
        return None

    lower_wick = min(open_, close) - low
    upper_wick = high - max(open_, close)
    close_location = float(data.close_location[index])

    for level in round_number_levels(low, high, step, sweep_points):
        swept_support = low <= level + touch_points and low >= level - sweep_points
        reclaimed_support = close >= level + reclaim_points and previous_close >= level + reclaim_points
        support_wick = lower_wick / bar_range >= min_wick_pct and close_location >= 0.58
        if swept_support and reclaimed_support and support_wick and allowed_by_trend(data, index, 1, config.trend):
            signal = round_rejection_signal(
                strategy,
                data,
                index,
                asset,
                1,
                level,
                stop_buffer_points,
                min_risk_points,
                max_risk_points,
                config.rr,
                bar_range,
                lower_wick / bar_range,
            )
            if signal is not None:
                return signal

        swept_resistance = high >= level - touch_points and high <= level + sweep_points
        rejected_resistance = close <= level - reclaim_points and previous_close <= level - reclaim_points
        resistance_wick = upper_wick / bar_range >= min_wick_pct and close_location <= 0.42
        if swept_resistance and rejected_resistance and resistance_wick and allowed_by_trend(data, index, -1, config.trend):
            signal = round_rejection_signal(
                strategy,
                data,
                index,
                asset,
                -1,
                level,
                stop_buffer_points,
                min_risk_points,
                max_risk_points,
                config.rr,
                bar_range,
                upper_wick / bar_range,
            )
            if signal is not None:
                return signal

    return None


def evaluate_trendline_break(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig, config: RuntimeConfig
) -> dict[str, Any] | None:
    if not strategy_entry_window(data, index, config):
        return None
    if np.isnan(data.atr14[index]) or np.isnan(data.ema50[index]) or np.isnan(data.ema200[index]):
        return None

    lookback = max(48, int(config.range_minutes))
    trigger_window = max(8, min(32, int(config.entry_minutes / 15)))
    if index < lookback + trigger_window + 1:
        return None

    prior_start = index - lookback
    recent_start = index - trigger_window
    prior_high = float(np.max(data.high[prior_start:recent_start]))
    prior_low = float(np.min(data.low[prior_start:recent_start]))
    recent_high = float(np.max(data.high[recent_start:index]))
    recent_low = float(np.min(data.low[recent_start:index]))
    atr = float(data.atr14[index])
    buffer = atr * max(0.02, config.threshold)

    down_structure = data.close[prior_start] > data.close[recent_start] and recent_high <= prior_high + atr * 0.25
    up_structure = data.close[prior_start] < data.close[recent_start] and recent_low >= prior_low - atr * 0.25
    long_setup = down_structure and data.close[index] > recent_high + buffer and data.close[index] > data.ema50[index]
    short_setup = up_structure and data.close[index] < recent_low - buffer and data.close[index] < data.ema50[index]

    side = 1 if long_setup else -1 if short_setup else 0
    if side == 0 or not allowed_by_trend(data, index, side, config.trend):
        return None

    entry_price = round_price(float(data.close[index]), asset.tick_size)
    stop_loss = round_price(
        float(np.min(data.low[recent_start : index + 1]) - atr * config.sl_atr * 0.15)
        if side == 1
        else float(np.max(data.high[recent_start : index + 1]) + atr * config.sl_atr * 0.15),
        asset.tick_size,
    )
    return price_target_signal(entry_price, stop_loss, side, config.rr, asset)


def passes_echo_filters(strategy: BacktestStrategy, data: EnrichedData, index: int, side: int) -> bool:
    if np.isnan(data.ema30[index]) or np.isnan(data.ema200[index]) or np.isnan(data.close_ema200_atr[index]):
        return False
    abs_limit = strategy.abs_close_ema200_atr_max
    if abs_limit is not None and abs(data.close_ema200_atr[index]) > abs_limit:
        return False
    if strategy.phase == "mean_reversion":
        if np.isnan(data.rsi14_centered[index]):
            return False
        trade_rsi = side * float(data.rsi14_centered[index])
        if strategy.trade_rsi_min is not None and trade_rsi < strategy.trade_rsi_min:
            return False
        if strategy.trade_rsi_max is not None and trade_rsi > strategy.trade_rsi_max:
            return False
    return True


def safe_feature(value: float, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return parsed if maybe_number(parsed) else fallback


def echo_model_features(data: EnrichedData, index: int, side: int) -> tuple[float, ...] | None:
    if index < 5:
        return None
    atr100 = safe_feature(data.atr100[index])
    atr14 = safe_feature(data.atr14[index], atr100)
    if atr100 <= 0 or atr14 <= 0:
        return None
    close = float(data.close[index])
    ema30_value = safe_feature(data.ema30[index], close)
    ema200_value = safe_feature(data.ema200[index], close)
    close_location = safe_feature(data.close_location[index], 0.5)
    directional_close_location = close_location * 2.0 - 1.0 if side == 1 else (1.0 - close_location) * 2.0 - 1.0
    session_vwap = safe_feature(data.session_vwap[index], close)
    return (
        side * (ema30_value - ema200_value) / atr100,
        side * safe_feature(data.close_ema200_atr[index]),
        side * (close - float(data.close[index - 5])) / atr100,
        side * safe_feature(data.ret3_atr[index]),
        side * safe_feature(data.body_atr[index]),
        side * safe_feature(data.rsi14_centered[index]),
        side * ((safe_feature(data.rsi2[index], 50.0) - 50.0) / 50.0),
        side * safe_feature(data.bb_z20[index]),
        directional_close_location,
        side * (close - session_vwap) / atr14,
        (int(data.ny_minutes[index]) - 720) / 720,
        int(data.ny_weekdays[index]) / 4,
    )


def echo_model_score(model: EchoModel, data: EnrichedData, index: int, side: int) -> float | None:
    features = echo_model_features(data, index, side)
    if features is None:
        return None
    output = model.output_bias
    for weights, bias, output_weight in zip(model.hidden_weights, model.hidden_bias, model.output_weights, strict=True):
        hidden = bias
        for feature, mean, scale, weight in zip(features, model.feature_means, model.feature_scales, weights, strict=True):
            hidden += ((feature - mean) / scale) * weight
        output += math.tanh(hidden) * output_weight
    output = max(-30.0, min(30.0, output))
    return 1.0 / (1.0 + math.exp(-output))


def apply_echo_model_filter(strategy: BacktestStrategy, data: EnrichedData, index: int, side: int, signal: dict[str, Any]) -> dict[str, Any] | None:
    if strategy.echo_model is None:
        return signal
    score = echo_model_score(strategy.echo_model, data, index, side)
    if score is None or score < strategy.echo_model.threshold:
        return None
    filtered = dict(signal)
    filtered["score"] = score
    filtered["confidence"] = score
    return filtered


def echo_style_signal(strategy: BacktestStrategy, side: int) -> dict[str, Any]:
    return {
        "entry_mode": "market",
        "side": side,
        "tp_units": float(strategy.tp_units or 0.0),
        "sl_units": float(strategy.sl_units or 0.0),
    }


def evaluate_momentum(strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig) -> dict[str, Any] | None:
    long_allowed = passes_echo_filters(strategy, data, index, 1)
    short_allowed = passes_echo_filters(strategy, data, index, -1)

    multiplier = strategy.signal_atr_mult or 2.0
    lookback = strategy.recent_signal_lookback or 10
    side = 0
    if (
        long_allowed
        and data.ema30[index] > data.ema200[index]
        and move_signal(data, index, multiplier, upward=False)
        and no_recent_move_signal(data, index, lookback, multiplier, upward=False)
    ):
        side = 1
    elif (
        short_allowed
        and data.ema30[index] < data.ema200[index]
        and move_signal(data, index, multiplier, upward=True)
        and no_recent_move_signal(data, index, lookback, multiplier, upward=True)
    ):
        side = -1
    if side == 0:
        return None

    return apply_echo_model_filter(strategy, data, index, side, echo_style_signal(strategy, side))


def evaluate_mean_reversion(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig
) -> dict[str, Any] | None:
    long_allowed = passes_echo_filters(strategy, data, index, 1)
    short_allowed = passes_echo_filters(strategy, data, index, -1)

    multiplier = strategy.signal_atr_mult or 2.0
    lookback = strategy.recent_signal_lookback or 10
    side = 0
    if (
        long_allowed
        and data.ema30[index] < data.ema200[index]
        and move_signal(data, index, multiplier, upward=True)
        and no_recent_move_signal(data, index, lookback, multiplier, upward=True)
    ):
        side = 1
    elif (
        short_allowed
        and data.ema30[index] > data.ema200[index]
        and move_signal(data, index, multiplier, upward=False)
        and no_recent_move_signal(data, index, lookback, multiplier, upward=False)
    ):
        side = -1
    if side == 0:
        return None

    return apply_echo_model_filter(strategy, data, index, side, echo_style_signal(strategy, side))


def range_position(data: EnrichedData, index: int, range_bars: int) -> float | None:
    start = index - range_bars + 1
    if start < 0:
        return None
    range_high = float(np.max(data.high[start : index + 1]))
    range_low = float(np.min(data.low[start : index + 1]))
    range_size = range_high - range_low
    if not maybe_number(range_size) or range_size <= 0:
        return None
    return min(1.0, max(0.0, (float(data.close[index]) - range_low) / range_size))


def percentile_bucket(position: float, buckets: int) -> int:
    return min(buckets - 1, max(0, int(math.floor(position * buckets))))


def decile_for_position(position: float, buckets: int) -> int:
    return min(buckets, max(1, int(math.floor(position * buckets)) + 1))


def evaluate_percentile_range_study(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig, config: RuntimeConfig
) -> dict[str, Any] | None:
    range_bars = max(5, variant_int(strategy.variant_id, "range", 96))
    study_bars = max(50, variant_int(strategy.variant_id, "study", 480))
    horizon_bars = max(1, variant_int(strategy.variant_id, "horizon", 6))
    buckets = max(5, variant_int(strategy.variant_id, "buckets", 20))
    min_samples = max(3, variant_int(strategy.variant_id, "min_samples", 12))
    edge_ticks = max(0.0, variant_float(strategy.variant_id, "edge_ticks", 8.0))

    if asset.tick_size <= 0 or index < range_bars + horizon_bars + min_samples:
        return None

    current_position = range_position(data, index, range_bars)
    if current_position is None:
        return None
    target_bucket = percentile_bucket(current_position, buckets)

    first_sample = max(range_bars - 1, index - horizon_bars - study_bars + 1)
    last_sample = index - horizon_bars
    samples = 0
    total_ticks = 0.0
    for sample_index in range(first_sample, last_sample + 1):
        sample_position = range_position(data, sample_index, range_bars)
        if sample_position is None or percentile_bucket(sample_position, buckets) != target_bucket:
            continue
        total_ticks += (float(data.close[sample_index + horizon_bars]) - float(data.close[sample_index])) / asset.tick_size
        samples += 1

    if samples < min_samples:
        return None

    average_ticks = total_ticks / samples
    if abs(average_ticks) < edge_ticks:
        return None

    side = 1 if average_ticks > 0 else -1
    if not allowed_by_trend(data, index, side, config.trend):
        return None

    return {
        "entry_mode": "market",
        "side": side,
        "tp_units": float(strategy.tp_units or 0.0),
        "sl_units": float(strategy.sl_units or 0.0),
        "score": abs(average_ticks),
        "confidence": min(0.99, abs(average_ticks) / max(edge_ticks, 1.0)),
    }


def evaluate_decile_forward_edge(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig, config: RuntimeConfig
) -> dict[str, Any] | None:
    range_bars = max(5, variant_int(strategy.variant_id, "range", 96))
    buckets = max(5, variant_int(strategy.variant_id, "buckets", 10))
    long_deciles = variant_deciles(strategy.variant_id, "long", {10})
    short_deciles = variant_deciles(strategy.variant_id, "short", {1})

    current_position = range_position(data, index, range_bars)
    prior_position = range_position(data, index - 1, range_bars) if index > 0 else None
    if current_position is None:
        return None
    current_decile = decile_for_position(current_position, buckets)
    prior_decile = decile_for_position(prior_position, buckets) if prior_position is not None else 0
    if current_decile == prior_decile:
        return None

    side = 0
    if current_decile in long_deciles:
        side = 1
    elif current_decile in short_deciles:
        side = -1
    if side == 0 or not allowed_by_trend(data, index, side, config.trend):
        return None

    return {
        "entry_mode": "market",
        "side": side,
        "tp_units": float(strategy.tp_units or 0.0),
        "sl_units": float(strategy.sl_units or 0.0),
        "score": float(current_decile),
    }


def moving_average_parts(strategy: BacktestStrategy) -> tuple[str, int]:
    raw = (variant_value(strategy.variant_id, "ma") or "SMA20").upper()
    kind = raw[:3] if raw.startswith(("EMA", "SMA")) else "SMA"
    try:
        length = int(raw[3:])
    except ValueError:
        length = 20
    return kind, max(2, length)


def moving_average_value(data: EnrichedData, index: int, kind: str, length: int) -> float:
    if index < 0:
        return math.nan
    if kind == "SMA":
        if index + 1 < length:
            return math.nan
        return float(np.mean(data.close[index - length + 1 : index + 1]))
    if length == 9:
        return float(data.ema9[index])
    if length == 21:
        return float(data.ema21[index])
    if length == 30:
        return float(data.ema30[index])
    if length == 34:
        return float(data.ema34[index])
    if length == 50:
        return float(data.ema50[index])
    if length == 200:
        return float(data.ema200[index])

    values = data.close[: index + 1]
    if values.shape[0] == 0:
        return math.nan
    alpha = 2.0 / (length + 1.0)
    current = float(values[0])
    for value in values[1:]:
        current = alpha * float(value) + (1.0 - alpha) * current
    return current


def moving_average_touched(data: EnrichedData, index: int, average: float, setup_side: str) -> bool:
    if not maybe_number(average):
        return False
    if setup_side == "resistance_short":
        return bool(data.high[index] >= average and data.close[index] <= average)
    return bool(data.low[index] <= average and data.close[index] >= average)


def evaluate_moving_average_touch(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig, config: RuntimeConfig
) -> dict[str, Any] | None:
    if index <= 0:
        return None
    kind, length = moving_average_parts(strategy)
    setup_side = variant_value(strategy.variant_id, "side") or "support_long"
    if setup_side not in {"support_long", "resistance_short"}:
        setup_side = "support_long"

    average = moving_average_value(data, index, kind, length)
    prior_average = moving_average_value(data, index - 1, kind, length)
    if not maybe_number(average) or not maybe_number(prior_average):
        return None

    if setup_side == "support_long":
        if data.close[index - 1] <= prior_average or not moving_average_touched(data, index, average, setup_side):
            return None
        side = 1
    else:
        if data.close[index - 1] >= prior_average or not moving_average_touched(data, index, average, setup_side):
            return None
        side = -1

    if variant_value(strategy.variant_id, "fresh") != "0" and moving_average_touched(data, index - 1, prior_average, setup_side):
        return None
    if not allowed_by_trend(data, index, side, config.trend):
        return None

    return {
        "entry_mode": "market",
        "side": side,
        "tp_units": float(strategy.tp_units or 0.0),
        "sl_units": float(strategy.sl_units or 0.0),
    }


def average_parts_from_token(raw: str, fallback: str) -> tuple[str, int]:
    token = (raw or fallback).upper()
    kind = token[:3] if token.startswith(("EMA", "SMA")) else fallback[:3]
    try:
        length = int(token[3:])
    except ValueError:
        length = int(fallback[3:])
    return kind, max(2, length)


def evaluate_moving_average_crossover(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig, config: RuntimeConfig
) -> dict[str, Any] | None:
    if index <= 0:
        return None

    fast_kind, fast_length = average_parts_from_token(variant_value(strategy.variant_id, "fast") or "", "SMA50")
    slow_kind, slow_length = average_parts_from_token(variant_value(strategy.variant_id, "slow") or "", "SMA200")
    direction = variant_value(strategy.variant_id, "direction") or "long"

    fast_now = moving_average_value(data, index, fast_kind, fast_length)
    slow_now = moving_average_value(data, index, slow_kind, slow_length)
    fast_prior = moving_average_value(data, index - 1, fast_kind, fast_length)
    slow_prior = moving_average_value(data, index - 1, slow_kind, slow_length)
    if not all(maybe_number(value) for value in (fast_now, slow_now, fast_prior, slow_prior)):
        return None

    side = 0
    if direction in {"long", "both"} and fast_prior <= slow_prior and fast_now > slow_now:
        side = 1
    elif direction in {"short", "both"} and fast_prior >= slow_prior and fast_now < slow_now:
        side = -1
    if side == 0:
        return None

    return {
        "entry_mode": "market",
        "side": side,
        "tp_units": float(strategy.tp_units or 0.0),
        "sl_units": float(strategy.sl_units or 0.0),
    }


def evaluate_reddit_capitulation_reversion(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig, config: RuntimeConfig
) -> dict[str, Any] | None:
    if data.ny_minutes[index] < 9 * 60 + 30 or data.ny_minutes[index] > 15 * 60:
        return None
    required = [data.ema50[index], data.ema200[index], data.ret3_atr[index], data.bb_z20[index], data.close_location[index], data.rsi2[index]]
    if any(np.isnan(value) for value in required):
        return None

    long_setup = (
        data.close[index] > data.ema200[index]
        and data.ema50[index] > data.ema200[index]
        and data.ret3_atr[index] <= -config.threshold
        and data.bb_z20[index] <= -1.75
        and data.close_location[index] <= 0.35
        and (config.rsi2_max is None or data.rsi2[index] <= config.rsi2_max)
    )
    short_setup = (
        config.trend == "both"
        and data.close[index] < data.ema200[index]
        and data.ema50[index] < data.ema200[index]
        and data.ret3_atr[index] >= config.threshold
        and data.bb_z20[index] >= 1.75
        and data.close_location[index] >= 0.65
        and (config.rsi2_max is None or data.rsi2[index] >= 100.0 - config.rsi2_max)
    )
    side = 1 if long_setup else -1 if short_setup else 0
    if side == 0:
        return None

    entry_price = round_price(float(data.close[index]), asset.tick_size)
    stop_distance = entry_price * 0.003
    stop_loss = round_price(entry_price - side * stop_distance, asset.tick_size)
    return {
        "entry_mode": "market",
        "side": side,
        "reference_entry_price": entry_price,
        "stop_loss": stop_loss,
        "risk_reward": config.rr,
    }


def evaluate_reddit_ema_pullback(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig, config: RuntimeConfig
) -> dict[str, Any] | None:
    required = [
        data.ema9[index],
        data.ema21[index],
        data.ema34[index],
        data.ema50[index],
        data.ema200[index],
        data.atr14[index],
        data.body_atr[index],
    ]
    if any(np.isnan(value) for value in required):
        return None

    open_minutes = 9 * 60 + 30 if config.session == "all" else SESSION_OPEN_MINUTES[config.session]
    session_end = min(open_minutes + 210, 15 * 60)
    if data.ny_minutes[index] < open_minutes or data.ny_minutes[index] > session_end:
        return None

    long_setup = (
        data.ema21[index] > data.ema50[index]
        and data.ema50[index] > data.ema200[index]
        and data.low[index] <= data.ema21[index]
        and data.close[index] > data.ema9[index]
        and data.body_atr[index] > 0
    )
    short_setup = (
        data.ema21[index] < data.ema50[index]
        and data.ema50[index] < data.ema200[index]
        and data.high[index] >= data.ema21[index]
        and data.close[index] < data.ema9[index]
        and data.body_atr[index] < 0
    )
    side = 1 if long_setup else -1 if short_setup else 0
    if side == 0:
        return None

    entry_price = round_price(float(data.close[index]), asset.tick_size)
    stop_distance = max(config.sl_atr * data.atr14[index], abs(entry_price - data.ema34[index]))
    if not maybe_number(stop_distance) or stop_distance <= 0:
        return None
    stop_loss = round_price(entry_price - side * stop_distance, asset.tick_size)
    return {
        "entry_mode": "market",
        "side": side,
        "reference_entry_price": entry_price,
        "stop_loss": stop_loss,
        "risk_reward": config.rr,
    }


def orb_window(data: EnrichedData, index: int, config: RuntimeConfig) -> tuple[int, int, int, int] | None:
    if config.session == "all":
        return None
    open_minutes = SESSION_OPEN_MINUTES[config.session]
    range_end_minutes = open_minutes + config.range_minutes
    entry_end_minutes = range_end_minutes + config.entry_minutes
    if data.ny_minutes[index] < range_end_minutes or data.ny_minutes[index] > entry_end_minutes:
        return None

    bounds = data.day_bounds.get(data.ny_dates[index])
    if not bounds:
        return None
    start, end = bounds
    range_indices = [
        cursor for cursor in range(start, end) if open_minutes <= data.ny_minutes[cursor] < range_end_minutes
    ]
    entry_indices = [
        cursor for cursor in range(start, end) if range_end_minutes <= data.ny_minutes[cursor] <= entry_end_minutes
    ]
    if not range_indices or not entry_indices:
        return None
    return range_indices[0], range_indices[-1], entry_indices[0], entry_indices[-1]


def evaluate_reddit_orb_breakout(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig, config: RuntimeConfig
) -> dict[str, Any] | None:
    window = orb_window(data, index, config)
    if not window:
        return None
    range_start, range_end, _entry_start, _entry_end = window
    or_high = float(np.max(data.high[range_start : range_end + 1]))
    or_low = float(np.min(data.low[range_start : range_end + 1]))
    or_range = or_high - or_low
    atr = data.atr14[range_end]
    if np.isnan(atr) or atr == 0.0 or or_range < atr * 0.15 or or_range > atr * 3.5:
        return None

    side = 1 if data.close[index] > or_high else -1 if data.close[index] < or_low else 0
    if side == 0 or not allowed_by_trend(data, index, side, config.trend):
        return None
    entry_price = round_price(float(data.close[index]), asset.tick_size)
    stop_loss = round_price(or_low if side == 1 else or_high, asset.tick_size)
    risk = abs(entry_price - stop_loss)
    if risk <= 0:
        return None
    return {
        "entry_mode": "market",
        "side": side,
        "reference_entry_price": entry_price,
        "stop_loss": stop_loss,
        "risk_reward": config.rr,
    }


def evaluate_reddit_orb_retest(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig, config: RuntimeConfig
) -> dict[str, Any] | None:
    window = orb_window(data, index, config)
    if not window:
        return None
    range_start, range_end, entry_start, _entry_end = window
    or_high = float(np.max(data.high[range_start : range_end + 1]))
    or_low = float(np.min(data.low[range_start : range_end + 1]))
    or_range = or_high - or_low
    atr = data.atr14[range_end]
    if np.isnan(atr) or atr == 0.0 or or_range < atr * 0.15 or or_range > atr * 3.5:
        return None

    breakout_side = 0
    breakout_level = 0.0
    breakout_index = -1
    for cursor in range(entry_start, index + 1):
        if breakout_side == 0:
            side = 1 if data.close[cursor] > or_high else -1 if data.close[cursor] < or_low else 0
            if side == 0 or not allowed_by_trend(data, cursor, side, config.trend):
                continue
            breakout_side = side
            breakout_level = or_high if side == 1 else or_low
            breakout_index = cursor
            continue

        if cursor - breakout_index > 8:
            return None
        touched = data.low[cursor] <= breakout_level <= data.high[cursor]
        confirmed = data.close[cursor] > breakout_level if breakout_side == 1 else data.close[cursor] < breakout_level
        if not touched or not confirmed:
            continue
        if cursor != index:
            return None

        entry_price = round_price(float(data.close[cursor]), asset.tick_size)
        stop_loss = round_price(
            min(data.low[cursor], or_low) if breakout_side == 1 else max(data.high[cursor], or_high),
            asset.tick_size,
        )
        risk = abs(entry_price - stop_loss)
        if risk <= 0:
            return None
        return {
            "entry_mode": "market",
            "side": breakout_side,
            "reference_entry_price": entry_price,
            "stop_loss": stop_loss,
            "risk_reward": config.rr,
        }
    return None


def evaluate_ict_turtle_soup(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig, config: RuntimeConfig
) -> dict[str, Any] | None:
    atr = data.atr14[index]
    if np.isnan(atr):
        return None
    session_start, session_end = session_minutes(config)
    if data.ny_minutes[index] < session_start or data.ny_minutes[index] > session_end:
        return None
    prior_high = data.prior_day_high[index]
    prior_low = data.prior_day_low[index]
    if np.isnan(prior_high) or np.isnan(prior_low):
        return None

    side = 0
    stop_loss = 0.0
    if data.high[index] > prior_high and data.close[index] < prior_high and data.high[index] - prior_high >= atr * config.threshold:
        side = -1
        stop_loss = data.high[index] + atr * 0.08
    elif data.low[index] < prior_low and data.close[index] > prior_low and prior_low - data.low[index] >= atr * config.threshold:
        side = 1
        stop_loss = data.low[index] - atr * 0.08
    if side == 0 or not allowed_by_trend(data, index, side, config.trend):
        return None

    entry_price = round_price(float(data.close[index]), asset.tick_size)
    stop_loss = round_price(stop_loss, asset.tick_size)
    risk = abs(entry_price - stop_loss)
    if risk <= atr * 0.05:
        return None
    return {
        "entry_mode": "market",
        "side": side,
        "reference_entry_price": entry_price,
        "stop_loss": stop_loss,
        "risk_reward": config.rr,
    }


def evaluate_ict_sweep_fvg(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig, config: RuntimeConfig
) -> dict[str, Any] | None:
    if index < 2 or not strategy_entry_window(data, index, config):
        return None
    for sweep_index in range(max(100, index - 4), index):
        prior_high = data.prior_day_high[sweep_index]
        prior_low = data.prior_day_low[sweep_index]
        atr = data.atr100[sweep_index]
        if np.isnan(prior_high) or np.isnan(prior_low) or np.isnan(atr):
            continue

        side = 0
        sweep_extreme = 0.0
        if data.high[sweep_index] > prior_high + asset.tick_size and data.close[sweep_index] < prior_high:
            side = -1
            sweep_extreme = float(data.high[sweep_index])
        elif data.low[sweep_index] < prior_low - asset.tick_size and data.close[sweep_index] > prior_low:
            side = 1
            sweep_extreme = float(data.low[sweep_index])
        if side == 0:
            continue

        body = abs(data.close[index] - data.open[index])
        bearish_fvg = data.high[index] < data.low[index - 2]
        bullish_fvg = data.low[index] > data.high[index - 2]
        is_bear = (
            side == -1
            and data.close[index] < data.open[index]
            and data.close[index] < prior_high
            and body > 0.35 * atr
            and bearish_fvg
        )
        is_bull = (
            side == 1
            and data.close[index] > data.open[index]
            and data.close[index] > prior_low
            and body > 0.35 * atr
            and bullish_fvg
        )
        if not is_bear and not is_bull:
            continue

        impulse_high = float(np.max(data.high[sweep_index : index + 1]))
        impulse_low = float(np.min(data.low[sweep_index : index + 1]))
        impulse_range = impulse_high - impulse_low
        entry_price = (
            impulse_low + impulse_range * 0.705 if side == -1 else impulse_high - impulse_range * 0.705
        )
        entry_price = round_price(entry_price, asset.tick_size)
        stop_loss = round_price(sweep_extreme + asset.tick_size if side == -1 else sweep_extreme - asset.tick_size, asset.tick_size)
        if (side == -1 and entry_price >= stop_loss) or (side == 1 and entry_price <= stop_loss):
            continue
        sl_units = signal_units(entry_price, stop_loss, asset.tick_size)
        tp_units = sl_units * (strategy.ict_risk_reward if strategy.ict_risk_reward is not None else config.rr)
        take_profit = round_price(entry_price + side * tp_units * asset.tick_size, asset.tick_size)
        return {
            "entry_mode": "limit",
            "side": side,
            "entry_price": entry_price,
            "take_profit": take_profit,
            "stop_loss": stop_loss,
            "tp_units": signal_units(entry_price, take_profit, asset.tick_size),
            "sl_units": sl_units,
        }
    return None


NY_SWEEP_START_MINUTES = 7 * 60
NY_SWEEP_END_MINUTES = 10 * 60
NY_SWEEP_SWING_WIDTH = 4
NY_SWEEP_SWING_LOOKBACK = 20
NY_SWEEP_MAX_TESTS = 3
NY_SWEEP_BUFFER_UNITS = 5.0
NY_SWEEP_MAX_RISK_UNITS = 30.0
NY_SWEEP_MIN_RISK_UNITS = 0.0


def is_ny_sweep_swing_high(data: EnrichedData, index: int) -> bool:
    if index < NY_SWEEP_SWING_WIDTH or index + NY_SWEEP_SWING_WIDTH >= data.high.shape[0]:
        return False
    level = data.high[index]
    for cursor in range(index - NY_SWEEP_SWING_WIDTH, index):
        if level <= data.high[cursor]:
            return False
    for cursor in range(index + 1, index + NY_SWEEP_SWING_WIDTH + 1):
        if level < data.high[cursor]:
            return False
    return True


def is_ny_sweep_swing_low(data: EnrichedData, index: int) -> bool:
    if index < NY_SWEEP_SWING_WIDTH or index + NY_SWEEP_SWING_WIDTH >= data.low.shape[0]:
        return False
    level = data.low[index]
    for cursor in range(index - NY_SWEEP_SWING_WIDTH, index):
        if level >= data.low[cursor]:
            return False
    for cursor in range(index + 1, index + NY_SWEEP_SWING_WIDTH + 1):
        if level > data.low[cursor]:
            return False
    return True


def ny_sweep_prior_test_count(data: EnrichedData, side: int, level: float, start_index: int, end_index: int, tick_size: float) -> int:
    count = 0
    for cursor in range(start_index, end_index):
        if side == -1 and data.high[cursor] >= level - tick_size * 0.1:
            count += 1
        elif side == 1 and data.low[cursor] <= level + tick_size * 0.1:
            count += 1
    return count


def ny_sweep_model(strategy: BacktestStrategy) -> str:
    model = variant_value(strategy.variant_id, "model") or "logit"
    return model if model in {"logit", "bayes", "stump"} else "logit"


def sigmoid(value: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-60.0, min(60.0, value))))


def ny_sweep_candidate_features(
    data: EnrichedData,
    index: int,
    asset: AssetConfig,
    side: int,
    swing_index: int,
    level: float,
    sweep_extreme: float,
    entry_price: float,
    stop_loss: float,
) -> dict[str, float]:
    risk = abs(entry_price - stop_loss)
    risk_units = risk / asset.tick_size if asset.tick_size else 0.0
    atr = data.atr14[index] if maybe_number(data.atr14[index]) and data.atr14[index] > 0 else risk
    tests = ny_sweep_prior_test_count(data, side, level, swing_index + 1, index, asset.tick_size)
    trend = 0.0
    if maybe_number(data.ema50[index]) and maybe_number(data.ema200[index]):
        trend = 1.0 if (side == 1 and data.ema50[index] > data.ema200[index]) or (side == -1 and data.ema50[index] < data.ema200[index]) else -0.5
    close_location = float(data.close_location[index]) if maybe_number(data.close_location[index]) else 0.5
    rsi2 = float(data.rsi2[index]) if maybe_number(data.rsi2[index]) else 50.0
    return {
        "wick": min(2.0, abs(sweep_extreme - level) / asset.tick_size / max(risk_units, 1.0)),
        "reclaim": min(2.0, abs(data.close[index] - level) / asset.tick_size / max(risk_units, 1.0)),
        "fresh": max(0.0, (NY_SWEEP_SWING_LOOKBACK + 1 - (index - swing_index)) / NY_SWEEP_SWING_LOOKBACK),
        "tests": float(tests),
        "test_penalty": min(1.0, tests / NY_SWEEP_MAX_TESTS),
        "body": side * (data.close[index] - data.open[index]) / atr if atr else 0.0,
        "trend": trend,
        "close_location": close_location if side == 1 else 1.0 - close_location,
        "rsi": max(-1.0, min(1.0, (50.0 - rsi2) / 50.0 if side == 1 else (rsi2 - 50.0) / 50.0)),
        "atr_risk": risk / atr if atr else 1.0,
    }


def ny_sweep_score(model: str, features: dict[str, float]) -> float:
    if model == "logit":
        return sigmoid(
            -0.95
            + 0.75 * features["wick"]
            + 0.45 * features["reclaim"]
            + 0.50 * features["body"]
            + 0.30 * features["fresh"]
            - 0.45 * features["test_penalty"]
            + 0.20 * features["trend"]
            + 0.20 * features["close_location"]
            + 0.22 * features["rsi"]
            - 0.12 * max(0.0, features["atr_risk"] - 1.0)
        )
    if model == "bayes":
        log_odds = -0.55
        log_odds += 0.40 if features["wick"] >= 0.25 else -0.10
        log_odds += 0.35 if features["body"] >= 0.05 else -0.05
        log_odds += 0.25 if features["fresh"] >= 0.45 else -0.15
        log_odds += 0.20 if features["tests"] <= 1 else -0.25 if features["tests"] >= 3 else 0.0
        log_odds += 0.20 if features["close_location"] >= 0.55 else -0.05
        log_odds += 0.15 if features["rsi"] > 0.0 else -0.05
        log_odds += 0.12 if features["trend"] > 0.0 else -0.08 if features["trend"] < 0.0 else 0.0
        return sigmoid(log_odds)

    score = 0.50
    if features["wick"] >= 0.35 and features["body"] >= 0.05 and features["tests"] <= 1:
        score = 0.68
    elif features["wick"] >= 0.20 and features["fresh"] >= 0.50 and features["tests"] <= 2:
        score = 0.61
    elif features["tests"] >= 3 or features["atr_risk"] > 1.80:
        score = 0.43
    if features["close_location"] >= 0.65:
        score += 0.04
    if features["rsi"] >= 0.25:
        score += 0.03
    if features["trend"] < 0.0:
        score -= 0.04
    return max(0.01, min(0.99, score))


def build_ny_sweep_candidate(
    strategy: BacktestStrategy,
    data: EnrichedData,
    index: int,
    asset: AssetConfig,
    config: RuntimeConfig,
    side: int,
    swing_index: int,
    level: float,
    sweep_extreme: float,
    stop_loss: float,
) -> dict[str, Any] | None:
    entry_price = round_price(float(data.close[index]), asset.tick_size)
    risk = abs(entry_price - stop_loss)
    risk_units = risk / asset.tick_size if asset.tick_size else 0.0
    min_risk_units = variant_float(strategy.variant_id, "risk_min", NY_SWEEP_MIN_RISK_UNITS)
    max_risk_units = variant_float(strategy.variant_id, "risk_max", NY_SWEEP_MAX_RISK_UNITS)
    if risk <= 0.0 or risk_units < min_risk_units or risk_units > max_risk_units:
        return None
    max_tests = int(variant_float(strategy.variant_id, "max_tests", float(NY_SWEEP_MAX_TESTS)))
    tests = ny_sweep_prior_test_count(data, side, level, swing_index + 1, index, asset.tick_size)
    if tests > max_tests:
        return None

    model = ny_sweep_model(strategy)
    threshold = variant_float(strategy.variant_id, "min", 0.60)
    features = ny_sweep_candidate_features(data, index, asset, side, swing_index, level, sweep_extreme, entry_price, stop_loss)
    if features["wick"] < variant_float(strategy.variant_id, "min_wick", 0.0):
        return None
    score = ny_sweep_score(model, features)
    if score < threshold:
        return None

    risk_reward = variant_float(strategy.variant_id, "rr", config.rr)
    return {
        "entry_mode": "market",
        "side": side,
        "reference_entry_price": entry_price,
        "stop_loss": stop_loss,
        "risk_reward": risk_reward,
        "min_risk_units": min_risk_units,
        "max_risk_units": max_risk_units,
        "score": score,
        "swing_index": swing_index,
        "tests": tests,
    }


def evaluate_ny_sweep_playbook(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig, config: RuntimeConfig
) -> dict[str, Any] | None:
    if index < 30 or asset.tick_size <= 0:
        return None
    if data.ny_weekdays[index] > 4:
        return None
    start_minutes = int(variant_float(strategy.variant_id, "start", float(NY_SWEEP_START_MINUTES)))
    end_minutes = int(variant_float(strategy.variant_id, "end", float(NY_SWEEP_END_MINUTES)))
    if data.ny_minutes[index] < start_minutes or data.ny_minutes[index] > end_minutes:
        return None

    buffer = NY_SWEEP_BUFFER_UNITS * asset.tick_size
    best: dict[str, Any] | None = None
    for swing_index in range(max(NY_SWEEP_SWING_WIDTH, index - NY_SWEEP_SWING_LOOKBACK), index - NY_SWEEP_SWING_WIDTH + 1):
        if is_ny_sweep_swing_high(data, swing_index) and data.high[index] > data.high[swing_index] + asset.tick_size * 0.1 and data.close[index] < data.high[swing_index]:
            stop_loss = round_price(float(data.high[index] + buffer), asset.tick_size)
            candidate = build_ny_sweep_candidate(
                strategy, data, index, asset, config, -1, swing_index, float(data.high[swing_index]), float(data.high[index]), stop_loss
            )
            if candidate is not None and (best is None or candidate["score"] > best["score"]):
                best = candidate

        if is_ny_sweep_swing_low(data, swing_index) and data.low[index] < data.low[swing_index] - asset.tick_size * 0.1 and data.close[index] > data.low[swing_index]:
            stop_loss = round_price(float(data.low[index] - buffer), asset.tick_size)
            candidate = build_ny_sweep_candidate(
                strategy, data, index, asset, config, 1, swing_index, float(data.low[swing_index]), float(data.low[index]), stop_loss
            )
            if candidate is not None and (best is None or candidate["score"] > best["score"]):
                best = candidate

    return best


def evaluate_strategy_signal(
    strategy: BacktestStrategy,
    data: EnrichedData,
    index: int,
    asset: AssetConfig,
    config: RuntimeConfig,
    strict_window: bool = True,
) -> dict[str, Any] | None:
    index = anti_cheat_signal_index(data, index, strict=strict_window)
    signal: dict[str, Any] | None = None
    if strategy.phase == "momentum":
        signal = evaluate_momentum(strategy, data, index, asset)
    elif strategy.phase == "mean_reversion":
        signal = evaluate_mean_reversion(strategy, data, index, asset)
    elif strategy.phase == "percentile_range_study":
        signal = evaluate_percentile_range_study(strategy, data, index, asset, config)
    elif strategy.phase == "decile_forward_edge":
        signal = evaluate_decile_forward_edge(strategy, data, index, asset, config)
    elif strategy.phase == "moving_average_touch":
        signal = evaluate_moving_average_touch(strategy, data, index, asset, config)
    elif strategy.phase == "moving_average_crossover":
        signal = evaluate_moving_average_crossover(strategy, data, index, asset, config)
    elif strategy.phase == "parabolic_fade":
        signal = evaluate_parabolic_fade(strategy, data, index, asset, config)
    elif strategy.phase == "vwap_pullback":
        signal = evaluate_vwap_pullback(strategy, data, index, asset, config)
    elif strategy.phase == "support_resistance_retest":
        signal = evaluate_support_resistance_retest(strategy, data, index, asset, config)
    elif strategy.phase == "round_number_rejection":
        signal = evaluate_round_number_rejection(strategy, data, index, asset, config)
    elif strategy.phase == "trendline_break":
        signal = evaluate_trendline_break(strategy, data, index, asset, config)
    elif strategy.phase == "tori_trendline_mtf":
        signal = evaluate_tori_trendline_mtf(strategy, data, index, asset)
    elif strategy.phase == "competition_session_edge":
        signal = evaluate_competition_session_edge(strategy, data, index, asset)
    if strategy.phase == "ict_sweep_fvg":
        signal = evaluate_ict_sweep_fvg(strategy, data, index, asset, config)
    elif strategy.phase == "ict_turtle_soup":
        signal = evaluate_ict_turtle_soup(strategy, data, index, asset, config)
    elif strategy.phase == "ny_sweep_playbook":
        signal = evaluate_ny_sweep_playbook(strategy, data, index, asset, config)
    elif strategy.phase == "reddit_capitulation_reversion":
        signal = evaluate_reddit_capitulation_reversion(strategy, data, index, asset, config)
    elif strategy.phase in {"reddit_ema_pullback", "ma_pullback", "ema_rider"}:
        signal = evaluate_reddit_ema_pullback(strategy, data, index, asset, config)
    elif strategy.phase == "reddit_orb_breakout":
        signal = evaluate_reddit_orb_breakout(strategy, data, index, asset, config)
    elif strategy.phase == "reddit_orb_retest":
        signal = evaluate_reddit_orb_retest(strategy, data, index, asset, config)
    elif signal is None and strategy.phase not in {
        "momentum",
        "mean_reversion",
        "percentile_range_study",
        "decile_forward_edge",
        "moving_average_touch",
        "moving_average_crossover",
        "parabolic_fade",
        "vwap_pullback",
        "support_resistance_retest",
        "round_number_rejection",
        "trendline_break",
        "tori_trendline_mtf",
        "competition_session_edge",
    }:
        raise ValueError(f"Unsupported strategy phase: {strategy.phase}")

    if signal is None or not strategy.invert_signal:
        return signal

    inverted = dict(signal)
    inverted["side"] = -int(signal["side"])
    if "tp_units" in signal and "sl_units" in signal:
        inverted["tp_units"] = float(signal.get("sl_units", 0.0))
        inverted["sl_units"] = float(signal.get("tp_units", 0.0))
    if "take_profit" in signal and "stop_loss" in signal:
        inverted["take_profit"] = float(signal["stop_loss"])
        inverted["stop_loss"] = float(signal["take_profit"])
    elif "risk_reward" in signal and "stop_loss" in signal and "reference_entry_price" in signal:
        reference_entry = round_price(float(signal["reference_entry_price"]), asset.tick_size)
        reference_stop = round_price(float(signal["stop_loss"]), asset.tick_size)
        risk_reward = float(signal["risk_reward"])
        reference_take_profit = round_price(
            reference_entry + int(signal["side"]) * abs(reference_entry - reference_stop) * risk_reward,
            asset.tick_size,
        )
        inverted["stop_loss"] = reference_take_profit
        inverted["risk_reward"] = risk_reward
    elif "stop_loss" in signal:
        return None
    return inverted


def signal_confidence(signal: dict[str, Any]) -> float | None:
    for key in ("confidence", "score"):
        raw_value = signal.get(key)
        try:
            parsed = float(raw_value)
        except (TypeError, ValueError):
            continue
        if 0.0 <= parsed <= 1.0:
            return parsed
    return None


def resolve_stop_loss_from_policy(policy: StopLossPolicy, data: EnrichedData, index: int, side: int, asset: AssetConfig) -> float | None:
    if policy.mode == "signal_extreme":
        reference = float(data.low[index]) if side == 1 else float(data.high[index])
    elif policy.mode == "prior_day_extreme":
        reference = float(data.prior_day_low[index]) if side == 1 else float(data.prior_day_high[index])
    else:
        return None
    if not maybe_number(reference):
        return None
    adjustment = policy.buffer_units * asset.tick_size
    price = reference - adjustment if side == 1 else reference + adjustment
    return round_price(price, asset.tick_size)


def resolve_take_profit_from_policy(policy: TakeProfitPolicy, data: EnrichedData, index: int, side: int, asset: AssetConfig) -> float | None:
    if policy.mode == "signal_extreme":
        reference = float(data.high[index]) if side == 1 else float(data.low[index])
    elif policy.mode == "prior_day_extreme":
        reference = float(data.prior_day_high[index]) if side == 1 else float(data.prior_day_low[index])
    else:
        return None
    if not maybe_number(reference):
        return None
    adjustment = policy.buffer_units * asset.tick_size
    price = reference + adjustment if side == 1 else reference - adjustment
    return round_price(price, asset.tick_size)


def interpolate_size_multiplier(policy: SizePolicy, confidence: float) -> float:
    clipped = min(max(confidence, policy.min_confidence), policy.max_confidence)
    span = policy.max_confidence - policy.min_confidence
    pct = 0.0 if span <= 0 else (clipped - policy.min_confidence) / span
    return round(policy.min_multiplier + (policy.max_multiplier - policy.min_multiplier) * pct, 2)


def normalize_strategy_signal(
    strategy: BacktestStrategy,
    signal: dict[str, Any],
    data: EnrichedData,
    index: int,
    asset: AssetConfig,
    strict_window: bool = True,
) -> dict[str, Any] | None:
    index = anti_cheat_signal_index(data, index, strict=strict_window)
    entry_mode = signal.get("entry_mode", "market")
    if entry_mode not in ENTRY_MODES:
        raise ValueError(f"Unsupported entry_mode '{entry_mode}' for strategy {strategy.id}")
    side = int(signal.get("side", 0))
    if side not in {-1, 1}:
        raise ValueError(f"Unsupported signal side '{signal.get('side')}' for strategy {strategy.id}")

    normalized = dict(signal)
    normalized["entry_mode"] = entry_mode
    normalized["side"] = side

    if strategy.stop_loss_policy is not None:
        stop_loss = resolve_stop_loss_from_policy(strategy.stop_loss_policy, data, index, side, asset)
        if stop_loss is None:
            return None
        normalized["stop_loss"] = stop_loss
        normalized.pop("sl_units", None)

    if strategy.take_profit_policy is not None:
        if strategy.take_profit_policy.mode == "risk_multiple":
            normalized["risk_reward"] = float(strategy.take_profit_policy.reward_multiple)
            normalized.pop("take_profit", None)
            normalized.pop("tp_units", None)
        else:
            take_profit = resolve_take_profit_from_policy(strategy.take_profit_policy, data, index, side, asset)
            if take_profit is None:
                return None
            normalized["take_profit"] = take_profit
            normalized.pop("tp_units", None)

    if entry_mode == "market":
        normalized.pop("entry_price", None)
    else:
        entry_price = normalized.get("entry_price")
        if entry_price is None or not maybe_number(float(entry_price)):
            raise ValueError(f"Limit strategy {strategy.id} returned an invalid entry_price")
        normalized["entry_price"] = round_price(float(entry_price), asset.tick_size)

    if strategy.size_policy is not None:
        confidence = signal_confidence(normalized)
        if confidence is None:
            raise ValueError(f"Strategy {strategy.id} uses sizePolicy but did not emit score/confidence")
        normalized["size_multiplier"] = interpolate_size_multiplier(strategy.size_policy, confidence)
    elif strategy.size_multiplier is not None and strategy.size_multiplier > 0:
        normalized["size_multiplier"] = round(float(strategy.size_multiplier), 2)

    normalized["tp_mode"] = (
        PRICE_MODE_CUSTOM
        if strategy.take_profit_policy is not None
        or strategy.dynamic_take_profit_policy is not None
        or "take_profit" in normalized
        or "risk_reward" in normalized
        else PRICE_MODE_FIXED
    )
    normalized["sl_mode"] = (
        PRICE_MODE_CUSTOM
        if strategy.stop_loss_policy is not None or strategy.dynamic_stop_loss_policy is not None or "stop_loss" in normalized
        else PRICE_MODE_FIXED
    )
    normalized["size_mode"] = (
        SIZE_MODE_CUSTOM
        if strategy.size_policy is not None or strategy.size_multiplier is not None or "size_multiplier" in signal
        else SIZE_MODE_AUTO
    )
    return normalized


def risk_units_allowed(signal: dict[str, Any], sl_units: float) -> bool:
    min_risk = signal.get("min_risk_units")
    max_risk = signal.get("max_risk_units")
    try:
        if min_risk is not None and maybe_number(float(min_risk)) and sl_units < float(min_risk):
            return False
        if max_risk is not None and maybe_number(float(max_risk)) and sl_units > float(max_risk):
            return False
    except (TypeError, ValueError):
        return False
    return True


def trade_levels_valid(side: int, entry_price: float, stop_loss: float, take_profit: float, tick_size: float) -> bool:
    tolerance = max(abs(tick_size), 1e-12) * 0.5
    if side == 1:
        return stop_loss < entry_price - tolerance and take_profit > entry_price + tolerance
    return stop_loss > entry_price + tolerance and take_profit < entry_price - tolerance


def managed_trade_levels_valid(side: int, stop_loss: float, take_profit: float, tick_size: float) -> bool:
    tolerance = max(abs(tick_size), 1e-12) * 0.5
    if side == 1:
        return stop_loss < take_profit - tolerance
    return stop_loss > take_profit + tolerance


def resolved_size_multiplier(signal: dict[str, Any], asset: AssetConfig, tp_units: float, sl_units: float) -> float:
    raw = signal.get("size_multiplier")
    if raw is not None:
        try:
            parsed = float(raw)
        except (TypeError, ValueError):
            parsed = math.nan
        if maybe_number(parsed) and parsed > 0:
            return round(parsed, 2)
    return recommended_size_multiplier(asset, tp_units, sl_units)


def resolve_trade_plan(
    signal: dict[str, Any], entry_price: float, side: int, asset: AssetConfig
) -> tuple[float, float, float, float, float] | None:
    stop_loss = math.nan
    take_profit = math.nan
    tp_units = math.nan
    sl_units = math.nan

    if "stop_loss" in signal:
        stop_loss = round_price(float(signal["stop_loss"]), asset.tick_size)
        sl_units = signal_units(entry_price, stop_loss, asset.tick_size)
    elif "sl_units" in signal:
        sl_units = float(signal["sl_units"])
        stop_loss = round_price(entry_price - side * sl_units * asset.tick_size, asset.tick_size)
    if not maybe_number(stop_loss) or not maybe_number(sl_units) or sl_units <= 0 or not risk_units_allowed(signal, sl_units):
        return None

    if "take_profit" in signal:
        take_profit = round_price(float(signal["take_profit"]), asset.tick_size)
        tp_units = signal_units(entry_price, take_profit, asset.tick_size)
    elif "risk_reward" in signal:
        risk_reward = float(signal["risk_reward"])
        if not maybe_number(risk_reward) or risk_reward <= 0:
            return None
        take_profit = round_price(entry_price + side * abs(entry_price - stop_loss) * risk_reward, asset.tick_size)
        tp_units = signal_units(entry_price, take_profit, asset.tick_size)
    elif "tp_units" in signal:
        tp_units = float(signal["tp_units"])
        take_profit = round_price(entry_price + side * tp_units * asset.tick_size, asset.tick_size)
    if not maybe_number(take_profit) or not maybe_number(tp_units) or tp_units <= 0:
        return None
    if not trade_levels_valid(side, entry_price, stop_loss, take_profit, asset.tick_size):
        return None

    size_multiplier = resolved_size_multiplier(signal, asset, tp_units, sl_units)
    return stop_loss, take_profit, tp_units, sl_units, size_multiplier


def shifted_ny_day(data: EnrichedData, start_index: int, day_offset: int) -> int | None:
    if start_index < 0 or start_index >= data.ny_days.shape[0]:
        return None
    start_day = int(data.ny_days[start_index])
    if day_offset <= 0:
        return start_day

    current_day = start_day
    observed_offsets = 0
    for cursor in range(start_index + 1, data.ny_days.shape[0]):
        day = int(data.ny_days[cursor])
        if day == current_day:
            continue
        observed_offsets += 1
        current_day = day
        if observed_offsets >= day_offset:
            return current_day
    return None


def market_entry_index(signal: dict[str, Any], data: EnrichedData, signal_index: int) -> int | None:
    raw_entry_minute = signal.get("entry_minute")
    if raw_entry_minute is None:
        entry_index = signal_index + 1
        return entry_index if entry_index < data.times.shape[0] else None

    try:
        entry_minute = int(float(raw_entry_minute))
        entry_day_offset = int(float(signal.get("entry_day_offset", 0)))
    except (TypeError, ValueError):
        return None

    if entry_day_offset > 0:
        signal_day = int(data.ny_days[signal_index])
        observed_days: set[int] = set()
        raw_required_minute = signal.get("entry_required_minute")
        try:
            required_minute = int(float(raw_required_minute)) if raw_required_minute is not None else None
        except (TypeError, ValueError):
            return None
        for cursor in range(signal_index + 1, data.times.shape[0]):
            current_day = int(data.ny_days[cursor])
            if current_day == signal_day or int(data.ny_minutes[cursor]) != entry_minute:
                continue
            if required_minute is not None:
                day = data.ny_dates[cursor]
                bounds = data.day_bounds.get(day)
                if bounds is None or not any(
                    int(data.ny_minutes[candidate]) == required_minute
                    for candidate in range(max(cursor, bounds[0]), bounds[1])
                ):
                    continue
            observed_days.add(current_day)
            if len(observed_days) >= entry_day_offset:
                return cursor
        return None

    target_day = shifted_ny_day(data, signal_index, 0)
    if target_day is None:
        return None
    for cursor in range(signal_index + 1, data.times.shape[0]):
        current_day = int(data.ny_days[cursor])
        if current_day < target_day:
            continue
        if current_day > target_day:
            return None
        if int(data.ny_minutes[cursor]) == entry_minute:
            return cursor
    return None


def build_market_trade(signal: dict[str, Any], data: EnrichedData, signal_index: int, asset: AssetConfig, max_bars: int) -> OpenTrade | None:
    side = int(signal["side"])
    entry_index = market_entry_index(signal, data, signal_index)
    if entry_index is None:
        return None
    entry_price = round_price(float(data.open[entry_index]), asset.tick_size)
    plan = resolve_trade_plan(signal, entry_price, side, asset)
    if plan is None:
        return None
    stop_loss, take_profit, tp_units, sl_units, size_multiplier = plan
    initial_tp_units = float(signal.get("initial_tp_units", tp_units))
    initial_sl_units = float(signal.get("initial_sl_units", sl_units))
    if not maybe_number(initial_tp_units) or initial_tp_units <= 0 or not maybe_number(initial_sl_units) or initial_sl_units <= 0:
        return None
    max_exit_index = data.times.shape[0] - 1 if signal.get("forced_exit_minute") is not None else min(data.times.shape[0] - 1, entry_index + max_bars - 1)
    return OpenTrade(
        side=side,
        signal_time=int(data.times[signal_index]),
        entry_index=entry_index,
        entry_price=entry_price,
        initial_take_profit=take_profit,
        initial_stop_loss=stop_loss,
        initial_tp_units=initial_tp_units,
        initial_sl_units=initial_sl_units,
        take_profit=take_profit,
        stop_loss=stop_loss,
        tp_units=tp_units,
        sl_units=sl_units,
        tp_mode=str(signal.get("tp_mode", PRICE_MODE_FIXED)),
        sl_mode=str(signal.get("sl_mode", PRICE_MODE_FIXED)),
        size_mode=str(signal.get("size_mode", SIZE_MODE_AUTO)),
        size_multiplier=size_multiplier,
        max_exit_index=max_exit_index,
        forced_exit_minute=int(float(signal["forced_exit_minute"])) if signal.get("forced_exit_minute") is not None else None,
        forced_exit_day_offset=int(float(signal.get("forced_exit_day_offset", 0))),
        forced_exit_reason=str(signal.get("forced_exit_reason", "time_exit")),
    )


def build_pending_order(signal: dict[str, Any], data: EnrichedData, signal_index: int, asset: AssetConfig, max_bars: int) -> PendingOrder | None:
    entry_price = round_price(float(signal["entry_price"]), asset.tick_size)
    plan = resolve_trade_plan(signal, entry_price, int(signal["side"]), asset)
    if plan is None:
        return None
    stop_loss, take_profit, tp_units, sl_units, size_multiplier = plan
    return PendingOrder(
        side=int(signal["side"]),
        signal_time=int(data.times[signal_index]),
        created_index=signal_index,
        active_index=signal_index + 1,
        expires_index=min(data.times.shape[0] - 1, signal_index + max_bars),
        entry_price=entry_price,
        take_profit=take_profit,
        stop_loss=stop_loss,
        tp_units=tp_units,
        sl_units=sl_units,
        tp_mode=str(signal.get("tp_mode", PRICE_MODE_FIXED)),
        sl_mode=str(signal.get("sl_mode", PRICE_MODE_FIXED)),
        size_mode=str(signal.get("size_mode", SIZE_MODE_AUTO)),
        size_multiplier=size_multiplier,
    )


def dynamic_stop_loss_price(
    strategy: BacktestStrategy,
    policy: DynamicStopLossPolicy,
    open_trade: OpenTrade,
    data: EnrichedData,
    reference_index: int,
    asset: AssetConfig,
) -> float | None:
    candidates: list[float] = []
    initial_risk = abs(open_trade.entry_price - open_trade.initial_stop_loss)
    if initial_risk > 0:
        moved_trigger = (
            data.high[reference_index] >= open_trade.entry_price + initial_risk * policy.trigger_multiple
            if open_trade.side == 1
            else data.low[reference_index] <= open_trade.entry_price - initial_risk * policy.trigger_multiple
        )
        if moved_trigger:
            locked_price = open_trade.entry_price + open_trade.side * initial_risk * policy.lock_multiple
            candidates.append(round_price(locked_price, asset.tick_size))

    if policy.mode == "breakeven":
        reference = math.nan
    elif policy.mode == "trail_prior_bar":
        reference = float(data.low[reference_index]) if open_trade.side == 1 else float(data.high[reference_index])
    elif policy.mode == "trail_hourly_pivot":
        if data.hourly is None:
            reference = math.nan
        else:
            swing = max(1, min(2, variant_int(strategy.variant_id, "swing", 2)))
            pivot_high, pivot_low = timeframe_pivot_arrays(data.hourly, swing)
            hour_index = int(np.searchsorted(data.hourly.times, int(data.times[reference_index]), side="right") - 1)
            entry_hour_index = int(np.searchsorted(data.hourly.times, int(data.times[open_trade.entry_index]), side="right") - 1)
            confirmed_limit = hour_index - swing
            if confirmed_limit <= entry_hour_index:
                reference = math.nan
            else:
                reference = math.nan
                if open_trade.side == 1:
                    for cursor in range(confirmed_limit, entry_hour_index, -1):
                        if bool(pivot_low[cursor]):
                            reference = float(data.hourly.low[cursor])
                            break
                else:
                    for cursor in range(confirmed_limit, entry_hour_index, -1):
                        if bool(pivot_high[cursor]):
                            reference = float(data.hourly.high[cursor])
                            break
    else:
        reference = math.nan
    if maybe_number(reference):
        adjustment = policy.buffer_units * asset.tick_size
        candidate = reference - adjustment if open_trade.side == 1 else reference + adjustment
        candidates.append(round_price(candidate, asset.tick_size))
    improving = [
        candidate
        for candidate in candidates
        if (candidate > open_trade.stop_loss if open_trade.side == 1 else candidate < open_trade.stop_loss)
    ]
    if not improving:
        return None
    return max(improving) if open_trade.side == 1 else min(improving)


def dynamic_take_profit_price(
    strategy: BacktestStrategy,
    policy: DynamicTakeProfitPolicy,
    open_trade: OpenTrade,
    data: EnrichedData,
    reference_index: int,
    asset: AssetConfig,
) -> float | None:
    if policy.mode == "trail_prior_bar":
        reference = float(data.high[reference_index]) if open_trade.side == 1 else float(data.low[reference_index])
        if not maybe_number(reference):
            return None
        adjustment = policy.buffer_units * asset.tick_size
        candidate = reference + adjustment if open_trade.side == 1 else reference - adjustment
        candidate = round_price(candidate, asset.tick_size)
        return max(open_trade.take_profit, candidate) if open_trade.side == 1 else min(open_trade.take_profit, candidate)
    if policy.mode == "risk_multiple":
        reward_multiple = policy.reward_multiple
        if reward_multiple is None or reward_multiple <= 0:
            return None
        current_risk = abs(open_trade.entry_price - open_trade.stop_loss)
        if not maybe_number(current_risk) or current_risk <= 0:
            return None
        candidate = open_trade.entry_price + open_trade.side * current_risk * reward_multiple
        candidate = round_price(candidate, asset.tick_size)
        return max(open_trade.take_profit, candidate) if open_trade.side == 1 else min(open_trade.take_profit, candidate)
    if policy.mode == "trail_hourly_extreme":
        if data.hourly is None:
            return None
        swing = max(1, min(2, variant_int(strategy.variant_id, "swing", 2)))
        pivot_high, pivot_low = timeframe_pivot_arrays(data.hourly, swing)
        hour_index = int(np.searchsorted(data.hourly.times, int(data.times[reference_index]), side="right") - 1)
        entry_hour_index = int(np.searchsorted(data.hourly.times, int(data.times[open_trade.entry_index]), side="right") - 1)
        confirmed_limit = hour_index - swing
        if confirmed_limit <= entry_hour_index:
            return None
        reference = math.nan
        if open_trade.side == 1:
            for cursor in range(confirmed_limit, entry_hour_index, -1):
                if bool(pivot_high[cursor]):
                    reference = float(data.hourly.high[cursor])
                    break
        else:
            for cursor in range(confirmed_limit, entry_hour_index, -1):
                if bool(pivot_low[cursor]):
                    reference = float(data.hourly.low[cursor])
                    break
        if not maybe_number(reference):
            return None
        adjustment = policy.buffer_units * asset.tick_size
        candidate = reference + adjustment if open_trade.side == 1 else reference - adjustment
        candidate = round_price(candidate, asset.tick_size)
        return max(open_trade.take_profit, candidate) if open_trade.side == 1 else min(open_trade.take_profit, candidate)
    return None


def management_event_id(open_trade: OpenTrade, event_type: str, event_time: int, price: float) -> str:
    return f"{open_trade.signal_time}:{open_trade.entry_index}:{event_type}:{event_time}:{price:.10f}"


def append_management_event(
    open_trade: OpenTrade,
    event_type: str,
    event_time: int,
    price: float,
    previous_price: float,
    reason: str,
    label: str | None = None,
) -> None:
    event: dict[str, Any] = {
        "createdAt": iso_time(event_time),
        "entryPrice": open_trade.entry_price,
        "id": management_event_id(open_trade, event_type, event_time, price),
        "previousPrice": previous_price,
        "price": price,
        "reason": reason,
        "stopLossPrice": open_trade.stop_loss if event_type != "edit_sl" else price,
        "takeProfitPrice": open_trade.take_profit if event_type != "edit_tp" else price,
        "time": iso_time(event_time),
        "type": event_type,
    }
    if label:
        event["label"] = label
    open_trade.management_events.append(event)


def dynamic_stop_reason(strategy: BacktestStrategy, candidate_stop: float, open_trade: OpenTrade, asset: AssetConfig) -> tuple[str, str | None]:
    tolerance = max(abs(asset.tick_size), 1e-12) * 0.5
    policy = strategy.dynamic_stop_loss_policy
    if abs(candidate_stop - open_trade.entry_price) <= tolerance:
        trigger = policy.trigger_multiple if policy else 1.0
        return f"Move SL to Break Even after price moved at least {trigger:g}R in favor.", "Break Even"
    if policy is not None and policy.lock_multiple > 0:
        locked_price = open_trade.entry_price + open_trade.side * abs(open_trade.entry_price - open_trade.initial_stop_loss) * policy.lock_multiple
        if abs(candidate_stop - locked_price) <= tolerance:
            return (
                f"Lock {policy.lock_multiple:g}R after price moved at least {policy.trigger_multiple:g}R in favor.",
                f"Lock {policy.lock_multiple:g}R",
            )
    mode = policy.mode if policy else ""
    if mode == "breakeven":
        return "Dynamic profit-lock policy adjusted the stop.", None
    if mode == "trail_prior_bar":
        return "Trail SL using the prior completed bar.", None
    if mode == "trail_hourly_pivot":
        return "Trail SL using the latest confirmed hourly pivot.", None
    return "Dynamic stop-loss policy adjusted the stop.", None


def dynamic_take_profit_reason(strategy: BacktestStrategy) -> str:
    mode = strategy.dynamic_take_profit_policy.mode if strategy.dynamic_take_profit_policy else ""
    if mode == "trail_prior_bar":
        return "Trail TP using the prior completed bar."
    if mode == "trail_hourly_extreme":
        return "Trail TP using the latest confirmed hourly extreme."
    if mode == "risk_multiple":
        reward_multiple = strategy.dynamic_take_profit_policy.reward_multiple if strategy.dynamic_take_profit_policy else None
        return f"Edit TP to maintain {reward_multiple}R against the managed stop." if reward_multiple else "Edit TP against the managed stop."
    return "Dynamic take-profit policy adjusted the target."


def apply_dynamic_trade_management(
    strategy: BacktestStrategy,
    open_trade: OpenTrade,
    data: EnrichedData,
    index: int,
    asset: AssetConfig,
) -> None:
    reference_index = index - 1
    if reference_index < open_trade.entry_index:
        return

    if strategy.dynamic_stop_loss_policy is not None:
        candidate_stop = dynamic_stop_loss_price(strategy, strategy.dynamic_stop_loss_policy, open_trade, data, reference_index, asset)
        if candidate_stop is not None and candidate_stop != open_trade.stop_loss:
            if managed_trade_levels_valid(open_trade.side, candidate_stop, open_trade.take_profit, asset.tick_size):
                previous_stop = open_trade.stop_loss
                reason, label = dynamic_stop_reason(strategy, candidate_stop, open_trade, asset)
                open_trade.stop_loss = candidate_stop
                open_trade.sl_units = signal_units(open_trade.entry_price, candidate_stop, asset.tick_size)
                append_management_event(open_trade, "edit_sl", int(data.times[index]), candidate_stop, previous_stop, reason, label)

    if strategy.dynamic_take_profit_policy is not None:
        candidate_take_profit = dynamic_take_profit_price(strategy, strategy.dynamic_take_profit_policy, open_trade, data, reference_index, asset)
        if candidate_take_profit is not None and candidate_take_profit != open_trade.take_profit:
            if managed_trade_levels_valid(open_trade.side, open_trade.stop_loss, candidate_take_profit, asset.tick_size):
                previous_take_profit = open_trade.take_profit
                reason = dynamic_take_profit_reason(strategy)
                open_trade.take_profit = candidate_take_profit
                open_trade.tp_units = signal_units(open_trade.entry_price, candidate_take_profit, asset.tick_size)
                append_management_event(open_trade, "edit_tp", int(data.times[index]), candidate_take_profit, previous_take_profit, reason)


def pending_order_touched(order: PendingOrder, data: EnrichedData, index: int) -> bool:
    return data.low[index] <= order.entry_price <= data.high[index]


def entry_bar_tp_is_reachable(open_trade: OpenTrade, data: EnrichedData, index: int, tick_size: float) -> bool:
    tolerance = max(abs(tick_size), 1e-12) * 0.5
    side = open_trade.side
    entry_price = open_trade.entry_price
    take_profit = open_trade.take_profit
    bar_open = float(data.open[index])
    bar_close = float(data.close[index])

    if side == 1:
        tp_touched = data.high[index] >= take_profit - tolerance
        filled_from_open = bar_open <= entry_price + tolerance
        closed_through_tp = bar_close >= take_profit - tolerance
    else:
        tp_touched = data.low[index] <= take_profit + tolerance
        filled_from_open = bar_open >= entry_price - tolerance
        closed_through_tp = bar_close <= take_profit + tolerance

    return bool(tp_touched and (filled_from_open or closed_through_tp))


def trade_exit(open_trade: OpenTrade, data: EnrichedData, index: int, tick_size: float) -> tuple[float, str] | None:
    if index < open_trade.entry_index:
        return None
    side = open_trade.side
    exit_price = math.nan
    exit_reason = ""

    if index > open_trade.entry_index:
        if side == 1 and data.open[index] <= open_trade.stop_loss:
            exit_price = open_trade.stop_loss
            exit_reason = "sl_gap"
        elif side == -1 and data.open[index] >= open_trade.stop_loss:
            exit_price = open_trade.stop_loss
            exit_reason = "sl_gap"
        elif side == 1 and data.open[index] >= open_trade.take_profit:
            exit_price = open_trade.take_profit
            exit_reason = "tp_gap"
        elif side == -1 and data.open[index] <= open_trade.take_profit:
            exit_price = open_trade.take_profit
            exit_reason = "tp_gap"

    if math.isnan(exit_price):
        stop_hit = data.low[index] <= open_trade.stop_loss if side == 1 else data.high[index] >= open_trade.stop_loss
        tp_hit = data.high[index] >= open_trade.take_profit if side == 1 else data.low[index] <= open_trade.take_profit
        if index == open_trade.entry_index:
            tp_hit = entry_bar_tp_is_reachable(open_trade, data, index, tick_size)
        if stop_hit:
            exit_price = open_trade.stop_loss
            exit_reason = "sl"
        elif tp_hit:
            exit_price = open_trade.take_profit
            exit_reason = "tp"
        elif open_trade.forced_exit_minute is not None:
            target_day = shifted_ny_day(data, open_trade.entry_index, open_trade.forced_exit_day_offset)
            current_day = int(data.ny_days[index])
            if target_day is not None and (
                (current_day == target_day and int(data.ny_minutes[index]) >= open_trade.forced_exit_minute)
                or current_day > target_day
            ):
                exit_price = float(data.close[index])
                exit_reason = open_trade.forced_exit_reason
        elif index >= open_trade.max_exit_index:
            exit_price = float(data.close[index])
            exit_reason = "max_bars"

    if math.isnan(exit_price):
        return None
    return exit_price, exit_reason


def recommended_size_multiplier(asset: AssetConfig, tp_units: float, sl_units: float) -> float:
    dollar_unit = abs(asset.dollar_per_unit)
    if not math.isfinite(dollar_unit) or dollar_unit <= 0:
        return 1.0
    min_target_dollars = 300.0
    min_risk_dollars = 300.0
    max_risk_dollars = 1250.0
    minimum = 1.0
    tp_value = abs(tp_units) * dollar_unit
    risk_value = abs(sl_units) * dollar_unit
    if tp_value > 0:
        minimum = max(minimum, min_target_dollars / tp_value)
    if risk_value > 0:
        minimum = max(minimum, min_risk_dollars / risk_value)
    maximum = max_risk_dollars / risk_value if risk_value > 0 else math.inf
    step = 0.01 if minimum < 1 or maximum < 1 else 0.25
    rounded_up = max(step, math.ceil(minimum / step) * step)
    if rounded_up <= maximum or not math.isfinite(maximum):
        return round(rounded_up, 2)
    return round(max(step, math.floor(maximum / step) * step), 2)


def competition_safe_atr(data: EnrichedData, index: int, asset: AssetConfig) -> float:
    value = float(data.atr14[index]) if 0 <= index < data.atr14.shape[0] else math.nan
    if maybe_number(value) and value > 0:
        return value
    return max(float(data.high[index] - data.low[index]), asset.tick_size * 10.0)


def competition_day_index(data: EnrichedData, day: str, minute: int) -> int | None:
    bounds = data.day_bounds.get(day)
    if bounds is None:
        return None
    start, end = bounds
    for cursor in range(start, end):
        if int(data.ny_minutes[cursor]) == int(minute):
            return cursor
    return None


def competition_previous_day(data: EnrichedData, day: str) -> str | None:
    previous: str | None = None
    for current in data.day_bounds.keys():
        if current == day:
            return previous
        previous = current
    return None


def competition_next_day(data: EnrichedData, day: str) -> str | None:
    found = False
    for current in data.day_bounds.keys():
        if found:
            return current
        if current == day:
            found = True
    return None


def competition_param_text(strategy: BacktestStrategy, key: str, fallback: str = "") -> str:
    return variant_value(strategy.variant_id, key) or fallback


def competition_param_int(strategy: BacktestStrategy, key: str, fallback: int) -> int:
    return variant_int(strategy.variant_id, key, fallback)


def competition_param_float(strategy: BacktestStrategy, key: str, fallback: float) -> float:
    return variant_float(strategy.variant_id, key, fallback)


def competition_tsmom_lookbacks(strategy: BacktestStrategy) -> tuple[int, ...]:
    raw = competition_param_text(strategy, "lookbacks", "")
    values: list[int] = []
    for token in raw.split(","):
        try:
            value = int(float(token.strip()))
        except ValueError:
            continue
        if value > 0:
            values.append(value)
    if values:
        return tuple(sorted(set(values)))
    return (max(1, competition_param_int(strategy, "lookback", 3)),)


def competition_tsmom_vote(
    closes: list[float], position: int, lookbacks: tuple[int, ...], consensus: int
) -> int | None:
    if not lookbacks or position < max(lookbacks):
        return None
    current = closes[position]
    votes = [
        1 if current > closes[position - lookback] else -1 if current < closes[position - lookback] else 0
        for lookback in lookbacks
    ]
    threshold = max(1, min(len(lookbacks), consensus))
    score = sum(votes)
    if score >= threshold:
        return 1
    if score <= -threshold:
        return -1
    return None


def competition_requested_risk_reward(strategy: BacktestStrategy) -> float | None:
    for key in ("risk_reward", "rr"):
        raw = variant_value(strategy.variant_id, key)
        if raw is None:
            continue
        try:
            parsed = float(raw)
        except ValueError:
            continue
        if math.isfinite(parsed) and parsed > 0:
            return parsed
    return None


def competition_uses_bracket_exit(strategy: BacktestStrategy) -> bool:
    return competition_param_text(strategy, "managed_exit", "time") in {"bracket", "stop_target"}


def competition_passes_filters(strategy: BacktestStrategy, data: EnrichedData, signal_index: int, side: int) -> bool:
    weekday = variant_value(strategy.variant_id, "signal_weekday")
    if weekday is not None and int(data.ny_weekdays[signal_index]) != int(float(weekday)):
        return False

    side_filter = variant_value(strategy.variant_id, "side_filter")
    if side_filter and side_filter in {"long", "short"}:
        if side_filter == "long" and side != 1:
            return False
        if side_filter == "short" and side != -1:
            return False

    weekday_side = variant_value(strategy.variant_id, "signal_weekday_side")
    if weekday_side:
        raw_weekday, _, raw_side = weekday_side.partition("_")
        if raw_weekday and int(data.ny_weekdays[signal_index]) != int(float(raw_weekday)):
            return False
        if raw_side == "long" and side != 1:
            return False
        if raw_side == "short" and side != -1:
            return False

    month = variant_value(strategy.variant_id, "signal_month")
    quarter = variant_value(strategy.variant_id, "signal_quarter")
    halfyear = variant_value(strategy.variant_id, "signal_halfyear")
    if month is not None or quarter is not None or halfyear is not None:
        signal_dt = datetime.fromtimestamp(int(data.times[signal_index]), tz=timezone.utc).astimezone(NEW_YORK)
        if month is not None and signal_dt.month != int(float(month)):
            return False
        if quarter is not None and ((signal_dt.month - 1) // 3 + 1) != int(float(quarter)):
            return False
        if halfyear is not None and (1 if signal_dt.month <= 6 else 2) != int(float(halfyear)):
            return False

    return True


COMPETITION_TIME_EXIT_UNITS = 1_000_000.0


def competition_risk_units(data: EnrichedData, index: int, asset: AssetConfig) -> float:
    if asset.tick_size <= 0:
        return 1.0
    risk = competition_safe_atr(data, index, asset)
    return max(1.0, risk / asset.tick_size)


def competition_time_exit_signal(
    strategy: BacktestStrategy,
    data: EnrichedData,
    index: int,
    asset: AssetConfig,
    side: int,
    forced_exit_minute: int,
    forced_exit_day_offset: int = 0,
    entry_minute: int | None = None,
    entry_day_offset: int = 0,
    risk_index: int | None = None,
) -> dict[str, Any] | None:
    if side not in {-1, 1}:
        return None
    reference_index = index if risk_index is None else max(0, min(risk_index, data.times.shape[0] - 1))
    risk_units = competition_risk_units(data, reference_index, asset)
    risk_reward = competition_requested_risk_reward(strategy)
    if risk_reward is not None and risk_reward >= 2.0 and competition_uses_bracket_exit(strategy):
        signal: dict[str, Any] = {
            "entry_mode": "market",
            "side": side,
            "sl_units": risk_units,
            "risk_reward": risk_reward,
            "forced_exit_minute": int(forced_exit_minute),
            "forced_exit_day_offset": int(forced_exit_day_offset),
            "forced_exit_reason": "time_exit",
            "tp_mode": PRICE_MODE_CUSTOM,
            "sl_mode": PRICE_MODE_CUSTOM,
            "size_mode": SIZE_MODE_AUTO,
            "size_multiplier": 1.0,
        }
        if entry_minute is not None:
            signal["entry_minute"] = int(entry_minute)
            signal["entry_day_offset"] = int(entry_day_offset)
        return signal

    signal: dict[str, Any] = {
        "entry_mode": "market",
        "side": side,
        "sl_units": COMPETITION_TIME_EXIT_UNITS,
        "tp_units": COMPETITION_TIME_EXIT_UNITS,
        "initial_sl_units": risk_units,
        "initial_tp_units": risk_units * max(1.0, risk_reward or 1.0),
        "forced_exit_minute": int(forced_exit_minute),
        "forced_exit_day_offset": int(forced_exit_day_offset),
        "forced_exit_reason": "time_exit",
        "tp_mode": PRICE_MODE_CUSTOM,
        "sl_mode": PRICE_MODE_CUSTOM,
        "size_mode": SIZE_MODE_AUTO,
        "size_multiplier": 1.0,
    }
    if entry_minute is not None:
        signal["entry_minute"] = int(entry_minute)
        signal["entry_day_offset"] = int(entry_day_offset)
    return signal


def evaluate_competition_intraday_signal(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig
) -> dict[str, Any] | None:
    direction = 1 if competition_param_text(strategy, "direction", "same") in {"same", "momentum", "continue", "breakout"} else -1
    signal_start_minute = competition_param_int(strategy, "signal_start", 570)
    signal_end_minute = competition_param_int(strategy, "signal_end", 585)
    entry_minute = competition_param_int(strategy, "entry", 930)
    exit_minute = competition_param_int(strategy, "exit", 945)
    min_signal_atr = competition_param_float(strategy, "min_signal_atr", 0.0)
    if int(data.ny_minutes[index]) != signal_end_minute:
        return None

    day = data.ny_dates[index]
    signal = competition_session_return(data, day, signal_start_minute, signal_end_minute)
    if signal is None:
        return None
    _signal_start_index, signal_index, move = signal
    if signal_index != index:
        return None
    atr_value = competition_safe_atr(data, index, asset)
    if atr_value <= 0 or abs(move) / atr_value < min_signal_atr or move == 0:
        return None
    side = (1 if move > 0 else -1) * direction
    if not competition_passes_filters(strategy, data, index, side):
        return None
    return competition_time_exit_signal(
        strategy,
        data,
        index,
        asset,
        side,
        forced_exit_minute=exit_minute,
        forced_exit_day_offset=0,
        entry_minute=entry_minute,
        entry_day_offset=0,
        risk_index=index,
    )


def evaluate_competition_overnight_signal(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig
) -> dict[str, Any] | None:
    if int(data.ny_minutes[index]) != 945:
        return None
    side = 1 if competition_param_text(strategy, "side", "long") == "long" else -1
    if not competition_passes_filters(strategy, data, index, side):
        return None
    return competition_time_exit_signal(
        strategy,
        data,
        index,
        asset,
        side,
        forced_exit_minute=570,
        forced_exit_day_offset=1,
        risk_index=index,
    )


def evaluate_competition_gap_signal(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig
) -> dict[str, Any] | None:
    direction = -1 if competition_param_text(strategy, "direction", "fade") == "fade" else 1
    entry_minute = competition_param_int(strategy, "entry", 570)
    exit_minute = competition_param_int(strategy, "exit", 615)
    min_gap_atr = competition_param_float(strategy, "min_gap_atr", 0.0)
    if int(data.ny_minutes[index]) != entry_minute:
        return None

    day = data.ny_dates[index]
    previous = competition_previous_day(data, day)
    if previous is None:
        return None
    prior_close_index = competition_day_index(data, previous, 945)
    if prior_close_index is None:
        return None
    gap = float(data.open[index] - data.close[prior_close_index])
    atr_value = competition_safe_atr(data, prior_close_index, asset)
    if atr_value <= 0 or abs(gap) / atr_value < min_gap_atr or gap == 0:
        return None
    side = (1 if gap > 0 else -1) * direction
    if not competition_passes_filters(strategy, data, index, side):
        return None
    return competition_time_exit_signal(
        strategy,
        data,
        index,
        asset,
        side,
        forced_exit_minute=exit_minute,
        forced_exit_day_offset=0,
        risk_index=prior_close_index,
    )


def evaluate_competition_daily_tsmom_signal(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig
) -> dict[str, Any] | None:
    if int(data.ny_minutes[index]) != 945:
        return None
    lookbacks = competition_tsmom_lookbacks(strategy)
    consensus = competition_param_int(strategy, "consensus", len(lookbacks))
    entry_minute = competition_param_int(strategy, "entry", 570)
    exit_minute = competition_param_int(strategy, "exit", 945)
    direction = 1 if competition_param_text(strategy, "direction", "momentum") == "momentum" else -1
    ordered_days: list[str] = []
    close_by_day: dict[str, tuple[int, float]] = {}
    for day in data.day_bounds.keys():
        close_index = competition_day_index(data, day, 945)
        if close_index is not None and close_index <= index:
            ordered_days.append(day)
            close_by_day[day] = (close_index, float(data.close[close_index]))
    day = data.ny_dates[index]
    if len(ordered_days) <= max(lookbacks) or not ordered_days or ordered_days[-1] != day:
        return None

    signal_index, _current_close = close_by_day[day]
    closes = [close_by_day[current_day][1] for current_day in ordered_days]
    vote = competition_tsmom_vote(closes, len(closes) - 1, lookbacks, consensus)
    if signal_index != index or vote is None:
        return None
    side = vote * direction
    if not competition_passes_filters(strategy, data, index, side):
        return None

    overnight = competition_param_text(strategy, "family", "").startswith("daily_tsmom_next_overnight")
    if overnight:
        return competition_time_exit_signal(
            strategy,
            data,
            index,
            asset,
            side,
            forced_exit_minute=exit_minute,
            forced_exit_day_offset=1,
            risk_index=index,
        )
    return competition_time_exit_signal(
        strategy,
        data,
        index,
        asset,
        side,
        forced_exit_minute=exit_minute,
        forced_exit_day_offset=0,
        entry_minute=entry_minute,
        entry_day_offset=1,
        risk_index=index,
    ) | {"entry_required_minute": exit_minute}


def evaluate_competition_range_signal(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig
) -> dict[str, Any] | None:
    family = competition_param_text(strategy, "family", "")
    range_start = competition_param_int(strategy, "range_start", 570)
    range_end = competition_param_int(strategy, "range_end", 585)
    break_start = competition_param_int(strategy, "break_start", 600)
    break_end = competition_param_int(strategy, "break_end", 720)
    forced_exit = competition_param_int(strategy, "forced_exit", 945)
    risk_reward = competition_param_float(strategy, "risk_reward", 1.5)
    direction = 1 if competition_param_text(strategy, "direction", "breakout") == "breakout" else -1
    minute = int(data.ny_minutes[index])
    if minute < break_start or minute > break_end or minute > forced_exit:
        return None

    day = data.ny_dates[index]
    range_indices: list[int] = []
    if family.startswith("asia_range"):
        previous = competition_previous_day(data, day)
        if previous is None:
            return None
        range_indices.extend(
            candidate
            for range_minute in range(range_start, 24 * 60, 15)
            if (candidate := competition_day_index(data, previous, range_minute)) is not None and candidate < index
        )
        range_indices.extend(
            candidate
            for range_minute in range(0, range_end + 1, 15)
            if (candidate := competition_day_index(data, day, range_minute)) is not None and candidate < index
        )
    else:
        range_indices.extend(
            candidate
            for range_minute in range(range_start, range_end + 1, 15)
            if (candidate := competition_day_index(data, day, range_minute)) is not None and candidate < index
        )
    if not range_indices:
        return None

    high = max(float(data.high[cursor]) for cursor in range_indices)
    low = min(float(data.low[cursor]) for cursor in range_indices)
    if high <= low:
        return None
    break_side = 1 if data.high[index] > high else -1 if data.low[index] < low else 0
    if break_side == 0:
        return None
    side = break_side * direction
    if not competition_passes_filters(strategy, data, index, side):
        return None

    stop = low if direction == 1 and side == 1 else high if direction == 1 else float(data.low[index]) if side == 1 else float(data.high[index])
    return {
        "entry_mode": "market",
        "side": side,
        "stop_loss": round_price(stop, asset.tick_size),
        "risk_reward": risk_reward,
        "forced_exit_minute": forced_exit,
        "forced_exit_day_offset": 0,
        "forced_exit_reason": "time_exit",
        "tp_mode": PRICE_MODE_CUSTOM,
        "sl_mode": PRICE_MODE_CUSTOM,
        "size_mode": SIZE_MODE_AUTO,
    }


def evaluate_competition_session_edge(
    strategy: BacktestStrategy, data: EnrichedData, index: int, asset: AssetConfig
) -> dict[str, Any] | None:
    family = competition_param_text(strategy, "family", "")
    if family.startswith(("us_first30", "us_secondlast", "london_first30")):
        return evaluate_competition_intraday_signal(strategy, data, index, asset)
    if family.startswith("overnight_close_to_open_bias"):
        return evaluate_competition_overnight_signal(strategy, data, index, asset)
    if family.startswith("ny_open_gap"):
        return evaluate_competition_gap_signal(strategy, data, index, asset)
    if family.startswith("daily_tsmom"):
        return evaluate_competition_daily_tsmom_signal(strategy, data, index, asset)
    if family.startswith(("asia_range", "ny_opening_range")):
        return evaluate_competition_range_signal(strategy, data, index, asset)
    raise ValueError(f"Unsupported competition_session_edge family: {family}")


def competition_may_signal(strategy: BacktestStrategy, data: EnrichedData, index: int) -> bool:
    family = competition_param_text(strategy, "family", "")
    minute = int(data.ny_minutes[index])
    if family.startswith(("us_first30", "us_secondlast", "london_first30")):
        return minute == competition_param_int(strategy, "signal_end", 585)
    if family.startswith(("overnight_close_to_open_bias", "daily_tsmom")):
        return minute == 945
    if family.startswith("ny_open_gap"):
        return minute == competition_param_int(strategy, "entry", 570)
    if family.startswith(("asia_range", "ny_opening_range")):
        break_start = competition_param_int(strategy, "break_start", 600)
        break_end = competition_param_int(strategy, "break_end", 720)
        forced_exit = competition_param_int(strategy, "forced_exit", 945)
        if not (break_start <= minute <= break_end and minute <= forced_exit):
            return False
        range_start = competition_param_int(strategy, "range_start", 570)
        range_end = competition_param_int(strategy, "range_end", 585)
        day = data.ny_dates[index]
        range_indices: list[int] = []
        if family.startswith("asia_range"):
            previous = competition_previous_day(data, day)
            if previous is None:
                return False
            range_indices.extend(
                candidate
                for range_minute in range(range_start, 24 * 60, 15)
                if (candidate := competition_day_index(data, previous, range_minute)) is not None and candidate < index
            )
            range_indices.extend(
                candidate
                for range_minute in range(0, range_end + 1, 15)
                if (candidate := competition_day_index(data, day, range_minute)) is not None and candidate < index
            )
        else:
            range_indices.extend(
                candidate
                for range_minute in range(range_start, range_end + 1, 15)
                if (candidate := competition_day_index(data, day, range_minute)) is not None and candidate < index
            )
        if not range_indices:
            return False
        high = max(float(data.high[cursor]) for cursor in range_indices)
        low = min(float(data.low[cursor]) for cursor in range_indices)
        return bool(high > low and (data.high[index] > high or data.low[index] < low))
    return True


def competition_signal_candidate_indexes(strategy: BacktestStrategy, data: EnrichedData, start_index: int) -> set[int]:
    family = competition_param_text(strategy, "family", "")
    candidates: set[int] = set()
    last_signal_index = data.times.shape[0] - 2
    day_order = list(data.day_bounds.keys())
    previous_by_day = {day: day_order[position - 1] if position > 0 else None for position, day in enumerate(day_order)}
    minute_index_by_day = {
        day: {int(data.ny_minutes[cursor]): cursor for cursor in range(start, end)}
        for day, (start, end) in data.day_bounds.items()
    }

    def day_minute_index(day: str, minute: int) -> int | None:
        return minute_index_by_day.get(day, {}).get(int(minute))

    if family.startswith(("us_first30", "us_secondlast", "london_first30")):
        signal_end = competition_param_int(strategy, "signal_end", 585)
        for day in data.day_bounds.keys():
            index = day_minute_index(day, signal_end)
            if index is not None and start_index <= index <= last_signal_index:
                candidates.add(index)
        return candidates

    if family.startswith(("overnight_close_to_open_bias", "daily_tsmom")):
        for day in data.day_bounds.keys():
            index = day_minute_index(day, 945)
            if index is not None and start_index <= index <= last_signal_index:
                candidates.add(index)
        return candidates

    if family.startswith("ny_open_gap"):
        entry_minute = competition_param_int(strategy, "entry", 570)
        for day in data.day_bounds.keys():
            index = day_minute_index(day, entry_minute)
            if index is not None and start_index <= index <= last_signal_index:
                candidates.add(index)
        return candidates

    if family.startswith(("asia_range", "ny_opening_range")):
        range_start = competition_param_int(strategy, "range_start", 570)
        range_end = competition_param_int(strategy, "range_end", 585)
        break_start = competition_param_int(strategy, "break_start", 600)
        break_end = competition_param_int(strategy, "break_end", 720)
        forced_exit = competition_param_int(strategy, "forced_exit", 945)
        for day in data.day_bounds.keys():
            range_indices: list[int] = []
            if family.startswith("asia_range"):
                previous = previous_by_day.get(day)
                if previous is None:
                    continue
                range_indices.extend(
                    candidate
                    for range_minute in range(range_start, 24 * 60, 15)
                    if (candidate := day_minute_index(previous, range_minute)) is not None
                )
                range_indices.extend(
                    candidate
                    for range_minute in range(0, range_end + 1, 15)
                    if (candidate := day_minute_index(day, range_minute)) is not None
                )
            else:
                range_indices.extend(
                    candidate
                    for range_minute in range(range_start, range_end + 1, 15)
                    if (candidate := day_minute_index(day, range_minute)) is not None
                )
            for break_minute in range(break_start, min(break_end, forced_exit) + 1, 15):
                index = day_minute_index(day, break_minute)
                if index is None or index < start_index or index > last_signal_index:
                    continue
                visible_range_indices = [candidate for candidate in range_indices if candidate < index]
                if not visible_range_indices:
                    continue
                high = max(float(data.high[cursor]) for cursor in visible_range_indices)
                low = min(float(data.low[cursor]) for cursor in visible_range_indices)
                if high <= low:
                    continue
                if data.high[index] > high or data.low[index] < low:
                    candidates.add(index)
                    break
        return candidates

    return set(range(start_index, max(start_index, last_signal_index + 1)))


def competition_trade_row(
    strategy: BacktestStrategy,
    asset: AssetConfig,
    data: EnrichedData,
    signal_index: int,
    entry_index: int,
    exit_index: int,
    side: int,
    entry_price: float,
    exit_price: float,
    risk: float,
    exit_reason: str,
) -> BacktestTradeRow | None:
    if risk <= 0 or entry_index < 0 or exit_index < entry_index or exit_index >= data.times.shape[0]:
        return None
    if signal_index < 0 or signal_index >= data.times.shape[0]:
        return None
    if signal_index >= entry_index:
        raise ValueError(
            f"Competition strategy {strategy.id} has lookahead timing: "
            f"signal_index={signal_index} entry_index={entry_index}"
        )
    if int(data.times[signal_index]) >= int(data.times[entry_index]):
        raise ValueError(
            f"Competition strategy {strategy.id} has non-causal signal time: "
            f"signal_time={int(data.times[signal_index])} entry_time={int(data.times[entry_index])}"
        )
    raw_units = price_units(entry_price, exit_price, side, asset.tick_size)
    net_units = raw_units - strategy.cost_units
    denominator = (risk / asset.tick_size if asset.tick_size else 0.0) + strategy.cost_units
    if denominator <= 0:
        return None
    return BacktestTradeRow(
        strategy_id=strategy.id,
        asset_key=asset.key,
        asset_name=asset.name,
        market=asset.market,
        symbol=asset.symbol,
        phase=strategy.phase,
        variant_id=strategy.variant_id,
        side=side,
        signal_time=int(data.times[signal_index]),
        entry_index=entry_index,
        exit_index=exit_index,
        entry_time=int(data.times[entry_index]),
        exit_time=int(data.times[exit_index]),
        entry_price=round_price(entry_price, asset.tick_size),
        exit_price=round_price(exit_price, asset.tick_size),
        net_units=net_units,
        r_multiple=net_units / denominator,
        tp_units=abs(raw_units),
        sl_units=risk / asset.tick_size if asset.tick_size else risk,
        cost_units=strategy.cost_units,
        exit_reason=exit_reason,
        bars_held=max(1, exit_index - entry_index + 1),
        source=strategy.source,
        tp_mode=PRICE_MODE_CUSTOM,
        sl_mode=PRICE_MODE_CUSTOM,
        size_mode=SIZE_MODE_AUTO,
        size_multiplier=1.0,
    )


def competition_signed_return_trade(
    strategy: BacktestStrategy,
    asset: AssetConfig,
    data: EnrichedData,
    signal_index: int,
    entry_index: int,
    exit_index: int,
    side: int,
    entry_price: float | None = None,
    risk_index: int | None = None,
    exit_reason: str = "time_exit",
) -> BacktestTradeRow | None:
    entry = float(data.open[entry_index]) if entry_price is None else float(entry_price)
    risk = competition_safe_atr(data, risk_index if risk_index is not None else entry_index, asset)
    risk_reward = competition_requested_risk_reward(strategy)
    if risk_reward is not None and risk_reward >= 2.0 and competition_uses_bracket_exit(strategy):
        stop = round_price(entry - side * risk, asset.tick_size)
        target = round_price(entry + side * risk * risk_reward, asset.tick_size)
        exit_price = float(data.close[exit_index])
        resolved_exit_index = exit_index
        resolved_exit_reason = exit_reason
        for cursor in range(entry_index, exit_index + 1):
            if cursor > entry_index:
                if side == 1 and data.open[cursor] <= stop:
                    exit_price = stop
                    resolved_exit_index = cursor
                    resolved_exit_reason = "sl_gap"
                    break
                if side == -1 and data.open[cursor] >= stop:
                    exit_price = stop
                    resolved_exit_index = cursor
                    resolved_exit_reason = "sl_gap"
                    break
                if side == 1 and data.open[cursor] >= target:
                    exit_price = target
                    resolved_exit_index = cursor
                    resolved_exit_reason = "tp_gap"
                    break
                if side == -1 and data.open[cursor] <= target:
                    exit_price = target
                    resolved_exit_index = cursor
                    resolved_exit_reason = "tp_gap"
                    break

            stopped = data.low[cursor] <= stop if side == 1 else data.high[cursor] >= stop
            targeted = data.high[cursor] >= target if side == 1 else data.low[cursor] <= target
            if stopped:
                exit_price = stop
                resolved_exit_index = cursor
                resolved_exit_reason = "sl"
                break
            if targeted:
                exit_price = target
                resolved_exit_index = cursor
                resolved_exit_reason = "tp"
                break
        return competition_trade_row(
            strategy, asset, data, signal_index, entry_index, resolved_exit_index, side, entry, exit_price, risk, resolved_exit_reason
        )

    exit_price = float(data.close[exit_index])
    return competition_trade_row(strategy, asset, data, signal_index, entry_index, exit_index, side, entry, exit_price, risk, exit_reason)


def competition_session_return(data: EnrichedData, day: str, open_minute: int, close_bar_minute: int) -> tuple[int, int, float] | None:
    start = competition_day_index(data, day, open_minute)
    end = competition_day_index(data, day, close_bar_minute)
    if start is None or end is None:
        return None
    return start, end, float(data.close[end] - data.open[start])


def run_competition_intraday_strategy(
    strategy: BacktestStrategy,
    asset: AssetConfig,
    data: EnrichedData,
    start_ts: int,
    end_ts: int | None,
) -> list[BacktestTradeRow]:
    direction = 1 if competition_param_text(strategy, "direction", "same") in {"same", "momentum", "continue", "breakout"} else -1
    signal_start_minute = competition_param_int(strategy, "signal_start", 570)
    signal_end_minute = competition_param_int(strategy, "signal_end", 585)
    entry_minute = competition_param_int(strategy, "entry", 930)
    exit_minute = competition_param_int(strategy, "exit", 945)
    min_signal_atr = competition_param_float(strategy, "min_signal_atr", 0.0)
    trades: list[BacktestTradeRow] = []

    for day in data.day_bounds.keys():
        signal = competition_session_return(data, day, signal_start_minute, signal_end_minute)
        entry_index = competition_day_index(data, day, entry_minute)
        exit_index = competition_day_index(data, day, exit_minute)
        if signal is None or entry_index is None or exit_index is None:
            continue
        _signal_start_index, signal_index, move = signal
        if data.times[entry_index] < start_ts or (end_ts is not None and data.times[entry_index] >= end_ts):
            continue
        atr_value = competition_safe_atr(data, signal_index, asset)
        if atr_value <= 0 or abs(move) / atr_value < min_signal_atr or move == 0:
            continue
        side = (1 if move > 0 else -1) * direction
        if not competition_passes_filters(strategy, data, signal_index, side):
            continue
        trade = competition_signed_return_trade(strategy, asset, data, signal_index, entry_index, exit_index, side)
        if trade is not None:
            trades.append(trade)
    return trades


def run_competition_overnight_strategy(
    strategy: BacktestStrategy,
    asset: AssetConfig,
    data: EnrichedData,
    start_ts: int,
    end_ts: int | None,
) -> list[BacktestTradeRow]:
    side = 1 if competition_param_text(strategy, "side", "long") == "long" else -1
    trades: list[BacktestTradeRow] = []
    for day in data.day_bounds.keys():
        previous = competition_previous_day(data, day)
        if previous is None:
            continue
        signal_index = competition_day_index(data, previous, 945)
        entry_index = signal_index + 1 if signal_index is not None and signal_index + 1 < data.times.shape[0] else None
        exit_index = competition_day_index(data, day, 570)
        if signal_index is None or entry_index is None or exit_index is None:
            continue
        if data.times[entry_index] < start_ts or (end_ts is not None and data.times[entry_index] >= end_ts):
            continue
        if not competition_passes_filters(strategy, data, signal_index, side):
            continue
        trade = competition_signed_return_trade(
            strategy,
            asset,
            data,
            signal_index,
            entry_index,
            exit_index,
            side,
            entry_price=float(data.close[signal_index]),
            risk_index=signal_index,
        )
        if trade is not None:
            trades.append(trade)
    return trades


def run_competition_gap_strategy(
    strategy: BacktestStrategy,
    asset: AssetConfig,
    data: EnrichedData,
    start_ts: int,
    end_ts: int | None,
) -> list[BacktestTradeRow]:
    direction = -1 if competition_param_text(strategy, "direction", "fade") == "fade" else 1
    entry_minute = competition_param_int(strategy, "entry", 570)
    exit_minute = competition_param_int(strategy, "exit", 615)
    min_gap_atr = competition_param_float(strategy, "min_gap_atr", 0.0)
    trades: list[BacktestTradeRow] = []
    for day in data.day_bounds.keys():
        previous = competition_previous_day(data, day)
        if previous is None:
            continue
        signal_index = competition_day_index(data, previous, 945)
        entry_index = competition_day_index(data, day, entry_minute)
        exit_index = competition_day_index(data, day, exit_minute)
        if signal_index is None or entry_index is None or exit_index is None:
            continue
        if data.times[entry_index] < start_ts or (end_ts is not None and data.times[entry_index] >= end_ts):
            continue
        gap = float(data.open[entry_index] - data.close[signal_index])
        atr_value = competition_safe_atr(data, signal_index, asset)
        if atr_value <= 0 or abs(gap) / atr_value < min_gap_atr or gap == 0:
            continue
        side = (1 if gap > 0 else -1) * direction
        if not competition_passes_filters(strategy, data, signal_index, side):
            continue
        trade = competition_signed_return_trade(strategy, asset, data, signal_index, entry_index, exit_index, side, risk_index=signal_index)
        if trade is not None:
            trades.append(trade)
    return trades


def run_competition_daily_tsmom_strategy(
    strategy: BacktestStrategy,
    asset: AssetConfig,
    data: EnrichedData,
    start_ts: int,
    end_ts: int | None,
) -> list[BacktestTradeRow]:
    lookbacks = competition_tsmom_lookbacks(strategy)
    consensus = competition_param_int(strategy, "consensus", len(lookbacks))
    entry_minute = competition_param_int(strategy, "entry", 570)
    exit_minute = competition_param_int(strategy, "exit", 945)
    direction = 1 if competition_param_text(strategy, "direction", "momentum") == "momentum" else -1
    closes: list[tuple[str, int, float]] = []
    for day in data.day_bounds.keys():
        close_index = competition_day_index(data, day, 945)
        if close_index is not None:
            closes.append((day, close_index, float(data.close[close_index])))
    close_by_day = {day: (index, value) for day, index, value in closes}
    ordered_days = [day for day, _, _ in closes]
    trades: list[BacktestTradeRow] = []
    overnight = competition_param_text(strategy, "family", "").startswith("daily_tsmom_next_overnight")

    close_values = [value for _day, _index, value in closes]
    for position in range(max(lookbacks), len(ordered_days) - 1):
        day = ordered_days[position]
        signal_index, _current_close = close_by_day[day]
        vote = competition_tsmom_vote(close_values, position, lookbacks, consensus)
        if vote is None:
            continue
        side = vote * direction
        next_day = ordered_days[position + 1]
        if overnight:
            entry_index = signal_index + 1 if signal_index + 1 < data.times.shape[0] else None
            exit_index = competition_day_index(data, next_day, exit_minute)
        else:
            entry_index = competition_day_index(data, next_day, entry_minute)
            exit_index = competition_day_index(data, next_day, exit_minute)
        if entry_index is None or exit_index is None:
            continue
        if data.times[entry_index] < start_ts or (end_ts is not None and data.times[entry_index] >= end_ts):
            continue
        if not competition_passes_filters(strategy, data, signal_index, side):
            continue
        trade = competition_signed_return_trade(strategy, asset, data, signal_index, entry_index, exit_index, side)
        if trade is not None:
            trades.append(trade)
    return trades


def run_competition_range_strategy(
    strategy: BacktestStrategy,
    asset: AssetConfig,
    data: EnrichedData,
    start_ts: int,
    end_ts: int | None,
) -> list[BacktestTradeRow]:
    family = competition_param_text(strategy, "family", "")
    range_start = competition_param_int(strategy, "range_start", 570)
    range_end = competition_param_int(strategy, "range_end", 585)
    break_start = competition_param_int(strategy, "break_start", 600)
    break_end = competition_param_int(strategy, "break_end", 720)
    forced_exit = competition_param_int(strategy, "forced_exit", 945)
    risk_reward = competition_param_float(strategy, "risk_reward", 1.5)
    direction = 1 if competition_param_text(strategy, "direction", "breakout") == "breakout" else -1
    trades: list[BacktestTradeRow] = []

    for day in data.day_bounds.keys():
        range_indices: list[int] = []
        if family.startswith("asia_range"):
            previous = competition_previous_day(data, day)
            if previous is None:
                continue
            range_indices.extend(
                index
                for minute in range(range_start, 24 * 60, 15)
                if (index := competition_day_index(data, previous, minute)) is not None
            )
            range_indices.extend(
                index
                for minute in range(0, range_end + 1, 15)
                if (index := competition_day_index(data, day, minute)) is not None
            )
        else:
            range_indices.extend(
                index
                for minute in range(range_start, range_end + 1, 15)
                if (index := competition_day_index(data, day, minute)) is not None
            )
        if not range_indices:
            continue
        high = max(float(data.high[index]) for index in range_indices)
        low = min(float(data.low[index]) for index in range_indices)
        forced_exit_index = competition_day_index(data, day, forced_exit)
        if high <= low or forced_exit_index is None:
            continue
        if data.times[forced_exit_index] < start_ts:
            continue

        for minute in range(break_start, break_end + 1, 15):
            signal_index = competition_day_index(data, day, minute)
            if signal_index is None or signal_index + 1 >= data.times.shape[0]:
                continue
            break_side = 1 if data.high[signal_index] > high else -1 if data.low[signal_index] < low else 0
            if break_side == 0:
                continue
            side = break_side * direction
            if not competition_passes_filters(strategy, data, signal_index, side):
                continue
            entry_index = signal_index + 1
            if data.times[entry_index] < start_ts or (end_ts is not None and data.times[entry_index] >= end_ts):
                continue
            entry = float(data.open[entry_index])
            if direction == 1:
                stop = low if side == 1 else high
            else:
                stop = float(data.low[signal_index]) if side == 1 else float(data.high[signal_index])
            risk = abs(entry - stop)
            stop_is_valid = (side == 1 and stop < entry) or (side == -1 and stop > entry)
            if not stop_is_valid or risk <= asset.tick_size:
                continue
            target = entry + side * risk * risk_reward
            exit_price = float(data.close[forced_exit_index])
            exit_index = forced_exit_index
            exit_reason = "time_exit"
            for cursor in range(entry_index, forced_exit_index + 1):
                stopped = data.low[cursor] <= stop if side == 1 else data.high[cursor] >= stop
                targeted = data.high[cursor] >= target if side == 1 else data.low[cursor] <= target
                if stopped:
                    exit_price = stop
                    exit_index = cursor
                    exit_reason = "sl"
                    break
                if targeted:
                    exit_price = target
                    exit_index = cursor
                    exit_reason = "tp"
                    break
            trade = competition_trade_row(
                strategy, asset, data, signal_index, entry_index, exit_index, side, entry, exit_price, risk, exit_reason
            )
            if trade is not None:
                trades.append(trade)
            break
    return trades


def run_competition_session_edge_strategy(
    strategy: BacktestStrategy,
    asset: AssetConfig,
    data: EnrichedData,
    start_ts: int,
    end_ts: int | None,
) -> list[BacktestTradeRow]:
    family = competition_param_text(strategy, "family", "")
    if family.startswith(("us_first30", "us_secondlast", "london_first30")):
        return run_competition_intraday_strategy(strategy, asset, data, start_ts, end_ts)
    if family.startswith("overnight_close_to_open_bias"):
        return run_competition_overnight_strategy(strategy, asset, data, start_ts, end_ts)
    if family.startswith("ny_open_gap"):
        return run_competition_gap_strategy(strategy, asset, data, start_ts, end_ts)
    if family.startswith("daily_tsmom"):
        return run_competition_daily_tsmom_strategy(strategy, asset, data, start_ts, end_ts)
    if family.startswith(("asia_range", "ny_opening_range")):
        return run_competition_range_strategy(strategy, asset, data, start_ts, end_ts)
    raise ValueError(f"Unsupported competition_session_edge family: {family}")


def complete_trade(
    strategy: BacktestStrategy,
    asset: AssetConfig,
    data: EnrichedData,
    open_trade: OpenTrade,
    exit_index: int,
    exit_price: float,
    exit_reason: str,
) -> BacktestTradeRow:
    raw_units = price_units(open_trade.entry_price, exit_price, open_trade.side, asset.tick_size)
    net_units = raw_units - strategy.cost_units
    denominator = open_trade.initial_sl_units + strategy.cost_units
    r_multiple = net_units / denominator if denominator else 0.0
    return BacktestTradeRow(
        strategy_id=strategy.id,
        asset_key=asset.key,
        asset_name=asset.name,
        market=asset.market,
        symbol=asset.symbol,
        phase=strategy.phase,
        variant_id=strategy.variant_id,
        side=open_trade.side,
        signal_time=open_trade.signal_time,
        entry_index=open_trade.entry_index,
        exit_index=exit_index,
        entry_time=int(data.times[open_trade.entry_index]),
        exit_time=int(data.times[exit_index]),
        entry_price=open_trade.entry_price,
        exit_price=exit_price,
        net_units=net_units,
        r_multiple=r_multiple,
        tp_units=open_trade.initial_tp_units,
        sl_units=open_trade.initial_sl_units,
        cost_units=strategy.cost_units,
        exit_reason=exit_reason,
        bars_held=max(1, exit_index - open_trade.entry_index + 1),
        source=strategy.source,
        tp_mode=open_trade.tp_mode,
        sl_mode=open_trade.sl_mode,
        size_mode=open_trade.size_mode,
        size_multiplier=open_trade.size_multiplier,
        management_events=tuple(open_trade.management_events),
    )


def source_exit_window_end_time(source_data: EnrichedData, trade: BacktestTradeRow) -> int:
    source_index = int(np.searchsorted(source_data.times, trade.exit_time, side="left"))
    if source_index < source_data.times.shape[0] and int(source_data.times[source_index]) == trade.exit_time:
        if source_index + 1 < source_data.times.shape[0]:
            return int(source_data.times[source_index + 1])
        if source_index > 0:
            interval = int(source_data.times[source_index] - source_data.times[source_index - 1])
            return trade.exit_time + max(1, interval)
    containing_index = int(np.searchsorted(source_data.times, trade.exit_time, side="right")) - 1
    if 0 <= containing_index < source_data.times.shape[0] - 1:
        return int(source_data.times[containing_index + 1])
    return trade.exit_time + 1


def source_entry_window_end_time(source_data: EnrichedData, trade: BacktestTradeRow) -> int:
    if 0 <= trade.entry_index < source_data.times.shape[0] - 1:
        next_time = int(source_data.times[trade.entry_index + 1])
        if next_time > trade.entry_time:
            return next_time
    if 0 < trade.entry_index < source_data.times.shape[0]:
        previous_time = int(source_data.times[trade.entry_index - 1])
        interval = trade.entry_time - previous_time
        if interval > 0:
            return trade.entry_time + interval
    source_timeframe = variant_value(trade.variant_id, "tf") or "15m"
    return trade.entry_time + TIMEFRAME_SECONDS.get(source_timeframe, 60)


def parsed_management_event_times(events: tuple[dict[str, Any], ...]) -> list[tuple[int, dict[str, Any]]]:
    parsed: list[tuple[int, dict[str, Any]]] = []
    for event in events:
        raw_time = event.get("time") or event.get("createdAt")
        if not isinstance(raw_time, str):
            continue
        try:
            event_time = parse_iso_timestamp(raw_time)
        except ValueError:
            continue
        parsed.append((event_time, event))
    return parsed


def apply_scheduled_management_event(open_trade: OpenTrade, event: dict[str, Any], asset: AssetConfig) -> None:
    event_type = event.get("type")
    try:
        price = float(event.get("price"))
    except (TypeError, ValueError):
        return
    if not maybe_number(price):
        return

    price = round_price(price, asset.tick_size)
    if event_type == "edit_sl":
        open_trade.stop_loss = price
        open_trade.sl_units = abs(price_units(open_trade.entry_price, price, open_trade.side, asset.tick_size))
    elif event_type == "edit_tp":
        open_trade.take_profit = price
        open_trade.tp_units = abs(price_units(open_trade.entry_price, price, open_trade.side, asset.tick_size))


def refine_trade_with_execution_data(
    strategy: BacktestStrategy,
    asset: AssetConfig,
    source_data: EnrichedData,
    execution_data: EnrichedData,
    trade: BacktestTradeRow,
    execution_timeframe: str,
) -> BacktestTradeRow | None:
    entry_index = int(np.searchsorted(execution_data.times, trade.entry_time, side="left"))
    if entry_index < 0 or entry_index >= execution_data.times.shape[0]:
        return None
    entry_execution_time = int(execution_data.times[entry_index])
    if entry_execution_time != trade.entry_time and entry_execution_time >= source_entry_window_end_time(source_data, trade):
        return None

    exit_window_end = source_exit_window_end_time(source_data, trade)
    exit_index = int(np.searchsorted(execution_data.times, exit_window_end, side="left")) - 1
    if exit_index < entry_index:
        return None

    side = trade.side
    stop_loss = round_price(trade.entry_price - side * trade.sl_units * asset.tick_size, asset.tick_size)
    take_profit = round_price(trade.entry_price + side * trade.tp_units * asset.tick_size, asset.tick_size)
    open_trade = OpenTrade(
        side=side,
        signal_time=trade.signal_time,
        entry_index=entry_index,
        entry_price=trade.entry_price,
        initial_take_profit=take_profit,
        initial_stop_loss=stop_loss,
        initial_tp_units=trade.tp_units,
        initial_sl_units=trade.sl_units,
        take_profit=take_profit,
        stop_loss=stop_loss,
        tp_units=trade.tp_units,
        sl_units=trade.sl_units,
        tp_mode=trade.tp_mode,
        sl_mode=trade.sl_mode,
        size_mode=trade.size_mode,
        size_multiplier=trade.size_multiplier,
        max_exit_index=execution_data.times.shape[0] + 1,
        management_events=[dict(event) for event in trade.management_events],
    )

    scheduled_events = parsed_management_event_times(trade.management_events)
    next_event_index = 0
    resolved_exit_price = float(execution_data.close[exit_index])
    resolved_exit_index = exit_index
    resolved_exit_reason = trade.exit_reason
    bracket_hit = False
    for cursor in range(entry_index, exit_index + 1):
        current_time = int(execution_data.times[cursor])
        while next_event_index < len(scheduled_events) and scheduled_events[next_event_index][0] <= current_time:
            apply_scheduled_management_event(open_trade, scheduled_events[next_event_index][1], asset)
            next_event_index += 1
        exit_result = trade_exit(open_trade, execution_data, cursor, asset.tick_size)
        if exit_result is not None:
            resolved_exit_price, resolved_exit_reason = exit_result
            resolved_exit_index = cursor
            bracket_hit = True
            break

    if not bracket_hit and trade.exit_reason in {"tp", "tp_gap", "sl", "sl_gap"}:
        resolved_exit_price = float(execution_data.close[resolved_exit_index])
        resolved_exit_reason = "time_exit"

    refined = complete_trade(strategy, asset, execution_data, open_trade, resolved_exit_index, resolved_exit_price, resolved_exit_reason)
    return replace(refined, execution_timeframe=execution_timeframe)


def cap_trade_to_initial_bracket(asset: AssetConfig, trade: BacktestTradeRow) -> BacktestTradeRow:
    if trade.management_events:
        return trade

    side = trade.side
    target = round_price(trade.entry_price + side * trade.tp_units * asset.tick_size, asset.tick_size)
    stop = round_price(trade.entry_price - side * trade.sl_units * asset.tick_size, asset.tick_size)
    tolerance = max(abs(asset.tick_size), abs(trade.entry_price) * 1e-10)
    exit_price = trade.exit_price
    exit_reason = trade.exit_reason

    if side == 1 and trade.exit_price > target + tolerance:
        exit_price = target
        exit_reason = "tp_gap"
    elif side == -1 and trade.exit_price < target - tolerance:
        exit_price = target
        exit_reason = "tp_gap"
    elif side == 1 and trade.exit_price < stop - tolerance:
        exit_price = stop
        exit_reason = "sl_gap"
    elif side == -1 and trade.exit_price > stop + tolerance:
        exit_price = stop
        exit_reason = "sl_gap"
    else:
        return trade

    raw_units = price_units(trade.entry_price, exit_price, trade.side, asset.tick_size)
    net_units = raw_units - trade.cost_units
    denominator = trade.sl_units + trade.cost_units
    r_multiple = net_units / denominator if denominator else trade.r_multiple
    return replace(trade, exit_price=exit_price, net_units=net_units, r_multiple=r_multiple, exit_reason=exit_reason)


def refine_trades_with_execution_data(
    strategy: BacktestStrategy,
    asset: AssetConfig,
    source_data: EnrichedData,
    execution_data: list[tuple[str, EnrichedData]] | None,
    trades: list[BacktestTradeRow],
) -> list[BacktestTradeRow]:
    source_timeframe = strategy_timeframe(strategy)
    if not execution_data:
        if source_timeframe != "1m":
            return []
        return [cap_trade_to_initial_bracket(asset, trade) for trade in trades]
    refined: list[BacktestTradeRow] = []
    for trade in trades:
        candidate: BacktestTradeRow | None = None
        for execution_timeframe, dataset in execution_data:
            candidate = refine_trade_with_execution_data(strategy, asset, source_data, dataset, trade, execution_timeframe)
            if candidate is not None:
                break
        if candidate is not None:
            refined.append(candidate)
        elif source_timeframe == "1m":
            refined.append(cap_trade_to_initial_bracket(asset, trade))
    return refined


def tag_source_execution_timeframe(trades: list[BacktestTradeRow], timeframe: str) -> list[BacktestTradeRow]:
    if timeframe != "1m":
        return trades
    return [trade if trade.execution_timeframe else replace(trade, execution_timeframe="1m") for trade in trades]


def run_single_strategy(
    strategy: BacktestStrategy,
    asset: AssetConfig,
    data: EnrichedData,
    start_ts: int = BACKTEST_START_TS,
    end_ts: int | None = None,
    strict_anti_cheat: bool = True,
    execution_data: list[tuple[str, EnrichedData]] | None = None,
) -> list[BacktestTradeRow]:
    config = runtime_config(strategy.variant_id)
    max_bars = max(1, config.max_bars)
    one_trade_per_day = strategy.one_trade_per_day or config.one_trade_per_day
    trades: list[BacktestTradeRow] = []
    open_trade: OpenTrade | None = None
    pending_order: PendingOrder | None = None
    last_entry_day = -1

    loop_start_index = 0
    if start_ts > BACKTEST_START_TS:
        loop_start_index = max(0, int(np.searchsorted(data.times, start_ts, side="left")) - 1)
    competition_candidate_indexes = (
        competition_signal_candidate_indexes(strategy, data, loop_start_index)
        if strategy.phase == "competition_session_edge"
        else None
    )

    for index in range(loop_start_index, data.times.shape[0]):
        if open_trade is not None:
            apply_dynamic_trade_management(strategy, open_trade, data, index, asset)
            exit_result = trade_exit(open_trade, data, index, asset.tick_size)
            if exit_result is not None:
                exit_price, exit_reason = exit_result
                trades.append(complete_trade(strategy, asset, data, open_trade, index, exit_price, exit_reason))
                open_trade = None

        if open_trade is None and pending_order is not None:
            if index > pending_order.expires_index:
                pending_order = None
            elif index >= pending_order.active_index and pending_order_touched(pending_order, data, index):
                in_sample_entry = data.times[index] >= start_ts and (end_ts is None or data.times[index] < end_ts)
                if in_sample_entry and (not one_trade_per_day or data.ny_days[index] != last_entry_day):
                    open_trade = OpenTrade(
                        side=pending_order.side,
                        signal_time=pending_order.signal_time,
                        entry_index=index,
                        entry_price=pending_order.entry_price,
                        initial_take_profit=pending_order.take_profit,
                        initial_stop_loss=pending_order.stop_loss,
                        initial_tp_units=pending_order.tp_units,
                        initial_sl_units=pending_order.sl_units,
                        take_profit=pending_order.take_profit,
                        stop_loss=pending_order.stop_loss,
                        tp_units=pending_order.tp_units,
                        sl_units=pending_order.sl_units,
                        tp_mode=pending_order.tp_mode,
                        sl_mode=pending_order.sl_mode,
                        size_mode=pending_order.size_mode,
                        size_multiplier=pending_order.size_multiplier,
                        max_exit_index=min(data.times.shape[0] - 1, index + max_bars - 1),
                    )
                    last_entry_day = int(data.ny_days[index])
                    exit_result = trade_exit(open_trade, data, index, asset.tick_size)
                    if exit_result is not None:
                        exit_price, exit_reason = exit_result
                        trades.append(complete_trade(strategy, asset, data, open_trade, index, exit_price, exit_reason))
                        open_trade = None
                pending_order = None

        if open_trade is not None or pending_order is not None or index >= data.times.shape[0] - 1:
            continue

        if strategy.phase != "competition_session_edge":
            if data.times[index + 1] < start_ts:
                continue
            if end_ts is not None and data.times[index + 1] >= end_ts:
                continue
        elif competition_candidate_indexes is not None and index not in competition_candidate_indexes:
            continue

        if strict_anti_cheat and strategy.phase == "competition_session_edge":
            signal_data = competition_anti_cheat_window(strategy, data, index)
        else:
            signal_data = anti_cheat_window(data, index) if strict_anti_cheat else data
        signal_index = signal_data.times.shape[0] - 1 if strict_anti_cheat else index
        signal = evaluate_strategy_signal(strategy, signal_data, signal_index, asset, config, strict_window=strict_anti_cheat)
        if signal is None:
            continue
        signal = normalize_strategy_signal(strategy, signal, signal_data, signal_index, asset, strict_window=strict_anti_cheat)
        if signal is None:
            continue

        if signal["entry_mode"] == "limit":
            pending_order = build_pending_order(signal, data, index, asset, max_bars)
            continue

        entry_index = market_entry_index(signal, data, index)
        if entry_index is None:
            continue
        if data.times[entry_index] < start_ts:
            continue
        if end_ts is not None and data.times[entry_index] >= end_ts:
            continue
        if one_trade_per_day and data.ny_days[entry_index] == last_entry_day:
            continue
        open_trade = build_market_trade(signal, data, index, asset, max_bars)
        if open_trade is None:
            continue
        last_entry_day = int(data.ny_days[open_trade.entry_index])

    if open_trade is not None:
        final_index = data.times.shape[0] - 1
        trades.append(complete_trade(strategy, asset, data, open_trade, final_index, float(data.close[final_index]), "end"))

    return refine_trades_with_execution_data(strategy, asset, data, execution_data, trades)


def iso_time(timestamp: int) -> str:
    return datetime.fromtimestamp(int(timestamp), tz=timezone.utc).isoformat().replace("+00:00", "Z")


def csv_number(value: float) -> str:
    if not math.isfinite(value):
        return "0"
    return f"{value:.12f}".rstrip("0").rstrip(".")


def csv_management_events(events: tuple[dict[str, Any], ...]) -> str:
    if not events:
        return ""
    return json.dumps(list(events), separators=(",", ":"), sort_keys=True)


def write_strategy_backtest_csv(csv_path: Path, trades: list[BacktestTradeRow]) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = csv_path.with_suffix(f"{csv_path.suffix}.tmp")
    with temp_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "strategy_id",
                "asset_key",
                "asset_name",
                "market",
                "symbol",
                "phase",
                "variant_id",
                "side",
                "signal_time",
                "entry_index",
                "exit_index",
                "entry_time",
                "exit_time",
                "entry_price",
                "exit_price",
                "net_units",
                "r_multiple",
                "tp_units",
                "sl_units",
                "cost_units",
                "exit_reason",
                "bars_held",
                "source",
                "tp_mode",
                "sl_mode",
                "size_mode",
                "size_multiplier",
                "execution_timeframe",
                "management_events",
            ]
        )
        for trade in trades:
            writer.writerow(
                [
                    trade.strategy_id,
                    trade.asset_key,
                    trade.asset_name,
                    trade.market,
                    trade.symbol,
                    trade.phase,
                    trade.variant_id,
                    side_name(trade.side),
                    iso_time(trade.signal_time),
                    trade.entry_index,
                    trade.exit_index,
                    iso_time(trade.entry_time),
                    iso_time(trade.exit_time),
                    csv_number(trade.entry_price),
                    csv_number(trade.exit_price),
                    csv_number(trade.net_units),
                    csv_number(trade.r_multiple),
                    csv_number(trade.tp_units),
                    csv_number(trade.sl_units),
                    csv_number(trade.cost_units),
                    trade.exit_reason,
                    trade.bars_held,
                    trade.source,
                    trade.tp_mode,
                    trade.sl_mode,
                    trade.size_mode,
                    csv_number(trade.size_multiplier),
                    trade.execution_timeframe,
                    csv_management_events(trade.management_events),
                ]
            )
    temp_path.replace(csv_path)


def parse_iso_timestamp(value: str) -> int:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


def parse_side(value: str) -> int:
    return 1 if value.strip().lower() == "long" else -1


def parse_management_events(value: str | None) -> tuple[dict[str, Any], ...]:
    if not value:
        return ()
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return ()
    if not isinstance(parsed, list):
        return ()
    events: list[dict[str, Any]] = []
    for event in parsed:
        if not isinstance(event, dict):
            continue
        event_type = event.get("type")
        event_time = event.get("time")
        price = event.get("price")
        if event_type not in {"edit_sl", "edit_tp", "edit_limit"} or not isinstance(event_time, str):
            continue
        try:
            numeric_price = float(price)
        except (TypeError, ValueError):
            continue
        if not maybe_number(numeric_price):
            continue
        events.append(dict(event))
    return tuple(events)


def read_strategy_backtest_csv(csv_path: Path) -> list[BacktestTradeRow]:
    if not csv_path.exists():
        return []

    trades: list[BacktestTradeRow] = []
    with csv_path.open("r", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            try:
                trades.append(
                    BacktestTradeRow(
                        strategy_id=str(row["strategy_id"]),
                        asset_key=str(row["asset_key"]),
                        asset_name=str(row["asset_name"]),
                        market=str(row["market"]),
                        symbol=str(row["symbol"]),
                        phase=str(row["phase"]),
                        variant_id=str(row.get("variant_id", "")),
                        side=parse_side(str(row["side"])),
                        signal_time=parse_iso_timestamp(str(row["signal_time"])),
                        entry_index=int(row["entry_index"]),
                        exit_index=int(row["exit_index"]),
                        entry_time=parse_iso_timestamp(str(row["entry_time"])),
                        exit_time=parse_iso_timestamp(str(row["exit_time"])),
                        entry_price=float(row["entry_price"]),
                        exit_price=float(row["exit_price"]),
                        net_units=float(row["net_units"]),
                        r_multiple=float(row["r_multiple"]),
                        tp_units=float(row["tp_units"]),
                        sl_units=float(row["sl_units"]),
                        cost_units=float(row.get("cost_units", 0) or 0),
                        exit_reason=str(row["exit_reason"]),
                        bars_held=int(row["bars_held"]),
                        source=str(row.get("source", "")),
                        tp_mode=str(row.get("tp_mode", "fixed") or "fixed"),
                        sl_mode=str(row.get("sl_mode", "fixed") or "fixed"),
                        size_mode=str(row.get("size_mode", "auto") or "auto"),
                        size_multiplier=float(row.get("size_multiplier", 1) or 1),
                        execution_timeframe=str(row.get("execution_timeframe", "") or ""),
                        management_events=parse_management_events(row.get("management_events")),
                    )
                )
            except (KeyError, TypeError, ValueError):
                continue
    return sorted(trades, key=lambda trade: (trade.signal_time, trade.entry_time, trade.exit_time))


def incremental_backtest_start(existing_trades: list[BacktestTradeRow], overlap_days: int) -> int | None:
    if not existing_trades:
        return None
    latest_signal = max(trade.signal_time for trade in existing_trades)
    return max(BACKTEST_START_TS, latest_signal - max(0, overlap_days) * 24 * 60 * 60)


def merge_incremental_backtest_trades(
    existing_trades: list[BacktestTradeRow],
    replacement_trades: list[BacktestTradeRow],
    replacement_start_ts: int,
) -> list[BacktestTradeRow]:
    kept = [trade for trade in existing_trades if trade.signal_time < replacement_start_ts]
    merged = [*kept, *replacement_trades]
    return sorted(merged, key=lambda trade: (trade.signal_time, trade.entry_time, trade.exit_time))


def trade_signature(trade: BacktestTradeRow) -> tuple[Any, ...]:
    return (
        trade.side,
        trade.signal_time,
        trade.entry_time,
        trade.exit_time,
        round(trade.entry_price, 8),
        round(trade.exit_price, 8),
        round(trade.net_units, 8),
        round(trade.r_multiple, 8),
        round(trade.tp_units, 8),
        round(trade.sl_units, 8),
        trade.exit_reason,
        trade.tp_mode,
        trade.sl_mode,
        trade.size_mode,
        round(trade.size_multiplier, 8),
    )


def anti_cheat_drift(
    fast_trades: list[BacktestTradeRow], strict_trades: list[BacktestTradeRow]
) -> tuple[bool, str | None]:
    fast_signatures = [trade_signature(trade) for trade in fast_trades]
    strict_signatures = [trade_signature(trade) for trade in strict_trades]
    if fast_signatures == strict_signatures:
        return False, None

    if len(fast_signatures) != len(strict_signatures):
        return True, f"trade count drift fast={len(fast_signatures)} strict={len(strict_signatures)}"

    for index, (fast_signature, strict_signature) in enumerate(zip(fast_signatures, strict_signatures, strict=True)):
        if fast_signature != strict_signature:
            return True, f"first drift at trade #{index + 1}: fast={fast_signature} strict={strict_signature}"
    return True, "anti-cheat drift detected"


def strategy_identity_values(strategy: BacktestStrategy) -> tuple[str, str, str]:
    return strategy.id.lower(), strategy.folder.lower(), strategy.asset_key.lower()


def strategy_matches_filter(strategy: BacktestStrategy, raw_filter: str, exact: bool = False) -> bool:
    value = raw_filter.strip().lower()
    if not value:
        return False
    identities = strategy_identity_values(strategy)
    if exact:
        return value in identities
    return value in identities[0] or value in identities[1] or value == identities[2]


def selected_backtest_strategies(strategy_filters: list[str] | None = None) -> list[BacktestStrategy]:
    strategies = load_backtest_strategies()
    if not strategy_filters:
        return strategies

    requested = [
        value.strip()
        for item in strategy_filters
        for value in item.split(",")
        if value.strip()
    ]
    if not requested:
        return strategies

    exact_requested = {item for item in requested if any(strategy_matches_filter(strategy, item, exact=True) for strategy in strategies)}
    selected = [
        strategy
        for strategy in strategies
        if any(strategy_matches_filter(strategy, item, exact=item in exact_requested) for item in requested)
    ]
    missing = [item for item in requested if not any(strategy_matches_filter(strategy, item, exact=item in exact_requested) for strategy in strategies)]
    if missing:
        raise ValueError(f"No strategies matched filter(s): {', '.join(missing)}")
    if not selected:
        raise ValueError("No strategies matched the provided filters")
    return selected


def parse_date_argument(value: str | None) -> int | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


def load_incremental_start_state(state_path: str | None) -> dict[tuple[str, str], int]:
    if not state_path:
        return {}

    path = Path(state_path)
    if not path.exists():
        raise FileNotFoundError(f"Missing incremental start state: {path}")

    payload = json.loads(path.read_text(encoding="utf-8"))
    tails = payload.get("tails", {}) if isinstance(payload, dict) else {}
    state: dict[tuple[str, str], int] = {}

    if not isinstance(tails, dict):
        return state

    for asset_key, by_timeframe in tails.items():
        if not isinstance(asset_key, str) or not isinstance(by_timeframe, dict):
            continue
        for timeframe, tail in by_timeframe.items():
            if not isinstance(timeframe, str) or not isinstance(tail, dict):
                continue
            raw_time = tail.get("lastBarTime")
            if isinstance(raw_time, (int, float)) and math.isfinite(raw_time):
                state[(asset_key, timeframe)] = int(raw_time)
                continue
            raw_iso = tail.get("lastBarAt")
            if isinstance(raw_iso, str) and raw_iso:
                state[(asset_key, timeframe)] = parse_iso_timestamp(raw_iso)

    return state


def run_backtests(
    strategy_filters: list[str] | None = None,
    timings: bool = False,
    start_ts: int | None = None,
    end_ts: int | None = None,
    tail_bars: int | None = None,
    strict_anti_cheat: bool = True,
    write_output: bool = True,
    incremental: bool = False,
    incremental_overlap_days: int = 7,
    incremental_start_state_path: str | None = None,
) -> None:
    assets = load_asset_by_key()
    enriched_cache: dict[tuple[str, str], EnrichedData] = {}
    execution_cache: dict[tuple[str, str], EnrichedData] = {}
    execution_cache_order: list[tuple[str, str]] = []
    strategies = selected_backtest_strategies(strategy_filters)
    incremental_start_state = load_incremental_start_state(incremental_start_state_path)
    overall_start = perf_counter()

    if timings:
        print(f"Running {len(strategies)} backtest(s)")
        print(f"Mode: {'strict anti-cheat' if strict_anti_cheat else 'fast unsafe'}")
        print(f"Write output: {'yes' if write_output else 'no'}")
    elif not strict_anti_cheat:
        print("WARNING: running fast unsafe mode without anti-cheat window slicing")

    for strategy in strategies:
        output_path = STRATEGY_ROOT / strategy.folder / "backtest_trades.csv"
        strategy_start = perf_counter()
        try:
            asset = assets[strategy.asset_key]
            timeframe = strategy_timeframe(strategy)
            cache_key = (asset.key, timeframe)
            execution_timeframes = execution_timeframe_candidates(strategy, asset, timeframe)
            existing_trades = read_strategy_backtest_csv(output_path) if incremental and output_path.exists() else []
            effective_start_ts = start_ts if start_ts is not None else BACKTEST_START_TS
            state_start_ts = incremental_start_state.get((asset.key, timeframe))
            incremental_start_ts = (
                max(BACKTEST_START_TS, state_start_ts - max(0, incremental_overlap_days) * 24 * 60 * 60)
                if state_start_ts is not None
                else incremental_backtest_start(existing_trades, incremental_overlap_days)
            )
            if start_ts is None and existing_trades and incremental_start_ts is not None:
                effective_start_ts = incremental_start_ts
            if timings:
                print(f"Starting {strategy.id}")
                if incremental:
                    print(f"  incremental start {iso_time(effective_start_ts)} from {len(existing_trades)} existing trade(s)")
            if cache_key not in enriched_cache:
                candle_path = DATA_ROOT / timeframe / asset.data_file
                if not candle_path.exists():
                    raise FileNotFoundError(f"Missing {timeframe} candle file: {candle_path}. Run/import that timeframe first.")
                if timings:
                    print(f"  loading {candle_path}")
                frame = load_candle_csv(candle_path)
                if tail_bars is not None and tail_bars > 0:
                    frame = frame.tail(tail_bars)
                    if timings:
                        print(f"  tail-bars {tail_bars}")
                enriched_cache[cache_key] = build_enriched_data(frame, asset)
                if timings:
                    print(f"  enriched {asset.key} {timeframe}")
            execution_data: list[tuple[str, EnrichedData]] = []
            explicit_execution_timeframe = strategy_execution_timeframe(strategy)
            for execution_timeframe in execution_timeframes:
                execution_cache_key = (asset.key, execution_timeframe)
                if execution_cache_key not in execution_cache:
                    execution_path = DATA_ROOT / execution_timeframe / asset.data_file
                    if not execution_path.exists():
                        raise FileNotFoundError(
                            f"Missing {execution_timeframe} execution candle file: {execution_path}. "
                            "Run/import that timeframe before using exec_tf."
                        )
                    if timings:
                        print(f"  loading execution {execution_path}")
                    try:
                        execution_frame = load_candle_csv(execution_path)
                        execution_cache[execution_cache_key] = build_enriched_data(execution_frame, asset)
                    except MemoryError:
                        if explicit_execution_timeframe == execution_timeframe:
                            raise
                        if timings:
                            print(f"  skipped {asset.key} execution {execution_timeframe}: not enough memory; trying next candidate")
                        continue
                    execution_cache_order.append(execution_cache_key)
                    while len(execution_cache_order) > 2:
                        stale_key = execution_cache_order.pop(0)
                        if stale_key != execution_cache_key:
                            execution_cache.pop(stale_key, None)
                    if timings:
                        print(f"  enriched {asset.key} execution {execution_timeframe}")
                execution_data.append((execution_timeframe, execution_cache[execution_cache_key]))
                source_data = enriched_cache[cache_key]
                loaded_execution = execution_cache[execution_cache_key]
                if (
                    loaded_execution.times.shape[0]
                    and loaded_execution.times[0] <= effective_start_ts
                    and loaded_execution.times[-1] >= source_data.times[-1]
                ):
                    break

            if timings:
                tail_skip_index = max(0, int(np.searchsorted(enriched_cache[cache_key].times, effective_start_ts, side="left")) - 1)
                if tail_skip_index:
                    print(f"  tail window skips {tail_skip_index} historical bar(s)")
                print(f"  running {strategy.id}")
            trades = run_single_strategy(
                strategy,
                asset,
                enriched_cache[cache_key],
                start_ts=effective_start_ts,
                end_ts=end_ts,
                strict_anti_cheat=strict_anti_cheat,
                execution_data=execution_data,
            )
            trades = tag_source_execution_timeframe(trades, timeframe)
            if write_output:
                output_trades = (
                    merge_incremental_backtest_trades(existing_trades, trades, effective_start_ts)
                    if incremental and existing_trades
                    else trades
                )
                write_strategy_backtest_csv(output_path, output_trades)
            elapsed = perf_counter() - strategy_start
            if timings:
                destination = output_path if write_output else "(no write)"
                if write_output and incremental and existing_trades:
                    print(
                        f"{strategy.id}: {len(trades)} replacement trade(s), {len(output_trades)} total "
                        f"in {elapsed:.2f}s -> {destination}"
                    )
                else:
                    print(f"{strategy.id}: {len(trades)} trades in {elapsed:.2f}s -> {destination}")
            else:
                if write_output:
                    if incremental and existing_trades:
                        print(f"Wrote {len(output_trades)} incremental backtest trades to {output_path}")
                    else:
                        print(f"Wrote {len(trades)} backtest trades to {output_path}")
                else:
                    print(f"Computed {len(trades)} backtest trades for {strategy.id}")
        except Exception as exc:
            preserved_output = write_output and output_path.exists()
            print(f"Skipped {strategy.id}: {exc}")
            if preserved_output:
                print(f"Preserved existing backtest output at {output_path}")

    if timings:
        elapsed = perf_counter() - overall_start
        print(f"Completed {len(strategies)} backtest(s) in {elapsed:.2f}s")


def audit_anti_cheat(
    strategy_filters: list[str] | None = None,
    tail_bars: int | None = None,
    start_ts: int | None = None,
    end_ts: int | None = None,
    fail_fast: bool = False,
) -> None:
    assets = load_asset_by_key()
    enriched_cache: dict[tuple[str, str], EnrichedData] = {}
    execution_cache: dict[tuple[str, str], EnrichedData] = {}
    execution_cache_order: list[tuple[str, str]] = []
    strategies = selected_backtest_strategies(strategy_filters)
    mismatches: list[tuple[str, str]] = []

    print(f"Auditing anti-cheat on {len(strategies)} strategy(s)")
    for strategy in strategies:
        asset = assets[strategy.asset_key]
        timeframe = strategy_timeframe(strategy)
        cache_key = (asset.key, timeframe)
        if cache_key not in enriched_cache:
            candle_path = DATA_ROOT / timeframe / asset.data_file
            if not candle_path.exists():
                raise FileNotFoundError(f"Missing {timeframe} candle file: {candle_path}. Run/import that timeframe first.")
            frame = load_candle_csv(candle_path)
            if tail_bars is not None and tail_bars > 0:
                frame = frame.tail(tail_bars)
            enriched_cache[cache_key] = build_enriched_data(frame, asset)

        data = enriched_cache[cache_key]
        execution_timeframes = execution_timeframe_candidates(strategy, asset, timeframe)
        execution_data: list[tuple[str, EnrichedData]] = []
        explicit_execution_timeframe = strategy_execution_timeframe(strategy)
        for execution_timeframe in execution_timeframes:
            execution_cache_key = (asset.key, execution_timeframe)
            if execution_cache_key not in execution_cache:
                execution_path = DATA_ROOT / execution_timeframe / asset.data_file
                if not execution_path.exists():
                    raise FileNotFoundError(f"Missing {execution_timeframe} execution candle file: {execution_path}.")
                try:
                    execution_cache[execution_cache_key] = build_enriched_data(load_candle_csv(execution_path), asset)
                except MemoryError:
                    if explicit_execution_timeframe == execution_timeframe:
                        raise
                    continue
                execution_cache_order.append(execution_cache_key)
                while len(execution_cache_order) > 2:
                    stale_key = execution_cache_order.pop(0)
                    if stale_key != execution_cache_key:
                        execution_cache.pop(stale_key, None)
            execution_data.append((execution_timeframe, execution_cache[execution_cache_key]))
            effective_start_ts = start_ts if start_ts is not None else BACKTEST_START_TS
            loaded_execution = execution_cache[execution_cache_key]
            if loaded_execution.times.shape[0] and loaded_execution.times[0] <= effective_start_ts and loaded_execution.times[-1] >= data.times[-1]:
                break
        fast_trades = run_single_strategy(
            strategy,
            asset,
            data,
            start_ts=start_ts if start_ts is not None else BACKTEST_START_TS,
            end_ts=end_ts,
            strict_anti_cheat=False,
            execution_data=execution_data,
        )
        strict_trades = run_single_strategy(
            strategy,
            asset,
            data,
            start_ts=start_ts if start_ts is not None else BACKTEST_START_TS,
            end_ts=end_ts,
            strict_anti_cheat=True,
            execution_data=execution_data,
        )
        drifted, reason = anti_cheat_drift(fast_trades, strict_trades)
        if drifted:
            message = reason or "anti-cheat drift detected"
            mismatches.append((strategy.id, message))
            print(f"DRIFT {strategy.id}: {message}")
            if fail_fast:
                raise RuntimeError(f"Anti-cheat drift for {strategy.id}: {message}")
        else:
            print(f"PASS {strategy.id}")

    if mismatches:
        raise RuntimeError(f"Anti-cheat audit failed for {len(mismatches)} strategy(s)")
    print("Anti-cheat audit passed")


def list_backtests(strategy_filters: list[str] | None = None) -> None:
    for strategy in selected_backtest_strategies(strategy_filters):
        print(f"{strategy.id}\t{strategy.asset_key}\t{strategy.phase}\t{strategy.folder}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Trading Bot data and backtest runner")
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare = subparsers.add_parser("prepare-data", help="Import 5m candles when present and build derived higher timeframes")
    prepare.add_argument("--source", help="Optional source folder. Defaults per asset to data/5m when present, otherwise data/15m legacy data.")
    prepare.add_argument("--asset", action="append", help="Optional asset key/symbol/data file filter. Repeat or comma-separate values.")

    run = subparsers.add_parser("run-backtests", help="Regenerate strategy backtest CSV files")
    run.add_argument("--strategy", action="append", help="Optional strategy id/folder/asset filter. Repeat to include multiple.")
    run.add_argument("--timings", action="store_true", help="Print per-strategy and total runtime timings.")
    run.add_argument("--start-date", help="Optional inclusive UTC start date in YYYY-MM-DD format for bounded test runs.")
    run.add_argument("--end-date", help="Optional exclusive UTC end date in YYYY-MM-DD format for bounded test runs.")
    run.add_argument("--tail-bars", type=int, help="Optional smoke-test mode: keep only the most recent N strategy-timeframe bars before enriching.")
    run.add_argument("--strict-anti-cheat", action="store_true", help="Deprecated alias. Strict anti-cheat mode is now the default.")
    run.add_argument("--fast-unsafe", action="store_true", help="Disable anti-cheat window slicing for faster exploratory runs.")
    run.add_argument("--no-write", action="store_true", help="Compute results without overwriting backtest CSV files.")
    run.add_argument("--incremental", action="store_true", help="Preserve old trade rows and replace only a recent overlap window.")
    run.add_argument("--incremental-overlap-days", type=int, default=7, help="Recent trade window to recompute when --incremental is used.")
    run.add_argument("--incremental-start-state", help="JSON file created before candle refresh; uses prior data tails as incremental cutoffs.")

    listing = subparsers.add_parser("list-backtests", help="List available backtest strategies")
    listing.add_argument("--strategy", action="append", help="Optional strategy id/folder/asset filter. Repeat to include multiple.")

    audit = subparsers.add_parser("audit-anti-cheat", help="Compare fast mode against strict anti-cheat mode")
    audit.add_argument("--strategy", action="append", help="Optional strategy id/folder/asset filter. Repeat to include multiple.")
    audit.add_argument("--start-date", help="Optional inclusive UTC start date in YYYY-MM-DD format.")
    audit.add_argument("--end-date", help="Optional exclusive UTC end date in YYYY-MM-DD format.")
    audit.add_argument("--tail-bars", type=int, help="Optional anti-cheat audit sample size using the most recent N strategy-timeframe bars.")
    audit.add_argument("--fail-fast", action="store_true", help="Stop on the first anti-cheat drift.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.command == "prepare-data":
        prepare_data(Path(args.source).resolve() if args.source else None, asset_filters=args.asset)
        return
    if args.command == "run-backtests":
        run_backtests(
            strategy_filters=args.strategy,
            timings=bool(args.timings),
            start_ts=parse_date_argument(args.start_date),
            end_ts=parse_date_argument(args.end_date),
            tail_bars=args.tail_bars,
            strict_anti_cheat=not bool(args.fast_unsafe),
            write_output=not bool(args.no_write),
            incremental=bool(args.incremental),
            incremental_overlap_days=int(args.incremental_overlap_days),
            incremental_start_state_path=args.incremental_start_state,
        )
        return
    if args.command == "list-backtests":
        list_backtests(strategy_filters=args.strategy)
        return
    if args.command == "audit-anti-cheat":
        audit_anti_cheat(
            strategy_filters=args.strategy,
            tail_bars=args.tail_bars,
            start_ts=parse_date_argument(args.start_date),
            end_ts=parse_date_argument(args.end_date),
            fail_fast=bool(args.fail_fast),
        )
        return
    raise ValueError(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    main()
