import { allRules } from "../src/lib/live-signals";
import { refreshMarketDataForRules } from "../src/lib/market-data-refresh";

async function main(): Promise<void> {
  const rules = await allRules();
  const result = await refreshMarketDataForRules(rules);
  console.log(
    JSON.stringify(
      {
        assets: result.summary.assets.map((asset) => ({
          assetKey: asset.assetKey,
          lastBarAt: asset.lastBarAt,
          rows: asset.rows,
          timeframes: asset.timeframes,
          uploadedFiles: asset.uploadedFiles
        })),
        errors: result.summary.errors,
        refreshedAt: result.summary.refreshedAt,
        uploadedFiles: result.summary.uploadedFiles
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
