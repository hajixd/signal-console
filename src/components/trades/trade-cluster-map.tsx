"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { UMAP } from "umap-js";
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
  features: number[];
};

type ViewState = {
  scale: number;
  x: number;
  y: number;
};

const MAP_WIDTH = 1200;
const MAP_HEIGHT = 700;
const INITIAL_VIEW: ViewState = { scale: 1, x: 0, y: 0 };
const UMAP_MAX_FIT_NODES = 1400;
const FEATURE_COUNT = 31;
const SELECTED_NEIGHBOR_COUNT = 8;
const FEATURE_LABELS = [
  "R multiple", "Risk efficiency", "P&L (log)", "Risk (log)", "Target (log)", "Target / risk",
  "Duration (log)", "Size (log)", "Hour sin", "Hour cos", "Weekday sin", "Weekday cos", "Recency",
  "Direction", "Source", "Open state", "Outcome", "Strategy 1", "Strategy 2", "Strategy 3", "Strategy 4",
  "Strategy 5", "Strategy 6", "Symbol 1", "Symbol 2", "Symbol 3", "Symbol 4", "Phase 1", "Phase 2",
  "Exit reason 1", "Exit reason 2"
] as const;

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

function sessionForDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const hour = date.getUTCHours();
  if (hour < 7) return "Asia";
  if (hour < 13) return "London";
  if (hour < 21) return "New York";
  return "After Hours";
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

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function finiteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function logScale(value: number): number {
  return Math.sign(value) * Math.log1p(Math.abs(value));
}

function cyclic(value: number, period: number): [number, number] {
  const angle = (value / period) * Math.PI * 2;
  return [Math.sin(angle), Math.cos(angle)];
}

function hashedCategory(value: string | undefined, dimensions: number, weight: number): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  if (!value) return vector;
  const hash = hashText(value.toLowerCase());
  vector[hash % dimensions] = weight;
  vector[(hash >>> 8) % dimensions] += weight * 0.35;
  return vector;
}

function parsedR(row: TradeHistoryRow): number {
  const parsed = Number.parseFloat(row.rMultipleLabel.replace(/[^\d+-.]/g, ""));
  if (Number.isFinite(parsed)) return Math.max(-8, Math.min(8, parsed));
  return row.riskDollars > 0 ? Math.max(-8, Math.min(8, row.pnlDollars / row.riskDollars)) : 0;
}

function buildFeatureNodes(historyRows: TradeHistoryRow[], liveRows: TradeHistoryRow[]): ClusterNode[] {
  const sourcedRows = [
    ...historyRows.map((row) => ({ row, source: "history" as const })),
    ...liveRows.map((row) => ({ row, source: "live" as const }))
  ];
  const entryTimes = sourcedRows.map(({ row }) => Date.parse(row.entryTime)).filter(Number.isFinite);
  const earliest = Math.min(...entryTimes, Date.now());
  const latest = Math.max(...entryTimes, earliest + 1);

  const nodes = sourcedRows.map(({ row, source }) => {
    const entryDate = new Date(row.entryTime);
    const hour = Number.isFinite(entryDate.getTime()) ? entryDate.getHours() + entryDate.getMinutes() / 60 : 0;
    const weekday = Number.isFinite(entryDate.getTime()) ? entryDate.getDay() : 0;
    const [hourSin, hourCos] = cyclic(hour, 24);
    const [weekdaySin, weekdayCos] = cyclic(weekday, 7);
    const risk = Math.max(0, finiteNumber(row.riskDollars));
    const target = Math.max(0, finiteNumber(row.targetDollars));
    const pnl = finiteNumber(row.pnlDollars);
    const rMultiple = parsedR(row);
    const durationBars = Math.max(0, finiteNumber(row.exitIndex) - finiteNumber(row.entryIndex));
    const riskEfficiency = risk > 0 ? Math.max(-8, Math.min(8, pnl / risk)) : 0;
    const targetRisk = risk > 0 ? Math.max(0, Math.min(10, target / risk)) : 0;
    const entryMs = Date.parse(row.entryTime);
    const recency = Number.isFinite(entryMs) ? (entryMs - earliest) / Math.max(1, latest - earliest) : 0;
    const outcome = outcomeForRow(row);
    const features = [
      rMultiple * 1.7,
      riskEfficiency * 1.4,
      logScale(pnl) * 0.28,
      logScale(risk) * 0.34,
      logScale(target) * 0.34,
      targetRisk * 0.62,
      logScale(durationBars) * 0.48,
      logScale(Math.max(0, row.sizeMultiplier)) * 0.3,
      hourSin * 0.8,
      hourCos * 0.8,
      weekdaySin * 0.66,
      weekdayCos * 0.66,
      recency * 0.72,
      row.side === "long" ? -0.75 : 0.75,
      source === "live" ? 0.8 : -0.25,
      outcome === "open" ? 1.25 : 0,
      outcome === "win" ? 0.72 : outcome === "loss" ? -0.72 : 0,
      ...hashedCategory(row.modelName || row.strategyKey, 6, 1.35),
      ...hashedCategory(row.displaySymbol || row.symbol, 4, 1.05),
      ...hashedCategory(row.phase, 2, 0.72),
      ...hashedCategory(row.exitReasonLabel, 2, 0.72)
    ];
    return {
      id: `${source}:${row.id}`,
      source,
      row,
      x: MAP_WIDTH / 2,
      y: MAP_HEIGHT / 2,
      radius: source === "live" ? (outcome === "open" ? 5.4 : 4.6) : 3,
      outcome,
      searchText: nodeSearchText(row, source),
      features
    };
  });
  return nodes;
}

