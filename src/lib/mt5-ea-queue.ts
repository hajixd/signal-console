import { randomUUID } from "node:crypto";

import { tursoClient, tursoConfigured, withTursoTimeout } from "@/lib/turso";

/**
 * MT5 EA pull-based execution queue.
 *
 * The MT5 Expert Advisor polls `/ea/orders/pending/:bridgeAccountId`, executes
 * each returned order via OrderSend, and reports back to `/ea/orders/result/:_id`.
 * This module owns the Turso-backed queue + EA telemetry (state/heartbeat).
 *
 * Reliability note: all traffic is EA -> this app (outbound HTTPS from MT5),
 * so there is no inbound tunnel to the Windows VM. That is the whole point of
 * the pull model vs the old push bridge.
 */

export type Mt5OrderKind = "market" | "limit" | "stop" | "modify_sltp" | "close" | "partial_close" | "cancel_pending";
export type Mt5OrderSide = "buy" | "sell";
export type Mt5OrderStatus = "queued" | "claimed" | "filled" | "rejected" | "expired" | "cancelled";

export type Mt5EnqueueInput = {
  bridgeAccountId: string;
  kind?: Mt5OrderKind;
  symbol: string;
  side: Mt5OrderSide;
  volume: number;
  entryType?: "market" | "limit";
  entryPrice?: number;
  sl?: number;
  tp?: number;
  pendingOrderTicket?: number;
  sourceAlertId?: string;
  customTag?: string;
  riskUsd?: number;
  comment?: string;
  ttlSeconds?: number;
};

/** Shape the EA parses out of each pending-order object. camelCase + `_id`. */
export type Mt5PendingOrderForEa = {
  _id: string;
  kind: Mt5OrderKind;
  symbol: string;
  side: Mt5OrderSide;
  volume: number;
  sl?: number;
  tp?: number;
  entryPrice?: number;
  pendingOrderTicket?: number;
  comment?: string;
};

export type Mt5OrderResultInput = {
  status?: string;
  brokerTicket?: number;
  fillPrice?: number;
  slippagePips?: number;
  commission?: number;
  swap?: number;
  spreadPipsAtFire?: number;
  latencyMs?: number;
  retcode?: number;
  retcodeLabel?: string;
  errorMessage?: string;
};

export type Mt5AccountStateInput = {
  bridgeStatus?: string;
  balance?: number;
  equity?: number;
  margin?: number;
  freeMargin?: number;
  marginLevelPct?: number;
  floatingPnL?: number;
  openPositionCount?: number;
  lastError?: string;
};

export type Mt5HeartbeatInput = {
  eaVersion?: string;
  terminalBuild?: number;
  terminalConnected?: boolean;
  tradeAllowed?: boolean;
  accountLogin?: number;
  accountServer?: string;
  lastError?: string;
};

const DEFAULT_ORDER_TTL_SECONDS = 120;
const DEFAULT_CLAIM_STALE_SECONDS = 30;

function intEnv(name: string, fallback: number, min = 1): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min ? Math.round(value) : fallback;
}

function nullableNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Bearer token EAs must present on every /ea/* request. */
export function eaIngestToken(): string | undefined {
  return process.env.EA_INGEST_TOKEN?.trim() || undefined;
}

export function mt5EaConfigured(): boolean {
  return tursoConfigured() && Boolean(eaIngestToken());
}

/** Constant-time-ish bearer check against EA_INGEST_TOKEN. */
export function eaIngestAuthorized(authorizationHeader: string | null): boolean {
  const token = eaIngestToken();
  if (!token) return false;
  return authorizationHeader === `Bearer ${token}`;
}

/**
 * Enqueue an order for the EA to pick up. Idempotent per
 * (bridgeAccountId, sourceAlertId, customTag): a duplicate enqueue returns the
 * existing row's id instead of creating a second order.
 */
