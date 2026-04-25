from __future__ import annotations

import argparse
import csv
import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
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
BACKTEST_START_TS = int(datetime(2022, 1, 1, tzinfo=timezone.utc).timestamp())

TIMEFRAME_EVERY = {
    "15m": "15m",
    "30m": "30m",
    "45m": "45m",
    "1h": "1h",
    "4h": "4h",
    "1d": "1d",
    "1w": "1w",
}

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


def prepare_data(source_dir: Path | None = None) -> None:
    assets = load_assets()
    base_dir = DATA_ROOT / "15m"
    base_dir.mkdir(parents=True, exist_ok=True)
    resolved_source_dir = source_dir.resolve() if source_dir else base_dir.resolve()

    for asset in assets:
        source_path = source_csv_path(asset, resolved_source_dir)
        base_frame = read_legacy_csv(source_path)
        write_candle_csv(base_dir / asset.data_file, base_frame)

        for timeframe, every in TIMEFRAME_EVERY.items():
            timeframe_dir = DATA_ROOT / timeframe
            timeframe_dir.mkdir(parents=True, exist_ok=True)
            if timeframe == "15m":
                write_candle_csv(timeframe_dir / asset.data_file, base_frame)
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
                    exit_price = open_[index]
                    exit_reason = 3
                elif side == -1 and open_[index] >= stop_loss:
                    exit_price = open_[index]
                    exit_reason = 3
                elif side == 1 and open_[index] >= take_profit:
                    exit_price = open_[index]
                    exit_reason = 2
                elif side == -1 and open_[index] <= take_profit:
                    exit_price = open_[index]
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
    "oneTradePerDay",
    "costUnits",
    "invertSignal",
    # Optional research/provenance fields are allowed so generators can attach
    # audit context without breaking the executable backtest contract.
    "sourceUrls",
    "researchSummary",
    "trader",
    "playbook",
    "selectionMethod",
    "trainingWindow",
    "forwardWindow",
    "selectedTrainingProfitFactor",
    "selectedTrainingTrades",
    "selectedForwardProfitFactor",
    "selectedForwardTrades",
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
}

STOP_LOSS_POLICY_MODES = {"signal_extreme", "prior_day_extreme"}
TAKE_PROFIT_POLICY_MODES = {"risk_multiple", "signal_extreme", "prior_day_extreme"}
SIZE_POLICY_MODES = {"confidence"}
DYNAMIC_STOP_LOSS_POLICY_MODES = {"trail_prior_bar", "trail_hourly_pivot"}
DYNAMIC_TAKE_PROFIT_POLICY_MODES = {"trail_prior_bar", "risk_multiple", "trail_hourly_extreme"}
ENTRY_MODES = {"market", "limit"}
PRICE_MODE_FIXED = "fixed"
PRICE_MODE_CUSTOM = "custom"
SIZE_MODE_AUTO = "auto"
SIZE_MODE_CUSTOM = "custom"


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
    return DynamicStopLossPolicy(mode=mode, buffer_units=buffer_units)


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


def variant_value(variant_id: str, key: str) -> str | None:
    for token in variant_id.split("|"):
        token_key, raw_value = (token.split("=", 1) + [""])[:2]
        if token_key == key and raw_value:
            return raw_value
    return None


def variant_float(variant_id: str, key: str, fallback: float) -> float:
    raw_value = variant_value(variant_id, key)
    parsed = optional_float(raw_value)
    return parsed if parsed is not None else fallback


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

    return echo_style_signal(strategy, side)


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

    return echo_style_signal(strategy, side)


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
    if index < 2:
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
    elif strategy.phase == "parabolic_fade":
        signal = evaluate_parabolic_fade(strategy, data, index, asset, config)
    elif strategy.phase == "vwap_pullback":
        signal = evaluate_vwap_pullback(strategy, data, index, asset, config)
    elif strategy.phase == "support_resistance_retest":
        signal = evaluate_support_resistance_retest(strategy, data, index, asset, config)
    elif strategy.phase == "trendline_break":
        signal = evaluate_trendline_break(strategy, data, index, asset, config)
    elif strategy.phase == "tori_trendline_mtf":
        signal = evaluate_tori_trendline_mtf(strategy, data, index, asset)
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
        "parabolic_fade",
        "vwap_pullback",
        "support_resistance_retest",
        "trendline_break",
        "tori_trendline_mtf",
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


