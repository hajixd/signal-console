import type { Mt5OrderRow, Mt5OrderStatus } from "@/lib/mt5-ea-queue";
import { getTrade, saveTrade } from "@/lib/storage";
import type { AutoTradeOrderSummary } from "@/lib/types";

/**
 * Reflect an EA execution result back onto the source alert so the dashboard /
 * "executed" accounting reflects reality:
 *   - A real fill keeps the order `placed` and stamps the broker ticket.
 *   - A reject downgrades the order to `failed` (so it is no longer counted as
 *     a placed/executed trade — it was only ever enqueued).
 *
 * Best-effort: never throw into the EA result path. The queue row is always the
 * authoritative execution record; this is the human-facing mirror.
 */
export async function reflectMt5ResultOnAlert(
  orderRow: Mt5OrderRow,
  result: { status: Mt5OrderStatus; brokerTicket?: number; errorMessage?: string }
): Promise<void> {
  if (!orderRow.sourceAlertId || !orderRow.customTag) return;

  const alert = await getTrade(orderRow.sourceAlertId);
  if (!alert) return;

  const orders = alert.autoTradeOrders ?? [];
  const index = orders.findIndex((order) => order.customTag === orderRow.customTag);
  if (index < 0) return;

  const now = new Date().toISOString();
  const filled = result.status === "filled";
  const updatedOrder: AutoTradeOrderSummary = {
    ...orders[index],
    status: filled ? "placed" : "failed",
    resultCheckedAt: now,
    ...(filled && typeof result.brokerTicket === "number" ? { orderId: result.brokerTicket } : {}),
    ...(!filled && result.errorMessage ? { resultError: result.errorMessage } : {})
  };
  const updatedOrders = orders.map((order, i) => (i === index ? updatedOrder : order));
  const anyPlaced = updatedOrders.some((order) => order.status === "placed");

  await saveTrade({
    ...alert,
    autoTradeOrders: updatedOrders,
    autoTradeStatus: anyPlaced ? "placed" : "failed",
    ...(filled ? {} : { autoTradeError: result.errorMessage ?? alert.autoTradeError })
  });
}

/**
 * Reflect a reconciled close (SL/TP hit, manual close) onto the alert's order
 * summary as realized net P&L. Best-effort mirror; the order row is canonical.
 */
export async function reflectMt5CloseOnAlert(params: {
  sourceAlertId?: string;
  customTag?: string;
  netPnlDollars: number;
}): Promise<void> {
  if (!params.sourceAlertId || !params.customTag) return;

  const alert = await getTrade(params.sourceAlertId);
  if (!alert) return;

  const orders = alert.autoTradeOrders ?? [];
  const index = orders.findIndex((order) => order.customTag === params.customTag);
  if (index < 0) return;

  const updatedOrder: AutoTradeOrderSummary = {
    ...orders[index],
    netPnlDollars: params.netPnlDollars,
    resultCheckedAt: new Date().toISOString()
  };
  const updatedOrders = orders.map((order, i) => (i === index ? updatedOrder : order));

  await saveTrade({ ...alert, autoTradeOrders: updatedOrders });
}