function featureDistance(left: number[], right: number[]): number {
  let distance = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    distance += ((left[index] ?? 0) - (right[index] ?? 0)) ** 2;
  }
  return distance;
}

function fitEmbeddingToCanvas(embedding: number[][]): Array<[number, number]> {
  if (!embedding.length) return [];
  const xs = embedding.map((point) => point[0] ?? 0).sort((a, b) => a - b);
  const ys = embedding.map((point) => point[1] ?? 0).sort((a, b) => a - b);
  const lowIndex = Math.floor((embedding.length - 1) * 0.015);
  const highIndex = Math.ceil((embedding.length - 1) * 0.985);
  const minX = xs[lowIndex] ?? xs[0] ?? 0;
  const maxX = xs[highIndex] ?? xs[xs.length - 1] ?? minX + 1;
  const minY = ys[lowIndex] ?? ys[0] ?? 0;
  const maxY = ys[highIndex] ?? ys[ys.length - 1] ?? minY + 1;
  return embedding.map((point) => [
    46 + ((Math.max(minX, Math.min(maxX, point[0] ?? 0)) - minX) / Math.max(1e-9, maxX - minX)) * (MAP_WIDTH - 92),
    42 + ((Math.max(minY, Math.min(maxY, point[1] ?? 0)) - minY) / Math.max(1e-9, maxY - minY)) * (MAP_HEIGHT - 84)
  ]);
}