export async function enqueueMt5Order(input: Mt5EnqueueInput): Promise<{ id: string; deduped: boolean }> {
  const ttlSeconds = input.ttlSeconds ?? intEnv("MT5_EA_ORDER_TTL_SECONDS", DEFAULT_ORDER_TTL_SECONDS);
  const id = randomUUID();
  const kind: Mt5OrderKind = input.kind ?? (input.entryType === "limit" ? "limit" : "market");
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

  const result = await withTursoTimeout(
    tursoClient().execute({
      args: [
        id,
        input.bridgeAccountId,
        kind,
        input.symbol,
        input.side,
        input.volume,
        input.entryType ?? "market",
        nullableNumber(input.entryPrice),
        nullableNumber(input.sl),
        nullableNumber(input.tp),
        nullableNumber(input.pendingOrderTicket),
        nullableText(input.sourceAlertId),
        nullableText(input.customTag),
        nullableNumber(input.riskUsd),
        createdAt,
        expiresAt
      ],
      sql: [
        "INSERT INTO mt5_pending_orders",
        "(id, bridge_account_id, kind, symbol, side, volume, entry_type, entry_price, sl, tp, pending_order_ticket,",
        " status, source_alert_id, custom_tag, risk_usd, created_at, expires_at)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)",
        "ON CONFLICT (bridge_account_id, source_alert_id, custom_tag) DO NOTHING"
      ].join(" ")
    }),
    `MT5 enqueue ${input.bridgeAccountId}/${input.symbol}`
  );

  if (result.rowsAffected && result.rowsAffected > 0) {
    return { id, deduped: false };
  }

  // Conflict: an order for this alert already exists. Return its id.
  const existing = await withTursoTimeout(
    tursoClient().execute({
      args: [input.bridgeAccountId, nullableText(input.sourceAlertId), nullableText(input.customTag)],
      sql: "SELECT id FROM mt5_pending_orders WHERE bridge_account_id = ? AND source_alert_id IS ? AND custom_tag IS ? LIMIT 1"
    }),
    `MT5 enqueue dedupe lookup ${input.bridgeAccountId}`
  );
  const existingId = existing.rows[0]?.id;
  return { id: existingId ? String(existingId) : id, deduped: true };
}

function rowToEaOrder(row: Record<string, unknown>): Mt5PendingOrderForEa {
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : v == null ? undefined : Number(v));
  const order: Mt5PendingOrderForEa = {
    _id: String(row.id ?? ""),
    kind: String(row.kind ?? "market") as Mt5OrderKind,
    symbol: String(row.symbol ?? ""),
    side: String(row.side ?? "buy") as Mt5OrderSide,
    volume: Number(row.volume ?? 0)
  };
  const sl = num(row.sl);
  const tp = num(row.tp);
  const entryPrice = num(row.entry_price);
  const pendingOrderTicket = num(row.pending_order_ticket);
  if (sl != null) order.sl = sl;
  if (tp != null) order.tp = tp;
  if (entryPrice != null) order.entryPrice = entryPrice;
  if (pendingOrderTicket != null) order.pendingOrderTicket = pendingOrderTicket;
  return order;
}

/**
 * Atomically claim queued orders for one account (queued -> claimed) and return
 * them in the EA's expected shape. Expires stale queued orders first. When
 * `includeStaleClaimed` is set, also re-delivers orders stuck in `claimed`
 * past the stale window (EA restarted before reporting a result).
 */
export async function claimPendingOrders(
  bridgeAccountId: string,
  includeStaleClaimed = false
): Promise<Mt5PendingOrderForEa[]> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const client = tursoClient();

  // 1. Expire queued orders that were never claimed in time.
  await withTursoTimeout(
    client.execute({
      args: [nowIso, nowIso],
      sql: "UPDATE mt5_pending_orders SET status = 'expired', result_at = ? WHERE status = 'queued' AND expires_at IS NOT NULL AND expires_at < ?"
    }),
    `MT5 reap expired ${bridgeAccountId}`
  );

  // 2. Claim queued -> claimed and return the claimed rows atomically.
  const claimed = await withTursoTimeout(
    client.execute({
      args: [nowIso, bridgeAccountId],
      sql: [
        "UPDATE mt5_pending_orders SET status = 'claimed', claimed_at = ?",
        "WHERE bridge_account_id = ? AND status = 'queued'",
        "RETURNING id, kind, symbol, side, volume, sl, tp, entry_price, pending_order_ticket"
      ].join(" ")
    }),
    `MT5 claim ${bridgeAccountId}`
  );
  const orders = claimed.rows.map((row) => rowToEaOrder(row as Record<string, unknown>));

  // 3. Optionally re-deliver stale claimed orders (refresh claimed_at so they
  //    aren't re-delivered every poll).
  if (includeStaleClaimed) {
    const staleSeconds = intEnv("MT5_EA_CLAIM_STALE_SECONDS", DEFAULT_CLAIM_STALE_SECONDS);
    const staleBefore = new Date(nowMs - staleSeconds * 1000).toISOString();
    const stale = await withTursoTimeout(
      client.execute({
        args: [nowIso, bridgeAccountId, staleBefore],
        sql: [
          "UPDATE mt5_pending_orders SET claimed_at = ?",
          "WHERE bridge_account_id = ? AND status = 'claimed' AND claimed_at IS NOT NULL AND claimed_at < ?",
          "RETURNING id, kind, symbol, side, volume, sl, tp, entry_price, pending_order_ticket"
        ].join(" ")
      }),
      `MT5 reclaim stale ${bridgeAccountId}`
    );
    orders.push(...stale.rows.map((row) => rowToEaOrder(row as Record<string, unknown>)));
  }

  return orders;
}

