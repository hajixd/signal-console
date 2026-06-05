import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { missingTursoEnv, tursoClient, withTursoTimeout } from "../src/lib/turso";

const migrationsDir = path.join(process.cwd(), "migrations", "turso");

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function appliedMigrationNames(): Promise<Set<string>> {
  await withTursoTimeout(
    tursoClient().execute(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
    ),
    "Turso schema migration table setup"
  );

  const result = await withTursoTimeout(tursoClient().execute("SELECT name FROM schema_migrations"), "Turso schema migration lookup");
  return new Set(result.rows.map((row) => String(row.name)));
}

async function main(): Promise<void> {
  const missing = missingTursoEnv();
  if (missing.length) {
    console.error(`Turso is not configured. Missing env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const applied = await appliedMigrationNames();
  let appliedCount = 0;

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip ${file}`);
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    for (const statement of splitSqlStatements(sql)) {
      await withTursoTimeout(tursoClient().execute(statement), `Turso migration ${file}`);
    }
    await withTursoTimeout(
      tursoClient().execute({ args: [file], sql: "INSERT INTO schema_migrations (name) VALUES (?)" }),
      `Turso migration record ${file}`
    );
    console.log(`applied ${file}`);
    appliedCount += 1;
  }

  console.log(appliedCount ? `Applied ${appliedCount} Turso migration(s).` : "Turso schema is already current.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
