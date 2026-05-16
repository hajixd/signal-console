import {
  analyzePropFirmChallenge,
  type ChallengeReplayProgress,
  type ChallengeReplaySummary,
  type ChallengeReplayTrade,
  type ChallengeRules
} from "@/lib/challenge";

type ChallengeReplayWorkerRequest = {
  id: string;
  rules: ChallengeRules;
  seed: string;
  trades: ChallengeReplayTrade[];
};

type ChallengeReplayWorkerResponse = {
  id: string;
  progress?: ChallengeReplayProgress;
  summary: ChallengeReplaySummary;
};

type ChallengeReplayWorkerProgressResponse = {
  id: string;
  progress: ChallengeReplayProgress;
};

self.onmessage = (event: MessageEvent<ChallengeReplayWorkerRequest>) => {
  const { id, rules, seed, trades } = event.data;
  const response: ChallengeReplayWorkerResponse = {
    id,
    summary: analyzePropFirmChallenge(trades, seed, rules, (progress) => {
      const progressResponse: ChallengeReplayWorkerProgressResponse = { id, progress };
      self.postMessage(progressResponse);
    })
  };
  self.postMessage(response);
};

export {};
