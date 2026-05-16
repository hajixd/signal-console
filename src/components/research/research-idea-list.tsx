"use client";

import { useRouter } from "next/navigation";
import { FormEvent, MouseEvent, useEffect, useMemo, useState, useTransition } from "react";
import type { ResearchAssetOption } from "@/components/research/research-idea-form";

const TIMEFRAME_OPTIONS = ["1m", "5m", "15m", "30m", "45m", "1h", "4h", "1d", "overnight"];

export type ResearchIdeaListItem = {
  assetKeys?: string[];
  fileId?: string;
  hypothesis?: string;
  ideaId?: string;
  ideaReport?: {
    timeframes?: string[];
  };
  provenance?: string;
  status?: string;
  timeframes?: string[];
  title?: string;
};

type ResearchIdeaListProps = {
  assets: ResearchAssetOption[];
  empty: string;
  ideas: ResearchIdeaListItem[];
};

function ideaTags(idea: ResearchIdeaListItem, assetLabelByKey: Map<string, string>) {
  const timeframes = (idea.timeframes?.length ? idea.timeframes : idea.ideaReport?.timeframes ?? []).filter(Boolean);
  const assets = (idea.assetKeys ?? []).filter(Boolean).map((assetKey) => assetLabelByKey.get(assetKey) ?? assetKey);
  return [...timeframes, ...assets];
}

export default function ResearchIdeaList({ assets, empty, ideas }: ResearchIdeaListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const assetLabelByKey = useMemo(() => new Map(assets.map((asset) => [asset.key, asset.symbol])), [assets]);
  const [editingIdea, setEditingIdea] = useState<ResearchIdeaListItem | null>(null);
  const [title, setTitle] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [timeframes, setTimeframes] = useState(["15m"]);
  const [assetKeys, setAssetKeys] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!editingIdea) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setEditingIdea(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingIdea]);

  function openEditor(idea: ResearchIdeaListItem) {
    setEditingIdea(idea);
    setTitle(idea.title ?? idea.ideaId ?? "Untitled idea");
    setHypothesis(idea.hypothesis ?? "");
    setTimeframes(idea.timeframes?.length ? idea.timeframes : idea.ideaReport?.timeframes?.length ? idea.ideaReport.timeframes : ["15m"]);
    setAssetKeys(idea.assetKeys ?? []);
    setMessage("");
  }

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) setEditingIdea(null);
  }

  function toggleTimeframe(timeframe: string) {
    setTimeframes((current) => (current.includes(timeframe) ? current.filter((item) => item !== timeframe) : [...current, timeframe]));
  }

  function toggleAsset(assetKey: string) {
    setAssetKeys((current) => (current.includes(assetKey) ? current.filter((item) => item !== assetKey) : [...current, assetKey]));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingIdea) return;
    const ideaId = editingIdea.ideaId ?? editingIdea.fileId;
    if (!ideaId) {
      setMessage("This idea cannot be edited because it has no saved id.");
      return;
    }

    setMessage("");
    const response = await fetch(`/api/research/ideas/${encodeURIComponent(ideaId)}`, {
      body: JSON.stringify({
        assetKeys,
        hypothesis,
        timeframes,
        title
      }),
      headers: { "content-type": "application/json" },
      method: "PUT"
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string; path?: string };
    if (!response.ok) {
      setMessage(payload.error ?? "Failed to save idea.");
      return;
    }

    setMessage(payload.path ? `Saved ${payload.path}` : "Idea saved.");
    setEditingIdea(null);
    startTransition(() => router.refresh());
  }

  if (!ideas.length) {
    return (
      <div className="researchEmptyMini">
        <strong>{empty}</strong>
      </div>
    );
  }

  return (
    <>
      <div className="researchIdeaGrid compact">
        {ideas.map((idea) => (
          <article className={`researchIdea ${idea.status === "approved" ? "approved" : "inbox"}`} key={`${idea.status}-${idea.ideaId ?? idea.fileId ?? idea.title}`}>
            <div className="researchIdeaHead">
              <div className="researchIdeaTitle">
                <span>{idea.status === "approved" ? "Approved" : "Inbox"} / {idea.provenance ?? "research"}</span>
                <strong>{idea.title ?? idea.ideaId ?? "Untitled idea"}</strong>
              </div>
              <button className="researchIdeaEditButton" onClick={() => openEditor(idea)} type="button">
                Edit
              </button>
            </div>
            <p>{idea.hypothesis ?? "No hypothesis text recorded."}</p>
            <div className="researchIdeaMeta">
              {(ideaTags(idea, assetLabelByKey).length ? ideaTags(idea, assetLabelByKey) : ["timeframe pending"]).map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </article>
        ))}
      </div>

      {editingIdea ? (
        <div className="researchModalBackdrop" onMouseDown={closeFromBackdrop}>
          <section aria-modal="true" className="researchIdeaModal" role="dialog">
            <div className="researchIdeaModalHead">
              <div>
                <span>{editingIdea.status === "approved" ? "Approved idea" : "Inbox idea"}</span>
                <strong>Edit Idea</strong>
              </div>
              <button aria-label="Close idea editor" onClick={() => setEditingIdea(null)} type="button">
                X
              </button>
            </div>
            <form className="researchIdeaForm" onSubmit={handleSubmit}>
              <label className="researchField wide">
                <span>Idea title</span>
                <input onChange={(event) => setTitle(event.target.value)} value={title} />
              </label>
              <label className="researchField wide">
                <span>Hypothesis</span>
                <textarea onChange={(event) => setHypothesis(event.target.value)} rows={4} value={hypothesis} />
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
                  {isPending ? "Saving" : "Save Idea"}
                </button>
                {message ? <span>{message}</span> : null}
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
