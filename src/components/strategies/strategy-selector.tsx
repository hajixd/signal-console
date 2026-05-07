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

type StrategySelectorProps = {
  strategies: StrategyOption[];
  selectedKeys: string[];
  defaultKeys: string[];
  persistedLiveKeys: string[];
  persistedStrategyEdits: StrategyEditSeedMap;
  persistLiveSelection: (selectedKeys: string[], scopeKeys?: string[]) => Promise<void>;
  persistStrategyEdits: (edits: StrategyEditSeedMap) => Promise<void>;
};

type SortColumn = "ticker" | "model" | "profitFactor" | "winRate" | "trades" | "target" | "risk" | "rrr" | "size" | "scale" | "enabled";
type SortDirection = "asc" | "desc";
type CustomScaleRangeInput = {
  riskCeiling: string;
  riskFloor: string;
  targetCeiling: string;
  targetFloor: string;
};
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

const STORAGE_KEY = STRATEGY_EDITS_STORAGE_KEY;
const STRATEGY_SIZES_PARAM = "strategySizes";
const EDIT_RENDER_DELAY_MS = 2500;
const SELECTION_SYNC_DELAY_MS = 650;
const EMPTY_CUSTOM_SCALE_RANGE: CustomScaleRangeInput = {
  riskCeiling: "",
  riskFloor: "",
  targetCeiling: "",
  targetFloor: ""
};

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
  if (value === "multi") return "Multi-market";
  return value.charAt(0).toUpperCase() + value.slice(1);
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
  return strategy.tpMode === "custom" ? "Custom" : formatMoney(value);
}

function displayRiskLabel(strategy: StrategyOption, value: number): string {
  return strategy.slMode === "custom" ? "Custom" : formatMoney(value);
}

function displaySizeLabel(strategy: StrategyOption, contracts: number, sizeName: string): string {
  return strategy.sizeMode === "custom" ? "Custom" : formatSizeLabel(contracts, sizeName);
}

function riskRewardRatio(targetDollars: number, riskDollars: number): number | undefined {
  return riskDollars > 0 ? targetDollars / riskDollars : undefined;
}

