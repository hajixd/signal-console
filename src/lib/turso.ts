import { createClient } from "@libsql/client/web";

const DEFAULT_TURSO_TIMEOUT_MS = 20_000;

type TursoClient = ReturnType<typeof createClient>;

let cachedClient: TursoClient | null = null;

function trim(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function operationTimeoutMs(): number {
  const configured = Number(process.env.TURSO_OPERATION_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 250 ? configured : DEFAULT_TURSO_TIMEOUT_MS;
}

export function missingTursoEnv(): string[] {
  return ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"].filter((key) => !trim(process.env[key]));
}

export function tursoConfigured(): boolean {
  return missingTursoEnv().length === 0;
}

export function tursoClient(): TursoClient {
  if (cachedClient) return cachedClient;
  const url = trim(process.env.TURSO_DATABASE_URL);
  const authToken = trim(process.env.TURSO_AUTH_TOKEN);
  if (!url || !authToken) {
    throw new Error(`Turso is not configured. Missing: ${missingTursoEnv().join(", ")}`);
  }

  cachedClient = createClient({ authToken, url });
  return cachedClient;
}

export async function withTursoTimeout<T>(operation: Promise<T>, label: string, timeoutMs = operationTimeoutMs()): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type TursoDocument = {
  collection: string;
  createdAt?: string;
  id: string;
  payload: Record<string, unknown>;
  sortTimeMillis?: number;
  updatedAt?: string;
};

function parsePayload(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function documentFromRow(row: Record<string, unknown>): TursoDocument {
  return {
    collection: String(row.collection ?? ""),
    createdAt: typeof row.created_at === "string" ? row.created_at : undefined,
    id: String(row.id ?? ""),
    payload: parsePayload(row.payload_json),
    sortTimeMillis: typeof row.sort_time_millis === "number" ? row.sort_time_millis : undefined,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined
  };
}

export async function getTursoDocument(collection: string, id: string): Promise<TursoDocument | null> {
  const result = await withTursoTimeout(
    tursoClient().execute({
      args: [collection, id],
      sql: "SELECT collection, id, payload_json, sort_time_millis, created_at, updated_at FROM app_documents WHERE collection = ? AND id = ?"
    }),
    `Turso document read ${collection}/${id}`
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? documentFromRow(row) : null;
}

export async function listTursoDocuments(collection: string, limit = 500): Promise<TursoDocument[]> {
  const result = await withTursoTimeout(
    tursoClient().execute({
      args: [collection, Math.max(1, Math.min(5000, Math.round(limit)))],
      sql: [
        "SELECT collection, id, payload_json, sort_time_millis, created_at, updated_at",
        "FROM app_documents",
        "WHERE collection = ?",
        "ORDER BY COALESCE(sort_time_millis, 0) DESC, updated_at DESC",
        "LIMIT ?"
      ].join(" ")
    }),
    `Turso document list ${collection}`
  );
  return result.rows.map((row) => documentFromRow(row as Record<string, unknown>));
}

export async function saveTursoDocument(input: {
  collection: string;
  id: string;
  payload: Record<string, unknown>;
  sortTimeMillis?: number;
}): Promise<void> {
  const now = new Date().toISOString();
  await withTursoTimeout(
    tursoClient().execute({
      args: [
        input.collection,
        input.id,
        JSON.stringify(input.payload),
        typeof input.sortTimeMillis === "number" && Number.isFinite(input.sortTimeMillis) ? Math.round(input.sortTimeMillis) : null,
        now,
        now
      ],
      sql: [
        "INSERT INTO app_documents (collection, id, payload_json, sort_time_millis, created_at, updated_at)",
        "VALUES (?, ?, ?, ?, ?, ?)",
        "ON CONFLICT(collection, id) DO UPDATE SET",
        "payload_json = excluded.payload_json,",
        "sort_time_millis = excluded.sort_time_millis,",
        "updated_at = excluded.updated_at"
      ].join(" ")
    }),
    `Turso document save ${input.collection}/${input.id}`
  );
}

function isConstraintError(error: unknown): boolean {
  const record = error as { code?: string; message?: string };
  return (
    record?.code === "SQLITE_CONSTRAINT" ||
    record?.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
    /constraint|unique/i.test(record?.message ?? "")
  );
}

export async function createTursoDocument(input: {
  collection: string;
  id: string;
  payload: Record<string, unknown>;
  sortTimeMillis?: number;
}): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    await withTursoTimeout(
      tursoClient().execute({
        args: [
          input.collection,
          input.id,
          JSON.stringify(input.payload),
          typeof input.sortTimeMillis === "number" && Number.isFinite(input.sortTimeMillis) ? Math.round(input.sortTimeMillis) : null,
          now,
          now
        ],
        sql: [
          "INSERT INTO app_documents (collection, id, payload_json, sort_time_millis, created_at, updated_at)",
          "VALUES (?, ?, ?, ?, ?, ?)"
        ].join(" ")
      }),
      `Turso document create ${input.collection}/${input.id}`
    );
    return true;
  } catch (error) {
    if (isConstraintError(error)) return false;
    throw error;
  }
}

export async function deleteTursoDocument(collection: string, id: string): Promise<void> {
  await withTursoTimeout(
    tursoClient().execute({
      args: [collection, id],
      sql: "DELETE FROM app_documents WHERE collection = ? AND id = ?"
    }),
    `Turso document delete ${collection}/${id}`
  );
}
