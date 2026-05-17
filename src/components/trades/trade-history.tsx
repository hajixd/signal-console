"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import { createPortal } from "react-dom";
import { useAutoTradeAdminMode } from "@/components/auto-trading/use-auto-trade-account-mode";
import TradePriceChart, { TRADE_CHART_TIMEFRAMES, type TradeChartBar, type TradeChartTimeframe } from "@/components/trades/trade-price-chart";
import LocalDateTime from "@/components/ui/local-date-time";

export type TradeHistoryRow = {
  id: string;
  strategyKey: string;
  rowClassName: string;
  pnlClassName: string;
  pnlDollars: number;
  indexLabel: string;
  symbol: string;
  modelName: string;
  marketLabel: string;
  market?: string;
  side: "long" | "short";
  sideLabel: string;
  sideClassName: string;
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
  signalTimeLabel: string;
  entryTimeLabel: string;
  exitTimeLabel: string;
  entryPriceLabel: string;
  exitPriceLabel: string;
  targetPriceLabel: string;
  stopPriceLabel: string;
  durationLabel: string;
  durationDetailLabel: string;
  exitReasonLabel: string;
  pnlLabel: string;
  rMultipleLabel: string;
  netUnitsLabel: string;
  sizeLabel: string;
  sizeMultiplier: number;
  targetRiskLabel: string;
  targetLabel: string;
  riskLabel: string;
  targetDollars: number;
  riskDollars: number;
  dollarsPerPricePoint: number;
  tpUnitsLabel: string;
  slUnitsLabel: string;
};

type TradeHistoryProps = {
  rows: TradeHistoryRow[];
};

type ChartBar = TradeChartBar;

type ChartState = {
  status: "idle" | "loading" | "ready" | "error";
  bars: ChartBar[];
  replayBars?: ChartBar[];
  replayTimeframe?: TradeChartTimeframe;
  sourceBars?: ChartBar[];
  fallback?: boolean;
  message?: string;
  requestedTimeframe?: TradeChartTimeframe;
  timeframe?: TradeChartTimeframe;
};

type ChartPayload = {
  bars?: ChartBar[];
  replayBars?: ChartBar[];
  replayTimeframe?: TradeChartTimeframe;
  error?: string;
  fallback?: boolean;
  requestedTimeframe?: TradeChartTimeframe;
  timeframe?: TradeChartTimeframe;
};

type CandleMenuState = {
  clientX: number;
  clientY: number;
  candle: ChartBar;
};

const TRADE_CHART_CONTEXT_CANDLES = 240;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatChartPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: Math.abs(value) >= 100 ? 2 : 0,
    maximumFractionDigits: Math.abs(value) < 10 ? 5 : 2
  });
}

