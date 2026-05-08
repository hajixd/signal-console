"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesMarkersPluginApi,
  type ISeriesPrimitive,
  type ISeriesApi,
  type Logical,
  type SeriesAttachedParameter,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
  type WhitespaceData
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";

export type TradeChartBar = {
  index: number;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export const TRADE_CHART_TIMEFRAMES = [
  { label: "1m", value: "1m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "30m", value: "30m" },
  { label: "45m", value: "45m" },
  { label: "1h", value: "1h" },
  { label: "4h", value: "4h" },
  { label: "1d", value: "1d" }
] as const;

export type TradeChartTimeframe = (typeof TRADE_CHART_TIMEFRAMES)[number]["value"];

type TradeChartTrade = {
  id: string;
  symbol: string;
  side: "long" | "short";
  entryIndex: number;
  exitIndex: number;
  signalTime: string;
  entryTime: string;
  exitTime: string;
  sourceTimeframe?: TradeChartTimeframe;
  phase?: string;
  variantId?: string;
  entryType?: "market" | "limit";
  entryPrice: number;
  exitPrice: number;
  targetPrice: number;
  stopPrice: number;
  pnlLabel?: string;
};
type TradeSide = TradeChartTrade["side"];

type ChartStatus = "idle" | "loading" | "ready" | "error";
type ChartTheme = "dark" | "light";
type ReplaySpeed = 1 | 2 | 4 | 8;
type ReplayMode = "intrabar" | "bar";
type MappedCandle = CandlestickData<UTCTimestamp> & {
  source: TradeChartBar;
};
type ReplayChartData = CandlestickData<UTCTimestamp> | WhitespaceData<UTCTimestamp>;
type CandleSeriesApi = ISeriesApi<"Candlestick">;
type LineSeriesApi = ISeriesApi<"Line">;
type BaselineSeriesApi = ISeriesApi<"Baseline">;
type TradeSeriesMarkersApi = ISeriesMarkersPluginApi<Time>;
type NumberRange = {
  from: number;
  to: number;
};
type TradeVisualTheme = {
  entryLine: string;
  targetLine: string;
  stopLine: string;
  pathLine: string;
  profitFillStrong: string;
  profitFillSoft: string;
  profitStroke: string;
  riskFillStrong: string;
  riskFillSoft: string;
  riskStroke: string;
};
type TradeVisualSnapshot = {
  currentPrice: number | null;
  currentReplayCandle: MappedCandle | null;
  currentReplayTime: Time | null;
  entryCandle: MappedCandle | null;
  exitCandle: MappedCandle | null;
  signalCandle: MappedCandle | null;
  trade: TradeChartTrade;
};
type TradeOverlaySeries = {
  profitZone: BaselineSeriesApi;
  lossZone: BaselineSeriesApi;
  entryLine: LineSeriesApi;
  targetLine: LineSeriesApi;
  stopLine: LineSeriesApi;
  pathLine: LineSeriesApi;
  limitOrderLine: LineSeriesApi;
};
type TradeOverlayPoint = {
  color?: string;
  label: string;
  side: TradeSide;
  tone: "entry" | "exit" | "limit";
  x: number;
  y: number;
};
type TradeDomOverlay = {
  entryLine?: number;
  exitMarker?: TradeOverlayPoint | null;
  height: number;
  limitLine: { label: string; x1: number; x2: number; y: number } | null;
  path?: { x1: number; x2: number; y1: number; y2: number };
  profit?: { height: number; width: number; x: number; y: number };
  risk?: { height: number; width: number; x: number; y: number };
  startMarker?: TradeOverlayPoint;
  stopLine?: number;
  targetLine?: number;
  width: number;
  x1?: number;
  x2?: number;
};
type StructureTone = "bullish" | "bearish" | "neutral" | "warning";
type StructureBox = {
  endTime: Time;
  high: number;
  label: string;
  low: number;
  startTime: Time;
  tone: StructureTone;
};
type StructureLine = {
  endTime: Time;
  label: string;
  price: number;
  startTime: Time;
  tone: StructureTone;
};
type StructureTag = {
  label: string;
  position: "above" | "below";
  price: number;
  time: Time;
  tone: StructureTone;
};
type StrategyStructureVisuals = {
  boxes: StructureBox[];
  lines: StructureLine[];
  tags: StructureTag[];
};
const REPLAY_SPEEDS: ReplaySpeed[] = [1, 2, 4, 8];
const REPLAY_INTERVAL_MS: Record<ReplaySpeed, number> = {
  1: 700,
  2: 360,
  4: 180,
  8: 90
};
const CHART_TIMEFRAME_SECONDS: Record<TradeChartTimeframe, number> = {
  "1m": 60,
  "5m": 5 * 60,
  "15m": 15 * 60,
  "30m": 30 * 60,
  "45m": 45 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
  "1d": 24 * 60 * 60
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function timestampFromTime(value: string | undefined): UTCTimestamp | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed / 1000) as UTCTimestamp;
}

function mappedCandlesFromBars(bars: TradeChartBar[]): MappedCandle[] {
  return bars
    .map((bar) => {
      const time = timestampFromTime(bar.time);
      if (time == null) return null;
      return {
        time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        source: bar
      };
    })
    .filter((bar): bar is MappedCandle => Boolean(bar))
    .sort((left, right) => Number(left.time) - Number(right.time));
}

function replayTimelineCandles(candles: MappedCandle[], intrabars: MappedCandle[]): MappedCandle[] {
  if (!intrabars.length) return candles;

  const byTime = new Map<number, MappedCandle>();
  for (const candle of candles) byTime.set(Number(candle.time), candle);
  for (const intrabar of intrabars) byTime.set(Number(intrabar.time), intrabar);

  return [...byTime.values()].sort((left, right) => Number(left.time) - Number(right.time));
}

function timeframeSeconds(timeframe: TradeChartTimeframe): number {
  return CHART_TIMEFRAME_SECONDS[timeframe];
}

function candleEndTime(candle: MappedCandle, timeframe: TradeChartTimeframe): number {
  return Number(candle.time) + timeframeSeconds(timeframe);
}

function replayCandleForTime(candles: MappedCandle[], replayTime: Time | null): MappedCandle | null {
  if (!candles.length || replayTime == null) return null;
  const target = Number(replayTime);
  let current = candles[0] ?? null;

  for (const candle of candles) {
    if (Number(candle.time) > target) break;
    current = candle;
  }

  return current;
}

function aggregateIntrabarSource(candle: MappedCandle, intrabars: MappedCandle[], replayTime: Time | null, timeframe: TradeChartTimeframe): TradeChartBar {
  if (replayTime == null) return candle.source;
  const start = Number(candle.time);
  const end = Math.min(Number(replayTime), candleEndTime(candle, timeframe) - 1);
  const visible = intrabars.filter((bar) => Number(bar.time) >= start && Number(bar.time) <= end);
  if (!visible.length) return candle.source;

  return {
    ...candle.source,
    open: visible[0]!.open,
    high: Math.max(...visible.map((bar) => bar.high)),
    low: Math.min(...visible.map((bar) => bar.low)),
    close: visible[visible.length - 1]!.close,
    volume: visible.reduce((total, bar) => total + (bar.source.volume ?? 0), 0)
  };
}

function formatChartPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: Math.abs(value) >= 10 ? 2 : 0,
    maximumFractionDigits: Math.abs(value) < 10 ? 5 : 2
  });
}

function formatChartTime(value: string | undefined): string {
  if (!value) return "--";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatVolume(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 0
  });
}

function nearestMappedCandle(candles: MappedCandle[], indexValue: number, timeValue?: string): MappedCandle | null {
  if (!candles.length) return null;
  const targetTime = timestampFromTime(timeValue);

  if (targetTime != null) {
    let bestCandle = candles[0] ?? null;
    let bestDistance = Infinity;

    for (const candle of candles) {
      const distance = Math.abs(Number(candle.time) - Number(targetTime));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCandle = candle;
      }
    }

    if (bestCandle) return bestCandle;
  }

  if (!Number.isFinite(indexValue)) return candles[0] ?? null;
  let bestCandle = candles[0] ?? null;
  let bestDistance = Infinity;

  for (const candle of candles) {
    const distance = Math.abs(candle.source.index - indexValue);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestCandle = candle;
    }
  }

  return bestCandle;
}

