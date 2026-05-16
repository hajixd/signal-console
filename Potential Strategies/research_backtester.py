from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable
from zoneinfo import ZoneInfo

import numpy as np
import polars as pl


PROJECT_ROOT = Path(__file__).resolve().parents[1]
POTENTIAL_ROOT = Path(__file__).resolve().parent
CONFIG_PATH = PROJECT_ROOT / "config" / "assets.json"
DATA_ROOT = PROJECT_ROOT / "data" / "15m"
STRATEGY_ROOT = PROJECT_ROOT / "strategy"
RESULTS_DIR = POTENTIAL_ROOT / "results"
NEW_YORK = ZoneInfo("America/New_York")
BACKTEST_START_TS = int(datetime(2022, 1, 1, tzinfo=timezone.utc).timestamp())


FUTURES_AND_FOREX = {"futures", "forex"}

SOURCE_URLS = {
    "night_day": "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1004081",
    "intraday_momentum": "https://www.sciencedirect.com/science/article/abs/pii/S0304405X18301351",
    "time_series_momentum": "https://pages.stern.nyu.edu/~lpederse/papers/TimeSeriesMomentum.pdf",
    "intraday_patterns": "https://ideas.repec.org/a/bla/jfinan/v65y2010i4p1369-1407.html",
    "crude_intraday": "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3822093",
    "fx_intraday": "https://biblio.ugent.be/publication/8060014",
}


@dataclass(frozen=True)
class Asset:
    key: str
    symbol: str
    name: str
    market: str
    data_file: str
    tick_size: float


@dataclass
class AssetData:
    asset: Asset
    time: np.ndarray
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    atr14: np.ndarray
    ema50: np.ndarray
    ema200: np.ndarray
    ny_dates: list[str]
    ny_minutes: np.ndarray
    ny_weekdays: np.ndarray
    by_day_minute: dict[tuple[str, int], int]
    days: list[str]


@dataclass
class Trade:
    strategy_id: str
    asset_key: str
    market: str
    family: str
    signal_time: int
    entry_time: int
    exit_time: int
    side: int
    entry_price: float
    exit_price: float
    r_multiple: float
    exit_reason: str


@dataclass
class Candidate:
    strategy_id: str
    label: str
    asset: Asset
    family: str
    provenance: str
    hypothesis: str
    source_urls: list[str]
    params: dict[str, object]
    trades: list[Trade]
    profit_factor: float
    total_r: float
    win_rate: float
    max_drawdown_r: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Isolated research-derived potential strategy scanner.")
    parser.add_argument("--min-pf", type=float, default=2.0)
    parser.add_argument("--min-trades", type=int, default=21)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--write", action="store_true", help="Write isolated potential strategy folders.")
    parser.add_argument("--asset", action="append", help="Optional asset key filter. Repeat or comma-separate.")
    return parser.parse_args()


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def load_assets(filters: Iterable[str] | None = None) -> list[Asset]:
    requested = {
        item.strip().lower()
        for raw in (filters or [])
        for item in raw.split(",")
        if item.strip()
    }
    payload = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    assets: list[Asset] = []
    for key, raw in payload.items():
        asset = Asset(
            key=key,
            symbol=raw["symbol"],
            name=raw["name"],
            market=raw["market"],
            data_file=raw["dataFile"],
            tick_size=float(raw["tickSize"]),
        )
        if asset.market not in FUTURES_AND_FOREX:
            continue
        if requested and asset.key.lower() not in requested and asset.symbol.lower() not in requested:
            continue
        assets.append(asset)
    return assets


def ema(values: np.ndarray, span: int) -> np.ndarray:
    output = np.empty(values.shape[0], dtype=float)
    alpha = 2.0 / (span + 1.0)
    current = float(values[0])
    output[0] = current
    for index in range(1, values.shape[0]):
        current = alpha * float(values[index]) + (1.0 - alpha) * current
        output[index] = current
    return output


def atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, length: int = 14) -> np.ndarray:
    true_range = np.empty(close.shape[0], dtype=float)
    true_range[0] = high[0] - low[0]
    for index in range(1, close.shape[0]):
        true_range[index] = max(
            high[index] - low[index],
            abs(high[index] - close[index - 1]),
            abs(low[index] - close[index - 1]),
        )
    output = np.empty(close.shape[0], dtype=float)
    output[:] = np.nan
    if close.shape[0] < length:
        return output
    current = float(np.mean(true_range[:length]))
    output[length - 1] = current
    for index in range(length, close.shape[0]):
        current = ((current * (length - 1)) + true_range[index]) / length
        output[index] = current
    return output


def load_asset_data(asset: Asset) -> AssetData:
    frame = pl.read_csv(DATA_ROOT / asset.data_file).sort("time")
    times = frame["time"].to_numpy()
    opens = frame["open"].to_numpy()
    highs = frame["high"].to_numpy()
    lows = frame["low"].to_numpy()
    closes = frame["close"].to_numpy()

    ny_dates: list[str] = []
    ny_minutes_list: list[int] = []
    ny_weekdays_list: list[int] = []
    by_day_minute: dict[tuple[str, int], int] = {}
    days_seen: dict[str, None] = {}

    for index, raw_time in enumerate(times):
        dt = datetime.fromtimestamp(int(raw_time), tz=timezone.utc).astimezone(NEW_YORK)
        day = dt.date().isoformat()
        minute = dt.hour * 60 + dt.minute
        ny_dates.append(day)
        ny_minutes_list.append(minute)
        ny_weekdays_list.append(dt.weekday())
        by_day_minute[(day, minute)] = index
        days_seen.setdefault(day, None)

    return AssetData(
        asset=asset,
        time=times,
        open=opens,
        high=highs,
        low=lows,
        close=closes,
        atr14=atr(highs, lows, closes),
        ema50=ema(closes, 50),
        ema200=ema(closes, 200),
        ny_dates=ny_dates,
        ny_minutes=np.asarray(ny_minutes_list, dtype=int),
        ny_weekdays=np.asarray(ny_weekdays_list, dtype=int),
        by_day_minute=by_day_minute,
        days=list(days_seen.keys()),
    )


def safe_atr(data: AssetData, index: int) -> float:
    value = float(data.atr14[index]) if index >= 0 else math.nan
    if not math.isfinite(value) or value <= 0:
        return max(float(data.high[index] - data.low[index]), data.asset.tick_size * 10.0)
    return value


def trade_metrics(trades: list[Trade]) -> tuple[float, float, float, float]:
    wins = [trade.r_multiple for trade in trades if trade.r_multiple > 0]
    losses = [trade.r_multiple for trade in trades if trade.r_multiple < 0]
    gross_wins = sum(wins)
    gross_losses = sum(abs(value) for value in losses)
    profit_factor = math.inf if gross_losses == 0 and gross_wins > 0 else (gross_wins / gross_losses if gross_losses else 0.0)
    total_r = sum(trade.r_multiple for trade in trades)
    equity = 0.0
    peak = 0.0
    max_drawdown = 0.0
    for trade in sorted(trades, key=lambda item: item.exit_time):
        equity += trade.r_multiple
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, peak - equity)
    win_rate = len(wins) / len(trades) if trades else 0.0
    return profit_factor, total_r, win_rate, max_drawdown


def make_candidate(
    data: AssetData,
    family: str,
    provenance: str,
    hypothesis: str,
    source_urls: list[str],
    params: dict[str, object],
    trades: list[Trade],
) -> Candidate | None:
    if not trades:
        return None
    pf, total_r, win_rate, max_dd = trade_metrics(trades)
    fingerprint = slug("|".join(f"{key}={value}" for key, value in sorted(params.items())))
    raw_id = f"{data.asset.key}|{family}|{json.dumps(params, sort_keys=True, default=str)}"
    digest = hashlib.sha1(raw_id.encode("utf-8")).hexdigest()[:8]
    strategy_id = f"{slug(f'{data.asset.key}_{family}_{fingerprint}')[:90]}_{digest}"
    for trade in trades:
        trade.strategy_id = strategy_id
    label = f"{data.asset.symbol} {family.replace('_', ' ').title()}"
    return Candidate(
        strategy_id=strategy_id,
        label=label,
        asset=data.asset,
        family=family,
        provenance=provenance,
        hypothesis=hypothesis,
        source_urls=source_urls,
        params=params,
        trades=trades,
        profit_factor=pf,
        total_r=total_r,
        win_rate=win_rate,
        max_drawdown_r=max_dd,
    )


