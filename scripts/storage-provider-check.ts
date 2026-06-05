import { r2Configured, r2HeadBucket, r2ListKeys, missingR2Env } from "../src/lib/r2";
import { missingTursoEnv, tursoClient, tursoConfigured, withTursoTimeout } from "../src/lib/turso";

async function checkTurso(): Promise<{ configured: boolean; ok: boolean; message: string }> {
  const missing = missingTursoEnv();
  if (!tursoConfigured()) {
    return { configured: false, ok: false, message: `Missing ${missing.join(", ")}` };
  }

  try {
    await withTursoTimeout(tursoClient().execute("SELECT 1 AS ok"), "Turso connection check");
    return { configured: true, ok: true, message: "Connected" };
  } catch (error) {
    return { configured: true, ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

async function checkR2(): Promise<{ configured: boolean; ok: boolean; message: string; sampleKeys?: number }> {
  const missing = missingR2Env();
  if (!r2Configured()) {
    return { configured: false, ok: false, message: `Missing ${missing.join(", ")}` };
  }

  try {
    await r2HeadBucket();
    const keys = await r2ListKeys("", 5);
    return { configured: true, ok: true, message: "Connected", sampleKeys: keys.length };
  } catch (error) {
    return { configured: true, ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const [turso, r2] = await Promise.all([checkTurso(), checkR2()]);
  const result = { r2, turso };
  console.log(JSON.stringify(result, null, 2));

  if (!turso.ok || !r2.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