function priceTouched(candle: MappedCandle, price: number): boolean {
  return Number.isFinite(price) && candle.low <= price && candle.high >= price;
}

function exitTouchPrice(trade: TradeChartTrade): number | null {
  const targetTolerance = Math.max(Math.abs(trade.targetPrice) * 0.00001, 0.00001);
  const stopTolerance = Math.max(Math.abs(trade.stopPrice) * 0.00001, 0.00001);
  if (Math.abs(trade.exitPrice - trade.targetPrice) <= targetTolerance) return trade.targetPrice;
  if (Math.abs(trade.exitPrice - trade.stopPrice) <= stopTolerance) return trade.stopPrice;
  return null;
}

function resolvedExitSearchEnd(
  candles: MappedCandle[],
  fallbackPosition: number,
  trade: TradeChartTrade,
  dataTimeframe: TradeChartTimeframe
): number {
  const sourceTimeframe = trade.sourceTimeframe ?? "15m";
  const sourceSeconds = CHART_TIMEFRAME_SECONDS[sourceTimeframe];
  const dataSeconds = CHART_TIMEFRAME_SECONDS[dataTimeframe];
  const exitTime = timestampFromTime(trade.exitTime);
  if (!exitTime || dataSeconds >= sourceSeconds) return fallbackPosition;

  const windowEndTime = Number(exitTime) + sourceSeconds - dataSeconds;
  let searchEnd = fallbackPosition;
  for (let position = fallbackPosition; position < candles.length; position += 1) {
    if (Number(candles[position]!.time) > windowEndTime) break;
    searchEnd = position;
  }

  return searchEnd;
}

function resolvedExitCandle(
  candles: MappedCandle[],
  trade: TradeChartTrade,
  entryCandle: MappedCandle | null,
  dataTimeframe: TradeChartTimeframe
): MappedCandle | null {
  if (!candles.length) return null;
  const fallback = nearestMappedCandle(candles, trade.exitIndex, trade.exitTime);
  const touchPrice = exitTouchPrice(trade);
  if (touchPrice == null) return fallback;

  const entryPosition = candleIndex(candles, entryCandle);
  const fallbackPosition = candleIndex(candles, fallback);
  const searchStart = Math.max(entryPosition, 0);
  const searchEnd = Math.min(candles.length - 1, Math.max(fallbackPosition, resolvedExitSearchEnd(candles, fallbackPosition, trade, dataTimeframe)));

  for (let position = searchStart; position <= searchEnd; position += 1) {
    const candle = candles[position]!;
    if (priceTouched(candle, touchPrice)) return candle;
  }

  return fallback;
}

function candleIndex(candles: MappedCandle[], candle: MappedCandle | null): number {
  if (!candle) return 0;
  const found = candles.findIndex((candidate) => candidate.time === candle.time);
  return found >= 0 ? found : 0;
}

function tradeLogicalRange(candles: MappedCandle[], entryCandle: MappedCandle | null, exitCandle: MappedCandle | null): NumberRange {
  const entryPosition = candleIndex(candles, entryCandle);
  const exitPosition = candleIndex(candles, exitCandle);
  const start = Math.min(entryPosition, exitPosition);
  const end = Math.max(entryPosition, exitPosition);
  const tradeWindow = Math.max(10, end - start + 1);
  const fullCandleCount = Math.max(1, candles.length);
  const windowSize = Math.max(45, Math.ceil(tradeWindow * 3));
  const leftPadding = Math.max(8, Math.ceil(tradeWindow * 0.65));
  const rightPadding = Math.max(12, Math.ceil(tradeWindow * 1.2));
  const rightWhitespace = Math.max(8, Math.ceil(windowSize * 0.18));
  let from = Math.max(0, start - leftPadding);
  let to = Math.min(fullCandleCount - 1 + rightWhitespace, end + rightPadding);

  if (to - from + 1 < windowSize) to = Math.min(fullCandleCount - 1 + rightWhitespace, from + windowSize - 1);
  if (to - from + 1 < windowSize) from = Math.max(0, to - windowSize + 1);

  return { from, to };
}

function tradePriceRange(candles: MappedCandle[], levels: number[], logicalRange: NumberRange): NumberRange | null {
  const prices: number[] = [];
  const from = clamp(Math.floor(logicalRange.from), 0, Math.max(0, candles.length - 1));
  const to = clamp(Math.ceil(logicalRange.to), from, Math.max(0, candles.length - 1));

  for (let index = from; index <= to; index += 1) {
    const candle = candles[index];
    if (!candle) continue;
    prices.push(candle.high, candle.low);
  }

  for (const level of levels) {
    if (Number.isFinite(level)) prices.push(level);
  }

  if (!prices.length) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const span = Math.max(max - min, Math.abs(max) * 0.0001, 0.01);
  const padding = span * 0.16;
  return {
    from: min - padding,
    to: max + padding
  };
}

function candleIsRevealed(candle: MappedCandle | null, current: MappedCandle | null): candle is MappedCandle {
  return Boolean(candle && current && Number(candle.time) <= Number(current.time));
}

function chartMessage(status: ChartStatus, emptyMessage?: string): string {
  if (status === "loading") return "Loading candles...";
  if (status === "error") return "Chart unavailable.";
  if (emptyMessage) return emptyMessage;
  return "No candles available for this trade.";
}

function currentChartTheme(): ChartTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function tradeVisualTheme(isLight: boolean): TradeVisualTheme {
  return {
    entryLine: isLight ? "rgba(15, 23, 42, 0.7)" : "rgba(232, 238, 250, 0.88)",
    targetLine: isLight ? "rgba(22, 163, 74, 0.9)" : "rgba(53, 201, 113, 0.95)",
    stopLine: isLight ? "rgba(220, 38, 38, 0.9)" : "rgba(255, 76, 104, 0.95)",
    pathLine: isLight ? "rgba(15, 23, 42, 0.82)" : "rgba(220, 230, 248, 0.94)",
    profitFillStrong: isLight ? "rgba(22, 163, 74, 0.28)" : "rgba(53, 201, 113, 0.34)",
    profitFillSoft: isLight ? "rgba(22, 163, 74, 0.08)" : "rgba(53, 201, 113, 0.12)",
    profitStroke: isLight ? "rgba(22, 163, 74, 0.86)" : "rgba(53, 201, 113, 0.95)",
    riskFillStrong: isLight ? "rgba(220, 38, 38, 0.27)" : "rgba(240, 69, 90, 0.32)",
    riskFillSoft: isLight ? "rgba(220, 38, 38, 0.09)" : "rgba(240, 69, 90, 0.12)",
    riskStroke: isLight ? "rgba(220, 38, 38, 0.86)" : "rgba(255, 76, 104, 0.95)"
  };
}

function tradeMarkerList(_snapshot: TradeVisualSnapshot | null): SeriesMarker<Time>[] {
  return [];
}

function emptyOverlayData(series: TradeOverlaySeries): void {
  series.profitZone.setData([]);
  series.lossZone.setData([]);
  series.entryLine.setData([]);
  series.targetLine.setData([]);
  series.stopLine.setData([]);
  series.pathLine.setData([]);
  series.limitOrderLine.setData([]);
}

function applyZoneOptions(
  series: BaselineSeriesApi,
  entryPrice: number,
  levelIsAboveEntry: boolean,
  strongColor: string,
  softColor: string
): void {
  const transparent = "rgba(0,0,0,0)";
  series.applyOptions({
    baseValue: { type: "price", price: entryPrice },
    topLineColor: transparent,
    topFillColor1: levelIsAboveEntry ? strongColor : transparent,
    topFillColor2: levelIsAboveEntry ? softColor : transparent,
    bottomLineColor: transparent,
    bottomFillColor1: levelIsAboveEntry ? transparent : strongColor,
    bottomFillColor2: levelIsAboveEntry ? transparent : softColor,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false
  });
}

