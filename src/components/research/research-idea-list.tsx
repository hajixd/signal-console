"use client";

import { useRouter } from "next/navigation";
import { FormEvent, MouseEvent, useEffect, useMemo, useState, useTransition } from "react";
import type { ResearchAssetOption } from "@/components/research/research-idea-form";

const TIMEFRAME_OPTIONS = ["1m", "5m", "15m", "30m", "45m", "1h", "4h", "1d", "overnight"];

type ResearchIdeaReport = {
  assetSelection?: string;
  entry?: string;
  entryConditions?: string;
  exit?: string;
  exitConditions?: string;
  extraNotes?: string;
  filters?: string[];
  implementationNotes?: string[];
  invalidations?: string[];
  limitOrderPlan?: string;
  overallDescription?: string;
  parameterNotes?: string[];
  setup?: string;
  sourceInterpretation?: string;
  stop?: string;
  stopLossPlan?: string;
  summary?: string;
  takeProfitPlan?: string;
  target?: string;
  timeframes?: string[];
  useLimitOrder?: string;
};

export type ResearchIdeaListItem = {
  assetKeys?: string[];
  fileId?: string;
  hypothesis?: string;
  ideaId?: string;
  ideaReport?: ResearchIdeaReport;
  notes?: string;
  provenance?: string;
  sourceUrls?: string[];
  status?: string;
  timeframes?: string[];
  title?: string;
};

type ResearchIdeaListProps = {
  assets: ResearchAssetOption[];
  editable?: boolean;
  empty: string;
  ideas: ResearchIdeaListItem[];
  mode?: "discovery" | "formalization";
};

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function linesFromList(value: string[] | undefined) {
  return (value ?? []).join("\n");
}

function listFromLines(value: string) {
  return unique(value.split(/\r?\n|,/).map((item) => item.trim()));
}

function ideaTimeframes(idea: ResearchIdeaListItem) {
  return unique([...(idea.timeframes ?? []), ...(idea.ideaReport?.timeframes ?? [])]);
}

function ideaTags(idea: ResearchIdeaListItem, assetLabelByKey: Map<string, string>) {
  const timeframes = ideaTimeframes(idea);
  const assets = (idea.assetKeys ?? []).filter(Boolean).map((assetKey) => assetLabelByKey.get(assetKey) ?? assetKey);
  return [...timeframes, ...assets];
}

function statusLabel(idea: ResearchIdeaListItem) {
  return idea.status === "approved" ? "Formalized" : "New";
}

function reportValue(report: ResearchIdeaReport | undefined, primary: keyof ResearchIdeaReport, fallback?: keyof ResearchIdeaReport) {
  const value = report?.[primary];
  if (typeof value === "string" && value.trim()) return value;
  const fallbackValue = fallback ? report?.[fallback] : undefined;
  return typeof fallbackValue === "string" ? fallbackValue : "";
}

function rawIdeaText(idea: ResearchIdeaListItem) {
  return [idea.title, idea.hypothesis, ...(idea.sourceUrls ?? []), idea.notes].filter(Boolean).join("\n\n");
}

function ideaPreviewText(idea: ResearchIdeaListItem, mode: ResearchIdeaListProps["mode"]) {
  if (mode === "discovery") return idea.hypothesis ?? idea.notes ?? "No hypothesis text recorded.";
  return idea.ideaReport?.summary ?? idea.hypothesis ?? "No hypothesis text recorded.";
}