function formatSignedMoney(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0
  })}`;
}

function formatMoney(value: number, signed = false): string {
  if (!Number.isFinite(value)) return "--";
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0
  }).format(value);
  return signed && value > 0 ? `+${formatted}` : formatted;
}

function formatLossMoney(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return `-$${Math.abs(value).toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0
  })}`;
}

function timeLabel(value: string | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function axisTimeLabel(value: string | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function nearestPositionForAnchor(bars: ChartBar[], indexValue: number, timeValue?: string): number | null {
  if (!bars.length) return null;
  const targetTime = timeValue ? Date.parse(timeValue) : NaN;
  if (Number.isFinite(targetTime)) {
    let bestPosition = 0;
    let bestDistance = Infinity;

    for (let position = 0; position < bars.length; position += 1) {
      const barTime = Date.parse(bars[position]!.time);
      if (!Number.isFinite(barTime)) continue;
      const distance = Math.abs(barTime - targetTime);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPosition = position;
      }
    }

    if (Number.isFinite(bestDistance)) return bestPosition;
  }

  if (!Number.isFinite(indexValue)) return null;
  let bestPosition = 0;
  let bestDistance = Infinity;

  for (let position = 0; position < bars.length; position += 1) {
    const distance = Math.abs(bars[position]!.index - indexValue);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPosition = position;
    }
  }

  return bestPosition;
}

function tradePathStats(trade: TradeHistoryRow, bars: ChartBar[]): { mfe: number | null; mae: number | null } {
  const entryPosition = nearestPositionForAnchor(bars, trade.entryIndex, trade.entryTime);
  const exitPosition = resolvedExitPositionForTrade(trade, bars);
  if (entryPosition == null || exitPosition == null || !bars.length) return { mfe: null, mae: null };

  const start = Math.min(entryPosition, exitPosition);
  const end = Math.max(entryPosition, exitPosition);
  const direction = trade.side === "long" ? 1 : -1;
  const dollarsPerPoint = Math.max(0, trade.dollarsPerPricePoint || 0);
  let maxFavorable = 0;
  let maxAdverse = 0;

  for (let position = start; position <= end; position += 1) {
    const bar = bars[position];
    if (!bar) continue;
    const favorablePrice = direction === 1 ? bar.high : bar.low;
    const adversePrice = direction === 1 ? bar.low : bar.high;
    const favorable = Math.max(0, (favorablePrice - trade.entryPrice) * direction * dollarsPerPoint);
    const adverse = Math.max(0, -((adversePrice - trade.entryPrice) * direction * dollarsPerPoint));
    maxFavorable = Math.max(maxFavorable, favorable);
    maxAdverse = Math.max(maxAdverse, adverse);
  }

  return {
    mfe: Number.isFinite(maxFavorable) ? Math.min(maxFavorable, Math.max(0, trade.targetDollars)) : null,
    mae: Number.isFinite(maxAdverse) ? Math.min(maxAdverse, Math.max(0, trade.riskDollars)) : null
  };
}

function priceTouched(bar: ChartBar, price: number): boolean {
  return Number.isFinite(price) && bar.low <= price && bar.high >= price;
}

function barProtectiveTouch(trade: TradeHistoryRow, bar: ChartBar): "tp" | "sl" | null {
  const touchesTarget = priceTouched(bar, trade.targetPrice);
  const touchesStop = priceTouched(bar, trade.stopPrice);
  if (!touchesTarget && !touchesStop) return null;
  if (touchesTarget && !touchesStop) return "tp";
  if (!touchesTarget && touchesStop) return "sl";

  const targetDistance = Math.abs(bar.open - trade.targetPrice);
  const stopDistance = Math.abs(bar.open - trade.stopPrice);
  return targetDistance <= stopDistance ? "tp" : "sl";
}

function exitTouchPrice(trade: TradeHistoryRow): number | null {
  const targetTolerance = Math.max(Math.abs(trade.targetPrice) * 0.00001, 0.00001);
  const stopTolerance = Math.max(Math.abs(trade.stopPrice) * 0.00001, 0.00001);
  if (Math.abs(trade.exitPrice - trade.targetPrice) <= targetTolerance) return trade.targetPrice;
  if (Math.abs(trade.exitPrice - trade.stopPrice) <= stopTolerance) return trade.stopPrice;
  return null;
}

function resolvedProtectiveExit(
  trade: TradeHistoryRow,
  bars: ChartBar[]
): { bar: ChartBar; position: number; reason: "tp" | "sl" } | null {
  const entryPosition = nearestPositionForAnchor(bars, trade.entryIndex, trade.entryTime);
  const fallbackExitPosition = nearestPositionForAnchor(bars, trade.exitIndex, trade.exitTime);
  if (entryPosition == null || fallbackExitPosition == null || !bars.length) return null;

  const start = Math.min(entryPosition, fallbackExitPosition);
  const end = Math.max(entryPosition, fallbackExitPosition);
  for (let position = start; position <= end; position += 1) {
    const bar = bars[position];
    if (!bar) continue;
    const reason = barProtectiveTouch(trade, bar);
    if (reason) return { bar, position, reason };
  }

  return null;
}

function resolvedExitPositionForTrade(trade: TradeHistoryRow, bars: ChartBar[]): number | null {
  const entryPosition = nearestPositionForAnchor(bars, trade.entryIndex, trade.entryTime);
  const fallbackExitPosition = nearestPositionForAnchor(bars, trade.exitIndex, trade.exitTime);
  if (entryPosition == null) return fallbackExitPosition;

  const targetPrice = exitTouchPrice(trade);
  if (targetPrice == null) return fallbackExitPosition;

  for (let position = entryPosition; position < bars.length; position += 1) {
    const bar = bars[position];
    if (bar && priceTouched(bar, targetPrice)) return position;
  }

  return fallbackExitPosition;
}

function resolvedTradeForDisplay(trade: TradeHistoryRow, bars: ChartBar[]): TradeHistoryRow {
  const protectiveExit = resolvedProtectiveExit(trade, bars);
  if (!protectiveExit) return trade;

  const exitPrice = protectiveExit.reason === "tp" ? trade.targetPrice : trade.stopPrice;
  const pnlDollars = protectiveExit.reason === "tp" ? Math.abs(trade.targetDollars) : -Math.abs(trade.riskDollars);
  const pnlClassName = resultClassName(pnlDollars);
  const rMultiple = trade.riskDollars > 0 ? pnlDollars / trade.riskDollars : 0;

  return {
    ...trade,
    rowClassName: rowClassNameForPnl(pnlDollars),
    pnlClassName,
    pnlDollars,
    exitIndex: protectiveExit.bar.index,
    exitTime: protectiveExit.bar.time,
    exitPrice,
    exitTimeLabel: timeLabel(protectiveExit.bar.time),
    exitPriceLabel: `$${formatChartPrice(exitPrice)}`,
    exitReasonLabel: protectiveExit.reason === "tp" ? "Take Profit" : "Stop Loss",
    pnlLabel: formatMoney(pnlDollars, true),
    rMultipleLabel: `${rMultiple.toLocaleString(undefined, {
      minimumFractionDigits: Number.isInteger(rMultiple) ? 0 : 2,
      maximumFractionDigits: 2
    })}R`
  };
}

function correctedDurationLabel(trade: TradeHistoryRow, bars: ChartBar[]): string {
  const entryPosition = nearestPositionForAnchor(bars, trade.entryIndex, trade.entryTime);
  const exitPosition = resolvedExitPositionForTrade(trade, bars);
  if (entryPosition == null || exitPosition == null) return `${trade.durationLabel} / ${trade.durationDetailLabel}`;

  const barsHeld = Math.max(1, Math.abs(exitPosition - entryPosition) + 1);
  const entryTime = Date.parse(bars[entryPosition]?.time ?? trade.entryTime);
  const exitTime = Date.parse(bars[exitPosition]?.time ?? trade.exitTime);
  const detail = Number.isFinite(entryTime) && Number.isFinite(exitTime) ? durationFromMs(Math.abs(exitTime - entryTime)) : trade.durationDetailLabel;
  return `${barsHeld.toLocaleString()} ${barsHeld === 1 ? "bar" : "bars"} / ${detail}`;
}

function durationFromMs(value: number): string {
  let remainingMinutes = Math.round(value / 60_000);
  const days = Math.floor(remainingMinutes / 1440);
  remainingMinutes -= days * 1440;
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes - hours * 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

function InfoBox({
  label,
  value,
  tone = "neutral",
  valueClassName
}: {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "green" | "red" | "blue" | "amber";
  valueClassName?: string;
}) {
  return (
    <div className={`tradeInfoBox tone-${tone}`}>
      <strong className="tradeInfoLabel">{label}</strong>
      <strong className={`tradeInfoValue${valueClassName ? ` ${valueClassName}` : ""}`}>{value || "N/A"}</strong>
    </div>
  );
}

function resultClassName(value: number): string {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "neutral";
}

function rowClassNameForPnl(value: number): string {
  if (value > 0) return "up-row";
  if (value < 0) return "down-row";
  return "neutral-row";
}

function exitReasonClassName(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes("take profit")) return "exitReasonBadge exitTakeProfit";
  if (normalized.includes("stop loss")) return "exitReasonBadge exitStopLoss";
  if (normalized.includes("max")) return "exitReasonBadge exitMaxBars";
  if (normalized.includes("signal")) return "exitReasonBadge exitSignal";
  if (normalized.includes("time")) return "exitReasonBadge exitTime";
  return "exitReasonBadge exitOther";
}

function TradeCandlestickChart({
  trade,
  bars,
  status
}: {
  trade: TradeHistoryRow;
  bars: ChartBar[];
  status: ChartState["status"];
}) {
  const chartWidth = 1040;
  const chartHeight = 360;
  const pad = 16;
  const plot = { x: pad, y: pad, width: chartWidth - pad * 2, height: chartHeight - pad * 2 - 30 };
  const candleCount = bars.length;
  const entryPosition = useMemo(() => nearestPositionForAnchor(bars, trade.entryIndex, trade.entryTime), [bars, trade.entryIndex, trade.entryTime]);
  const exitPosition = useMemo(() => nearestPositionForAnchor(bars, trade.exitIndex, trade.exitTime), [bars, trade.exitIndex, trade.exitTime]);
  const initialRange = useMemo(() => {
    if (!candleCount) return { start: 0, end: 0 };
    const tradeLength =
      entryPosition != null && exitPosition != null ? Math.max(1, Math.abs(exitPosition - entryPosition) + 1) : 30;
    const windowSize = Math.max(30, Math.ceil(tradeLength * 3));
    const anchor = entryPosition ?? 0;
    let start = Math.max(0, anchor - Math.floor(windowSize * 0.35));
    let end = Math.min(candleCount - 1, start + windowSize - 1);

    if (end - start + 1 < Math.min(windowSize, candleCount)) {
      start = Math.max(0, end - windowSize + 1);
    }

    return { start, end };
  }, [candleCount, entryPosition, exitPosition]);
  const [viewRange, setViewRange] = useState(initialRange);
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);
  const [mousePoint, setMousePoint] = useState<{ x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<CandleMenuState | null>(null);
  const dragRef = useRef({
    dragging: false,
    startX: 0,
    startRange: initialRange
  });

  useEffect(() => {
    setViewRange(initialRange);
    setHoverPosition(null);
    setMousePoint(null);
    setContextMenu(null);
    dragRef.current = { dragging: false, startX: 0, startRange: initialRange };
  }, [initialRange, trade.id]);

  useEffect(() => {
    if (!contextMenu) return undefined;

    const close = () => setContextMenu(null);
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const closeOnMouse = (event: MouseEvent) => {
      if (event.button !== 2) close();
    };

    window.addEventListener("mousedown", closeOnMouse);
    window.addEventListener("scroll", close, true);
    window.addEventListener("wheel", close, true);
    window.addEventListener("keydown", closeOnKey);
    return () => {
      window.removeEventListener("mousedown", closeOnMouse);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("wheel", close, true);
      window.removeEventListener("keydown", closeOnKey);
    };
  }, [contextMenu]);

  if (status === "loading") {
    return (
      <section className="tradeCandlestickPanel isEmpty">
        <div className="tradeCandlestickHead">
          <strong>Trade Candlesticks</strong>
        </div>
        <span>Loading candles...</span>
      </section>
    );
  }

  if (!bars.length) {
    return (
      <section className="tradeCandlestickPanel isEmpty">
        <div className="tradeCandlestickHead">
          <strong>Trade Candlesticks</strong>
        </div>
        <span>No candles available for this trade.</span>
      </section>
    );
  }

  const safeStart = clamp(Math.min(viewRange.start, viewRange.end), 0, candleCount - 1);
  const safeEnd = clamp(Math.max(viewRange.start, viewRange.end), 0, candleCount - 1);
  const viewBars = bars.slice(safeStart, safeEnd + 1).map((bar, offset) => ({ bar, position: safeStart + offset }));
  const firstPosition = viewBars[0]?.position ?? safeStart;
  const lastPosition = viewBars[viewBars.length - 1]?.position ?? Math.max(safeStart + 1, safeEnd);
  const visibleSpan = Math.max(1, lastPosition - firstPosition);
  const direction = trade.side === "long" ? 1 : -1;
  const entrySide = direction === 1 ? "Buy" : "Sell";
  const exitSide = direction === 1 ? "Sell" : "Buy";
  const importantPrices = [trade.entryPrice, trade.exitPrice, trade.targetPrice, trade.stopPrice].filter(Number.isFinite);
  const lows = viewBars.map(({ bar }) => bar.low).filter(Number.isFinite);
  const highs = viewBars.map(({ bar }) => bar.high).filter(Number.isFinite);
  const minPrice = Math.min(...lows, ...importantPrices);
  const maxPrice = Math.max(...highs, ...importantPrices);
  const priceSpan = Math.max(0.0000001, maxPrice - minPrice);
  const yPadding = Math.max(priceSpan * 0.18, Math.abs(trade.entryPrice) * 0.0005, 0.5);
  const low = minPrice - yPadding;
  const high = maxPrice + yPadding;
  const candleWidth = Math.max(2, Math.min(18, (plot.width / Math.max(1, viewBars.length)) * 0.7));
  const hoveredBar = hoverPosition == null ? null : bars[hoverPosition] ?? null;
  const entryInView = entryPosition != null && entryPosition >= firstPosition && entryPosition <= lastPosition;
  const exitInView = exitPosition != null && exitPosition >= firstPosition && exitPosition <= lastPosition;

  function xForPosition(position: number): number {
    return plot.x + ((position - firstPosition) / visibleSpan) * plot.width;
  }

  function yForPrice(price: number): number {
    return plot.y + ((high - price) / (high - low || 1)) * plot.height;
  }

  function positionFromMouseX(x: number): number {
    const pct = clamp((x - plot.x) / plot.width, 0, 1);
    return Math.round(firstPosition + pct * visibleSpan);
  }

  function svgPoint(event: ReactMouseEvent<SVGSVGElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * chartWidth,
      y: ((event.clientY - rect.top) / rect.height) * chartHeight
    };
  }

  function handleMouseMove(event: ReactMouseEvent<SVGSVGElement>) {
    const point = svgPoint(event);
    setMousePoint(point);

    if (dragRef.current.dragging) {
      const deltaX = point.x - dragRef.current.startX;
      const visibleBars = dragRef.current.startRange.end - dragRef.current.startRange.start + 1;
      const barsPerPixel = visibleBars / plot.width;
      const shift = Math.round(-deltaX * barsPerPixel);
      let nextStart = dragRef.current.startRange.start + shift;
      let nextEnd = dragRef.current.startRange.end + shift;

      if (nextStart < 0) {
        nextEnd -= nextStart;
        nextStart = 0;
      }
      if (nextEnd > candleCount - 1) {
        const overshoot = nextEnd - (candleCount - 1);
        nextStart = Math.max(0, nextStart - overshoot);
        nextEnd = candleCount - 1;
      }

      setViewRange({ start: nextStart, end: nextEnd });
      return;
    }

    setHoverPosition(clamp(positionFromMouseX(point.x), 0, candleCount - 1));
  }

  function handleMouseDown(event: ReactMouseEvent<SVGSVGElement>) {
    if (event.button === 2) return;
    const point = svgPoint(event);
    dragRef.current = {
      dragging: true,
      startX: point.x,
      startRange: { start: safeStart, end: safeEnd }
    };
  }

  function handleMouseLeave() {
    setMousePoint(null);
    setHoverPosition(null);
    dragRef.current.dragging = false;
  }

  function handleWheel(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault();
    if (candleCount < 5) return;
    const point = svgPoint(event);
    const centerPosition = clamp(positionFromMouseX(point.x), 0, candleCount - 1);
    const currentWindow = Math.max(5, safeEnd - safeStart + 1);
    const nextWindow = clamp(Math.round(currentWindow * (event.deltaY < 0 ? 0.85 : 1.18)), 10, candleCount);
    const anchorPct = currentWindow <= 1 ? 0.5 : (centerPosition - safeStart) / currentWindow;
    let nextStart = Math.round(centerPosition - nextWindow * anchorPct);
    let nextEnd = nextStart + nextWindow - 1;

    if (nextStart < 0) {
      nextEnd -= nextStart;
      nextStart = 0;
    }
    if (nextEnd > candleCount - 1) {
      const overshoot = nextEnd - (candleCount - 1);
      nextStart = Math.max(0, nextStart - overshoot);
      nextEnd = candleCount - 1;
    }

    setViewRange({ start: nextStart, end: nextEnd });
  }

  function handleContextMenu(event: ReactMouseEvent<SVGSVGElement>) {
    const point = svgPoint(event);
    const position = clamp(positionFromMouseX(point.x), 0, candleCount - 1);
    const candle = bars[position];
    if (!candle) return;
    event.preventDefault();
    setContextMenu({ clientX: event.clientX, clientY: event.clientY, candle });
  }

  function drawLevel(price: number, color: string, label: string, solid = false) {
    if (!Number.isFinite(price)) return null;
    const y = yForPrice(price);
    return (
      <g>
        <line
          x1={plot.x}
          y1={y}
          x2={plot.x + plot.width}
          y2={y}
          stroke={color}
          strokeDasharray={solid ? undefined : "6 6"}
          opacity={0.92}
        />
        <text x={plot.x + 8} y={y - 6} fill={color} fontSize={12} fontFamily="ui-sans-serif, system-ui">
          {label} {formatChartPrice(price)}
        </text>
      </g>
    );
  }

  function arrow(x: number, tipY: number, arrowDirection: "up" | "down", color: string) {
    const head = 5;
    const stem = 7;
    const headPath =
      arrowDirection === "up"
        ? `M ${x} ${tipY} L ${x - head} ${tipY + head} L ${x + head} ${tipY + head} Z`
        : `M ${x} ${tipY} L ${x - head} ${tipY - head} L ${x + head} ${tipY - head} Z`;
    const stemY1 = arrowDirection === "up" ? tipY + head : tipY - head;
    const stemY2 = arrowDirection === "up" ? tipY + head + stem : tipY - head - stem;

    return (
      <g>
        <path d={headPath} fill={color} stroke="rgba(0,0,0,0.55)" strokeWidth={1.2} opacity={0.98} />
        <line x1={x} y1={stemY1} x2={x} y2={stemY2} stroke={color} strokeWidth={1.7} strokeLinecap="round" opacity={0.98} />
      </g>
    );
  }

  function markerAt(position: number, label: string, placement: "above" | "below", arrowDirection: "up" | "down", color: string) {
    const bar = bars[position];
    if (!bar) return null;
    const x = xForPosition(position);
    const highY = yForPrice(bar.high);
    const lowY = yForPrice(bar.low);
    const tipY =
      placement === "below"
        ? clamp(lowY + 4, plot.y + 6, plot.y + plot.height - 6)
        : clamp(highY - 4, plot.y + 6, plot.y + plot.height - 6);
    const textY = placement === "below" ? tipY + 18 : tipY - 12;

    return (
      <g>
        {arrow(x, tipY, arrowDirection, color)}
        <text
          x={x}
          y={textY}
          fill={color}
          fontSize={8}
          textAnchor="middle"
          fontFamily="ui-sans-serif, system-ui"
          fontWeight={650}
          style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.75)", strokeWidth: 3 }}
        >
          {label}
        </text>
      </g>
    );
  }

  const xAxisTicks = Array.from({ length: Math.min(6, Math.max(3, Math.floor(viewBars.length / 30) + 2)) })
    .map((_, tickIndex, ticks) => {
      const indexInView = ticks.length <= 1 ? 0 : Math.round((tickIndex * (viewBars.length - 1)) / (ticks.length - 1));
      const point = viewBars[indexInView];
      if (!point) return null;
      return {
        key: `${tickIndex}-${point.position}-${point.bar.time}`,
        x: xForPosition(point.position),
        label: axisTimeLabel(point.bar.time)
      };
    })
    .filter((tick): tick is { key: string; x: number; label: string } => Boolean(tick?.label));

  return (
    <section className="tradeCandlestickPanel">
      <div className="tradeCandlestickHead">
        <strong>Trade Candlesticks</strong>
        <span>Showing {viewBars.length} / {candleCount} candles</span>
      </div>

      <svg
        className="tradeCandlestickSvg"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${trade.symbol} trade candlestick chart`}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={() => {
          dragRef.current.dragging = false;
        }}
        onWheel={handleWheel}
        onDoubleClick={() => setViewRange(initialRange)}
        onContextMenu={handleContextMenu}
      >
        <rect x={0} y={0} width={chartWidth} height={chartHeight} fill="rgba(0,0,0,0.92)" />

        {Array.from({ length: 6 }).map((_, index) => {
          const y = plot.y + (plot.height * index) / 5;
          return <line key={`grid-y-${index}`} x1={plot.x} y1={y} x2={plot.x + plot.width} y2={y} stroke="rgba(255,255,255,0.10)" strokeDasharray="4 6" />;
        })}
        {Array.from({ length: 8 }).map((_, index) => {
          const x = plot.x + (plot.width * index) / 7;
          return <line key={`grid-x-${index}`} x1={x} y1={plot.y} x2={x} y2={plot.y + plot.height} stroke="rgba(255,255,255,0.10)" strokeDasharray="4 6" />;
        })}

        <line x1={plot.x} y1={plot.y + plot.height} x2={plot.x + plot.width} y2={plot.y + plot.height} stroke="rgba(255,255,255,0.22)" />
        {xAxisTicks.map((tick, index) => (
          <g key={tick.key}>
            <line x1={tick.x} y1={plot.y + plot.height} x2={tick.x} y2={plot.y + plot.height + 4} stroke="rgba(255,255,255,0.30)" />
            <text
              x={tick.x}
              y={plot.y + plot.height + 17}
              fill="rgba(255,255,255,0.68)"
              fontSize={11}
              fontFamily="ui-sans-serif, system-ui"
              textAnchor={index === 0 ? "start" : index === xAxisTicks.length - 1 ? "end" : "middle"}
            >
              {tick.label}
            </text>
          </g>
        ))}

        {drawLevel(trade.entryPrice, "#ffffff", "Entry", true)}
        {drawLevel(trade.targetPrice, "#34d399", "TP")}
        {drawLevel(trade.stopPrice, "#fb7185", "SL")}

        {viewBars.map(({ bar, position }, index) => {
          const up = bar.close >= bar.open;
          const color = up ? "rgba(52,211,153,0.92)" : "rgba(248,113,113,0.92)";
          const x = xForPosition(position);
          const openY = yForPrice(bar.open);
          const closeY = yForPrice(bar.close);
          const highY = yForPrice(bar.high);
          const lowY = yForPrice(bar.low);
          const bodyY = Math.min(openY, closeY);
          const bodyHeight = Math.max(2, Math.abs(closeY - openY));
          const hovered = hoverPosition === position;

          return (
            <g key={`${position}-${index}-${bar.index}-${bar.time}`}>
              <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth={2} opacity={0.95} />
              <rect x={x - candleWidth / 2} y={bodyY} width={candleWidth} height={bodyHeight} fill={color} opacity={0.92} rx={1.5} />
              {hovered ? (
                <rect
                  x={x - candleWidth / 2 - 2}
                  y={bodyY - 2}
                  width={candleWidth + 4}
                  height={bodyHeight + 4}
                  fill="none"
                  stroke="rgba(255,255,255,0.55)"
                  strokeWidth={1}
                  rx={2}
                />
              ) : null}
            </g>
          );
        })}

        {entryInView && entryPosition != null
          ? markerAt(
              entryPosition,
              "Entry",
              direction === 1 ? "below" : "above",
              direction === 1 ? "up" : "down",
              direction === 1 ? "#34d399" : "#fb7185"
            )
          : null}
        {exitInView && exitPosition != null
          ? markerAt(
              exitPosition,
              "Exit",
              direction === 1 ? "above" : "below",
              direction === 1 ? "down" : "up",
              direction === 1 ? "#fb7185" : "#34d399"
            )
          : null}

        {mousePoint && mousePoint.x >= plot.x && mousePoint.x <= plot.x + plot.width && mousePoint.y >= plot.y && mousePoint.y <= plot.y + plot.height ? (
          <g>
            <line x1={mousePoint.x} y1={plot.y} x2={mousePoint.x} y2={plot.y + plot.height} stroke="rgba(255,255,255,0.22)" strokeDasharray="4 6" />
            <line x1={plot.x} y1={mousePoint.y} x2={plot.x + plot.width} y2={mousePoint.y} stroke="rgba(255,255,255,0.22)" strokeDasharray="4 6" />
          </g>
        ) : null}

        {hoveredBar && mousePoint ? (
          <g>
            {(() => {
              const boxWidth = 260;
              const boxHeight = 90;
              let x = mousePoint.x + 12;
              let y = mousePoint.y + 12;
              if (x + boxWidth > chartWidth - 10) x = mousePoint.x - boxWidth - 12;
              if (y + boxHeight > chartHeight - 10) y = mousePoint.y - boxHeight - 12;
              return (
                <>
                  <rect x={x} y={y} width={boxWidth} height={boxHeight} rx={10} fill="rgba(15,15,15,0.92)" stroke="rgba(255,255,255,0.12)" />
                  <text x={x + 12} y={y + 22} fill="rgba(255,255,255,0.86)" fontSize={12} fontFamily="ui-sans-serif, system-ui">
                    {timeLabel(hoveredBar.time)}
                  </text>
                  <text x={x + 12} y={y + 44} fill="rgba(255,255,255,0.86)" fontSize={12} fontFamily="ui-sans-serif, system-ui">
                    O {formatChartPrice(hoveredBar.open)} H {formatChartPrice(hoveredBar.high)}
                  </text>
                  <text x={x + 12} y={y + 64} fill="rgba(255,255,255,0.86)" fontSize={12} fontFamily="ui-sans-serif, system-ui">
                    L {formatChartPrice(hoveredBar.low)} C {formatChartPrice(hoveredBar.close)}
                  </text>
                  <text x={x + 12} y={y + 84} fill="rgba(255,255,255,0.55)" fontSize={11} fontFamily="ui-sans-serif, system-ui">
                    idx {hoveredBar.index}
                  </text>
                </>
              );
            })()}
          </g>
        ) : null}
      </svg>

      {contextMenu ? (
        <CandleContextMenu state={contextMenu} />
      ) : null}
    </section>
  );
}