function applyOverlayTheme(series: TradeOverlaySeries, theme: TradeVisualTheme, trade: TradeChartTrade): void {
  applyZoneOptions(
    series.profitZone,
    trade.entryPrice,
    trade.targetPrice >= trade.entryPrice,
    theme.profitFillStrong,
    theme.profitFillSoft
  );
  applyZoneOptions(
    series.lossZone,
    trade.entryPrice,
    trade.stopPrice >= trade.entryPrice,
    theme.riskFillStrong,
    theme.riskFillSoft
  );
  series.entryLine.applyOptions({ color: theme.entryLine });
  series.targetLine.applyOptions({ color: theme.targetLine });
  series.stopLine.applyOptions({ color: theme.stopLine });
  series.pathLine.applyOptions({ color: theme.pathLine });
  series.limitOrderLine.applyOptions({ color: "#fbbf24" });
}

function comparableTimeValue(time: Time): number {
  if (typeof time === "number") return time;
  if (typeof time === "string") return Date.parse(time);

  return Date.UTC(time.year, time.month - 1, time.day);
}

function isAscendingTime(startTime: Time, endTime: Time): boolean {
  const startValue = comparableTimeValue(startTime);
  const endValue = comparableTimeValue(endTime);

  return Number.isFinite(startValue) && Number.isFinite(endValue) && endValue > startValue;
}

function overlayLineData(startTime: Time, endTime: Time, price: number) {
  if (!isAscendingTime(startTime, endTime)) {
    return [{ time: startTime, value: price }];
  }

  return [
    { time: startTime, value: price },
    { time: endTime, value: price }
  ];
}

function applyTradeOverlay(series: TradeOverlaySeries, snapshot: TradeVisualSnapshot): void {
  const limitOrderSignal =
    snapshot.trade.entryType === "limit" &&
    candleIsRevealed(snapshot.signalCandle, snapshot.currentReplayCandle)
      ? snapshot.signalCandle
      : null;
  if (limitOrderSignal) {
    const lineEndCandle = candleIsRevealed(snapshot.entryCandle, snapshot.currentReplayCandle)
      ? snapshot.entryCandle
      : snapshot.currentReplayCandle;
    if (lineEndCandle) {
      const lineEndTime = candleIsRevealed(snapshot.entryCandle, snapshot.currentReplayCandle)
        ? snapshot.entryCandle.time
        : lineEndCandle.time;
      series.limitOrderLine.setData(overlayLineData(limitOrderSignal.time as Time, lineEndTime as Time, snapshot.trade.entryPrice));
    }
  } else {
    series.limitOrderLine.setData([]);
  }

  if (!candleIsRevealed(snapshot.entryCandle, snapshot.currentReplayCandle)) {
    series.profitZone.setData([]);
    series.lossZone.setData([]);
    series.entryLine.setData([]);
    series.targetLine.setData([]);
    series.stopLine.setData([]);
    series.pathLine.setData([]);
    return;
  }

  const exitRevealed = candleIsRevealed(snapshot.exitCandle, snapshot.currentReplayCandle);
  const pathEndCandle = exitRevealed ? snapshot.exitCandle : snapshot.currentReplayCandle;
  const pathEndPrice = exitRevealed ? snapshot.trade.exitPrice : snapshot.currentPrice ?? snapshot.currentReplayCandle?.close;

  if (!snapshot.entryCandle || !pathEndCandle || pathEndPrice == null || !Number.isFinite(pathEndPrice)) {
    emptyOverlayData(series);
    return;
  }

  const startTime = snapshot.entryCandle.time as Time;
  const endTime = pathEndCandle.time as Time;

  series.profitZone.setData(overlayLineData(startTime, endTime, snapshot.trade.targetPrice));
  series.lossZone.setData(overlayLineData(startTime, endTime, snapshot.trade.stopPrice));
  series.entryLine.setData(overlayLineData(startTime, endTime, snapshot.trade.entryPrice));
  series.targetLine.setData(overlayLineData(startTime, endTime, snapshot.trade.targetPrice));
  series.stopLine.setData(overlayLineData(startTime, endTime, snapshot.trade.stopPrice));
  series.pathLine.setData(
    isAscendingTime(startTime, endTime)
      ? [
          { time: startTime, value: snapshot.trade.entryPrice },
          { time: endTime, value: pathEndPrice }
        ]
      : [{ time: startTime, value: snapshot.trade.entryPrice }]
  );
}

function overlayBand(x1: number, x2: number, y1: number, y2: number): TradeDomOverlay["profit"] {
  return {
    height: Math.max(2, Math.abs(y2 - y1)),
    width: Math.max(2, Math.abs(x2 - x1)),
    x: Math.min(x1, x2),
    y: Math.min(y1, y2)
  };
}

function coordinateIsVisible(value: number | null): value is number {
  return value != null && Number.isFinite(value);
}

function chartXForTime(
  chart: IChartApi,
  candles: MappedCandle[],
  rawTime: Time,
  dataTimeframe: TradeChartTimeframe
): number | null {
  if (typeof rawTime !== "number") return null;

  const candle = replayCandleForTime(candles, rawTime);
  const index = candleIndex(candles, candle);
  if (!candle) return null;

  const startX = chart.timeScale().logicalToCoordinate(index as Logical);
  if (!coordinateIsVisible(startX)) return null;

  const nextX = candles[index + 1] ? chart.timeScale().logicalToCoordinate((index + 1) as Logical) : null;
  const previousX = candles[index - 1] ? chart.timeScale().logicalToCoordinate((index - 1) as Logical) : null;
  const width = coordinateIsVisible(nextX)
    ? nextX - startX
    : coordinateIsVisible(previousX)
      ? startX - previousX
      : 6;
  const progress = clamp((Number(rawTime) - Number(candle.time)) / timeframeSeconds(dataTimeframe), 0, 1);

  return startX + width * progress;
}

function tradeDomOverlayGeometry(
  chart: IChartApi,
  series: CandleSeriesApi,
  size: { width: number; height: number },
  snapshot: TradeVisualSnapshot,
  candles: MappedCandle[],
  dataTimeframe: TradeChartTimeframe
): TradeDomOverlay | null {
  if (!snapshot.currentReplayCandle) return null;

  const entryAction = snapshot.trade.side === "long" ? "Buy" : "Sell";
  const entryColor = snapshot.trade.side === "long" ? "#35c971" : "#f0455a";
  const yEntry = series.priceToCoordinate(snapshot.trade.entryPrice);
  if (!coordinateIsVisible(yEntry)) return null;

  const limitSignal =
    snapshot.trade.entryType === "limit" &&
    candleIsRevealed(snapshot.signalCandle, snapshot.currentReplayCandle)
      ? snapshot.signalCandle
      : null;
  let limitLine: TradeDomOverlay["limitLine"] = null;

  if (limitSignal) {
    const lineEndTime = candleIsRevealed(snapshot.entryCandle, snapshot.currentReplayCandle)
      ? snapshot.entryCandle.time
      : snapshot.currentReplayTime ?? snapshot.currentReplayCandle.time;
    const limitX1 = chartXForTime(chart, candles, limitSignal.time as Time, dataTimeframe);
    const limitX2 = chartXForTime(chart, candles, lineEndTime as Time, dataTimeframe);
    if (coordinateIsVisible(limitX1) && coordinateIsVisible(limitX2)) {
      limitLine = {
        label: `Limit ${entryAction}`,
        x1: clamp(limitX1, 0, size.width),
        x2: clamp(limitX2, 0, size.width),
        y: yEntry
      };
    }
  }

  if (!candleIsRevealed(snapshot.entryCandle, snapshot.currentReplayCandle)) {
    return limitLine ? { height: size.height, limitLine, width: size.width } : null;
  }

  const exitRevealed = candleIsRevealed(snapshot.exitCandle, snapshot.currentReplayCandle);
  const pathEndCandle = exitRevealed ? snapshot.exitCandle : snapshot.currentReplayCandle;
  const pathEndPrice = exitRevealed ? snapshot.trade.exitPrice : snapshot.currentPrice ?? snapshot.currentReplayCandle?.close;
  if (!snapshot.entryCandle || !pathEndCandle || pathEndPrice == null || !Number.isFinite(pathEndPrice)) return null;

  const startTime = snapshot.entryCandle.time as Time;
  const endTime = (exitRevealed ? pathEndCandle.time : snapshot.currentReplayTime ?? pathEndCandle.time) as Time;
  const x1 = chartXForTime(chart, candles, startTime, dataTimeframe);
  const x2 = chartXForTime(chart, candles, endTime, dataTimeframe);
  const yTarget = series.priceToCoordinate(snapshot.trade.targetPrice);
  const yStop = series.priceToCoordinate(snapshot.trade.stopPrice);
  const yPathEnd = series.priceToCoordinate(pathEndPrice);
  const yExit = series.priceToCoordinate(snapshot.trade.exitPrice);
  const exitIsFavorable = (snapshot.trade.exitPrice - snapshot.trade.entryPrice) * (snapshot.trade.side === "long" ? 1 : -1) >= 0;

  if (
    !coordinateIsVisible(x1) ||
    !coordinateIsVisible(x2) ||
    !coordinateIsVisible(yEntry) ||
    !coordinateIsVisible(yTarget) ||
    !coordinateIsVisible(yStop) ||
    !coordinateIsVisible(yPathEnd)
  ) {
    return null;
  }

  const clampedX1 = clamp(x1, 0, size.width);
  const clampedX2 = clamp(x2, 0, size.width);

  return {
    entryLine: yEntry,
    exitMarker: coordinateIsVisible(yExit)
      ? {
          color: exitIsFavorable ? "#35c971" : "#f0455a",
          label: snapshot.trade.pnlLabel ?? "Exit",
          side: snapshot.trade.side,
          tone: "exit",
          x: clampedX2,
          y: yExit
        }
      : null,
    height: size.height,
    limitLine,
    path: {
      x1: clampedX1,
      x2: clampedX2,
      y1: yEntry,
      y2: yPathEnd
    },
    profit: overlayBand(clampedX1, clampedX2, yEntry, yTarget),
    risk: overlayBand(clampedX1, clampedX2, yEntry, yStop),
    startMarker: {
      color: entryColor,
      label: `Entry ${entryAction}`,
      side: snapshot.trade.side,
      tone: "entry",
      x: clampedX1,
      y: yEntry
    },
    stopLine: yStop,
    targetLine: yTarget,
    width: size.width,
    x1: clampedX1,
    x2: clampedX2
  };
}