function titleFromIdeaText(value: string) {
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^https?:\/\//i.test(line));
  const fallback = value.trim().replace(/\s+/g, " ").slice(0, 92);
  return (firstLine ?? fallback).replace(/^#+\s*/, "").slice(0, 120);
}

export default function ResearchIdeaList({ assets, editable = false, empty, ideas, mode = "formalization" }: ResearchIdeaListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const assetLabelByKey = useMemo(() => new Map(assets.map((asset) => [asset.key, asset.symbol])), [assets]);
  const assetNameByKey = useMemo(() => new Map(assets.map((asset) => [asset.key, asset.label])), [assets]);
  const [editingIdea, setEditingIdea] = useState<ResearchIdeaListItem | null>(null);
  const [title, setTitle] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [sourceUrls, setSourceUrls] = useState("");
  const [timeframes, setTimeframes] = useState(["15m"]);
  const [assetKeys, setAssetKeys] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [summary, setSummary] = useState("");
  const [overallDescription, setOverallDescription] = useState("");
  const [sourceInterpretation, setSourceInterpretation] = useState("");
  const [assetSelection, setAssetSelection] = useState("");
  const [setup, setSetup] = useState("");
  const [entryConditions, setEntryConditions] = useState("");
  const [exitConditions, setExitConditions] = useState("");
  const [takeProfitPlan, setTakeProfitPlan] = useState("");
  const [stopLossPlan, setStopLossPlan] = useState("");
  const [useLimitOrder, setUseLimitOrder] = useState("");
  const [limitOrderPlan, setLimitOrderPlan] = useState("");
  const [filters, setFilters] = useState("");
  const [parameterNotes, setParameterNotes] = useState("");
  const [invalidations, setInvalidations] = useState("");
  const [implementationNotes, setImplementationNotes] = useState("");
  const [extraNotes, setExtraNotes] = useState("");
  const [discoveryText, setDiscoveryText] = useState("");
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
    const report = idea.ideaReport ?? {};
    const normalizedTimeframes = ideaTimeframes(idea);

    setEditingIdea(idea);
    setDiscoveryText(rawIdeaText(idea));
    setTitle(idea.title ?? idea.ideaId ?? "Untitled idea");
    setHypothesis(idea.hypothesis ?? report.overallDescription ?? report.summary ?? "");
    setSourceUrls((idea.sourceUrls ?? []).join("\n"));
    setTimeframes(normalizedTimeframes.length ? normalizedTimeframes : ["15m"]);
    setAssetKeys(idea.assetKeys ?? []);
    setNotes(idea.notes ?? "");
    setSummary(report.summary ?? "");
    setOverallDescription(report.overallDescription ?? report.summary ?? "");
    setSourceInterpretation(report.sourceInterpretation ?? "");
    setAssetSelection(report.assetSelection ?? "");
    setSetup(report.setup ?? "");
    setEntryConditions(reportValue(report, "entryConditions", "entry"));
    setExitConditions(reportValue(report, "exitConditions", "exit"));
    setTakeProfitPlan(reportValue(report, "takeProfitPlan", "target"));
    setStopLossPlan(reportValue(report, "stopLossPlan", "stop"));
    setUseLimitOrder(report.useLimitOrder ?? "");
    setLimitOrderPlan(report.limitOrderPlan ?? "");
    setFilters(linesFromList(report.filters));
    setParameterNotes(linesFromList(report.parameterNotes));
    setInvalidations(linesFromList(report.invalidations));
    setImplementationNotes(linesFromList(report.implementationNotes));
    setExtraNotes(report.extraNotes ?? "");
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
      setMessage("This idea cannot be saved because it has no id.");
      return;
    }

    setMessage("");
    if (mode === "discovery") {
      const nextHypothesis = discoveryText.trim();
      const nextTitle = titleFromIdeaText(nextHypothesis);
      if (!nextTitle || !nextHypothesis) {
        setMessage("Add a rough idea, link, or note first.");
        return;
      }

      const response = await fetch(`/api/research/ideas/${encodeURIComponent(ideaId)}`, {
        body: JSON.stringify({
          assetKeys,
          hypothesis: nextHypothesis,
          notes: "",
          sourceUrls: "",
          timeframes,
          title: nextTitle
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
      return;
    }

    const response = await fetch(`/api/research/ideas/${encodeURIComponent(ideaId)}`, {
      body: JSON.stringify({
        assetKeys,
        hypothesis,
        ideaReport: {
          assetSelection,
          entry: entryConditions,
          entryConditions,
          exit: exitConditions,
          exitConditions,
          extraNotes,
          filters: listFromLines(filters),
          implementationNotes: listFromLines(implementationNotes),
          invalidations: listFromLines(invalidations),
          limitOrderPlan,
          overallDescription,
          parameterNotes: listFromLines(parameterNotes),
          setup,
          sourceInterpretation,
          stop: stopLossPlan,
          stopLossPlan,
          summary,
          takeProfitPlan,
          target: takeProfitPlan,
          timeframes,
          useLimitOrder
        },
        notes,
        sourceUrls,
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
        {ideas.map((idea) => {
          const tags = ideaTags(idea, assetLabelByKey);
          return (
            <button
              className={`researchIdea ${idea.status === "approved" ? "approved" : "inbox"}`}
              key={`${idea.status}-${idea.ideaId ?? idea.fileId ?? idea.title}`}
              onClick={() => openEditor(idea)}
              type="button"
            >
              <div className="researchIdeaHead">
                <div className="researchIdeaTitle">
                  <span>{statusLabel(idea)} / {idea.provenance ?? "research"}</span>
                  <strong>{idea.title ?? idea.ideaId ?? "Untitled idea"}</strong>
                </div>
              </div>
              <p>{ideaPreviewText(idea, mode)}</p>
              <div className="researchIdeaMeta">
                {(tags.length ? tags : ["timeframe pending"]).slice(0, 10).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {editingIdea ? (
        <div className="researchModalBackdrop" onMouseDown={closeFromBackdrop}>
          <section
            aria-modal="true"
            className={`researchIdeaModal ${mode === "discovery" ? "researchDiscoveryEditModal" : "researchFormalizationModal"}`}
            role="dialog"
          >
            <div className="researchIdeaModalHead">
              <div>
                <span>{mode === "discovery" ? "Idea discovery" : `${statusLabel(editingIdea)} idea`}</span>
                <strong>{mode === "discovery" ? "Edit Raw Idea" : editable ? "Inspect and Edit" : "Inspect Idea"}</strong>
              </div>
              <button aria-label="Close idea editor" onClick={() => setEditingIdea(null)} type="button">
                X
              </button>
            </div>

            {mode === "discovery" ? (
              <form className="researchIdeaForm discovery" onSubmit={handleSubmit}>
                <label className="researchField wide researchDiscoveryInput">
                  <span>Raw idea</span>
                  <textarea
                    disabled={!editable}
                    onChange={(event) => setDiscoveryText(event.target.value)}
                    rows={12}
                    value={discoveryText}
                  />
                </label>
                <div className="researchFormActions">
                  {editable ? (
                    <button disabled={isPending} type="submit">
                      {isPending ? "Saving" : "Save Idea"}
                    </button>
                  ) : null}
                  {message ? <span>{message}</span> : null}
                </div>
              </form>
            ) : (
              <>
            <div className="researchModalHero">
              <div>
                <span>Timeframes</span>
                <div className="researchModalChipRow">
                  {(timeframes.length ? timeframes : ["timeframe pending"]).map((timeframe) => (
                    <span className="active" key={timeframe}>{timeframe}</span>
                  ))}
                </div>
              </div>
              <div>
                <span>Assets</span>
                <div className="researchModalChipRow">
                  {(assetKeys.length ? assetKeys : ["asset pending"]).map((assetKey) => (
                    <span className="active asset" key={assetKey} title={assetNameByKey.get(assetKey) ?? assetKey}>
                      {assetLabelByKey.get(assetKey) ?? assetKey}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <form className="researchIdeaForm structured" onSubmit={handleSubmit}>
              <label className="researchField wide">
                <span>Idea title</span>
                <input disabled={!editable} onChange={(event) => setTitle(event.target.value)} value={title} />
              </label>
              <label className="researchField wide">
                <span>Hypothesis</span>
                <textarea disabled={!editable} onChange={(event) => setHypothesis(event.target.value)} rows={3} value={hypothesis} />
              </label>
              <div className="researchFormSection wide">
                <span>Formalized Idea</span>
                <div className="researchFormSectionGrid">
                  <label className="researchField wide">
                    <span>Overall description</span>
                    <textarea disabled={!editable} onChange={(event) => setOverallDescription(event.target.value)} rows={3} value={overallDescription} />
                  </label>
                  <label className="researchField wide">
                    <span>Research summary</span>
                    <textarea disabled={!editable} onChange={(event) => setSummary(event.target.value)} rows={3} value={summary} />
                  </label>
                  <label className="researchField wide">
                    <span>Source interpretation</span>
                    <textarea disabled={!editable} onChange={(event) => setSourceInterpretation(event.target.value)} rows={2} value={sourceInterpretation} />
                  </label>
                  <label className="researchField wide">
                    <span>Asset selection</span>
                    <textarea disabled={!editable} onChange={(event) => setAssetSelection(event.target.value)} rows={2} value={assetSelection} />
                  </label>
                  <label className="researchField wide">
                    <span>Setup</span>
                    <textarea disabled={!editable} onChange={(event) => setSetup(event.target.value)} rows={2} value={setup} />
                  </label>
                  <label className="researchField wide">
                    <span>Entry conditions</span>
                    <textarea disabled={!editable} onChange={(event) => setEntryConditions(event.target.value)} rows={3} value={entryConditions} />
                  </label>
                  <label className="researchField wide">
                    <span>Exit conditions</span>
                    <textarea disabled={!editable} onChange={(event) => setExitConditions(event.target.value)} rows={3} value={exitConditions} />
                  </label>
                  <label className="researchField">
                    <span>How TP is determined</span>
                    <textarea disabled={!editable} onChange={(event) => setTakeProfitPlan(event.target.value)} rows={3} value={takeProfitPlan} />
                  </label>
                  <label className="researchField">
                    <span>How SL is determined</span>
                    <textarea disabled={!editable} onChange={(event) => setStopLossPlan(event.target.value)} rows={3} value={stopLossPlan} />
                  </label>
                  <label className="researchField">
                    <span>Use limit order</span>
                    <input
                      disabled={!editable}
                      onChange={(event) => setUseLimitOrder(event.target.value)}
                      placeholder="Yes / no / conditional"
                      value={useLimitOrder}
                    />
                  </label>
                  <label className="researchField">
                    <span>Limit order plan</span>
                    <textarea disabled={!editable} onChange={(event) => setLimitOrderPlan(event.target.value)} rows={3} value={limitOrderPlan} />
                  </label>
                  <label className="researchField">
                    <span>Filters</span>
                    <textarea disabled={!editable} onChange={(event) => setFilters(event.target.value)} rows={3} value={filters} />
                  </label>
                  <label className="researchField">
                    <span>Parameter notes</span>
                    <textarea disabled={!editable} onChange={(event) => setParameterNotes(event.target.value)} rows={3} value={parameterNotes} />
                  </label>
                  <label className="researchField">
                    <span>Invalidations</span>
                    <textarea disabled={!editable} onChange={(event) => setInvalidations(event.target.value)} rows={3} value={invalidations} />
                  </label>
                  <label className="researchField">
                    <span>Implementation notes</span>
                    <textarea disabled={!editable} onChange={(event) => setImplementationNotes(event.target.value)} rows={3} value={implementationNotes} />
                  </label>
                  <label className="researchField wide">
                    <span>Extra notes</span>
                    <textarea disabled={!editable} onChange={(event) => setExtraNotes(event.target.value)} rows={3} value={extraNotes} />
                  </label>
                </div>
              </div>
              <label className="researchField wide">
                <span>Sources</span>
                <textarea disabled={!editable} onChange={(event) => setSourceUrls(event.target.value)} rows={2} value={sourceUrls} />
              </label>
              <label className="researchField wide">
                <span>General notes</span>
                <textarea disabled={!editable} onChange={(event) => setNotes(event.target.value)} rows={2} value={notes} />
              </label>
              <fieldset className="researchTimeframeChecks">
                <legend>Timeframes used</legend>
                {TIMEFRAME_OPTIONS.map((timeframe) => (
                  <label className={timeframes.includes(timeframe) ? "selected" : ""} key={timeframe}>
                    <input checked={timeframes.includes(timeframe)} disabled={!editable} onChange={() => toggleTimeframe(timeframe)} type="checkbox" />
                    <span>{timeframe}</span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="researchAssetChecks">
                <legend>Assets used</legend>
                {editable ? (
                  <div className="researchAssetActions">
                    <button onClick={() => setAssetKeys(assets.map((asset) => asset.key))} type="button">
                      Select all
                    </button>
                    <button onClick={() => setAssetKeys([])} type="button">
                      Clear
                    </button>
                  </div>
                ) : null}
                <div className="researchAssetGrid">
                  {assets.map((asset) => (
                    <label className={assetKeys.includes(asset.key) ? "selected" : ""} key={asset.key}>
                      <input checked={assetKeys.includes(asset.key)} disabled={!editable} onChange={() => toggleAsset(asset.key)} type="checkbox" />
                      <span>{asset.symbol}</span>
                      <small>{asset.label}</small>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="researchFormActions">
                {editable ? (
                  <button disabled={isPending} type="submit">
                    {isPending ? "Saving" : "Save Idea"}
                  </button>
                ) : null}
                {message ? <span>{message}</span> : null}
              </div>
            </form>
              </>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
