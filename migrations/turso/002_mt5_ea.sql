-- MT5 EA execution: pull-based order queue + EA telemetry.
-- The MT5 Expert Advisor polls /ea/orders/pending, executes via OrderSend,
-- and reports back to /ea/orders/result. State + heartbeat are pushed by the EA.

CREATE TABLE IF NOT EXISTS mt5_pending_orders (
  id TEXT PRIMARY KEY,
  bridge_account_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'market',
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  volume REAL NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'market',
  entry_price REAL,
  sl REAL,
  tp REAL,
  pending_order_ticket INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  source_alert_id TEXT,
  custom_tag TEXT,
  risk_usd REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at TEXT,
  result_at TEXT,
  expires_at TEXT,
  broker_ticket INTEGER,
  fill_price REAL,
  slippage_pips REAL,
  commission REAL,
  swap REAL,
  retcode INTEGER,
  retcode_label TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_mt5_pending_orders_account_status
  ON mt5_pending_orders (bridge_account_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_mt5_pending_orders_status_expiry
  ON mt5_pending_orders (status, expires_at);

-- Dedupe guard: one queued/active order per source alert per account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mt5_pending_orders_alert_dedupe
  ON mt5_pending_orders (bridge_account_id, source_alert_id, custom_tag);

CREATE TABLE IF NOT EXISTS mt5_account_state (
  bridge_account_id TEXT PRIMARY KEY,
  bridge_status TEXT,
  balance REAL,
  equity REAL,
  margin REAL,
  free_margin REAL,
  margin_level_pct REAL,
  floating_pnl REAL,
  open_position_count INTEGER,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ea_heartbeats (
  bridge_account_id TEXT PRIMARY KEY,
  ea_version TEXT,
  terminal_build INTEGER,
  terminal_connected INTEGER,
  trade_allowed INTEGER,
  account_login INTEGER,
  account_server TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
