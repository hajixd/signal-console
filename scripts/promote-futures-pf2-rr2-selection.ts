import { readFile } from "node:fs/promises";
import path from "node:path";
import { getLiveConfig, saveLiveConfig } from "../src/lib/live-config";
import { STRATEGY_DEFINITIONS } from "../src/lib/strategy-loader";

type SelectionReport = {
  selectedStrategyIds?: string[];
};

function parseArgValue(flag: string): string | undefined {
  const exact = process.argv.find((value) => value.startsWith(`${flag}=`));
  if (!exact) return undefined;
  return exact.slice(flag.length + 1).trim();
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function main(): Promise<void> {
  const dryRun = hasFlag("--dry-run");
  const reportPath = path.resolve(
    process.cwd(),
    parseArgValue("--report") ?? "Research/reports/futures_pf2_rr2_nonduplicate_selection_20260607.json"
  );
  const report = JSON.parse(await readFile(reportPath, "utf8")) as SelectionReport;
  const selectedStrategyIds = dedupe(report.selectedStrategyIds ?? []);
  const strategyById = new Map(STRATEGY_DEFINITIONS.map((strategy) => [strategy.id, strategy]));
  const futuresStrategyIds = new Set(
    STRATEGY_DEFINITIONS.filter((strategy) => strategy.assetKey.endsWith("_futures")).map((strategy) => strategy.id)
  );
  const invalid = selectedStrategyIds.filter((strategyId) => !strategyById.has(strategyId));
  const nonFutures = selectedStrategyIds.filter((strategyId) => !futuresStrategyIds.has(strategyId));

  if (invalid.length || nonFutures.length) {
    throw new Error(
      JSON.stringify(
        {
          message: "Selection report contains invalid or non-futures strategy ids.",
          invalid,
          nonFutures
        },
        null,
        2
      )
    );
  }

  const existing = await getLiveConfig();
  const enabledNonFutures = existing.enabledDatasetIds.filter((strategyId) => !futuresStrategyIds.has(strategyId));
  const dashboardNonFutures = existing.dashboardSelectedDatasetIds.filter((strategyId) => !futuresStrategyIds.has(strategyId));
  const nextEnabledDatasetIds = dedupe([...enabledNonFutures, ...selectedStrategyIds]);
  const nextDashboardSelectedDatasetIds = dedupe([...dashboardNonFutures, ...selectedStrategyIds]);
  const summary = {
    dryRun,
    selectedFuturesCount: selectedStrategyIds.length,
    previousEnabledCount: existing.enabledDatasetIds.length,
    previousEnabledFuturesCount: existing.enabledDatasetIds.filter((strategyId) => futuresStrategyIds.has(strategyId)).length,
    nextEnabledCount: nextEnabledDatasetIds.length,
    nextEnabledFuturesCount: nextEnabledDatasetIds.filter((strategyId) => futuresStrategyIds.has(strategyId)).length,
    previousDashboardCount: existing.dashboardSelectedDatasetIds.length,
    previousDashboardFuturesCount: existing.dashboardSelectedDatasetIds.filter((strategyId) => futuresStrategyIds.has(strategyId)).length,
    nextDashboardCount: nextDashboardSelectedDatasetIds.length,
    nextDashboardFuturesCount: nextDashboardSelectedDatasetIds.filter((strategyId) => futuresStrategyIds.has(strategyId)).length,
    selectedStrategyIds
  };

  if (dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const saved = await saveLiveConfig({
    ...existing,
    enabledDatasetIds: nextEnabledDatasetIds,
    dashboardSelectedDatasetIds: nextDashboardSelectedDatasetIds
  });

  console.log(
    JSON.stringify(
      {
        ...summary,
        updatedAt: saved.updatedAt
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
