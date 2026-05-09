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
  autoTradePaused?: boolean;
  checkedAt?: string;
  connected: boolean;
  connections?: ProjectXConnectionSummary[];
  error?: string;
  persisted?: boolean;
  refreshed?: boolean;
  pausedAccountIds?: number[];
  storageMode?: "firebase" | "local";
  userName?: string;
};

export type ProjectXConnectionSummary = {
  accounts: ProjectXAccount[];
  autoTradePaused?: boolean;
  connectedAt: string;
  id: string;
  pausedAccountIds?: number[];
  readable: boolean;
  status: "connected" | "expired";
  updatedAt: string;
  userName?: string;
};

export type ProjectXContract = {
  activeContract?: boolean;
  description?: string;
  id: string;
  name: string;
  symbolId?: string;
  tickSize?: number;
  tickValue?: number;
};

export type ProjectXOrderType = 1 | 2 | 4 | 5 | 6 | 7;
export type ProjectXOrderSide = 0 | 1;

export type ProjectXBracket = {
  ticks: number;
  type: ProjectXOrderType;
};

export type ProjectXPlaceOrderRequest = {
  accountId: number;
  contractId: string;
  customTag?: string | null;
  limitPrice?: number | null;
  side: ProjectXOrderSide;
  size: number;
  stopLossBracket?: ProjectXBracket | null;
  stopPrice?: number | null;
  takeProfitBracket?: ProjectXBracket | null;
  trailPrice?: number | null;
  type: ProjectXOrderType;
};

export type ProjectXPlaceOrderResult = {
  orderId: number;
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

type ProjectXContractSearchResponse = ProjectXBaseResponse & {
  contracts?: ProjectXContract[];
};

type ProjectXPlaceOrderResponse = ProjectXBaseResponse & {
  orderId?: number;
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

export async function searchProjectXContracts(token: string, searchText: string, live = false): Promise<ProjectXContract[]> {
  const response = await projectXPost<ProjectXContractSearchResponse>(
    "/api/Contract/search",
    {
      live,
      searchText
    },
    token
  );

  return response.contracts ?? [];
}

export async function placeProjectXOrder(token: string, request: ProjectXPlaceOrderRequest): Promise<ProjectXPlaceOrderResult> {
  const response = await projectXPost<ProjectXPlaceOrderResponse>("/api/Order/place", request, token);
  if (typeof response.orderId !== "number" || !Number.isFinite(response.orderId)) {
    throw new ProjectXApiError("ProjectX accepted the request but did not return an order id.");
  }
  return { orderId: response.orderId };
}

export function readableProjectXError(error: unknown): string {
  if (error instanceof ProjectXApiError) return error.message;
  if (error instanceof SyntaxError) return "ProjectX returned an unreadable response.";
  if (error instanceof Error) return error.message;
  return "ProjectX request failed.";
}
