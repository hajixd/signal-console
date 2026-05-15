import { analyzePropFirmChallenge, type ChallengeReplaySummary, type ChallengeReplayTrade, type ChallengeRules } from "@/lib/challenge";

type ChallengeReplayWorkerRequest = {
  id: string;
  rules: ChallengeRules;
  seed: string;
  trades: ChallengeReplayTrade[];
};

type ChallengeReplayWorkerResponse = {
  id: string;
  summary: ChallengeReplaySummary;
};

self.onmessage = (event: MessageEvent<ChallengeReplayWorkerRequest>) => {
  const { id, rules, seed, trades } = event.data;
  const response: ChallengeReplayWorkerResponse = {
    id,
    summary: analyzePropFirmChallenge(trades, seed, rules)
  };
  self.postMessage(response);
};

export {};
