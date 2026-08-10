export type ExecutedTradeHistoryCandidate = {
  profitAndLoss?: number;
  statusClass?: string;
};

export function onlyExecutedTradeHistoryRows<T extends ExecutedTradeHistoryCandidate>(rows: T[]): T[] {
  return rows.filter(
    (row) => row.statusClass === "closed" && typeof row.profitAndLoss === "number" && Number.isFinite(row.profitAndLoss)
  );
}
