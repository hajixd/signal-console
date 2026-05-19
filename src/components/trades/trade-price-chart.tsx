"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
import { resolveFirstTradeBracketHit } from "@/lib/trade-bracket-truth";

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
  label?: string;
  modelName?: string;
  entryType?: "market" | "limit";
  entryPrice: number;
  exitPrice: number;
  targetPrice: number;
  stopPrice: number;
  targetDollars?: number;
  riskDollars?: number;
  dollarsPerPricePoint?: number;
  pnlLabel?: string;
};
type TradeSide = TradeChartTrade["side"];

type ChartStatus = "idle" | "loading" | "ready" | "error";
type ChartTheme = "dark" | "light";
type ReplaySpeed = 1 | 2 | 4 | 8;
type ReplayMode = "intrabar" | "bar";
type ReplayIconName = "reset" | "stepBack" | "play" | "pause" | "stepForward" | "select" | "signal" | "entry" | "exit";
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
type StructureTone = "bullish" | "bearish" | "neutral" | "warning" | "info";
type StructureLineStyle = "solid" | "dashed" | "dotted";
type StructureBox = {
  border?: StructureLineStyle;
  endTime: Time;
  high: number;
  label: string;
  low: number;
  startTime: Time;
  tone: StructureTone;
};
type StructureLine = {
  style?: StructureLineStyle;
  endTime: Time;
  label: string;
  price: number;
  startTime: Time;
  tone: StructureTone;
  width?: number;
};
type StructureSegment = {
  arrow?: boolean;
  endPrice: number;
  endTime: Time;
  label: string;
  startPrice: number;
  startTime: Time;
  style?: StructureLineStyle;
  tone: StructureTone;
  width?: number;
};
type StructurePath = {
  label: string;
  points: Array<{ price: number; time: Time }>;
  style?: StructureLineStyle;
  tone: StructureTone;
  width?: number;
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
  paths: StructurePath[];
  segments: StructureSegment[];
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

const REPLAY_ICON_PATHS: Record<ReplayIconName, string[]> = {
  reset: ["M4 7v5h5", "M5.8 12a6 6 0 1 0 1.7-6.1L4 9.2"],
  stepBack: ["M11 6 6 10l5 4V6Z", "M18 6l-5 4 5 4V6Z"],
  play: ["M7 5v14l12-7L7 5Z"],
  pause: ["M7 5h4v14H7V5Z", "M13 5h4v14h-4V5Z"],
  stepForward: ["M6 6l5 4-5 4V6Z", "M13 6l5 4-5 4V6Z"],
  select: ["M4 12h16", "M12 4v16", "M8 8h8v8H8V8Z"],
  signal: ["M5 18 19 6", "M7 6h12v12"],
  entry: ["M12 5v14", "M6 11l6-6 6 6"],
  exit: ["M12 19V5", "M6 13l6 6 6-6"]
};

function ReplayIcon({ name }: { name: ReplayIconName }) {
  return (
    <svg aria-hidden="true" className="tradeReplayIcon" focusable="false" viewBox="0 0 24 24">
      {REPLAY_ICON_PATHS[name].map((path) => (
        <path d={path} fill="none" key={path} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      ))}
    </svg>
  );
}

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

function aggregateCandlesForTimeframe(
  candles: MappedCandle[],
  dataTimeframe: TradeChartTimeframe,
  sourceTimeframe: TradeChartTimeframe
): MappedCandle[] {
  const dataSeconds = timeframeSeconds(dataTimeframe);
  const sourceSeconds = timeframeSeconds(sourceTimeframe);
  if (!candles.length || sourceSeconds <= dataSeconds) return candles;

  const buckets = new Map<number, MappedCandle[]>();
  for (const candle of candles) {
    const bucketTime = Math.floor(Number(candle.time) / sourceSeconds) * sourceSeconds;
    const bucket = buckets.get(bucketTime) ?? [];
    bucket.push(candle);
    buckets.set(bucketTime, bucket);
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bucketTime, bucket]) => {
      const sorted = [...bucket].sort((left, right) => Number(left.time) - Number(right.time));
      const first = sorted[0]!;
      const last = sorted[sorted.length - 1]!;
      return {
        time: bucketTime as UTCTimestamp,
        open: first.open,
        high: Math.max(...sorted.map((candle) => candle.high)),
        low: Math.min(...sorted.map((candle) => candle.low)),
        close: last.close,
        source: {
          ...first.source,
          time: new Date(bucketTime * 1000).toISOString(),
          open: first.open,
          high: Math.max(...sorted.map((candle) => candle.high)),
          low: Math.min(...sorted.map((candle) => candle.low)),
          close: last.close,
          volume: sorted.reduce((total, candle) => total + (candle.source.volume ?? 0), 0)
        }
      };
    });
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

