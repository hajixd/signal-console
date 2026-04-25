import type { EnrichedBar } from "@/lib/indicators";
import type { StrategySignal } from "@/lib/strategy-definition";
import type { StrategyRule } from "@/lib/types";
import { evaluateEchoStylePhase } from "./echo-style";

export function evaluateMeanReversion(
  rule: StrategyRule,
  bars: EnrichedBar[],
  signalIndex: number
): StrategySignal | null {
  return evaluateEchoStylePhase(rule, bars, signalIndex);
}