def clone_trade(trade: Trade) -> Trade:
    return Trade(
        strategy_id=trade.strategy_id,
        asset_key=trade.asset_key,
        market=trade.market,
        family=trade.family,
        signal_time=trade.signal_time,
        entry_time=trade.entry_time,
        exit_time=trade.exit_time,
        side=trade.side,
        entry_price=trade.entry_price,
        exit_price=trade.exit_price,
        r_multiple=trade.r_multiple,
        exit_reason=trade.exit_reason,
    )


def ny_datetime(timestamp: int) -> datetime:
    return datetime.fromtimestamp(int(timestamp), tz=timezone.utc).astimezone(NEW_YORK)


def filtered_candidate(
    base: Candidate,
    filter_name: str,
    filter_value: object,
    predicate: Callable[[Trade], bool],
) -> Candidate | None:
    selected_source = [trade for trade in base.trades if predicate(trade)]
    if len(selected_source) <= 21:
        return None
    pf, total_r, _win_rate, _max_dd = trade_metrics(selected_source)
    if pf <= 1.5 or total_r <= 0:
        return None
    filtered_trades = [clone_trade(trade) for trade in selected_source]
    params = dict(base.params)
    params[filter_name] = filter_value
    data_stub = AssetData(
        asset=base.asset,
        time=np.asarray([], dtype=int),
        open=np.asarray([], dtype=float),
        high=np.asarray([], dtype=float),
        low=np.asarray([], dtype=float),
        close=np.asarray([], dtype=float),
        atr14=np.asarray([], dtype=float),
        ema50=np.asarray([], dtype=float),
        ema200=np.asarray([], dtype=float),
        ny_dates=[],
        ny_minutes=np.asarray([], dtype=int),
        ny_weekdays=np.asarray([], dtype=int),
        by_day_minute={},
        days=[],
    )
    return make_candidate(
        data_stub,
        f"{base.family}_{slug(filter_name)}",
        f"{base.provenance}/filter_scan",
        f"{base.hypothesis} Filtered by {filter_name}={filter_value}.",
        base.source_urls,
        params,
        filtered_trades,
    )


def refine_session_filters(candidates: list[Candidate]) -> list[Candidate]:
    refined: list[Candidate] = []
    for candidate in candidates:
        if candidate.profit_factor < 1.05 or len(candidate.trades) < 80:
            continue
        for weekday in range(5):
            item = filtered_candidate(
                candidate,
                "signalWeekday",
                weekday,
                lambda trade, weekday=weekday: ny_datetime(trade.signal_time).weekday() == weekday,
            )
            if item:
                refined.append(item)
        for side in (-1, 1):
            item = filtered_candidate(
                candidate,
                "sideFilter",
                "long" if side == 1 else "short",
                lambda trade, side=side: trade.side == side,
            )
            if item:
                refined.append(item)
        for weekday in range(5):
            for side in (-1, 1):
                item = filtered_candidate(
                    candidate,
                    "signalWeekdaySide",
                    f"{weekday}_{'long' if side == 1 else 'short'}",
                    lambda trade, weekday=weekday, side=side: ny_datetime(trade.signal_time).weekday() == weekday and trade.side == side,
                )
                if item:
                    refined.append(item)
        for month in range(1, 13):
            item = filtered_candidate(
                candidate,
                "signalMonth",
                month,
                lambda trade, month=month: ny_datetime(trade.signal_time).month == month,
            )
            if item:
                refined.append(item)
    return refined


def signed_return_trade(
    data: AssetData,
    strategy_id: str,
    family: str,
    signal_index: int,
    entry_index: int,
    exit_index: int,
    side: int,
    risk_atr_mult: float = 1.0,
) -> Trade | None:
    if entry_index <= signal_index or exit_index < entry_index:
        return None
    entry = float(data.open[entry_index])
    exit_price = float(data.close[exit_index])
    risk = safe_atr(data, entry_index) * risk_atr_mult
    if risk <= 0:
        return None
    r_multiple = side * (exit_price - entry) / risk
    return Trade(
        strategy_id=strategy_id,
        asset_key=data.asset.key,
        market=data.asset.market,
        family=family,
        signal_time=int(data.time[signal_index]),
        entry_time=int(data.time[entry_index]),
        exit_time=int(data.time[exit_index]),
        side=side,
        entry_price=entry,
        exit_price=exit_price,
        r_multiple=r_multiple,
        exit_reason="time_exit",
    )


