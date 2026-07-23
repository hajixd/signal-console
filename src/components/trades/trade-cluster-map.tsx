"use client";

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import type { TradeHistoryRow } from "@/components/trades/trade-history";
import { LocalDateTimeStack } from "@/components/ui/local-date-time";

type TradeClusterMapProps = {
  historyRows: TradeHistoryRow[];
  liveRows: TradeHistoryRow[];
};

type SourceFilter = "all" | "history" | "live";
type OutcomeFilter = "all" | "win" | "loss" | "open";

type ClusterNode = {
  id: string;
  source: "history" | "live";
  row: TradeHistoryRow;
  x: number;
  y: number;
  radius: number;
  outcome: "win" | "loss" | "flat" | "open";
  searchText: string;
};

type ViewState = {
  scale: number;
  x: number;
  y: number;
};

const MAP_WIDTH = 1200;
const MAP_HEIGHT = 700;
const INITIAL_VIEW: ViewState = { scale: 1, x: 0, y: 0 };

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function outcomeForRow(row: TradeHistoryRow): ClusterNode["outcome"] {
  if (row.exitReasonLabel === "Still Open") return "open";
  if (row.pnlDollars > 0) return "win";
  if (row.pnlDollars < 0) return "loss";
  return "flat";
}

function shortLabel(value: string, limit = 22): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
}