function pivotLow(candles: MappedCandle[], index: number): boolean {
  const candle = candles[index];
  if (!candle || index < 2 || index + 2 >= candles.length) return false;
  return candle.low < candles[index - 1]!.low && candle.low < candles[index - 2]!.low && candle.low <= candles[index + 1]!.low && candle.low <= candles[index + 2]!.low;
}

function pivotHigh(candles: MappedCandle[], index: number): boolean {
  const candle = candles[index];
  if (!candle || index < 2 || index + 2 >= candles.length) return false;
  return candle.high > candles[index - 1]!.high && candle.high > candles[index - 2]!.high && candle.high >= candles[index + 1]!.high && candle.high >= candles[index + 2]!.high;
}

function emptyStructureVisuals(): StrategyStructureVisuals {
  return { boxes: [], lines: [], tags: [] };
}

function averageCandleRange(candles: MappedCandle[], start: number, end: number): number {
  const ranges: number[] = [];
  for (let index = Math.max(0, start); index <= Math.min(candles.length - 1, end); index += 1) {
    const candle = candles[index];
    if (candle) ranges.push(Math.max(0, candle.high - candle.low));
  }

  return ranges.length ? ranges.reduce((sum, range) => sum + range, 0) / ranges.length : 0;
}

function strategyStructureVisuals(snapshot: TradeVisualSnapshot, candles: MappedCandle[], enabled: boolean): StrategyStructureVisuals {
  if (!enabled || !snapshot.currentReplayCandle || !candles.length) return emptyStructureVisuals();

  const visuals = emptyStructureVisuals();
  const phase = snapshot.trade.phase ?? "";
  const currentPosition = candleIndex(candles, snapshot.currentReplayCandle);
  const entryPosition = candleIndex(candles, snapshot.entryCandle);
  const scanEnd = Math.min(currentPosition, Math.max(0, entryPosition));
  const scanStart = Math.max(2, scanEnd - 90);
  const direction = snapshot.trade.side === "long" ? 1 : -1;
  const averageRange = Math.max(averageCandleRange(candles, Math.max(0, scanEnd - 30), scanEnd), Math.abs(snapshot.trade.entryPrice) * 0.0001, 0.01);
  const rightEdge = candles[Math.max(currentPosition, entryPosition)] ?? snapshot.currentReplayCandle;

  if (/sweep|ict|ny_sweep/.test(phase)) {
    for (let index = Math.max(scanStart, 14); index <= scanEnd; index += 1) {
      const candle = candles[index]!;
      const prior = candles.slice(Math.max(0, index - 14), index);
      if (prior.length < 8) continue;
      const priorHigh = Math.max(...prior.map((item) => item.high));
      const priorLow = Math.min(...prior.map((item) => item.low));

      if (candle.high > priorHigh && candle.close < priorHigh) {
        visuals.lines.push({
          endTime: candle.time as Time,
          label: "Liquidity Sweep",
          price: priorHigh,
          startTime: prior[0]!.time as Time,
          tone: "warning"
        });
        visuals.tags.push({ label: "Sweep", position: "above", price: candle.high, time: candle.time as Time, tone: "warning" });
      } else if (candle.low < priorLow && candle.close > priorLow) {
        visuals.lines.push({
          endTime: candle.time as Time,
          label: "Liquidity Sweep",
          price: priorLow,
          startTime: prior[0]!.time as Time,
          tone: "warning"
        });
        visuals.tags.push({ label: "Sweep", position: "below", price: candle.low, time: candle.time as Time, tone: "warning" });
      }
    }
  }

  let lastLow: number | null = null;
  let lastHigh: number | null = null;
  for (let index = scanStart; index <= scanEnd; index += 1) {
    const candle = candles[index]!;
    if (pivotLow(candles, index)) {
      if (lastLow != null && candle.low > lastLow) {
        visuals.tags.push({ label: "HL", position: "below", price: candle.low, time: candle.time as Time, tone: "neutral" });
      }
      lastLow = candle.low;
    }
    if (pivotHigh(candles, index)) {
      if (lastHigh != null && candle.high < lastHigh) {
        visuals.tags.push({ label: "LH", position: "above", price: candle.high, time: candle.time as Time, tone: "neutral" });
      }
      lastHigh = candle.high;
    }
  }

  let orderBlockIndex: number | null = null;
  for (let index = Math.min(scanEnd - 1, entryPosition - 1); index >= Math.max(scanStart, entryPosition - 32); index -= 1) {
    const candle = candles[index]!;
    const isOpposite = direction === 1 ? candle.close < candle.open : candle.close > candle.open;
    if (!isOpposite) continue;

    const lookaheadEnd = Math.min(candles.length - 1, index + 5, currentPosition);
    for (let cursor = index + 1; cursor <= lookaheadEnd; cursor += 1) {
      const impulse = candles[cursor]!;
      const displacement =
        direction === 1
          ? impulse.close > candle.high + averageRange * 0.15 && impulse.high - impulse.low >= averageRange * 0.9
          : impulse.close < candle.low - averageRange * 0.15 && impulse.high - impulse.low >= averageRange * 0.9;
      if (displacement) {
        orderBlockIndex = index;
        break;
      }
    }
    if (orderBlockIndex != null) break;
  }

  if (orderBlockIndex != null) {
    const candle = candles[orderBlockIndex]!;
    visuals.boxes.push({
      endTime: rightEdge.time as Time,
      high: candle.high,
      label: direction === 1 ? "Bullish Order Block" : "Bearish Order Block",
      low: candle.low,
      startTime: candle.time as Time,
      tone: direction === 1 ? "bullish" : "bearish"
    });
  }

  if (/ict|fvg|sweep/.test(phase)) {
    for (let index = Math.max(scanStart + 2, entryPosition - 28); index <= scanEnd; index += 1) {
      const left = candles[index - 2];
      const candle = candles[index];
      if (!left || !candle) continue;

      if (direction === 1 && candle.low > left.high + averageRange * 0.08) {
        visuals.boxes.push({
          endTime: rightEdge.time as Time,
          high: candle.low,
          label: "FVG",
          low: left.high,
          startTime: left.time as Time,
          tone: "bullish"
        });
        break;
      }
      if (direction === -1 && candle.high < left.low - averageRange * 0.08) {
        visuals.boxes.push({
          endTime: rightEdge.time as Time,
          high: left.low,
          label: "FVG",
          low: candle.high,
          startTime: left.time as Time,
          tone: "bearish"
        });
        break;
      }
    }
  }

  return {
    boxes: visuals.boxes.slice(-3),
    lines: visuals.lines.slice(-3),
    tags: visuals.tags.slice(-8)
  };
}