def day_index(data: AssetData, day: str, minute: int) -> int | None:
    return data.by_day_minute.get((day, minute))


def previous_day(days: list[str], position: int) -> str | None:
    return days[position - 1] if position > 0 else None


def session_return(data: AssetData, day: str, open_minute: int, close_bar_minute: int) -> tuple[int, int, float] | None:
    start = day_index(data, day, open_minute)
    end = day_index(data, day, close_bar_minute)
    if start is None or end is None:
        return None
    return start, end, float(data.close[end] - data.open[start])


def scan_intraday_momentum(data: AssetData) -> list[Candidate]:
    specs = [
        ("us_first30_last30_momentum", 570, 585, 930, 945, 1, SOURCE_URLS["intraday_momentum"]),
        ("us_first30_last30_reversal", 570, 585, 930, 945, -1, SOURCE_URLS["intraday_momentum"]),
        ("us_secondlast_last30_momentum", 900, 915, 930, 945, 1, SOURCE_URLS["intraday_patterns"]),
        ("london_first30_ny_open_momentum", 180, 195, 480, 570, 1, SOURCE_URLS["fx_intraday"]),
        ("london_first30_ny_open_reversal", 180, 195, 480, 570, -1, SOURCE_URLS["fx_intraday"]),
    ]
    thresholds = [0.0, 0.05, 0.10, 0.20, 0.35, 0.50]
    candidates: list[Candidate] = []
    for family, sig_start, sig_end, entry_minute, exit_minute, direction, source_url in specs:
        for threshold in thresholds:
            trades: list[Trade] = []
            for day in data.days:
                sig = session_return(data, day, sig_start, sig_end)
                entry_index = day_index(data, day, entry_minute)
                exit_index = day_index(data, day, exit_minute)
                if sig is None or entry_index is None or exit_index is None:
                    continue
                sig_start_index, sig_end_index, move = sig
                if data.time[entry_index] < BACKTEST_START_TS:
                    continue
                atr_value = safe_atr(data, sig_end_index)
                if atr_value <= 0 or abs(move) / atr_value < threshold:
                    continue
                side = 1 if move > 0 else -1
                if side == 0:
                    continue
                trade = signed_return_trade(data, "", family, sig_end_index, entry_index, exit_index, side * direction)
                if trade is not None:
                    trades.append(trade)
            candidate = make_candidate(
                data,
                family,
                "research_derived/session_specific",
                "Session-window return predicts a later same-day session return.",
                [source_url],
                {
                    "signalStartMinute": sig_start,
                    "signalEndBarMinute": sig_end,
                    "entryMinute": entry_minute,
                    "exitBarMinute": exit_minute,
                    "direction": "same" if direction == 1 else "opposite",
                    "minSignalAtr": threshold,
                },
                trades,
            )
            if candidate:
                candidates.append(candidate)
    return candidates