function signedMoney(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0
  })}`;
}

function nodeSearchText(row: TradeHistoryRow, source: ClusterNode["source"]): string {
  return [
    row.id,
    row.indexLabel,
    row.strategyKey,
    row.modelName,
    row.symbol,
    row.displaySymbol,
    row.market,
    row.marketLabel,
    row.side,
    row.sideLabel,
    row.phase,
    row.variantId,
    row.exitReasonLabel,
    row.entryTime,
    source
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function buildNodes(historyRows: TradeHistoryRow[], liveRows: TradeHistoryRow[]): ClusterNode[] {
  const sourcedRows = [
    ...historyRows.map((row) => ({ row, source: "history" as const })),
    ...liveRows.map((row) => ({ row, source: "live" as const }))
  ];
  const strategyLabels = [...new Set(sourcedRows.map(({ row }) => row.modelName || row.strategyKey || "Unknown"))].sort();
  const clusterCount = Math.max(1, strategyLabels.length);
  const columns = Math.max(1, Math.ceil(Math.sqrt((clusterCount * MAP_WIDTH) / MAP_HEIGHT)));
  const rows = Math.max(1, Math.ceil(clusterCount / columns));
  const cellWidth = MAP_WIDTH / columns;
  const cellHeight = MAP_HEIGHT / rows;
  const centers = new Map(
    strategyLabels.map((label, index) => [
      label,
      {
        x: cellWidth * (index % columns + 0.5),
        y: cellHeight * (Math.floor(index / columns) + 0.5)
      }
    ])
  );
  const strategyIndexes = new Map<string, number>();

  return sourcedRows.map(({ row, source }) => {
    const strategy = row.modelName || row.strategyKey || "Unknown";
    const center = centers.get(strategy) ?? { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
    const clusterIndex = strategyIndexes.get(strategy) ?? 0;
    strategyIndexes.set(strategy, clusterIndex + 1);
    const hash = hashText(`${source}:${row.id}:${row.entryTime}`);
    const angle = clusterIndex * 2.399963 + ((hash % 1000) / 1000) * 0.7;
    const cellRadius = Math.max(34, Math.min(cellWidth, cellHeight) * 0.38);
    const radius = Math.min(cellRadius, 13 + Math.sqrt(clusterIndex) * 8.5);
    const pnlPush = Math.max(-18, Math.min(18, row.pnlDollars / Math.max(8, Math.abs(row.riskDollars) || 100) * 7));
    const sidePush = row.side === "long" ? -8 : 8;
    const outcome = outcomeForRow(row);
    return {
      id: `${source}:${row.id}`,
      source,
      row,
      x: center.x + Math.cos(angle) * radius + sidePush,
      y: center.y + Math.sin(angle) * radius - pnlPush,
      radius: source === "live" ? (outcome === "open" ? 7 : 6) : 4.2,
      outcome,
      searchText: nodeSearchText(row, source)
    };
  });
}

export default function TradeClusterMap({ historyRows, liveRows }: TradeClusterMapProps) {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [strategyFilter, setStrategyFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; viewX: number; viewY: number } | null>(null);
  const nodes = useMemo(() => buildNodes(historyRows, liveRows), [historyRows, liveRows]);
  const strategies = useMemo(
    () => [...new Set(nodes.map((node) => node.row.modelName || node.row.strategyKey || "Unknown"))].sort(),
    [nodes]
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filteredNodes = useMemo(
    () =>
      nodes.filter((node) => {
        if (sourceFilter !== "all" && node.source !== sourceFilter) return false;
        if (outcomeFilter !== "all" && node.outcome !== outcomeFilter) return false;
        if (strategyFilter !== "all" && (node.row.modelName || node.row.strategyKey || "Unknown") !== strategyFilter) return false;
        return true;
      }),
    [nodes, outcomeFilter, sourceFilter, strategyFilter]
  );
  const searchMatches = useMemo(
    () => (normalizedQuery ? nodes.filter((node) => node.searchText.includes(normalizedQuery)).slice(0, 9) : []),
    [nodes, normalizedQuery]
  );
  const matchingIds = useMemo(() => new Set(searchMatches.map((node) => node.id)), [searchMatches]);
  const visibleIds = useMemo(() => new Set(filteredNodes.map((node) => node.id)), [filteredNodes]);
  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null;
  const hoveredNode = nodes.find((node) => node.id === hoveredId) ?? null;
  const inspectedNode = hoveredNode ?? selectedNode;
  const wins = filteredNodes.filter((node) => node.outcome === "win").length;
  const losses = filteredNodes.filter((node) => node.outcome === "loss").length;
  const clusterLabels = useMemo(() => {
    const buckets = new Map<string, { count: number; x: number; y: number }>();
    for (const node of filteredNodes) {
      const key = node.row.modelName || node.row.strategyKey || "Unknown";
      const bucket = buckets.get(key) ?? { count: 0, x: 0, y: 0 };
      bucket.count += 1;
      bucket.x += node.x;
      bucket.y += node.y;
      buckets.set(key, bucket);
    }
    return [...buckets.entries()].map(([label, bucket]) => ({
      count: bucket.count,
      label,
      x: bucket.x / bucket.count,
      y: bucket.y / bucket.count
    }));
  }, [filteredNodes]);

  const edges = useMemo(() => {
    const previousByStrategy = new Map<string, ClusterNode>();
    const result: Array<{ from: ClusterNode; to: ClusterNode }> = [];
    for (const node of [...filteredNodes].sort((left, right) => Date.parse(left.row.entryTime) - Date.parse(right.row.entryTime))) {
      const key = node.row.modelName || node.row.strategyKey || "Unknown";
      const previous = previousByStrategy.get(key);
      if (previous && result.length < 900) result.push({ from: previous, to: node });
      previousByStrategy.set(key, node);
    }
    return result;
  }, [filteredNodes]);

  function focusNode(node: ClusterNode) {
    setSourceFilter("all");
    setOutcomeFilter("all");
    setStrategyFilter("all");
    setSelectedId(node.id);
    setQuery(node.row.displaySymbol || node.row.symbol || node.row.id);
    setSearchFocused(false);
    const scale = Math.max(1.55, view.scale);
    setView({
      scale,
      x: MAP_WIDTH / 2 - node.x * scale,
      y: MAP_HEIGHT / 2 - node.y * scale
    });
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = ((event.clientX - rect.left) / rect.width) * MAP_WIDTH;
    const pointerY = ((event.clientY - rect.top) / rect.height) * MAP_HEIGHT;
    const nextScale = Math.max(0.65, Math.min(4.5, view.scale * Math.exp(-event.deltaY * 0.0012)));
    const worldX = (pointerX - view.x) / view.scale;
    const worldY = (pointerY - view.y) / view.scale;
    setView({
      scale: nextScale,
      x: pointerX - worldX * nextScale,
      y: pointerY - worldY * nextScale
    });
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if ((event.target as Element).closest(".tradeClusterNode")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setView({
      ...view,
      x: drag.viewX + ((event.clientX - drag.x) / rect.width) * MAP_WIDTH,
      y: drag.viewY + ((event.clientY - drag.y) / rect.height) * MAP_HEIGHT
    });
  }

  function endDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  return (
    <section className="tradeClusterMap" aria-label="Trade cluster map">
      <header className="tradeClusterHeader">
        <div>
          <span className="tradeClusterEyebrow">Trade topology</span>
          <h2>Cluster Map</h2>
          <p>Every point is a trade. Nearby points share a strategy; vertical movement reflects normalized outcome.</p>
        </div>
        <div className="tradeClusterSummary" aria-label="Visible cluster summary">
          <span><b>{filteredNodes.length.toLocaleString()}</b> visible</span>
          <span className="history"><b>{filteredNodes.filter((node) => node.source === "history").length.toLocaleString()}</b> history</span>
          <span className="live"><b>{filteredNodes.filter((node) => node.source === "live").length.toLocaleString()}</b> live</span>
          <span className="win"><b>{wins.toLocaleString()}</b> wins</span>
          <span className="loss"><b>{losses.toLocaleString()}</b> losses</span>
        </div>
      </header>

      <div className="tradeClusterToolbar">
        <div className="tradeClusterSearch">
          <svg viewBox="0 0 24 24" aria-hidden><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></svg>
          <input
            aria-label="Search trades"
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchFocused(true);
            }}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && searchMatches[0]) focusNode(searchMatches[0]);
              if (event.key === "Escape") setSearchFocused(false);
            }}
            placeholder="Search symbol, model, ID, side, date..."
            value={query}
          />
          {query ? <button aria-label="Clear search" onClick={() => { setQuery(""); setSelectedId(null); }} type="button">×</button> : null}
          {searchFocused && normalizedQuery ? (
            <div className="tradeClusterSuggestions">
              {searchMatches.length ? searchMatches.map((node) => (
                <button key={node.id} onMouseDown={(event) => event.preventDefault()} onClick={() => focusNode(node)} type="button">
                  <i className={`${node.source} ${node.outcome}`} />
                  <span>
                    <strong>{node.row.displaySymbol || node.row.symbol}</strong>
                    <small>{shortLabel(node.row.modelName || node.row.strategyKey)} · {node.row.sideLabel} · {node.source}</small>
                  </span>
                  <b className={node.outcome}>{node.outcome === "open" ? "OPEN" : signedMoney(node.row.pnlDollars)}</b>
                </button>
              )) : <div className="tradeClusterNoResults">No matching trades</div>}
            </div>
          ) : null}
        </div>

        <div className="tradeClusterFilters">
          <select aria-label="Trade source" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}>
            <option value="all">History + Live</option>
            <option value="history">History only</option>
            <option value="live">Live only</option>
          </select>
          <select aria-label="Trade outcome" value={outcomeFilter} onChange={(event) => setOutcomeFilter(event.target.value as OutcomeFilter)}>
            <option value="all">All outcomes</option>
            <option value="win">Wins</option>
            <option value="loss">Losses</option>
            <option value="open">Open</option>
          </select>
          <select aria-label="Strategy" value={strategyFilter} onChange={(event) => setStrategyFilter(event.target.value)}>
            <option value="all">All strategies</option>
            {strategies.map((strategy) => <option key={strategy} value={strategy}>{strategy}</option>)}
          </select>
          <button onClick={() => setView(INITIAL_VIEW)} type="button">Reset view</button>
        </div>
      </div>

      <div className="tradeClusterStage">
        <svg
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={handleWheel}
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          role="img"
          aria-label={`${filteredNodes.length} trade nodes grouped by strategy`}
        >
          <defs>
            <pattern id="trade-cluster-grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" className="tradeClusterGrid" />
            </pattern>
            <filter id="trade-cluster-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <rect width={MAP_WIDTH} height={MAP_HEIGHT} className="tradeClusterBackdrop" />
          <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#trade-cluster-grid)" />
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            <g className="tradeClusterEdges">
              {edges.map(({ from, to }) => (
                <line key={`${from.id}:${to.id}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
              ))}
            </g>
            <g className="tradeClusterLabels" aria-hidden>
              {clusterLabels.map((cluster) => (
                <text key={cluster.label} x={cluster.x} y={cluster.y - 34}>
                  {shortLabel(cluster.label, 24)} · {cluster.count}
                </text>
              ))}
            </g>
            <g>
              {nodes.map((node) => {
                const filteredOut = !visibleIds.has(node.id);
                const searchDimmed = normalizedQuery ? !node.searchText.includes(normalizedQuery) : false;
                const selected = node.id === selectedId;
                return (
                  <circle
                    aria-label={`${node.source} ${node.row.displaySymbol || node.row.symbol} ${node.outcome}`}
                    className={`tradeClusterNode ${node.source} ${node.outcome}${filteredOut ? " isFiltered" : ""}${searchDimmed ? " isDimmed" : ""}${selected ? " isSelected" : ""}${matchingIds.has(node.id) ? " isMatch" : ""}`}
                    cx={node.x}
                    cy={node.y}
                    filter={selected ? "url(#trade-cluster-glow)" : undefined}
                    key={node.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      focusNode(node);
                    }}
                    onMouseEnter={() => setHoveredId(node.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        focusNode(node);
                      }
                    }}
                    r={node.radius}
                    role="button"
                    tabIndex={filteredOut ? -1 : 0}
                  >
                    <title>{`${node.row.displaySymbol || node.row.symbol} · ${node.row.modelName} · ${node.source} · ${node.outcome}`}</title>
                  </circle>
                );
              })}
            </g>
          </g>
        </svg>

        <div className="tradeClusterLegend" aria-label="Map legend">
          <span><i className="history" />History</span>
          <span><i className="live" />Live</span>
          <span><i className="win" />Win</span>
          <span><i className="loss" />Loss</span>
          <span><i className="open" />Open</span>
        </div>
        <div className="tradeClusterHelp">Drag to pan · scroll to zoom · select to focus</div>

        {inspectedNode ? (
          <aside className="tradeClusterInspector">
            <div>
              <span className={`tradeClusterSource ${inspectedNode.source}`}>{inspectedNode.source}</span>
              <span className={`tradeClusterOutcome ${inspectedNode.outcome}`}>{inspectedNode.outcome}</span>
            </div>
            <h3>{inspectedNode.row.displaySymbol || inspectedNode.row.symbol}</h3>
            <p>{inspectedNode.row.modelName || inspectedNode.row.strategyKey}</p>
            <dl>
              <div><dt>Side</dt><dd>{inspectedNode.row.sideLabel}</dd></div>
              <div><dt>P&L</dt><dd className={inspectedNode.outcome}>{inspectedNode.outcome === "open" ? "Open" : signedMoney(inspectedNode.row.pnlDollars)}</dd></div>
              <div><dt>Entry</dt><dd><LocalDateTimeStack value={inspectedNode.row.entryTime} /></dd></div>
              <div><dt>Exit</dt><dd>{inspectedNode.outcome === "open" ? "Still open" : <LocalDateTimeStack value={inspectedNode.row.exitTime} />}</dd></div>
            </dl>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