function displayRiskRewardLabel(strategy: StrategyOption, value: number | undefined, hasBacktestTrades: boolean): string {
  if (!hasBacktestTrades) return "--";
  if (strategy.rrrMode === "custom") return "Custom";
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
  const contracts = Number.isFinite(edit.contracts) && edit.contracts > 0 ? roundControlValue(edit.contracts) : fallback.contracts;
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
  strategies,
  selectedKeys,
  defaultKeys,
  persistedLiveKeys,
  persistedStrategyEdits,
  persistLiveSelection,
  persistStrategyEdits
}: StrategySelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startSavingSelection] = useTransition();
  const [isSavingEdits, startSavingEdits] = useTransition();
  const [isLoaded, setIsLoaded] = useState(false);
  const [edits, setEdits] = useState<StrategyEditMap>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<StrategyEdit | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [optimisticSelectedKeys, setOptimisticSelectedKeys] = useState(selectedKeys);
  const [isCustomScaleOpen, setIsCustomScaleOpen] = useState(false);
  const [customScaleRange, setCustomScaleRange] = useState<CustomScaleRangeInput>(EMPTY_CUSTOM_SCALE_RANGE);
  const [customScaleError, setCustomScaleError] = useState("");
  const [customScaleResult, setCustomScaleResult] = useState<CustomScaleResult | null>(null);
  const selected = new Set(optimisticSelectedKeys);
  const activeStrategy = strategies.find((strategy) => strategy.key === activeKey);
  const hasEdits = Object.keys(edits).length > 0;
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const orderByKey = new Map(strategies.map((strategy, index) => [strategy.key, index]));
  const strategyScopeKeys = useMemo(() => strategies.map((strategy) => strategy.key), [strategies]);
  const strategyScopeSignature = strategyScopeKeys.join("|");
  const selectionSignature = selectedKeys.join("|");
  const optimisticSelectionSignature = optimisticSelectedKeys.join("|");
  const persistedLiveSelectionSignature = persistedLiveKeys.join("|");
  const normalizedPersistedEdits = normalizeEditMap(strategies, persistedStrategyEdits);
  const persistedEditsSignature = serializeEdits(normalizedPersistedEdits);
  const currentEditSignature = serializeEdits(edits);
  const lastSyncedSelectionRef = useRef<string>("");
  const lastSyncedEditsRef = useRef<string>("");
  const selectionSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestEditSignatureRef = useRef<string>(currentEditSignature);
  const editSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editSyncRunRef = useRef(0);
  const editControlsDisabled = isSavingEdits;

  useEffect(() => {
    setOptimisticSelectedKeys(selectedKeys);
  }, [selectionSignature, selectedKeys]);

  useEffect(() => {
    return () => {
      if (selectionSyncTimerRef.current) clearTimeout(selectionSyncTimerRef.current);
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
    if (optimisticSelectionSignature === persistedLiveSelectionSignature) {
      lastSyncedSelectionRef.current = optimisticSelectionSignature;
      if (selectionSyncTimerRef.current) {
        clearTimeout(selectionSyncTimerRef.current);
        selectionSyncTimerRef.current = null;
      }
      return;
    }
    if (lastSyncedSelectionRef.current === optimisticSelectionSignature) return;

    if (selectionSyncTimerRef.current) clearTimeout(selectionSyncTimerRef.current);
    selectionSyncTimerRef.current = setTimeout(() => {
      const selectedKeysToSync = optimisticSelectedKeys;
      const signatureToSync = optimisticSelectionSignature;
      lastSyncedSelectionRef.current = signatureToSync;
      selectionSyncTimerRef.current = null;

      startSavingSelection(async () => {
        try {
          await persistLiveSelection(selectedKeysToSync, strategyScopeKeys);
          router.refresh();
        } catch (error) {
          console.error("Failed to sync live strategy selection", error);
          lastSyncedSelectionRef.current = "";
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
          await persistStrategyEdits(editsToSync);
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
  }, [currentEditSignature, edits, isLoaded, persistStrategyEdits, persistedEditsSignature, router]);

  useEffect(() => {
    if (!activeKey && !isCustomScaleOpen) return undefined;

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
      setActiveKey(null);
      setDraft(null);
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeKey, isCustomScaleOpen]);

  function navigate(nextKeys: string[], nextDefaultKeys = defaultKeys) {
    setOptimisticSelectedKeys(nextKeys);
  }

  function toggleStrategy(key: string) {
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
    setActiveKey(strategy.key);
    setDraft(currentEdit(strategy));
  }

  function closeEditor() {
    setActiveKey(null);
    setDraft(null);
  }

  function saveEditor() {
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
    if (!activeStrategy) return;
    setEdits((current) => {
      const next = { ...current };
      delete next[activeStrategy.key];
      return next;
    });
    setDraft(defaultEdit(activeStrategy));
  }

  function resetAllEdits() {
    setEdits({});
    if (activeStrategy) setDraft(defaultEdit(activeStrategy));
  }

  function scaleAllContracts(multiplier: number) {
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
    setCustomScaleError("");
    setCustomScaleResult(null);
    setIsCustomScaleOpen(true);
  }

  function closeCustomScale() {
    setIsCustomScaleOpen(false);
    setCustomScaleError("");
    setCustomScaleResult(null);
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
      setCustomScaleError(parsed.error ?? "Custom range could not be applied.");
      setCustomScaleResult(null);
      return;
    }
    applyCustomScaleRange(parsed.range);
  }

  function updateContracts(value: number) {
    if (!activeStrategy) return;
    setDraft((current) => {
      if (!current) return current;
      const contracts = Number.isFinite(value) && value > 0 ? roundControlValue(value) : current.contracts;
      return {
        ...current,
        contracts,
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
    <div className="strategyPicker">
      <div className="pickerHeader">
        <span>Strategies</span>
        <div className="pickerActions">
          <button type="button" onClick={() => navigate([])} disabled={optimisticSelectedKeys.length === 0}>
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
            placeholder="Strategy, asset, or phase"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        <div className="bulkScale">
          <span>All scale</span>
          <div className="scaleButtons" aria-label="Scale all strategy rows">
            <button type="button" onClick={() => scaleAllContracts(0.5)}>
              0.5x
            </button>
            <button type="button" onClick={() => scaleAllContracts(2)}>
              2x
            </button>
            <button type="button" onClick={() => scaleAllContracts(4)}>
              4x
            </button>
            <button type="button" onClick={openCustomScale} disabled={editControlsDisabled || strategies.length === 0}>
              Custom
            </button>
          </div>
        </div>
        <span className="strategySearchCount">
          {formatNumber(visibleStrategies.length)} / {formatNumber(strategies.length)}
        </span>
      </div>

      <div className="basketList" role="list" aria-label="Strategy enable list">
        <div className="basketListHeader">
          <button className={sortButtonClass("ticker")} type="button" onClick={() => toggleSort("ticker")}>
            <span>Assets</span>
            <strong>{sortIndicator("ticker")}</strong>
          </button>
          <button className={sortButtonClass("model")} type="button" onClick={() => toggleSort("model")}>
            <span>Strategy</span>
            <strong>{sortIndicator("model")}</strong>
          </button>
          <button className={sortButtonClass("profitFactor")} type="button" onClick={() => toggleSort("profitFactor")}>
            <span>PF</span>
            <strong>{sortIndicator("profitFactor")}</strong>
          </button>
          <button className={sortButtonClass("winRate")} type="button" onClick={() => toggleSort("winRate")}>
            <span>Win</span>
            <strong>{sortIndicator("winRate")}</strong>
          </button>
          <button className={sortButtonClass("trades")} type="button" onClick={() => toggleSort("trades")}>
            <span>Trades</span>
            <strong>{sortIndicator("trades")}</strong>
          </button>
          <button className={sortButtonClass("target")} type="button" onClick={() => toggleSort("target")}>
            <span>Take Profit</span>
            <strong>{sortIndicator("target")}</strong>
          </button>
          <button className={sortButtonClass("risk")} type="button" onClick={() => toggleSort("risk")}>
            <span>Stop Loss</span>
            <strong>{sortIndicator("risk")}</strong>
          </button>
          <button className={sortButtonClass("rrr")} type="button" onClick={() => toggleSort("rrr")}>
            <span>RRR</span>
            <strong>{sortIndicator("rrr")}</strong>
          </button>
          <button className={sortButtonClass("size")} type="button" onClick={() => toggleSort("size")}>
            <span>Unit/contract size</span>
            <strong>{sortIndicator("size")}</strong>
          </button>
          <button className={sortButtonClass("scale")} type="button" onClick={() => toggleSort("scale")}>
            <span>Scale</span>
            <strong>{sortIndicator("scale")}</strong>
          </button>
          <button className={sortButtonClass("enabled")} type="button" onClick={() => toggleSort("enabled")}>
            <span>Enabled</span>
            <strong>{sortIndicator("enabled")}</strong>
          </button>
        </div>

        {sortedStrategies.map((strategy) => {
          const checked = selected.has(strategy.key);
          const custom = Boolean(edits[strategy.key]);
          const effective = currentEdit(strategy);
          const effectiveRiskRewardRatio = riskRewardRatio(effective.targetDollars, effective.riskDollars);
          const hasBacktestTrades = strategy.trades > 0;
          return (
            <div
              className={`basketListRow ${checked ? "isEnabled" : "isDisabled"} ${custom ? "hasCustom" : ""}`}
              role="button"
              tabIndex={0}
              key={strategy.key}
              onClick={() => openEditor(strategy)}
              onKeyDown={(event) => {
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
                <strong>{effective.modelName}</strong>
                <span>
                  {formatMarket(strategy.market)} / {strategy.timeframeLabel} / {strategy.liveSupported ? "live-ready" : "backtest only"}
                  {custom ? " / custom" : ""}
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
              <label className="strategyToggle" data-label="Enabled" onClick={(event) => event.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleStrategy(strategy.key)}
                />
                <span>{checked ? "On" : "Off"}</span>
              </label>
            </div>
          );
        })}
        {sortedStrategies.length === 0 ? (
          <div className="basketListEmpty">No strategies match that search.</div>
        ) : null}
      </div>

      {activeStrategy && draft ? createPortal((
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

      {isCustomScaleOpen ? createPortal((
        <div className="strategyModalBackdrop" role="presentation" onMouseDown={closeCustomScale}>
          <form
            className="strategyModal customScaleModal"
            aria-label="Custom range scale"
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
                <strong>Custom range</strong>
              </div>
              <button type="button" onClick={closeCustomScale}>
                Close
              </button>
            </div>

            <div className="strategyModalGrid">
              <label className="fieldControl">
                <span>Take Profit floor $</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={customScaleRange.targetFloor}
                  onChange={(event) => updateCustomScaleRange("targetFloor", event.target.value)}
                  autoFocus
                />
              </label>
              <label className="fieldControl">
                <span>Take Profit ceiling $</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={customScaleRange.targetCeiling}
                  onChange={(event) => updateCustomScaleRange("targetCeiling", event.target.value)}
                />
              </label>
              <label className="fieldControl">
                <span>Stop Loss floor $</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={customScaleRange.riskFloor}
                  onChange={(event) => updateCustomScaleRange("riskFloor", event.target.value)}
                />
              </label>
              <label className="fieldControl">
                <span>Stop Loss ceiling $</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
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
    </div>
  );
}
