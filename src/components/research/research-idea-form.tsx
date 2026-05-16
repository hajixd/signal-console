"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

export type ResearchAssetOption = {
  key: string;
  label: string;
  symbol: string;
};

type ResearchIdeaFormProps = {
  isEmpty?: boolean;
};

function titleFromIdeaText(value: string) {
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^https?:\/\//i.test(line));
  const fallback = value.trim().replace(/\s+/g, " ").slice(0, 92);
  return (firstLine ?? fallback).replace(/^#+\s*/, "").slice(0, 120);
}

export default function ResearchIdeaForm({ isEmpty = false }: ResearchIdeaFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [ideaText, setIdeaText] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const hypothesis = ideaText.trim();
    const title = titleFromIdeaText(hypothesis);
    if (!title || !hypothesis) {
      setMessage("Add a rough idea, link, or note first.");
      return;
    }

    const response = await fetch("/api/research/ideas", {
      body: JSON.stringify({
        assetKeys: [],
        hypothesis,
        sourceUrls: "",
        timeframes: ["15m"],
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

    setIdeaText("");
    setMessage(payload.path ? `Added ${payload.path}` : "Idea added.");
    startTransition(() => router.refresh());
  }

  return (
    <form className="researchIdeaComposer researchDiscoveryComposer" onSubmit={handleSubmit}>
      <label className="researchField wide researchDiscoveryInput">
        <span>{isEmpty ? "Idea discovery input" : "New discovery"}</span>
        <textarea
          onChange={(event) => setIdeaText(event.target.value)}
          placeholder="Paste a rough strategy idea, source link, video URL, note dump, or market behavior to investigate. Formalization will organize the details later."
          rows={10}
          value={ideaText}
        />
      </label>
      <div className="researchFormActions">
        <button disabled={isPending} type="submit">
          {isPending ? "Adding" : "Add Idea"}
        </button>
      </div>
      {message ? <span className="researchIdeaComposerMessage">{message}</span> : null}
    </form>
  );
}