def scan_overnight_and_gap(data: AssetData) -> list[Candidate]:
    candidates: list[Candidate] = []
    gap_thresholds = [0.0, 0.10, 0.20, 0.35, 0.50, 0.75]
    day_exit_minutes = [615, 660, 945]

    for side_name, side in [("long", 1), ("short", -1)]:
        trades: list[Trade] = []
        for pos, day in enumerate(data.days):
            prev = previous_day(data.days, pos)
            if prev is None:
                continue
            entry_index = day_index(data, prev, 945)
            exit_index = day_index(data, day, 570)
            if entry_index is None or exit_index is None or data.time[exit_index] < BACKTEST_START_TS:
                continue
            trade = signed_return_trade(data, "", "overnight_close_to_open_bias", entry_index, entry_index + 1, exit_index, side)
            if trade:
                trade.entry_price = float(data.close[entry_index])
                trade.r_multiple = side * (trade.exit_price - trade.entry_price) / safe_atr(data, entry_index)
                trades.append(trade)
        candidate = make_candidate(
            data,
            "overnight_close_to_open_bias",
            "research_derived/session_specific",
            "Tests the close-to-open leg emphasized by overnight return research.",
            [SOURCE_URLS["night_day"]],
            {"side": side_name, "entry": "prior_rth_close", "exit": "ny_open"},
            trades,
        )
        if candidate:
            candidates.append(candidate)

    for threshold in gap_thresholds:
        for exit_minute in day_exit_minutes:
            for direction, family in [(-1, "ny_open_gap_fade"), (1, "ny_open_gap_continuation")]:
                trades = []
                for pos, day in enumerate(data.days):
                    prev = previous_day(data.days, pos)
                    if prev is None:
                        continue
                    prev_close = day_index(data, prev, 945)
                    open_index = day_index(data, day, 570)
                    exit_index = day_index(data, day, exit_minute)
                    if prev_close is None or open_index is None or exit_index is None or data.time[open_index] < BACKTEST_START_TS:
                        continue
                    gap = float(data.open[open_index] - data.close[prev_close])
                    atr_value = safe_atr(data, prev_close)
                    if atr_value <= 0 or abs(gap) / atr_value < threshold:
                        continue
                    side = 1 if gap > 0 else -1
                    trade = signed_return_trade(data, "", family, prev_close, open_index, exit_index, side * direction)
                    if trade:
                        trades.append(trade)
                candidate = make_candidate(
                    data,
                    family,
                    "research_derived/session_specific",
                    "Tests whether the overnight gap fades or continues during a specific NY cash-session window.",
                    [SOURCE_URLS["night_day"]],
                    {
                        "minGapAtr": threshold,
                        "entryMinute": 570,
                        "exitBarMinute": exit_minute,
                        "direction": "fade" if direction == -1 else "continue",
                    },
                    trades,
                )
                if candidate:
                    candidates.append(candidate)
    return candidates


def scan_range_breakouts(data: AssetData) -> list[Candidate]:
    sessions = [
        ("asia_range_london_breakout", 1080, 165, 180, 360, 600, SOURCE_URLS["fx_intraday"]),
        ("ny_opening_range_breakout", 570, 585, 600, 720, 945, SOURCE_URLS["intraday_momentum"]),
    ]
    rr_values = [1.0, 1.5, 2.0, 2.5]
    candidates: list[Candidate] = []
    for family, range_start, range_end, break_start, break_end, forced_exit, source_url in sessions:
        for rr in rr_values:
            for direction in [1, -1]:
                trades: list[Trade] = []
                for pos, day in enumerate(data.days):
                    if data.asset.market == "futures" and family.startswith("asia") and data.asset.key not in {
                        "euro_futures",
                        "british_pound_futures",
                        "japanese_yen_futures",
                        "australian_dollar_futures",
                        "new_zealand_dollar_futures",
                        "canadian_dollar_futures",
                        "swiss_franc_futures",
                    }:
                        continue
                    if family.startswith("asia"):
                        prev = previous_day(data.days, pos)
                        if prev is None:
                            continue
                        range_indices = [
                            index
                            for minute in range(range_start, 24 * 60, 15)
                            if (index := day_index(data, prev, minute)) is not None
                        ] + [
                            index
                            for minute in range(0, range_end + 1, 15)
                            if (index := day_index(data, day, minute)) is not None
                        ]
                    else:
                        range_indices = [
                            index
                            for minute in range(range_start, range_end + 1, 15)
                            if (index := day_index(data, day, minute)) is not None
                        ]
                    if not range_indices:
                        continue
                    high = max(float(data.high[index]) for index in range_indices)
                    low = min(float(data.low[index]) for index in range_indices)
                    if high <= low:
                        continue
                    forced_exit_index = day_index(data, day, forced_exit)
                    if forced_exit_index is None or data.time[forced_exit_index] < BACKTEST_START_TS:
                        continue

                    opened = False
                    for minute in range(break_start, break_end + 1, 15):
                        index = day_index(data, day, minute)
                        if index is None or index + 1 >= len(data.time):
                            continue
                        break_side = 0
                        if data.high[index] > high:
                            break_side = 1
                        elif data.low[index] < low:
                            break_side = -1
                        if break_side == 0:
                            continue
                        side = break_side * direction
                        entry_index = index + 1
                        entry = float(data.open[entry_index])
                        if direction == 1:
                            stop = low if side == 1 else high
                        else:
                            stop = float(data.low[index]) if side == 1 else float(data.high[index])
                        risk = abs(entry - stop)
                        stop_is_valid = (side == 1 and stop < entry) or (side == -1 and stop > entry)
                        if not stop_is_valid or risk <= data.asset.tick_size:
                            continue
                        target = entry + side * risk * rr
                        exit_price = float(data.close[forced_exit_index])
                        exit_index = forced_exit_index
                        exit_reason = "time_exit"
                        for cursor in range(entry_index, forced_exit_index + 1):
                            if side == 1:
                                stopped = data.low[cursor] <= stop
                                targeted = data.high[cursor] >= target
                            else:
                                stopped = data.high[cursor] >= stop
                                targeted = data.low[cursor] <= target
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
                        r_multiple = side * (exit_price - entry) / risk
                        trades.append(
                            Trade(
                                strategy_id="",
                                asset_key=data.asset.key,
                                market=data.asset.market,
                                family=family,
                                signal_time=int(data.time[index]),
                                entry_time=int(data.time[entry_index]),
                                exit_time=int(data.time[exit_index]),
                                side=side,
                                entry_price=entry,
                                exit_price=float(exit_price),
                                r_multiple=float(r_multiple),
                                exit_reason=exit_reason,
                            )
                        )
                        opened = True
                        break
                    if opened:
                        continue
                candidate = make_candidate(
                    data,
                    family,
                    "research_derived/session_specific",
                    "Tests whether a defined session range break continues or should be faded.",
                    [source_url],
                    {
                        "rangeStartMinute": range_start,
                        "rangeEndMinute": range_end,
                        "breakStartMinute": break_start,
                        "breakEndMinute": break_end,
                        "forcedExitMinute": forced_exit,
                        "riskReward": rr,
                        "direction": "breakout" if direction == 1 else "fade",
                    },
                    trades,
                )
                if candidate:
                    candidates.append(candidate)
    return candidates


