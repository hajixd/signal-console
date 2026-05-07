"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type Logical,
  type UTCTimestamp,
  type WhitespaceData
} from "lightweight-charts";

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
type ChartLevelTone = "entry" | "green" | "red";
type ChartLevelTag = {
  key: "entry" | "exit" | "target" | "stop";
  label: string;
  price: number;
  tone: ChartLevelTone;
};
type PositionedChartLevelTag = ChartLevelTag & {
  y: number;
};
type ChartOverlayPoint = {
  x: number;
  y: number;
};
type TradeChartOverlay = {
  entry: ChartOverlayPoint;
  pathEnd: ChartOverlayPoint | null;
  exit: ChartOverlayPoint | null;
  visual: ChartPositionVisual | null;
};
type ChartPositionVisual = {
  x: number;
  width: number;
  y1: number;
  y2: number;
  entryY: number;
  targetY: number;
  stopY: number;
  profitY: number;
  profitHeight: number;
  riskY: number;
  riskHeight: number;
};
type MappedCandle = CandlestickData<UTCTimestamp> & {
  source: TradeChartBar;
};
type ReplayChartData = CandlestickData<UTCTimestamp> | WhitespaceData<UTCTimestamp>;
type CandleSeriesApi = ISeriesApi<"Candlestick">;
type NumberRange = {
  from: number;
  to: number;
};
type OverlayInputs = {
  chartLevelTags: ChartLevelTag[];
  currentReplayCandle: MappedCandle | null;
  entryCandle: MappedCandle | null;
  exitCandle: MappedCandle | null;
  mappedCandles: MappedCandle[];
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
  const seriesRef = useRef<CandleSeriesApi | null>(null);
  const overlayInputsRef = useRef<OverlayInputs | null>(null);
  const scheduleOverlayUpdateRef = useRef<(() => void) | null>(null);
  const lockedLogicalRangeRef = useRef<NumberRange | null>(null);
  const lockedPriceRangeRef = useRef<NumberRange | null>(null);
  const rangeReadyRef = useRef(false);
  const [activeBar, setActiveBar] = useState<TradeChartBar | null>(null);
  const [chartTheme, setChartTheme] = useState<ChartTheme>("dark");
  const [isPlaying, setIsPlaying] = useState(false);
  const [replayPosition, setReplayPosition] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState<ReplaySpeed>(2);
  const [tradeOverlay, setTradeOverlay] = useState<TradeChartOverlay | null>(null);
  const [positionedLevelTags, setPositionedLevelTags] = useState<PositionedChartLevelTag[]>([]);
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
  const isLong = trade.side === "long";
  const exitLevelTone: ChartLevelTone = isLong ? "red" : "green";
  const chartLevelTags = useMemo<ChartLevelTag[]>(
    () => [
      {
        key: "target",
        label: "TP",
        price: trade.targetPrice,
        tone: "green"
      },
      {
        key: "exit",
        label: "Exit",
        price: trade.exitPrice,
        tone: exitLevelTone
      },
      {
        key: "entry",
        label: "Entry",
        price: trade.entryPrice,
        tone: "entry"
      },
      {
        key: "stop",
        label: "SL",
        price: trade.stopPrice,
        tone: "red"
      }
    ],
    [exitLevelTone, trade.entryPrice, trade.exitPrice, trade.stopPrice, trade.targetPrice]
  );
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
    overlayInputsRef.current = {
      chartLevelTags,
      currentReplayCandle,
      entryCandle,
      exitCandle,
      mappedCandles,
      trade
    };
    scheduleOverlayUpdateRef.current?.();
  }, [
    chartLevelTags,
    currentReplayCandle,
    entryCandle,
    exitCandle,
    mappedCandles,
    trade,
    trade.entryPrice,
    trade.exitPrice,
    trade.side,
    trade.stopPrice,
    trade.targetPrice
  ]);

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
    series.createPriceLine({
      price: trade.entryPrice,
      color: entryLineColor,
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: false,
      axisLabelColor: entryTagColor,
      axisLabelTextColor: entryTagTextColor,
      title: `Entry ${formatChartPrice(trade.entryPrice)}`
    });
    series.createPriceLine({
      price: trade.exitPrice,
      color: trade.side === "long" ? downSoftColor : upSoftColor,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
      axisLabelColor: trade.side === "long" ? redTagColor : greenTagColor,
      axisLabelTextColor: lightTagTextColor,
      title: `Exit ${formatChartPrice(trade.exitPrice)}`
    });
    series.createPriceLine({
      price: trade.targetPrice,
      color: upSoftColor,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
      axisLabelColor: greenTagColor,
      axisLabelTextColor: lightTagTextColor,
      title: `TP ${formatChartPrice(trade.targetPrice)}`
    });
    series.createPriceLine({
      price: trade.stopPrice,
      color: downSoftColor,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
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
      scheduleOverlayUpdateRef.current?.();
    });

    const pointFor = (candles: MappedCandle[], candle: MappedCandle | null, price: number): ChartOverlayPoint | null => {
      if (!candle || !Number.isFinite(price)) return null;
      const x = chart.timeScale().logicalToCoordinate(candleIndex(candles, candle) as Logical);
      const y = series.priceToCoordinate(price);
      if (x == null || y == null) return null;
      return { x: Number(x), y: Number(y) };
    };

    const updateTradeOverlay = () => {
      const inputs = overlayInputsRef.current;
      if (!inputs) return;

      const chartHeight = Math.max(1, container.clientHeight || 318);
      const chartWidth = Math.max(1, container.clientWidth || 1);
      const minLevelTagGap = 20;
      const nextLevelTags = inputs.chartLevelTags
        .map((tag) => {
          const y = series.priceToCoordinate(tag.price);
          if (y == null) return null;
          return {
            ...tag,
            y: clamp(Number(y), 12, chartHeight - 12)
          };
        })
        .filter((tag): tag is PositionedChartLevelTag => Boolean(tag))
        .sort((left, right) => left.y - right.y);

      for (let index = 1; index < nextLevelTags.length; index += 1) {
        const previous = nextLevelTags[index - 1]!;
        const current = nextLevelTags[index]!;
        if (current.y - previous.y < minLevelTagGap) current.y = previous.y + minLevelTagGap;
      }

      const levelTagOverflow = (nextLevelTags.at(-1)?.y ?? 0) - (chartHeight - 12);
      if (levelTagOverflow > 0) {
        for (const tag of nextLevelTags) tag.y -= levelTagOverflow;
      }

      for (let index = nextLevelTags.length - 2; index >= 0; index -= 1) {
        const next = nextLevelTags[index + 1]!;
        const current = nextLevelTags[index]!;
        if (next.y - current.y < minLevelTagGap) current.y = next.y - minLevelTagGap;
        current.y = clamp(current.y, 12, chartHeight - 12);
      }

      setPositionedLevelTags(nextLevelTags);

      if (!candleIsRevealed(inputs.entryCandle, inputs.currentReplayCandle)) {
        setTradeOverlay(null);
        return;
      }

      const entry = pointFor(inputs.mappedCandles, inputs.entryCandle, inputs.trade.entryPrice);
      if (!entry) {
        setTradeOverlay(null);
        return;
      }

      const exitRevealed = candleIsRevealed(inputs.exitCandle, inputs.currentReplayCandle);
      const pathEndCandle = exitRevealed ? inputs.exitCandle : inputs.currentReplayCandle;
      const pathEndPrice = exitRevealed ? inputs.trade.exitPrice : inputs.currentReplayCandle?.close;
      const pathEnd = pathEndPrice == null ? null : pointFor(inputs.mappedCandles, pathEndCandle, pathEndPrice);
      const exit = exitRevealed ? pointFor(inputs.mappedCandles, inputs.exitCandle, inputs.trade.exitPrice) : null;

      const targetY = series.priceToCoordinate(inputs.trade.targetPrice);
      const stopY = series.priceToCoordinate(inputs.trade.stopPrice);
      const entryY = series.priceToCoordinate(inputs.trade.entryPrice);
      const visualEndX = exit?.x ?? pathEnd?.x ?? entry.x;
      const minimumVisualWidth = Math.min(180, Math.max(72, chartWidth * 0.16));
      const visualWidth = Math.max(minimumVisualWidth, visualEndX - entry.x);
      const visualX = clamp(entry.x, 0, Math.max(0, chartWidth - visualWidth));
      const visual =
        targetY == null || stopY == null || entryY == null
          ? null
          : {
              x: visualX,
              width: clamp(visualWidth, 6, Math.max(6, chartWidth - visualX)),
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

      setTradeOverlay({
        entry,
        pathEnd:
          pathEnd && (Math.abs(pathEnd.x - entry.x) > 2 || Math.abs(pathEnd.y - entry.y) > 2)
            ? pathEnd
            : null,
        exit,
        visual
      });
    };

    let overlayAnimationFrame = window.requestAnimationFrame(updateTradeOverlay);
    const scheduleTradeOverlayUpdate = () => {
      window.cancelAnimationFrame(overlayAnimationFrame);
      overlayAnimationFrame = window.requestAnimationFrame(updateTradeOverlay);
    };
    scheduleOverlayUpdateRef.current = scheduleTradeOverlayUpdate;
    const resizeObserver = new ResizeObserver(scheduleTradeOverlayUpdate);
    resizeObserver.observe(container);
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleTradeOverlayUpdate);

    const handleCrosshairMove = (param: { time?: unknown }) => {
      if (typeof param.time !== "number") return;
      const source = sourceByTime.get(param.time);
      if (source) setActiveBar(source);
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleTradeOverlayUpdate);
      resizeObserver.disconnect();
      window.cancelAnimationFrame(rangeAnimationFrame);
      window.cancelAnimationFrame(overlayAnimationFrame);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      scheduleOverlayUpdateRef.current = null;
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
    const series = seriesRef.current;
    if (!chart || !series) return;

    const rangeReady = rangeReadyRef.current;
    const currentLogicalRange = rangeReady ? chart.timeScale().getVisibleLogicalRange() : null;
    const currentPriceRange = rangeReady ? series.priceScale().getVisibleRange() : null;
    series.setData(candleData);

    const lockedLogicalRange = currentLogicalRange ?? lockedLogicalRangeRef.current;
    const lockedPriceRange = currentPriceRange ?? lockedPriceRangeRef.current;
    series.priceScale().applyOptions({ autoScale: false });
    if (lockedPriceRange) series.priceScale().setVisibleRange(lockedPriceRange);
    if (lockedLogicalRange) chart.timeScale().setVisibleLogicalRange(lockedLogicalRange);

    scheduleOverlayUpdateRef.current?.();
  }, [candleData]);

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
        {positionedLevelTags.length ? (
          <div className="tradeChartPriceTags" aria-label="Trade price levels">
            {positionedLevelTags.map((tag) => (
              <span
                className={`tradeChartPriceTag ${tag.tone}`}
                key={tag.key}
                style={{ top: tag.y }}
              >
                <span>{tag.label}</span>
                <strong>{formatChartPrice(tag.price)}</strong>
              </span>
            ))}
          </div>
        ) : null}
        {tradeOverlay ? (
          <svg className="tradeChartTradeOverlay" aria-hidden="true">
            {tradeOverlay.visual ? (
              <g className="tradeChartPositionVisual">
                <rect
                  className="tradeChartProfitZone"
                  x={tradeOverlay.visual.x}
                  y={tradeOverlay.visual.profitY}
                  width={tradeOverlay.visual.width}
                  height={tradeOverlay.visual.profitHeight}
                />
                <rect
                  className="tradeChartRiskZone"
                  x={tradeOverlay.visual.x}
                  y={tradeOverlay.visual.riskY}
                  width={tradeOverlay.visual.width}
                  height={tradeOverlay.visual.riskHeight}
                />
                <line
                  className="tradeChartTargetLine"
                  x1={tradeOverlay.visual.x}
                  y1={tradeOverlay.visual.targetY}
                  x2={tradeOverlay.visual.x + tradeOverlay.visual.width}
                  y2={tradeOverlay.visual.targetY}
                />
                <line
                  className="tradeChartEntryLine"
                  x1={tradeOverlay.visual.x}
                  y1={tradeOverlay.visual.entryY}
                  x2={tradeOverlay.visual.x + tradeOverlay.visual.width}
                  y2={tradeOverlay.visual.entryY}
                />
                <line
                  className="tradeChartStopLine"
                  x1={tradeOverlay.visual.x}
                  y1={tradeOverlay.visual.stopY}
                  x2={tradeOverlay.visual.x + tradeOverlay.visual.width}
                  y2={tradeOverlay.visual.stopY}
                />
                <line
                  className="tradeChartPositionEdge"
                  x1={tradeOverlay.visual.x + tradeOverlay.visual.width}
                  y1={tradeOverlay.visual.y1}
                  x2={tradeOverlay.visual.x + tradeOverlay.visual.width}
                  y2={tradeOverlay.visual.y2}
                />
              </g>
            ) : null}
            {tradeOverlay.pathEnd ? (
              <line
                className={`tradeChartTradePath ${exitLevelTone}`}
                x1={tradeOverlay.entry.x}
                y1={tradeOverlay.entry.y}
                x2={tradeOverlay.pathEnd.x}
                y2={tradeOverlay.pathEnd.y}
              />
            ) : null}
            <polygon
              className={`tradeChartEntryMarker ${isLong ? "long" : "short"}`}
              points={
                isLong
                  ? `${tradeOverlay.entry.x},${tradeOverlay.entry.y - 8} ${tradeOverlay.entry.x - 6},${tradeOverlay.entry.y + 5} ${tradeOverlay.entry.x + 6},${tradeOverlay.entry.y + 5}`
                  : `${tradeOverlay.entry.x},${tradeOverlay.entry.y + 8} ${tradeOverlay.entry.x - 6},${tradeOverlay.entry.y - 5} ${tradeOverlay.entry.x + 6},${tradeOverlay.entry.y - 5}`
              }
            />
            <text
              className="tradeChartMarkerText entry"
              x={tradeOverlay.entry.x}
              y={tradeOverlay.entry.y + (isLong ? 22 : -14)}
              textAnchor="middle"
            >
              Entry
            </text>
            {tradeOverlay.exit ? (
              <>
                <line
                  className={`tradeChartExitMarker ${exitLevelTone}`}
                  x1={tradeOverlay.exit.x - 5}
                  y1={tradeOverlay.exit.y - 5}
                  x2={tradeOverlay.exit.x + 5}
                  y2={tradeOverlay.exit.y + 5}
                />
                <line
                  className={`tradeChartExitMarker ${exitLevelTone}`}
                  x1={tradeOverlay.exit.x + 5}
                  y1={tradeOverlay.exit.y - 5}
                  x2={tradeOverlay.exit.x - 5}
                  y2={tradeOverlay.exit.y + 5}
                />
                <text
                  className={`tradeChartMarkerText exit ${exitLevelTone}`}
                  x={tradeOverlay.exit.x}
                  y={tradeOverlay.exit.y + (isLong ? -12 : 22)}
                  textAnchor="middle"
                >
                  Exit
                </text>
              </>
            ) : null}
          </svg>
        ) : null}
        <div ref={containerRef} className="tradePriceChart" aria-label={`${trade.symbol} TradingView Lightweight candlestick chart`} />
      </div>
      {replayControls}
    </section>
  );
}
