const DEFAULT_PROJECTX_API_BASE_URL = "https://api.topstepx.com";

export type ProjectXAccount = {
  id: number;
  name: string;
  balance?: number;
  canTrade: boolean;
  isVisible: boolean;
};

export type ProjectXConnectionStatus = {
  accounts: ProjectXAccount[];
  checkedAt?: string;
  connected: boolean;
  error?: string;
  persisted?: boolean;
  refreshed?: boolean;
  storageMode?: "firebase" | "local";
  userName?: string;
};

type ProjectXBaseResponse = {
  errorCode?: number;
  errorMessage?: string | null;
  success?: boolean;
};

type ProjectXLoginResponse = ProjectXBaseResponse & {
  token?: string;
};

type ProjectXValidateResponse = ProjectXBaseResponse & {
  newToken?: string;
  token?: string;
};

type ProjectXAccountSearchResponse = ProjectXBaseResponse & {
  accounts?: ProjectXAccount[];
};

export class ProjectXApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly errorCode?: number
  ) {
    super(message);
    this.name = "ProjectXApiError";
  }
}

function apiBaseUrl(): string {
  return (process.env.PROJECTX_API_BASE_URL ?? DEFAULT_PROJECTX_API_BASE_URL).replace(/\/+$/g, "");
}

function projectXUrl(path: string): string {
  return `${apiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

function projectXErrorMessage(response: ProjectXBaseResponse, fallback: string): string {
  const message = response.errorMessage?.trim();
  if (message) return message;
  if (typeof response.errorCode === "number" && response.errorCode !== 0) return `${fallback} (code ${response.errorCode})`;
  return fallback;
}

function assertSuccess(response: ProjectXBaseResponse, fallback: string): void {
  if (response.success === false || (typeof response.errorCode === "number" && response.errorCode !== 0)) {
    throw new ProjectXApiError(projectXErrorMessage(response, fallback), undefined, response.errorCode);
  }
}

async function parseProjectXResponse<T extends ProjectXBaseResponse>(response: Response, fallback: string): Promise<T> {
  const raw = await response.text();
  const parsed = raw ? (JSON.parse(raw) as T) : ({} as T);

  if (!response.ok) {
    throw new ProjectXApiError(projectXErrorMessage(parsed, fallback), response.status, parsed.errorCode);
  }

  assertSuccess(parsed, fallback);
  return parsed;
}

async function projectXPost<T extends ProjectXBaseResponse>(path: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(projectXUrl(path), {
    method: "POST",
    cache: "no-store",
    headers: {
      accept: "text/plain",
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body ?? {})
  });

  return parseProjectXResponse<T>(response, `ProjectX request failed for ${path}`);
}

export async function loginProjectXApiKey(userName: string, apiKey: string): Promise<string> {
  const response = await projectXPost<ProjectXLoginResponse>("/api/Auth/loginKey", {
    userName,
    apiKey
  });

  if (!response.token) {
    throw new ProjectXApiError("ProjectX authenticated but did not return a session token.");
  }

  return response.token;
}

export async function validateProjectXSession(token: string): Promise<string | undefined> {
  const response = await projectXPost<ProjectXValidateResponse>("/api/Auth/validate", {}, token);
  return response.newToken ?? response.token;
}

export async function searchProjectXAccounts(token: string, onlyActiveAccounts = true): Promise<ProjectXAccount[]> {
  const response = await projectXPost<ProjectXAccountSearchResponse>(
    "/api/Account/search",
    {
      onlyActiveAccounts
    },
    token
  );

  return response.accounts ?? [];
}

export function readableProjectXError(error: unknown): string {
  if (error instanceof ProjectXApiError) return error.message;
  if (error instanceof SyntaxError) return "ProjectX returned an unreadable response.";
  if (error instanceof Error) return error.message;
  return "ProjectX request failed.";
}