def scan_daily_time_series_momentum(data: AssetData) -> list[Candidate]:
    lookbacks = [3, 5, 10, 20, 40]
    sessions = [
        ("daily_tsmom_next_rth", 570, 945),
        ("daily_tsmom_next_overnight", 945, 570),
    ]
    candidates: list[Candidate] = []
    closes: list[tuple[str, int, float]] = []
    for day in data.days:
        close_index = day_index(data, day, 945)
        if close_index is not None:
            closes.append((day, close_index, float(data.close[close_index])))
    close_by_day = {day: (index, value) for day, index, value in closes}
    ordered_days = [day for day, _, _ in closes]

    for lookback in lookbacks:
        for family, entry_minute, exit_minute in sessions:
            for direction in [1, -1]:
                trades: list[Trade] = []
                for pos in range(lookback, len(ordered_days) - 1):
                    day = ordered_days[pos]
                    prev_day = ordered_days[pos - lookback]
                    _, current_close = close_by_day[day]
                    _, past_close = close_by_day[prev_day]
                    signal = current_close - past_close
                    if signal == 0:
                        continue
                    side = (1 if signal > 0 else -1) * direction
                    if family.endswith("overnight"):
                        next_day = ordered_days[pos + 1]
                        signal_index = close_by_day[day][0]
                        entry_index = signal_index + 1
                        exit_index = day_index(data, next_day, exit_minute)
                        if exit_index is None or data.time[exit_index] < BACKTEST_START_TS:
                            continue
                        trade = signed_return_trade(data, "", family, signal_index, entry_index, exit_index, side)
                    else:
                        next_day = ordered_days[pos + 1]
                        signal_index = close_by_day[day][0]
                        entry_index = day_index(data, next_day, entry_minute)
                        exit_index = day_index(data, next_day, exit_minute)
                        if entry_index is None or exit_index is None or data.time[entry_index] < BACKTEST_START_TS:
                            continue
                        trade = signed_return_trade(data, "", family, signal_index, entry_index, exit_index, side)
                    if trade:
                        trades.append(trade)
                candidate = make_candidate(
                    data,
                    family,
                    "research_derived",
                    "Tests short-horizon own-return continuation/reversal inspired by time-series momentum literature.",
                    [SOURCE_URLS["time_series_momentum"]],
                    {
                        "lookbackDays": lookback,
                        "direction": "momentum" if direction == 1 else "contrarian",
                        "entryMinute": entry_minute,
                        "exitMinute": exit_minute,
                    },
                    trades,
                )
                if candidate:
                    candidates.append(candidate)
    return candidates


