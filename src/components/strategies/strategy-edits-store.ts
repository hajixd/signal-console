"use client";

import { useEffect, useMemo, useState } from "react";

export type StrategyEditOption = {
  key: string;
  label: string;
  symbol: string;
  phase: string;
  market?: string;
  timeframeLabel?: string;
  sizeLabel: string;
  tpUnits: number;
  slUnits: number;
  dollarPerUnit: number;
  targetDollars: number;
  riskDollars: number;
  riskRewardRatio?: number;
  profitFactor?: number;
  trades?: number;
  tradesPerWeek?: number;
  winRatePct?: number;
  liveSupported?: boolean;
};

export type StrategyEdit = {
  modelName: string;
  contracts: number;
  sizeName: string;
  scale: number;
  tpUnits: number;
  slUnits: number;
  targetDollars: number;
  riskDollars: number;
};

export type StrategyEditSeed = Partial<StrategyEdit>;
export type StrategyEditMap = Record<string, StrategyEdit>;
export type StrategyEditSeedMap = Record<string, StrategyEditSeed>;

export const STRATEGY_EDITS_STORAGE_KEY = "trading-bot:strategy-edits:v1";
export const STRATEGY_EDITS_CHANGE_EVENT = "trading-bot:strategy-edits-changed";

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "inf";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value);
}

function roundControlValue(value: number): number {
  return Math.round(value * 100) / 100;
}

function splitSizeLabel(value: string): { contracts: number; sizeName: string } {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
  if (!match) return { contracts: 1, sizeName: value.trim() || "contract" };
  return {
    contracts: Number(match[1]),
    sizeName: match[2]
  };
}

export function formatSizeLabel(contracts: number, sizeName: string): string {
  return `${formatNumber(contracts)} ${sizeName.trim() || "contract"}`;
}

