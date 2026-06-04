from __future__ import annotations

import argparse
import ast
import concurrent.futures
import csv
import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
import polars as pl

from common import BACKTESTED_ROOT, DATA_ROOT, QUALIFIED_ROOT, READY_ROOT, REJECTED_ROOT, ensure_research_dirs, iter_json_files, load_assets, read_json, remove_if_inside, split_csv_arg, write_csv, write_json


NEW_YORK = ZoneInfo("America/New_York")
BACKTEST_START_TS = int(datetime(2022, 1, 1, tzinfo=timezone.utc).timestamp())


@dataclass(frozen=True)
class AssetData:
    key: str
    symbol: str
    market: str
    data_file: str
    tick_size: float
    time: np.ndarray
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    atr14: np.ndarray
    ema50: np.ndarray
    ema200: np.ndarray
    by_day_minute: dict[tuple[str, int], int]
    days: list[str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backtest Research/strategies/ready_to_backtest specs.")
    parser.add_argument("--min-pf", type=float, default=2.0)
    parser.add_argument("--min-trades", type=int, default=21)
    parser.add_argument("--limit", type=int, default=0, help="Optional max specs to process.")
    parser.add_argument("--workers", type=int, default=1, help="Parallel worker count. Use 1 for easiest debugging.")
    parser.add_argument("--asset", action="append", help="Asset key/symbol filter. Repeat or comma-separate.")
    parser.add_argument("--engine", action="append", help="Engine filter. Repeat or comma-separate.")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--clear-results", action="store_true")
    return parser.parse_args()


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


def load_data_for_spec(spec: dict[str, Any]) -> AssetData:
    asset_key = str(spec["assetKey"])
    asset = next(asset for asset in load_assets(asset_keys=[asset_key]) if asset.key == asset_key)
    frame = pl.read_csv(DATA_ROOT / asset.data_file).sort("time")
    times = frame["time"].to_numpy()
    opens = frame["open"].to_numpy()
    highs = frame["high"].to_numpy()
    lows = frame["low"].to_numpy()
    closes = frame["close"].to_numpy()
    by_day_minute: dict[tuple[str, int], int] = {}
    days_seen: dict[str, None] = {}
    for index, timestamp in enumerate(times):
        dt = datetime.fromtimestamp(int(timestamp), tz=timezone.utc).astimezone(NEW_YORK)
        day = dt.date().isoformat()
        minute = dt.hour * 60 + dt.minute
        by_day_minute[(day, minute)] = index
        days_seen.setdefault(day, None)
    return AssetData(
        key=asset.key,
        symbol=asset.symbol,
        market=asset.market,
        data_file=asset.data_file,
        tick_size=asset.tick_size,
        time=times,
        open=opens,
        high=highs,
        low=lows,
        close=closes,
        atr14=atr(highs, lows, closes),
        ema50=ema(closes, 50),
        ema200=ema(closes, 200),
        by_day_minute=by_day_minute,
        days=list(days_seen.keys()),
    )


def index_at(data: AssetData, day: str, minute: int) -> int | None:
    return data.by_day_minute.get((day, int(minute)))


def previous_day(data: AssetData, position: int) -> str | None:
    return data.days[position - 1] if position > 0 else None


def safe_atr(data: AssetData, index: int) -> float:
    value = float(data.atr14[index]) if 0 <= index < data.atr14.shape[0] else math.nan
    if math.isfinite(value) and value > 0:
        return value
    return max(float(data.high[index] - data.low[index]), data.tick_size * 10.0)


def ny_weekday(timestamp: int) -> int:
    return datetime.fromtimestamp(int(timestamp), tz=timezone.utc).astimezone(NEW_YORK).weekday()


def trade_row(
    spec: dict[str, Any],
    data: AssetData,
    signal_index: int,
    entry_index: int,
    exit_index: int,
    side: int,
    entry_price: float,
    exit_price: float,
    risk: float,
    exit_reason: str = "time_exit",
) -> dict[str, Any] | None:
    if risk <= 0 or entry_index < 0 or exit_index < entry_index or exit_index >= len(data.time):
        return None
    if data.time[entry_index] < BACKTEST_START_TS:
        return None
    r_multiple = side * (exit_price - entry_price) / risk
    return {
        "strategy_id": spec["strategyId"],
        "asset_key": data.key,
        "market": data.market,
        "engine": spec["engine"],
        "signal_time": int(data.time[signal_index]),
        "entry_time": int(data.time[entry_index]),
        "exit_time": int(data.time[exit_index]),
        "side": side,
        "entry_price": float(entry_price),
        "exit_price": float(exit_price),
        "r_multiple": float(r_multiple),
        "exit_reason": exit_reason,
    }


def metrics(trades: list[dict[str, Any]]) -> dict[str, Any]:
    wins = [float(trade["r_multiple"]) for trade in trades if float(trade["r_multiple"]) > 0]
    losses = [float(trade["r_multiple"]) for trade in trades if float(trade["r_multiple"]) < 0]
    gross_win = sum(wins)
    gross_loss = sum(abs(value) for value in losses)
    pf = math.inf if gross_loss == 0 and gross_win > 0 else (gross_win / gross_loss if gross_loss else 0.0)
    total_r = sum(float(trade["r_multiple"]) for trade in trades)
    equity = 0.0
    peak = 0.0
    drawdown = 0.0
    for trade in sorted(trades, key=lambda item: int(item["exit_time"])):
        equity += float(trade["r_multiple"])
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
    return {
        "profit_factor": pf,
        "trades": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate_pct": (len(wins) / len(trades) * 100.0) if trades else 0.0,
        "total_r": total_r,
        "max_drawdown_r": drawdown,
    }


def signal_move(data: AssetData, day: str, start_minute: int, end_minute: int) -> tuple[int, int, float] | None:
    start = index_at(data, day, start_minute)
    end = index_at(data, day, end_minute)
    if start is None or end is None:
        return None
    return start, end, float(data.close[end] - data.open[start])


def backtest_intraday_momentum(spec: dict[str, Any], data: AssetData) -> list[dict[str, Any]]:
    p = spec["params"]
    trades: list[dict[str, Any]] = []
    direction = 1 if p.get("direction") == "same" else -1
    weekday_filter = p.get("weekday")
    for day in data.days:
        signal = signal_move(data, day, int(p["signalStartMinute"]), int(p["signalEndMinute"]))
        entry_index = index_at(data, day, int(p["entryMinute"]))
        exit_index = index_at(data, day, int(p["exitMinute"]))
        if signal is None or entry_index is None or exit_index is None:
            continue
        signal_start, signal_end, move = signal
        if weekday_filter is not None and ny_weekday(int(data.time[signal_end])) != int(weekday_filter):
            continue
        atr_value = safe_atr(data, signal_end)
        if abs(move) / atr_value < float(p.get("minSignalAtr", 0.0)):
            continue
        side = (1 if move > 0 else -1) * direction
        if move == 0:
            continue
        row = trade_row(
            spec,
            data,
            signal_end,
            entry_index,
            exit_index,
            side,
            float(data.open[entry_index]),
            float(data.close[exit_index]),
            safe_atr(data, entry_index),
        )
        if row:
            trades.append(row)
    return trades


def backtest_overnight_bias(spec: dict[str, Any], data: AssetData) -> list[dict[str, Any]]:
    p = spec["params"]
    side = 1 if p.get("side") == "long" else -1
    entry_minute = int(p.get("entryMinute", 945))
    exit_minute = int(p.get("exitMinute", 570))
    trades: list[dict[str, Any]] = []
    for position, day in enumerate(data.days):
        prev = previous_day(data, position)
        if prev is None:
            continue
        entry_index = index_at(data, prev, entry_minute)
        exit_index = index_at(data, day, exit_minute)
        if entry_index is None or exit_index is None:
            continue
        row = trade_row(
            spec,
            data,
            entry_index,
            entry_index,
            exit_index,
            side,
            float(data.close[entry_index]),
            float(data.close[exit_index]),
            safe_atr(data, entry_index),
        )
        if row:
            trades.append(row)
    return trades


def backtest_open_gap(spec: dict[str, Any], data: AssetData) -> list[dict[str, Any]]:
    p = spec["params"]
    direction = -1 if p.get("direction") == "fade" else 1
    trades: list[dict[str, Any]] = []
    for position, day in enumerate(data.days):
        prev = previous_day(data, position)
        if prev is None:
            continue
        prev_close = index_at(data, prev, 945)
        open_index = index_at(data, day, int(p.get("entryMinute", 570)))
        exit_index = index_at(data, day, int(p.get("exitMinute", 945)))
        if prev_close is None or open_index is None or exit_index is None:
            continue
        gap = float(data.open[open_index] - data.close[prev_close])
        atr_value = safe_atr(data, prev_close)
        if abs(gap) / atr_value < float(p.get("minGapAtr", 0.0)):
            continue
        side = (1 if gap > 0 else -1) * direction
        row = trade_row(
            spec,
            data,
            prev_close,
            open_index,
            exit_index,
            side,
            float(data.open[open_index]),
            float(data.close[exit_index]),
            safe_atr(data, open_index),
        )
        if row:
            trades.append(row)
    return trades


def range_indices(data: AssetData, day_position: int, start_minute: int, end_minute: int) -> list[int]:
    day = data.days[day_position]
    if start_minute <= end_minute:
        return [index for minute in range(start_minute, end_minute + 1, 15) if (index := index_at(data, day, minute)) is not None]
    prev = previous_day(data, day_position)
    if prev is None:
        return []
    return [
        index
        for minute in range(start_minute, 24 * 60, 15)
        if (index := index_at(data, prev, minute)) is not None
    ] + [
        index
        for minute in range(0, end_minute + 1, 15)
        if (index := index_at(data, day, minute)) is not None
    ]


def backtest_range_break(spec: dict[str, Any], data: AssetData) -> list[dict[str, Any]]:
    p = spec["params"]
    trades: list[dict[str, Any]] = []
    fade = p.get("direction") == "fade"
    rr = float(p.get("riskReward", 1.5))
    for day_position, day in enumerate(data.days):
        indices = range_indices(data, day_position, int(p["rangeStartMinute"]), int(p["rangeEndMinute"]))
        if not indices:
            continue
        range_high = max(float(data.high[index]) for index in indices)
        range_low = min(float(data.low[index]) for index in indices)
        forced_exit = index_at(data, day, int(p["forcedExitMinute"]))
        if forced_exit is None:
            continue
        for minute in range(int(p["breakStartMinute"]), int(p["breakEndMinute"]) + 1, 15):
            signal_index = index_at(data, day, minute)
            if signal_index is None or signal_index + 1 >= len(data.time):
                continue
            break_side = 0
            if data.high[signal_index] > range_high:
                break_side = 1
            elif data.low[signal_index] < range_low:
                break_side = -1
            if break_side == 0:
                continue
            side = -break_side if fade else break_side
            entry_index = signal_index + 1
            entry = float(data.open[entry_index])
            stop = float(data.low[signal_index]) if side == 1 and fade else float(data.high[signal_index]) if side == -1 and fade else range_low if side == 1 else range_high
            if (side == 1 and stop >= entry) or (side == -1 and stop <= entry):
                continue
            risk = abs(entry - stop)
            if risk <= data.tick_size:
                continue
            target = entry + side * risk * rr
            exit_price = float(data.close[forced_exit])
            exit_index = forced_exit
            exit_reason = "time_exit"
            for cursor in range(entry_index, forced_exit + 1):
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
            row = trade_row(spec, data, signal_index, entry_index, exit_index, side, entry, exit_price, risk, exit_reason)
            if row:
                trades.append(row)
            break
    return trades


def backtest_daily_tsmom(spec: dict[str, Any], data: AssetData) -> list[dict[str, Any]]:
    p = spec["params"]
    lookback = int(p.get("lookbackDays", 5))
    direction = 1 if p.get("direction") == "momentum" else -1
    entry_minute = int(p.get("entryMinute", 570))
    exit_minute = int(p.get("exitMinute", 945))
    day_close = [(day, index_at(data, day, 945)) for day in data.days]
    day_close = [(day, index) for day, index in day_close if index is not None]
    trades: list[dict[str, Any]] = []
    for pos in range(lookback, len(day_close) - 1):
        day, signal_index = day_close[pos]
        past_day, past_index = day_close[pos - lookback]
        assert signal_index is not None and past_index is not None
        signal = float(data.close[signal_index] - data.close[past_index])
        if signal == 0:
            continue
        side = (1 if signal > 0 else -1) * direction
        next_day = day_close[pos + 1][0]
        if entry_minute == 945 and exit_minute == 570:
            entry_index = signal_index
            exit_index = index_at(data, next_day, exit_minute)
            entry_price = float(data.close[entry_index])
        else:
            entry_index = index_at(data, next_day, entry_minute)
            exit_index = index_at(data, next_day, exit_minute)
            if entry_index is None:
                continue
            entry_price = float(data.open[entry_index])
        if entry_index is None or exit_index is None:
            continue
        row = trade_row(spec, data, signal_index, entry_index, exit_index, side, entry_price, float(data.close[exit_index]), safe_atr(data, signal_index))
        if row:
            trades.append(row)
    return trades


SERIES_NAMES = {
    "open": "open",
    "high": "high",
    "low": "low",
    "close": "close",
    "ema50": "ema50",
    "ema200": "ema200",
    "atr": "atr14",
}


def llm_context(data: AssetData, index: int) -> dict[str, Any]:
    timestamp = int(data.time[index])
    dt = datetime.fromtimestamp(timestamp, tz=timezone.utc).astimezone(NEW_YORK)
    previous = max(index - 1, 0)
    return {
        "open": float(data.open[index]),
        "high": float(data.high[index]),
        "low": float(data.low[index]),
        "close": float(data.close[index]),
        "close_1": float(data.close[previous]),
        "atr": safe_atr(data, index),
        "ema50": float(data.ema50[index]),
        "ema200": float(data.ema200[index]),
        "minute": dt.hour * 60 + dt.minute,
        "weekday": dt.weekday(),
        "day": dt.date().isoformat(),
        "bar_index": index,
    }


def series_array(data: AssetData, name: str) -> np.ndarray:
    attr = SERIES_NAMES.get(name)
    if attr is None:
        raise ValueError(f"Unsupported LLM rule series: {name}")
    return getattr(data, attr)


def llm_rule_function(name: str, args: list[Any], data: AssetData, index: int) -> float:
    if name == "abs" and len(args) == 1:
        return abs(float(args[0]))
    if name == "min" and len(args) >= 1:
        return min(float(item) for item in args)
    if name == "max" and len(args) >= 1:
        return max(float(item) for item in args)
    if name in {"highest", "lowest", "change"}:
        if len(args) != 2:
            raise ValueError(f"{name} expects series name and lookback")
        series_name = str(args[0])
        lookback = max(1, int(float(args[1])))
        values = series_array(data, series_name)
        if name == "change":
            previous = max(0, index - lookback)
            return float(values[index] - values[previous])
        start = max(0, index - lookback)
        window = values[start:index]
        if window.size == 0:
            window = values[max(0, index - 1) : index + 1]
        return float(np.max(window) if name == "highest" else np.min(window))
    raise ValueError(f"Unsupported LLM rule function: {name}")


def eval_llm_node(node: ast.AST, context: dict[str, Any], data: AssetData, index: int) -> Any:
    if isinstance(node, ast.Expression):
        return eval_llm_node(node.body, context, data, index)
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        if node.id in context:
            return context[node.id]
        raise ValueError(f"Unsupported LLM rule name: {node.id}")
    if isinstance(node, ast.UnaryOp):
        value = eval_llm_node(node.operand, context, data, index)
        if isinstance(node.op, ast.Not):
            return not bool(value)
        if isinstance(node.op, ast.USub):
            return -float(value)
        if isinstance(node.op, ast.UAdd):
            return float(value)
    if isinstance(node, ast.BoolOp):
        values = [bool(eval_llm_node(value, context, data, index)) for value in node.values]
        if isinstance(node.op, ast.And):
            return all(values)
        if isinstance(node.op, ast.Or):
            return any(values)
    if isinstance(node, ast.BinOp):
        left = float(eval_llm_node(node.left, context, data, index))
        right = float(eval_llm_node(node.right, context, data, index))
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            return left / right if right else math.inf
        if isinstance(node.op, ast.Mod):
            return left % right if right else math.inf
    if isinstance(node, ast.Compare):
        left = eval_llm_node(node.left, context, data, index)
        for operator, comparator in zip(node.ops, node.comparators, strict=True):
            right = eval_llm_node(comparator, context, data, index)
            if isinstance(operator, ast.Eq):
                ok = left == right
            elif isinstance(operator, ast.NotEq):
                ok = left != right
            else:
                left_number = float(left)
                right_number = float(right)
                if isinstance(operator, ast.Lt):
                    ok = left_number < right_number
                elif isinstance(operator, ast.LtE):
                    ok = left_number <= right_number
                elif isinstance(operator, ast.Gt):
                    ok = left_number > right_number
                elif isinstance(operator, ast.GtE):
                    ok = left_number >= right_number
                else:
                    raise ValueError("Unsupported comparison operator")
            if not ok:
                return False
            left = right
        return True
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        args = [eval_llm_node(arg, context, data, index) for arg in node.args]
        return llm_rule_function(node.func.id, args, data, index)
    raise ValueError(f"Unsupported LLM rule syntax: {type(node).__name__}")


def eval_llm_condition(expression: str, data: AssetData, index: int) -> bool:
    try:
        tree = ast.parse(expression, mode="eval")
        return bool(eval_llm_node(tree, llm_context(data, index), data, index))
    except Exception:
        return False


def minute_in_window(minute: int, start: int, end: int) -> bool:
    if start <= end:
        return start <= minute <= end
    return minute >= start or minute <= end


def backtest_llm_rule_code(spec: dict[str, Any], data: AssetData) -> list[dict[str, Any]]:
    raw = spec.get("params", {}).get("ruleCode", spec.get("params", {}))
    if not isinstance(raw, dict):
        return []
    long_when = str(raw.get("longWhen", "")).strip()
    short_when = str(raw.get("shortWhen", "")).strip()
    risk_atr_mult = max(0.1, float(raw.get("riskAtrMult", 1.0) or 1.0))
    risk_reward = max(0.1, float(raw.get("riskReward", 1.5) or 1.5))
    max_bars = max(1, int(raw.get("maxBars", 24) or 24))
    one_trade_per_day = bool(raw.get("oneTradePerDay", True))
    session_start = int(raw.get("sessionStartMinute", 0) or 0)
    session_end = int(raw.get("sessionEndMinute", 1439) or 1439)
    exit_minute = int(raw.get("exitMinute", session_end) or session_end)
    used_days: set[str] = set()
    trades: list[dict[str, Any]] = []

    for signal_index in range(220, len(data.time) - 2):
        context = llm_context(data, signal_index)
        day = str(context["day"])
        minute = int(context["minute"])
        if one_trade_per_day and day in used_days:
            continue
        if not minute_in_window(minute, session_start, session_end):
            continue

        side = 0
        if long_when and eval_llm_condition(long_when, data, signal_index):
            side = 1
        elif short_when and eval_llm_condition(short_when, data, signal_index):
            side = -1
        if side == 0:
            continue

        entry_index = signal_index + 1
        if entry_index >= len(data.time):
            continue
        entry = float(data.open[entry_index])
        risk = max(safe_atr(data, signal_index) * risk_atr_mult, data.tick_size * 2.0)
        stop = entry - side * risk
        target = entry + side * risk * risk_reward

        forced_exit = min(entry_index + max_bars - 1, len(data.time) - 1)
        session_exit = index_at(data, day, exit_minute)
        if session_exit is not None and session_exit >= entry_index:
            forced_exit = min(forced_exit, session_exit)

        exit_index = forced_exit
        exit_price = float(data.close[forced_exit])
        exit_reason = "time_exit"
        for cursor in range(entry_index, forced_exit + 1):
            stopped = data.low[cursor] <= stop if side == 1 else data.high[cursor] >= stop
            targeted = data.high[cursor] >= target if side == 1 else data.low[cursor] <= target
            if stopped:
                exit_index = cursor
                exit_price = stop
                exit_reason = "sl"
                break
            if targeted:
                exit_index = cursor
                exit_price = target
                exit_reason = "tp"
                break

        row = trade_row(spec, data, signal_index, entry_index, exit_index, side, entry, exit_price, risk, exit_reason)
        if row:
            trades.append(row)
            used_days.add(day)
    return trades


ENGINE_HANDLERS = {
    "intraday_momentum": backtest_intraday_momentum,
    "overnight_bias": backtest_overnight_bias,
    "open_gap": backtest_open_gap,
    "range_break": backtest_range_break,
    "daily_tsmom": backtest_daily_tsmom,
    "llm_rule_code": backtest_llm_rule_code,
}


def write_trades(path: Path, trades: list[dict[str, Any]]) -> None:
    fields = [
        "strategy_id",
        "asset_key",
        "market",
        "engine",
        "signal_time",
        "entry_time",
        "exit_time",
        "side",
        "entry_price",
        "exit_price",
        "r_multiple",
        "exit_reason",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(trades)


def output_payload(spec: dict[str, Any], metric: dict[str, Any], qualified: bool) -> dict[str, Any]:
    clean_metric = {
        key: ("inf" if isinstance(value, float) and math.isinf(value) else round(value, 6) if isinstance(value, float) else value)
        for key, value in metric.items()
    }
    return {
        **spec,
        "status": "qualified" if qualified else "backtested",
        "backtestedAt": datetime.now(timezone.utc).isoformat(),
        "metrics": clean_metric,
    }


def write_result_folder(root: Path, spec: dict[str, Any], trades: list[dict[str, Any]], metric: dict[str, Any], qualified: bool) -> None:
    folder = root / str(spec["strategyId"])
    if folder.exists():
        remove_if_inside(folder, root)
    folder.mkdir(parents=True, exist_ok=True)
    write_json(folder / "strategy.json", output_payload(spec, metric, qualified))
    write_trades(folder / "backtest_trades.csv", trades)


def rejected_error_metric() -> dict[str, Any]:
    return {
        "profit_factor": 0.0,
        "trades": 0,
        "wins": 0,
        "losses": 0,
        "win_rate_pct": 0.0,
        "total_r": 0.0,
        "max_drawdown_r": 0.0,
    }


def result_summary_row(spec: dict[str, Any], metric: dict[str, Any], qualified: bool, status: str, error: str = "") -> dict[str, Any]:
    profit_factor = float(metric.get("profit_factor", 0) or 0)
    return {
        "strategy_id": str(spec.get("strategyId", "")),
        "asset_key": spec.get("assetKey"),
        "market": spec.get("market"),
        "engine": spec.get("engine"),
        "profit_factor": "inf" if math.isinf(profit_factor) else round(profit_factor, 6),
        "trades": metric.get("trades", 0),
        "total_r": round(float(metric.get("total_r", 0) or 0), 6),
        "qualified": qualified,
        "status": status,
        "error": error,
    }


def write_rejected_error(spec: dict[str, Any], message: str) -> dict[str, Any]:
    metric = rejected_error_metric()
    error_spec = {
        **spec,
        "backtestError": message,
    }
    write_result_folder(BACKTESTED_ROOT, error_spec, [], metric, False)
    write_result_folder(REJECTED_ROOT, error_spec, [], metric, False)
    return result_summary_row(error_spec, metric, False, "error", message)


def process_spec(spec_path: str, min_pf: float, min_trades: int, overwrite: bool) -> dict[str, Any]:
    spec_file = Path(spec_path)
    spec = read_json(spec_file)
    strategy_id = str(spec["strategyId"])
    if (BACKTESTED_ROOT / strategy_id / "strategy.json").exists() and not overwrite:
        payload = read_json(BACKTESTED_ROOT / strategy_id / "strategy.json")
        metric = payload.get("metrics", {})
        qualified = (QUALIFIED_ROOT / strategy_id / "strategy.json").exists()
        return result_summary_row(spec, metric, qualified, "cached", str(payload.get("backtestError", "")))
    handler = ENGINE_HANDLERS.get(str(spec["engine"]))
    if handler is None:
        return write_rejected_error(spec, f"Unsupported engine {spec['engine']} in {spec_path}")
    try:
        data = load_data_for_spec(spec)
        trades = handler(spec, data)
    except Exception as error:
        message = f"{type(error).__name__}: {error}"
        return write_rejected_error(spec, message)
    metric = metrics(trades)
    qualified = float(metric["profit_factor"]) > min_pf and int(metric["trades"]) > min_trades and float(metric["total_r"]) > 0
    write_result_folder(BACKTESTED_ROOT, spec, trades, metric, qualified)
    if qualified:
        write_result_folder(QUALIFIED_ROOT, spec, trades, metric, qualified)
    else:
        write_result_folder(REJECTED_ROOT, spec, trades, metric, qualified)
    return result_summary_row(spec, metric, qualified, "backtested")


def process_spec_worker(args: tuple[str, float, int, bool]) -> dict[str, Any]:
    spec_path, min_pf, min_trades, overwrite = args
    return process_spec(spec_path, min_pf, min_trades, overwrite)


def spec_paths(asset_filters: list[str], engine_filters: list[str], limit: int) -> list[Path]:
    paths: list[Path] = []
    asset_filter_set = {item.lower() for item in asset_filters}
    engine_filter_set = {item.lower() for item in engine_filters}
    for folder in sorted(path for path in READY_ROOT.iterdir() if path.is_dir()):
        spec_path = folder / "strategy.json"
        if not spec_path.exists():
            continue
        spec = read_json(spec_path)
        if asset_filter_set and str(spec.get("assetKey", "")).lower() not in asset_filter_set and str(spec.get("symbol", "")).lower() not in asset_filter_set:
            continue
        if engine_filter_set and str(spec.get("engine", "")).lower() not in engine_filter_set:
            continue
        paths.append(spec_path)
        if limit and len(paths) >= limit:
            break
    return paths


def clear_results() -> None:
    for root in (BACKTESTED_ROOT, QUALIFIED_ROOT, REJECTED_ROOT):
        for child in list(root.iterdir()):
            if child.name == ".gitkeep":
                continue
            remove_if_inside(child, root)


def main() -> None:
    args = parse_args()
    ensure_research_dirs()
    if args.clear_results:
        clear_results()
    asset_filters = [item for raw in (args.asset or []) for item in split_csv_arg(raw)]
    engine_filters = [item for raw in (args.engine or []) for item in split_csv_arg(raw)]
    paths = spec_paths(asset_filters, engine_filters, args.limit)
    print(f"Backtesting {len(paths)} ready spec(s)")
    if args.workers > 1 and len(paths) > 1:
        work = [(str(path), args.min_pf, args.min_trades, args.overwrite) for path in paths]
        with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as executor:
            rows = list(executor.map(process_spec_worker, work))
    else:
        rows = [process_spec(str(path), args.min_pf, args.min_trades, args.overwrite) for path in paths]
    rows.sort(key=lambda row: (bool(row["qualified"]), float("inf") if row["profit_factor"] == "inf" else float(row["profit_factor"]), int(row["trades"])), reverse=True)
    write_csv(BACKTESTED_ROOT / "_summary.csv", rows)
    write_csv(QUALIFIED_ROOT / "_qualified_summary.csv", [row for row in rows if row["qualified"]])
    print(f"Qualified {sum(1 for row in rows if row['qualified'])} of {len(rows)} backtest(s).")


if __name__ == "__main__":
    main()
