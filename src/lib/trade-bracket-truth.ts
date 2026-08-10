export type TradeBracketSide = "long" | "short";

export type TradeBracketBar = {
  index: number;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type TradeBracketInput = {
  side: TradeBracketSide;
  entryIndex: number;
  exitIndex: number;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  targetPrice: number;
  stopPrice: number;
  managementEvents?: TradeBracketManagementEvent[];
};

export type TradeBracketManagementEvent = {
  price: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  time: string;
  type: "edit_tp" | "edit_sl" | "edit_limit";
};

export type TradeBracketHit = {
  bar: TradeBracketBar;
  barsHeld: number;
  boundary: "target" | "stop";
  exitIndex: number;
  exitPrice: number;
  exitTime: string;
  position: number;
  reason: "take_profit" | "stop_loss";
};

export function oneMinuteBarsHeld(entryTime: string, exitTime: string, fallback = 1): number {
  const entryMs = Date.parse(entryTime);
  const exitMs = Date.parse(exitTime);
  if (!Number.isFinite(entryMs) || !Number.isFinite(exitMs) || exitMs <= entryMs) {
    return Math.max(1, Math.round(fallback) || 1);
  }
  return Math.max(1, Math.ceil((exitMs - entryMs) / 60_000));
}

export function nearestTradeBarPosition(bars: TradeBracketBar[], indexValue: number, timeValue?: string): number | null {
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

function bracketLevelsAreValid(trade: TradeBracketInput): boolean {
  const { entryPrice, stopPrice, targetPrice } = trade;
  if (![entryPrice, stopPrice, targetPrice].every(Number.isFinite)) return false;
  if (trade.side === "long") return stopPrice < entryPrice && targetPrice > entryPrice;
  return stopPrice > entryPrice && targetPrice < entryPrice;
}

function bracketHit(
  trade: TradeBracketInput,
  bar: TradeBracketBar,
  entryPosition: number,
  position: number,
  stopPrice: number,
  targetPrice: number
): TradeBracketHit | null {
  const long = trade.side === "long";
  const barsHeld = oneMinuteBarsHeld(trade.entryTime, bar.time, position - entryPosition + 1);
  const hit = (boundary: "target" | "stop"): TradeBracketHit => ({
    bar,
    barsHeld,
    boundary,
    exitIndex: bar.index,
    exitPrice: boundary === "target" ? targetPrice : stopPrice,
    exitTime: bar.time,
    position,
    reason: boundary === "target" ? "take_profit" : "stop_loss"
  });

  if (position > entryPosition) {
    if (long && bar.open <= stopPrice) return hit("stop");
    if (!long && bar.open >= stopPrice) return hit("stop");
    if (long && bar.open >= targetPrice) return hit("target");
    if (!long && bar.open <= targetPrice) return hit("target");
  }

  const stopHit = long ? bar.low <= stopPrice : bar.high >= stopPrice;
  const targetHit = long ? bar.high >= targetPrice : bar.low <= targetPrice;

  if (stopHit) return hit("stop");
  if (targetHit) return hit("target");
  return null;
}

function managedBracketLevelsAt(
  trade: TradeBracketInput,
  barTime: string
): { stopPrice: number; targetPrice: number } {
  const barMs = Date.parse(barTime);
  let stopPrice = trade.stopPrice;
  let targetPrice = trade.targetPrice;

  for (const event of [...(trade.managementEvents ?? [])].sort((left, right) => Date.parse(left.time) - Date.parse(right.time))) {
    const eventMs = Date.parse(event.time);
    if (!Number.isFinite(eventMs) || !Number.isFinite(barMs) || eventMs > barMs) break;
    if (event.type === "edit_sl") {
      const nextStop = event.stopLossPrice ?? event.price;
      if (Number.isFinite(nextStop)) stopPrice = nextStop;
    }
    if (event.type === "edit_tp") {
      const nextTarget = event.takeProfitPrice ?? event.price;
      if (Number.isFinite(nextTarget)) targetPrice = nextTarget;
    }
  }

  return { stopPrice, targetPrice };
}

export function resolveFirstTradeBracketHit(trade: TradeBracketInput, bars: TradeBracketBar[]): TradeBracketHit | null {
  if (!bracketLevelsAreValid(trade)) return null;
  const entryPosition = nearestTradeBarPosition(bars, trade.entryIndex, trade.entryTime);
  const exitPosition = nearestTradeBarPosition(bars, trade.exitIndex, trade.exitTime);
  if (entryPosition == null || exitPosition == null) return null;

  const start = entryPosition;
  const end = Math.max(entryPosition, exitPosition);

  for (let position = start; position <= end; position += 1) {
    const bar = bars[position];
    if (!bar) continue;
    const levels = managedBracketLevelsAt(trade, bar.time);
    if (!Number.isFinite(levels.stopPrice) || !Number.isFinite(levels.targetPrice)) continue;
    const hit = bracketHit(trade, bar, entryPosition, position, levels.stopPrice, levels.targetPrice);
    if (hit) return hit;
  }

  return null;
}
