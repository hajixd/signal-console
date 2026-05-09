import { getLiveConfig, saveLiveConfig } from "../src/lib/live-config";

function parseListArg(flag: string): string[] | undefined {
  const exact = process.argv.find((value) => value.startsWith(`${flag}=`));
  if (exact) {
    return exact
      .slice(flag.length + 1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const next = process.argv[index + 1];
  if (!next) return [];
  return next
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const existing = await getLiveConfig();
  const enabledDatasetIds = parseListArg("--enabled") ?? existing.enabledDatasetIds;
  const dashboardSelectedDatasetIds = parseListArg("--dashboard") ?? existing.dashboardSelectedDatasetIds;

  const saved = await saveLiveConfig({
    customScaleRanges: existing.customScaleRanges,
    dashboardSettings: existing.dashboardSettings,
    enabledDatasetIds,
    dashboardSelectedDatasetIds,
    strategyEdits: existing.strategyEdits
  });

  console.log(JSON.stringify(saved, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
