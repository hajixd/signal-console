import { tursoClient, tursoConfigured, withTursoTimeout } from "@/lib/turso";

/** Read-side helpers for MT5 EA telemetry (balance, state, heartbeat, orders). */

export type Mt5AccountState = {
  bridgeAccountId: string;
  bridgeStatus?: string;
  balance?: number;
  equity?: number;
  margin?: number;
  freeMargin?: number;
  marginLevelPct?: number;
  floatingPnL?: number;
  openPositionCount?: number;
  lastError?: string;
  updatedAt?: string;
};

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : value == null ? undefined : Number(value);
}

function text(value: unknown): string | undefined {
  return value == null ? undefined : String(value);
}

export async function getAccountState(bridgeAccountId: string): Promise<Mt5AccountState | null> {
  if (!tursoConfigured()) return null;
  const result = await withTursoTimeout(
    tursoClient().execute({
      args: [bridgeAccountId],
      sql: [
        "SELECT bridge_account_id, bridge_status, balance, equity, margin, free_margin,",
        "margin_level_pct, floating_pnl, open_position_count, last_error, updated_at",
        "FROM mt5_account_state WHERE bridge_account_id = ?"
      ].join(" ")
    }),
    `MT5 account state read ${bridgeAccountId}`
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    bridgeAccountId: String(row.bridge_account_id),
    bridgeStatus: text(row.bridge_status),
    balance: num(row.balance),
    equity: num(row.equity),
    margin: num(row.margin),
    freeMargin: num(row.free_margin),
    marginLevelPct: num(row.margin_level_pct),
    floatingPnL: num(row.floating_pnl),
    openPositionCount: num(row.open_position_count),
    lastError: text(row.last_error),
    updatedAt: text(row.updated_at)
  };
}

/** Latest EA-reported balance for an account, or null if none reported yet. */
export async function getLatestAccountBalance(bridgeAccountId: string): Promise<number | null> {
  const state = await getAccountState(bridgeAccountId);
  const balance = state?.balance;
  return typeof balance === "number" && Number.isFinite(balance) && balance > 0 ? balance : null;
}

export type Mt5Heartbeat = {
  bridgeAccountId: string;
  eaVersion?: string;
  terminalBuild?: number;
  terminalConnected: boolean;
  tradeAllowed: boolean;
  accountLogin?: number;
  accountServer?: string;
  lastError?: string;
  updatedAt?: string;
};

export async function getHeartbeat(bridgeAccountId: string): Promise<Mt5Heartbeat | null> {
  if (!tursoConfigured()) return null;
  const result = await withTursoTimeout(
    tursoClient().execute({
      args: [bridgeAccountId],
      sql: [
        "SELECT bridge_account_id, ea_version, terminal_build, terminal_connected, trade_allowed,",
        "account_login, account_server, last_error, updated_at",
        "FROM ea_heartbeats WHERE bridge_account_id = ?"
      ].join(" ")
    }),
    `MT5 heartbeat read ${bridgeAccountId}`
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    bridgeAccountId: String(row.bridge_account_id),
    eaVersion: text(row.ea_version),
    terminalBuild: num(row.terminal_build),
    terminalConnected: Number(row.terminal_connected) === 1,
    tradeAllowed: Number(row.trade_allowed) === 1,
    accountLogin: num(row.account_login),
    accountServer: text(row.account_server),
    lastError: text(row.last_error),
    updatedAt: text(row.updated_at)
  };
}

export type Mt5OrderView = {
  id: string;
  status: string;
  kind: string;
  symbol: string;
  side: string;
  volume: number;
  sl?: number;
  tp?: number;
  riskUsd?: number;
  fillPrice?: number;
  slippagePips?: number;
  brokerTicket?: number;
  retcodeLabel?: string;
  errorMessage?: string;
  sourceAlertId?: string;
  createdAt?: string;
  resultAt?: string;
  closeProfit?: number;
  closeReason?: string;
  closedAt?: string;
};

export async function listMt5Orders(bridgeAccountId: string, limit = 50): Promise<Mt5OrderView[]> {
  if (!tursoConfigured()) return [];
  const safeLimit = Math.max(1, Math.min(500, Math.round(limit)));
  const result = await withTursoTimeout(
    tursoClient().execute({
      args: [bridgeAccountId, safeLimit],
      sql: [
        "SELECT id, status, kind, symbol, side, volume, sl, tp, risk_usd, fill_price, slippage_pips,",
        "broker_ticket, retcode_label, error_message, source_alert_id, created_at, result_at,",
        "close_profit, close_reason, closed_at",
        "FROM mt5_pending_orders WHERE bridge_account_id = ?",
        "ORDER BY created_at DESC LIMIT ?"
      ].join(" ")
    }),
    `MT5 orders list ${bridgeAccountId}`
  );
  return result.rows.map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      id: String(row.id),
      status: String(row.status),
      kind: String(row.kind),
      symbol: String(row.symbol),
      side: String(row.side),
      volume: Number(row.volume),
      sl: num(row.sl),
      tp: num(row.tp),
      riskUsd: num(row.risk_usd),
      fillPrice: num(row.fill_price),
      slippagePips: num(row.slippage_pips),
      brokerTicket: num(row.broker_ticket),
      retcodeLabel: text(row.retcode_label),
      errorMessage: text(row.error_message),
      sourceAlertId: text(row.source_alert_id),
      createdAt: text(row.created_at),
      resultAt: text(row.result_at),
      closeProfit: num(row.close_profit),
      closeReason: text(row.close_reason),
      closedAt: text(row.closed_at)
    };
  });
}

