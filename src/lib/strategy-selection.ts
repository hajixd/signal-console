export const ALL_STRATEGIES_SELECTION_PARAM = "all";
export const NO_STRATEGIES_SELECTION_PARAM = "none";

export function parseStrategySelection(value: string | undefined, allKeys: string[], defaultKeys: string[]): string[] {
  const allowed = new Set(allKeys);
  if (value === ALL_STRATEGIES_SELECTION_PARAM) return allKeys;
  if (value === NO_STRATEGIES_SELECTION_PARAM) return [];
  if (!value) return defaultKeys.filter((key) => allowed.has(key));
  const parsed = [...new Set(value.split(",").filter((key) => allowed.has(key)))];
  return parsed.length ? parsed : defaultKeys.filter((key) => allowed.has(key));
}

export function selectionIncludesEveryKey(selectedKeys: string[], allKeys: string[]): boolean {
  if (selectedKeys.length !== allKeys.length) return false;
  const selected = new Set(selectedKeys);
  return allKeys.every((key) => selected.has(key));
}