def build_market_trade(signal: dict[str, Any], data: EnrichedData, signal_index: int, asset: AssetConfig, max_bars: int) -> OpenTrade | None:
    side = int(signal["side"])
    entry_index = signal_index + 1
    entry_price = round_price(float(data.open[entry_index]), asset.tick_size)
    plan = resolve_trade_plan(signal, entry_price, side, asset)
    if plan is None:
        return None
    stop_loss, take_profit, tp_units, sl_units, size_multiplier = plan
    return OpenTrade(
        side=side,
        signal_time=int(data.times[signal_index]),
        entry_index=entry_index,
        entry_price=entry_price,
        initial_take_profit=take_profit,
        initial_stop_loss=stop_loss,
        initial_tp_units=tp_units,
        initial_sl_units=sl_units,
        take_profit=take_profit,
        stop_loss=stop_loss,
        tp_units=tp_units,
        sl_units=sl_units,
        tp_mode=str(signal.get("tp_mode", PRICE_MODE_FIXED)),
        sl_mode=str(signal.get("sl_mode", PRICE_MODE_FIXED)),
        size_mode=str(signal.get("size_mode", SIZE_MODE_AUTO)),
        size_multiplier=size_multiplier,
        max_exit_index=min(data.times.shape[0] - 1, entry_index + max_bars - 1),
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
    if policy.mode == "trail_prior_bar":
        reference = float(data.low[reference_index]) if open_trade.side == 1 else float(data.high[reference_index])
    elif policy.mode == "trail_hourly_pivot":
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
                if bool(pivot_low[cursor]):
                    reference = float(data.hourly.low[cursor])
                    break
        else:
            for cursor in range(confirmed_limit, entry_hour_index, -1):
                if bool(pivot_high[cursor]):
                    reference = float(data.hourly.high[cursor])
                    break
    else:
        return None
    if not maybe_number(reference):
        return None
    adjustment = policy.buffer_units * asset.tick_size
    candidate = reference - adjustment if open_trade.side == 1 else reference + adjustment
    candidate = round_price(candidate, asset.tick_size)
    return max(open_trade.stop_loss, candidate) if open_trade.side == 1 else min(open_trade.stop_loss, candidate)


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
        return round_price(candidate, asset.tick_size)
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
            if trade_levels_valid(open_trade.side, open_trade.entry_price, candidate_stop, open_trade.take_profit, asset.tick_size):
                open_trade.stop_loss = candidate_stop
                open_trade.sl_units = signal_units(open_trade.entry_price, candidate_stop, asset.tick_size)

    if strategy.dynamic_take_profit_policy is not None:
        candidate_take_profit = dynamic_take_profit_price(strategy, strategy.dynamic_take_profit_policy, open_trade, data, reference_index, asset)
        if candidate_take_profit is not None and candidate_take_profit != open_trade.take_profit:
            if trade_levels_valid(open_trade.side, open_trade.entry_price, open_trade.stop_loss, candidate_take_profit, asset.tick_size):
                open_trade.take_profit = candidate_take_profit
                open_trade.tp_units = signal_units(open_trade.entry_price, candidate_take_profit, asset.tick_size)


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
            exit_price = float(data.open[index])
            exit_reason = "sl_gap"
        elif side == -1 and data.open[index] >= open_trade.stop_loss:
            exit_price = float(data.open[index])
            exit_reason = "sl_gap"
        elif side == 1 and data.open[index] >= open_trade.take_profit:
            exit_price = float(data.open[index])
            exit_reason = "tp_gap"
        elif side == -1 and data.open[index] <= open_trade.take_profit:
            exit_price = float(data.open[index])
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
    )


def run_single_strategy(
    strategy: BacktestStrategy,
    asset: AssetConfig,
    data: EnrichedData,
    start_ts: int = BACKTEST_START_TS,
    end_ts: int | None = None,
    strict_anti_cheat: bool = True,
) -> list[BacktestTradeRow]:
    config = runtime_config(strategy.variant_id)
    max_bars = max(1, config.max_bars)
    one_trade_per_day = strategy.one_trade_per_day or config.one_trade_per_day
    trades: list[BacktestTradeRow] = []
    open_trade: OpenTrade | None = None
    pending_order: PendingOrder | None = None
    last_entry_day = -1

    for index in range(data.times.shape[0]):
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

        if data.times[index + 1] < start_ts:
            continue
        if end_ts is not None and data.times[index + 1] >= end_ts:
            continue

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

        entry_index = index + 1
        if one_trade_per_day and data.ny_days[entry_index] == last_entry_day:
            continue
        open_trade = build_market_trade(signal, data, index, asset, max_bars)
        if open_trade is None:
            continue
        last_entry_day = int(data.ny_days[entry_index])

    if open_trade is not None:
        final_index = data.times.shape[0] - 1
        trades.append(complete_trade(strategy, asset, data, open_trade, final_index, float(data.close[final_index]), "end"))

    return trades


def iso_time(timestamp: int) -> str:
    return datetime.fromtimestamp(int(timestamp), tz=timezone.utc).isoformat().replace("+00:00", "Z")


def csv_number(value: float) -> str:
    if not math.isfinite(value):
        return "0"
    return f"{value:.12f}".rstrip("0").rstrip(".")


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
                ]
            )
    temp_path.replace(csv_path)


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

    requested = [item.strip() for item in strategy_filters if item and item.strip()]
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


