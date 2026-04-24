import { evaluateIctSweepFvg } from "@/core/strategies/ict_sweep_fvg";
import { evaluateIctTurtleSoup } from "@/core/strategies/ict_turtle_soup";
import { evaluateMeanReversion } from "@/core/strategies/mean_reversion";
import { evaluateMomentum } from "@/core/strategies/momentum";
import { evaluateRedditCapitulationReversion } from "@/core/strategies/reddit_capitulation_reversion";
import { evaluateRedditEmaPullback } from "@/core/strategies/reddit_ema_pullback";
import { evaluateRedditOrbBreakout } from "@/core/strategies/reddit_orb_breakout";
import { evaluateRedditOrbRetest } from "@/core/strategies/reddit_orb_retest";
import { evaluateSqueezeBreakout } from "@/core/strategies/squeeze_breakout";
import type { StrategyEvaluator } from "@/core/strategies/shared/evaluator";

const STRATEGY_EVALUATORS: Record<string, StrategyEvaluator> = {
  mean_reversion: evaluateMeanReversion,
  momentum: evaluateMomentum,
  squeeze_breakout: evaluateSqueezeBreakout,
  ict_sweep_fvg: evaluateIctSweepFvg,
  reddit_capitulation_reversion: evaluateRedditCapitulationReversion,
  reddit_ema_pullback: evaluateRedditEmaPullback,
  reddit_orb_breakout: evaluateRedditOrbBreakout,
  reddit_orb_retest: evaluateRedditOrbRetest,
  ict_turtle_soup: evaluateIctTurtleSoup
};

export function strategyEvaluatorForPhase(phase: string): StrategyEvaluator | undefined {
  return STRATEGY_EVALUATORS[phase];
}

export function strategyPhaseIsLive(phase: string): boolean {
  return Boolean(strategyEvaluatorForPhase(phase));
}
