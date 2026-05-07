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
  type SeriesMarker,
  type UTCTimestamp
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
type MappedCandle = CandlestickData<UTCTimestamp> & {
  source: TradeChartBar;
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
  const candleData = useMemo(
    () =>
      visibleMappedCandles.map((candle) => ({
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close
      })),
    [visibleMappedCandles]
  );
  const sourceByTime = useMemo(
    () => new Map(visibleMappedCandles.map((candle) => [Number(candle.time), candle.source])),
    [visibleMappedCandles]
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
        borderColor: axisColor,
        scaleMargins: { top: 0.12, bottom: 0.16 }
      },
      timeScale: {
        borderColor: axisColor,
        barSpacing: 6,
        minBarSpacing: 1,
        rightOffset: 8,
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

    series.setData(candleData);
    series.createPriceLine({
      price: trade.entryPrice,
      color: entryLineColor,
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: `Entry ${formatChartPrice(trade.entryPrice)}`
    });
    series.createPriceLine({
      price: trade.exitPrice,
      color: trade.side === "long" ? downSoftColor : upSoftColor,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `Exit ${formatChartPrice(trade.exitPrice)}`
    });
    series.createPriceLine({
      price: trade.targetPrice,
      color: upSoftColor,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `TP ${formatChartPrice(trade.targetPrice)}`
    });
    series.createPriceLine({
      price: trade.stopPrice,
      color: downSoftColor,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `SL ${formatChartPrice(trade.stopPrice)}`
    });

    const isLong = trade.side === "long";
    const markers: SeriesMarker<UTCTimestamp>[] = [];
    if (candleIsRevealed(entryCandle, currentReplayCandle)) {
      markers.push({
        time: entryCandle.time,
        position: isLong ? "belowBar" : "aboveBar",
        shape: isLong ? "arrowUp" : "arrowDown",
        color: isLong ? upSoftColor : downSoftColor,
        text: "Entry",
        size: 1.25
      });
    }
    if (candleIsRevealed(exitCandle, currentReplayCandle)) {
      markers.push({
        time: exitCandle.time,
        position: isLong ? "aboveBar" : "belowBar",
        shape: isLong ? "arrowDown" : "arrowUp",
        color: isLong ? downSoftColor : upSoftColor,
        text: "Exit",
        size: 1.25
      });
    }
    const markerLayer = createSeriesMarkers(series, markers, { zOrder: "top" });

    const entryPosition = candleIndex(mappedCandles, entryCandle);
    const exitPosition = candleIndex(mappedCandles, exitCandle);
    const tradeWindow = Math.max(10, Math.abs(exitPosition - entryPosition) + 1);
    const visibleCandleCount = Math.max(1, candleData.length);
    const windowSize = Math.min(visibleCandleCount, Math.max(45, Math.ceil(tradeWindow * 3)));
    const anchor = Math.max(0, entryPosition);
    let from = Math.max(0, anchor - Math.floor(windowSize * 0.35));
    let to = Math.min(visibleCandleCount - 1, from + windowSize - 1);
    if (to - from + 1 < windowSize) from = Math.max(0, to - windowSize + 1);

    chart.timeScale().fitContent();
    chart.timeScale().setVisibleLogicalRange({ from, to });

    const handleCrosshairMove = (param: { time?: unknown }) => {
      if (typeof param.time !== "number") return;
      const source = sourceByTime.get(param.time);
      if (source) setActiveBar(source);
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      markerLayer.detach();
      chart.remove();
    };
  }, [
    candleData,
    chartTheme,
    currentReplayCandle,
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
        <div className="tradeChartLevels">
          <span>
            Entry <strong>{formatChartPrice(trade.entryPrice)}</strong>
          </span>
          <span>
            Exit <strong>{formatChartPrice(trade.exitPrice)}</strong>
          </span>
          <span>
            TP <strong>{formatChartPrice(trade.targetPrice)}</strong>
          </span>
          <span>
            SL <strong>{formatChartPrice(trade.stopPrice)}</strong>
          </span>
        </div>
        <div ref={containerRef} className="tradePriceChart" aria-label={`${trade.symbol} TradingView Lightweight candlestick chart`} />
      </div>
      {replayControls}
    </section>
  );
}