export function defaultStrategyEdit(strategy: StrategyEditOption): StrategyEdit {
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

function strategyScaleForContracts(strategy: StrategyEditOption, contracts: number): number {
  const baseContracts = defaultStrategyEdit(strategy).contracts || 1;
  return contracts / baseContracts;
}

function dollarsFromUnits(strategy: StrategyEditOption, units: number, contracts: number): number {
  return roundControlValue(Math.abs(units * strategy.dollarPerUnit * strategyScaleForContracts(strategy, contracts)));
}

function unitsFromDollars(strategy: StrategyEditOption, dollars: number, contracts: number): number {
  const dollarValue = Math.abs(strategy.dollarPerUnit * strategyScaleForContracts(strategy, contracts));
  return dollarValue ? roundControlValue(Math.abs(dollars) / dollarValue) : 0;
}

function editRiskRewardRatio(edit: Pick<StrategyEdit, "targetDollars" | "riskDollars" | "tpUnits" | "slUnits">): number | undefined {
  if (edit.riskDollars > 0) return edit.targetDollars / edit.riskDollars;
  return edit.slUnits > 0 ? edit.tpUnits / edit.slUnits : undefined;
}

export function normalizeStrategyEdit(strategy: StrategyEditOption, edit: StrategyEdit): StrategyEdit {
  const fallback = defaultStrategyEdit(strategy);
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
  if (targetDollars > 0) tpUnits = unitsFromDollars(strategy, targetDollars, contracts) || tpUnits;
  if (riskDollars > 0) slUnits = unitsFromDollars(strategy, riskDollars, contracts) || slUnits;

  const normalized = {
    modelName: fallback.modelName,
    contracts,
    sizeName: fallback.sizeName,
    scale: roundControlValue(strategyScaleForContracts(strategy, contracts)),
    tpUnits,
    slUnits,
    targetDollars,
    riskDollars
  };

  const truthRatio = Number.isFinite(strategy.riskRewardRatio) && strategy.riskRewardRatio ? strategy.riskRewardRatio : undefined;
  const editRatio = editRiskRewardRatio(normalized);
  if (truthRatio && editRatio !== undefined && editRatio + 0.005 < truthRatio && normalized.riskDollars > 0) {
    const truthfulTargetDollars = roundControlValue(normalized.riskDollars * truthRatio);
    const truthfulTpUnits = unitsFromDollars(strategy, truthfulTargetDollars, normalized.contracts) || normalized.tpUnits;
    return {
      ...normalized,
      tpUnits: truthfulTpUnits,
      targetDollars: truthfulTargetDollars
    };
  }

  return normalized;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.005;
}

function isDefaultStrategyEdit(strategy: StrategyEditOption, edit: StrategyEdit): boolean {
  const fallback = defaultStrategyEdit(strategy);
  return (
    edit.modelName === fallback.modelName &&
    edit.sizeName === fallback.sizeName &&
    nearlyEqual(edit.contracts, fallback.contracts) &&
    nearlyEqual(edit.scale, fallback.scale) &&
    nearlyEqual(edit.tpUnits, fallback.tpUnits) &&
    nearlyEqual(edit.slUnits, fallback.slUnits) &&
    nearlyEqual(edit.targetDollars, fallback.targetDollars) &&
    nearlyEqual(edit.riskDollars, fallback.riskDollars)
  );
}

export function effectiveStrategyEdit(strategy: StrategyEditOption, edits: StrategyEditMap): StrategyEdit {
  return edits[strategy.key] ? normalizeStrategyEdit(strategy, edits[strategy.key]!) : defaultStrategyEdit(strategy);
}

export function strategyContractScale(strategy: StrategyEditOption, edits: StrategyEditMap): number {
  const fallback = defaultStrategyEdit(strategy);
  const effective = effectiveStrategyEdit(strategy, edits);
  return fallback.contracts ? effective.contracts / fallback.contracts : 1;
}

export function strategyHasContractEdit(strategy: StrategyEditOption, edits: StrategyEditMap): boolean {
  const fallback = defaultStrategyEdit(strategy);
  const effective = effectiveStrategyEdit(strategy, edits);
  return !nearlyEqual(effective.contracts, fallback.contracts);
}

function normalizeStrategyEdits(strategies: StrategyEditOption[], edits: StrategyEditSeedMap): StrategyEditMap {
  const optionByKey = new Map(strategies.map((strategy) => [strategy.key, strategy]));
  const normalized: StrategyEditMap = {};

  for (const [key, edit] of Object.entries(edits)) {
    const strategy = optionByKey.get(key);
    if (!strategy) continue;
    const normalizedEdit = normalizeStrategyEdit(strategy, {
      ...defaultStrategyEdit(strategy),
      ...edit
    });
    if (!isDefaultStrategyEdit(strategy, normalizedEdit)) {
      normalized[key] = normalizedEdit;
    }
  }

  return normalized;
}

export function readStoredStrategyEdits(strategies: StrategyEditOption[]): StrategyEditMap {
  try {
    const raw = window.localStorage.getItem(STRATEGY_EDITS_STORAGE_KEY);
    return normalizeStrategyEdits(strategies, raw ? (JSON.parse(raw) as StrategyEditSeedMap) : {});
  } catch {
    return {};
  }
}

export function loadClientStrategyEdits(strategies: StrategyEditOption[], initialEdits: StrategyEditSeedMap = {}): StrategyEditMap {
  const normalizedInitial = normalizeStrategyEdits(strategies, initialEdits);
  if (Object.keys(normalizedInitial).length > 0) {
    return normalizedInitial;
  }

  return readStoredStrategyEdits(strategies);
}

export function emitStrategyEditsChanged(edits: StrategyEditMap): void {
  window.dispatchEvent(new CustomEvent<StrategyEditMap>(STRATEGY_EDITS_CHANGE_EVENT, { detail: edits }));
}

export function useStrategyEdits(strategies: StrategyEditOption[], initialEdits: StrategyEditSeedMap = {}): StrategyEditMap {
  const normalizedInitialEdits = useMemo(() => normalizeStrategyEdits(strategies, initialEdits), [initialEdits, strategies]);
  const [edits, setEdits] = useState<StrategyEditMap>(normalizedInitialEdits);

  useEffect(() => {
    setEdits(loadClientStrategyEdits(strategies, initialEdits));

    const onEditsChanged = (event: Event) => {
      const detail =
        event instanceof CustomEvent && event.detail
          ? (event.detail as StrategyEditSeedMap)
          : readStoredStrategyEdits(strategies);
      setEdits(normalizeStrategyEdits(strategies, detail));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === STRATEGY_EDITS_STORAGE_KEY) {
        setEdits(readStoredStrategyEdits(strategies));
      }
    };

    window.addEventListener(STRATEGY_EDITS_CHANGE_EVENT, onEditsChanged);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(STRATEGY_EDITS_CHANGE_EVENT, onEditsChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, [initialEdits, strategies]);

  return edits;
}
