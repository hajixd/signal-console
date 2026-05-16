import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";

import { firebaseDb, hasFirebaseAdmin } from "../src/lib/firebase-admin";

type StrategyPayload = {
  namespace: string;
  rank: number;
  strategyId: string;
  label: string;
  assetKey: string;
  symbol: string;
  market: string;
  family: string;
  provenance: string;
  status: string;
  hypothesis: string;
  sourceUrls: string[];
  params: Record<string, unknown>;
  trainingWindow: Record<string, unknown>;
  forwardWindow: Record<string, unknown>;
  selectionMethod: string;
  trainScore: number | string;
  trainMetrics: Record<string, unknown>;
  forwardMetrics: Record<string, unknown>;
  isolationNote: string;
  files: Record<string, string>;
};

type Manifest = {
  namespace: string;
  generatedAt: string;
  note: string;
  thresholds: Record<string, unknown>;
  trainingWindow: Record<string, unknown>;
  forwardWindow: Record<string, unknown>;
  count: number;
  strategies: StrategyPayload[];
};

const STRATEGY_COLLECTION = "competitionStrategies";
const RUN_COLLECTION = "competitionStrategyRuns";

function argValue(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const raw = process.argv.find((value) => value.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : fallback;
}

function readManifest(): Manifest {
  const manifestPath = path.resolve(argValue("manifest", "competition/strategies/manifest.json"));
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing competition manifest at ${manifestPath}. Run competition/generate_competition_bundle.py first.`);
  }
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

async function syncFirestore(manifest: Manifest): Promise<void> {
  if (!hasFirebaseAdmin()) {
    throw new Error("Firebase Admin credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_* vars in .env.local.");
  }

  const db = firebaseDb();
  const nowIso = new Date().toISOString();
  const runId = manifest.generatedAt.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-+|-+$/g, "");

  let batch = db.batch();
  let operations = 0;

  const flush = async () => {
    if (!operations) return;
    await batch.commit();
    batch = db.batch();
    operations = 0;
  };

  for (const strategy of manifest.strategies) {
    batch.set(
      db.collection(STRATEGY_COLLECTION).doc(strategy.strategyId),
      {
        ...strategy,
        namespace: manifest.namespace,
        runId,
        generatedAt: manifest.generatedAt,
        updatedAt: nowIso,
        updatedAtServer: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    operations += 1;
    if (operations >= 400) await flush();
  }

  const runPayload = {
    namespace: manifest.namespace,
    runId,
    generatedAt: manifest.generatedAt,
    note: manifest.note,
    thresholds: manifest.thresholds,
    trainingWindow: manifest.trainingWindow,
    forwardWindow: manifest.forwardWindow,
    count: manifest.count,
    strategyIds: manifest.strategies.map((strategy) => strategy.strategyId),
    updatedAt: nowIso,
    updatedAtServer: FieldValue.serverTimestamp()
  };

  batch.set(db.collection(RUN_COLLECTION).doc(runId), runPayload, { merge: true });
  operations += 1;
  batch.set(db.collection(RUN_COLLECTION).doc("current"), runPayload, { merge: true });
  operations += 1;
  await flush();
}

async function main() {
  const manifest = readManifest();
  await syncFirestore(manifest);
  console.log(
    `Synced ${manifest.strategies.length} isolated competition strategies to Firestore ` +
      `(${STRATEGY_COLLECTION}, namespace=${manifest.namespace})`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
