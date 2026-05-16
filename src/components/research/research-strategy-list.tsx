"use client";

import { MouseEvent, useEffect, useState } from "react";
import {
  compactId,
  strategyEntryConditions,
  strategyExitConditions,
  strategyJson,
  strategyLimitOrderPlan,
  strategyStopLossPlan,
  strategyTakeProfitPlan,
  type ResearchStrategyLike
} from "@/components/research/research-strategy-detail";

export type ResearchStrategySpec = ResearchStrategyLike & {
  createdAt?: string;
  fileId?: string;
  llm?: Record<string, unknown>;
  provenance?: string;
  status?: string;
};

type ResearchStrategyListProps = {
  empty: string;
  specs: ResearchStrategySpec[];
};

function closeFromBackdrop(setSelected: (value: ResearchStrategySpec | null) => void) {
  return (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) setSelected(null);
  };
}

function sourceCount(spec: ResearchStrategySpec) {
  return spec.sourceUrls?.length ? `${spec.sourceUrls.length} source${spec.sourceUrls.length === 1 ? "" : "s"}` : "no sources";
}

export default function ResearchStrategyList({ empty, specs }: ResearchStrategyListProps) {
  const [selected, setSelected] = useState<ResearchStrategySpec | null>(null);

  useEffect(() => {
    if (!selected) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selected]);

  if (!specs.length) {
    return (
      <div className="researchEmptyMini">
        <strong>{empty}</strong>
      </div>
    );
  }

  return (
    <>
      <div className="researchMiniList">
        {specs.map((spec) => (
          <button className="researchMiniRow clickable" key={spec.strategyId ?? spec.title} onClick={() => setSelected(spec)} type="button">
            <strong>{compactId(spec.strategyId)}</strong>
            <span>{spec.title ?? "Untitled coded strategy"}</span>
            <small>{spec.assetKey ?? spec.symbol ?? "asset pending"} / {spec.market ?? "market pending"} / {spec.engine ?? "engine pending"}</small>
          </button>
        ))}
      </div>

      {selected ? (
        <div className="researchModalBackdrop" onMouseDown={closeFromBackdrop(setSelected)}>
          <section aria-modal="true" className="researchIdeaModal researchDetailModal" role="dialog">
            <div className="researchIdeaModalHead">
              <div>
                <span>Coded strategy</span>
                <strong>{selected.title ?? selected.strategyId ?? "Strategy details"}</strong>
              </div>
              <button aria-label="Close coded strategy details" onClick={() => setSelected(null)} type="button">
                X
              </button>
            </div>

            <div className="researchDetailStatGrid">
              <div>
                <span>Strategy</span>
                <strong>{compactId(selected.strategyId)}</strong>
              </div>
              <div>
                <span>Asset</span>
                <strong>{selected.symbol ?? selected.assetKey ?? "n/a"}</strong>
              </div>
              <div>
                <span>Market</span>
                <strong>{selected.market ?? "n/a"}</strong>
              </div>
              <div>
                <span>Engine</span>
                <strong>{selected.engine ?? "n/a"}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{selected.status ?? "ready"}</strong>
              </div>
              <div>
                <span>Research</span>
                <strong>{sourceCount(selected)}</strong>
              </div>
            </div>

            <div className="researchDetailSections">
              <section>
                <span>Entry Conditions</span>
                <p>{strategyEntryConditions(selected)}</p>
              </section>
              <section>
                <span>Exit Conditions</span>
                <p>{strategyExitConditions(selected)}</p>
              </section>
              <section>
                <span>How TP Is Determined</span>
                <p>{strategyTakeProfitPlan(selected)}</p>
              </section>
              <section>
                <span>How SL Is Determined</span>
                <p>{strategyStopLossPlan(selected)}</p>
              </section>
              <section>
                <span>Use Limit Order</span>
                <p>{strategyLimitOrderPlan(selected)}</p>
              </section>
              {selected.hypothesis ? (
                <section className="wide">
                  <span>Overall Description</span>
                  <p>{selected.hypothesis}</p>
                </section>
              ) : null}
              <section className="wide code">
                <span>Stored Strategy JSON</span>
                <pre>{strategyJson(selected)}</pre>
              </section>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
