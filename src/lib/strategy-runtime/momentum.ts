import type { EnrichedBar } from "@/lib/indicators";
import type { StrategyRule } from "@/lib/types";
import type { StrategySignal } from "@/lib/strategy-definition";
import { evaluateEchoStylePhase } from "./echo-style";

export function evaluateMomentum(rule: StrategyRule, bars: EnrichedBar[], signalIndex: number): StrategySignal | null {
  return evaluateEchoStylePhase(rule, bars, signalIndex);
}
