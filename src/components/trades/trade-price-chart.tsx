"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
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
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  targetPrice: number;
  stopPrice: number;
};

type ChartStatus = "idle" | "loading" | "ready" | "error";
type ChartTheme = "dark" | "light";
type ReplaySpeed = 1 | 2 | 4 | 8;
type ChartOverlayPoint = {
  x: number;
  y: number;
};
type MappedCandle = CandlestickData<UTCTimestamp> & {
  source: TradeChartBar;
};
type ReplayChartData = CandlestickData<UTCTimestamp> | WhitespaceData<UTCTimestamp>;
type CandleSeriesApi = ISeriesApi<"Candlestick">;
type TradeSeriesMarkersApi = ISeriesMarkersPluginApi<Time>;
type NumberRange = {
  from: number;
  to: number;
};
type TradeVisualTheme = {
  entryLine: string;
  targetLine: string;
  stopLine: string;
  edgeLine: string;
  pathLine: string;
  profitFill: string;
  profitStroke: string;
  riskFill: string;
  riskStroke: string;
};
type TradeVisualSnapshot = {
  currentReplayCandle: MappedCandle | null;
  entryCandle: MappedCandle | null;
  exitCandle: MappedCandle | null;
  mappedCandles: MappedCandle[];
  theme: TradeVisualTheme;
  trade: TradeChartTrade;
};
const REPLAY_SPEEDS: ReplaySpeed[] = [1, 2, 4, 8];
const REPLAY_INTERVAL_MS: Record<ReplaySpeed, number> = {
  1: 700,
  2: 360,
  4: 180,
  8: 90
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

function resolvedExitCandle(candles: MappedCandle[], trade: TradeChartTrade, entryCandle: MappedCandle | null): MappedCandle | null {
  if (!candles.length) return null;
  const fallback = nearestMappedCandle(candles, trade.exitIndex, trade.exitTime);
  const exitReasonPrice =
    Math.abs(trade.exitPrice - trade.targetPrice) <= Math.max(Math.abs(trade.targetPrice) * 0.00001, 0.00001)
      ? trade.targetPrice
      : Math.abs(trade.exitPrice - trade.stopPrice) <= Math.max(Math.abs(trade.stopPrice) * 0.00001, 0.00001)
        ? trade.stopPrice
        : trade.exitPrice;

  const entryPosition = candleIndex(candles, entryCandle);
  const fallbackPosition = candleIndex(candles, fallback);
  const searchStart = Math.max(entryPosition, 0);
  const searchEnd = Math.max(fallbackPosition, Math.min(candles.length - 1, searchStart + 1));

  for (let position = searchStart; position <= candles.length - 1; position += 1) {
    const candle = candles[position]!;
    if (priceTouched(candle, exitReasonPrice)) return candle;
    if (position >= searchEnd && fallbackPosition > entryPosition) break;
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

function chartMessage(status: ChartStatus): string {
  if (status === "loading") return "Loading candles...";
  if (status === "error") return "Chart unavailable.";
  return "No candles available for this trade.";
}

function currentChartTheme(): ChartTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function tradeVisualTheme(isLight: boolean): TradeVisualTheme {
  return {
    entryLine: isLight ? "rgba(15, 23, 42, 0.62)" : "rgba(255, 255, 255, 0.78)",
    targetLine: isLight ? "rgba(22, 163, 74, 0.88)" : "rgba(16, 185, 129, 0.92)",
    stopLine: isLight ? "rgba(220, 38, 38, 0.86)" : "rgba(244, 63, 94, 0.95)",
    edgeLine: isLight ? "rgba(15, 23, 42, 0.36)" : "rgba(255, 255, 255, 0.46)",
    pathLine: isLight ? "rgba(15, 23, 42, 0.72)" : "rgba(255, 255, 255, 0.9)",
    profitFill: isLight ? "rgba(22, 163, 74, 0.22)" : "rgba(16, 185, 129, 0.26)",
    profitStroke: isLight ? "rgba(22, 163, 74, 0.4)" : "rgba(16, 185, 129, 0.48)",
    riskFill: isLight ? "rgba(220, 38, 38, 0.2)" : "rgba(244, 63, 94, 0.28)",
    riskStroke: isLight ? "rgba(220, 38, 38, 0.38)" : "rgba(244, 63, 94, 0.5)"
  };
}

function tradeMarkerList(snapshot: TradeVisualSnapshot | null): SeriesMarker<Time>[] {
  if (!snapshot || !candleIsRevealed(snapshot.entryCandle, snapshot.currentReplayCandle)) return [];

  const direction = snapshot.trade.side === "long" ? 1 : -1;
  const exitIsFavorable = (snapshot.trade.exitPrice - snapshot.trade.entryPrice) * direction >= 0;
  const markers: SeriesMarker<Time>[] = [
    {
      color: snapshot.trade.side === "long" ? "#10b981" : "#ef4444",
      position: "atPriceMiddle",
      price: snapshot.trade.entryPrice,
      shape: snapshot.trade.side === "long" ? "arrowUp" : "arrowDown",
      text: "Entry",
      time: snapshot.entryCandle.time,
      size: 1.1
    }
  ];

  if (candleIsRevealed(snapshot.exitCandle, snapshot.currentReplayCandle)) {
    markers.push({
      color: exitIsFavorable ? "#10b981" : "#ef4444",
      position: "atPriceMiddle",
      price: snapshot.trade.exitPrice,
      shape: snapshot.trade.side === "long" ? "arrowDown" : "arrowUp",
      text: "Exit",
      time: snapshot.exitCandle.time,
      size: 1.1
    });
  }

  return markers;
}

class TradePositionPrimitive implements ISeriesPrimitive<Time> {
  private readonly zoneView = new TradePositionPaneView(this, "bottom");
  private readonly pathView = new TradePositionPaneView(this, "top");
  private chart: IChartApi | null = null;
  private requestUpdate: (() => void) | null = null;
  private series: CandleSeriesApi | null = null;
  private snapshot: TradeVisualSnapshot | null = null;

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart as IChartApi;
    this.series = param.series as CandleSeriesApi;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.requestUpdate = null;
    this.series = null;
    this.snapshot = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.zoneView, this.pathView];
  }

  setSnapshot(snapshot: TradeVisualSnapshot | null): void {
    this.snapshot = snapshot;
    this.requestUpdate?.();
  }

  drawZones(target: CanvasRenderingTarget2D): void {
    const snapshot = this.snapshot;
    if (!snapshot || !candleIsRevealed(snapshot.entryCandle, snapshot.currentReplayCandle)) return;

    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const coordinates = this.coordinates(mediaSize.width);
      if (!coordinates) return;

      context.save();
      context.beginPath();
      context.rect(0, 0, mediaSize.width, mediaSize.height);
      context.clip();
      context.fillStyle = snapshot.theme.profitFill;
      context.strokeStyle = snapshot.theme.profitStroke;
      context.lineWidth = 1;
      context.fillRect(coordinates.visualX, coordinates.profitY, coordinates.visualWidth, coordinates.profitHeight);
      context.strokeRect(coordinates.visualX, coordinates.profitY, coordinates.visualWidth, coordinates.profitHeight);
      context.fillStyle = snapshot.theme.riskFill;
      context.strokeStyle = snapshot.theme.riskStroke;
      context.fillRect(coordinates.visualX, coordinates.riskY, coordinates.visualWidth, coordinates.riskHeight);
      context.strokeRect(coordinates.visualX, coordinates.riskY, coordinates.visualWidth, coordinates.riskHeight);

      this.line(context, snapshot.theme.targetLine, coordinates.visualX, coordinates.targetY, coordinates.visualX + coordinates.visualWidth, coordinates.targetY);
      this.line(context, snapshot.theme.entryLine, coordinates.visualX, coordinates.entryY, coordinates.visualX + coordinates.visualWidth, coordinates.entryY);
      this.line(context, snapshot.theme.stopLine, coordinates.visualX, coordinates.stopY, coordinates.visualX + coordinates.visualWidth, coordinates.stopY);

      context.setLineDash([4, 4]);
      this.line(context, snapshot.theme.edgeLine, coordinates.visualX + coordinates.visualWidth, coordinates.y1, coordinates.visualX + coordinates.visualWidth, coordinates.y2);
      context.restore();
    });
  }

  drawPath(target: CanvasRenderingTarget2D): void {
    const snapshot = this.snapshot;
    if (!snapshot || !candleIsRevealed(snapshot.entryCandle, snapshot.currentReplayCandle)) return;

    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const coordinates = this.coordinates(mediaSize.width);
      if (!coordinates || !coordinates.pathEnd) return;

      context.save();
      context.beginPath();
      context.rect(0, 0, mediaSize.width, mediaSize.height);
      context.clip();
      context.strokeStyle = snapshot.theme.pathLine;
      context.lineWidth = 2.25;
      context.lineCap = "round";
      context.setLineDash([2, 6]);
      context.beginPath();
      context.moveTo(coordinates.entry.x, coordinates.entry.y);
      context.lineTo(coordinates.pathEnd.x, coordinates.pathEnd.y);
      context.stroke();
      context.restore();
    });
  }

  private coordinates(chartWidth: number) {
    const snapshot = this.snapshot;
    const chart = this.chart;
    const series = this.series;
    if (!snapshot || !chart || !series) return null;

    const pointFor = (candle: MappedCandle | null, price: number): ChartOverlayPoint | null => {
      if (!candle || !Number.isFinite(price)) return null;
      const x = chart.timeScale().timeToCoordinate(candle.time as Time);
      const y = series.priceToCoordinate(price);
      if (x == null || y == null) return null;
      return { x: Number(x), y: Number(y) };
    };

    const entry = pointFor(snapshot.entryCandle, snapshot.trade.entryPrice);
    const targetY = series.priceToCoordinate(snapshot.trade.targetPrice);
    const stopY = series.priceToCoordinate(snapshot.trade.stopPrice);
    const entryY = series.priceToCoordinate(snapshot.trade.entryPrice);
    if (!entry || targetY == null || stopY == null || entryY == null) return null;

    const exitRevealed = candleIsRevealed(snapshot.exitCandle, snapshot.currentReplayCandle);
    const pathEndCandle = exitRevealed ? snapshot.exitCandle : snapshot.currentReplayCandle;
    const pathEndPrice = exitRevealed ? snapshot.trade.exitPrice : snapshot.currentReplayCandle?.close;
    const pathEnd = pathEndPrice == null ? null : pointFor(pathEndCandle, pathEndPrice);
    const visualEndX = pathEnd?.x ?? entry.x;
    const minimumVisualWidth = Math.min(180, Math.max(72, chartWidth * 0.16));
    const visualWidth = Math.max(minimumVisualWidth, visualEndX - entry.x);
    const visualX = clamp(entry.x, 0, Math.max(0, chartWidth - visualWidth));

    return {
      entry,
      pathEnd:
        pathEnd && (Math.abs(pathEnd.x - entry.x) > 2 || Math.abs(pathEnd.y - entry.y) > 2)
          ? pathEnd
          : null,
      visualX,
      visualWidth: clamp(visualWidth, 6, Math.max(6, chartWidth - visualX)),
      y1: Math.min(Number(targetY), Number(stopY), Number(entryY)),
      y2: Math.max(Number(targetY), Number(stopY), Number(entryY)),
      entryY: Number(entryY),
      targetY: Number(targetY),
      stopY: Number(stopY),
      profitY: Math.min(Number(entryY), Number(targetY)),
      profitHeight: Math.abs(Number(entryY) - Number(targetY)),
      riskY: Math.min(Number(entryY), Number(stopY)),
      riskHeight: Math.abs(Number(entryY) - Number(stopY))
    };
  }

  private line(context: CanvasRenderingContext2D, color: string, x1: number, y1: number, x2: number, y2: number): void {
    context.strokeStyle = color;
    context.lineWidth = 1.5;
    context.lineCap = "square";
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  }
}

