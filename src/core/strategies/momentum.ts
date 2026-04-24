import type { EnrichedBar } from "@/lib/indicators";
import type { StrategyRule } from "@/lib/types";
import { evaluateEchoStylePhase } from "@/core/strategies/shared/echo-style";

export function evaluateMomentum(rule: StrategyRule, bars: EnrichedBar[], signalIndex: number) {
  return evaluateEchoStylePhase(rule, bars, signalIndex);
}