const FINAL_STATUSES: ReadonlySet<string> = new Set(["filled", "rejected", "expired", "cancelled"]);

function normalizeResultStatus(status: string | undefined): Mt5OrderStatus {
  const value = status?.trim().toLowerCase();
  if (value === "filled") return "filled";
  if (value === "cancelled" || value === "canceled") return "cancelled";
  return "rejected";
}

export type Mt5OrderRow = {
  id: string;
  bridgeAccountId: string;
  status: Mt5OrderStatus;
  symbol: string;
  side: Mt5OrderSide;
  volume: number;
  sourceAlertId?: string;
  customTag?: string;
};

export async function getPendingOrderById(orderId: string): Promise<Mt5OrderRow | null> {
  const result = await withTursoTimeout(
    tursoClient().execute({
      args: [orderId],
      sql: "SELECT id, bridge_account_id, status, symbol, side, volume, source_alert_id, custom_tag FROM mt5_pending_orders WHERE id = ?"
    }),
    `MT5 order lookup ${orderId}`
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    bridgeAccountId: String(row.bridge_account_id),
    status: String(row.status) as Mt5OrderStatus,
    symbol: String(row.symbol),
    side: String(row.side) as Mt5OrderSide,
    volume: Number(row.volume),
    sourceAlertId: row.source_alert_id == null ? undefined : String(row.source_alert_id),
    customTag: row.custom_tag == null ? undefined : String(row.custom_tag)
  };
}

/**
 * Idempotent: records the EA's execution result. A second call for an already
 * finalized order is a no-op ({ skipped: true }).
 */
export async function recordOrderResult(
  orderId: string,
  body: Mt5OrderResultInput
): Promise<{ skipped: boolean; status?: Mt5OrderStatus }> {
  const status = normalizeResultStatus(body.status);
  const result = await withTursoTimeout(
    tursoClient().execute({
      args: [
        status,
        new Date().toISOString(),
        nullableNumber(body.brokerTicket),
        nullableNumber(body.fillPrice),
        nullableNumber(body.slippagePips),
        nullableNumber(body.commission),
        nullableNumber(body.swap),
        nullableNumber(body.retcode),
        nullableText(body.retcodeLabel),
        nullableText(body.errorMessage),
        orderId,
        ...Array.from(FINAL_STATUSES)
      ],
      sql: [
        "UPDATE mt5_pending_orders SET status = ?, result_at = ?, broker_ticket = ?, fill_price = ?,",
        "slippage_pips = ?, commission = ?, swap = ?, retcode = ?, retcode_label = ?, error_message = ?",
        `WHERE id = ? AND status NOT IN (${Array.from(FINAL_STATUSES).map(() => "?").join(", ")})`
      ].join(" ")
    }),
    `MT5 record result ${orderId}`
  );
  if (!result.rowsAffected || result.rowsAffected === 0) {
    return { skipped: true };
  }
  return { skipped: false, status };
}

export async function pushAccountState(bridgeAccountId: string, body: Mt5AccountStateInput): Promise<void> {
  await withTursoTimeout(
    tursoClient().execute({
      args: [
        bridgeAccountId,
        nullableText(body.bridgeStatus) ?? "connected",
        nullableNumber(body.balance),
        nullableNumber(body.equity),
        nullableNumber(body.margin),
        nullableNumber(body.freeMargin),
        nullableNumber(body.marginLevelPct),
        nullableNumber(body.floatingPnL),
        nullableNumber(body.openPositionCount),
        nullableText(body.lastError),
        new Date().toISOString()
      ],
      sql: [
        "INSERT INTO mt5_account_state",
        "(bridge_account_id, bridge_status, balance, equity, margin, free_margin, margin_level_pct, floating_pnl, open_position_count, last_error, updated_at)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        "ON CONFLICT (bridge_account_id) DO UPDATE SET",
        "bridge_status = excluded.bridge_status, balance = excluded.balance, equity = excluded.equity,",
        "margin = excluded.margin, free_margin = excluded.free_margin, margin_level_pct = excluded.margin_level_pct,",
        "floating_pnl = excluded.floating_pnl, open_position_count = excluded.open_position_count,",
        "last_error = excluded.last_error, updated_at = excluded.updated_at"
      ].join(" ")
    }),
    `MT5 push state ${bridgeAccountId}`
  );
}