async function embedFeatureNodes(nodes: ClusterNode[]): Promise<ClusterNode[]> {
  if (nodes.length < 3) {
    return nodes.map((node, index) => ({ ...node, x: MAP_WIDTH * (0.42 + index * 0.16), y: MAP_HEIGHT / 2 }));
  }
  const fitCount = Math.min(UMAP_MAX_FIT_NODES, nodes.length);
  const fitIndexes = Array.from({ length: fitCount }, (_, index) => Math.floor((index / fitCount) * nodes.length));
  const fitNodes = fitIndexes.map((index) => nodes[index]!);
  const seed = nodes.reduce((value, node) => value ^ hashText(node.id), 0x9e3779b9);
  const umap = new UMAP({
    minDist: 0.12,
    nComponents: 2,
    nEpochs: fitCount < 350 ? 360 : fitCount < 800 ? 280 : 220,
    nNeighbors: Math.min(22, Math.max(2, fitCount - 1)),
    random: seededRandom(seed),
    spread: 1.15
  });
  const fittedEmbedding = await umap.fitAsync(fitNodes.map((node) => node.features));
  const fittedByIndex = new Map(fitIndexes.map((nodeIndex, index) => [nodeIndex, fittedEmbedding[index]!]));
  const fullEmbedding = nodes.map((node, nodeIndex) => {
    const fitted = fittedByIndex.get(nodeIndex);
    if (fitted) return fitted;
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    const candidateCount = Math.min(240, fitNodes.length);
    const offset = hashText(node.id) % fitNodes.length;
    for (let candidate = 0; candidate < candidateCount; candidate += 1) {
      const index = (offset + Math.floor((candidate / candidateCount) * fitNodes.length)) % fitNodes.length;
      const distance = featureDistance(node.features, fitNodes[index]!.features);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    const anchor = fittedEmbedding[nearestIndex] ?? [0, 0];
    const jitter = seededRandom(hashText(node.id));
    return [anchor[0] + (jitter() - 0.5) * 0.06, anchor[1] + (jitter() - 0.5) * 0.06];
  });
  const coordinates = fitEmbeddingToCanvas(fullEmbedding);
  return nodes.map((node, index) => ({ ...node, x: coordinates[index]?.[0] ?? MAP_WIDTH / 2, y: coordinates[index]?.[1] ?? MAP_HEIGHT / 2 }));
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
  const [nodes, setNodes] = useState<ClusterNode[]>([]);
  const [projectionStatus, setProjectionStatus] = useState<"computing" | "ready" | "fallback">("computing");
  const dragRef = useRef<{ pointerId: number; x: number; y: number; viewX: number; viewY: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const featureNodes = useMemo(() => buildFeatureNodes(historyRows, liveRows), [historyRows, liveRows]);

  useEffect(() => {
    let cancelled = false;
    setProjectionStatus("computing");
    setNodes([]);
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      try {
        const embeddedNodes = await embedFeatureNodes(featureNodes);
        if (cancelled) return;
        setNodes(embeddedNodes);
        setProjectionStatus("ready");
      } catch (error) {
        if (cancelled) return;
        console.error("UMAP trade projection failed; using feature-axis fallback.", error);
        const fallbackCoordinates = fitEmbeddingToCanvas(featureNodes.map((node) => [node.features[0] ?? 0, node.features[1] ?? 0]));
        setNodes(featureNodes.map((node, index) => ({
          ...node,
          x: fallbackCoordinates[index]?.[0] ?? MAP_WIDTH / 2,
          y: fallbackCoordinates[index]?.[1] ?? MAP_HEIGHT / 2
        })));
        setProjectionStatus("fallback");
      }
    }, 20);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [featureNodes]);
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
  const selectedNeighborEdges = useMemo(() => {
    if (!inspectedNode || !visibleIds.has(inspectedNode.id)) return [];
    return filteredNodes
      .filter((node) => node.id !== inspectedNode.id)
      .map((node) => ({
        distance: featureDistance(inspectedNode.features, node.features),
        from: inspectedNode,
        to: node
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, SELECTED_NEIGHBOR_COUNT)
      .map((edge, index, matches) => {
        const minimum = matches[0]?.distance ?? edge.distance;
        const maximum = matches.at(-1)?.distance ?? edge.distance;
        const proximity = 1 - (edge.distance - minimum) / Math.max(1e-9, maximum - minimum);
        return { ...edge, proximity };
      });
  }, [filteredNodes, inspectedNode, visibleIds]);
  const selectedNeighborIds = useMemo(
    () => new Set(selectedNeighborEdges.map((edge) => edge.to.id)),
    [selectedNeighborEdges]
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const handleWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      const svg = stage.querySelector("svg");
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const pointerX = ((event.clientX - rect.left) / rect.width) * MAP_WIDTH;
      const pointerY = ((event.clientY - rect.top) / rect.height) * MAP_HEIGHT;
      setView((current) => {
        const nextScale = Math.max(0.65, Math.min(4.5, current.scale * Math.exp(-event.deltaY * 0.0012)));
        const worldX = (pointerX - current.x) / current.scale;
        const worldY = (pointerY - current.y) / current.scale;
        return {
          scale: nextScale,
          x: pointerX - worldX * nextScale,
          y: pointerY - worldY * nextScale
        };
      });
    };
    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, []);

  const edges = useMemo(() => {
    const result: Array<{ distance: number; from: ClusterNode; proximity: number; to: ClusterNode }> = [];
    if (filteredNodes.length < 2) return result;
    const edgeNodes = filteredNodes.slice(0, 1_500);
    const raw: Array<{ distance: number; from: ClusterNode; to: ClusterNode }> = [];
    const seen = new Set<string>();
    for (let sourceIndex = 0; sourceIndex < edgeNodes.length; sourceIndex += 1) {
      const source = edgeNodes[sourceIndex]!;
      const nearest: Array<{ distance: number; node: ClusterNode }> = [];
      for (let targetIndex = 0; targetIndex < edgeNodes.length; targetIndex += 1) {
        if (sourceIndex === targetIndex) continue;
        const target = edgeNodes[targetIndex]!;
        const distance = featureDistance(source.features, target.features);
        if (nearest.length < SELECTED_NEIGHBOR_COUNT || distance < nearest[nearest.length - 1]!.distance) {
          let insertAt = nearest.length;
          while (insertAt > 0 && distance < nearest[insertAt - 1]!.distance) insertAt -= 1;
          nearest.splice(insertAt, 0, { distance, node: target });
          if (nearest.length > SELECTED_NEIGHBOR_COUNT) nearest.pop();
        }
      }
      for (const match of nearest) {
        const key = source.id < match.node.id ? `${source.id}:${match.node.id}` : `${match.node.id}:${source.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        raw.push({ distance: match.distance, from: source, to: match.node });
      }
    }
    const minimum = Math.min(...raw.map((edge) => edge.distance));
    const maximum = Math.max(...raw.map((edge) => edge.distance));
    for (const edge of raw) {
      result.push({
        ...edge,
        proximity: 1 - (edge.distance - minimum) / Math.max(1e-9, maximum - minimum)
      });
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
          <p>Every point is a trade. UMAP projects {FEATURE_COUNT} execution, risk, timing, outcome, and identity features into similarity neighborhoods.</p>
        </div>
        <div className="tradeClusterSummary" aria-label="Visible cluster summary">
          <span className="projection"><b>UMAP</b> {projectionStatus === "ready" ? "ready" : projectionStatus === "fallback" ? "fallback" : "projecting"}</span>
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

      <div className="tradeClusterStage" ref={stageRef}>
        <svg
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          role="img"
          aria-label={`${filteredNodes.length} trade nodes grouped by strategy`}
        >
          <defs>
            <pattern id="trade-cluster-grid" width="22" height="22" patternUnits="userSpaceOnUse">
              <path d="M 22 0 L 0 0 0 22" className="tradeClusterGrid" />
            </pattern>
            <filter id="trade-cluster-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="trade-cluster-line-glow" filterUnits="userSpaceOnUse" x="-2400" y="-1400" width="4800" height="2800">
              <feGaussianBlur stdDeviation="7" result="lineBlur" />
              <feMerge><feMergeNode in="lineBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <rect width={MAP_WIDTH} height={MAP_HEIGHT} className="tradeClusterBackdrop" />
          <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#trade-cluster-grid)" />
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            <g className={`tradeClusterEdges${selectedNeighborEdges.length ? " hasSelection" : ""}`}>
              {edges.map(({ from, proximity, to }) => (
                <line
                  key={`${from.id}:${to.id}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  style={{
                    opacity: selectedNeighborEdges.length ? 0.1 + proximity * 0.08 : 0.13 + proximity * 0.14,
                    stroke: `rgba(${Math.round(70 + proximity * 33)}, ${Math.round(150 + proximity * 82)}, 249, 1)`,
                    strokeWidth: 0.55 + proximity * 0.65
                  }}
                />
              ))}
            </g>
            <g className="tradeClusterNeighborEdges">
              {selectedNeighborEdges.map(({ from, proximity, to }, index) => (
                <g key={`selected:${from.id}:${to.id}`}>
                  <line className="underlay" filter="url(#trade-cluster-line-glow)" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
                  <line
                    className="core"
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    style={{
                      opacity: 0.92 + proximity * 0.08,
                      stroke: proximity > 0.5 ? "#a5f3fc" : "#60a5fa",
                      strokeWidth: 3.6 + proximity * 4.4
                    }}
                  >
                    <title>{`Neighbor ${index + 1}: ${to.row.displaySymbol || to.row.symbol}`}</title>
                  </line>
                </g>
              ))}
            </g>
            <g>
              {nodes.map((node) => {
                const filteredOut = !visibleIds.has(node.id);
                    const searchDimmed = normalizedQuery ? !node.searchText.includes(normalizedQuery) : false;
                    const selected = node.id === selectedId;
                    const selectedNeighbor = selectedNeighborIds.has(node.id);
                    return (
                  <circle
                    aria-label={`${node.source} ${node.row.displaySymbol || node.row.symbol} ${node.outcome}`}
                    className={`tradeClusterNode ${node.source} ${node.outcome}${filteredOut ? " isFiltered" : ""}${searchDimmed && !selectedNeighbor ? " isDimmed" : ""}${selected ? " isSelected" : ""}${selectedNeighbor ? " isNeighbor" : ""}${matchingIds.has(node.id) ? " isMatch" : ""}`}
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
                  />
                );
              })}
            </g>
          </g>
        </svg>

        {projectionStatus === "computing" ? <div className="tradeClusterProjectionState" role="status" aria-label="Building UMAP projection"><i /></div> : null}
        {inspectedNode ? (
          <aside className="tradeClusterInspector" aria-label="Selected trade details">
            <div className="tradeClusterInspectorTitle">
              <strong>Selected</strong>
              <span
                aria-label={inspectedNode.outcome === "loss" ? "Losing trade" : "Winning or active trade"}
                className={inspectedNode.outcome === "loss" ? "loss" : "positive"}
                title={inspectedNode.outcome === "loss" ? "Losing trade" : "Winning or active trade"}
              >
                ⚑
              </span>
            </div>
            <dl>
              <div><dt>ID</dt><dd>{inspectedNode.row.indexLabel || inspectedNode.row.id}</dd></div>
              <div><dt>Kind</dt><dd className="accent">{inspectedNode.source === "live" ? "Live" : "History"}</dd></div>
              <div><dt>Library</dt><dd>Trades</dd></div>
              <div><dt>Symbol</dt><dd>{inspectedNode.row.displaySymbol || inspectedNode.row.symbol}</dd></div>
              <div><dt>Direction</dt><dd className={inspectedNode.row.side === "long" ? "win" : "loss"}>{inspectedNode.row.sideLabel}</dd></div>
              <div><dt>Entry Date</dt><dd><LocalDateTimeStack value={inspectedNode.row.entryTime} /></dd></div>
              <div><dt>Exit Date</dt><dd>{inspectedNode.outcome === "open" ? "—" : <LocalDateTimeStack value={inspectedNode.row.exitTime} />}</dd></div>
              <div><dt>Duration</dt><dd>{Math.max(0, finiteNumber(inspectedNode.row.exitIndex) - finiteNumber(inspectedNode.row.entryIndex)).toLocaleString()} bars</dd></div>
              <div><dt>Session</dt><dd>{sessionForDate(inspectedNode.row.entryTime)}</dd></div>
              <div><dt>Weekday</dt><dd>{new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date(inspectedNode.row.entryTime))}</dd></div>
              <div><dt>Entry Method</dt><dd>{shortLabel(inspectedNode.row.modelName || inspectedNode.row.strategyKey, 28)}</dd></div>
              <div><dt>AI Entry</dt><dd className="ai">Model</dd></div>
              <div><dt>Entry Price</dt><dd>{inspectedNode.row.entryPriceLabel}</dd></div>
              <div><dt>Exit Price</dt><dd>{inspectedNode.outcome === "open" ? "—" : inspectedNode.row.exitPriceLabel}</dd></div>
              <div><dt>Risk</dt><dd>{inspectedNode.row.riskLabel}</dd></div>
              <div><dt>Target</dt><dd>{inspectedNode.row.targetLabel}</dd></div>
              <div><dt>R Multiple</dt><dd>{inspectedNode.row.rMultipleLabel}</dd></div>
              <div><dt>Size</dt><dd>{inspectedNode.row.sizeLabel}</dd></div>
              <div><dt>MIT ID</dt><dd className="mit">{selectedNeighborEdges[0]?.to.row.indexLabel || selectedNeighborEdges[0]?.to.row.id || "—"}</dd></div>
              <div><dt>Exit Method</dt><dd>{inspectedNode.row.exitReasonLabel}</dd></div>
              <div><dt>P&L</dt><dd className={inspectedNode.outcome}>{inspectedNode.outcome === "open" ? "Open" : signedMoney(inspectedNode.row.pnlDollars)}</dd></div>
            </dl>
            <div className="tradeClusterNeighbors">
              <div className="tradeClusterNeighborsHeader">
                <strong>Nearest Neighbors</strong>
                <span>k={selectedNeighborEdges.length}</span>
              </div>
              <div className="tradeClusterNeighborList">
                {selectedNeighborEdges.map(({ distance, proximity, to }, index) => (
                  <button
                    key={to.id}
                    onClick={() => focusNode(to)}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    type="button"
                  >
                    <i>{index + 1}</i>
                    <span>
                      <strong>{to.row.indexLabel || to.row.id}</strong>
                      <small>{to.row.displaySymbol || to.row.symbol} · {shortLabel(to.row.modelName || to.row.strategyKey, 22)}</small>
                    </span>
                    <span className="tradeClusterNeighborMetric">
                      <b>{Math.round(proximity * 100)}%</b>
                      <small>d {Math.sqrt(distance).toFixed(3)}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <details className="tradeClusterCalculation">
              <summary>High-dimensional calculation</summary>
              <p>Euclidean distance: √Σ(featureᵢ − neighborᵢ)². Smaller distance means a closer market-state neighbor. UMAP uses the same standardized 31-feature vectors for the 2D projection.</p>
              <div>
                {inspectedNode.features.map((value, index) => (
                  <span key={`${FEATURE_LABELS[index] ?? "Feature"}:${index}`}>
                    <i>{FEATURE_LABELS[index] ?? `Feature ${index + 1}`}</i>
                    <b>{value.toFixed(4)}</b>
                  </span>
                ))}
              </div>
            </details>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