export type Mt5ExecutionStats = {
  total: number;
  byStatus: Record<string, number>;
  filled: number;
  rejected: number;
  pending: number;
  fillRatePct: number | null;
  avgSlippagePips: number | null;
  riskDeployedUsd: number;
  closed: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  realizedPnlUsd: number;
  realizedR: number | null;
  lastOrderAt?: string;
};

export async function getMt5ExecutionStats(bridgeAccountId: string): Promise<Mt5ExecutionStats> {
  const empty: Mt5ExecutionStats = {
    total: 0,
    byStatus: {},
    filled: 0,
    rejected: 0,
    pending: 0,
    fillRatePct: null,
    avgSlippagePips: null,
    riskDeployedUsd: 0,
    closed: 0,
    wins: 0,
    losses: 0,
    winRatePct: null,
    realizedPnlUsd: 0,
    realizedR: null
  };
  if (!tursoConfigured()) return empty;

  const counts = await withTursoTimeout(
    tursoClient().execute({
      args: [bridgeAccountId],
      sql: "SELECT status, COUNT(*) n, MAX(created_at) last_at FROM mt5_pending_orders WHERE bridge_account_id = ? GROUP BY status"
    }),
    `MT5 stats counts ${bridgeAccountId}`
  );
  const byStatus: Record<string, number> = {};
  let total = 0;
  let lastOrderAt: string | undefined;
  for (const raw of counts.rows) {
    const row = raw as Record<string, unknown>;
    const status = String(row.status);
    const n = Number(row.n);
    byStatus[status] = n;
    total += n;
    const lastAt = text(row.last_at);
    if (lastAt && (!lastOrderAt || lastAt > lastOrderAt)) lastOrderAt = lastAt;
  }

  const filled = byStatus.filled ?? 0;
  const rejected = byStatus.rejected ?? 0;
  const pending = (byStatus.queued ?? 0) + (byStatus.claimed ?? 0);
  const decided = filled + rejected;

  const agg = await withTursoTimeout(
    tursoClient().execute({
      args: [bridgeAccountId],
      sql: "SELECT AVG(slippage_pips) avg_slip, SUM(COALESCE(risk_usd, 0)) risk FROM mt5_pending_orders WHERE bridge_account_id = ? AND status = 'filled'"
    }),
    `MT5 stats agg ${bridgeAccountId}`
  );
  const aggRow = (agg.rows[0] ?? {}) as Record<string, unknown>;

  // Realized close P&L / R from reconciled fills.
  const realized = await withTursoTimeout(
    tursoClient().execute({
      args: [bridgeAccountId],
      sql: [
        "SELECT COUNT(*) closed,",
        "SUM(CASE WHEN close_profit > 0 THEN 1 ELSE 0 END) wins,",
        "SUM(CASE WHEN close_profit < 0 THEN 1 ELSE 0 END) losses,",
        "SUM(close_profit) pnl,",
        "SUM(CASE WHEN risk_usd > 0 THEN close_profit / risk_usd ELSE 0 END) r",
        "FROM mt5_pending_orders WHERE bridge_account_id = ? AND close_profit IS NOT NULL"
      ].join(" ")
    }),
    `MT5 stats realized ${bridgeAccountId}`
  );
  const realizedRow = (realized.rows[0] ?? {}) as Record<string, unknown>;
  const closed = num(realizedRow.closed) ?? 0;
  const wins = num(realizedRow.wins) ?? 0;
  const losses = num(realizedRow.losses) ?? 0;

  return {
    total,
    byStatus,
    filled,
    rejected,
    pending,
    fillRatePct: decided > 0 ? (filled / decided) * 100 : null,
    avgSlippagePips: num(aggRow.avg_slip) ?? null,
    riskDeployedUsd: num(aggRow.risk) ?? 0,
    closed,
    wins,
    losses,
    winRatePct: closed > 0 ? (wins / closed) * 100 : null,
    realizedPnlUsd: num(realizedRow.pnl) ?? 0,
    realizedR: closed > 0 ? num(realizedRow.r) ?? 0 : null,
    lastOrderAt
  };
}
