"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

const TIMEFRAME_OPTIONS = ["1m", "5m", "15m", "30m", "45m", "1h", "4h", "1d", "overnight"];

export type ResearchAssetOption = {
  key: string;
  label: string;
  symbol: string;
};

type ResearchIdeaFormProps = {
  assets: ResearchAssetOption[];
};

export default function ResearchIdeaForm({ assets }: ResearchIdeaFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [timeframes, setTimeframes] = useState(["15m"]);
  const [assetKeys, setAssetKeys] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  function toggleTimeframe(timeframe: string) {
    setTimeframes((current) => (current.includes(timeframe) ? current.filter((item) => item !== timeframe) : [...current, timeframe]));
  }

  function toggleAsset(assetKey: string) {
    setAssetKeys((current) => (current.includes(assetKey) ? current.filter((item) => item !== assetKey) : [...current, assetKey]));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/research/ideas", {
      body: JSON.stringify({
        assetKeys,
        hypothesis,
        timeframes,
        title
      }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string; path?: string };
    if (!response.ok) {
      setMessage(payload.error ?? "Failed to add idea.");
      return;
    }

    setTitle("");
    setHypothesis("");
    setAssetKeys([]);
    setTimeframes(["15m"]);
    setMessage(payload.path ? `Added ${payload.path}` : "Idea added.");
    startTransition(() => router.refresh());
  }

  return (
    <form className="researchIdeaForm" onSubmit={handleSubmit}>
      <label className="researchField wide">
        <span>Idea title</span>
        <input onChange={(event) => setTitle(event.target.value)} placeholder="SPY overnight drift recycled into ES and EUR/USD" value={title} />
      </label>
      <label className="researchField wide">
        <span>Hypothesis</span>
        <textarea
          onChange={(event) => setHypothesis(event.target.value)}
          placeholder="Describe the market behavior, session, source, and what should be tested."
          rows={4}
          value={hypothesis}
        />
      </label>
      <fieldset className="researchTimeframeChecks">
        <legend>Timeframes</legend>
        {TIMEFRAME_OPTIONS.map((timeframe) => (
          <label key={timeframe}>
            <input checked={timeframes.includes(timeframe)} onChange={() => toggleTimeframe(timeframe)} type="checkbox" />
            <span>{timeframe}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="researchAssetChecks">
        <legend>Assets</legend>
        <div className="researchAssetActions">
          <button onClick={() => setAssetKeys(assets.map((asset) => asset.key))} type="button">
            Select all
          </button>
          <button onClick={() => setAssetKeys([])} type="button">
            Clear
          </button>
        </div>
        <div className="researchAssetGrid">
          {assets.map((asset) => (
            <label key={asset.key}>
              <input checked={assetKeys.includes(asset.key)} onChange={() => toggleAsset(asset.key)} type="checkbox" />
              <span>{asset.symbol}</span>
              <small>{asset.label}</small>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="researchFormActions">
        <button disabled={isPending} type="submit">
          {isPending ? "Adding" : "Add Idea"}
        </button>
        {message ? <span>{message}</span> : null}
      </div>
    </form>
  );
}
