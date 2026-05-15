"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  emitStrategyEditsChanged,
  loadClientStrategyEdits,
  STRATEGY_EDITS_STORAGE_KEY,
  type StrategyEdit,
  type StrategyEditMap,
  type StrategyEditSeedMap
} from "@/components/strategies/strategy-edits-store";

type StrategyOption = {
  key: string;
  label: string;
  aliases?: string[];
  timeframeLabel: string;
  symbol: string;
  phase: string;
  market?: string;
  winRatePct: number;
  profitFactor: number;
  trades: number;
  tradesPerWeek: number;
  tpUnits: number;
  slUnits: number;
  unitLabel: string;
  dollarPerUnit: number;
  targetDollars: number;
  riskDollars: number;
  riskRewardRatio?: number;
  sizeLabel: string;
  tpMode?: "fixed" | "custom";
  slMode?: "fixed" | "custom";
  sizeMode?: "auto" | "custom";
  rrrMode?: "fixed" | "custom";
  liveSupported: boolean;
};

type MarketKey = "forex" | "futures";

type StrategySelectorProps = {
  market: MarketKey;
  strategies: StrategyOption[];
  selectedKeys: string[];
  persistedLiveKeys: string[];
  persistedCustomScaleRange: CustomScaleRangeSeed;
  persistedStrategyEdits: StrategyEditSeedMap;
  persistLiveSelection: (selectedKeys: string[], scopeKeys?: string[]) => Promise<void>;
  persistCustomScaleRange: (market: MarketKey, range: CustomScaleRangeSeed) => Promise<void>;
  persistStrategyEdits: (edits: StrategyEditSeedMap, scopeKeys?: string[]) => Promise<void>;
};

type SortColumn = "ticker" | "model" | "profitFactor" | "winRate" | "trades" | "target" | "risk" | "rrr" | "size" | "scale" | "enabled";
type SortDirection = "asc" | "desc";
type CustomScaleRangeInput = {
  riskCeiling: string;
  riskFloor: string;
  targetCeiling: string;
  targetFloor: string;
};
type CustomScaleRangeSeed = Partial<Record<keyof CustomScaleRangeInput, unknown>>;
type CustomScaleDollarRange = {
  riskCeiling: number;
  riskFloor: number;
  targetCeiling: number;
  targetFloor: number;
};
type CustomScaleOutcome = {
  edit: StrategyEdit;
  fit: boolean;
  changed: boolean;
};
type CustomScaleResult = {
  applied: number;
  closest: number;
  total: number;
  unchanged: number;
};
type CustomSelectionInput = {
  minProfitFactor: string;
  minWinRate: string;
};
type CustomSelectionCriteria = {
  minProfitFactor: number;
  minWinRate: number;
};
type CustomSelectionResult = {
  selected: number;
  total: number;
};

const STORAGE_KEY = STRATEGY_EDITS_STORAGE_KEY;
const CUSTOM_SCALE_RANGE_STORAGE_KEY_PREFIX = "trading-bot-custom-scale-range";
const STRATEGY_SIZES_PARAM = "strategySizes";
const EDIT_RENDER_DELAY_MS = 650;
const SELECTION_SYNC_DELAY_MS = 650;
const EMPTY_CUSTOM_SCALE_RANGE: CustomScaleRangeInput = {
  riskCeiling: "",
  riskFloor: "",
  targetCeiling: "",
  targetFloor: ""
};
const EMPTY_CUSTOM_SELECTION: CustomSelectionInput = {
  minProfitFactor: "",
  minWinRate: ""
};

function isCustomScaleRangeInput(value: unknown): value is Partial<CustomScaleRangeInput> {
  return Boolean(value && typeof value === "object");
}

function customScaleRangeStorageKey(market: MarketKey): string {
  return `${CUSTOM_SCALE_RANGE_STORAGE_KEY_PREFIX}:${market}`;
}

function normalizeCustomScaleRangeInput(value: CustomScaleRangeSeed | null | undefined): CustomScaleRangeInput {
  return {
    riskCeiling: typeof value?.riskCeiling === "string" ? value.riskCeiling : "",
    riskFloor: typeof value?.riskFloor === "string" ? value.riskFloor : "",
    targetCeiling: typeof value?.targetCeiling === "string" ? value.targetCeiling : "",
    targetFloor: typeof value?.targetFloor === "string" ? value.targetFloor : ""
  };
}

function compactCustomScaleRangeInput(value: CustomScaleRangeInput): CustomScaleRangeSeed {
  const compact: CustomScaleRangeSeed = {};
  const riskCeiling = value.riskCeiling.trim();
  const riskFloor = value.riskFloor.trim();
  const targetCeiling = value.targetCeiling.trim();
  const targetFloor = value.targetFloor.trim();

  if (riskCeiling) compact.riskCeiling = riskCeiling;
  if (riskFloor) compact.riskFloor = riskFloor;
  if (targetCeiling) compact.targetCeiling = targetCeiling;
  if (targetFloor) compact.targetFloor = targetFloor;

  return compact;
}

function customScaleRangeSignature(value: CustomScaleRangeInput): string {
  const compact = compactCustomScaleRangeInput(value);
  return JSON.stringify(
    Object.keys(compact)
      .sort()
      .map((key) => [key, compact[key as keyof CustomScaleRangeInput]])
  );
}

function loadClientCustomScaleRange(storageKey: string, persistedRange: CustomScaleRangeSeed = {}): CustomScaleRangeInput {
  const persisted = normalizeCustomScaleRangeInput(persistedRange);
  if (hasCustomScaleRangeValue(persisted) || typeof window === "undefined") return persisted;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return EMPTY_CUSTOM_SCALE_RANGE;
    const parsed: unknown = JSON.parse(raw);
    if (!isCustomScaleRangeInput(parsed)) return EMPTY_CUSTOM_SCALE_RANGE;

    return {
      riskCeiling: typeof parsed.riskCeiling === "string" ? parsed.riskCeiling : "",
      riskFloor: typeof parsed.riskFloor === "string" ? parsed.riskFloor : "",
      targetCeiling: typeof parsed.targetCeiling === "string" ? parsed.targetCeiling : "",
      targetFloor: typeof parsed.targetFloor === "string" ? parsed.targetFloor : ""
    };
  } catch {
    return EMPTY_CUSTOM_SCALE_RANGE;
  }
}

function hasCustomScaleRangeValue(value: CustomScaleRangeInput): boolean {
  return Object.values(value).some((entry) => entry.trim().length > 0);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0
  }).format(value);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "inf";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatScaleRatio(value: number): string {
  if (!Number.isFinite(value)) return "--";
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Math.abs(value - 1) < 0.005 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value);
  return `${formatted}x`;
}

