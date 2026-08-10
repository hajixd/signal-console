export type OpenTradeChartBar = {
  index: number;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type OpenTradeChartTrade = {
  dollarsPerPricePoint: number;
  entryIndex: number;
  entryPrice: number;
  entryTime: string;
  side: "long" | "short";
};

export type OpenTradeChartPoint = {
  high: number;
  low: number;
  price: number;
  relCand: number;
  timeMs: number;
  x: number;
};

export type ManagedLevelTimelinePoint = {
  timeMs: number;
  value: number;
};

export function buildManagedLevelTimeline(
  initialValue: number,
  startMs: number,
  endMs: number,
  changes: ManagedLevelTimelinePoint[]
): ManagedLevelTimelinePoint[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return [{ timeMs: startMs, value: initialValue }];
  }

  const points: ManagedLevelTimelinePoint[] = [{ timeMs: startMs, value: initialValue }];
  let currentValue = initialValue;
  let lastMs = startMs;
  for (const change of [...changes].sort((left, right) => left.timeMs - right.timeMs)) {
    if (!Number.isFinite(change.timeMs) || !Number.isFinite(change.value) || change.timeMs < startMs || change.timeMs > endMs) continue;
    const stepMs = Math.max(lastMs + 1000, Math.min(change.timeMs, endMs));
    if (stepMs > lastMs) points.push({ timeMs: stepMs, value: currentValue });
    const adjustedMs = Math.max(stepMs + 1000, Math.min(change.timeMs + 1000, endMs));
    currentValue = change.value;
    if (adjustedMs > stepMs) {
      points.push({ timeMs: adjustedMs, value: currentValue });
      lastMs = adjustedMs;
    } else {
      points[points.length - 1] = { timeMs: stepMs, value: currentValue };
      lastMs = stepMs;
    }
  }

  if (endMs > lastMs) points.push({ timeMs: endMs, value: currentValue });
  return points;
}

export function resolveActiveTradeOverlayEnd<T>(
  exitRevealed: boolean,
  exitValue: T | null,
  currentValue: T | null
): T | null {
  return exitRevealed && exitValue ? exitValue : currentValue ?? exitValue;
}

export function mergeLiveOpenTradeBar(
  bars: OpenTradeChartBar[],
  liveBar: Omit<OpenTradeChartBar, "index"> & { index?: number }
): OpenTradeChartBar[] {
  const liveTimeMs = Date.parse(liveBar.time);
  if (!Number.isFinite(liveTimeMs)) return bars;

  const existingPosition = bars.findIndex((bar) => Date.parse(bar.time) === liveTimeMs);
  if (existingPosition >= 0) {
    const existing = bars[existingPosition]!;
    const unchanged =
      existing.open === liveBar.open &&
      existing.high === liveBar.high &&
      existing.low === liveBar.low &&
      existing.close === liveBar.close &&
      existing.volume === liveBar.volume;
    if (unchanged) return bars;
    const next = bars.slice();
    next[existingPosition] = { ...liveBar, index: existing.index };
    return next;
  }

  const last = bars.at(-1);
  const lastTimeMs = last ? Date.parse(last.time) : NaN;
  if (last && Number.isFinite(lastTimeMs) && liveTimeMs < lastTimeMs) return bars;
  const minuteDistance = Number.isFinite(lastTimeMs)
    ? Math.max(1, Math.round((liveTimeMs - lastTimeMs) / 60_000))
    : 1;
  const index = Number.isFinite(liveBar.index)
    ? Number(liveBar.index)
    : last
      ? last.index + minuteDistance
      : 0;
  return [...bars, { ...liveBar, index }];
}

export function buildManagedLevelStepPath(
  points: Array<{ value: number; x: number }>,
  xMax: number,
  scaleX: (value: number) => number,
  scaleY: (value: number) => number
): string {
  const first = points[0];
  if (!first) return "";
  const commands = [`M ${scaleX(first.x).toFixed(2)} ${scaleY(first.value).toFixed(2)}`];
  for (const point of points.slice(1)) {
    commands.push(`H ${scaleX(point.x).toFixed(2)}`, `V ${scaleY(point.value).toFixed(2)}`);
  }
  commands.push(`H ${scaleX(xMax).toFixed(2)}`);
  return commands.join(" ");
}

function nearestEntryPosition(trade: OpenTradeChartTrade, bars: OpenTradeChartBar[]): number | null {
  if (!bars.length) return null;
  const entryMs = Date.parse(trade.entryTime);
  if (Number.isFinite(entryMs)) {
    let bestPosition = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let position = 0; position < bars.length; position += 1) {
      const timeMs = Date.parse(bars[position]!.time);
      if (!Number.isFinite(timeMs)) continue;
      const distance = Math.abs(timeMs - entryMs);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPosition = position;
      }
    }
    if (Number.isFinite(bestDistance)) return bestPosition;
  }

  let bestPosition = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let position = 0; position < bars.length; position += 1) {
    const distance = Math.abs(bars[position]!.index - trade.entryIndex);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPosition = position;
    }
  }
  return bestPosition;
}

export function resolveOpenTradePathRange(trade: OpenTradeChartTrade, bars: OpenTradeChartBar[]) {
  const start = nearestEntryPosition(trade, bars);
  if (start == null) return null;
  const end = Math.max(start, bars.length - 1);
  const latestBar = bars[end]!;
  return {
    boundary: null,
    end,
    entryTime: bars[start]!.time,
    exitPrice: latestBar.close,
    exitTime: latestBar.time,
    start
  };
}

export function buildOpenTradeChartPoints(
  trade: OpenTradeChartTrade,
  bars: OpenTradeChartBar[]
): OpenTradeChartPoint[] {
  const range = resolveOpenTradePathRange(trade, bars);
  if (!range) return [];
  const entryMs = Date.parse(trade.entryTime);
  const safeEntryMs = Number.isFinite(entryMs) ? entryMs : Date.parse(range.entryTime);
  const points: OpenTradeChartPoint[] = [
    {
      high: trade.entryPrice,
      low: trade.entryPrice,
      price: trade.entryPrice,
      relCand: -1,
      timeMs: safeEntryMs,
      x: 0
    }
  ];

  let previousPrice = trade.entryPrice;
  for (let position = range.start; position <= range.end; position += 1) {
    const bar = bars[position]!;
    const timeMs = Date.parse(bar.time);
    const safeTimeMs = Number.isFinite(timeMs) ? timeMs : safeEntryMs + (position - range.start + 1) * 60_000;
    const close = Number.isFinite(bar.close) ? bar.close : previousPrice;
    points.push({
      high: Number.isFinite(bar.high) ? bar.high : close,
      low: Number.isFinite(bar.low) ? bar.low : close,
      price: close,
      relCand: position - range.start,
      timeMs: safeTimeMs,
      x: Math.max(1, Math.ceil((safeTimeMs - safeEntryMs) / 60_000))
    });
    previousPrice = close;
  }

  return points.length >= 2 ? points : [];
}

export function latestOpenTradeMark(trade: OpenTradeChartTrade, bars: OpenTradeChartBar[]) {
  const range = resolveOpenTradePathRange(trade, bars);
  if (!range) return null;
  const direction = trade.side === "long" ? 1 : -1;
  return {
    exitPrice: range.exitPrice,
    exitTime: range.exitTime,
    pnlDollars:
      Math.round((range.exitPrice - trade.entryPrice) * direction * trade.dollarsPerPricePoint * 100) / 100
  };
}