export type Mt5FillInput = {
  ticket?: number;
  dealType?: number;
  symbol?: string;
  volume?: number;
  price?: number;
  profit?: number;
  commission?: number;
  swap?: number;
  reason?: number;
  positionTicket?: number;
};

export type Mt5FillReconcileResult = {
  matched: boolean;
  reason?: string;
  sourceAlertId?: string;
  customTag?: string;
  closeProfit?: number;
  closeStatus?: string;
};

// MT5 DEAL_REASON codes for closing deals.
function closeStatusFromReason(reason: number | undefined): string {
  switch (reason) {
    case 4:
      return "stop_loss";
    case 5:
      return "take_profit";
    case 6:
      return "stop_out";
    default:
      return "manual";
  }
}

/**
 * Reconcile an event-driven fill (SL/TP hit, manual close) onto its opening
 * order, storing realized close P&L. Correlates by position ticket == the
 * opening order's broker ticket. Idempotent: only the first close is recorded.
 * Opening deals (profit 0, not an SL/TP/SO close) are ignored.
 */
export async function recordFillEvent(bridgeAccountId: string, body: Mt5FillInput): Promise<Mt5FillReconcileResult> {
  const positionTicket = body.positionTicket;
  if (typeof positionTicket !== "number" || !Number.isFinite(positionTicket)) {
    return { matched: false, reason: "no position ticket" };
  }

  const profit = typeof body.profit === "number" && Number.isFinite(body.profit) ? body.profit : 0;
  const isClose = profit !== 0 || [4, 5, 6].includes(body.reason ?? -1);
  if (!isClose) {
    return { matched: false, reason: "opening or non-close deal" };
  }

  const closeStatus = closeStatusFromReason(body.reason);
  const result = await withTursoTimeout(
    tursoClient().execute({
      args: [
        profit,
        nullableNumber(body.price),
        nullableNumber(body.commission),
        nullableNumber(body.swap),
        closeStatus,
        new Date().toISOString(),
        bridgeAccountId,
        positionTicket
      ],
      sql: [
        "UPDATE mt5_pending_orders SET close_profit = ?, close_price = ?, close_commission = ?, close_swap = ?,",
        "close_reason = ?, closed_at = ?",
        "WHERE bridge_account_id = ? AND broker_ticket = ? AND status = 'filled' AND close_profit IS NULL",
        "RETURNING source_alert_id, custom_tag"
      ].join(" ")
    }),
    `MT5 reconcile fill ${bridgeAccountId}/${positionTicket}`
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    return { matched: false, reason: "no matching open order (or already reconciled)" };
  }
  return {
    matched: true,
    sourceAlertId: row.source_alert_id == null ? undefined : String(row.source_alert_id),
    customTag: row.custom_tag == null ? undefined : String(row.custom_tag),
    closeProfit: profit,
    closeStatus
  };
}

export async function upsertHeartbeat(bridgeAccountId: string, body: Mt5HeartbeatInput): Promise<void> {
  await withTursoTimeout(
    tursoClient().execute({
      args: [
        bridgeAccountId,
        nullableText(body.eaVersion) ?? "unknown",
        nullableNumber(body.terminalBuild),
        body.terminalConnected === false ? 0 : 1,
        body.tradeAllowed === false ? 0 : 1,
        nullableNumber(body.accountLogin),
        nullableText(body.accountServer),
        nullableText(body.lastError),
        new Date().toISOString()
      ],
      sql: [
        "INSERT INTO ea_heartbeats",
        "(bridge_account_id, ea_version, terminal_build, terminal_connected, trade_allowed, account_login, account_server, last_error, updated_at)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        "ON CONFLICT (bridge_account_id) DO UPDATE SET",
        "ea_version = excluded.ea_version, terminal_build = excluded.terminal_build,",
        "terminal_connected = excluded.terminal_connected, trade_allowed = excluded.trade_allowed,",
        "account_login = excluded.account_login, account_server = excluded.account_server,",
        "last_error = excluded.last_error, updated_at = excluded.updated_at"
      ].join(" ")
    }),
    `MT5 heartbeat ${bridgeAccountId}`
  );
}