def existing_live_signatures() -> set[tuple[str, str, str]]:
    signatures: set[tuple[str, str, str]] = set()
    for folder in STRATEGY_ROOT.iterdir():
        if not folder.is_dir():
            continue
        for relative in ("machine_learning/selection.json", "bayes/selection.json", "parameters/backtest.json"):
            path = folder / relative
            if path.exists():
                payload = json.loads(path.read_text(encoding="utf-8"))
                signatures.add((str(payload.get("assetKey")), str(payload.get("phase")), str(payload.get("variantId"))))
                break
    return signatures


def select_candidates(candidates: list[Candidate], min_pf: float, min_trades: int, limit: int) -> list[Candidate]:
    qualified = [
        candidate
        for candidate in candidates
        if candidate.profit_factor > min_pf
        and len(candidate.trades) > min_trades
        and candidate.total_r > 0
    ]
    qualified.sort(key=lambda item: (item.profit_factor if math.isfinite(item.profit_factor) else 999.0, item.total_r), reverse=True)

    selected: list[Candidate] = []
    family_counts: dict[str, int] = {}
    asset_counts: dict[str, int] = {}
    market_counts: dict[str, int] = {}

    def can_add(candidate: Candidate, relaxed: bool = False) -> bool:
        if any(existing.strategy_id == candidate.strategy_id for existing in selected):
            return False
        if not relaxed and family_counts.get(candidate.family, 0) >= 4:
            return False
        if not relaxed and asset_counts.get(candidate.asset.key, 0) >= 3:
            return False
        return True

    for market in ("futures", "forex"):
        for candidate in qualified:
            if candidate.asset.market != market:
                continue
            if market_counts.get(market, 0) >= max(4, limit // 3):
                break
            if can_add(candidate):
                selected.append(candidate)
                family_counts[candidate.family] = family_counts.get(candidate.family, 0) + 1
                asset_counts[candidate.asset.key] = asset_counts.get(candidate.asset.key, 0) + 1
                market_counts[market] = market_counts.get(market, 0) + 1

    for candidate in qualified:
        if len(selected) >= limit:
            break
        if can_add(candidate):
            selected.append(candidate)
            family_counts[candidate.family] = family_counts.get(candidate.family, 0) + 1
            asset_counts[candidate.asset.key] = asset_counts.get(candidate.asset.key, 0) + 1
            market_counts[candidate.asset.market] = market_counts.get(candidate.asset.market, 0) + 1

    for candidate in qualified:
        if len(selected) >= limit:
            break
        if can_add(candidate, relaxed=True):
            selected.append(candidate)

    return selected


def candidate_row(candidate: Candidate) -> dict[str, object]:
    return {
        "strategy_id": candidate.strategy_id,
        "label": candidate.label,
        "asset_key": candidate.asset.key,
        "symbol": candidate.asset.symbol,
        "market": candidate.asset.market,
        "family": candidate.family,
        "provenance": candidate.provenance,
        "profit_factor": "inf" if math.isinf(candidate.profit_factor) else round(candidate.profit_factor, 6),
        "trades": len(candidate.trades),
        "total_r": round(candidate.total_r, 6),
        "win_rate_pct": round(candidate.win_rate * 100.0, 2),
        "max_drawdown_r": round(candidate.max_drawdown_r, 6),
        "params": json.dumps(candidate.params, sort_keys=True),
    }


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def write_candidate(candidate: Candidate) -> None:
    folder = POTENTIAL_ROOT / candidate.strategy_id
    folder.mkdir(parents=True, exist_ok=True)
    metadata = {
        "strategyId": candidate.strategy_id,
        "label": candidate.label,
        "assetKey": candidate.asset.key,
        "symbol": candidate.asset.symbol,
        "market": candidate.asset.market,
        "family": candidate.family,
        "provenance": candidate.provenance,
        "status": "potential_not_live",
        "hypothesis": candidate.hypothesis,
        "sourceUrls": candidate.source_urls,
        "params": candidate.params,
        "metrics": {
            "profitFactor": "inf" if math.isinf(candidate.profit_factor) else round(candidate.profit_factor, 6),
            "trades": len(candidate.trades),
            "totalR": round(candidate.total_r, 6),
            "winRatePct": round(candidate.win_rate * 100.0, 2),
            "maxDrawdownR": round(candidate.max_drawdown_r, 6),
        },
        "isolationNote": "Stored under Potential Strategies only. Not imported into the live strategy catalog.",
    }
    (folder / "strategy.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    with (folder / "backtest_trades.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "strategy_id",
                "asset_key",
                "market",
                "family",
                "signal_time",
                "entry_time",
                "exit_time",
                "side",
                "entry_price",
                "exit_price",
                "r_multiple",
                "exit_reason",
            ],
        )
        writer.writeheader()
        for trade in candidate.trades:
            writer.writerow(
                {
                    "strategy_id": candidate.strategy_id,
                    "asset_key": trade.asset_key,
                    "market": trade.market,
                    "family": trade.family,
                    "signal_time": trade.signal_time,
                    "entry_time": trade.entry_time,
                    "exit_time": trade.exit_time,
                    "side": trade.side,
                    "entry_price": trade.entry_price,
                    "exit_price": trade.exit_price,
                    "r_multiple": trade.r_multiple,
                    "exit_reason": trade.exit_reason,
                }
            )
    research_lines = [
        f"# {candidate.label}",
        "",
        f"- Status: potential only, not live.",
        f"- Provenance: {candidate.provenance}.",
        f"- Family: {candidate.family}.",
        f"- Asset: {candidate.asset.name} ({candidate.asset.symbol}).",
        f"- Profit factor: {'inf' if math.isinf(candidate.profit_factor) else f'{candidate.profit_factor:.2f}'}.",
        f"- Trades: {len(candidate.trades)}.",
        f"- Total R: {candidate.total_r:.2f}.",
        "",
        "## Hypothesis",
        "",
        candidate.hypothesis,
        "",
        "## Sources",
        "",
    ]
    research_lines.extend(f"- {url}" for url in candidate.source_urls)
    (folder / "research.md").write_text("\n".join(research_lines) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    assets = load_assets(args.asset)
    all_candidates: list[Candidate] = []
    scanners: list[Callable[[AssetData], list[Candidate]]] = [
        scan_intraday_momentum,
        scan_overnight_and_gap,
        scan_range_breakouts,
        scan_daily_time_series_momentum,
    ]

    for asset in assets:
        print(f"Loading {asset.key} ({asset.market})")
        data = load_asset_data(asset)
        for scanner in scanners:
            produced = scanner(data)
            all_candidates.extend(produced)
        print(f"  candidates so far: {len(all_candidates)}")

    refined_candidates = refine_session_filters(all_candidates)
    if refined_candidates:
        print(f"Added {len(refined_candidates)} filtered session/regime candidates.")
        all_candidates.extend(refined_candidates)

    selected = select_candidates(all_candidates, args.min_pf, args.min_trades, args.limit)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    qualified_rows = [candidate_row(candidate) for candidate in selected]
    write_csv(RESULTS_DIR / "qualified_strategies.csv", qualified_rows)
    write_csv(
        RESULTS_DIR / "all_scanned_summary.csv",
        [candidate_row(candidate) for candidate in all_candidates],
    )

    if args.write:
        for candidate in selected:
            write_candidate(candidate)

    print(f"Scanned {len(all_candidates)} research/session candidates.")
    print(f"Selected {len(selected)} candidates with PF > {args.min_pf} and trades > {args.min_trades}.")
    for candidate in selected:
        pf = "inf" if math.isinf(candidate.profit_factor) else f"{candidate.profit_factor:.2f}"
        print(
            f"{candidate.strategy_id}: {candidate.asset.key} {candidate.family} "
            f"PF={pf} trades={len(candidate.trades)} totalR={candidate.total_r:.2f}"
        )


if __name__ == "__main__":
    main()
