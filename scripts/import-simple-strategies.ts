import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";

import { firebaseDb, hasFirebaseAdmin } from "../src/lib/firebase-admin";

type ImportMetrics = {
  trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  profit_factor: number | "Infinity";
  total_r: number;
  avg_r: number;
  max_drawdown_r: number;
  trades_per_day: number;
  trades_per_week: number;
};

type ValidatedStrategy = {
  strategyId: string;
  label: string;
  folder: string;
  assetKey: string;
  symbol: string;
  market: string;
  phase: string;
  family: string;
  parameterSetName: string;
  variantId: string;
  source: string;
  sourceFolders: string[];
  sourcePaths: string[];
  sourceFolderCount: number;
  canonicalSourceFolder: string;
  sourceFileName: string;
  sourceCode: string;
  rawParams: Record<string, unknown>;
  metrics: ImportMetrics;
  antiCheatPassed: boolean;
  metadataPath: string;
  backtestPath: string;
};

type ImportSummary = {
  batchId: string;
  generatedAt: string;
  inputDir: string;
  outputDir: string;
  thresholds: {
    profitFactorGreaterThan: number;
    tradesGreaterThan: number;
  };
  counts: Record<string, number>;
  validatedStrategies: ValidatedStrategy[];
};

const COLLECTION = "signalConsoleSimpleStrategies";
const IMPORT_COLLECTION = "signalConsoleSimpleStrategyImports";

function parseArgs(argv: string[]) {
  const defaults = {
    inputDir: path.join(os.homedir(), "Desktop", "simple"),
    outputDir: path.join(process.cwd(), ".local", "simple-import"),
    python: process.env.PYTHON || "python",
    minProfitFactor: 2,
    minTrades: 30
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--input-dir" && next) defaults.inputDir = path.resolve(next);
    if (token === "--output-dir" && next) defaults.outputDir = path.resolve(next);
    if (token === "--python" && next) defaults.python = next;
    if (token === "--min-profit-factor" && next) defaults.minProfitFactor = Number(next);
    if (token === "--min-trades" && next) defaults.minTrades = Number(next);
  }

  return defaults;
}

function runImportPipeline(options: ReturnType<typeof parseArgs>) {
  const scriptPath = path.join(process.cwd(), "backtest-engine", "import_simple_candidates.py");
  execFileSync(
    options.python,
    [
      scriptPath,
      "--input-dir",
      options.inputDir,
      "--output-dir",
      options.outputDir,
      "--min-profit-factor",
      String(options.minProfitFactor),
      "--min-trades",
      String(options.minTrades)
    ],
    {
      cwd: process.cwd(),
      stdio: "inherit"
    }
  );
}

function readSummary(outputDir: string): ImportSummary {
  const summaryPath = path.join(outputDir, "import-summary.json");
  if (!existsSync(summaryPath)) {
    throw new Error(`Missing import summary at ${summaryPath}`);
  }
  return JSON.parse(readFileSync(summaryPath, "utf8")) as ImportSummary;
}

async function syncFirestore(summary: ImportSummary): Promise<void> {
  if (!hasFirebaseAdmin()) {
    throw new Error("Firebase Admin credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_* vars in .env.local.");
  }

  const db = firebaseDb();
  const nowIso = new Date().toISOString();
  const validatedIds = new Set(summary.validatedStrategies.map((item) => item.strategyId));

  const existingSnapshot = await db.collection(COLLECTION).get();
  let batch = db.batch();
  let operationCount = 0;

  const flush = async () => {
    if (!operationCount) return;
    await batch.commit();
    batch = db.batch();
    operationCount = 0;
  };

  for (const doc of existingSnapshot.docs) {
    if (!validatedIds.has(doc.id)) {
      batch.delete(doc.ref);
      operationCount += 1;
      if (operationCount >= 400) {
        await flush();
      }
    }
  }

  for (const strategy of summary.validatedStrategies) {
    batch.set(
      db.collection(COLLECTION).doc(strategy.strategyId),
      {
        namespace: "simple_import",
        batchId: summary.batchId,
        generatedAt: summary.generatedAt,
        thresholds: summary.thresholds,
        ...strategy,
        updatedAt: nowIso,
        updatedAtServer: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    operationCount += 1;
    if (operationCount >= 400) {
      await flush();
    }
  }

  batch.set(
    db.collection(IMPORT_COLLECTION).doc(summary.batchId),
    {
      namespace: "simple_import",
      batchId: summary.batchId,
      generatedAt: summary.generatedAt,
      inputDir: summary.inputDir,
      outputDir: summary.outputDir,
      thresholds: summary.thresholds,
      counts: summary.counts,
      validatedStrategyIds: summary.validatedStrategies.map((item) => item.strategyId),
      updatedAt: nowIso,
      updatedAtServer: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
  operationCount += 1;

  batch.set(
    db.collection(IMPORT_COLLECTION).doc("current"),
    {
      namespace: "simple_import",
      batchId: summary.batchId,
      generatedAt: summary.generatedAt,
      inputDir: summary.inputDir,
      outputDir: summary.outputDir,
      thresholds: summary.thresholds,
      counts: summary.counts,
      validatedStrategyIds: summary.validatedStrategies.map((item) => item.strategyId),
      updatedAt: nowIso,
      updatedAtServer: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
  operationCount += 1;

  await flush();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  runImportPipeline(options);
  const summary = readSummary(options.outputDir);
  await syncFirestore(summary);

  console.log(
    `Imported ${summary.validatedStrategies.length} validated simple strategies to Firestore (${COLLECTION}) from ${summary.inputDir}`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