function strategyVisualMarkers(_snapshot: TradeVisualSnapshot, _candles: MappedCandle[], _enabled: boolean): SeriesMarker<Time>[] {
  return [];
}

type ChartPositionOverlayState = {
  candles: MappedCandle[];
  dataTimeframe: TradeChartTimeframe;
  snapshot: TradeVisualSnapshot;
  structureVisuals: StrategyStructureVisuals;
};

function drawOverlayText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.save();
  ctx.font = '850 10px "Geist Mono", "SFMono-Regular", Consolas, monospace';
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(3, 3, 3, 0.88)";
  ctx.lineWidth = 3;
  ctx.strokeText(text.toUpperCase(), x, y);
  ctx.fillStyle = color;
  ctx.fillText(text.toUpperCase(), x, y);
  ctx.restore();
}

function drawOverlayMarker(ctx: CanvasRenderingContext2D, geometry: TradeDomOverlay, point: TradeOverlayPoint): void {
  const above = point.tone === "exit" ? point.side === "long" : point.side === "short";
  const textY = clamp(point.y + (above ? -16 : 22), 14, geometry.height - 8);
  const textX = clamp(point.x + 6, 6, geometry.width - 96);
  const fill =
    point.color ??
    (point.tone === "limit"
      ? "#fbbf24"
      : point.tone === "exit"
        ? "#35c971"
        : point.side === "long"
          ? "#30b76f"
          : "#f0455a");

  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, point.tone === "exit" ? 4 : 5, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = "rgba(3, 3, 3, 0.95)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  drawOverlayText(ctx, point.label, textX, textY, point.tone === "limit" ? "#fbbf24" : fill);
}

function structureColor(tone: StructureTone): { fill: string; stroke: string; text: string } {
  if (tone === "bullish") {
    return { fill: "rgba(34, 197, 94, 0.16)", stroke: "rgba(52, 211, 153, 0.72)", text: "#34d399" };
  }
  if (tone === "bearish") {
    return { fill: "rgba(244, 63, 94, 0.15)", stroke: "rgba(251, 113, 133, 0.72)", text: "#fb7185" };
  }
  if (tone === "warning") {
    return { fill: "rgba(251, 191, 36, 0.13)", stroke: "rgba(251, 191, 36, 0.75)", text: "#fbbf24" };
  }

  return { fill: "rgba(167, 139, 250, 0.13)", stroke: "rgba(167, 139, 250, 0.72)", text: "#a78bfa" };
}

function drawStructureVisuals(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  series: CandleSeriesApi,
  size: { width: number; height: number },
  state: ChartPositionOverlayState
): void {
  const { candles, dataTimeframe, structureVisuals } = state;
  if (!structureVisuals.boxes.length && !structureVisuals.lines.length && !structureVisuals.tags.length) return;

  ctx.save();
  for (const box of structureVisuals.boxes) {
    const x1 = chartXForTime(chart, candles, box.startTime, dataTimeframe);
    const x2 = chartXForTime(chart, candles, box.endTime, dataTimeframe);
    const yHigh = series.priceToCoordinate(box.high);
    const yLow = series.priceToCoordinate(box.low);
    if (!coordinateIsVisible(x1) || !coordinateIsVisible(x2) || !coordinateIsVisible(yHigh) || !coordinateIsVisible(yLow)) continue;

    const colors = structureColor(box.tone);
    const x = clamp(Math.min(x1, x2), 0, size.width);
    const width = Math.max(8, Math.abs(x2 - x1));
    const y = clamp(Math.min(yHigh, yLow), 0, size.height);
    const height = Math.max(4, Math.abs(yLow - yHigh));

    ctx.fillStyle = colors.fill;
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = 1.25;
    ctx.fillRect(x, y, Math.min(width, size.width - x), height);
    ctx.strokeRect(x, y, Math.min(width, size.width - x), height);
    drawOverlayText(ctx, box.label, clamp(x + 6, 6, size.width - 130), clamp(y + 12, 12, size.height - 8), colors.text);
  }

  for (const line of structureVisuals.lines) {
    const x1 = chartXForTime(chart, candles, line.startTime, dataTimeframe);
    const x2 = chartXForTime(chart, candles, line.endTime, dataTimeframe);
    const y = series.priceToCoordinate(line.price);
    if (!coordinateIsVisible(x1) || !coordinateIsVisible(x2) || !coordinateIsVisible(y)) continue;

    const colors = structureColor(line.tone);
    ctx.beginPath();
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.moveTo(clamp(x1, 0, size.width), y);
    ctx.lineTo(clamp(x2, 0, size.width), y);
    ctx.stroke();
    ctx.setLineDash([]);
    drawOverlayText(ctx, line.label, clamp(Math.min(x1, x2) + 6, 6, size.width - 130), clamp(y - 11, 12, size.height - 8), colors.text);
  }

  for (const tag of structureVisuals.tags) {
    const x = chartXForTime(chart, candles, tag.time, dataTimeframe);
    const y = series.priceToCoordinate(tag.price);
    if (!coordinateIsVisible(x) || !coordinateIsVisible(y)) continue;

    const colors = structureColor(tag.tone);
    const markerY = clamp(y + (tag.position === "above" ? -10 : 10), 6, size.height - 6);
    ctx.beginPath();
    ctx.fillStyle = colors.text;
    ctx.arc(clamp(x, 0, size.width), markerY, 3.5, 0, Math.PI * 2);
    ctx.fill();
    drawOverlayText(
      ctx,
      tag.label,
      clamp(x - 7, 6, size.width - 60),
      clamp(markerY + (tag.position === "above" ? -12 : 13), 12, size.height - 8),
      colors.text
    );
  }

  ctx.restore();
}

function drawTradeOverlayGeometry(ctx: CanvasRenderingContext2D, geometry: TradeDomOverlay): void {
  ctx.save();

  if (geometry.risk) {
    ctx.fillStyle = "rgba(240, 69, 90, 0.26)";
    ctx.strokeStyle = "rgba(255, 76, 104, 0.78)";
    ctx.lineWidth = 1;
    ctx.fillRect(geometry.risk.x, geometry.risk.y, geometry.risk.width, geometry.risk.height);
    ctx.strokeRect(geometry.risk.x, geometry.risk.y, geometry.risk.width, geometry.risk.height);
  }

  if (geometry.profit) {
    ctx.fillStyle = "rgba(53, 201, 113, 0.28)";
    ctx.strokeStyle = "rgba(53, 201, 113, 0.84)";
    ctx.lineWidth = 1;
    ctx.fillRect(geometry.profit.x, geometry.profit.y, geometry.profit.width, geometry.profit.height);
    ctx.strokeRect(geometry.profit.x, geometry.profit.y, geometry.profit.width, geometry.profit.height);
  }

  if (geometry.x1 != null && geometry.x2 != null) {
    const drawLevel = (y: number | undefined, color: string, width = 1.5) => {
      if (y == null) return;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash([]);
      ctx.moveTo(geometry.x1!, y);
      ctx.lineTo(geometry.x2!, y);
      ctx.stroke();
    };

    drawLevel(geometry.entryLine, "rgba(232, 238, 250, 0.82)");
    drawLevel(geometry.targetLine, "rgba(53, 201, 113, 0.9)");
    drawLevel(geometry.stopLine, "rgba(255, 76, 104, 0.9)");
  }

  if (geometry.path) {
    ctx.beginPath();
    ctx.strokeStyle = "rgba(220, 230, 248, 0.9)";
    ctx.lineWidth = 2;
    ctx.setLineDash([1, 6]);
    ctx.lineCap = "round";
    ctx.moveTo(geometry.path.x1, geometry.path.y1);
    ctx.lineTo(geometry.path.x2, geometry.path.y2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (geometry.limitLine) {
    ctx.beginPath();
    ctx.strokeStyle = "rgba(251, 191, 36, 0.94)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.moveTo(geometry.limitLine.x1, geometry.limitLine.y);
    ctx.lineTo(geometry.limitLine.x2, geometry.limitLine.y);
    ctx.stroke();
    ctx.setLineDash([]);
    drawOverlayText(
      ctx,
      geometry.limitLine.label,
      clamp(geometry.limitLine.x1 + 6, 6, geometry.width - 96),
      clamp(geometry.limitLine.y - 16, 14, geometry.height - 8),
      "#fbbf24"
    );
  }

  if (geometry.startMarker) drawOverlayMarker(ctx, geometry, geometry.startMarker);
  if (geometry.exitMarker) drawOverlayMarker(ctx, geometry, geometry.exitMarker);

  ctx.restore();
}

class ChartPositionOverlayRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly chart: IChartApi,
    private readonly series: CandleSeriesApi,
    private readonly state: ChartPositionOverlayState
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      drawStructureVisuals(context, this.chart, this.series, mediaSize, this.state);
      const geometry = tradeDomOverlayGeometry(
        this.chart,
        this.series,
        mediaSize,
        this.state.snapshot,
        this.state.candles,
        this.state.dataTimeframe
      );
      if (geometry) drawTradeOverlayGeometry(context, geometry);
    });
  }
}

