"use client";

import { useEffect, useState } from "react";

export type StrategyEditOption = {
  key: string;
  label: string;
  symbol: string;
  phase: string;
  sizeLabel: string;
  tpUnits: number;
  slUnits: number;
  dollarPerUnit: number;
  targetDollars: number;
  riskDollars: number;
};

export type StrategyEdit = {
  modelName: string;
  contracts: number;
  sizeName: string;
  tpUnits: number;
  slUnits: number;
  targetDollars: number;
  riskDollars: number;
};

export type StrategyEditMap = Record<string, StrategyEdit>;

export const STRATEGY_EDITS_STORAGE_KEY = "signal-console:strategy-edits:v1";
export const STRATEGY_EDITS_CHANGE_EVENT = "signal-console:strategy-edits-changed";

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
    tpUnits: roundControlValue(strategy.tpUnits),
    slUnits: roundControlValue(strategy.slUnits),
    targetDollars: roundControlValue(strategy.targetDollars),
    riskDollars: roundControlValue(strategy.riskDollars)
  };
}

export function normalizeStrategyEdit(strategy: StrategyEditOption, edit: StrategyEdit): StrategyEdit {
  const fallback = defaultStrategyEdit(strategy);
  return {
    modelName: fallback.modelName,
    contracts: Number.isFinite(edit.contracts) && edit.contracts > 0 ? roundControlValue(edit.contracts) : fallback.contracts,
    sizeName: fallback.sizeName,
    tpUnits: Number.isFinite(edit.tpUnits) && edit.tpUnits >= 0 ? roundControlValue(edit.tpUnits) : fallback.tpUnits,
    slUnits: Number.isFinite(edit.slUnits) && edit.slUnits >= 0 ? roundControlValue(edit.slUnits) : fallback.slUnits,
    targetDollars: Number.isFinite(edit.targetDollars) && edit.targetDollars >= 0 ? roundControlValue(edit.targetDollars) : fallback.targetDollars,
    riskDollars: Number.isFinite(edit.riskDollars) && edit.riskDollars >= 0 ? roundControlValue(edit.riskDollars) : fallback.riskDollars
  };
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.005;
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

function normalizeStrategyEdits(strategies: StrategyEditOption[], edits: StrategyEditMap): StrategyEditMap {
  const optionByKey = new Map(strategies.map((strategy) => [strategy.key, strategy]));
  const normalized: StrategyEditMap = {};

  for (const [key, edit] of Object.entries(edits)) {
    const strategy = optionByKey.get(key);
    if (!strategy) continue;
    normalized[key] = normalizeStrategyEdit(strategy, edit);
  }

  return normalized;
}

export function readStoredStrategyEdits(strategies: StrategyEditOption[]): StrategyEditMap {
  try {
    const raw = window.localStorage.getItem(STRATEGY_EDITS_STORAGE_KEY);
    return normalizeStrategyEdits(strategies, raw ? (JSON.parse(raw) as StrategyEditMap) : {});
  } catch {
    return {};
  }
}

export function emitStrategyEditsChanged(edits: StrategyEditMap): void {
  window.dispatchEvent(new CustomEvent<StrategyEditMap>(STRATEGY_EDITS_CHANGE_EVENT, { detail: edits }));
}

export function useStrategyEdits(strategies: StrategyEditOption[]): StrategyEditMap {
  const [edits, setEdits] = useState<StrategyEditMap>({});

  useEffect(() => {
    setEdits(readStoredStrategyEdits(strategies));

    const onEditsChanged = (event: Event) => {
      const detail = event instanceof CustomEvent && event.detail ? (event.detail as StrategyEditMap) : readStoredStrategyEdits(strategies);
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
  }, [strategies]);

  return edits;
}
