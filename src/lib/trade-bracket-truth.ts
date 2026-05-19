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
  position: number
): TradeBracketHit | null {
  const long = trade.side === "long";
  const barsHeld = Math.max(1, position - entryPosition + 1);
  const hit = (boundary: "target" | "stop"): TradeBracketHit => ({
    bar,
    barsHeld,
    boundary,
    exitIndex: bar.index,
    exitPrice: boundary === "target" ? trade.targetPrice : trade.stopPrice,
    exitTime: bar.time,
    position,
    reason: boundary === "target" ? "take_profit" : "stop_loss"
  });

  if (position > entryPosition) {
    if (long && bar.open <= trade.stopPrice) return hit("stop");
    if (!long && bar.open >= trade.stopPrice) return hit("stop");
    if (long && bar.open >= trade.targetPrice) return hit("target");
    if (!long && bar.open <= trade.targetPrice) return hit("target");
  }

  const stopHit = long ? bar.low <= trade.stopPrice : bar.high >= trade.stopPrice;
  const targetHit = long ? bar.high >= trade.targetPrice : bar.low <= trade.targetPrice;

  if (stopHit) return hit("stop");
  if (targetHit) return hit("target");
  return null;
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
    const hit = bracketHit(trade, bar, entryPosition, position);
    if (hit) return hit;
  }

  return null;
}