def run_backtests(
    strategy_filters: list[str] | None = None,
    timings: bool = False,
    start_ts: int | None = None,
    end_ts: int | None = None,
    tail_bars: int | None = None,
    strict_anti_cheat: bool = True,
    write_output: bool = True,
) -> None:
    assets = load_asset_by_key()
    enriched_cache: dict[str, EnrichedData] = {}
    strategies = selected_backtest_strategies(strategy_filters)
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
            if timings:
                print(f"Starting {strategy.id}")
            if asset.key not in enriched_cache:
                candle_path = DATA_ROOT / "15m" / asset.data_file
                if not candle_path.exists():
                    raise FileNotFoundError(f"Missing 15m candle file: {candle_path}. Run prepare-data first.")
                if timings:
                    print(f"  loading {candle_path}")
                frame = load_candle_csv(candle_path)
                if tail_bars is not None and tail_bars > 0:
                    frame = frame.tail(tail_bars)
                    if timings:
                        print(f"  tail-bars {tail_bars}")
                enriched_cache[asset.key] = build_enriched_data(frame, asset)
                if timings:
                    print(f"  enriched {asset.key}")

            if timings:
                print(f"  running {strategy.id}")
            trades = run_single_strategy(
                strategy,
                asset,
                enriched_cache[asset.key],
                start_ts=start_ts if start_ts is not None else BACKTEST_START_TS,
                end_ts=end_ts,
                strict_anti_cheat=strict_anti_cheat,
            )
            if write_output:
                write_strategy_backtest_csv(output_path, trades)
            elapsed = perf_counter() - strategy_start
            if timings:
                destination = output_path if write_output else "(no write)"
                print(f"{strategy.id}: {len(trades)} trades in {elapsed:.2f}s -> {destination}")
            else:
                if write_output:
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
    enriched_cache: dict[str, EnrichedData] = {}
    strategies = selected_backtest_strategies(strategy_filters)
    mismatches: list[tuple[str, str]] = []

    print(f"Auditing anti-cheat on {len(strategies)} strategy(s)")
    for strategy in strategies:
        asset = assets[strategy.asset_key]
        if asset.key not in enriched_cache:
            candle_path = DATA_ROOT / "15m" / asset.data_file
            if not candle_path.exists():
                raise FileNotFoundError(f"Missing 15m candle file: {candle_path}. Run prepare-data first.")
            frame = load_candle_csv(candle_path)
            if tail_bars is not None and tail_bars > 0:
                frame = frame.tail(tail_bars)
            enriched_cache[asset.key] = build_enriched_data(frame, asset)

        data = enriched_cache[asset.key]
        fast_trades = run_single_strategy(
            strategy,
            asset,
            data,
            start_ts=start_ts if start_ts is not None else BACKTEST_START_TS,
            end_ts=end_ts,
            strict_anti_cheat=False,
        )
        strict_trades = run_single_strategy(
            strategy,
            asset,
            data,
            start_ts=start_ts if start_ts is not None else BACKTEST_START_TS,
            end_ts=end_ts,
            strict_anti_cheat=True,
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

    prepare = subparsers.add_parser("prepare-data", help="Import 15m candles and build higher timeframes")
    prepare.add_argument("--source", help="Optional source folder. Defaults to data/15m and also accepts the old legacy filenames.")

    run = subparsers.add_parser("run-backtests", help="Regenerate strategy backtest CSV files")
    run.add_argument("--strategy", action="append", help="Optional strategy id/folder/asset filter. Repeat to include multiple.")
    run.add_argument("--timings", action="store_true", help="Print per-strategy and total runtime timings.")
    run.add_argument("--start-date", help="Optional inclusive UTC start date in YYYY-MM-DD format for bounded test runs.")
    run.add_argument("--end-date", help="Optional exclusive UTC end date in YYYY-MM-DD format for bounded test runs.")
    run.add_argument("--tail-bars", type=int, help="Optional smoke-test mode: keep only the most recent N 15m bars before enriching.")
    run.add_argument("--strict-anti-cheat", action="store_true", help="Deprecated alias. Strict anti-cheat mode is now the default.")
    run.add_argument("--fast-unsafe", action="store_true", help="Disable anti-cheat window slicing for faster exploratory runs.")
    run.add_argument("--no-write", action="store_true", help="Compute results without overwriting backtest CSV files.")

    listing = subparsers.add_parser("list-backtests", help="List available backtest strategies")
    listing.add_argument("--strategy", action="append", help="Optional strategy id/folder/asset filter. Repeat to include multiple.")

    audit = subparsers.add_parser("audit-anti-cheat", help="Compare fast mode against strict anti-cheat mode")
    audit.add_argument("--strategy", action="append", help="Optional strategy id/folder/asset filter. Repeat to include multiple.")
    audit.add_argument("--start-date", help="Optional inclusive UTC start date in YYYY-MM-DD format.")
    audit.add_argument("--end-date", help="Optional exclusive UTC end date in YYYY-MM-DD format.")
    audit.add_argument("--tail-bars", type=int, help="Optional anti-cheat audit sample size using the most recent N 15m bars.")
    audit.add_argument("--fail-fast", action="store_true", help="Stop on the first anti-cheat drift.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.command == "prepare-data":
        prepare_data(Path(args.source).resolve() if args.source else None)
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