function CandleContextMenu({ state }: { state: CandleMenuState }) {
  const { candle } = state;
  const bullish = candle.close >= candle.open;
  const change = candle.close - candle.open;
  const changePct = candle.open !== 0 ? (change / candle.open) * 100 : 0;
  const range = candle.high - candle.low;
  const body = Math.abs(change);
  const date = new Date(candle.time);
  let left = state.clientX + 4;
  let top = state.clientY + 4;

  if (typeof window !== "undefined") {
    if (left + 250 > window.innerWidth - 8) left = state.clientX - 254;
    if (top + 270 > window.innerHeight - 8) top = state.clientY - 274;
  }

  function row(label: string, value: string, tone: string) {
    return (
      <div className="tradeCandleContextRow" key={label}>
        <span>{label}</span>
        <strong style={{ color: tone }}>{value}</strong>
      </div>
    );
  }

  return (
    <div className="tradeCandleContextMenu" style={{ left, top }} onContextMenu={(event) => event.preventDefault()}>
      <div className="tradeCandleContextHead">
        <span>{date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
        <span>{date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div className="tradeCandleContextTone">
        <i style={{ background: bullish ? "#34d399" : "#fb7185" }} />
        <strong style={{ color: bullish ? "#34d399" : "#fb7185" }}>{bullish ? "Bullish" : "Bearish"}</strong>
      </div>
      {row("Open", formatChartPrice(candle.open), "rgba(255,255,255,0.85)")}
      {row("High", formatChartPrice(candle.high), "#34d399")}
      {row("Low", formatChartPrice(candle.low), "#fb7185")}
      {row("Close", formatChartPrice(candle.close), bullish ? "#34d399" : "#fb7185")}
      <div className="tradeCandleContextRule" />
      {row("Change", `${change >= 0 ? "+" : ""}${formatChartPrice(change)} (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)`, bullish ? "#34d399" : "#fb7185")}
      {row("Range", formatChartPrice(range), "#fbbf24")}
      {row("Body", formatChartPrice(body), "rgba(255,255,255,0.50)")}
    </div>
  );
}

export default function TradeHistory({ rows }: TradeHistoryProps) {
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [chartState, setChartState] = useState<ChartState>({ status: "idle", bars: [] });
  const [chartTimeframe, setChartTimeframe] = useState<TradeChartTimeframe>("15m");
  const isRestricted = !useAutoTradeAdminMode();
  const activeTrade = useMemo(
    () => (activeTradeId ? rows.find((row) => row.id === activeTradeId) ?? null : null),
    [activeTradeId, rows]
  );
  const activeSourceBars = chartState.sourceBars?.length ? chartState.sourceBars : chartState.bars;
  const activeDisplayTrade = useMemo(
    () => (activeTrade ? resolvedTradeForDisplay(activeTrade, activeSourceBars) : null),
    [activeTrade, activeSourceBars]
  );
  const activeChartTrade = useMemo(
    () =>
      activeDisplayTrade
        ? {
            id: activeDisplayTrade.id,
            symbol: activeDisplayTrade.symbol,
            side: activeDisplayTrade.side,
            entryIndex: activeDisplayTrade.entryIndex,
            exitIndex: activeDisplayTrade.exitIndex,
            signalTime: activeDisplayTrade.signalTime,
            entryTime: activeDisplayTrade.entryTime,
            exitTime: activeDisplayTrade.exitTime,
            sourceTimeframe: activeDisplayTrade.sourceTimeframe,
            phase: activeDisplayTrade.phase,
            variantId: activeDisplayTrade.variantId,
            modelName: activeDisplayTrade.modelName,
            entryType: activeDisplayTrade.entryType,
            entryPrice: activeDisplayTrade.entryPrice,
            exitPrice: activeDisplayTrade.exitPrice,
            targetPrice: activeDisplayTrade.targetPrice,
            stopPrice: activeDisplayTrade.stopPrice,
            targetDollars: activeDisplayTrade.targetDollars,
            riskDollars: activeDisplayTrade.riskDollars,
            dollarsPerPricePoint: activeDisplayTrade.dollarsPerPricePoint,
            pnlLabel: activeDisplayTrade.pnlLabel
          }
        : null,
    [
      activeDisplayTrade?.entryIndex,
      activeDisplayTrade?.entryPrice,
      activeDisplayTrade?.entryTime,
      activeDisplayTrade?.entryType,
      activeDisplayTrade?.exitIndex,
      activeDisplayTrade?.exitPrice,
      activeDisplayTrade?.exitTime,
      activeDisplayTrade?.id,
      activeDisplayTrade?.modelName,
      activeDisplayTrade?.phase,
      activeDisplayTrade?.pnlLabel,
      activeDisplayTrade?.side,
      activeDisplayTrade?.signalTime,
      activeDisplayTrade?.sourceTimeframe,
      activeDisplayTrade?.stopPrice,
      activeDisplayTrade?.symbol,
      activeDisplayTrade?.targetDollars,
      activeDisplayTrade?.targetPrice,
      activeDisplayTrade?.riskDollars,
      activeDisplayTrade?.dollarsPerPricePoint,
      activeDisplayTrade?.variantId
    ]
  );
  const activeStats = activeDisplayTrade ? tradePathStats(activeDisplayTrade, activeSourceBars) : { mfe: null, mae: null };
  const activeDurationLabel = activeDisplayTrade ? correctedDurationLabel(activeDisplayTrade, activeSourceBars) : "";

  function openTrade(trade: TradeHistoryRow) {
    if (isRestricted) return;
    setChartTimeframe(trade.sourceTimeframe ?? "15m");
    setActiveTradeId(trade.id);
  }

  useEffect(() => {
    if (isRestricted) setActiveTradeId(null);
  }, [isRestricted]);

  useEffect(() => {
    if (activeTradeId && !activeTrade) setActiveTradeId(null);
  }, [activeTrade, activeTradeId]);

  useEffect(() => {
    if (!activeTradeId) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setActiveTradeId(null);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeTradeId]);

  useEffect(() => {
    if (!activeTrade || isRestricted) {
      setChartState({ status: "idle", bars: [] });
      return undefined;
    }

    const controller = new AbortController();
    const sourceTimeframe = activeTrade.sourceTimeframe ?? "15m";
    const chartParams = (timeframeValue: TradeChartTimeframe) =>
      new URLSearchParams({
        symbol: activeTrade.symbol,
        market: activeTrade.market ?? "",
        entryIndex: String(activeTrade.entryIndex),
        exitIndex: String(activeTrade.exitIndex),
        entryTime: activeTrade.entryTime,
        exitTime: activeTrade.exitTime,
        timeframe: timeframeValue,
        context: String(TRADE_CHART_CONTEXT_CANDLES)
      });
    const fetchChartPayload = (timeframeValue: TradeChartTimeframe) =>
      fetch(`/api/trade-chart?${chartParams(timeframeValue).toString()}`, { signal: controller.signal }).then((response) =>
        response.ok ? (response.json() as Promise<ChartPayload>) : Promise.reject(new Error("Chart unavailable"))
      );

    setChartState({ status: "loading", bars: [] });
    Promise.all([
      fetchChartPayload(chartTimeframe),
      chartTimeframe === sourceTimeframe
        ? Promise.resolve(null)
        : fetchChartPayload(sourceTimeframe).catch((error: Error) => {
            if (error.name !== "AbortError") console.warn(error);
            return null;
          })
    ])
      .then(
        ([payload, sourcePayload]) => {
          const resolvedTimeframe = payload.timeframe && TRADE_CHART_TIMEFRAMES.some((option) => option.value === payload.timeframe)
            ? payload.timeframe
            : chartTimeframe;
          const requestedTimeframe =
            payload.requestedTimeframe && TRADE_CHART_TIMEFRAMES.some((option) => option.value === payload.requestedTimeframe)
              ? payload.requestedTimeframe
              : chartTimeframe;
          setChartState({
            status: "ready",
            bars: payload.bars ?? [],
            replayBars: payload.replayBars,
            replayTimeframe: payload.replayTimeframe,
            sourceBars: sourcePayload?.bars ?? payload.bars ?? [],
            fallback: Boolean(payload.fallback),
            message: payload.error,
            requestedTimeframe,
            timeframe: resolvedTimeframe
          });
        }
      )
      .catch((error: Error) => {
        if (error.name !== "AbortError") setChartState({ status: "error", bars: [] });
      });

    return () => controller.abort();
  }, [
    activeTrade?.entryIndex,
    activeTrade?.entryTime,
    activeTrade?.exitIndex,
    activeTrade?.exitTime,
    activeTrade?.id,
    activeTrade?.market,
    activeTrade?.sourceTimeframe,
    activeTrade?.symbol,
    chartTimeframe,
    isRestricted
  ]);

  const chartNotice =
    chartState.fallback && chartState.requestedTimeframe && chartState.timeframe
      ? `This timeframe is unavailable. Showing ${chartState.timeframe}.`
      : undefined;
  const displayedChartTimeframe = chartState.fallback && chartState.timeframe ? chartState.timeframe : chartTimeframe;

  const activeTradeModal = !isRestricted && activeTrade && activeDisplayTrade ? (
    <div
      className="tradeModalBackdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setActiveTradeId(null);
      }}
    >
      <section
        className={`tradeModal ${activeDisplayTrade.rowClassName}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${activeDisplayTrade.symbol} trade details`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="tradeModalHead">
          <div className="tradeModalTitle">
            <strong>{activeDisplayTrade.modelName}</strong>
            <span>{activeDisplayTrade.symbol} / {activeDisplayTrade.marketLabel}</span>
          </div>
          <div className="tradeModalHeadActions">
            <button type="button" className="tradeModalCloseButton" aria-label="Close trade details" title="Close" onClick={() => setActiveTradeId(null)}>
              <span aria-hidden="true">X</span>
            </button>
          </div>
        </div>

        <div className="tradeModalBody">
          <div className="tradeModalMetrics four">
            <InfoBox label="Entry Reason" value={`Model: ${activeDisplayTrade.modelName}`} tone="blue" />
            <InfoBox label="Entry Price" value={activeDisplayTrade.entryPriceLabel} />
            <InfoBox label="Exit Reason" value={activeDisplayTrade.exitReasonLabel} tone="blue" />
            <InfoBox label="Exit Price" value={activeDisplayTrade.exitPriceLabel} />
          </div>

          <div className="tradeModalMetrics six">
            <InfoBox label="PnL" value={activeDisplayTrade.pnlLabel} valueClassName={activeDisplayTrade.pnlClassName} tone={activeDisplayTrade.pnlClassName === "up" ? "green" : activeDisplayTrade.pnlClassName === "down" ? "red" : "neutral"} />
            <InfoBox label="Duration" value={activeDurationLabel} />
            <InfoBox label="Take Profit" value={`${activeDisplayTrade.targetPriceLabel} / ${activeDisplayTrade.targetLabel}`} tone="green" />
            <InfoBox label="Stop Loss" value={`${activeDisplayTrade.stopPriceLabel} / ${activeDisplayTrade.riskLabel}`} tone="red" />
            <InfoBox label="Peak (MFE)" value={activeStats.mfe == null ? "--" : formatSignedMoney(activeStats.mfe)} tone="green" />
            <InfoBox label="DD (MAE)" value={activeStats.mae == null ? "--" : formatLossMoney(activeStats.mae)} tone="red" />
          </div>

          <TradePriceChart
            bars={chartState.bars}
            dataTimeframe={chartState.timeframe ?? chartTimeframe}
            emptyMessage={chartState.message}
            notice={chartNotice}
            onTimeframeChange={setChartTimeframe}
            replayBars={chartState.replayBars}
            replayTimeframe={chartState.replayTimeframe}
            status={chartState.status}
            timeframe={displayedChartTimeframe}
            timeframes={TRADE_CHART_TIMEFRAMES}
            trade={activeChartTrade ?? activeTrade}
          />
        </div>
      </section>
    </div>
  ) : null;

  return (
    <>
      <div className="terminal-table-wrap tall historyScroll">
        <table className="terminal-table history-table">
          <colgroup>
            <col className="history-col-index" />
            <col className="history-col-ticker" />
            <col className="history-col-model" />
            <col className="history-col-direction" />
            <col className="history-col-price" />
            <col className="history-col-price" />
            <col className="history-col-duration" />
            <col className="history-col-exit" />
            <col className="history-col-pnl" />
            <col className="history-col-rmultiple" />
            <col className="history-col-size" />
            <col className="history-col-target" />
            <col className="history-col-stop" />
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th>Ticker</th>
              <th>Entry model</th>
              <th>Direction</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>Duration</th>
              <th>Exit by</th>
              <th>P&L $</th>
              <th>R</th>
              <th>Size</th>
              <th>Take Profit $</th>
              <th>Stop Loss $</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((trade) => {
              const displayedModelName = isRestricted ? "Admin only" : trade.modelName;
              return (
                <tr
                  className={`historyTradeRow ${trade.rowClassName}${isRestricted ? " isAccessRestricted" : ""}`}
                  key={trade.id}
                  role={isRestricted ? undefined : "button"}
                  tabIndex={isRestricted ? -1 : 0}
                  aria-disabled={isRestricted}
                  aria-label={isRestricted ? `${trade.symbol} trade details locked` : `Open ${trade.symbol} ${trade.modelName} trade details`}
                  onClick={isRestricted ? undefined : () => openTrade(trade)}
                  onKeyDown={(event) => {
                    if (isRestricted) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openTrade(trade);
                    }
                  }}
                >
                  <td data-label="#">{trade.indexLabel}</td>
                  <td className="ticker-cell" data-label="Ticker">{trade.symbol}</td>
                  <td className="main-cell" data-label="Entry model">
                    <span className={isRestricted ? "adminOnlyMaskedText" : undefined}>{displayedModelName}</span>
                    <small>{isRestricted ? "Strategy details locked" : <LocalDateTime value={trade.entryTime} />}</small>
                  </td>
                  <td data-label="Direction">
                    <span className={trade.sideClassName}>{trade.sideLabel}</span>
                  </td>
                  <td data-label="Entry">{trade.entryPriceLabel}</td>
                  <td data-label="Exit">{trade.exitPriceLabel}</td>
                  <td data-label="Duration">
                    {trade.durationLabel} <span className="durationDetail">/ {trade.durationDetailLabel}</span>
                  </td>
                  <td data-label="Exit by">
                    <span className={exitReasonClassName(trade.exitReasonLabel)}>{trade.exitReasonLabel}</span>
                  </td>
                  <td className={trade.pnlClassName} data-label="P&L $">{trade.pnlLabel}</td>
                  <td className={trade.pnlClassName} data-label="R">{trade.rMultipleLabel}</td>
                  <td data-label="Size">{trade.sizeLabel}</td>
                  <td className="take-profit-cell" data-label="Take Profit $">{trade.targetLabel}</td>
                  <td className="stop-loss-cell" data-label="Stop Loss $">{trade.riskLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {activeTradeModal ? createPortal(activeTradeModal, document.body) : null}
    </>
  );
}