function formatSignedMoney(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0
  })}`;
}

function rawTradePnlAtPrice(trade: TradeChartTrade, price: number | null | undefined): number | null {
  const dollarsPerPricePoint = Math.max(0, trade.dollarsPerPricePoint ?? 0);
  if (price == null || !Number.isFinite(price) || !(dollarsPerPricePoint > 0)) return null;

  const direction = trade.side === "long" ? 1 : -1;
  return (price - trade.entryPrice) * direction * dollarsPerPricePoint;
}

function boundedTradePnl(trade: TradeChartTrade, pnlDollars: number): number {
  const targetDollars = Math.abs(trade.targetDollars ?? Infinity);
  const riskDollars = Math.abs(trade.riskDollars ?? Infinity);
  return clamp(pnlDollars, -riskDollars, targetDollars);
}

function tradePnlAtPrice(trade: TradeChartTrade, price: number | null | undefined): number | null {
  const rawPnlDollars = rawTradePnlAtPrice(trade, price);
  return rawPnlDollars == null ? null : boundedTradePnl(trade, rawPnlDollars);
}

function boundedTradePathPrice(trade: TradeChartTrade, price: number | null | undefined): number | null {
  const boundedPnlDollars = tradePnlAtPrice(trade, price);
  const dollarsPerPricePoint = Math.max(0, trade.dollarsPerPricePoint ?? 0);
  if (boundedPnlDollars == null || !(dollarsPerPricePoint > 0)) return price ?? null;

  const direction = trade.side === "long" ? 1 : -1;
  return trade.entryPrice + (boundedPnlDollars / dollarsPerPricePoint) * direction;
}

function replayPnlLabel(
  trade: TradeChartTrade,
  price: number | null | undefined,
  entryRevealed: boolean,
  exitRevealed: boolean
): string {
  if (!entryRevealed) return "Pre-entry";
  if (exitRevealed && trade.pnlLabel) return trade.pnlLabel;

  const pnlDollars = tradePnlAtPrice(trade, price);
  return pnlDollars == null ? trade.pnlLabel ?? "Exit" : formatSignedMoney(pnlDollars);
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

function candleIndex(candles: MappedCandle[], candle: MappedCandle | null): number {
  if (!candle) return 0;
  const found = candles.findIndex((candidate) => candidate.time === candle.time);
  return found >= 0 ? found : 0;
}

function firstBracketExitCandle(
  candles: MappedCandle[],
  trade: TradeChartTrade,
  entryCandle: MappedCandle | null,
  fallbackExitCandle: MappedCandle | null
): MappedCandle | null {
  if (!entryCandle || !fallbackExitCandle || !candles.length) return fallbackExitCandle;

  const hit = resolveFirstTradeBracketHit(
    {
      entryIndex: entryCandle.source.index,
      entryPrice: trade.entryPrice,
      entryTime: entryCandle.source.time,
      exitIndex: fallbackExitCandle.source.index,
      exitTime: fallbackExitCandle.source.time,
      side: trade.side,
      stopPrice: trade.stopPrice,
      targetPrice: trade.targetPrice
    },
    candles.map((candle) => candle.source)
  );

  return hit ? candles[hit.position] ?? fallbackExitCandle : fallbackExitCandle;
}

function tradeLogicalRange(candles: MappedCandle[], entryCandle: MappedCandle | null, exitCandle: MappedCandle | null): NumberRange {
  const entryPosition = candleIndex(candles, entryCandle);
  const exitPosition = candleIndex(candles, exitCandle);
  const start = Math.min(entryPosition, exitPosition);
  const end = Math.max(entryPosition, exitPosition);
  const tradeWindow = Math.max(10, end - start + 1);
  const fullCandleCount = Math.max(1, candles.length);
  const windowSize = Math.max(60, Math.ceil(tradeWindow * 3));
  const edgeWhitespace = Math.max(30, Math.ceil(windowSize * 0.5));
  const minFrom = -edgeWhitespace;
  const maxTo = fullCandleCount - 1 + edgeWhitespace;
  const midpoint = (start + end) / 2;
  let from = midpoint - (windowSize - 1) / 2;
  let to = midpoint + (windowSize - 1) / 2;

  if (from < minFrom) {
    to += minFrom - from;
    from = minFrom;
  }
  if (to > maxTo) {
    const overshoot = to - maxTo;
    from = Math.max(minFrom, from - overshoot);
    to = maxTo;
  }

  return { from, to };
}

function applyTradeChartRange(chart: IChartApi, series: CandleSeriesApi, logicalRange: NumberRange, priceRange: NumberRange | null): void {
  chart.timeScale().setVisibleLogicalRange(logicalRange);
  series.priceScale().applyOptions({ autoScale: false, scaleMargins: { top: 0.12, bottom: 0.16 } });
  if (priceRange) series.priceScale().setVisibleRange(priceRange);
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
  const rawPathEndPrice = snapshot.currentPrice ?? snapshot.currentReplayCandle?.close;
  const pathEndPrice = exitRevealed ? snapshot.trade.exitPrice : boundedTradePathPrice(snapshot.trade, rawPathEndPrice);

  if (!snapshot.entryCandle || !pathEndCandle || pathEndPrice == null || !Number.isFinite(pathEndPrice)) {
    emptyOverlayData(series);
    return;
  }

  const startTime = snapshot.entryCandle.time as Time;
  const pathEndTime = pathEndCandle.time as Time;
  const areaEndCandle = snapshot.exitCandle ?? pathEndCandle;
  const areaEndTime = areaEndCandle.time as Time;

  series.profitZone.setData(overlayLineData(startTime, areaEndTime, snapshot.trade.targetPrice));
  series.lossZone.setData(overlayLineData(startTime, areaEndTime, snapshot.trade.stopPrice));
  series.entryLine.setData(overlayLineData(startTime, areaEndTime, snapshot.trade.entryPrice));
  series.targetLine.setData(overlayLineData(startTime, areaEndTime, snapshot.trade.targetPrice));
  series.stopLine.setData(overlayLineData(startTime, areaEndTime, snapshot.trade.stopPrice));
  series.pathLine.setData(
    isAscendingTime(startTime, pathEndTime)
      ? [
          { time: startTime, value: snapshot.trade.entryPrice },
          { time: pathEndTime, value: pathEndPrice }
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

function coordinateInPane(value: number | null, max: number, padding = 0): value is number {
  return coordinateIsVisible(value) && value >= -padding && value <= max + padding;
}

function coordinateRangeIntersectsPane(first: number, second: number, max: number): boolean {
  return coordinateIsVisible(first) && coordinateIsVisible(second) && Math.max(first, second) >= 0 && Math.min(first, second) <= max;
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

function chartCandleRightEdgeX(chart: IChartApi, candles: MappedCandle[], candle: MappedCandle | null, fallbackX: number): number {
  if (!candle) return fallbackX;
  const index = candleIndex(candles, candle);
  const centerX = chart.timeScale().logicalToCoordinate(index as Logical);
  if (!coordinateIsVisible(centerX)) return fallbackX;

  const nextX = candles[index + 1] ? chart.timeScale().logicalToCoordinate((index + 1) as Logical) : null;
  const previousX = candles[index - 1] ? chart.timeScale().logicalToCoordinate((index - 1) as Logical) : null;
  const barWidth = coordinateIsVisible(nextX)
    ? Math.abs(nextX - centerX)
    : coordinateIsVisible(previousX)
      ? Math.abs(centerX - previousX)
      : 6;

  return centerX + barWidth / 2;
}

function structureXForTime(
  chart: IChartApi,
  candles: MappedCandle[],
  rawTime: Time,
  dataTimeframe: TradeChartTimeframe,
  paneWidth: number
): number | null {
  const directCoordinate = chartXForTime(chart, candles, rawTime, dataTimeframe);
  if (coordinateIsVisible(directCoordinate)) return directCoordinate;
  if (typeof rawTime !== "number") return null;

  const candle = replayCandleForTime(candles, rawTime);
  if (!candle) return null;
  const visibleRange = chart.timeScale().getVisibleLogicalRange();
  if (!visibleRange) return null;
  const rangeStart = Number(visibleRange.from);
  const rangeEnd = Number(visibleRange.to);
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) return null;

  const index = candleIndex(candles, candle);
  const progress = clamp((Number(rawTime) - Number(candle.time)) / timeframeSeconds(dataTimeframe), 0, 1);
  const logical = index + progress;
  return ((logical - rangeStart) / (rangeEnd - rangeStart)) * paneWidth;
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
  const rawPathEndPrice = snapshot.currentPrice ?? snapshot.currentReplayCandle?.close;
  const pathEndPrice = exitRevealed ? snapshot.trade.exitPrice : boundedTradePathPrice(snapshot.trade, rawPathEndPrice);
  if (!snapshot.entryCandle || !pathEndCandle || pathEndPrice == null || !Number.isFinite(pathEndPrice)) return null;

  const startTime = snapshot.entryCandle.time as Time;
  const endTime = (exitRevealed ? pathEndCandle.time : snapshot.currentReplayTime ?? pathEndCandle.time) as Time;
  const x1 = chartXForTime(chart, candles, startTime, dataTimeframe);
  const markerX = chartXForTime(chart, candles, endTime, dataTimeframe);
  const areaEndCandle = snapshot.exitCandle ?? pathEndCandle;
  const areaEndTime = areaEndCandle.time as Time;
  const areaEndCandleForTime = replayCandleForTime(candles, areaEndTime) ?? areaEndCandle;
  const areaEndX = chartXForTime(chart, candles, areaEndTime, dataTimeframe);
  const areaX2 = areaEndX == null ? markerX : chartCandleRightEdgeX(chart, candles, areaEndCandleForTime, areaEndX);
  const yTarget = series.priceToCoordinate(snapshot.trade.targetPrice);
  const yStop = series.priceToCoordinate(snapshot.trade.stopPrice);
  const yPathEnd = series.priceToCoordinate(pathEndPrice);
  const yExit = series.priceToCoordinate(snapshot.trade.exitPrice);
  const markerY = exitRevealed ? yExit : yPathEnd;
  const markerPrice = exitRevealed ? snapshot.trade.exitPrice : pathEndPrice;
  const exitIsFavorable = (markerPrice - snapshot.trade.entryPrice) * (snapshot.trade.side === "long" ? 1 : -1) >= 0;

  if (
    !coordinateIsVisible(x1) ||
    !coordinateIsVisible(markerX) ||
    !coordinateIsVisible(areaX2) ||
    !coordinateIsVisible(yEntry) ||
    !coordinateIsVisible(yTarget) ||
    !coordinateIsVisible(yStop) ||
    !coordinateIsVisible(yPathEnd) ||
    !coordinateIsVisible(markerY)
  ) {
    return null;
  }

  const clampedX1 = clamp(x1, 0, size.width);
  const clampedMarkerX = clamp(markerX, 0, size.width);
  const clampedAreaX2 = clamp(areaX2, 0, size.width);

  return {
    entryLine: yEntry,
    exitMarker: coordinateIsVisible(markerY)
      ? {
          color: exitIsFavorable ? "#35c971" : "#f0455a",
          label: replayPnlLabel(snapshot.trade, markerPrice, true, exitRevealed),
          side: snapshot.trade.side,
          tone: "exit",
          x: clampedMarkerX,
          y: markerY
        }
      : null,
    height: size.height,
    limitLine,
    path: {
      x1: clampedX1,
      x2: clampedMarkerX,
      y1: yEntry,
      y2: yPathEnd
    },
    profit: overlayBand(clampedX1, clampedAreaX2, yEntry, yTarget),
    risk: overlayBand(clampedX1, clampedAreaX2, yEntry, yStop),
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
    x2: clampedAreaX2
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
  return { boxes: [], lines: [], paths: [], segments: [], tags: [] };
}

function averageCandleRange(candles: MappedCandle[], start: number, end: number): number {
  const ranges: number[] = [];
  for (let index = Math.max(0, start); index <= Math.min(candles.length - 1, end); index += 1) {
    const candle = candles[index];
    if (candle) ranges.push(Math.max(0, candle.high - candle.low));
  }

  return ranges.length ? ranges.reduce((sum, range) => sum + range, 0) / ranges.length : 0;
}

const SESSION_OPEN_MINUTES: Record<string, number> = {
  asia: 18 * 60,
  london: 3 * 60,
  ny: 9 * 60 + 30,
  pre_ny: 8 * 60 + 30
};

const NY_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/New_York",
  year: "numeric"
});
const NY_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  timeZone: "America/New_York"
});

function structureToneForDirection(direction: number): StructureTone {
  return direction === 1 ? "bullish" : "bearish";
}

function structureTagPositionForDirection(direction: number): StructureTag["position"] {
  return direction === 1 ? "below" : "above";
}

function candleTime(candles: MappedCandle[], index: number): Time {
  return candles[clamp(Math.round(index), 0, candles.length - 1)]!.time as Time;
}

function currentStructureTime(snapshot: TradeVisualSnapshot): Time | null {
  return (snapshot.currentReplayTime ?? snapshot.currentReplayCandle?.time ?? null) as Time | null;
}

function variantTokens(variantId: string | undefined): string[] {
  return (variantId ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

function variantValue(variantId: string | undefined, key: string): string | null {
  for (const token of variantTokens(variantId)) {
    const separator = token.indexOf("=");
    if (separator < 0) continue;
    if (token.slice(0, separator) === key) return token.slice(separator + 1);
  }

  return null;
}

function variantNumber(variantId: string | undefined, key: string, fallback: number): number {
  const parsed = Number(variantValue(variantId, key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function variantSession(variantId: string | undefined): string {
  const token = variantTokens(variantId).find((part) => part in SESSION_OPEN_MINUTES || part === "all");
  return token ?? "ny";
}

function strategyFingerprint(trade: TradeChartTrade): string {
  return `${trade.phase ?? ""} ${trade.variantId ?? ""} ${trade.modelName ?? ""} ${trade.label ?? ""}`.toLowerCase();
}

function strategyUsesOrderBlock(trade: TradeChartTrade): boolean {
  return /order[_\s-]?block|\bob_break|\bob_retest/.test(strategyFingerprint(trade));
}

function chartBarsFromMinutes(minutes: number, dataTimeframe: TradeChartTimeframe): number {
  return Math.max(1, Math.round((minutes * 60) / timeframeSeconds(dataTimeframe)));
}

function chartBarsFromStrategyBars(strategyBars: number, trade: TradeChartTrade, dataTimeframe: TradeChartTimeframe): number {
  const sourceTimeframe = trade.sourceTimeframe ?? "15m";
  return Math.max(1, Math.round((strategyBars * timeframeSeconds(sourceTimeframe)) / timeframeSeconds(dataTimeframe)));
}

function rangeHighLow(candles: MappedCandle[], start: number, end: number): { high: number; low: number } | null {
  const first = clamp(Math.floor(start), 0, candles.length - 1);
  const last = clamp(Math.floor(end), first, candles.length - 1);
  let high = -Infinity;
  let low = Infinity;

  for (let index = first; index <= last; index += 1) {
    const candle = candles[index];
    if (!candle) continue;
    high = Math.max(high, candle.high);
    low = Math.min(low, candle.low);
  }

  return Number.isFinite(high) && Number.isFinite(low) && high > low ? { high, low } : null;
}

function highestIndex(candles: MappedCandle[], start: number, end: number): number {
  let bestIndex = clamp(Math.floor(start), 0, candles.length - 1);
  let bestValue = -Infinity;
  for (let index = bestIndex; index <= clamp(Math.floor(end), bestIndex, candles.length - 1); index += 1) {
    if (candles[index]!.high > bestValue) {
      bestValue = candles[index]!.high;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function lowestIndex(candles: MappedCandle[], start: number, end: number): number {
  let bestIndex = clamp(Math.floor(start), 0, candles.length - 1);
  let bestValue = Infinity;
  for (let index = bestIndex; index <= clamp(Math.floor(end), bestIndex, candles.length - 1); index += 1) {
    if (candles[index]!.low < bestValue) {
      bestValue = candles[index]!.low;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function nyDateKey(time: Time): string {
  return NY_DATE_FORMATTER.format(new Date(Number(time) * 1000));
}

function nyMinutes(time: Time): number {
  const parts = NY_TIME_FORMATTER.formatToParts(new Date(Number(time) * 1000));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return (hour % 24) * 60 + minute;
}

function sessionStartIndex(candles: MappedCandle[], anchorIndex: number, variantId: string | undefined): number {
  const session = variantSession(variantId);
  if (session === "all") return Math.max(0, anchorIndex - 120);
  const openMinutes = SESSION_OPEN_MINUTES[session] ?? SESSION_OPEN_MINUTES.ny;
  const key = nyDateKey(candleTime(candles, anchorIndex));
  let fallback = Math.max(0, anchorIndex - 120);

  for (let index = 0; index <= anchorIndex; index += 1) {
    const candle = candles[index]!;
    if (nyDateKey(candle.time as Time) !== key) continue;
    const minutes = nyMinutes(candle.time as Time);
    if (minutes >= openMinutes) return index;
    fallback = index;
  }

  return fallback;
}

function openingRangeIndices(
  candles: MappedCandle[],
  anchorIndex: number,
  variantId: string | undefined,
  rangeMinutes: number,
  dataTimeframe: TradeChartTimeframe
): { end: number; start: number } | null {
  const session = variantSession(variantId);
  if (session !== "all") {
    const openMinutes = SESSION_OPEN_MINUTES[session] ?? SESSION_OPEN_MINUTES.ny;
    const rangeEndMinutes = openMinutes + rangeMinutes;
    const key = nyDateKey(candleTime(candles, anchorIndex));
    let start = -1;
    let end = -1;

    for (let index = 0; index <= anchorIndex; index += 1) {
      const candle = candles[index]!;
      if (nyDateKey(candle.time as Time) !== key) continue;
      const minutes = nyMinutes(candle.time as Time);
      if (minutes >= openMinutes && minutes < rangeEndMinutes) {
        if (start < 0) start = index;
        end = index;
      }
    }

    if (start >= 0 && end >= start) return { end, start };
  }

  const rangeBars = chartBarsFromMinutes(rangeMinutes, dataTimeframe);
  const end = Math.max(0, anchorIndex - 1);
  const start = Math.max(0, end - rangeBars + 1);
  return end >= start ? { end, start } : null;
}

function tradeStructureEndTime(
  snapshot: TradeVisualSnapshot,
  candles: MappedCandle[],
  currentPosition: number,
  entryPosition: number,
  extraBars = 24
): Time {
  const currentTime = currentStructureTime(snapshot);
  const exitPosition = candleIndex(candles, snapshot.exitCandle);
  const capPosition = exitPosition > entryPosition
    ? exitPosition
    : Math.min(candles.length - 1, entryPosition + extraBars);
  const endPosition = Math.min(currentPosition, capPosition);
  return endPosition === currentPosition && currentTime != null ? currentTime : candleTime(candles, endPosition);
}

function findBreakoutIndex(candles: MappedCandle[], start: number, end: number, level: number, direction: number): number | null {
  for (let index = Math.max(0, start); index <= Math.min(candles.length - 1, end); index += 1) {
    const candle = candles[index]!;
    if (direction === 1 && candle.close > level) return index;
    if (direction === -1 && candle.close < level) return index;
  }

  return null;
}

function lineValueAtIndex(startIndex: number, startPrice: number, endIndex: number, endPrice: number, targetIndex: number): number {
  if (endIndex === startIndex) return endPrice;
  const progress = (targetIndex - startIndex) / (endIndex - startIndex);
  return startPrice + (endPrice - startPrice) * progress;
}

function averageParts(raw: string | null, fallback: string): { kind: "EMA" | "SMA"; length: number } {
  const token = (raw || fallback).toUpperCase();
  const kind: "EMA" | "SMA" = token.startsWith("EMA") ? "EMA" : "SMA";
  const length = Number(token.slice(3));
  return { kind, length: Number.isFinite(length) ? Math.max(2, Math.round(length)) : Number(fallback.slice(3)) };
}

function movingAveragePoints(
  candles: MappedCandle[],
  start: number,
  end: number,
  kind: "EMA" | "SMA",
  length: number
): StructurePath["points"] {
  const first = clamp(Math.floor(start), 0, candles.length - 1);
  const last = clamp(Math.floor(end), first, candles.length - 1);
  const warmStart = Math.max(0, first - length * 4);
  const points: StructurePath["points"] = [];
  let ema: number | null = null;
  const alpha = 2 / (length + 1);

  for (let index = warmStart; index <= last; index += 1) {
    const candle = candles[index]!;
    let value = Number.NaN;
    if (kind === "EMA") {
      ema = ema == null ? candle.close : alpha * candle.close + (1 - alpha) * ema;
      value = ema;
    } else if (index + 1 >= length) {
      let total = 0;
      for (let cursor = index - length + 1; cursor <= index; cursor += 1) total += candles[cursor]!.close;
      value = total / length;
    }

    if (index >= first && Number.isFinite(value)) points.push({ price: value, time: candle.time as Time });
  }

  return points;
}

function vwapPoints(candles: MappedCandle[], start: number, end: number): StructurePath["points"] {
  const first = clamp(Math.floor(start), 0, candles.length - 1);
  const last = clamp(Math.floor(end), first, candles.length - 1);
  const points: StructurePath["points"] = [];
  let volumeTotal = 0;
  let priceVolumeTotal = 0;

  for (let index = first; index <= last; index += 1) {
    const candle = candles[index]!;
    const volume = Math.max(1, candle.source.volume ?? 1);
    const typical = (candle.high + candle.low + candle.close) / 3;
    volumeTotal += volume;
    priceVolumeTotal += typical * volume;
    points.push({ price: priceVolumeTotal / volumeTotal, time: candle.time as Time });
  }

  return points;
}

function nearestPathPrice(points: StructurePath["points"], time: Time): number | null {
  if (!points.length) return null;
  const target = Number(time);
  let best = points[0]!;
  let bestDistance = Infinity;
  for (const point of points) {
    const distance = Math.abs(Number(point.time) - target);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best.price;
}

function pivotIndices(candles: MappedCandle[], start: number, end: number, kind: "high" | "low"): number[] {
  const result: number[] = [];
  for (let index = Math.max(2, start); index <= Math.min(candles.length - 3, end); index += 1) {
    if (kind === "high" ? pivotHigh(candles, index) : pivotLow(candles, index)) result.push(index);
  }
  return result;
}

function findLiquiditySweep(
  candles: MappedCandle[],
  start: number,
  end: number,
  lookback: number,
  direction: number
): { extreme: number; index: number; level: number; rangeStart: number } | null {
  const first = Math.max(lookback + 1, start);
  const last = Math.min(candles.length - 1, end);
  let best: { extreme: number; index: number; level: number; rangeStart: number } | null = null;

  for (let index = first; index <= last; index += 1) {
    const rangeStart = Math.max(0, index - lookback);
    const range = rangeHighLow(candles, rangeStart, index - 1);
    const candle = candles[index]!;
    if (!range) continue;

    if (direction === -1 && candle.high > range.high && candle.close < range.high) {
      if (!best || candle.high > best.extreme) best = { extreme: candle.high, index, level: range.high, rangeStart };
    }
    if (direction === 1 && candle.low < range.low && candle.close > range.low) {
      if (!best || candle.low < best.extreme) best = { extreme: candle.low, index, level: range.low, rangeStart };
    }
  }

  return best;
}

function findFairValueGap(
  candles: MappedCandle[],
  start: number,
  end: number,
  direction: number,
  minimumGap: number
): { endIndex: number; high: number; low: number; startIndex: number } | null {
  for (let index = Math.max(2, start); index <= Math.min(candles.length - 1, end); index += 1) {
    const left = candles[index - 2]!;
    const candle = candles[index]!;
    if (direction === 1 && candle.low > left.high + minimumGap) {
      return { endIndex: index, high: candle.low, low: left.high, startIndex: index - 2 };
    }
    if (direction === -1 && candle.high < left.low - minimumGap) {
      return { endIndex: index, high: left.low, low: candle.high, startIndex: index - 2 };
    }
  }

  return null;
}

function addOpeningRangeVisuals(
  visuals: StrategyStructureVisuals,
  snapshot: TradeVisualSnapshot,
  candles: MappedCandle[],
  currentPosition: number,
  entryPosition: number,
  dataTimeframe: TradeChartTimeframe,
  withRetest: boolean
): void {
  const direction = snapshot.trade.side === "long" ? 1 : -1;
  const rangeMinutes = variantNumber(snapshot.trade.variantId, "range", 15);
  const openingRange = openingRangeIndices(candles, entryPosition, snapshot.trade.variantId, rangeMinutes, dataTimeframe);
  if (!openingRange || currentPosition < openingRange.start) return;

  const visibleRangeEnd = Math.min(openingRange.end, currentPosition);
  const partialRange = rangeHighLow(candles, openingRange.start, visibleRangeEnd);
  const fullRange = rangeHighLow(candles, openingRange.start, openingRange.end);
  if (!partialRange || !fullRange) return;

  const tone = structureToneForDirection(direction);
  const averageRange = Math.max(averageCandleRange(candles, openingRange.start, Math.max(openingRange.end, entryPosition)), Math.abs(snapshot.trade.entryPrice) * 0.0001, 0.01);
  const structureEnd = tradeStructureEndTime(snapshot, candles, currentPosition, entryPosition, chartBarsFromMinutes(90, dataTimeframe));
  visuals.boxes.push({
    border: "solid",
    endTime: candleTime(candles, visibleRangeEnd),
    high: partialRange.high,
    label: "Opening Range",
    low: partialRange.low,
    startTime: candleTime(candles, openingRange.start),
    tone: "info"
  });

  if (currentPosition < openingRange.end) return;

  visuals.lines.push({
    endTime: structureEnd,
    label: "",
    price: fullRange.high,
    startTime: candleTime(candles, openingRange.start),
    tone: "info",
    width: 1.25
  });
  visuals.lines.push({
    endTime: structureEnd,
    label: "",
    price: fullRange.low,
    startTime: candleTime(candles, openingRange.start),
    tone: "info",
    width: 1.25
  });

  const level = direction === 1 ? fullRange.high : fullRange.low;
  const breakoutIndex = findBreakoutIndex(candles, openingRange.end + 1, Math.min(currentPosition, Math.max(entryPosition, openingRange.end + 1)), level, direction);
  if (breakoutIndex == null) return;

  const breakoutCandle = candles[breakoutIndex]!;
  const band = averageRange * 0.22;
  visuals.boxes.push({
    border: "dashed",
    endTime: withRetest ? structureEnd : candleTime(candles, breakoutIndex),
    high: direction === 1 ? level + band : level,
    label: withRetest ? "Retest Zone" : "Breakout Threshold",
    low: direction === 1 ? level : level - band,
    startTime: candleTime(candles, openingRange.end),
    tone
  });
  visuals.segments.push({
    arrow: true,
    endPrice: breakoutCandle.close,
    endTime: breakoutCandle.time as Time,
    label: "Breakout Close",
    startPrice: level,
    startTime: candleTime(candles, openingRange.end),
    tone,
    width: 2
  });

  if (withRetest && currentPosition >= entryPosition) {
    visuals.tags.push({
      label: direction === 1 ? "Retest Hold" : "Retest Reject",
      position: structureTagPositionForDirection(direction),
      price: direction === 1 ? candles[entryPosition]!.low : candles[entryPosition]!.high,
      time: candleTime(candles, entryPosition),
      tone
    });
  }
}

function addSupportResistanceRetestVisuals(
  visuals: StrategyStructureVisuals,
  snapshot: TradeVisualSnapshot,
  candles: MappedCandle[],
  currentPosition: number,
  entryPosition: number,
  dataTimeframe: TradeChartTimeframe
): void {
  const direction = snapshot.trade.side === "long" ? 1 : -1;
  const lookbackBars = chartBarsFromStrategyBars(Math.max(12, variantNumber(snapshot.trade.variantId, "range", 48)), snapshot.trade, dataTimeframe);
  const retestBars = chartBarsFromMinutes(Math.max(30, variantNumber(snapshot.trade.variantId, "entry", 90)), dataTimeframe);
  const baseEnd = Math.max(0, entryPosition - retestBars);
  const baseStart = Math.max(0, baseEnd - lookbackBars + 1);
  if (currentPosition < baseStart) return;

  const baseRange = rangeHighLow(candles, baseStart, Math.min(baseEnd, currentPosition));
  if (!baseRange) return;

  const tone = structureToneForDirection(direction);
  const level = direction === 1 ? baseRange.high : baseRange.low;
  const averageRange = Math.max(averageCandleRange(candles, baseStart, entryPosition), Math.abs(snapshot.trade.entryPrice) * 0.0001, 0.01);
  const structureEnd = tradeStructureEndTime(snapshot, candles, currentPosition, entryPosition, retestBars);
  visuals.boxes.push({
    endTime: candleTime(candles, Math.min(baseEnd, currentPosition)),
    high: baseRange.high,
    label: "S/R Base",
    low: baseRange.low,
    startTime: candleTime(candles, baseStart),
    tone: "info"
  });
  visuals.lines.push({
    endTime: structureEnd,
    label: direction === 1 ? "Resistance Flip" : "Support Flip",
    price: level,
    startTime: candleTime(candles, baseStart),
    tone,
    width: 1.75
  });

  const breakoutIndex = findBreakoutIndex(candles, baseEnd + 1, Math.min(currentPosition, entryPosition), level, direction);
  if (breakoutIndex != null) {
    visuals.segments.push({
      arrow: true,
      endPrice: candles[breakoutIndex]!.close,
      endTime: candleTime(candles, breakoutIndex),
      label: "Break",
      startPrice: level,
      startTime: candleTime(candles, baseEnd),
      tone,
      width: 2
    });
  }

  const retestHalfHeight = averageRange * 0.18;
  visuals.boxes.push({
    border: "dashed",
    endTime: structureEnd,
    high: level + retestHalfHeight,
    label: "Retest Zone",
    low: level - retestHalfHeight,
    startTime: candleTime(candles, Math.min(currentPosition, Math.max(baseEnd, breakoutIndex ?? baseEnd))),
    tone
  });
  if (currentPosition >= entryPosition) {
    visuals.tags.push({
      label: "Retest",
      position: structureTagPositionForDirection(direction),
      price: direction === 1 ? candles[entryPosition]!.low : candles[entryPosition]!.high,
      time: candleTime(candles, entryPosition),
      tone
    });
  }
}

function addTrendlineBreakVisuals(
  visuals: StrategyStructureVisuals,
  snapshot: TradeVisualSnapshot,
  candles: MappedCandle[],
  currentPosition: number,
  entryPosition: number,
  dataTimeframe: TradeChartTimeframe
): void {
  const direction = snapshot.trade.side === "long" ? 1 : -1;
  const lookbackBars = chartBarsFromStrategyBars(Math.max(48, variantNumber(snapshot.trade.variantId, "range", 96)), snapshot.trade, dataTimeframe);
  const start = Math.max(2, entryPosition - lookbackBars);
  const end = Math.max(start + 1, Math.min(entryPosition - 1, currentPosition));
  if (currentPosition < start || end <= start) return;

  const pivotKind = direction === 1 ? "high" : "low";
  const pivots = pivotIndices(candles, start, end, pivotKind);
  let firstPivot = pivots[pivots.length - 2] ?? null;
  let secondPivot = pivots[pivots.length - 1] ?? null;
  if (firstPivot == null || secondPivot == null || firstPivot === secondPivot) {
    const midpoint = Math.max(start + 1, Math.floor((start + end) / 2));
    firstPivot = direction === 1 ? highestIndex(candles, start, midpoint) : lowestIndex(candles, start, midpoint);
    secondPivot = direction === 1 ? highestIndex(candles, midpoint, end) : lowestIndex(candles, midpoint, end);
  }
  if (firstPivot === secondPivot) return;

  const firstPrice = direction === 1 ? candles[firstPivot]!.high : candles[firstPivot]!.low;
  const secondPrice = direction === 1 ? candles[secondPivot]!.high : candles[secondPivot]!.low;
  const lineEndPosition = Math.min(currentPosition, Math.max(entryPosition, secondPivot + chartBarsFromStrategyBars(12, snapshot.trade, dataTimeframe)));
  const lineEndPrice = lineValueAtIndex(firstPivot, firstPrice, secondPivot, secondPrice, lineEndPosition);
  const tone = structureToneForDirection(direction);
  visuals.segments.push({
    endPrice: lineEndPrice,
    endTime: candleTime(candles, lineEndPosition),
    label: direction === 1 ? "Descending Trendline" : "Ascending Trendline",
    startPrice: firstPrice,
    startTime: candleTime(candles, firstPivot),
    tone: "info",
    width: 1.75
  });
  visuals.tags.push({
    label: direction === 1 ? "LH" : "HL",
    position: direction === 1 ? "above" : "below",
    price: secondPrice,
    time: candleTime(candles, secondPivot),
    tone: "neutral"
  });

  if (currentPosition >= entryPosition) {
    const entryLinePrice = lineValueAtIndex(firstPivot, firstPrice, secondPivot, secondPrice, entryPosition);
    visuals.segments.push({
      arrow: true,
      endPrice: candles[entryPosition]!.close,
      endTime: candleTime(candles, entryPosition),
      label: "Trendline Break",
      startPrice: entryLinePrice,
      startTime: candleTime(candles, entryPosition),
      tone,
      width: 2.25
    });
  }
}

function addMovingAveragePullbackVisuals(
  visuals: StrategyStructureVisuals,
  snapshot: TradeVisualSnapshot,
  candles: MappedCandle[],
  currentPosition: number,
  entryPosition: number,
  dataTimeframe: TradeChartTimeframe,
  touchMode = false
): void {
  const direction = snapshot.trade.side === "long" ? 1 : -1;
  const tone = structureToneForDirection(direction);
  const start = Math.max(0, entryPosition - chartBarsFromStrategyBars(96, snapshot.trade, dataTimeframe));
  const end = Math.max(start, currentPosition);
  const primaryAverage = touchMode
    ? averageParts(variantValue(snapshot.trade.variantId, "ma"), "SMA20")
    : { kind: "EMA" as const, length: 21 };
  const primaryPoints = movingAveragePoints(candles, start, end, primaryAverage.kind, primaryAverage.length);
  if (primaryPoints.length) {
    visuals.paths.push({
      label: `${primaryAverage.kind}${primaryAverage.length}`,
      points: primaryPoints,
      tone: "info",
      width: 1.8
    });
  }

  if (!touchMode) {
    const signalPoints = movingAveragePoints(candles, start, end, "EMA", 9);
    const trendPoints = movingAveragePoints(candles, start, end, "EMA", 50);
    if (signalPoints.length) visuals.paths.push({ label: "EMA9", points: signalPoints, tone, width: 1.25 });
    if (trendPoints.length) visuals.paths.push({ label: "EMA50", points: trendPoints, style: "dashed", tone: "neutral", width: 1.1 });
  }

  const anchorPrice = nearestPathPrice(primaryPoints, candleTime(candles, Math.min(entryPosition, currentPosition)));
  if (anchorPrice == null) return;

  const averageRange = Math.max(averageCandleRange(candles, Math.max(0, entryPosition - 32), entryPosition), Math.abs(snapshot.trade.entryPrice) * 0.0001, 0.01);
  const structureEnd = tradeStructureEndTime(snapshot, candles, currentPosition, entryPosition, chartBarsFromStrategyBars(20, snapshot.trade, dataTimeframe));
  visuals.boxes.push({
    border: "dashed",
    endTime: structureEnd,
    high: anchorPrice + averageRange * 0.16,
    label: touchMode ? "MA Touch Zone" : `${primaryAverage.kind}${primaryAverage.length} Pullback`,
    low: anchorPrice - averageRange * 0.16,
    startTime: candleTime(candles, Math.max(start, entryPosition - chartBarsFromStrategyBars(8, snapshot.trade, dataTimeframe))),
    tone
  });

  if (currentPosition >= entryPosition) {
    visuals.tags.push({
      label: touchMode ? "MA Touch" : direction === 1 ? "Reclaim EMA9" : "Reject EMA9",
      position: structureTagPositionForDirection(direction),
      price: direction === 1 ? candles[entryPosition]!.low : candles[entryPosition]!.high,
      time: candleTime(candles, entryPosition),
      tone
    });
  }
}

function addMovingAverageCrossoverVisuals(
  visuals: StrategyStructureVisuals,
  snapshot: TradeVisualSnapshot,
  candles: MappedCandle[],
  currentPosition: number,
  entryPosition: number,
  dataTimeframe: TradeChartTimeframe
): void {
  const direction = snapshot.trade.side === "long" ? 1 : -1;
  const fast = averageParts(variantValue(snapshot.trade.variantId, "fast"), "SMA50");
  const slow = averageParts(variantValue(snapshot.trade.variantId, "slow"), "SMA200");
  const start = Math.max(0, entryPosition - chartBarsFromStrategyBars(Math.max(slow.length, 100), snapshot.trade, dataTimeframe));
  const end = Math.max(start, currentPosition);
  const fastPoints = movingAveragePoints(candles, start, end, fast.kind, fast.length);
  const slowPoints = movingAveragePoints(candles, start, end, slow.kind, slow.length);
  const tone = structureToneForDirection(direction);
  if (fastPoints.length) visuals.paths.push({ label: `${fast.kind}${fast.length}`, points: fastPoints, tone, width: 1.6 });
  if (slowPoints.length) visuals.paths.push({ label: `${slow.kind}${slow.length}`, points: slowPoints, style: "dashed", tone: "neutral", width: 1.35 });
  if (currentPosition >= entryPosition) {
    visuals.tags.push({
      label: direction === 1 ? "Bull Cross" : "Bear Cross",
      position: structureTagPositionForDirection(direction),
      price: candles[entryPosition]!.close,
      time: candleTime(candles, entryPosition),
      tone
    });
  }
}

function addVwapPullbackVisuals(
  visuals: StrategyStructureVisuals,
  snapshot: TradeVisualSnapshot,
  candles: MappedCandle[],
  currentPosition: number,
  entryPosition: number,
  dataTimeframe: TradeChartTimeframe
): void {
  const direction = snapshot.trade.side === "long" ? 1 : -1;
  const sessionStart = sessionStartIndex(candles, entryPosition, snapshot.trade.variantId);
  const start = Math.max(0, Math.min(sessionStart, entryPosition - chartBarsFromMinutes(90, dataTimeframe)));
  const end = Math.max(start, currentPosition);
  const points = vwapPoints(candles, start, end);
  const tone = structureToneForDirection(direction);
  if (points.length) visuals.paths.push({ label: "VWAP", points, tone: "info", width: 2 });

  const vwapAtEntry = nearestPathPrice(points, candleTime(candles, Math.min(entryPosition, currentPosition)));
  if (vwapAtEntry == null) return;
  const averageRange = Math.max(averageCandleRange(candles, Math.max(0, entryPosition - 30), entryPosition), Math.abs(snapshot.trade.entryPrice) * 0.0001, 0.01);
  const structureEnd = tradeStructureEndTime(snapshot, candles, currentPosition, entryPosition, chartBarsFromMinutes(90, dataTimeframe));
  visuals.boxes.push({
    border: "dashed",
    endTime: structureEnd,
    high: vwapAtEntry + averageRange * 0.18,
    label: "VWAP Pullback",
    low: vwapAtEntry - averageRange * 0.18,
    startTime: candleTime(candles, Math.max(start, entryPosition - chartBarsFromMinutes(45, dataTimeframe))),
    tone
  });

  if (entryPosition > start) {
    const driveIndex = Math.max(start, entryPosition - chartBarsFromMinutes(30, dataTimeframe));
    visuals.segments.push({
      arrow: true,
      endPrice: candles[entryPosition]!.close,
      endTime: candleTime(candles, entryPosition),
      label: direction === 1 ? "VWAP Reclaim" : "VWAP Reject",
      startPrice: candles[driveIndex]!.close,
      startTime: candleTime(candles, driveIndex),
      tone,
      width: 2
    });
  }
}

function addLiquiditySweepVisuals(
  visuals: StrategyStructureVisuals,
  snapshot: TradeVisualSnapshot,
  candles: MappedCandle[],
  currentPosition: number,
  entryPosition: number,
  dataTimeframe: TradeChartTimeframe,
  ictMode = false
): void {
  const direction = snapshot.trade.side === "long" ? 1 : -1;
  const signalPosition = candleIndex(candles, snapshot.signalCandle);
  const lookback = chartBarsFromStrategyBars(ictMode ? 24 : 20, snapshot.trade, dataTimeframe);
  const searchStart = Math.max(2, signalPosition - chartBarsFromStrategyBars(ictMode ? 12 : 28, snapshot.trade, dataTimeframe));
  const searchEnd = Math.min(currentPosition, Math.max(signalPosition, entryPosition));
  const sweep = findLiquiditySweep(candles, searchStart, searchEnd, lookback, direction);
  const tone = structureToneForDirection(direction);
  const structureEnd = tradeStructureEndTime(snapshot, candles, currentPosition, entryPosition, chartBarsFromStrategyBars(32, snapshot.trade, dataTimeframe));

  if (sweep && currentPosition >= sweep.index) {
    const sweepCandle = candles[sweep.index]!;
    visuals.lines.push({
      endTime: structureEnd,
      label: direction === 1 ? "Sell-Side Liquidity" : "Buy-Side Liquidity",
      price: sweep.level,
      startTime: candleTime(candles, sweep.rangeStart),
      style: "dashed",
      tone: "warning",
      width: 1.4
    });
    visuals.boxes.push({
      border: "solid",
      endTime: candleTime(candles, Math.min(candles.length - 1, sweep.index + 1)),
      high: Math.max(sweep.level, sweep.extreme),
      label: "Sweep Wick",
      low: Math.min(sweep.level, sweep.extreme),
      startTime: sweepCandle.time as Time,
      tone: "warning"
    });
    visuals.segments.push({
      arrow: true,
      endPrice: sweepCandle.close,
      endTime: sweepCandle.time as Time,
      label: direction === 1 ? "Reclaim" : "Reject",
      startPrice: sweep.extreme,
      startTime: sweepCandle.time as Time,
      tone,
      width: 2
    });
    visuals.tags.push({
      label: "Sweep",
      position: direction === 1 ? "below" : "above",
      price: sweep.extreme,
      time: sweepCandle.time as Time,
      tone: "warning"
    });
  }

  if (!ictMode) return;

  const averageRange = Math.max(averageCandleRange(candles, Math.max(0, signalPosition - 20), Math.max(signalPosition, entryPosition)), Math.abs(snapshot.trade.entryPrice) * 0.0001, 0.01);
  const fvg = findFairValueGap(candles, Math.max(2, signalPosition - chartBarsFromStrategyBars(8, snapshot.trade, dataTimeframe)), Math.min(currentPosition, Math.max(signalPosition, entryPosition)), direction, averageRange * 0.04);
  if (fvg) {
    const fvgEndTime = currentPosition >= entryPosition
      ? candleTime(candles, entryPosition)
      : tradeStructureEndTime(snapshot, candles, currentPosition, entryPosition, chartBarsFromStrategyBars(12, snapshot.trade, dataTimeframe));
    visuals.boxes.push({
      border: "solid",
      endTime: fvgEndTime,
      high: fvg.high,
      label: "FVG",
      low: fvg.low,
      startTime: candleTime(candles, fvg.startIndex),
      tone
    });
    if (sweep) {
      visuals.segments.push({
        arrow: true,
        endPrice: candles[fvg.endIndex]!.close,
        endTime: candleTime(candles, fvg.endIndex),
        label: "Displacement",
        startPrice: sweep.extreme,
        startTime: candleTime(candles, sweep.index),
        tone,
        width: 2.25
      });
    }
  }
}

function addOrderBlockBreakoutVisuals(
  visuals: StrategyStructureVisuals,
  snapshot: TradeVisualSnapshot,
  candles: MappedCandle[],
  currentPosition: number,
  entryPosition: number,
  dataTimeframe: TradeChartTimeframe
): void {
  const direction = snapshot.trade.side === "long" ? 1 : -1;
  const scanStart = Math.max(0, entryPosition - chartBarsFromStrategyBars(36, snapshot.trade, dataTimeframe));
  const scanEnd = Math.min(currentPosition, Math.max(0, entryPosition - 1));
  const averageRange = Math.max(averageCandleRange(candles, scanStart, Math.max(scanStart, entryPosition)), Math.abs(snapshot.trade.entryPrice) * 0.0001, 0.01);
  let orderBlockIndex: number | null = null;
  let displacementIndex: number | null = null;

  for (let index = scanEnd; index >= scanStart; index -= 1) {
    const candle = candles[index]!;
    const oppositeCandle = direction === 1 ? candle.close < candle.open : candle.close > candle.open;
    if (!oppositeCandle) continue;
    for (let cursor = index + 1; cursor <= Math.min(candles.length - 1, index + chartBarsFromStrategyBars(6, snapshot.trade, dataTimeframe), currentPosition); cursor += 1) {
      const impulse = candles[cursor]!;
      const displaced = direction === 1
        ? impulse.close > candle.high + averageRange * 0.18
        : impulse.close < candle.low - averageRange * 0.18;
      if (displaced) {
        orderBlockIndex = index;
        displacementIndex = cursor;
        break;
      }
    }
    if (orderBlockIndex != null) break;
  }

  if (orderBlockIndex == null) return;
  const block = candles[orderBlockIndex]!;
  const triggerPrice = direction === 1 ? block.high : block.low;
  const tone = structureToneForDirection(direction);
  const structureEnd = tradeStructureEndTime(snapshot, candles, currentPosition, entryPosition, chartBarsFromStrategyBars(32, snapshot.trade, dataTimeframe));
  visuals.boxes.push({
    border: "solid",
    endTime: structureEnd,
    high: block.high,
    label: direction === 1 ? "Bullish Order Block" : "Bearish Order Block",
    low: block.low,
    startTime: block.time as Time,
    tone
  });
  visuals.lines.push({
    endTime: structureEnd,
    label: "OB Break Level",
    price: triggerPrice,
    startTime: block.time as Time,
    tone,
    width: 1.5
  });
  if (displacementIndex != null) {
    visuals.segments.push({
      arrow: true,
      endPrice: candles[displacementIndex]!.close,
      endTime: candleTime(candles, displacementIndex),
      label: "OB Breakout Close",
      startPrice: triggerPrice,
      startTime: block.time as Time,
      tone,
      width: 2.25
    });
  }
}

function addParabolicFadeVisuals(
  visuals: StrategyStructureVisuals,
  snapshot: TradeVisualSnapshot,
  candles: MappedCandle[],
  currentPosition: number,
  entryPosition: number,
  dataTimeframe: TradeChartTimeframe
): void {
  const direction = snapshot.trade.side === "long" ? 1 : -1;
  const lookback = chartBarsFromStrategyBars(18, snapshot.trade, dataTimeframe);
  const start = Math.max(0, entryPosition - lookback);
  const runStart = direction === 1 ? highestIndex(candles, start, entryPosition) : lowestIndex(candles, start, entryPosition);
  const extreme = direction === 1 ? lowestIndex(candles, runStart, entryPosition) : highestIndex(candles, runStart, entryPosition);
  const tone = structureToneForDirection(direction);
  const structureEnd = tradeStructureEndTime(snapshot, candles, currentPosition, entryPosition, chartBarsFromStrategyBars(12, snapshot.trade, dataTimeframe));
  visuals.segments.push({
    arrow: true,
    endPrice: direction === 1 ? candles[extreme]!.low : candles[extreme]!.high,
    endTime: candleTime(candles, extreme),
    label: "Parabolic Extension",
    startPrice: candles[runStart]!.close,
    startTime: candleTime(candles, runStart),
    tone: "warning",
    width: 2
  });
  visuals.boxes.push({
    border: "dashed",
    endTime: structureEnd,
    high: direction === 1 ? candles[entryPosition]!.close : candles[extreme]!.high,
    label: "Fade Zone",
    low: direction === 1 ? candles[extreme]!.low : candles[entryPosition]!.close,
    startTime: candleTime(candles, Math.max(start, entryPosition - chartBarsFromStrategyBars(4, snapshot.trade, dataTimeframe))),
    tone
  });
  if (currentPosition >= entryPosition) {
    visuals.tags.push({
      label: "Fade Trigger",
      position: structureTagPositionForDirection(direction),
      price: direction === 1 ? candles[entryPosition]!.low : candles[entryPosition]!.high,
      time: candleTime(candles, entryPosition),
      tone
    });
  }
}

function addRangeEdgeVisuals(
  visuals: StrategyStructureVisuals,
  snapshot: TradeVisualSnapshot,
  candles: MappedCandle[],
  currentPosition: number,
  entryPosition: number,
  dataTimeframe: TradeChartTimeframe,
  decileMode = false
): void {
  const direction = snapshot.trade.side === "long" ? 1 : -1;
  const rangeBars = chartBarsFromStrategyBars(Math.max(5, variantNumber(snapshot.trade.variantId, "range", 96)), snapshot.trade, dataTimeframe);
  const buckets = Math.max(5, variantNumber(snapshot.trade.variantId, "buckets", decileMode ? 10 : 20));
  const start = Math.max(0, entryPosition - rangeBars + 1);
  const end = Math.min(currentPosition, entryPosition);
  const range = rangeHighLow(candles, start, end);
  if (!range) return;

  const span = range.high - range.low;
  const position = clamp((candles[Math.min(entryPosition, currentPosition)]!.close - range.low) / span, 0, 0.999);
  const bucket = Math.floor(position * buckets);
  const bucketLow = range.low + (span / buckets) * bucket;
  const bucketHigh = range.low + (span / buckets) * (bucket + 1);
  const tone = structureToneForDirection(direction);
  const structureEnd = tradeStructureEndTime(snapshot, candles, currentPosition, entryPosition, chartBarsFromStrategyBars(24, snapshot.trade, dataTimeframe));
  visuals.boxes.push({
    endTime: candleTime(candles, end),
    high: range.high,
    label: "Study Range",
    low: range.low,
    startTime: candleTime(candles, start),
    tone: "info"
  });
  visuals.boxes.push({
    border: "solid",
    endTime: structureEnd,
    high: bucketHigh,
    label: decileMode ? `Decile ${bucket + 1}` : "Percentile Edge",
    low: bucketLow,
    startTime: candleTime(candles, Math.max(start, entryPosition - chartBarsFromStrategyBars(8, snapshot.trade, dataTimeframe))),
    tone
  });
}

function addImpulseVisuals(
  visuals: StrategyStructureVisuals,
  snapshot: TradeVisualSnapshot,
  candles: MappedCandle[],
  currentPosition: number,
  entryPosition: number,
  dataTimeframe: TradeChartTimeframe,
  meanReversion = false
): void {
  const direction = snapshot.trade.side === "long" ? 1 : -1;
  const start = Math.max(0, entryPosition - chartBarsFromStrategyBars(120, snapshot.trade, dataTimeframe));
  const end = Math.max(start, currentPosition);
  const ema30 = movingAveragePoints(candles, start, end, "EMA", 30);
  const ema200 = movingAveragePoints(candles, start, end, "EMA", 200);
  const tone = structureToneForDirection(direction);
  if (ema30.length) visuals.paths.push({ label: "EMA30", points: ema30, tone: "info", width: 1.45 });
  if (ema200.length) visuals.paths.push({ label: "EMA200", points: ema200, style: "dashed", tone: "neutral", width: 1.2 });

  const signalStart = Math.max(start, entryPosition - chartBarsFromStrategyBars(5, snapshot.trade, dataTimeframe));
  visuals.segments.push({
    arrow: true,
    endPrice: candles[entryPosition]!.close,
    endTime: candleTime(candles, entryPosition),
    label: meanReversion ? "Exhaustion Move" : "Signal Move",
    startPrice: candles[signalStart]!.close,
    startTime: candleTime(candles, signalStart),
    tone: meanReversion ? "warning" : tone,
    width: 2
  });
  if (meanReversion) {
    const range = rangeHighLow(candles, signalStart, entryPosition);
    if (range) {
      visuals.boxes.push({
        border: "dashed",
        endTime: tradeStructureEndTime(snapshot, candles, currentPosition, entryPosition, chartBarsFromStrategyBars(12, snapshot.trade, dataTimeframe)),
        high: range.high,
        label: "Reversion Stretch",
        low: range.low,
        startTime: candleTime(candles, signalStart),
        tone: "warning"
      });
    }
  }
}

function finalizeStructureVisuals(visuals: StrategyStructureVisuals): StrategyStructureVisuals {
  return {
    boxes: visuals.boxes.slice(-7),
    lines: visuals.lines.slice(-8),
    paths: visuals.paths.slice(-4).map((path) => ({ ...path, points: path.points.slice(-220) })),
    segments: visuals.segments.slice(-8),
    tags: visuals.tags.slice(-10)
  };
}

function strategyStructureVisuals(
  snapshot: TradeVisualSnapshot,
  candles: MappedCandle[],
  enabled: boolean,
  dataTimeframe: TradeChartTimeframe
): StrategyStructureVisuals {
  if (!enabled || !snapshot.currentReplayCandle || !candles.length) return emptyStructureVisuals();

  const visuals = emptyStructureVisuals();
  const phase = (snapshot.trade.phase ?? "").toLowerCase();
  const fingerprint = strategyFingerprint(snapshot.trade);
  const currentPosition = candleIndex(candles, snapshot.currentReplayCandle);
  const entryPosition = candleIndex(candles, snapshot.entryCandle);
  if (entryPosition < 0 || currentPosition < 0) return emptyStructureVisuals();

  if (strategyUsesOrderBlock(snapshot.trade)) {
    addOrderBlockBreakoutVisuals(visuals, snapshot, candles, currentPosition, entryPosition, dataTimeframe);
    return finalizeStructureVisuals(visuals);
  }

  if (phase === "reddit_orb_retest" || fingerprint.includes("orb retest")) {
    addOpeningRangeVisuals(visuals, snapshot, candles, currentPosition, entryPosition, dataTimeframe, true);
  } else if (phase === "reddit_orb_breakout" || fingerprint.includes("orb breakout") || fingerprint.includes("opening_drive")) {
    addOpeningRangeVisuals(visuals, snapshot, candles, currentPosition, entryPosition, dataTimeframe, false);
  } else if (phase === "support_resistance_retest" || fingerprint.includes("support resistance") || fingerprint.includes("claytrader")) {
    addSupportResistanceRetestVisuals(visuals, snapshot, candles, currentPosition, entryPosition, dataTimeframe);
  } else if (phase === "trendline_break" || phase === "tori_trendline_mtf" || fingerprint.includes("trendline")) {
    addTrendlineBreakVisuals(visuals, snapshot, candles, currentPosition, entryPosition, dataTimeframe);
  } else if (phase === "vwap_pullback" || fingerprint.includes("vwap")) {
    addVwapPullbackVisuals(visuals, snapshot, candles, currentPosition, entryPosition, dataTimeframe);
  } else if (phase === "moving_average_touch" || fingerprint.includes("support bounce")) {
    addMovingAveragePullbackVisuals(visuals, snapshot, candles, currentPosition, entryPosition, dataTimeframe, true);
  } else if (phase === "moving_average_crossover" || fingerprint.includes("sma50/sma200") || fingerprint.includes("cross")) {
    addMovingAverageCrossoverVisuals(visuals, snapshot, candles, currentPosition, entryPosition, dataTimeframe);
  } else if (phase === "reddit_ema_pullback" || phase === "ma_pullback" || phase === "ema_rider" || fingerprint.includes("ema pullback")) {
    addMovingAveragePullbackVisuals(visuals, snapshot, candles, currentPosition, entryPosition, dataTimeframe);
  } else if (phase === "ict_sweep_fvg" || fingerprint.includes("ict sweep fvg")) {
    addLiquiditySweepVisuals(visuals, snapshot, candles, currentPosition, entryPosition, dataTimeframe, true);
  } else if (phase === "ict_turtle_soup" || phase === "ny_sweep_playbook" || fingerprint.includes("turtle soup") || fingerprint.includes("ny sweep")) {
    addLiquiditySweepVisuals(visuals, snapshot, candles, currentPosition, entryPosition, dataTimeframe);
  } else if (phase === "parabolic_fade" || fingerprint.includes("parabolic")) {
    addParabolicFadeVisuals(visuals, snapshot, candles, currentPosition, entryPosition, dataTimeframe);
  } else if (phase === "percentile_range_study" || fingerprint.includes("percentile range")) {
    addRangeEdgeVisuals(visuals, snapshot, candles, currentPosition, entryPosition, dataTimeframe);
  } else if (phase === "decile_forward_edge" || fingerprint.includes("decile forward")) {
    addRangeEdgeVisuals(visuals, snapshot, candles, currentPosition, entryPosition, dataTimeframe, true);
  } else if (phase === "mean_reversion" || phase === "reddit_capitulation_reversion" || fingerprint.includes("capitulation") || fingerprint.includes("reversion")) {
    addImpulseVisuals(visuals, snapshot, candles, currentPosition, entryPosition, dataTimeframe, true);
  } else if (phase === "momentum" || fingerprint.includes("momentum")) {
    addImpulseVisuals(visuals, snapshot, candles, currentPosition, entryPosition, dataTimeframe);
  }

  return finalizeStructureVisuals(visuals);
}

function strategyVisualMarkers(_snapshot: TradeVisualSnapshot, _candles: MappedCandle[], _enabled: boolean): SeriesMarker<Time>[] {
  return [];
}

type ChartPositionOverlayState = {
  candles: MappedCandle[];
  dataTimeframe: TradeChartTimeframe;
  selectingReplayStart: boolean;
  selectionCandle: MappedCandle | null;
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
  if (tone === "info") {
    return { fill: "rgba(56, 189, 248, 0.11)", stroke: "rgba(125, 211, 252, 0.68)", text: "#7dd3fc" };
  }

  return { fill: "rgba(167, 139, 250, 0.13)", stroke: "rgba(167, 139, 250, 0.72)", text: "#a78bfa" };
}

function applyStructureDash(ctx: CanvasRenderingContext2D, style: StructureLineStyle | undefined): void {
  if (style === "dotted") {
    ctx.setLineDash([1, 5]);
  } else if (style === "solid") {
    ctx.setLineDash([]);
  } else {
    ctx.setLineDash([5, 4]);
  }
}

function drawArrowHead(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string): void {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 7;
  ctx.save();
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawStructureVisuals(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  series: CandleSeriesApi,
  size: { width: number; height: number },
  state: ChartPositionOverlayState
): void {
  const { candles, dataTimeframe, structureVisuals } = state;
  if (
    !structureVisuals.boxes.length &&
    !structureVisuals.lines.length &&
    !structureVisuals.paths.length &&
    !structureVisuals.segments.length &&
    !structureVisuals.tags.length
  ) {
    return;
  }

  ctx.save();
  for (const box of structureVisuals.boxes) {
    const x1 = structureXForTime(chart, candles, box.startTime, dataTimeframe, size.width);
    const x2 = structureXForTime(chart, candles, box.endTime, dataTimeframe, size.width);
    const yHigh = series.priceToCoordinate(box.high);
    const yLow = series.priceToCoordinate(box.low);
    if (
      !coordinateIsVisible(x1) ||
      !coordinateIsVisible(x2) ||
      !coordinateIsVisible(yHigh) ||
      !coordinateIsVisible(yLow) ||
      !coordinateRangeIntersectsPane(x1, x2, size.width) ||
      !coordinateRangeIntersectsPane(yHigh, yLow, size.height)
    ) {
      continue;
    }

    const colors = structureColor(box.tone);
    const x = clamp(Math.min(x1, x2), 0, size.width);
    const xEnd = clamp(Math.max(x1, x2), 0, size.width);
    const y = clamp(Math.min(yHigh, yLow), 0, size.height);
    const yEnd = clamp(Math.max(yHigh, yLow), 0, size.height);
    const width = Math.max(8, xEnd - x);
    const height = Math.max(4, yEnd - y);

    ctx.fillStyle = colors.fill;
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = 1.25;
    applyStructureDash(ctx, box.border ?? "solid");
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);
    if (coordinateInPane(x + 6, size.width) && coordinateInPane(y + 12, size.height)) {
      drawOverlayText(ctx, box.label, clamp(x + 6, 6, size.width - 130), clamp(y + 12, 12, size.height - 8), colors.text);
    }
  }

  for (const line of structureVisuals.lines) {
    const x1 = structureXForTime(chart, candles, line.startTime, dataTimeframe, size.width);
    const x2 = structureXForTime(chart, candles, line.endTime, dataTimeframe, size.width);
    const y = series.priceToCoordinate(line.price);
    if (!coordinateIsVisible(x1) || !coordinateIsVisible(x2) || !coordinateInPane(y, size.height) || !coordinateRangeIntersectsPane(x1, x2, size.width)) {
      continue;
    }

    const colors = structureColor(line.tone);
    ctx.beginPath();
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = line.width ?? 1.5;
    applyStructureDash(ctx, line.style ?? "dashed");
    ctx.moveTo(clamp(x1, 0, size.width), y);
    ctx.lineTo(clamp(x2, 0, size.width), y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (line.label && coordinateInPane(Math.min(x1, x2) + 6, size.width) && coordinateInPane(y - 11, size.height)) {
      drawOverlayText(ctx, line.label, clamp(Math.min(x1, x2) + 6, 6, size.width - 130), y - 11, colors.text);
    }
  }

  for (const path of structureVisuals.paths) {
    if (path.points.length < 2) continue;
    const colors = structureColor(path.tone);
    ctx.beginPath();
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = path.width ?? 1.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    applyStructureDash(ctx, path.style ?? "solid");
    let hasStroke = false;
    let labelPoint: { x: number; y: number } | null = null;

    for (let index = 1; index < path.points.length; index += 1) {
      const previous = path.points[index - 1]!;
      const current = path.points[index]!;
      const x1 = structureXForTime(chart, candles, previous.time, dataTimeframe, size.width);
      const x2 = structureXForTime(chart, candles, current.time, dataTimeframe, size.width);
      const y1 = series.priceToCoordinate(previous.price);
      const y2 = series.priceToCoordinate(current.price);
      if (!coordinateIsVisible(x1) || !coordinateIsVisible(x2) || !coordinateIsVisible(y1) || !coordinateIsVisible(y2)) continue;
      if (!coordinateRangeIntersectsPane(x1, x2, size.width) || !coordinateRangeIntersectsPane(y1, y2, size.height)) continue;
      ctx.moveTo(clamp(x1, 0, size.width), clamp(y1, 0, size.height));
      ctx.lineTo(clamp(x2, 0, size.width), clamp(y2, 0, size.height));
      hasStroke = true;
      if (coordinateInPane(x2, size.width) && coordinateInPane(y2, size.height)) labelPoint = { x: x2, y: y2 };
    }

    if (hasStroke) ctx.stroke();
    ctx.setLineDash([]);
    if (labelPoint && coordinateInPane(labelPoint.x + 6, size.width) && coordinateInPane(labelPoint.y - 10, size.height)) {
      drawOverlayText(ctx, path.label, clamp(labelPoint.x + 6, 6, size.width - 110), labelPoint.y - 10, colors.text);
    }
  }

  for (const segment of structureVisuals.segments) {
    const x1 = structureXForTime(chart, candles, segment.startTime, dataTimeframe, size.width);
    const x2 = structureXForTime(chart, candles, segment.endTime, dataTimeframe, size.width);
    const y1 = series.priceToCoordinate(segment.startPrice);
    const y2 = series.priceToCoordinate(segment.endPrice);
    if (
      !coordinateIsVisible(x1) ||
      !coordinateIsVisible(x2) ||
      !coordinateIsVisible(y1) ||
      !coordinateIsVisible(y2) ||
      !coordinateRangeIntersectsPane(x1, x2, size.width) ||
      !coordinateRangeIntersectsPane(y1, y2, size.height)
    ) {
      continue;
    }

    const colors = structureColor(segment.tone);
    const drawX1 = clamp(x1, 0, size.width);
    const drawX2 = clamp(x2, 0, size.width);
    const drawY1 = clamp(y1, 0, size.height);
    const drawY2 = clamp(y2, 0, size.height);
    ctx.beginPath();
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = segment.width ?? 1.6;
    ctx.lineCap = "round";
    applyStructureDash(ctx, segment.style ?? "solid");
    ctx.moveTo(drawX1, drawY1);
    ctx.lineTo(drawX2, drawY2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (segment.arrow && coordinateInPane(x2, size.width) && coordinateInPane(y2, size.height)) {
      drawArrowHead(ctx, drawX1, drawY1, drawX2, drawY2, colors.text);
    }
    if (coordinateInPane(x2 + 6, size.width) && coordinateInPane(y2 - 11, size.height)) {
      drawOverlayText(ctx, segment.label, clamp(x2 + 6, 6, size.width - 140), y2 - 11, colors.text);
    }
  }

  for (const tag of structureVisuals.tags) {
    const x = structureXForTime(chart, candles, tag.time, dataTimeframe, size.width);
    const y = series.priceToCoordinate(tag.price);
    if (!coordinateInPane(x, size.width) || !coordinateInPane(y, size.height)) continue;

    const colors = structureColor(tag.tone);
    const markerY = y + (tag.position === "above" ? -10 : 10);
    if (!coordinateInPane(markerY, size.height, 4)) continue;
    ctx.beginPath();
    ctx.fillStyle = colors.text;
    ctx.arc(x, markerY, 3.5, 0, Math.PI * 2);
    ctx.fill();
    drawOverlayText(
      ctx,
      tag.label,
      x - 7,
      markerY + (tag.position === "above" ? -12 : 13),
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

function drawSelectionCursor(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  size: { width: number; height: number },
  state: ChartPositionOverlayState
): void {
  if (!state.selectingReplayStart || !state.selectionCandle) return;

  const x = structureXForTime(chart, state.candles, state.selectionCandle.time, state.dataTimeframe, size.width);
  if (!coordinateInPane(x, size.width, 20)) return;

  const clampedX = clamp(x, 0, size.width);
  const label = "Select replay start";
  const timeLabel = formatChartTime(state.selectionCandle.source.time);

  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = "rgba(56, 189, 248, 0.95)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.moveTo(clampedX, 0);
  ctx.lineTo(clampedX, size.height);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = '850 10px "Geist Mono", "SFMono-Regular", Consolas, monospace';
  const labelWidth = Math.max(ctx.measureText(label).width, ctx.measureText(timeLabel).width) + 18;
  const badgeWidth = Math.min(labelWidth, size.width - 12);
  const badgeX = clamp(clampedX + 8, 6, size.width - badgeWidth - 6);
  const badgeY = 8;
  ctx.fillStyle = "rgba(2, 6, 23, 0.9)";
  ctx.strokeStyle = "rgba(56, 189, 248, 0.72)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeWidth, 34, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#7dd3fc";
  ctx.textBaseline = "top";
  ctx.fillText(label.toUpperCase(), badgeX + 8, badgeY + 5, badgeWidth - 16);
  ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
  ctx.fillText(timeLabel.toUpperCase(), badgeX + 8, badgeY + 19, badgeWidth - 16);
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
      drawSelectionCursor(context, this.chart, mediaSize, this.state);
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
  const selectingReplayStartRef = useRef(false);
  const replaySeekByTimeRef = useRef<(time: number) => void>(() => undefined);
  const [activeBar, setActiveBar] = useState<TradeChartBar | null>(null);
  const [chartTheme, setChartTheme] = useState<ChartTheme>("dark");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSelectingReplayStart, setIsSelectingReplayStart] = useState(false);
  const [selectPreviewTime, setSelectPreviewTime] = useState<Time | null>(null);
  const [replayMode, setReplayMode] = useState<ReplayMode>("bar");
  const [showStrategyVisuals, setShowStrategyVisuals] = useState(false);
  const [replayPosition, setReplayPosition] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState<ReplaySpeed>(2);
  const mappedCandles = useMemo(() => mappedCandlesFromBars(bars), [bars]);
  const replayMappedCandles = useMemo(() => mappedCandlesFromBars(replayBars ?? []), [replayBars]);
  const effectiveDataTimeframe = dataTimeframe ?? timeframe;
  const sourceTimeframe = trade.sourceTimeframe ?? effectiveDataTimeframe;
  const strategyStructureTimeframe =
    timeframeSeconds(sourceTimeframe) > timeframeSeconds(effectiveDataTimeframe) ? sourceTimeframe : effectiveDataTimeframe;
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
  const selectionCandle = useMemo(
    () => (selectPreviewTime == null ? null : replayCandleForTime(mappedCandles, selectPreviewTime)),
    [mappedCandles, selectPreviewTime]
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
    () => firstBracketExitCandle(mappedCandles, trade, entryCandle, nearestMappedCandle(mappedCandles, trade.exitIndex, trade.exitTime)),
    [entryCandle, mappedCandles, trade]
  );
  const structureMappedCandles = useMemo(
    () => aggregateCandlesForTimeframe(mappedCandles, effectiveDataTimeframe, strategyStructureTimeframe),
    [effectiveDataTimeframe, mappedCandles, strategyStructureTimeframe]
  );
  const structureEntryCandle = useMemo(
    () => nearestMappedCandle(structureMappedCandles, trade.entryIndex, trade.entryTime),
    [structureMappedCandles, trade.entryIndex, trade.entryTime]
  );
  const structureSignalCandle = useMemo(
    () => nearestMappedCandle(structureMappedCandles, trade.entryIndex, trade.signalTime),
    [structureMappedCandles, trade.entryIndex, trade.signalTime]
  );
  const structureExitCandle = useMemo(
    () => firstBracketExitCandle(structureMappedCandles, trade, structureEntryCandle, nearestMappedCandle(structureMappedCandles, trade.exitIndex, trade.exitTime)),
    [structureEntryCandle, structureMappedCandles, trade]
  );
  const visibleAnchor = entryCandle ?? mappedCandles[0] ?? null;
  const currentPartialSource = currentReplayCandle
    ? aggregateIntrabarSource(currentReplayCandle, replayMappedCandles, currentReplayTime, effectiveDataTimeframe)
    : null;
  const currentStructureReplayCandle = useMemo(
    () => replayCandleForTime(structureMappedCandles, currentReplayTime),
    [currentReplayTime, structureMappedCandles]
  );
  const tradeSnapshot = useMemo<TradeVisualSnapshot>(
    () => ({
      currentPrice: currentPartialSource?.close ?? null,
      currentReplayCandle,
      currentReplayTime,
      entryCandle,
      exitCandle,
      signalCandle,
      trade
    }),
    [currentPartialSource?.close, currentReplayCandle, currentReplayTime, entryCandle, exitCandle, signalCandle, trade]
  );
  const structureSnapshot = useMemo<TradeVisualSnapshot>(
    () => ({
      ...tradeSnapshot,
      currentReplayCandle: currentStructureReplayCandle,
      entryCandle: structureEntryCandle,
      exitCandle: structureExitCandle,
      signalCandle: structureSignalCandle
    }),
    [currentStructureReplayCandle, structureEntryCandle, structureExitCandle, structureSignalCandle, tradeSnapshot]
  );
  const structureVisuals = useMemo(
    () => strategyStructureVisuals(structureSnapshot, structureMappedCandles, showStrategyVisuals, strategyStructureTimeframe),
    [showStrategyVisuals, strategyStructureTimeframe, structureMappedCandles, structureSnapshot]
  );
  const displayBar = activeBar ?? currentPartialSource ?? currentReplayCandle?.source ?? visibleAnchor?.source ?? bars[0] ?? null;
  const change = displayBar ? displayBar.close - displayBar.open : 0;
  const changePct = displayBar && displayBar.open !== 0 ? (change / displayBar.open) * 100 : 0;
  const up = change >= 0;
  const entryRevealedForReplay = candleIsRevealed(entryCandle, currentReplayCandle);
  const exitRevealedForReplay = candleIsRevealed(exitCandle, currentReplayCandle);
  const replayReferencePrice = exitRevealedForReplay ? trade.exitPrice : currentPartialSource?.close ?? currentReplayCandle?.close ?? null;
  const currentReplayPnlLabel = replayPnlLabel(trade, replayReferencePrice, entryRevealedForReplay, exitRevealedForReplay);
  const currentReplayPnlClass = currentReplayPnlLabel.startsWith("+") ? "up" : currentReplayPnlLabel.startsWith("-") ? "down" : "neutral";
  const timeframeScopeLabel =
    sourceTimeframe === effectiveDataTimeframe
      ? `${sourceTimeframe} strategy`
      : `${sourceTimeframe} strategy / ${effectiveDataTimeframe} view`;
  const replayProgressPercent = maxReplayPosition > 0 ? (clampedReplayPosition / maxReplayPosition) * 100 : 0;
  const replaySliderStyle = { "--trade-replay-progress": `${replayProgressPercent}%` } as CSSProperties;
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

  replaySeekByTimeRef.current = (time: number) => {
    if (!replayTimeline.length) return;
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < replayTimeline.length; index += 1) {
      const distance = Math.abs(Number(replayTimeline[index]!.time) - time);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    setIsPlaying(false);
    setReplayPosition(bestIndex);
  };

  useEffect(() => {
    setChartTheme(currentChartTheme());
    const observer = new MutationObserver(() => setChartTheme(currentChartTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    selectingReplayStartRef.current = isSelectingReplayStart;
  }, [isSelectingReplayStart]);

  useEffect(() => {
    setIsPlaying(false);
    setIsSelectingReplayStart(false);
    setSelectPreviewTime(null);
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
    const textColor = isLight ? "rgba(15, 23, 42, 0.82)" : "rgba(255, 255, 255, 0.82)";
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
      height: Math.max(360, container.clientHeight || 390),
      layout: {
        background: { type: ColorType.Solid, color: backgroundColor },
        textColor,
        fontFamily: "'IBM Plex Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
        fontSize: 12
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
      selectingReplayStart: false,
      selectionCandle: null,
      snapshot: initialSnapshot,
      structureVisuals: emptyStructureVisuals()
    });
    markers.setMarkers(tradeMarkerList(initialSnapshot));

    const logicalRange = tradeLogicalRange(mappedCandles, entryCandle, exitCandle);
    const priceRange = tradePriceRange(
      mappedCandles,
      [trade.entryPrice, trade.exitPrice, trade.targetPrice, trade.stopPrice],
      logicalRange
    );
    lockedLogicalRangeRef.current = logicalRange;
    lockedPriceRangeRef.current = priceRange;
    rangeReadyRef.current = false;

    applyTradeChartRange(chart, series, logicalRange, priceRange);
    let secondRangeAnimationFrame = 0;
    const rangeAnimationFrame = window.requestAnimationFrame(() => {
      applyTradeChartRange(chart, series, logicalRange, priceRange);
      secondRangeAnimationFrame = window.requestAnimationFrame(() => {
        applyTradeChartRange(chart, series, logicalRange, priceRange);
        rangeReadyRef.current = true;
      });
    });
    const rangeTimeout = window.setTimeout(() => {
      applyTradeChartRange(chart, series, logicalRange, priceRange);
      rangeReadyRef.current = true;
    }, 180);

    const handleCrosshairMove = (param: { time?: unknown }) => {
      if (typeof param.time !== "number") {
        if (selectingReplayStartRef.current) setSelectPreviewTime(null);
        return;
      }
      const source = sourceByTime.get(param.time);
      if (source) {
        setActiveBar((current) => (current?.time === source.time ? current : source));
      }
      if (selectingReplayStartRef.current) {
        setSelectPreviewTime(param.time as Time);
      }
    };
    const handleChartClick = (param: { time?: unknown }) => {
      if (!selectingReplayStartRef.current || typeof param.time !== "number") return;
      replaySeekByTimeRef.current(param.time);
      setIsSelectingReplayStart(false);
      setSelectPreviewTime(null);
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);
    chart.subscribeClick(handleChartClick);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.unsubscribeClick(handleChartClick);
      window.cancelAnimationFrame(rangeAnimationFrame);
      if (secondRangeAnimationFrame) window.cancelAnimationFrame(secondRangeAnimationFrame);
      window.clearTimeout(rangeTimeout);
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
    trade.id,
    trade.modelName,
    trade.pnlLabel,
    trade.phase,
    trade.side,
    trade.signalTime,
    trade.sourceTimeframe,
    trade.stopPrice,
    trade.targetPrice,
    trade.targetDollars,
    trade.riskDollars,
    trade.dollarsPerPricePoint
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
    if (!rangeReadyRef.current && lockedLogicalRangeRef.current) {
      applyTradeChartRange(chart, series, lockedLogicalRangeRef.current, lockedPriceRangeRef.current);
    } else {
      if (currentPriceRange) series.priceScale().setVisibleRange(currentPriceRange);
      if (currentLogicalRange) chart.timeScale().setVisibleLogicalRange(currentLogicalRange);
    }

    applyOverlayTheme(overlaySeries, tradeVisualTheme(chartTheme === "light"), trade);
    emptyOverlayData(overlaySeries);
    positionOverlay.setState({
      candles: mappedCandles,
      dataTimeframe: effectiveDataTimeframe,
      selectingReplayStart: isSelectingReplayStart,
      selectionCandle,
      snapshot: tradeSnapshot,
      structureVisuals
    });
    markers.setMarkers([...tradeMarkerList(tradeSnapshot), ...strategyVisualMarkers(structureSnapshot, structureMappedCandles, showStrategyVisuals)]);
  }, [
    candleData,
    chartTheme,
    effectiveDataTimeframe,
    isSelectingReplayStart,
    mappedCandles,
    selectionCandle,
    showStrategyVisuals,
    structureMappedCandles,
    structureSnapshot,
    structureVisuals,
    trade,
    tradeSnapshot
  ]);

  function togglePlayback() {
    setIsSelectingReplayStart(false);
    setSelectPreviewTime(null);
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
    setIsSelectingReplayStart(false);
    setSelectPreviewTime(null);
    setIsPlaying(false);
    setReplayPosition((current) => clamp(current + delta, 0, maxReplayPosition));
  }

  function resetReplay() {
    setIsSelectingReplayStart(false);
    setSelectPreviewTime(null);
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
    setIsSelectingReplayStart(false);
    setSelectPreviewTime(null);
    setIsPlaying(false);
    setReplayPosition(replayIndexForTime(value));
  }

  function updateReplayMode(nextMode: ReplayMode) {
    if (nextMode === activeReplayMode) return;
    const anchorTime = currentReplayTime;
    setIsSelectingReplayStart(false);
    setSelectPreviewTime(null);
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
    <div className={`tradeReplayPanel${isSelectingReplayStart ? " isSelecting" : ""}`}>
      <div className="tradeReplayStatus">
        <span>{formatChartTime(currentReplayStep?.source.time ?? currentReplayCandle?.source.time)}</span>
        <strong>{timeframeScopeLabel}</strong>
      </div>
      <div className="tradeReplayCenter">
        <div className="tradeReplayButtons tradeReplayTransport" aria-label="Replay controls">
          <button type="button" aria-label="Reset replay" title="Reset" onClick={resetReplay}>
            <ReplayIcon name="reset" />
          </button>
          <button type="button" aria-label="Step back" title="Step back" onClick={() => stepReplay(-1)}>
            <ReplayIcon name="stepBack" />
          </button>
          <button type="button" aria-label={isPlaying ? "Pause replay" : "Play replay"} className={isPlaying ? "active" : ""} title={isPlaying ? "Pause" : "Play"} onClick={togglePlayback}>
            <ReplayIcon name={isPlaying ? "pause" : "play"} />
          </button>
          <button type="button" aria-label="Step forward" title="Step forward" onClick={() => stepReplay(1)}>
            <ReplayIcon name="stepForward" />
          </button>
          <button
            type="button"
            aria-label="Select replay point on chart"
            aria-pressed={isSelectingReplayStart}
            className={isSelectingReplayStart ? "active" : ""}
            title="Select replay point on chart"
            onClick={() => {
              setIsPlaying(false);
              setIsSelectingReplayStart((current) => {
                if (current) setSelectPreviewTime(null);
                return !current;
              });
            }}
          >
            <ReplayIcon name="select" />
          </button>
        </div>
        <div className="tradeReplayButtons tradeReplayJumps" aria-label="Replay jumps">
          <button type="button" aria-label="Jump to signal" title="Signal" onClick={() => jumpReplay(trade.signalTime)}>
            <ReplayIcon name="signal" />
          </button>
          <button type="button" aria-label="Jump to entry" title="Entry" onClick={() => jumpReplay(trade.entryTime)}>
            <ReplayIcon name="entry" />
          </button>
          <button type="button" aria-label="Jump to exit" title="Exit" onClick={() => jumpReplay(trade.exitTime)}>
            <ReplayIcon name="exit" />
          </button>
        </div>
      </div>
      <div className="tradeReplayMetrics" aria-label="Replay readout">
        <span>
          <i>PnL</i>
          <strong className={currentReplayPnlClass}>{currentReplayPnlLabel}</strong>
        </span>
        <span>
          <i>Step</i>
          <strong>{clampedReplayPosition + 1} / {replayTimeline.length}</strong>
        </span>
        <span>
          <i>Mode</i>
          <strong>{activeReplayMode === "intrabar" ? "1m precision" : `${effectiveDataTimeframe} bars`}</strong>
        </span>
        <span className={isSelectingReplayStart ? "active" : ""}>
          <i>Select</i>
          <strong>{isSelectingReplayStart ? "Selecting bar" : "Ready"}</strong>
        </span>
      </div>
      <label className="tradeReplaySlider" style={replaySliderStyle}>
        <input
          type="range"
          min={0}
          max={maxReplayPosition}
          step={1}
          value={clampedReplayPosition}
          aria-label="Replay position"
          onInput={(event) => {
            setIsSelectingReplayStart(false);
            setSelectPreviewTime(null);
            setIsPlaying(false);
            setReplayPosition(Number(event.currentTarget.value));
          }}
          onChange={(event) => {
            setIsSelectingReplayStart(false);
            setSelectPreviewTime(null);
            setIsPlaying(false);
            setReplayPosition(Number(event.target.value));
          }}
        />
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
              onClick={() => {
                setIsSelectingReplayStart(false);
                setSelectPreviewTime(null);
                setReplaySpeed(speed);
              }}
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
        <div
          ref={containerRef}
          className={`tradePriceChart${isSelectingReplayStart ? " isSelectingReplayStart" : ""}`}
          aria-label={`${trade.symbol} TradingView Lightweight candlestick chart`}
        />
      </div>
      {replayControls}
    </section>
  );
}