class TradePositionPaneView implements IPrimitivePaneView {
  constructor(
    private readonly primitive: TradePositionPrimitive,
    private readonly layer: "bottom" | "top"
  ) {}

  zOrder(): "bottom" | "top" {
    return this.layer;
  }

  renderer(): IPrimitivePaneRenderer {
    return this.layer === "bottom"
      ? { draw: (target) => this.primitive.drawZones(target) }
      : { draw: (target) => this.primitive.drawPath(target) };
  }
}

export default function TradePriceChart({
  trade,
  bars,
  status,
  timeframe,
  timeframes,
  onTimeframeChange
}: {
  trade: TradeChartTrade;
  bars: TradeChartBar[];
  status: ChartStatus;
  timeframe: TradeChartTimeframe;
  timeframes: readonly { label: string; value: TradeChartTimeframe }[];
  onTimeframeChange: (value: TradeChartTimeframe) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const markersRef = useRef<TradeSeriesMarkersApi | null>(null);
  const seriesRef = useRef<CandleSeriesApi | null>(null);
  const visualPrimitiveRef = useRef<TradePositionPrimitive | null>(null);
  const lockedLogicalRangeRef = useRef<NumberRange | null>(null);
  const lockedPriceRangeRef = useRef<NumberRange | null>(null);
  const rangeReadyRef = useRef(false);
  const [activeBar, setActiveBar] = useState<TradeChartBar | null>(null);
  const [chartTheme, setChartTheme] = useState<ChartTheme>("dark");
  const [isPlaying, setIsPlaying] = useState(false);
  const [replayPosition, setReplayPosition] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState<ReplaySpeed>(2);
  const mappedCandles = useMemo(
    () =>
      bars
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
        .sort((left, right) => Number(left.time) - Number(right.time)),
    [bars]
  );
  const maxReplayPosition = Math.max(0, mappedCandles.length - 1);
  const clampedReplayPosition = clamp(replayPosition, 0, maxReplayPosition);
  const visibleMappedCandles = useMemo(
    () => mappedCandles.slice(0, clampedReplayPosition + 1),
    [clampedReplayPosition, mappedCandles]
  );
  const currentReplayCandle = visibleMappedCandles[visibleMappedCandles.length - 1] ?? null;
  const candleData = useMemo<ReplayChartData[]>(
    () =>
      mappedCandles.map((candle, index) =>
        index <= clampedReplayPosition
          ? {
              time: candle.time,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close
            }
          : {
              time: candle.time
            }
      ),
    [clampedReplayPosition, mappedCandles]
  );
  const sourceByTime = useMemo(
    () => new Map(mappedCandles.map((candle) => [Number(candle.time), candle.source])),
    [mappedCandles]
  );
  const entryCandle = useMemo(
    () => nearestMappedCandle(mappedCandles, trade.entryIndex, trade.entryTime),
    [mappedCandles, trade.entryIndex, trade.entryTime]
  );
  const exitCandle = useMemo(
    () => resolvedExitCandle(mappedCandles, trade, entryCandle),
    [entryCandle, mappedCandles, trade]
  );
  const visibleAnchor = entryCandle ?? mappedCandles[0] ?? null;
  const displayBar = activeBar ?? currentReplayCandle?.source ?? visibleAnchor?.source ?? bars[0] ?? null;
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
    setReplayPosition(Math.max(0, mappedCandles.length - 1));
  }, [mappedCandles.length, timeframe, trade.id]);

  useEffect(() => {
    setActiveBar(currentReplayCandle?.source ?? visibleAnchor?.source ?? bars[0] ?? null);
  }, [bars, currentReplayCandle, trade.id, visibleAnchor]);

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
    const entryLineColor = isLight ? "rgba(15, 23, 42, 0.88)" : "rgba(255, 255, 255, 0.88)";
    const upColor = isLight ? "#16a34a" : "#22c55e";
    const upSoftColor = isLight ? "#22c55e" : "#34d399";
    const downColor = isLight ? "#dc2626" : "#ef4444";
    const downSoftColor = isLight ? "#f43f5e" : "#f87171";
    const entryTagColor = "#111827";
    const entryTagTextColor = "#ffffff";
    const greenTagColor = isLight ? "#16a34a" : "#10b981";
    const redTagColor = isLight ? "#ef4444" : "#fb7185";
    const lightTagTextColor = "#ffffff";

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
      priceLineVisible: false,
      lastValueVisible: true
    });

    chartRef.current = chart;
    seriesRef.current = series;
    series.setData(candleData);
    const visualPrimitive = new TradePositionPrimitive();
    series.attachPrimitive(visualPrimitive);
    visualPrimitiveRef.current = visualPrimitive;
    const markers = createSeriesMarkers(series, [], {
      autoScale: false,
      zOrder: "aboveSeries"
    });
    markersRef.current = markers;

    series.createPriceLine({
      price: trade.entryPrice,
      color: entryLineColor,
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      axisLabelColor: entryTagColor,
      axisLabelTextColor: entryTagTextColor,
      title: `Entry ${formatChartPrice(trade.entryPrice)}`
    });
    series.createPriceLine({
      price: trade.exitPrice,
      color: trade.side === "long" ? downSoftColor : upSoftColor,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      axisLabelColor: trade.side === "long" ? redTagColor : greenTagColor,
      axisLabelTextColor: lightTagTextColor,
      title: `Exit ${formatChartPrice(trade.exitPrice)}`
    });
    series.createPriceLine({
      price: trade.targetPrice,
      color: upSoftColor,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      axisLabelColor: greenTagColor,
      axisLabelTextColor: lightTagTextColor,
      title: `TP ${formatChartPrice(trade.targetPrice)}`
    });
    series.createPriceLine({
      price: trade.stopPrice,
      color: downSoftColor,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      axisLabelColor: redTagColor,
      axisLabelTextColor: lightTagTextColor,
      title: `SL ${formatChartPrice(trade.stopPrice)}`
    });

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
      series.detachPrimitive(visualPrimitive);
      chart.remove();
      chartRef.current = null;
      markersRef.current = null;
      seriesRef.current = null;
      visualPrimitiveRef.current = null;
      lockedLogicalRangeRef.current = null;
      lockedPriceRangeRef.current = null;
      rangeReadyRef.current = false;
    };
  }, [
    chartTheme,
    entryCandle,
    exitCandle,
    mappedCandles,
    sourceByTime,
    status,
    trade.entryPrice,
    trade.exitPrice,
    trade.side,
    trade.stopPrice,
    trade.targetPrice
  ]);

  useEffect(() => {
    const chart = chartRef.current;
    const markers = markersRef.current;
    const series = seriesRef.current;
    const visualPrimitive = visualPrimitiveRef.current;
    if (!chart || !markers || !series || !visualPrimitive) return;

    const rangeReady = rangeReadyRef.current;
    const currentLogicalRange = rangeReady ? chart.timeScale().getVisibleLogicalRange() : null;
    const currentPriceRange = rangeReady ? series.priceScale().getVisibleRange() : null;
    series.setData(candleData);

    const lockedLogicalRange = currentLogicalRange ?? lockedLogicalRangeRef.current;
    const lockedPriceRange = currentPriceRange ?? lockedPriceRangeRef.current;
    series.priceScale().applyOptions({ autoScale: false });
    if (lockedPriceRange) series.priceScale().setVisibleRange(lockedPriceRange);
    if (lockedLogicalRange) chart.timeScale().setVisibleLogicalRange(lockedLogicalRange);

    const snapshot: TradeVisualSnapshot = {
      currentReplayCandle,
      entryCandle,
      exitCandle,
      mappedCandles,
      theme: tradeVisualTheme(chartTheme === "light"),
      trade
    };
    visualPrimitive.setSnapshot(snapshot);
    markers.setMarkers(tradeMarkerList(snapshot));
  }, [candleData, chartTheme, currentReplayCandle, entryCandle, exitCandle, mappedCandles, trade]);

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

  const replayControls = mappedCandles.length ? (
    <div className="tradeReplayPanel">
      <div className="tradeReplayButtons" aria-label="Replay controls">
        <button type="button" onClick={resetReplay}>Reset</button>
        <button type="button" onClick={() => stepReplay(-1)}>Back</button>
        <button type="button" className={isPlaying ? "active" : ""} onClick={togglePlayback}>
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={() => stepReplay(1)}>Forward</button>
      </div>
      <label className="tradeReplaySlider">
        <span>{formatChartTime(currentReplayCandle?.source.time)}</span>
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
        <strong>{clampedReplayPosition + 1} / {mappedCandles.length}</strong>
      </label>
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
    </div>
  ) : null;

  if (status === "loading" || status === "error" || !bars.length || !mappedCandles.length) {
    return (
      <section className="tradeCandlestickPanel isEmpty">
        <div className="tradeCandlestickHead">
          <strong>Trade Candlesticks</strong>
          {timeframeControls}
        </div>
        <span>{chartMessage(status)}</span>
      </section>
    );
  }

  return (
    <section className="tradeCandlestickPanel">
      <div className="tradeCandlestickHead">
        <strong>Trade Candlesticks</strong>
        <div className="tradeCandlestickHeadMeta">
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