function formatPct(value: number): string {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value)}%`;
}

function formatMarket(value: string | undefined): string {
  if (!value) return "Market";
  if (value === "gold_spot") return "Forex";
  if (value === "multi") return "Multi-market";
  return value
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function splitSizeLabel(value: string): { contracts: number; sizeName: string } {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
  if (!match) return { contracts: 1, sizeName: value.trim() || "contract" };
  return {
    contracts: Number(match[1]),
    sizeName: match[2]
  };
}

function formatSizeLabel(contracts: number, sizeName: string): string {
  return `${formatNumber(contracts)} ${sizeName.trim() || "contract"}`;
}

function displayTargetLabel(strategy: StrategyOption, value: number): string {
  return strategy.tpMode === "custom" ? "Custom Unit" : formatMoney(value);
}

function displayRiskLabel(strategy: StrategyOption, value: number): string {
  return strategy.slMode === "custom" ? "Custom Unit" : formatMoney(value);
}

function displaySizeLabel(strategy: StrategyOption, contracts: number, sizeName: string): string {
  return strategy.sizeMode === "custom" ? "Custom Unit" : formatSizeLabel(contracts, sizeName);
}

function riskRewardRatio(targetDollars: number, riskDollars: number): number | undefined {
  return riskDollars > 0 ? targetDollars / riskDollars : undefined;
}

function displayRiskRewardLabel(strategy: StrategyOption, value: number | undefined, hasBacktestTrades: boolean): string {
  if (!hasBacktestTrades) return "--";
  if (strategy.rrrMode === "custom") return "Custom Unit";
  return Number.isFinite(value) ? formatNumber(value ?? 0) : "--";
}

function roundControlValue(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundDollars(value: number): number {
  return Math.round(value * 100) / 100;
}

function defaultEdit(strategy: StrategyOption): StrategyEdit {
  const size = splitSizeLabel(strategy.sizeLabel);
  return {
    modelName: strategy.label,
    contracts: roundControlValue(size.contracts),
    sizeName: size.sizeName,
    scale: 1,
    tpUnits: roundControlValue(strategy.tpUnits),
    slUnits: roundControlValue(strategy.slUnits),
    targetDollars: roundControlValue(strategy.targetDollars),
    riskDollars: roundControlValue(strategy.riskDollars)
  };
}

function scaleForContracts(strategy: StrategyOption, contracts: number): number {
  const baseContracts = defaultEdit(strategy).contracts || 1;
  return contracts / baseContracts;
}

function contractsForScale(strategy: StrategyOption, scale: number): number {
  const baseContracts = defaultEdit(strategy).contracts || 1;
  return roundControlValue(Math.max(0.01, baseContracts * Math.max(0.01, scale)));
}

function dollarsFromUnits(strategy: StrategyOption, units: number, contracts: number): number {
  return roundControlValue(Math.abs(units * strategy.dollarPerUnit * scaleForContracts(strategy, contracts)));
}

function unitsFromDollars(strategy: StrategyOption, dollars: number, contracts: number): number {
  const dollarValue = Math.abs(strategy.dollarPerUnit * scaleForContracts(strategy, contracts));
  return dollarValue ? roundControlValue(Math.abs(dollars) / dollarValue) : 0;
}

function normalizeEdit(strategy: StrategyOption, edit: StrategyEdit): StrategyEdit {
  const fallback = defaultEdit(strategy);
  const savedScale = Number.isFinite(edit.scale) && edit.scale > 0 ? roundControlValue(edit.scale) : undefined;
  const hasContracts = Number.isFinite(edit.contracts) && edit.contracts > 0;
  const contracts =
    hasContracts
      ? roundControlValue(edit.contracts)
      : savedScale
        ? roundControlValue(fallback.contracts * savedScale)
        : fallback.contracts;
  let tpUnits = Number.isFinite(edit.tpUnits) && edit.tpUnits > 0 ? roundControlValue(edit.tpUnits) : 0;
  let slUnits = Number.isFinite(edit.slUnits) && edit.slUnits > 0 ? roundControlValue(edit.slUnits) : 0;
  let targetDollars = Number.isFinite(edit.targetDollars) && edit.targetDollars > 0 ? roundControlValue(edit.targetDollars) : 0;
  let riskDollars = Number.isFinite(edit.riskDollars) && edit.riskDollars > 0 ? roundControlValue(edit.riskDollars) : 0;

  if (tpUnits <= 0 && targetDollars > 0) tpUnits = unitsFromDollars(strategy, targetDollars, contracts);
  if (slUnits <= 0 && riskDollars > 0) slUnits = unitsFromDollars(strategy, riskDollars, contracts);
  if (targetDollars <= 0 && tpUnits > 0) targetDollars = dollarsFromUnits(strategy, tpUnits, contracts);
  if (riskDollars <= 0 && slUnits > 0) riskDollars = dollarsFromUnits(strategy, slUnits, contracts);

  if (tpUnits <= 0) tpUnits = fallback.tpUnits;
  if (slUnits <= 0) slUnits = fallback.slUnits;
  if (targetDollars <= 0) targetDollars = dollarsFromUnits(strategy, tpUnits, contracts) || fallback.targetDollars;
  if (riskDollars <= 0) riskDollars = dollarsFromUnits(strategy, slUnits, contracts) || fallback.riskDollars;

  return {
    modelName: fallback.modelName,
    contracts,
    sizeName: fallback.sizeName,
    scale: roundControlValue(scaleForContracts(strategy, contracts)),
    tpUnits,
    slUnits,
    targetDollars,
    riskDollars
  };
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.005;
}

function isDefaultEdit(strategy: StrategyOption, edit: StrategyEdit): boolean {
  const normalized = normalizeEdit(strategy, edit);
  const fallback = defaultEdit(strategy);
  return (
    normalized.modelName === fallback.modelName &&
    normalized.sizeName === fallback.sizeName &&
    nearlyEqual(normalized.contracts, fallback.contracts) &&
    nearlyEqual(normalized.scale, fallback.scale) &&
    nearlyEqual(normalized.tpUnits, fallback.tpUnits) &&
    nearlyEqual(normalized.slUnits, fallback.slUnits) &&
    nearlyEqual(normalized.targetDollars, fallback.targetDollars) &&
    nearlyEqual(normalized.riskDollars, fallback.riskDollars)
  );
}

function normalizeEditMap(strategies: StrategyOption[], edits: StrategyEditSeedMap): StrategyEditMap {
  const next: StrategyEditMap = {};
  for (const strategy of strategies) {
    const edit = edits[strategy.key];
    if (!edit) continue;
    const normalized = normalizeEdit(strategy, { ...defaultEdit(strategy), ...edit });
    if (!isDefaultEdit(strategy, normalized)) {
      next[strategy.key] = normalized;
    }
  }
  return next;
}

function serializeEdits(edits: StrategyEditMap): string {
  return JSON.stringify(
    Object.keys(edits)
      .sort()
      .map((key) => [key, edits[key]])
  );
}

function sameSelection(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((key, index) => key === right[index]);
}

function parseStrategySizesParam(value: string | undefined): Map<string, number> {
  const sizes = new Map<string, number>();
  if (!value) return sizes;

  for (const entry of value.split(",")) {
    const splitIndex = entry.lastIndexOf(":");
    if (splitIndex <= 0) continue;
    const key = decodeURIComponent(entry.slice(0, splitIndex));
    const contracts = Number(entry.slice(splitIndex + 1));
    if (key && Number.isFinite(contracts) && contracts > 0) {
      sizes.set(key, contracts);
    }
  }

  return sizes;
}

function editWithContracts(strategy: StrategyOption, edit: StrategyEdit, contractsValue: number): StrategyEdit {
  const normalized = normalizeEdit(strategy, edit);
  const contracts = roundControlValue(Math.max(0.01, contractsValue));
  return {
    ...normalized,
    contracts,
    scale: roundControlValue(scaleForContracts(strategy, contracts)),
    targetDollars: dollarsFromUnits(strategy, normalized.tpUnits, contracts),
    riskDollars: dollarsFromUnits(strategy, normalized.slUnits, contracts)
  };
}

function applyStrategySizesParam(strategies: StrategyOption[], current: StrategyEditMap, value: string | undefined): StrategyEditMap {
  const sizes = parseStrategySizesParam(value);
  if (!sizes.size) return current;

  const next: StrategyEditMap = { ...current };
  for (const strategy of strategies) {
    const contracts = sizes.get(strategy.key);
    if (!contracts) continue;
    const currentEdit = current[strategy.key] ? normalizeEdit(strategy, current[strategy.key]) : defaultEdit(strategy);
    const adjusted = editWithContracts(strategy, currentEdit, contracts);
    if (isDefaultEdit(strategy, adjusted)) {
      delete next[strategy.key];
    } else {
      next[strategy.key] = adjusted;
    }
  }

  return next;
}

function scaledEdit(strategy: StrategyOption, edit: StrategyEdit, multiplier: number): StrategyEdit {
  const normalized = normalizeEdit(strategy, edit);
  const contracts = roundControlValue(Math.max(0.01, normalized.contracts * multiplier));
  return {
    ...normalized,
    contracts,
    scale: roundControlValue(scaleForContracts(strategy, contracts)),
    targetDollars: dollarsFromUnits(strategy, normalized.tpUnits, contracts),
    riskDollars: dollarsFromUnits(strategy, normalized.slUnits, contracts)
  };
}

function parseCustomScaleRange(input: CustomScaleRangeInput): { error?: string; range?: CustomScaleDollarRange } {
  const targetFloor = Number(input.targetFloor);
  const targetCeiling = Number(input.targetCeiling);
  const riskFloor = Number(input.riskFloor);
  const riskCeiling = Number(input.riskCeiling);

  if (![targetFloor, targetCeiling, riskFloor, riskCeiling].every((value) => Number.isFinite(value) && value > 0)) {
    return { error: "Enter positive dollar values for every range." };
  }

  if (targetFloor > targetCeiling || riskFloor > riskCeiling) {
    return { error: "Floors must be less than or equal to ceilings." };
  }

  return {
    range: {
      riskCeiling: roundDollars(riskCeiling),
      riskFloor: roundDollars(riskFloor),
      targetCeiling: roundDollars(targetCeiling),
      targetFloor: roundDollars(targetFloor)
    }
  };
}

function parseCustomSelection(input: CustomSelectionInput): { criteria?: CustomSelectionCriteria; error?: string } {
  const minProfitFactor = Number(input.minProfitFactor);
  const minWinRate = Number(input.minWinRate);

  if (!Number.isFinite(minProfitFactor) || minProfitFactor < 0) {
    return { error: "Enter a valid minimum profit factor." };
  }

  if (!Number.isFinite(minWinRate) || minWinRate < 0 || minWinRate > 100) {
    return { error: "Enter a minimum win rate from 0 to 100." };
  }

  return {
    criteria: {
      minProfitFactor,
      minWinRate
    }
  };
}

function dollarsInRange(value: number, floor: number, ceiling: number): boolean {
  return value + 0.01 >= floor && value - 0.01 <= ceiling;
}

function roundDownControlValue(value: number): number {
  return Math.floor(value * 100) / 100;
}

function highestContractsForScale(strategy: StrategyOption, scale: number): number {
  const baseContracts = defaultEdit(strategy).contracts || 1;
  return Math.max(0.01, roundDownControlValue(baseContracts * Math.max(0.01, scale)));
}

function customScaledEdit(strategy: StrategyOption, edit: StrategyEdit, range: CustomScaleDollarRange): CustomScaleOutcome {
  const normalized = normalizeEdit(strategy, edit);
  const fallback = defaultEdit(strategy);
  const targetAtBaseScale = dollarsFromUnits(strategy, normalized.tpUnits, fallback.contracts);
  const riskAtBaseScale = dollarsFromUnits(strategy, normalized.slUnits, fallback.contracts);

  if (targetAtBaseScale <= 0 || riskAtBaseScale <= 0) {
    return { edit: normalized, fit: false, changed: false };
  }

  const lowerScale = Math.max(0.01, range.targetFloor / targetAtBaseScale, range.riskFloor / riskAtBaseScale);
  const upperScale = Math.min(range.targetCeiling / targetAtBaseScale, range.riskCeiling / riskAtBaseScale);
  const nextScale =
    lowerScale <= upperScale
      ? upperScale
      : Math.sqrt(Math.max(0.01, lowerScale) * Math.max(0.01, upperScale));
  const adjusted = editWithContracts(
    strategy,
    normalized,
    lowerScale <= upperScale ? highestContractsForScale(strategy, nextScale) : contractsForScale(strategy, nextScale)
  );
  const fit =
    dollarsInRange(adjusted.targetDollars, range.targetFloor, range.targetCeiling) &&
    dollarsInRange(adjusted.riskDollars, range.riskFloor, range.riskCeiling);

  return {
    edit: adjusted,
    fit,
    changed: !nearlyEqual(adjusted.contracts, normalized.contracts)
  };
}

function strategyMatchesSearch(strategy: StrategyOption, edit: StrategyEdit, query: string): boolean {
  if (!query) return true;
  return [
    strategy.symbol,
    strategy.key,
    strategy.timeframeLabel,
    edit.modelName,
    formatMarket(strategy.market),
    edit.sizeName,
    ...(strategy.aliases ?? [])
  ].some((value) => value.toLowerCase().includes(query));
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en-US", {
    numeric: true,
    sensitivity: "base"
  });
}

function defaultSortDirection(column: SortColumn): SortDirection {
  if (column === "ticker" || column === "model") return "asc";
  return "desc";
}

export default function StrategySelector({
  market,
  strategies,
  selectedKeys,
  persistedLiveKeys,
  persistedCustomScaleRange,
  persistedStrategyEdits,
  persistLiveSelection,
  persistCustomScaleRange,
  persistStrategyEdits
}: StrategySelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startSavingSelection] = useTransition();
  const [isSavingEdits, startSavingEdits] = useTransition();
  const [, startSavingCustomScaleRange] = useTransition();
  const isRestricted = false;
  const [isLoaded, setIsLoaded] = useState(false);
  const [isCustomScaleLoaded, setIsCustomScaleLoaded] = useState(false);
  const [savingSelectionKeys, setSavingSelectionKeys] = useState<string[]>([]);
  const [edits, setEdits] = useState<StrategyEditMap>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<StrategyEdit | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [optimisticSelectedKeys, setOptimisticSelectedKeys] = useState(selectedKeys);
  const [isCustomScaleOpen, setIsCustomScaleOpen] = useState(false);
  const [isCustomSelectionOpen, setIsCustomSelectionOpen] = useState(false);
  const customScaleRangeKey = customScaleRangeStorageKey(market);
  const [customScaleRange, setCustomScaleRange] = useState<CustomScaleRangeInput>(() =>
    loadClientCustomScaleRange(customScaleRangeKey, persistedCustomScaleRange)
  );
  const [customScaleError, setCustomScaleError] = useState("");
  const [customScaleResult, setCustomScaleResult] = useState<CustomScaleResult | null>(null);
  const [customSelection, setCustomSelection] = useState<CustomSelectionInput>(EMPTY_CUSTOM_SELECTION);
  const [customSelectionError, setCustomSelectionError] = useState("");
  const [customSelectionResult, setCustomSelectionResult] = useState<CustomSelectionResult | null>(null);
  const selected = new Set(optimisticSelectedKeys);
  const activeStrategy = strategies.find((strategy) => strategy.key === activeKey);
  const hasEdits = Object.keys(edits).length > 0;
  const normalizedSearchQuery = isRestricted ? "" : searchQuery.trim().toLowerCase();
  const orderByKey = new Map(strategies.map((strategy, index) => [strategy.key, index]));
  const strategyScopeKeys = useMemo(() => strategies.map((strategy) => strategy.key), [strategies]);
  const strategyScopeSignature = strategyScopeKeys.join("|");
  const selectionSignature = selectedKeys.join("|");
  const optimisticSelectionSignature = optimisticSelectedKeys.join("|");
  const persistedLiveSelectionSignature = persistedLiveKeys.join("|");
  const persistedCustomScaleRangeInput = normalizeCustomScaleRangeInput(persistedCustomScaleRange);
  const persistedCustomScaleRangeSignature = customScaleRangeSignature(persistedCustomScaleRangeInput);
  const currentCustomScaleRangeSignature = customScaleRangeSignature(customScaleRange);
  const normalizedPersistedEdits = normalizeEditMap(strategies, persistedStrategyEdits);
  const persistedEditsSignature = serializeEdits(normalizedPersistedEdits);
  const currentEditSignature = serializeEdits(edits);
  const lastSyncedSelectionRef = useRef<string>("");
  const pendingSelectionSignatureRef = useRef<string>("");
  const latestSelectionSignatureRef = useRef<string>(optimisticSelectionSignature);
  const selectionSyncRunRef = useRef(0);
  const lastSyncedCustomScaleRangeRef = useRef<string>("");
  const pendingCustomScaleRangeSignatureRef = useRef<string>("");
  const lastSyncedEditsRef = useRef<string>("");
  const selectionSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customScaleSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestCustomScaleRangeSignatureRef = useRef<string>(currentCustomScaleRangeSignature);
  const customScaleSyncRunRef = useRef(0);
  const latestEditSignatureRef = useRef<string>(currentEditSignature);
  const editSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editSyncRunRef = useRef(0);
  const editControlsDisabled = isSavingEdits || isRestricted;
  const selectionControlsDisabled = isRestricted;
  const savingSelectionKeySet = useMemo(() => new Set(savingSelectionKeys), [savingSelectionKeys]);

  useEffect(() => {
    if (!isRestricted) return;
    setActiveKey(null);
    setDraft(null);
    setIsCustomScaleOpen(false);
    setIsCustomSelectionOpen(false);
    setSearchQuery("");
    setSortColumn(null);
    setSortDirection("desc");
    setCustomScaleError("");
    setCustomScaleResult(null);
    setCustomSelectionError("");
    setCustomSelectionResult(null);
  }, [isRestricted]);

  useEffect(() => {
    latestSelectionSignatureRef.current = optimisticSelectionSignature;
  }, [optimisticSelectionSignature]);

  useEffect(() => {
    latestCustomScaleRangeSignatureRef.current = currentCustomScaleRangeSignature;
  }, [currentCustomScaleRangeSignature]);

  useEffect(() => {
    const pendingSelectionSignature = pendingSelectionSignatureRef.current;
    if (
      pendingSelectionSignature &&
      selectionSignature !== pendingSelectionSignature &&
      persistedLiveSelectionSignature !== pendingSelectionSignature
    ) {
      return;
    }

    if (pendingSelectionSignature && (selectionSignature === pendingSelectionSignature || persistedLiveSelectionSignature === pendingSelectionSignature)) {
      pendingSelectionSignatureRef.current = "";
      setSavingSelectionKeys([]);
    }

    setOptimisticSelectedKeys(selectedKeys);
  }, [persistedLiveSelectionSignature, selectionSignature, selectedKeys]);

  useEffect(() => {
    return () => {
      if (selectionSyncTimerRef.current) clearTimeout(selectionSyncTimerRef.current);
      if (customScaleSyncTimerRef.current) clearTimeout(customScaleSyncTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (isLoaded) return;
    const urlParams = new URLSearchParams(window.location.search);
    const stored = loadClientStrategyEdits(strategies, persistedStrategyEdits);
    setEdits(applyStrategySizesParam(strategies, stored, urlParams.get(STRATEGY_SIZES_PARAM) ?? ""));
    setIsLoaded(true);
  }, [isLoaded, persistedStrategyEdits, strategies]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has(STRATEGY_SIZES_PARAM)) return;
    params.delete(STRATEGY_SIZES_PARAM);
    const nextQuery = params.toString();
    window.history.replaceState(window.history.state, "", nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [pathname]);

  useEffect(() => {
    if (!isLoaded) return;
    if (Object.keys(edits).length) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    emitStrategyEditsChanged(edits);
  }, [edits, isLoaded]);

  useEffect(() => {
    const pendingCustomScaleRangeSignature = pendingCustomScaleRangeSignatureRef.current;
    if (pendingCustomScaleRangeSignature && persistedCustomScaleRangeSignature !== pendingCustomScaleRangeSignature) return;
    if (isCustomScaleOpen && currentCustomScaleRangeSignature !== persistedCustomScaleRangeSignature) return;

    if (pendingCustomScaleRangeSignature && persistedCustomScaleRangeSignature === pendingCustomScaleRangeSignature) {
      pendingCustomScaleRangeSignatureRef.current = "";
    }

    setIsCustomScaleLoaded(false);
    setCustomScaleRange(loadClientCustomScaleRange(customScaleRangeKey, persistedCustomScaleRange));
    setCustomScaleError("");
    setCustomScaleResult(null);
    setIsCustomScaleLoaded(true);
  }, [currentCustomScaleRangeSignature, customScaleRangeKey, isCustomScaleOpen, persistedCustomScaleRange, persistedCustomScaleRangeSignature]);

  useEffect(() => {
    if (!isCustomScaleLoaded) return;
    if (typeof window === "undefined") return;
    if (hasCustomScaleRangeValue(customScaleRange)) {
      window.localStorage.setItem(customScaleRangeKey, JSON.stringify(customScaleRange));
    } else {
      window.localStorage.removeItem(customScaleRangeKey);
    }
  }, [customScaleRange, customScaleRangeKey, isCustomScaleLoaded]);

  useEffect(() => {
    if (!isCustomScaleLoaded) return;
    if (currentCustomScaleRangeSignature === persistedCustomScaleRangeSignature) {
      lastSyncedCustomScaleRangeRef.current = currentCustomScaleRangeSignature;
      latestCustomScaleRangeSignatureRef.current = currentCustomScaleRangeSignature;
      if (customScaleSyncTimerRef.current) {
        clearTimeout(customScaleSyncTimerRef.current);
        customScaleSyncTimerRef.current = null;
      }
      return;
    }
    if (lastSyncedCustomScaleRangeRef.current === currentCustomScaleRangeSignature) return;
    latestCustomScaleRangeSignatureRef.current = currentCustomScaleRangeSignature;
    if (customScaleSyncTimerRef.current) clearTimeout(customScaleSyncTimerRef.current);

    const syncRun = customScaleSyncRunRef.current + 1;
    customScaleSyncRunRef.current = syncRun;
    customScaleSyncTimerRef.current = setTimeout(() => {
      const rangeToSync = compactCustomScaleRangeInput(customScaleRange);
      const signatureToSync = currentCustomScaleRangeSignature;
      lastSyncedCustomScaleRangeRef.current = signatureToSync;
      pendingCustomScaleRangeSignatureRef.current = signatureToSync;
      customScaleSyncTimerRef.current = null;

      startSavingCustomScaleRange(async () => {
        try {
          await persistCustomScaleRange(market, rangeToSync);
        } catch (error) {
          console.error("Failed to sync custom strategy range", error);
          if (customScaleSyncRunRef.current === syncRun) {
            lastSyncedCustomScaleRangeRef.current = "";
            pendingCustomScaleRangeSignatureRef.current = "";
          }
        }
      });
    }, SELECTION_SYNC_DELAY_MS);

    return () => {
      if (customScaleSyncTimerRef.current) {
        clearTimeout(customScaleSyncTimerRef.current);
        customScaleSyncTimerRef.current = null;
      }
    };
  }, [
    currentCustomScaleRangeSignature,
    customScaleRange,
    isCustomScaleLoaded,
    market,
    persistCustomScaleRange,
    persistedCustomScaleRangeSignature
  ]);

  useEffect(() => {
    if (optimisticSelectionSignature === persistedLiveSelectionSignature) {
      lastSyncedSelectionRef.current = optimisticSelectionSignature;
      pendingSelectionSignatureRef.current = "";
      setSavingSelectionKeys([]);
      if (selectionSyncTimerRef.current) {
        clearTimeout(selectionSyncTimerRef.current);
        selectionSyncTimerRef.current = null;
      }
      return;
    }
    if (lastSyncedSelectionRef.current === optimisticSelectionSignature) return;

    if (selectionSyncTimerRef.current) clearTimeout(selectionSyncTimerRef.current);
    const syncRun = selectionSyncRunRef.current + 1;
    selectionSyncRunRef.current = syncRun;
    selectionSyncTimerRef.current = setTimeout(() => {
      const selectedKeysToSync = optimisticSelectedKeys;
      const signatureToSync = optimisticSelectionSignature;
      lastSyncedSelectionRef.current = signatureToSync;
      pendingSelectionSignatureRef.current = signatureToSync;
      selectionSyncTimerRef.current = null;

      startSavingSelection(async () => {
        try {
          await persistLiveSelection(selectedKeysToSync, strategyScopeKeys);
          if (selectionSyncRunRef.current === syncRun && latestSelectionSignatureRef.current === signatureToSync) {
            setSavingSelectionKeys([]);
            router.refresh();
          }
        } catch (error) {
          console.error("Failed to sync live strategy selection", error);
          if (selectionSyncRunRef.current === syncRun) {
            lastSyncedSelectionRef.current = "";
            pendingSelectionSignatureRef.current = "";
            setSavingSelectionKeys([]);
          }
        }
      });
    }, SELECTION_SYNC_DELAY_MS);

    return () => {
      if (selectionSyncTimerRef.current) {
        clearTimeout(selectionSyncTimerRef.current);
        selectionSyncTimerRef.current = null;
      }
    };
  }, [optimisticSelectedKeys, optimisticSelectionSignature, persistLiveSelection, persistedLiveSelectionSignature, router, strategyScopeKeys, strategyScopeSignature]);

  useEffect(() => {
    if (!isLoaded) return;
    if (currentEditSignature === persistedEditsSignature) {
      lastSyncedEditsRef.current = currentEditSignature;
      latestEditSignatureRef.current = currentEditSignature;
      if (editSyncTimerRef.current) {
        clearTimeout(editSyncTimerRef.current);
        editSyncTimerRef.current = null;
      }
      return;
    }
    if (lastSyncedEditsRef.current === currentEditSignature) return;
    latestEditSignatureRef.current = currentEditSignature;
    if (editSyncTimerRef.current) clearTimeout(editSyncTimerRef.current);

    const syncRun = editSyncRunRef.current + 1;
    editSyncRunRef.current = syncRun;
    editSyncTimerRef.current = setTimeout(() => {
      const editsToSync = edits;
      const signatureToSync = currentEditSignature;
      lastSyncedEditsRef.current = signatureToSync;
      editSyncTimerRef.current = null;

      startSavingEdits(async () => {
        try {
          await persistStrategyEdits(editsToSync, strategyScopeKeys);
          if (editSyncRunRef.current === syncRun && latestEditSignatureRef.current === signatureToSync) {
            router.refresh();
          }
        } catch (error) {
          console.error("Failed to sync strategy edits", error);
          if (editSyncRunRef.current === syncRun) lastSyncedEditsRef.current = "";
        }
      });
    }, EDIT_RENDER_DELAY_MS);

    return () => {
      if (editSyncTimerRef.current) {
        clearTimeout(editSyncTimerRef.current);
        editSyncTimerRef.current = null;
      }
    };
  }, [currentEditSignature, edits, isLoaded, persistStrategyEdits, persistedEditsSignature, router, strategyScopeKeys]);

  useEffect(() => {
    if (!activeKey && !isCustomScaleOpen && !isCustomSelectionOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (isCustomScaleOpen) {
        setIsCustomScaleOpen(false);
        setCustomScaleError("");
        setCustomScaleResult(null);
        return;
      }
      if (isCustomSelectionOpen) {
        setIsCustomSelectionOpen(false);
        setCustomSelectionError("");
        setCustomSelectionResult(null);
        return;
      }
      setActiveKey(null);
      setDraft(null);
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeKey, isCustomScaleOpen, isCustomSelectionOpen]);

  function navigate(nextKeys: string[]) {
    if (selectionControlsDisabled) return;
    const currentKeySet = new Set(optimisticSelectedKeys);
    const nextKeySet = new Set(nextKeys);
    const touchedKeys = strategyScopeKeys.filter((key) => currentKeySet.has(key) !== nextKeySet.has(key));

    if (touchedKeys.length) {
      setSavingSelectionKeys((current) => [...new Set([...current, ...touchedKeys])]);
    }

    pendingSelectionSignatureRef.current = nextKeys.join("|");
    latestSelectionSignatureRef.current = nextKeys.join("|");
    setOptimisticSelectedKeys(nextKeys);
  }

  function toggleStrategy(key: string) {
    if (selectionControlsDisabled) return;
    const nextKeys = selected.has(key) ? optimisticSelectedKeys.filter((item) => item !== key) : [...optimisticSelectedKeys, key];
    navigate(nextKeys);
  }

  function currentEdit(strategy: StrategyOption): StrategyEdit {
    return edits[strategy.key] ? normalizeEdit(strategy, edits[strategy.key]) : defaultEdit(strategy);
  }

  const visibleStrategies = strategies.filter((strategy) => strategyMatchesSearch(strategy, currentEdit(strategy), normalizedSearchQuery));
  const sortedStrategies = [...visibleStrategies].sort((left, right) => {
    if (!sortColumn) {
      return (orderByKey.get(left.key) ?? 0) - (orderByKey.get(right.key) ?? 0);
    }

    const leftEdit = currentEdit(left);
    const rightEdit = currentEdit(right);
    let comparison = 0;

    if (sortColumn === "ticker") comparison = compareText(left.symbol, right.symbol);
    if (sortColumn === "model") comparison = compareText(leftEdit.modelName, rightEdit.modelName);
    if (sortColumn === "profitFactor") comparison = left.profitFactor - right.profitFactor;
    if (sortColumn === "winRate") comparison = left.winRatePct - right.winRatePct;
    if (sortColumn === "trades") comparison = left.trades - right.trades;
    if (sortColumn === "target") comparison = leftEdit.targetDollars - rightEdit.targetDollars;
    if (sortColumn === "risk") comparison = leftEdit.riskDollars - rightEdit.riskDollars;
    if (sortColumn === "rrr") comparison = (riskRewardRatio(leftEdit.targetDollars, leftEdit.riskDollars) ?? 0) - (riskRewardRatio(rightEdit.targetDollars, rightEdit.riskDollars) ?? 0);
    if (sortColumn === "size") comparison = leftEdit.contracts - rightEdit.contracts;
    if (sortColumn === "scale") comparison = scaleForContracts(left, leftEdit.contracts) - scaleForContracts(right, rightEdit.contracts);
    if (sortColumn === "enabled") comparison = Number(selected.has(left.key)) - Number(selected.has(right.key));

    if (comparison === 0) {
      comparison = (orderByKey.get(left.key) ?? 0) - (orderByKey.get(right.key) ?? 0);
    }

    return sortDirection === "asc" ? comparison : -comparison;
  });

  function toggleSort(column: SortColumn) {
    if (isRestricted) return;
    if (sortColumn === column) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortColumn(column);
    setSortDirection(defaultSortDirection(column));
  }

  function sortIndicator(column: SortColumn): string {
    if (sortColumn !== column) return "";
    return sortDirection === "asc" ? "^" : "v";
  }

  function sortButtonClass(column: SortColumn): string {
    return sortColumn === column ? "basketSortButton isActive" : "basketSortButton";
  }

  function openEditor(strategy: StrategyOption) {
    if (isRestricted) return;
    setActiveKey(strategy.key);
    setDraft(currentEdit(strategy));
  }

  function closeEditor() {
    setActiveKey(null);
    setDraft(null);
  }

  function saveEditor() {
    if (editControlsDisabled) return;
    if (!activeStrategy || !draft) return;
    const normalized = normalizeEdit(activeStrategy, draft);
    setEdits((current) => {
      const next = { ...current };
      if (isDefaultEdit(activeStrategy, normalized)) {
        delete next[activeStrategy.key];
      } else {
        next[activeStrategy.key] = normalized;
      }
      return next;
    });
    closeEditor();
  }

  function resetActiveStrategy() {
    if (editControlsDisabled) return;
    if (!activeStrategy) return;
    setEdits((current) => {
      const next = { ...current };
      delete next[activeStrategy.key];
      return next;
    });
    setDraft(defaultEdit(activeStrategy));
  }

  function resetAllEdits() {
    if (editControlsDisabled) return;
    setEdits({});
    if (activeStrategy) setDraft(defaultEdit(activeStrategy));
  }

  function scaleAllContracts(multiplier: number) {
    if (editControlsDisabled) return;
    setEdits((current) => {
      const next: StrategyEditMap = { ...current };
      for (const strategy of strategies) {
        const currentStrategyEdit = current[strategy.key] ? normalizeEdit(strategy, current[strategy.key]) : defaultEdit(strategy);
        const scaled = scaledEdit(strategy, currentStrategyEdit, multiplier);
        if (isDefaultEdit(strategy, scaled)) {
          delete next[strategy.key];
        } else {
          next[strategy.key] = scaled;
        }
      }
      return next;
    });
    if (activeStrategy) setDraft((current) => (current ? scaledEdit(activeStrategy, current, multiplier) : current));
  }

  function openCustomScale() {
    if (editControlsDisabled) return;
    setCustomScaleError("");
    setCustomScaleResult(null);
    setIsCustomScaleOpen(true);
  }

  function closeCustomScale() {
    setIsCustomScaleOpen(false);
    setCustomScaleError("");
    setCustomScaleResult(null);
  }

  function openCustomSelection() {
    if (selectionControlsDisabled) return;
    setCustomSelectionError("");
    setCustomSelectionResult(null);
    setIsCustomSelectionOpen(true);
  }

  function closeCustomSelection() {
    setIsCustomSelectionOpen(false);
    setCustomSelectionError("");
    setCustomSelectionResult(null);
  }

  function updateCustomScaleRange(field: keyof CustomScaleRangeInput, value: string) {
    setCustomScaleRange((current) => ({ ...current, [field]: value }));
    setCustomScaleError("");
    setCustomScaleResult(null);
  }

  function applyCustomScaleRange(range: CustomScaleDollarRange) {
    const next: StrategyEditMap = { ...edits };
    const outcomes = new Map<string, CustomScaleOutcome>();
    let applied = 0;
    let closest = 0;
    let unchanged = 0;

    for (const strategy of strategies) {
      const currentStrategyEdit = edits[strategy.key] ? normalizeEdit(strategy, edits[strategy.key]) : defaultEdit(strategy);
      const outcome = customScaledEdit(strategy, currentStrategyEdit, range);
      outcomes.set(strategy.key, outcome);

      if (!outcome.fit) {
        closest += 1;
      } else if (outcome.changed) {
        applied += 1;
      } else {
        unchanged += 1;
      }

      if (isDefaultEdit(strategy, outcome.edit)) {
        delete next[strategy.key];
      } else {
        next[strategy.key] = outcome.edit;
      }
    }

    setEdits(next);
    if (activeStrategy) {
      const outcome = outcomes.get(activeStrategy.key);
      if (outcome) setDraft(outcome.edit);
    }
    setCustomScaleResult({ applied, closest, total: strategies.length, unchanged });
  }

  function submitCustomScaleRange() {
    const parsed = parseCustomScaleRange(customScaleRange);
    if (!parsed.range) {
      setCustomScaleError(parsed.error ?? "Custom Unit range could not be applied.");
      setCustomScaleResult(null);
      return;
    }
    applyCustomScaleRange(parsed.range);
  }

  function updateCustomSelection(field: keyof CustomSelectionInput, value: string) {
    setCustomSelection((current) => ({ ...current, [field]: value }));
    setCustomSelectionError("");
    setCustomSelectionResult(null);
  }

  function submitCustomSelection() {
    const parsed = parseCustomSelection(customSelection);
    if (!parsed.criteria) {
      setCustomSelectionError(parsed.error ?? "Custom Selection could not be applied.");
      setCustomSelectionResult(null);
      return;
    }

    const criteria = parsed.criteria;
    const nextKeys = strategies
      .filter(
        (strategy) =>
          strategy.trades > 0 &&
          strategy.profitFactor >= criteria.minProfitFactor &&
          strategy.winRatePct >= criteria.minWinRate
      )
      .map((strategy) => strategy.key);

    navigate(nextKeys);
    setCustomSelectionResult({ selected: nextKeys.length, total: strategies.length });
  }

  function updateContracts(value: number) {
    if (!activeStrategy) return;
    setDraft((current) => {
      if (!current) return current;
      const contracts = Number.isFinite(value) && value > 0 ? roundControlValue(value) : current.contracts;
      return {
        ...current,
        contracts,
        scale: roundControlValue(scaleForContracts(activeStrategy, contracts)),
        targetDollars: dollarsFromUnits(activeStrategy, current.tpUnits, contracts),
        riskDollars: dollarsFromUnits(activeStrategy, current.slUnits, contracts)
      };
    });
  }

  function updateScale(value: number) {
    if (!activeStrategy || !Number.isFinite(value) || value <= 0) return;
    updateContracts(contractsForScale(activeStrategy, value));
  }

  function scaleContracts(multiplier: number) {
    if (!activeStrategy) return;
    setDraft((current) => (current ? scaledEdit(activeStrategy, current, multiplier) : current));
  }

  function updateUnits(field: "tpUnits" | "slUnits", value: number) {
    if (!activeStrategy) return;
    setDraft((current) => {
      if (!current) return current;
      const units = Number.isFinite(value) && value >= 0 ? roundControlValue(value) : 0;
      if (field === "tpUnits") {
        return { ...current, tpUnits: units, targetDollars: dollarsFromUnits(activeStrategy, units, current.contracts) };
      }
      return { ...current, slUnits: units, riskDollars: dollarsFromUnits(activeStrategy, units, current.contracts) };
    });
  }

  function updateDollars(field: "targetDollars" | "riskDollars", value: number) {
    if (!activeStrategy) return;
    setDraft((current) => {
      if (!current) return current;
      const dollars = Number.isFinite(value) && value >= 0 ? roundControlValue(value) : 0;
      if (field === "targetDollars") {
        return { ...current, targetDollars: dollars, tpUnits: unitsFromDollars(activeStrategy, dollars, current.contracts) };
      }
      return { ...current, riskDollars: dollars, slUnits: unitsFromDollars(activeStrategy, dollars, current.contracts) };
    });
  }

  return (
    <div className={`strategyPicker${isRestricted ? " adminOnlyRestrictedSurface" : ""}`} aria-disabled={isRestricted}>
      <div className="pickerHeader">
        <span>Strategies</span>
        <div className="pickerActions">
          <button type="button" onClick={openCustomSelection} disabled={selectionControlsDisabled || strategies.length === 0}>
            Custom Selection
          </button>
          <button type="button" onClick={() => navigate([])} disabled={selectionControlsDisabled || optimisticSelectedKeys.length === 0}>
            Clear
          </button>
          <button type="button" onClick={resetAllEdits} disabled={editControlsDisabled || !hasEdits}>
            Reset edits
          </button>
        </div>
      </div>

      <div className="strategyToolbar">
        <label className="strategySearch">
          <span>Search</span>
          <input
            type="search"
            disabled={isRestricted}
            placeholder={isRestricted ? "Admin access required" : "Strategy, asset, or phase"}
            value={isRestricted ? "" : searchQuery}
            onChange={(event) => {
              if (!isRestricted) setSearchQuery(event.target.value);
            }}
          />
        </label>
        <div className="bulkScale">
          <span>All scale</span>
          <div className="scaleButtons" aria-label="Scale all strategy rows">
            <button type="button" onClick={() => scaleAllContracts(0.5)} disabled={editControlsDisabled || strategies.length === 0}>
              0.5x
            </button>
            <button type="button" onClick={() => scaleAllContracts(2)} disabled={editControlsDisabled || strategies.length === 0}>
              2x
            </button>
            <button type="button" onClick={() => scaleAllContracts(4)} disabled={editControlsDisabled || strategies.length === 0}>
              4x
            </button>
            <button type="button" onClick={openCustomScale} disabled={editControlsDisabled || strategies.length === 0}>
              Custom Unit
            </button>
          </div>
        </div>
        <span className="strategySearchCount">
          {formatNumber(visibleStrategies.length)} / {formatNumber(strategies.length)}
        </span>
      </div>

      <div className="basketList" role="list" aria-label="Strategy enable list">
        <div className="basketListHeader">
          <button className={sortButtonClass("ticker")} type="button" onClick={() => toggleSort("ticker")} disabled={isRestricted}>
            <span>Assets</span>
            <strong>{sortIndicator("ticker")}</strong>
          </button>
          <button className={sortButtonClass("model")} type="button" onClick={() => toggleSort("model")} disabled={isRestricted}>
            <span>Strategy</span>
            <strong>{sortIndicator("model")}</strong>
          </button>
          <button className={sortButtonClass("profitFactor")} type="button" onClick={() => toggleSort("profitFactor")} disabled={isRestricted}>
            <span>PF</span>
            <strong>{sortIndicator("profitFactor")}</strong>
          </button>
          <button className={sortButtonClass("winRate")} type="button" onClick={() => toggleSort("winRate")} disabled={isRestricted}>
            <span>Win</span>
            <strong>{sortIndicator("winRate")}</strong>
          </button>
          <button className={sortButtonClass("trades")} type="button" onClick={() => toggleSort("trades")} disabled={isRestricted}>
            <span>Trades</span>
            <strong>{sortIndicator("trades")}</strong>
          </button>
          <button className={sortButtonClass("target")} type="button" onClick={() => toggleSort("target")} disabled={isRestricted}>
            <span>Take Profit</span>
            <strong>{sortIndicator("target")}</strong>
          </button>
          <button className={sortButtonClass("risk")} type="button" onClick={() => toggleSort("risk")} disabled={isRestricted}>
            <span>Stop Loss</span>
            <strong>{sortIndicator("risk")}</strong>
          </button>
          <button className={sortButtonClass("rrr")} type="button" onClick={() => toggleSort("rrr")} disabled={isRestricted}>
            <span>RRR</span>
            <strong>{sortIndicator("rrr")}</strong>
          </button>
          <button className={sortButtonClass("size")} type="button" onClick={() => toggleSort("size")} disabled={isRestricted}>
            <span>Unit/contract size</span>
            <strong>{sortIndicator("size")}</strong>
          </button>
          <button className={sortButtonClass("scale")} type="button" onClick={() => toggleSort("scale")} disabled={isRestricted}>
            <span>Scale</span>
            <strong>{sortIndicator("scale")}</strong>
          </button>
          <button className={sortButtonClass("enabled")} type="button" onClick={() => toggleSort("enabled")} disabled={isRestricted}>
            <span>Enabled</span>
            <strong>{sortIndicator("enabled")}</strong>
          </button>
        </div>

        {sortedStrategies.map((strategy) => {
          const checked = selected.has(strategy.key);
          const custom = Boolean(edits[strategy.key]);
          const isSavingSelection = savingSelectionKeySet.has(strategy.key);
          const effective = currentEdit(strategy);
          const effectiveRiskRewardRatio = riskRewardRatio(effective.targetDollars, effective.riskDollars);
          const hasBacktestTrades = strategy.trades > 0;
          const displayedModelName = isRestricted ? "Admin only" : effective.modelName;
          return (
            <div
              className={`basketListRow ${checked ? "isEnabled" : "isDisabled"} ${custom ? "hasCustom" : ""} ${isSavingSelection ? "isSavingSelection" : ""}${isRestricted ? " isAccessRestricted" : ""}`}
              role={isRestricted ? "listitem" : "button"}
              tabIndex={isRestricted ? -1 : 0}
              aria-disabled={isRestricted}
              key={strategy.key}
              onClick={isRestricted ? undefined : () => openEditor(strategy)}
              onKeyDown={(event) => {
                if (isRestricted) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openEditor(strategy);
                }
              }}
            >
              <span className="basketTicker" data-label="Assets">
                {strategy.symbol}
              </span>
              <div className="basketModel" data-label="Strategy">
                <strong className={isRestricted ? "adminOnlyMaskedText" : undefined}>{displayedModelName}</strong>
                <span>
                  {isRestricted
                    ? "Strategy details locked"
                    : `${formatMarket(strategy.market)} / ${strategy.timeframeLabel} / ${strategy.liveSupported ? "live-ready" : "backtest only"}${custom ? " / custom unit" : ""}`}
                </span>
              </div>
              <span className={hasBacktestTrades ? (strategy.profitFactor >= 1 ? "up" : "down") : "neutral"} data-label="PF">
                {hasBacktestTrades ? formatNumber(strategy.profitFactor) : "--"}
              </span>
              <span data-label="Win">{hasBacktestTrades ? formatPct(strategy.winRatePct) : "--"}</span>
              <span data-label="Trades">{formatNumber(strategy.trades)}</span>
              <span data-label="Take Profit">{displayTargetLabel(strategy, effective.targetDollars)}</span>
              <span data-label="Stop Loss">{displayRiskLabel(strategy, effective.riskDollars)}</span>
              <span data-label="RRR">{displayRiskRewardLabel(strategy, effectiveRiskRewardRatio, hasBacktestTrades)}</span>
              <span data-label="Unit/contract size">{displaySizeLabel(strategy, effective.contracts, effective.sizeName)}</span>
              <span data-label="Scale">{formatScaleRatio(scaleForContracts(strategy, effective.contracts))}</span>
              <label
                className={`strategyToggle${selectionControlsDisabled ? " isLocked" : ""}`}
                data-label="Enabled"
                onClick={selectionControlsDisabled ? undefined : (event) => event.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  aria-busy={isSavingSelection}
                  disabled={selectionControlsDisabled || isSavingSelection}
                  onChange={() => toggleStrategy(strategy.key)}
                />
                <span>{isSavingSelection ? "Saving" : checked ? "On" : "Off"}</span>
              </label>
            </div>
          );
        })}
        {sortedStrategies.length === 0 ? (
          <div className="basketListEmpty">No strategies match that search.</div>
        ) : null}
      </div>

      {!isRestricted && activeStrategy && draft ? createPortal((
        <div className="strategyModalBackdrop" role="presentation" onMouseDown={closeEditor}>
          <form
            className="strategyModal"
            aria-label={`${activeStrategy.symbol} strategy settings`}
            aria-modal="true"
            role="dialog"
            onSubmit={(event) => {
              event.preventDefault();
              saveEditor();
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="strategyModalHead">
              <div>
                <span>{activeStrategy.symbol}</span>
                <strong>{draft.modelName}</strong>
              </div>
              <button type="button" onClick={closeEditor}>
                Close
              </button>
            </div>

            <div className="strategyModalGrid">
              <div className="fieldControl wide">
                <span>Model</span>
                <strong className="lockedField">{draft.modelName}</strong>
              </div>
              <label className="fieldControl">
                <span>Scale</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={roundControlValue(scaleForContracts(activeStrategy, draft.contracts))}
                  onChange={(event) => updateScale(Number(event.target.value))}
                />
              </label>
              <div className="fieldControl">
                <span>Unit name</span>
                <strong className="lockedField">{draft.sizeName}</strong>
              </div>
              <div className="fieldControl wide">
                <span>Quick scale</span>
                <div className="scaleButtons" aria-label="Quick strategy scale multipliers">
                  <button type="button" onClick={() => scaleContracts(0.5)}>
                    0.5x
                  </button>
                  <button type="button" onClick={() => scaleContracts(2)}>
                    2x
                  </button>
                  <button type="button" onClick={() => scaleContracts(4)}>
                    4x
                  </button>
                </div>
              </div>
              <label className="fieldControl">
                <span>Take Profit {activeStrategy.unitLabel}</span>
                <input type="number" min="0" step="0.01" value={draft.tpUnits} onChange={(event) => updateUnits("tpUnits", Number(event.target.value))} />
              </label>
              <label className="fieldControl">
                <span>Take Profit $</span>
                <input type="number" min="0" step="0.01" value={draft.targetDollars} onChange={(event) => updateDollars("targetDollars", Number(event.target.value))} />
              </label>
              <label className="fieldControl">
                <span>Stop Loss {activeStrategy.unitLabel}</span>
                <input type="number" min="0" step="0.01" value={draft.slUnits} onChange={(event) => updateUnits("slUnits", Number(event.target.value))} />
              </label>
              <label className="fieldControl">
                <span>Stop Loss $</span>
                <input type="number" min="0" step="0.01" value={draft.riskDollars} onChange={(event) => updateDollars("riskDollars", Number(event.target.value))} />
              </label>
            </div>

            <div className="strategyModalSummary">
              <span>Scale: {formatScaleRatio(scaleForContracts(activeStrategy, draft.contracts))} ({formatSizeLabel(draft.contracts, draft.sizeName)})</span>
              <span>
                Take Profit / Stop Loss: {formatMoney(draft.targetDollars)} / {formatMoney(draft.riskDollars)}
              </span>
            </div>

            <div className="strategyModalActions">
              <button type="button" onClick={resetActiveStrategy}>
                Reset
              </button>
              <button type="submit">Save</button>
            </div>
          </form>
        </div>
      ), document.body) : null}

      {!isRestricted && isCustomScaleOpen ? createPortal((
        <div className="strategyModalBackdrop" role="presentation" onMouseDown={closeCustomScale}>
          <form
            className="strategyModal customScaleModal"
            aria-label="Custom Unit range scale"
            aria-modal="true"
            role="dialog"
            onSubmit={(event) => {
              event.preventDefault();
              submitCustomScaleRange();
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="strategyModalHead">
              <div>
                <span>All scale</span>
                <strong>Custom Unit range</strong>
              </div>
              <button type="button" onClick={closeCustomScale}>
                Close
              </button>
            </div>

            <div className="strategyModalGrid">
              <label className="fieldControl">
                <span>Take Profit floor $</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={customScaleRange.targetFloor}
                  onChange={(event) => updateCustomScaleRange("targetFloor", event.target.value)}
                  autoFocus
                />
              </label>
              <label className="fieldControl">
                <span>Take Profit ceiling $</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={customScaleRange.targetCeiling}
                  onChange={(event) => updateCustomScaleRange("targetCeiling", event.target.value)}
                />
              </label>
              <label className="fieldControl">
                <span>Stop Loss floor $</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={customScaleRange.riskFloor}
                  onChange={(event) => updateCustomScaleRange("riskFloor", event.target.value)}
                />
              </label>
              <label className="fieldControl">
                <span>Stop Loss ceiling $</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={customScaleRange.riskCeiling}
                  onChange={(event) => updateCustomScaleRange("riskCeiling", event.target.value)}
                />
              </label>
            </div>

            {customScaleError ? <div className="customScaleNotice isError">{customScaleError}</div> : null}
            {customScaleResult ? (
              <div className={`customScaleNotice${customScaleResult.closest ? " isWarning" : ""}`}>
                <span>{formatNumber(customScaleResult.applied)} adjusted</span>
                <span>{formatNumber(customScaleResult.unchanged)} already inside</span>
                <span>{formatNumber(customScaleResult.closest)} closest fit</span>
                <span>{formatNumber(customScaleResult.total)} total</span>
              </div>
            ) : null}

            <div className="strategyModalActions">
              <button
                type="button"
                onClick={() => {
                  setCustomScaleRange(EMPTY_CUSTOM_SCALE_RANGE);
                  setCustomScaleError("");
                  setCustomScaleResult(null);
                }}
              >
                Clear
              </button>
              <button type="submit">Apply</button>
            </div>
          </form>
        </div>
      ), document.body) : null}

      {!isRestricted && isCustomSelectionOpen ? createPortal((
        <div className="strategyModalBackdrop" role="presentation" onMouseDown={closeCustomSelection}>
          <form
            className="strategyModal customScaleModal"
            aria-label="Custom Selection"
            aria-modal="true"
            role="dialog"
            onSubmit={(event) => {
              event.preventDefault();
              submitCustomSelection();
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="strategyModalHead">
              <div>
                <span>Strategy selection</span>
                <strong>Custom Selection</strong>
              </div>
              <button type="button" onClick={closeCustomSelection}>
                Close
              </button>
            </div>

            <div className="strategyModalGrid">
              <label className="fieldControl">
                <span>Minimum PF</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={customSelection.minProfitFactor}
                  onChange={(event) => updateCustomSelection("minProfitFactor", event.target.value)}
                  autoFocus
                />
              </label>
              <label className="fieldControl">
                <span>Minimum win rate %</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={customSelection.minWinRate}
                  onChange={(event) => updateCustomSelection("minWinRate", event.target.value)}
                />
              </label>
            </div>

            {customSelectionError ? <div className="customScaleNotice isError">{customSelectionError}</div> : null}
            {customSelectionResult ? (
              <div className={`customScaleNotice${customSelectionResult.selected ? "" : " isWarning"}`}>
                <span>{formatNumber(customSelectionResult.selected)} selected</span>
                <span>{formatNumber(customSelectionResult.total)} scanned</span>
              </div>
            ) : null}

            <div className="strategyModalActions">
              <button
                type="button"
                onClick={() => {
                  setCustomSelection(EMPTY_CUSTOM_SELECTION);
                  setCustomSelectionError("");
                  setCustomSelectionResult(null);
                }}
              >
                Clear
              </button>
              <button type="submit">Select</button>
            </div>
          </form>
        </div>
      ), document.body) : null}
    </div>
  );
}