class ChartPositionOverlayPaneView implements IPrimitivePaneView {
  constructor(private readonly primitive: ChartPositionOverlayPrimitive) {}

  zOrder() {
    return "top" as const;
  }

  renderer(): IPrimitivePaneRenderer | null {
    const renderState = this.primitive.renderState();
    return renderState ? new ChartPositionOverlayRenderer(renderState.chart, renderState.series, renderState.state) : null;
  }
}

class ChartPositionOverlayPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private paneView = new ChartPositionOverlayPaneView(this);
  private requestUpdate: (() => void) | null = null;
  private series: CandleSeriesApi | null = null;
  private state: ChartPositionOverlayState | null = null;

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart as IChartApi;
    this.series = param.series as CandleSeriesApi;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
    this.state = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.paneView];
  }

  renderState(): { chart: IChartApi; series: CandleSeriesApi; state: ChartPositionOverlayState } | null {
    return this.chart && this.series && this.state
      ? { chart: this.chart, series: this.series, state: this.state }
      : null;
  }

  setState(state: ChartPositionOverlayState | null): void {
    this.state = state;
    this.requestUpdate?.();
  }
}

export default function TradePriceChart({
  trade,
  bars,
  dataTimeframe,
  emptyMessage,
  notice,
  replayBars,
  replayTimeframe,
  status,
  timeframe,
  timeframes,
  onTimeframeChange
}: {
  trade: TradeChartTrade;
  bars: TradeChartBar[];
  dataTimeframe?: TradeChartTimeframe;
  emptyMessage?: string;
  notice?: string;
  replayBars?: TradeChartBar[];
  replayTimeframe?: TradeChartTimeframe;
  status: ChartStatus;
  timeframe: TradeChartTimeframe;
  timeframes: readonly { label: string; value: TradeChartTimeframe }[];
  onTimeframeChange: (value: TradeChartTimeframe) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const markersRef = useRef<TradeSeriesMarkersApi | null>(null);
  const seriesRef = useRef<CandleSeriesApi | null>(null);
  const overlaySeriesRef = useRef<TradeOverlaySeries | null>(null);
  const positionOverlayRef = useRef<ChartPositionOverlayPrimitive | null>(null);
  const lockedLogicalRangeRef = useRef<NumberRange | null>(null);
  const lockedPriceRangeRef = useRef<NumberRange | null>(null);
  const rangeReadyRef = useRef(false);
  const [activeBar, setActiveBar] = useState<TradeChartBar | null>(null);
  const [chartTheme, setChartTheme] = useState<ChartTheme>("dark");
  const [isPlaying, setIsPlaying] = useState(false);
  const [replayMode, setReplayMode] = useState<ReplayMode>("bar");
  const [showStrategyVisuals, setShowStrategyVisuals] = useState(false);
  const [replayPosition, setReplayPosition] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState<ReplaySpeed>(2);
  const mappedCandles = useMemo(() => mappedCandlesFromBars(bars), [bars]);
  const replayMappedCandles = useMemo(() => mappedCandlesFromBars(replayBars ?? []), [replayBars]);
  const effectiveDataTimeframe = dataTimeframe ?? timeframe;
  const effectiveReplayTimeframe = replayTimeframe ?? effectiveDataTimeframe;
  const hasIntrabarReplay =
    replayMappedCandles.length > 0 && timeframeSeconds(effectiveReplayTimeframe) < timeframeSeconds(effectiveDataTimeframe);
  const activeReplayMode = hasIntrabarReplay ? replayMode : "bar";
  const intrabarReplayTimeline = useMemo(
    () => replayTimelineCandles(mappedCandles, replayMappedCandles),
    [mappedCandles, replayMappedCandles]
  );
  const replayTimeline = activeReplayMode === "intrabar" ? intrabarReplayTimeline : mappedCandles;
  const maxReplayPosition = Math.max(0, replayTimeline.length - 1);
  const clampedReplayPosition = clamp(replayPosition, 0, maxReplayPosition);
  const currentReplayStep = replayTimeline[clampedReplayPosition] ?? null;
  const currentReplayTime = currentReplayStep?.time ?? null;
  const currentReplayCandle = useMemo(
    () => replayCandleForTime(mappedCandles, currentReplayTime),
    [currentReplayTime, mappedCandles]
  );
  const visibleMappedCandles = useMemo(() => {
    if (!currentReplayCandle) return [];
    return mappedCandles.filter((candle) => Number(candle.time) <= Number(currentReplayCandle.time));
  }, [currentReplayCandle, mappedCandles]);
  const candleData = useMemo<ReplayChartData[]>(
    () =>
      mappedCandles.map((candle) => {
        if (currentReplayTime == null || Number(candle.time) > Number(currentReplayTime)) {
          return { time: candle.time };
        }

        if (activeReplayMode === "intrabar" && Number(currentReplayTime) < candleEndTime(candle, effectiveDataTimeframe)) {
          const partial = aggregateIntrabarSource(candle, replayMappedCandles, currentReplayTime, effectiveDataTimeframe);
          return {
            time: candle.time,
            open: partial.open,
            high: partial.high,
            low: partial.low,
            close: partial.close
          };
        }

        return {
          time: candle.time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close
        };
      }),
    [activeReplayMode, currentReplayTime, effectiveDataTimeframe, mappedCandles, replayMappedCandles]
  );
  const sourceByTime = useMemo(
    () => new Map(mappedCandles.map((candle) => [Number(candle.time), candle.source])),
    [mappedCandles]
  );
  const entryCandle = useMemo(
    () => nearestMappedCandle(mappedCandles, trade.entryIndex, trade.entryTime),
    [mappedCandles, trade.entryIndex, trade.entryTime]
  );
  const signalCandle = useMemo(
    () => nearestMappedCandle(mappedCandles, trade.entryIndex, trade.signalTime),
    [mappedCandles, trade.entryIndex, trade.signalTime]
  );
  const exitCandle = useMemo(
    () => resolvedExitCandle(mappedCandles, trade, entryCandle, effectiveDataTimeframe),
    [effectiveDataTimeframe, entryCandle, mappedCandles, trade]
  );
  const visibleAnchor = entryCandle ?? mappedCandles[0] ?? null;
  const currentPartialSource = currentReplayCandle
    ? aggregateIntrabarSource(currentReplayCandle, replayMappedCandles, currentReplayTime, effectiveDataTimeframe)
    : null;
  const displayBar = activeBar ?? currentPartialSource ?? currentReplayCandle?.source ?? visibleAnchor?.source ?? bars[0] ?? null;
  const change = displayBar ? displayBar.close - displayBar.open : 0;
  const changePct = displayBar && displayBar.open !== 0 ? (change / displayBar.open) * 100 : 0;
  const up = change >= 0;
  const timeframeControls = (
    <div className="tradeTimeframeButtons" aria-label="Chart timeframe">
      {timeframes.map((option) => (
        <button
          aria-pressed={timeframe === option.value}
          className={timeframe === option.value ? "active" : ""}
          key={option.value}
          onClick={() => onTimeframeChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  useEffect(() => {
    setChartTheme(currentChartTheme());
    const observer = new MutationObserver(() => setChartTheme(currentChartTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setIsPlaying(false);
    setReplayMode(hasIntrabarReplay ? "intrabar" : "bar");
    setReplayPosition(Math.max(0, (hasIntrabarReplay ? intrabarReplayTimeline.length : mappedCandles.length) - 1));
  }, [hasIntrabarReplay, intrabarReplayTimeline.length, mappedCandles.length, timeframe, trade.id]);

  useEffect(() => {
    setActiveBar(null);
  }, [currentReplayCandle?.time, trade.id]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    if (clampedReplayPosition >= maxReplayPosition) {
      setIsPlaying(false);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setReplayPosition((current) => Math.min(maxReplayPosition, current + 1));
    }, REPLAY_INTERVAL_MS[replaySpeed]);

    return () => window.clearTimeout(timer);
  }, [clampedReplayPosition, isPlaying, maxReplayPosition, replaySpeed]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || status !== "ready" || !candleData.length) return undefined;

    const isLight = chartTheme === "light";
    const backgroundColor = isLight ? "#f8fafc" : "#030303";
    const textColor = isLight ? "rgba(15, 23, 42, 0.68)" : "rgba(255, 255, 255, 0.68)";
    const gridColor = isLight ? "rgba(15, 23, 42, 0.08)" : "rgba(255, 255, 255, 0.08)";
    const axisColor = isLight ? "rgba(15, 23, 42, 0.14)" : "rgba(255, 255, 255, 0.14)";
    const crosshairColor = isLight ? "rgba(15, 23, 42, 0.34)" : "rgba(255, 255, 255, 0.35)";
    const labelBackground = isLight ? "rgba(248, 250, 252, 0.96)" : "rgba(20, 20, 20, 0.94)";
    const upColor = isLight ? "#16a34a" : "#22c55e";
    const upSoftColor = isLight ? "#22c55e" : "#34d399";
    const downColor = isLight ? "#dc2626" : "#ef4444";
    const downSoftColor = isLight ? "#f43f5e" : "#f87171";

    const chart = createChart(container, {
      autoSize: true,
      width: container.clientWidth,
      height: Math.max(300, container.clientHeight || 318),
      layout: {
        background: { type: ColorType.Solid, color: backgroundColor },
        textColor,
        fontFamily: "'IBM Plex Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
        fontSize: 11
      },
      grid: {
        vertLines: { color: gridColor, style: LineStyle.Dashed, visible: true },
        horzLines: { color: gridColor, style: LineStyle.Dashed, visible: true }
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: crosshairColor,
          labelBackgroundColor: labelBackground,
          style: LineStyle.Dashed,
          width: 1
        },
        horzLine: {
          color: crosshairColor,
          labelBackgroundColor: labelBackground,
          style: LineStyle.Dashed,
          width: 1
        }
      },
      rightPriceScale: {
        autoScale: false,
        borderColor: axisColor,
        scaleMargins: { top: 0.12, bottom: 0.16 }
      },
      timeScale: {
        borderColor: axisColor,
        barSpacing: 6,
        lockVisibleTimeRangeOnResize: true,
        minBarSpacing: 1,
        rightOffset: 8,
        shiftVisibleRangeOnNewBar: false,
        allowShiftVisibleRangeOnWhitespaceReplacement: false,
        timeVisible: true,
        secondsVisible: false
      },
      localization: {
        priceFormatter: formatChartPrice
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
        axisDoubleClickReset: true
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false
      }
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor,
      downColor,
      borderUpColor: upSoftColor,
      borderDownColor: downSoftColor,
      wickUpColor: upSoftColor,
      wickDownColor: downSoftColor,
      priceScaleId: "right",
      priceLineVisible: false,
      lastValueVisible: true
    });

    chartRef.current = chart;
    seriesRef.current = series;
    series.setData(candleData);
    const overlayTheme = tradeVisualTheme(isLight);
    const overlaySeries: TradeOverlaySeries = {
      profitZone: chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: trade.entryPrice },
        topLineColor: "rgba(0,0,0,0)",
        topFillColor1: overlayTheme.profitFillStrong,
        topFillColor2: overlayTheme.profitFillSoft,
        bottomLineColor: "rgba(0,0,0,0)",
        bottomFillColor1: "rgba(0,0,0,0)",
        bottomFillColor2: "rgba(0,0,0,0)",
        priceScaleId: "right",
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      }),
      lossZone: chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: trade.entryPrice },
        topLineColor: "rgba(0,0,0,0)",
        topFillColor1: "rgba(0,0,0,0)",
        topFillColor2: "rgba(0,0,0,0)",
        bottomLineColor: "rgba(0,0,0,0)",
        bottomFillColor1: overlayTheme.riskFillStrong,
        bottomFillColor2: overlayTheme.riskFillSoft,
        priceScaleId: "right",
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      }),
      entryLine: chart.addSeries(LineSeries, {
        color: overlayTheme.entryLine,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        priceScaleId: "right",
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      }),
      targetLine: chart.addSeries(LineSeries, {
        color: overlayTheme.targetLine,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        priceScaleId: "right",
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      }),
      stopLine: chart.addSeries(LineSeries, {
        color: overlayTheme.stopLine,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        priceScaleId: "right",
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      }),
      pathLine: chart.addSeries(LineSeries, {
        color: overlayTheme.pathLine,
        lineWidth: 3,
        lineStyle: LineStyle.Dotted,
        priceScaleId: "right",
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      }),
      limitOrderLine: chart.addSeries(LineSeries, {
        color: "#fbbf24",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        priceScaleId: "right",
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      })
    };
    applyOverlayTheme(overlaySeries, overlayTheme, trade);
    overlaySeriesRef.current = overlaySeries;
    const markers = createSeriesMarkers(series, [], {
      autoScale: false,
      zOrder: "aboveSeries"
    });
    markersRef.current = markers;
    const positionOverlay = new ChartPositionOverlayPrimitive();
    series.attachPrimitive(positionOverlay);
    positionOverlayRef.current = positionOverlay;
    const initialSnapshot: TradeVisualSnapshot = {
      currentPrice: currentPartialSource?.close ?? null,
      currentReplayCandle,
      currentReplayTime,
      entryCandle,
      exitCandle,
      signalCandle,
      trade
    };
    emptyOverlayData(overlaySeries);
    positionOverlay.setState({
      candles: mappedCandles,
      dataTimeframe: effectiveDataTimeframe,
      snapshot: initialSnapshot,
      structureVisuals: strategyStructureVisuals(initialSnapshot, mappedCandles, showStrategyVisuals)
    });
    markers.setMarkers([...tradeMarkerList(initialSnapshot), ...strategyVisualMarkers(initialSnapshot, mappedCandles, showStrategyVisuals)]);

    const logicalRange = tradeLogicalRange(mappedCandles, entryCandle, exitCandle);
    const priceRange = tradePriceRange(
      mappedCandles,
      [trade.entryPrice, trade.exitPrice, trade.targetPrice, trade.stopPrice],
      logicalRange
    );
    lockedLogicalRangeRef.current = logicalRange;
    lockedPriceRangeRef.current = priceRange;
    rangeReadyRef.current = false;

    chart.timeScale().setVisibleLogicalRange(logicalRange);
    series.priceScale().applyOptions({ autoScale: false, scaleMargins: { top: 0.12, bottom: 0.16 } });
    if (priceRange) series.priceScale().setVisibleRange(priceRange);
    const rangeAnimationFrame = window.requestAnimationFrame(() => {
      chart.timeScale().setVisibleLogicalRange(logicalRange);
      if (priceRange) series.priceScale().setVisibleRange(priceRange);
      rangeReadyRef.current = true;
    });

    const handleCrosshairMove = (param: { time?: unknown }) => {
      if (typeof param.time !== "number") return;
      const source = sourceByTime.get(param.time);
      if (source) setActiveBar(source);
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      window.cancelAnimationFrame(rangeAnimationFrame);
      markers.detach();
      series.detachPrimitive(positionOverlay);
      chart.remove();
      chartRef.current = null;
      markersRef.current = null;
      seriesRef.current = null;
      overlaySeriesRef.current = null;
      positionOverlayRef.current = null;
      lockedLogicalRangeRef.current = null;
      lockedPriceRangeRef.current = null;
      rangeReadyRef.current = false;
    };
  }, [
    chartTheme,
    entryCandle,
    effectiveDataTimeframe,
    exitCandle,
    mappedCandles,
    signalCandle,
    sourceByTime,
    status,
    trade.entryType,
    trade.entryPrice,
    trade.exitPrice,
    trade.phase,
    trade.side,
    trade.signalTime,
    trade.stopPrice,
    trade.targetPrice
  ]);

  useEffect(() => {
    const chart = chartRef.current;
    const markers = markersRef.current;
    const positionOverlay = positionOverlayRef.current;
    const series = seriesRef.current;
    const overlaySeries = overlaySeriesRef.current;
    if (!chart || !markers || !series || !overlaySeries || !positionOverlay) return;

    const currentLogicalRange = chart.timeScale().getVisibleLogicalRange();
    const currentPriceRange = series.priceScale().getVisibleRange();
    series.setData(candleData);

    series.priceScale().applyOptions({ autoScale: false });
    if (currentPriceRange) series.priceScale().setVisibleRange(currentPriceRange);
    if (currentLogicalRange) chart.timeScale().setVisibleLogicalRange(currentLogicalRange);

    const snapshot: TradeVisualSnapshot = {
      currentPrice: currentPartialSource?.close ?? null,
      currentReplayCandle,
      currentReplayTime,
      entryCandle,
      exitCandle,
      signalCandle,
      trade
    };
    applyOverlayTheme(overlaySeries, tradeVisualTheme(chartTheme === "light"), trade);
    emptyOverlayData(overlaySeries);
    positionOverlay.setState({
      candles: mappedCandles,
      dataTimeframe: effectiveDataTimeframe,
      snapshot,
      structureVisuals: strategyStructureVisuals(snapshot, mappedCandles, showStrategyVisuals)
    });
    markers.setMarkers([...tradeMarkerList(snapshot), ...strategyVisualMarkers(snapshot, mappedCandles, showStrategyVisuals)]);
  }, [candleData, chartTheme, currentPartialSource?.close, currentReplayCandle, currentReplayTime, effectiveDataTimeframe, entryCandle, exitCandle, mappedCandles, showStrategyVisuals, signalCandle, trade]);

  function togglePlayback() {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }

    if (clampedReplayPosition >= maxReplayPosition) {
      setReplayPosition(0);
    }
    setIsPlaying(true);
  }

  function stepReplay(delta: number) {
    setIsPlaying(false);
    setReplayPosition((current) => clamp(current + delta, 0, maxReplayPosition));
  }

  function resetReplay() {
    setIsPlaying(false);
    setReplayPosition(0);
  }

  function replayIndexForTime(value: string): number {
    const target = timestampFromTime(value);
    if (target == null || !replayTimeline.length) return clampedReplayPosition;

    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < replayTimeline.length; index += 1) {
      const distance = Math.abs(Number(replayTimeline[index]!.time) - Number(target));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    return bestIndex;
  }

  function jumpReplay(value: string) {
    setIsPlaying(false);
    setReplayPosition(replayIndexForTime(value));
  }

  function updateReplayMode(nextMode: ReplayMode) {
    if (nextMode === activeReplayMode) return;
    const anchorTime = currentReplayTime;
    setIsPlaying(false);
    setReplayMode(nextMode);
    if (anchorTime == null) return;
    const nextTimeline = nextMode === "intrabar" && hasIntrabarReplay ? intrabarReplayTimeline : mappedCandles;
    let nextIndex = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < nextTimeline.length; index += 1) {
      const distance = Math.abs(Number(nextTimeline[index]!.time) - Number(anchorTime));
      if (distance < bestDistance) {
        bestDistance = distance;
        nextIndex = index;
      }
    }
    setReplayPosition(nextIndex);
  }

  const replayControls = mappedCandles.length ? (
    <div className="tradeReplayPanel">
      <div className="tradeReplayControls">
        <div className="tradeReplayButtons" aria-label="Replay controls">
          <button type="button" onClick={resetReplay}>Reset</button>
          <button type="button" onClick={() => stepReplay(-1)}>Back</button>
          <button type="button" className={isPlaying ? "active" : ""} onClick={togglePlayback}>
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button type="button" onClick={() => stepReplay(1)}>Forward</button>
        </div>
        <div className="tradeReplayButtons compact" aria-label="Replay jumps">
          <button type="button" onClick={() => jumpReplay(trade.signalTime)}>Signal</button>
          <button type="button" onClick={() => jumpReplay(trade.entryTime)}>Entry</button>
          <button type="button" onClick={() => jumpReplay(trade.exitTime)}>Exit</button>
        </div>
      </div>
      <label className="tradeReplaySlider">
        <span>{formatChartTime(currentReplayStep?.source.time ?? currentReplayCandle?.source.time)}</span>
        <input
          type="range"
          min={0}
          max={maxReplayPosition}
          step={1}
          value={clampedReplayPosition}
          onChange={(event) => {
            setIsPlaying(false);
            setReplayPosition(Number(event.target.value));
          }}
        />
        <strong>{clampedReplayPosition + 1} / {replayTimeline.length}</strong>
      </label>
      <div className="tradeReplayOptions">
        <div className="tradeReplayMode" aria-label="Replay step mode">
          <button
            aria-pressed={activeReplayMode === "intrabar"}
            className={activeReplayMode === "intrabar" ? "active" : ""}
            disabled={!hasIntrabarReplay}
            onClick={() => updateReplayMode("intrabar")}
            type="button"
          >
            1m step
          </button>
          <button
            aria-pressed={activeReplayMode === "bar"}
            className={activeReplayMode === "bar" ? "active" : ""}
            onClick={() => updateReplayMode("bar")}
            type="button"
          >
            Bar step
          </button>
        </div>
        <div className="tradeReplaySpeeds" aria-label="Replay speed">
          {REPLAY_SPEEDS.map((speed) => (
            <button
              aria-pressed={replaySpeed === speed}
              className={replaySpeed === speed ? "active" : ""}
              key={speed}
              onClick={() => setReplaySpeed(speed)}
              type="button"
            >
              {speed}x
            </button>
          ))}
        </div>
        <label className="tradeReplayToggle">
          <input
            checked={showStrategyVisuals}
            onChange={(event) => setShowStrategyVisuals(event.target.checked)}
            type="checkbox"
          />
          Structure
        </label>
      </div>
    </div>
  ) : null;

  if (status === "loading" || status === "error" || !bars.length || !mappedCandles.length) {
    return (
      <section className="tradeCandlestickPanel isEmpty">
        <div className="tradeCandlestickHead">
          <strong>Trade Candlesticks</strong>
          {timeframeControls}
        </div>
        <span>{chartMessage(status, emptyMessage)}</span>
      </section>
    );
  }

  return (
    <section className="tradeCandlestickPanel">
      <div className="tradeCandlestickHead">
        <strong>Trade Candlesticks</strong>
        <div className="tradeCandlestickHeadMeta">
          {notice ? <span className="tradeChartNotice">{notice}</span> : null}
          <span><strong>{visibleMappedCandles.length}</strong> / {mappedCandles.length} candles</span>
          {timeframeControls}
        </div>
      </div>
      <div className="tradePriceChartWrap">
        <div className="tradeChartLegend">
          <strong>{formatChartTime(displayBar?.time)}</strong>
          <span>
            O <strong>{formatChartPrice(displayBar?.open)}</strong>
          </span>
          <span>
            H <strong>{formatChartPrice(displayBar?.high)}</strong>
          </span>
          <span>
            L <strong>{formatChartPrice(displayBar?.low)}</strong>
          </span>
          <span>
            C <strong>{formatChartPrice(displayBar?.close)}</strong>
          </span>
          <span>
            Vol <strong>{formatVolume(displayBar?.volume)}</strong>
          </span>
          <span className={up ? "up" : "down"}>
            Change <strong>{formatChartPrice(change)} / {formatPct(changePct)}</strong>
          </span>
        </div>
        <div ref={containerRef} className="tradePriceChart" aria-label={`${trade.symbol} TradingView Lightweight candlestick chart`} />
      </div>
      {replayControls}
    </section>
  );
}
