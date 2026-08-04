-- MT5 EA fill reconciliation: realized close P&L per order.
-- Populated from /ea/fills events (SL/TP hit, manual close), correlated to the
-- opening order by position ticket. Lets the dashboard show real per-trade P&L.

ALTER TABLE mt5_pending_orders ADD COLUMN close_profit REAL;
ALTER TABLE mt5_pending_orders ADD COLUMN close_price REAL;
ALTER TABLE mt5_pending_orders ADD COLUMN close_commission REAL;
ALTER TABLE mt5_pending_orders ADD COLUMN close_swap REAL;
ALTER TABLE mt5_pending_orders ADD COLUMN close_reason TEXT;
ALTER TABLE mt5_pending_orders ADD COLUMN closed_at TEXT;
