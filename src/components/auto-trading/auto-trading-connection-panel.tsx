"use client";

import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT,
  AUTO_TRADE_ACCESS_CODE_MAX_LENGTH,
  cleanAccessCode,
  savedAccountMode,
  type AutoTradeAccountMode
} from "@/components/auto-trading/auto-trade-account-mode";
import {
  autoTradeMarketLabel,
  autoTradeProviderFullyFunctioning,
  autoTradeProvidersForMarket,
  type AutoTradeMarket,
  type AutoTradeProvider,
  type AutoTradeProviderId
} from "@/lib/auto-trade-platforms";
import { onlyExecutedTradeHistoryRows } from "@/lib/executed-trade-history";
import type {
  ProjectXAccount,
  ProjectXConnectionStatus,
  ProjectXConnectionSummary,
  ProjectXOpenPosition,
  ProjectXOrder,
  ProjectXTrade
} from "@/lib/projectx";

const EMPTY_STATUS: ProjectXConnectionStatus = {
  accounts: [],
  connected: false
};

const ACCESS_CODE_MAX_LENGTH = AUTO_TRADE_ACCESS_CODE_MAX_LENGTH;
const FOLDER_UNLOCK_CODE_MAX_LENGTH = 5;

type SavedAutoTradeConnection = {
  accountId?: string;
  accountName?: string;
  checkedAt?: string;
  connected: boolean;
  connectedAt: string;
  eaConnectionId?: string;
  executionMode?: "credential_bridge" | "terminal_ea";
  firmId?: string;
  firmLabel?: string;
  id: string;
  paused: boolean;
  providerId: AutoTradeProviderId;
  providerLabel: string;
  storageMode?: "firebase" | "local" | "turso";
};

type AutoTradeTestStatus = "disabled" | "dry_run" | "failed" | "placed" | "skipped" | "success";

type AutoTradeTestOrder = {
  accountId?: number;
  accountName?: string;
  contractId?: string;
  contractName?: string;
  error?: string;
  orderId?: number;
  status?: AutoTradeTestStatus;
};

type AutoTradeTestResponse = {
  checkedAt?: string;
  contractId?: string;
  contractName?: string;
  error?: string;
  orderId?: number;
  orders?: AutoTradeTestOrder[];
  providerName?: string;
  status?: AutoTradeTestStatus;
  testMessage?: string;
  testStatus?: "success";
};

type AutoTradeTestState = {
  message: string;
  status: AutoTradeTestStatus | "running";
};

type ProjectXAccountDetails = {
  account: ProjectXAccount;
  checkedAt?: string;
  historyDays?: number;
  historyEnd?: string;
  historyStart?: string;
  openPositions: ProjectXOpenPosition[];
  orders: ProjectXOrder[];
  trades: ProjectXTrade[];
};

type ProjectXAccountDetailsState = {
  details?: ProjectXAccountDetails;
  error?: string;
  status: "failed" | "loaded" | "loading";
};

type ProjectXTone = "down" | "neutral" | "up" | "warn";

type ProjectXTradeHistoryRow = {
  badgeClass: "buy" | "neutral" | "sell";
  badgeLabel: string;
  closedAt?: string;
  contractId?: string;
  fees?: number;
  fills: number;
  key: string;
  openedAt?: string;
  orderIds: number[];
  priceLine: string;
  profitAndLoss?: number;
  resultDetail?: string;
  resultLabel: string;
  resultTone: ProjectXTone;
  size?: number;
  sortTime: number;
  statusClass: string;
  statusLabel: string;
};

type ConnectionField = {
  advanced?: boolean;
  defaultValue?: string;
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  secret?: boolean;
};

type PropFirmOption = {
  id: string;
  label: string;
  markets: AutoTradeMarket[];
  platformIds: AutoTradeProviderId[];
};

type FolderContextMenuState = {
  folder: ProjectXConnectionSummary;
  x: number;
  y: number;
};

type ProjectXFolderAction = "edit-password" | "delete" | "remove-account";

type PendingProjectXFolderAction = {
  action: ProjectXFolderAction;
  account?: ProjectXAccount;
  folder: ProjectXConnectionSummary;
};

const PROP_FIRM_OPTIONS: PropFirmOption[] = [
  { id: "topstep", label: "Topstep", markets: ["futures"], platformIds: ["projectx"] },
  { id: "apex", label: "Apex Trader Funding", markets: ["futures"], platformIds: ["tradovate", "rithmic"] },
  { id: "my-funded-futures", label: "MyFundedFutures", markets: ["futures"], platformIds: ["tradovate"] },
  { id: "take-profit-trader", label: "Take Profit Trader", markets: ["futures"], platformIds: ["tradovate", "rithmic"] },
  { id: "tradeify", label: "Tradeify", markets: ["futures"], platformIds: ["tradovate"] },
  { id: "elite-trader-funding", label: "Elite Trader Funding", markets: ["futures"], platformIds: ["tradovate"] },
  { id: "earn2trade", label: "Earn2Trade", markets: ["futures"], platformIds: ["tradovate", "rithmic"] },
  { id: "leeloo", label: "Leeloo Trading", markets: ["futures"], platformIds: ["rithmic"] },
  { id: "bulenox", label: "Bulenox", markets: ["futures"], platformIds: ["rithmic"] },
  { id: "oneup", label: "OneUp Trader", markets: ["futures"], platformIds: ["rithmic"] },
  { id: "atlas-funded", label: "Atlas Funded", markets: ["forex"], platformIds: ["mt5_ea", "matchtrader"] },
  { id: "e8", label: "E8 Markets", markets: ["forex"], platformIds: ["matchtrader", "ctrader", "mt5_ea"] },
  { id: "ftmo", label: "FTMO", markets: ["forex"], platformIds: ["mt5_ea", "ctrader"] },
  { id: "the5ers", label: "The5ers", markets: ["forex"], platformIds: ["mt5_ea", "ctrader"] },
  { id: "fundednext", label: "FundedNext", markets: ["forex"], platformIds: ["mt5_ea", "ctrader", "matchtrader"] },
  { id: "fundingpips", label: "FundingPips", markets: ["forex"], platformIds: ["mt5_ea", "ctrader", "matchtrader"] },
  { id: "funded-trading-plus", label: "Funded Trading Plus", markets: ["forex"], platformIds: ["mt5_ea", "ctrader", "matchtrader"] },
  { id: "alpha-capital", label: "Alpha Capital Group", markets: ["forex"], platformIds: ["mt5_ea", "ctrader"] },
  { id: "blue-guardian", label: "Blue Guardian", markets: ["forex"], platformIds: ["matchtrader", "mt5_ea"] },
  { id: "goat-funded-trader", label: "GOAT Funded Trader", markets: ["forex"], platformIds: ["ctrader", "matchtrader", "mt5_ea"] },
  { id: "brightfunded", label: "BrightFunded", markets: ["forex"], platformIds: ["mt5_ea", "ctrader"] },
  { id: "fxify", label: "FXIFY", markets: ["forex"], platformIds: ["mt5_ea"] },
  { id: "funderpro", label: "FunderPro", markets: ["forex"], platformIds: ["mt5_ea", "ctrader"] }
];

const CONNECTION_FIELDS: Record<AutoTradeProviderId, ConnectionField[]> = {
  projectx: [],
  mt5_ea: [
    { key: "login", label: "MT5 account login", placeholder: "12345678", required: true },
    { key: "password", label: "MT5 master password", placeholder: "Trading password", required: true, secret: true },
    { key: "server", label: "MT5 broker server", placeholder: "Broker-Server", required: true }
  ],
  ctrader: [
    { key: "accountId", label: "cTrader account ID", required: true },
    { key: "accessToken", label: "Access token", required: true, secret: true },
    { advanced: true, key: "refreshToken", label: "Refresh token", secret: true },
    { advanced: true, key: "accountSize", label: "Account size", placeholder: "50000" },
    { advanced: true, key: "bridgeUrl", label: "Bridge URL", placeholder: "https://your-ctrader-bridge/place-order" },
    { advanced: true, key: "bridgeSecret", label: "Bridge secret", secret: true },
    { advanced: true, key: "symbolMap", label: "Symbol map", placeholder: "EURUSD:1,XAUUSD:2" },
    { advanced: true, key: "sizeMap", label: "Size map", placeholder: "EURUSD:10000,XAUUSD:10" },
    { advanced: true, defaultValue: "1", key: "volumeStep", label: "Volume step", placeholder: "1" }
  ],
  matchtrader: [
    { key: "tradingApiToken", label: "Trading API token", required: true, secret: true },
    { advanced: true, key: "platformUrl", label: "Platform URL", placeholder: "https://platform.example.com" },
    { advanced: true, key: "systemUuid", label: "System UUID" },
    { advanced: true, key: "coAuthCookie", label: "co-auth cookie", secret: true },
    { advanced: true, key: "accountId", label: "Account ID" },
    { advanced: true, key: "accountSize", label: "Account size", placeholder: "50000" },
    { advanced: true, key: "symbolMap", label: "Symbol map", placeholder: "EURUSD:EURUSD,XAUUSD:GOLD" },
    { advanced: true, key: "sizeMap", label: "Size map", placeholder: "EURUSD:0.1,XAUUSD:0.05" },
    { advanced: true, defaultValue: "0.01", key: "volumeStep", label: "Volume step", placeholder: "0.01" }
  ],
  tradovate: [
    { key: "username", label: "Tradovate username", required: true },
    { key: "password", label: "Tradovate password", required: true, secret: true },
    { advanced: true, key: "accountId", label: "Account ID" },
    { advanced: true, key: "accountSpec", label: "Account spec" },
    { advanced: true, key: "accountSize", label: "Account size", placeholder: "50000" },
    { advanced: true, defaultValue: "TradingBot", key: "appId", label: "App ID", placeholder: "TradingBot" },
    { advanced: true, defaultValue: "1.0", key: "appVersion", label: "App version", placeholder: "1.0" },
    { advanced: true, key: "cid", label: "CID" },
    { advanced: true, key: "secret", label: "Secret", secret: true },
    { advanced: true, key: "apiBaseUrl", label: "API base URL", placeholder: "https://demo.tradovateapi.com/v1" },
    { advanced: true, key: "symbolMap", label: "Symbol map", placeholder: "ES:MESM6,NQ:MNQM6" },
    { advanced: true, key: "sizeMap", label: "Size map", placeholder: "ES:1,NQ:1" }
  ],
  rithmic: [
    { key: "login", label: "Rithmic user ID", placeholder: "LL000907", required: true },
    { key: "password", label: "Rithmic password", required: true, secret: true },
    { key: "accountId", label: "Rithmic account number", placeholder: "LL000907-003", required: true },
    { defaultValue: "Rithmic Paper Trading", key: "server", label: "System", placeholder: "Rithmic Paper Trading", required: true },
    { defaultValue: "Chicago", key: "gateway", label: "Gateway", placeholder: "Chicago", required: true },
    { advanced: true, key: "accountSize", label: "Account size", placeholder: "50000" },
    { advanced: true, key: "bridgeUrl", label: "Bridge URL", placeholder: "https://your-rithmic-bridge/place-order" },
    { advanced: true, key: "bridgeSecret", label: "Bridge secret", secret: true },
    { advanced: true, key: "symbolMap", label: "Symbol map", placeholder: "ES:MESM6,NQ:MNQM6" },
    { advanced: true, key: "sizeMap", label: "Size map", placeholder: "ES:1,NQ:1" }
  ]
};

function defaultConnectionFields(providerId: AutoTradeProviderId): Record<string, string> {
  return Object.fromEntries(
    (CONNECTION_FIELDS[providerId] ?? [])
      .filter((field) => field.defaultValue)
      .map((field) => [field.key, field.defaultValue!])
  );
}

function fmtMoney(value: number | undefined, signed = false): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0
  }).format(value);
  return signed && value > 0 ? `+${formatted}` : formatted;
}

function fmtTime(value: string | undefined): string {
  if (!value) return "Not checked yet";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZoneName: "short"
  }).format(new Date(value));
}

function fmtShortTime(value: string | undefined): string {
  if (!value) return "--";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "--";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(parsed));
}

function fmtNumber(value: number | undefined | null, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : Math.min(2, digits),
    maximumFractionDigits: digits
  }).format(value);
}

function fmtProjectXSide(side: number | undefined): string {
  if (side === 0) return "Buy";
  if (side === 1) return "Sell";
  return "--";
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function projectXAccountDetailKey(connectionId: string, accountId: number): string {
  return `${connectionId}:${accountId}`;
}

function projectXOrderId(order: Pick<ProjectXOrder, "id" | "orderId">): number | undefined {
  return finiteNumber(order.orderId ?? order.id);
}

function projectXTradeOrderId(trade: ProjectXTrade): number | undefined {
  return finiteNumber(trade.orderId);
}

function projectXTimestampMs(value: string | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function projectXTradeTimeMs(trade: ProjectXTrade): number {
  return projectXTimestampMs(trade.creationTimestamp);
}

function projectXOrderTimeMs(order: ProjectXOrder): number {
  return projectXTimestampMs(order.updateTimestamp ?? order.creationTimestamp);
}

function projectXEarlierTimestamp(current: string | undefined, next: string | undefined): string | undefined {
  if (!next) return current;
  if (!current) return next;
  return projectXTimestampMs(next) < projectXTimestampMs(current) ? next : current;
}

function projectXLaterTimestamp(current: string | undefined, next: string | undefined): string | undefined {
  if (!next) return current;
  if (!current) return next;
  return projectXTimestampMs(next) > projectXTimestampMs(current) ? next : current;
}

function projectXPositionSide(type: number | undefined): { className: "buy" | "neutral" | "sell"; label: string } {
  if (type === 1) return { className: "buy", label: "Long" };
  if (type === 2) return { className: "sell", label: "Short" };
  return { className: "neutral", label: "Open" };
}

function projectXTradeDirection(entrySide: number | undefined, exitSide: number | undefined): { className: "buy" | "neutral" | "sell"; label: string } {
  if (entrySide === 0 || (!Number.isFinite(entrySide) && exitSide === 1)) return { className: "buy", label: "Long" };
  if (entrySide === 1 || (!Number.isFinite(entrySide) && exitSide === 0)) return { className: "sell", label: "Short" };
  return { className: "neutral", label: "Trade" };
}

function projectXOrderStatusValue(status: ProjectXOrder["status"]): number | undefined {
  if (typeof status === "number" && Number.isFinite(status)) return status;
  if (typeof status !== "string") return undefined;
  const normalized = status.trim().toLowerCase();
  if (normalized === "open") return 1;
  if (normalized === "filled") return 2;
  if (normalized === "cancelled" || normalized === "canceled") return 3;
  if (normalized === "expired") return 4;
  if (normalized === "rejected") return 5;
  if (normalized === "pending") return 6;
  return undefined;
}

function projectXOrderStatusLabel(status: ProjectXOrder["status"]): string {
  const value = projectXOrderStatusValue(status);
  if (value === 1) return "Open";
  if (value === 2) return "Filled";
  if (value === 3) return "Cancelled";
  if (value === 4) return "Expired";
  if (value === 5) return "Rejected";
  if (value === 6) return "Pending";
  return typeof status === "string" && status.trim() ? status.trim() : "Unknown";
}

function projectXOrderBaseTag(order: Pick<ProjectXOrder, "customTag"> | undefined): string | undefined {
  let tag = order?.customTag?.trim() ?? "";
  if (!tag) return undefined;

  let changed = true;
  const suffixPatterns: RegExp[] = [/_pb$/i, /_r[0-9a-z]+$/i, /_u\d+$/i];
  while (changed) {
    changed = false;
    for (const pattern of suffixPatterns) {
      const nextTag = tag.replace(pattern, "");
      if (nextTag !== tag) {
        tag = nextTag;
        changed = true;
      }
    }
  }

  return tag;
}

function projectXTradeNetPnl(trade: ProjectXTrade): number | undefined {
  const profitAndLoss = finiteNumber(trade.profitAndLoss);
  if (profitAndLoss === undefined) return undefined;
  const fees = finiteNumber(trade.fees) ?? 0;
  return profitAndLoss - fees;
}

function projectXToneForAmount(value: number | undefined): ProjectXTone {
  if (value === undefined) return "neutral";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "neutral";
}

function projectXTradeRange(openedAt: string | undefined, closedAt: string | undefined): string {
  if (openedAt && closedAt && fmtShortTime(openedAt) !== fmtShortTime(closedAt)) {
    const opened = new Date(openedAt);
    const closed = new Date(closedAt);
    if (
      Number.isFinite(opened.getTime()) &&
      Number.isFinite(closed.getTime()) &&
      opened.toLocaleDateString() === closed.toLocaleDateString()
    ) {
      const closedTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(closed);
      return `${fmtShortTime(openedAt)} – ${closedTime}`;
    }
    return `${fmtShortTime(openedAt)} – ${fmtShortTime(closedAt)}`;
  }
  return fmtShortTime(closedAt ?? openedAt);
}

function projectXOrderLabel(orderIds: number[], fills: number): string {
  if (fills > 1) return `${fmtNumber(fills, 0)} fills`;
  if (orderIds.length === 1) return `order #${orderIds[0]}`;
  if (orderIds.length > 1) return `${fmtNumber(orderIds.length, 0)} orders`;
  return "ProjectX";
}

function projectXPriceLine(size: number | undefined, entryPrice: number | undefined, exitPrice: number | undefined): string {
  const sizeLabel = size !== undefined ? `${fmtNumber(size, 0)} @ ` : "";
  if (entryPrice !== undefined && exitPrice !== undefined) return `${sizeLabel}${fmtNumber(entryPrice, 5)} -> ${fmtNumber(exitPrice, 5)}`;
  if (exitPrice !== undefined) return `${sizeLabel}${fmtNumber(exitPrice, 5)}`;
  if (entryPrice !== undefined) return `${sizeLabel}${fmtNumber(entryPrice, 5)}`;
  return size !== undefined ? `${fmtNumber(size, 0)} contracts` : "Price unavailable";
}

function projectXRowsNetPnl(rows: ProjectXTradeHistoryRow[]): number | undefined {
  const pnls = rows.map((row) => row.profitAndLoss).filter((value): value is number => value !== undefined);
  if (!pnls.length) return undefined;
  return pnls.reduce((sum, value) => sum + value, 0);
}

function buildProjectXClosedTradeRows(trades: ProjectXTrade[], orders: ProjectXOrder[]): ProjectXTradeHistoryRow[] {
  type OpenFill = {
    orderBaseTag?: string;
    trade: ProjectXTrade;
  };
  type Aggregate = {
    badgeClass: "buy" | "neutral" | "sell";
    badgeLabel: string;
    closedAt?: string;
    contractId?: string;
    entryPriceSize: number;
    entryPriceTotal: number;
    exitPriceSize: number;
    exitPriceTotal: number;
    feesTotal: number;
    fills: number;
    hasFees: boolean;
    hasPnl: boolean;
    hasSize: boolean;
    key: string;
    openedAt?: string;
    orderIdSet: Set<number>;
    pnlTotal: number;
    sizeTotal: number;
    sortTime: number;
  };

  const orderById = new Map<number, ProjectXOrder>();
  for (const order of orders) {
    const id = projectXOrderId(order);
    if (id !== undefined) orderById.set(id, order);
  }

  const openFills = new Map<string, OpenFill[]>();
  const aggregates = new Map<string, Aggregate>();
  const rows: ProjectXTradeHistoryRow[] = [];
  const sortedTrades = [...trades].sort((left, right) => projectXTradeTimeMs(left) - projectXTradeTimeMs(right));

  for (const trade of sortedTrades) {
    const pnl = projectXTradeNetPnl(trade);
    const orderId = projectXTradeOrderId(trade);
    const order = orderId !== undefined ? orderById.get(orderId) : undefined;
    const orderBaseTag = projectXOrderBaseTag(order);
    const contractKey = trade.contractId ?? "unknown";

    if (trade.voided) {
      const direction = projectXTradeDirection(trade.side, undefined);
      const size = finiteNumber(trade.size);
      rows.push({
        badgeClass: direction.className,
        badgeLabel: direction.label === "Trade" ? fmtProjectXSide(trade.side) : direction.label,
        closedAt: trade.creationTimestamp,
        contractId: trade.contractId,
        fees: finiteNumber(trade.fees),
        fills: 1,
        key: `voided-${trade.id ?? orderId ?? `${contractKey}-${trade.creationTimestamp}`}`,
        openedAt: trade.creationTimestamp,
        orderIds: orderId !== undefined ? [orderId] : [],
        priceLine: projectXPriceLine(size, finiteNumber(trade.price), undefined),
        resultDetail: "Voided by ProjectX",
        resultLabel: "Voided",
        resultTone: "neutral",
        size,
        sortTime: projectXTradeTimeMs(trade),
        statusClass: "voided",
        statusLabel: "Voided"
      });
      continue;
    }

    if (pnl === undefined) {
      const bucket = openFills.get(contractKey) ?? [];
      bucket.push({ orderBaseTag, trade });
      openFills.set(contractKey, bucket);
      continue;
    }

    const bucket = openFills.get(contractKey) ?? [];
    let entryIndex = -1;
    for (let index = bucket.length - 1; index >= 0; index -= 1) {
      const candidate = bucket[index]?.trade;
      if (candidate && candidate.side !== trade.side) {
        entryIndex = index;
        break;
      }
    }
    const entryFill = entryIndex >= 0 ? bucket.splice(entryIndex, 1)[0] : undefined;
    if (bucket.length) openFills.set(contractKey, bucket);
    else openFills.delete(contractKey);

    const entry = entryFill?.trade;
    const direction = projectXTradeDirection(entry?.side, trade.side);
    const size = finiteNumber(trade.size) ?? finiteNumber(entry?.size);
    const fees = finiteNumber(trade.fees) ?? 0;
    const closeTime = projectXTradeTimeMs(trade);
    const closeMinute = Math.floor(closeTime / 60_000);
    const openMinute = entry ? Math.floor(projectXTradeTimeMs(entry) / 60_000) : "outside";
    const aggregateKey = orderBaseTag ?? entryFill?.orderBaseTag ?? `${contractKey}:${direction.label}:${openMinute}:${closeMinute}`;
    const key = `trade-${aggregateKey}`;
    const aggregate =
      aggregates.get(key) ??
      ({
        badgeClass: direction.className,
        badgeLabel: direction.label,
        closedAt: trade.creationTimestamp,
        contractId: trade.contractId ?? entry?.contractId,
        entryPriceSize: 0,
        entryPriceTotal: 0,
        exitPriceSize: 0,
        exitPriceTotal: 0,
        feesTotal: 0,
        fills: 0,
        hasFees: false,
        hasPnl: false,
        hasSize: false,
        key,
        openedAt: entry?.creationTimestamp ?? trade.creationTimestamp,
        orderIdSet: new Set<number>(),
        pnlTotal: 0,
        sizeTotal: 0,
        sortTime: closeTime
      } satisfies Aggregate);

    aggregate.badgeClass = direction.className;
    aggregate.badgeLabel = direction.label;
    aggregate.closedAt = projectXLaterTimestamp(aggregate.closedAt, trade.creationTimestamp);
    aggregate.contractId = aggregate.contractId ?? trade.contractId ?? entry?.contractId;
    aggregate.feesTotal += fees;
    aggregate.fills += 1;
    aggregate.hasFees = aggregate.hasFees || fees !== 0;
    aggregate.hasPnl = true;
    aggregate.openedAt = projectXEarlierTimestamp(aggregate.openedAt, entry?.creationTimestamp ?? trade.creationTimestamp);
    aggregate.pnlTotal += pnl;
    aggregate.sortTime = Math.max(aggregate.sortTime, closeTime);
    if (orderId !== undefined) aggregate.orderIdSet.add(orderId);
    const entryOrderId = entry ? projectXTradeOrderId(entry) : undefined;
    if (entryOrderId !== undefined) aggregate.orderIdSet.add(entryOrderId);
    if (size !== undefined) {
      aggregate.hasSize = true;
      aggregate.sizeTotal += size;
      const entryPrice = finiteNumber(entry?.price);
      const exitPrice = finiteNumber(trade.price);
      if (entryPrice !== undefined) {
        aggregate.entryPriceTotal += entryPrice * size;
        aggregate.entryPriceSize += size;
      }
      if (exitPrice !== undefined) {
        aggregate.exitPriceTotal += exitPrice * size;
        aggregate.exitPriceSize += size;
      }
    }

    aggregates.set(key, aggregate);
  }

  const closedRows = [...aggregates.values()].map((aggregate): ProjectXTradeHistoryRow => {
    const orderIds = [...aggregate.orderIdSet].sort((left, right) => left - right);
    const size = aggregate.hasSize ? aggregate.sizeTotal : undefined;
    const entryPrice = aggregate.entryPriceSize > 0 ? aggregate.entryPriceTotal / aggregate.entryPriceSize : undefined;
    const exitPrice = aggregate.exitPriceSize > 0 ? aggregate.exitPriceTotal / aggregate.exitPriceSize : undefined;
    const fees = aggregate.hasFees ? aggregate.feesTotal : undefined;
    const pnl = aggregate.hasPnl ? aggregate.pnlTotal : undefined;
    return {
      badgeClass: aggregate.badgeClass,
      badgeLabel: aggregate.badgeLabel,
      closedAt: aggregate.closedAt,
      contractId: aggregate.contractId,
      fees,
      fills: aggregate.fills,
      key: aggregate.key,
      openedAt: aggregate.openedAt,
      orderIds,
      priceLine: projectXPriceLine(size, entryPrice, exitPrice),
      profitAndLoss: pnl,
      resultDetail: fees !== undefined ? `fees ${fmtMoney(-Math.abs(fees), true)}` : projectXOrderLabel(orderIds, aggregate.fills),
      resultLabel: fmtMoney(pnl, true),
      resultTone: projectXToneForAmount(pnl),
      size,
      sortTime: aggregate.sortTime,
      statusClass: "closed",
      statusLabel: "Closed"
    };
  });

  return [...closedRows, ...rows];
}

function buildProjectXTradeHistoryRows(trades: ProjectXTrade[], orders: ProjectXOrder[]): ProjectXTradeHistoryRow[] {
  return onlyExecutedTradeHistoryRows(buildProjectXClosedTradeRows(trades, orders))
    .sort((left, right) => right.sortTime - left.sortTime)
    .slice(0, 40);
}

function firstProviderId(providers: AutoTradeProvider[]): AutoTradeProviderId {
  return providers.find((provider) => autoTradeProviderFullyFunctioning(provider.id))?.id ?? providers[0]!.id;
}

function propFirmsForMarket(market: AutoTradeMarket): PropFirmOption[] {
  return PROP_FIRM_OPTIONS.filter((firm) => firm.markets.includes(market));
}

function firmHasFullyFunctioningPath(firm: PropFirmOption, providers: AutoTradeProvider[]): boolean {
  const marketProviderIds = new Set(providers.map((provider) => provider.id));
  return firm.platformIds.some((providerId) => marketProviderIds.has(providerId) && autoTradeProviderFullyFunctioning(providerId));
}

function firstPropFirmId(market: AutoTradeMarket): string {
  const firms = propFirmsForMarket(market);
  return firms.find((firm) => firmHasFullyFunctioningPath(firm, autoTradeProvidersForMarket(market)))?.id ?? firms[0]?.id ?? PROP_FIRM_OPTIONS[0]!.id;
}

function accountStatusClass(account: ProjectXAccount): string {
  if (account.canTrade) return "status sent";
  if (!account.isVisible) return "status skipped";
  return "status failed";
}

function accountConnectionStatus(account: ProjectXAccount, autoTradePaused: boolean): { className: string; dotClassName: string; label: string } {
  if (!account.canTrade || !account.isVisible) return { className: "status failed", dotClassName: "statusDot red", label: "Disconnected" };
  if (autoTradePaused) return { className: "status skipped", dotClassName: "statusDot orange", label: "Paused" };
  return { className: accountStatusClass(account), dotClassName: "statusDot green", label: "Connected" };
}

function accountCountLabel(count: number): string {
  return `${count} account${count === 1 ? "" : "s"}`;
}

function loginNameFallback(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.includes("@") ? trimmed.split("@")[0] : trimmed;
}

function folderDisplayName(folder: ProjectXConnectionSummary): string {
  return folder.displayName?.trim() || loginNameFallback(folder.userName) || "ProjectX account";
}

function projectXFolderNeedsReconnect(folder: ProjectXConnectionSummary): boolean {
  return folder.status !== "connected" || !folder.readable;
}

async function parseConnectionResponse(response: Response): Promise<ProjectXConnectionStatus> {
  const payload = (await response.json().catch(() => EMPTY_STATUS)) as ProjectXConnectionStatus;
  if (!response.ok) {
    throw new Error(payload.error ?? "Auto-trade connection request failed.");
  }
  return payload;
}

async function parseSavedConnections(response: Response): Promise<{
  connections: SavedAutoTradeConnection[];
  error?: string;
  mt5ConnectionMode?: "credential_bridge" | "terminal_ea" | null;
}> {
  const payload = (await response.json().catch(() => ({ connections: [] }))) as {
    connections?: SavedAutoTradeConnection[];
    error?: string;
    mt5ConnectionMode?: "credential_bridge" | "terminal_ea" | null;
  };
  if (!response.ok) throw new Error(payload.error ?? "Auto-trade connection request failed.");
  return { connections: payload.connections ?? [], mt5ConnectionMode: payload.mt5ConnectionMode };
}

async function parseAutoTradeTestResponse(response: Response): Promise<AutoTradeTestResponse> {
  const payload = (await response.json().catch(() => ({}))) as AutoTradeTestResponse;
  if (!response.ok && !payload.status) throw new Error(payload.error ?? "Auto-trade test failed.");
  return payload;
}

async function parseProjectXAccountDetailsResponse(response: Response): Promise<ProjectXAccountDetails> {
  const payload = (await response.json().catch(() => ({}))) as Partial<ProjectXAccountDetails> & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "ProjectX account details failed.");
  return {
    account: payload.account!,
    checkedAt: payload.checkedAt,
    historyDays: payload.historyDays,
    historyEnd: payload.historyEnd,
    historyStart: payload.historyStart,
    openPositions: payload.openPositions ?? [],
    orders: payload.orders ?? [],
    trades: payload.trades ?? []
  };
}

function projectXTestKey(connectionId: string, accountId: number): string {
  return `projectx:${connectionId}:${accountId}`;
}

function providerTestKey(providerId: AutoTradeProviderId, connectionId: string): string {
  return `provider:${providerId}:${connectionId}`;
}

function autoTradeTestMessage(result: AutoTradeTestResponse): string {
  const order =
    result.orders?.find((item) => item.status === "placed") ??
    result.orders?.find((item) => item.status === "dry_run") ??
    result.orders?.find((item) => item.error) ??
    result.orders?.[0];
  const contract = order?.contractName ?? order?.contractId ?? result.contractName ?? result.contractId ?? "test order";
  const orderId = order?.orderId ?? result.orderId;

  if (result.testStatus === "success") return `${result.testMessage ?? "Success: opened with TP/SL and closed"}${orderId ? ` #${orderId}` : ""}`;
  if (result.status === "placed") return `Placed ${contract}${orderId ? ` #${orderId}` : ""}`;
  if (result.status === "dry_run") return `Dry run ${contract}`;
  if (result.status === "disabled") return result.error ?? "Auto-trade is disabled";
  if (result.status === "skipped") return result.error ?? order?.error ?? "Test skipped";
  if (result.status === "failed") return result.error ?? order?.error ?? "Test failed";
  return result.error ?? "Test finished";
}

function ProjectXEmptyDetailRow({ label }: { label: string }) {
  return <div className="topstepAccountDetailEmpty">{label}</div>;
}

function ProjectXAccountDetailPanel({ account, state }: { account: ProjectXAccount; state?: ProjectXAccountDetailsState }) {
  if (!state || state.status === "loading") {
    return (
      <div className="topstepAccountDetailPanel">
        <div className="topstepAccountDetailHead">
          <div>
            <span>Account activity</span>
            <strong>{account.name}</strong>
          </div>
          <small>Loading ProjectX activity...</small>
        </div>
      </div>
    );
  }

  if (state.status === "failed") {
    return (
      <div className="topstepAccountDetailPanel">
        <div className="topstepAccountDetailHead">
          <div>
            <span>Account activity</span>
            <strong>{account.name}</strong>
          </div>
          <small className="topstepAccountDetailError">{state.error ?? "Could not load account details."}</small>
        </div>
      </div>
    );
  }

  const details = state.details!;
  const tradeRows = buildProjectXTradeHistoryRows(details.trades, details.orders);
  const closedTradeCount = tradeRows.length;
  const netPnl = projectXRowsNetPnl(tradeRows);
  const netTone = projectXToneForAmount(netPnl);

  return (
    <div className="topstepAccountDetailPanel">
      <div className="topstepAccountDetailHead">
        <div>
          <span>Account activity</span>
          <strong>{details.account.name}</strong>
        </div>
        <small>
          {fmtNumber(details.openPositions.length, 0)} open / {fmtNumber(closedTradeCount, 0)} closed / {fmtNumber(details.historyDays, 0)}d / updated {fmtShortTime(details.checkedAt)}
        </small>
      </div>

      <section className="topstepAccountActivitySection" aria-label={`${details.account.name} open positions`}>
        <div className="topstepAccountActivitySectionHead">
          <span>Open positions</span>
          <strong>{details.openPositions.length ? `${fmtNumber(details.openPositions.length, 0)} open` : "Flat"}</strong>
        </div>
        <div className="topstepOpenPositionList">
          {details.openPositions.length ? (
            details.openPositions.map((position) => {
              const side = projectXPositionSide(position.type);
              const size = finiteNumber(position.size);
              const averagePrice = finiteNumber(position.averagePrice);
              return (
                <div className="topstepOpenPositionRow" key={`position-${position.id ?? `${position.contractId}-${position.creationTimestamp}`}`}>
                  <div className="topstepTradeHistoryMain">
                    <strong>{position.contractId ?? "--"}</strong>
                    <small>Opened {fmtShortTime(position.creationTimestamp)}</small>
                  </div>
                  <div className="topstepTradeHistoryMeta">
                    <div className="topstepTradePillRow">
                      <span className={`topstepTradeSide ${side.className}`}>{side.label}</span>
                      <span className="topstepTradeStatus open">Open</span>
                    </div>
                    <span>
                      {size !== undefined ? `${fmtNumber(size, 0)} contracts` : "Size unavailable"}
                      {averagePrice !== undefined ? ` @ ${fmtNumber(averagePrice, 5)}` : ""}
                    </span>
                  </div>
                  <div className="topstepTradeHistoryPnl">
                    <strong className="tone-neutral">Open</strong>
                    <small>{averagePrice !== undefined ? `avg ${fmtNumber(averagePrice, 5)}` : "avg price"}</small>
                  </div>
                </div>
              );
            })
          ) : (
            <ProjectXEmptyDetailRow label="No open positions" />
          )}
        </div>
      </section>

      <section className="topstepAccountActivitySection" aria-label={`${details.account.name} ProjectX trade history`}>
        <div className="topstepAccountActivitySectionHead">
          <span>Previous trades</span>
          <strong>{fmtNumber(closedTradeCount, 0)} closed</strong>
        </div>
        <div className="topstepTradeHistorySummary" aria-label={`${details.account.name} ProjectX trade summary`}>
          <span>Net closed P&L</span>
          <strong className={`tone-${netTone}`}>{fmtMoney(netPnl, true)}</strong>
        </div>

        <div className="topstepTradeHistoryList">
          {tradeRows.length ? (
            tradeRows.map((row) => (
              <div className="topstepTradeHistoryRow" key={row.key}>
                <div className="topstepTradeHistoryMain">
                  <strong>{row.contractId ?? "--"}</strong>
                  <small>
                    {projectXTradeRange(row.openedAt, row.closedAt)} · {projectXOrderLabel(row.orderIds, row.fills)}
                  </small>
                </div>
                <div className="topstepTradeHistoryMeta">
                  <div className="topstepTradePillRow">
                    <span className={`topstepTradeSide ${row.badgeClass}`}>{row.badgeLabel}</span>
                    <span className={`topstepTradeStatus ${row.statusClass}`}>{row.statusLabel}</span>
                  </div>
                  <span>{row.priceLine}</span>
                </div>
                <div className="topstepTradeHistoryPnl">
                  <strong className={`tone-${row.resultTone}`}>{row.resultLabel}</strong>
                  {row.resultDetail ? <small>{row.resultDetail}</small> : null}
                </div>
              </div>
            ))
          ) : (
            <ProjectXEmptyDetailRow label="No completed trades yet" />
          )}
        </div>
      </section>
    </div>
  );
}

type AutoTradingConnectionPanelProps = {
  market: AutoTradeMarket;
};

export default function AutoTradingConnectionPanel({ market }: AutoTradingConnectionPanelProps) {
  const providers = useMemo(() => autoTradeProvidersForMarket(market), [market]);
  const propFirms = useMemo(() => propFirmsForMarket(market), [market]);
  const [selectedFirmId, setSelectedFirmId] = useState(() => firstPropFirmId(market));
  const [selectedProviderId, setSelectedProviderId] = useState<AutoTradeProviderId>(() => firstProviderId(providers));
  const [userName, setUserName] = useState("");
  const [accountDisplayName, setAccountDisplayName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [projectXAccessCode, setProjectXAccessCode] = useState("");
  const [genericAccessCode, setGenericAccessCode] = useState("");
  const [status, setStatus] = useState<ProjectXConnectionStatus>(EMPTY_STATUS);
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [isChecking, setIsChecking] = useState(market === "futures");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isUpdatingPaused, setIsUpdatingPaused] = useState(false);
  const [isUnlockingFolder, setIsUnlockingFolder] = useState(false);
  const [accountMode, setAccountMode] = useState<AutoTradeAccountMode | null>(null);
  const [isAccountModeReady, setIsAccountModeReady] = useState(false);
  const [savedConnections, setSavedConnections] = useState<SavedAutoTradeConnection[]>([]);
  const [mt5ConnectionMode, setMt5ConnectionMode] = useState<"credential_bridge" | "terminal_ea" | null>(null);
  const [genericFields, setGenericFields] = useState<Record<string, string>>(() => defaultConnectionFields(selectedProviderId));
  const [activeProjectXFolderId, setActiveProjectXFolderId] = useState<string | null>(null);
  const [pendingProjectXFolder, setPendingProjectXFolder] = useState<ProjectXConnectionSummary | null>(null);
  const [pendingProjectXFolderAction, setPendingProjectXFolderAction] = useState<PendingProjectXFolderAction | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenuState | null>(null);
  const [folderCodeInput, setFolderCodeInput] = useState("");
  const [folderAccessError, setFolderAccessError] = useState("");
  const [folderActionCurrentCode, setFolderActionCurrentCode] = useState("");
  const [folderActionNewCode, setFolderActionNewCode] = useState("");
  const [folderActionError, setFolderActionError] = useState("");
  const [isSubmittingFolderAction, setIsSubmittingFolderAction] = useState(false);
  const [unlockedProjectXFolderIds, setUnlockedProjectXFolderIds] = useState<string[]>([]);
  const [unlockedProjectXFolderCodes, setUnlockedProjectXFolderCodes] = useState<Record<string, string>>({});
  const [reconnectProjectXConnectionId, setReconnectProjectXConnectionId] = useState<string | null>(null);
  const [autoTradeTests, setAutoTradeTests] = useState<Record<string, AutoTradeTestState>>({});
  const [selectedProjectXAccountKey, setSelectedProjectXAccountKey] = useState<string | null>(null);
  const [projectXAccountDetails, setProjectXAccountDetails] = useState<Record<string, ProjectXAccountDetailsState>>({});
  const folderCodeInputRef = useRef<HTMLInputElement | null>(null);
  const folderActionCurrentInputRef = useRef<HTMLInputElement | null>(null);

  const marketLabel = autoTradeMarketLabel(market);
  const selectedFirm = propFirms.find((firm) => firm.id === selectedFirmId) ?? propFirms[0]!;
  const platformOptions = selectedFirm.platformIds
    .map((providerId) => providers.find((provider) => provider.id === providerId))
    .filter((provider): provider is AutoTradeProvider => Boolean(provider));
  const selectedProvider = platformOptions.find((provider) => provider.id === selectedProviderId) ?? platformOptions[0] ?? providers[0]!;
  const selectedFirmReady = firmHasFullyFunctioningPath(selectedFirm, providers);
  const selectedProviderReady = autoTradeProviderFullyFunctioning(selectedProvider.id);
  const canConnectSelectedProvider = selectedProviderReady && selectedProvider.id === "projectx" && selectedProvider.status === "live" && market === "futures";
  const storageLabel = status.storageMode === "turso" ? "Turso" : status.storageMode === "firebase" ? "Firebase" : "local dev storage";
  const displayUserName = status.userName || userName || "--";
  const visibleAccounts = market === "futures" ? status.accounts : [];
  const projectXAccountFolders = useMemo<ProjectXConnectionSummary[]>(
    () =>
      market === "futures"
        ? status.connections?.length
          ? status.connections
          : visibleAccounts.length
            ? [
                {
                  accounts: visibleAccounts,
                  autoTradePaused: status.autoTradePaused,
                  connectedAt: status.checkedAt ?? new Date(0).toISOString(),
                  displayName: status.displayName ?? loginNameFallback(displayUserName),
                  id: `projectx-${displayUserName.toLowerCase()}`,
                  pausedAccountIds: status.pausedAccountIds,
                  readable: true,
                  status: "connected" as const,
                  updatedAt: status.checkedAt ?? new Date(0).toISOString(),
                  userName: displayUserName
                }
              ]
            : []
        : [],
    [displayUserName, market, status.autoTradePaused, status.checkedAt, status.connections, status.displayName, status.pausedAccountIds, visibleAccounts]
  );
  const visibleSavedConnections = savedConnections.filter((connection) => providers.some((provider) => provider.id === connection.providerId));
  const activeProjectXFolder = projectXAccountFolders.find((folder) => folder.id === activeProjectXFolderId);
  const selectedProviderFields = CONNECTION_FIELDS[selectedProvider.id] ?? [];
  const primaryProviderFields = selectedProviderFields.filter((field) => !field.advanced);
  const canManageAutoTrade = Boolean(accountMode);
  const canTestAutoTrade = Boolean(accountMode);

  useEffect(() => {
    function syncAccountMode() {
      const nextMode = savedAccountMode();
      setAccountMode(nextMode);
      if (!nextMode) {
        setIsAddingAccount(false);
        setReconnectProjectXConnectionId(null);
        setActiveProjectXFolderId(null);
        setPendingProjectXFolder(null);
        setPendingProjectXFolderAction(null);
        setFolderContextMenu(null);
        setFolderCodeInput("");
        setFolderAccessError("");
        setFolderActionCurrentCode("");
        setFolderActionNewCode("");
        setFolderActionError("");
        setUnlockedProjectXFolderIds([]);
        setUnlockedProjectXFolderCodes({});
        setAccountDisplayName("");
        setSelectedProjectXAccountKey(null);
        setProjectXAccountDetails({});
      }
    }

    syncAccountMode();
    setIsAccountModeReady(true);
    window.addEventListener(AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT, syncAccountMode);
    return () => window.removeEventListener(AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT, syncAccountMode);
  }, []);

  useEffect(() => {
    if (!propFirms.some((firm) => firm.id === selectedFirmId)) {
      setSelectedFirmId(firstPropFirmId(market));
    }
  }, [market, propFirms, selectedFirmId]);

  useEffect(() => {
    const nextFirm = propFirms.find((firm) => firm.id === selectedFirmId) ?? propFirms[0];
    const nextProviders = (nextFirm?.platformIds ?? [])
      .map((providerId) => providers.find((provider) => provider.id === providerId))
      .filter((provider): provider is AutoTradeProvider => Boolean(provider));
    if (!nextProviders.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(firstProviderId(nextProviders.length ? nextProviders : providers));
    }
  }, [providers, propFirms, selectedFirmId, selectedProviderId]);

  useEffect(() => {
    setIsAddingAccount(false);
    setReconnectProjectXConnectionId(null);
    setActiveProjectXFolderId(null);
    setPendingProjectXFolder(null);
    setPendingProjectXFolderAction(null);
    setFolderContextMenu(null);
    setFolderCodeInput("");
    setFolderAccessError("");
    setFolderActionCurrentCode("");
    setFolderActionNewCode("");
    setFolderActionError("");
    setUnlockedProjectXFolderIds([]);
    setUnlockedProjectXFolderCodes({});
    setProjectXAccessCode("");
    setGenericAccessCode("");
    setAccountDisplayName("");
    setSelectedProjectXAccountKey(null);
    setProjectXAccountDetails({});
    setSelectedFirmId(firstPropFirmId(market));
    setGenericFields(defaultConnectionFields(firstProviderId(providers)));
  }, [market]);

  useEffect(() => {
    if (activeProjectXFolderId && !projectXAccountFolders.some((folder) => folder.id === activeProjectXFolderId)) {
      setActiveProjectXFolderId(null);
    }
  }, [activeProjectXFolderId, projectXAccountFolders]);

  useEffect(() => {
    if (!pendingProjectXFolder || folderCodeInput.length !== FOLDER_UNLOCK_CODE_MAX_LENGTH || isUnlockingFolder) return;
    const frame = window.requestAnimationFrame(() => {
      void unlockProjectXFolder(folderCodeInput);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [folderCodeInput, isUnlockingFolder, pendingProjectXFolder]);

  useEffect(() => {
    setGenericFields(defaultConnectionFields(selectedProviderId));
  }, [selectedProviderId]);

  useEffect(() => {
    if (!pendingProjectXFolder) return;
    const frame = window.requestAnimationFrame(() => folderCodeInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [pendingProjectXFolder]);

  useEffect(() => {
    if (!pendingProjectXFolderAction) return;
    const frame = window.requestAnimationFrame(() => folderActionCurrentInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [pendingProjectXFolderAction]);

  useEffect(() => {
    if (!folderContextMenu) return;

    function closeMenu() {
      setFolderContextMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeMenu);
    };
  }, [folderContextMenu]);

  useEffect(() => {
    if (pendingProjectXFolder && !projectXAccountFolders.some((folder) => folder.id === pendingProjectXFolder.id)) {
      setPendingProjectXFolder(null);
      setFolderCodeInput("");
      setFolderAccessError("");
    }
  }, [pendingProjectXFolder, projectXAccountFolders]);

  useEffect(() => {
    if (selectedProjectXAccountKey && !projectXAccountFolders.some((folder) => folder.accounts.some((account) => projectXAccountDetailKey(folder.id, account.id) === selectedProjectXAccountKey))) {
      setSelectedProjectXAccountKey(null);
    }
  }, [projectXAccountFolders, selectedProjectXAccountKey]);

  useEffect(() => {
    if (pendingProjectXFolderAction && !projectXAccountFolders.some((folder) => folder.id === pendingProjectXFolderAction.folder.id)) {
      setPendingProjectXFolderAction(null);
      setFolderActionCurrentCode("");
      setFolderActionNewCode("");
      setFolderActionError("");
    }
  }, [pendingProjectXFolderAction, projectXAccountFolders]);

  function requestProjectXFolder(folder: ProjectXConnectionSummary) {
    if (accountMode === "Admin" || unlockedProjectXFolderIds.includes(folder.id)) {
      setPendingProjectXFolder(null);
      setPendingProjectXFolderAction(null);
      setActiveProjectXFolderId(folder.id);
      return;
    }

    setActiveProjectXFolderId(null);
    setPendingProjectXFolderAction(null);
    setPendingProjectXFolder(folder);
    setFolderCodeInput("");
    setFolderAccessError("");
  }

  function openProjectXFolderContextMenu(event: MouseEvent<HTMLElement>, folder: ProjectXConnectionSummary) {
    event.preventDefault();
    event.stopPropagation();
    if (!canManageAutoTrade) return;
    setFolderContextMenu({
      folder,
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 92)
    });
  }

  function handleProjectXFolderRightMouseDown(event: MouseEvent<HTMLElement>, folder: ProjectXConnectionSummary) {
    if (event.button !== 2) return;
    openProjectXFolderContextMenu(event, folder);
  }

  function requestProjectXFolderAction(action: ProjectXFolderAction, folder: ProjectXConnectionSummary, account?: ProjectXAccount) {
    setFolderContextMenu(null);
    setPendingProjectXFolder(null);
    setPendingProjectXFolderAction({ account, action, folder });
    setFolderActionCurrentCode("");
    setFolderActionNewCode("");
    setFolderActionError("");
  }

  function cancelProjectXFolderAction() {
    setPendingProjectXFolderAction(null);
    setFolderActionCurrentCode("");
    setFolderActionNewCode("");
    setFolderActionError("");
  }

  async function refreshSavedConnections() {
    try {
      const response = await fetch("/api/auto-trading/connections", { cache: "no-store" });
      const payload = await parseSavedConnections(response);
      setSavedConnections(payload.connections);
      setMt5ConnectionMode(payload.mt5ConnectionMode ?? null);
    } catch (error) {
      setStatus((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Auto-trade connection status check failed."
      }));
    }
  }

  async function refreshConnection() {
    if (market !== "futures") {
      setStatus(EMPTY_STATUS);
      setIsChecking(false);
      return;
    }

    setIsChecking(true);
    try {
      const response = await fetch("/api/topstep/connection", {
        method: "GET",
        cache: "no-store"
      });
      const nextStatus = await parseConnectionResponse(response);
      setStatus(nextStatus);
    } catch (error) {
      setStatus({
        accounts: [],
        connected: false,
        error: error instanceof Error ? error.message : "Auto-trade status check failed."
      });
    } finally {
      setIsChecking(false);
    }
  }

  useEffect(() => {
    void refreshConnection();
    void refreshSavedConnections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market]);

  useEffect(() => {
    if (!isChecking && !status.connected) setIsAddingAccount(false);
  }, [isChecking, status.connected]);

  async function handleConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canConnectSelectedProvider) return;

    setIsConnecting(true);
    try {
      const response = await fetch("/api/topstep/connection", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          accessCode: projectXAccessCode,
          apiKey,
          connectionId: reconnectProjectXConnectionId,
          displayName: accountDisplayName,
          userName
        })
      });
      const nextStatus = await parseConnectionResponse(response);
      setStatus(nextStatus);
      setApiKey("");
      setProjectXAccessCode("");
      setAccountDisplayName("");
      setReconnectProjectXConnectionId(null);
      setActiveProjectXFolderId(null);
      setPendingProjectXFolder(null);
      setPendingProjectXFolderAction(null);
      setFolderContextMenu(null);
      setUnlockedProjectXFolderIds([]);
      setUnlockedProjectXFolderCodes({});
      setSelectedProjectXAccountKey(null);
      setProjectXAccountDetails({});
      setIsAddingAccount(false);
    } catch (error) {
      setStatus({
        accounts: [],
        connected: false,
        error: error instanceof Error ? error.message : "Auto-trade connection failed."
      });
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleGenericConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProviderReady) return;

    setIsConnecting(true);
    try {
      const response = await fetch("/api/auto-trading/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessCode: genericAccessCode,
          accountId: selectedProvider.id === "mt5_ea" ? genericFields.login : genericFields.accountId,
          accountName: accountDisplayName,
          firmId: selectedFirm.id,
          firmLabel: selectedFirm.label,
          fields: genericFields,
          providerId: selectedProvider.id
        })
      });
      const payload = await parseSavedConnections(response);
      setSavedConnections(payload.connections);
      setMt5ConnectionMode(payload.mt5ConnectionMode ?? null);
      setGenericFields(defaultConnectionFields(selectedProvider.id));
      setGenericAccessCode("");
      setAccountDisplayName("");
      setIsAddingAccount(false);
    } catch (error) {
      setStatus((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Auto-trade connection failed."
      }));
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDisconnect(connectionId?: string) {
    setIsDisconnecting(true);
    try {
      const response = await fetch(connectionId ? `/api/topstep/connection?connectionId=${encodeURIComponent(connectionId)}` : "/api/topstep/connection", {
        method: "DELETE"
      });
      const nextStatus = await parseConnectionResponse(response);
      setStatus(nextStatus);
      setIsAddingAccount(false);
      setActiveProjectXFolderId(null);
      setPendingProjectXFolder(null);
      setUnlockedProjectXFolderIds((current) => (connectionId ? current.filter((id) => id !== connectionId) : []));
      setUnlockedProjectXFolderCodes((current) => {
        if (!connectionId) return {};
        const { [connectionId]: _removed, ...remaining } = current;
        return remaining;
      });
      setSelectedProjectXAccountKey(null);
      setProjectXAccountDetails((current) => {
        if (!connectionId) return {};
        return Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${connectionId}:`)));
      });
    } catch (error) {
      setStatus((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Auto-trade disconnect failed."
      }));
    } finally {
      setIsDisconnecting(false);
    }
  }

  async function handleProjectXFolderActionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingProjectXFolderAction || isSubmittingFolderAction) return;

    const currentCode = cleanAccessCode(folderActionCurrentCode, FOLDER_UNLOCK_CODE_MAX_LENGTH);
    if (currentCode.length !== FOLDER_UNLOCK_CODE_MAX_LENGTH) {
      setFolderActionError("Enter the current 5-digit folder password.");
      return;
    }

    const folder = pendingProjectXFolderAction.folder;
    const action = pendingProjectXFolderAction.action;
    const newCode = cleanAccessCode(folderActionNewCode, FOLDER_UNLOCK_CODE_MAX_LENGTH);
    if (action === "edit-password" && newCode.length !== FOLDER_UNLOCK_CODE_MAX_LENGTH) {
      setFolderActionError("Enter a new 5-digit folder password.");
      return;
    }

    setIsSubmittingFolderAction(true);
    setFolderActionError("");
    try {
      if (action === "edit-password") {
        const response = await fetch("/api/topstep/connection", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accessCode: currentCode,
            connectionId: folder.id,
            newAccessCode: newCode
          })
        });
        const nextStatus = await parseConnectionResponse(response);
        setStatus(nextStatus);
        setUnlockedProjectXFolderIds((current) => (current.includes(folder.id) ? current : [...current, folder.id]));
        setUnlockedProjectXFolderCodes((current) => ({ ...current, [folder.id]: newCode }));
        setActiveProjectXFolderId(folder.id);
      } else {
        const params = new URLSearchParams({ accessCode: currentCode, connectionId: folder.id });
        if (action === "remove-account" && pendingProjectXFolderAction.account) params.set("accountId", String(pendingProjectXFolderAction.account.id));
        const response = await fetch(`/api/topstep/connection?${params.toString()}`, { method: "DELETE" });
        const nextStatus = await parseConnectionResponse(response);
        setStatus(nextStatus);
        if (action === "remove-account") {
          setActiveProjectXFolderId(folder.id);
          setUnlockedProjectXFolderIds((current) => (current.includes(folder.id) ? current : [...current, folder.id]));
          setProjectXAccountDetails((current) => {
            if (!pendingProjectXFolderAction.account) return current;
            const { [projectXAccountDetailKey(folder.id, pendingProjectXFolderAction.account.id)]: _removed, ...remaining } = current;
            return remaining;
          });
          if (pendingProjectXFolderAction.account && selectedProjectXAccountKey === projectXAccountDetailKey(folder.id, pendingProjectXFolderAction.account.id)) {
            setSelectedProjectXAccountKey(null);
          }
        } else {
          setActiveProjectXFolderId(null);
          setUnlockedProjectXFolderIds((current) => current.filter((id) => id !== folder.id));
          setUnlockedProjectXFolderCodes((current) => {
            const { [folder.id]: _removed, ...remaining } = current;
            return remaining;
          });
          setProjectXAccountDetails((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${folder.id}:`))));
          setSelectedProjectXAccountKey(null);
        }
      }

      setPendingProjectXFolderAction(null);
      setFolderActionCurrentCode("");
      setFolderActionNewCode("");
    } catch (error) {
      setFolderActionCurrentCode("");
      setFolderActionError(error instanceof Error ? error.message : "Folder update failed.");
      window.requestAnimationFrame(() => folderActionCurrentInputRef.current?.focus());
    } finally {
      setIsSubmittingFolderAction(false);
    }
  }

  async function handleGenericDisconnect(connection: SavedAutoTradeConnection) {
    setIsDisconnecting(true);
    try {
      const params = new URLSearchParams({ connectionId: connection.id, providerId: connection.providerId });
      const response = await fetch(`/api/auto-trading/connections?${params.toString()}`, {
        method: "DELETE"
      });
      const payload = await parseSavedConnections(response);
      setSavedConnections(payload.connections);
      setMt5ConnectionMode(payload.mt5ConnectionMode ?? null);
    } catch (error) {
      setStatus((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Auto-trade disconnect failed."
      }));
    } finally {
      setIsDisconnecting(false);
    }
  }

  async function handleAutoTradePaused(accountId: number, nextPaused: boolean, connectionId?: string) {
    setIsUpdatingPaused(true);
    try {
      const response = await fetch("/api/topstep/connection", {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          accountId,
          autoTradePaused: nextPaused,
          connectionId
        })
      });
      const nextStatus = await parseConnectionResponse(response);
      setStatus(nextStatus);
    } catch (error) {
      setStatus((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Auto-trade status update failed."
      }));
    } finally {
      setIsUpdatingPaused(false);
    }
  }

  function handleProjectXReconnect(connectionId: string, login: string | undefined, displayName?: string) {
    setReconnectProjectXConnectionId(connectionId);
    setSelectedFirmId("topstep");
    setSelectedProviderId("projectx");
    setAccountDisplayName(displayName ?? loginNameFallback(login) ?? "");
    setUserName(login ?? "");
    setApiKey("");
    setProjectXAccessCode("");
    setActiveProjectXFolderId(null);
    setPendingProjectXFolder(null);
    setPendingProjectXFolderAction(null);
    setFolderContextMenu(null);
    setSelectedProjectXAccountKey(null);
    setProjectXAccountDetails((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${connectionId}:`))));
    setIsAddingAccount(true);
  }

  async function handleGenericPaused(connection: SavedAutoTradeConnection, nextPaused: boolean) {
    if (!autoTradeProviderFullyFunctioning(connection.providerId)) return;

    setIsUpdatingPaused(true);
    try {
      const response = await fetch("/api/auto-trading/connections", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: connection.id, paused: nextPaused, providerId: connection.providerId })
      });
      const payload = await parseSavedConnections(response);
      setSavedConnections(payload.connections);
      setMt5ConnectionMode(payload.mt5ConnectionMode ?? null);
    } catch (error) {
      setStatus((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Auto-trade status update failed."
      }));
    } finally {
      setIsUpdatingPaused(false);
    }
  }

  async function runAutoTradeTest(
    key: string,
    label: string,
    payload: { accountId?: number; connectionId?: string; providerId: AutoTradeProviderId }
  ) {
    if (!canTestAutoTrade || autoTradeTests[key]?.status === "running") return;
    const confirmed = window.confirm(`Send a live auto-trade test order with TP and SL to ${label}?`);
    if (!confirmed) return;

    setAutoTradeTests((current) => ({
      ...current,
      [key]: { message: "Testing...", status: "running" }
    }));

    try {
      const response = await fetch("/api/auto-trading/test", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await parseAutoTradeTestResponse(response);
      setAutoTradeTests((current) => ({
        ...current,
        [key]: {
          message: autoTradeTestMessage(result),
          status: result.testStatus === "success" ? "success" : result.status ?? (response.ok ? "placed" : "failed")
        }
      }));
    } catch (error) {
      setAutoTradeTests((current) => ({
        ...current,
        [key]: {
          message: error instanceof Error ? error.message : "Auto-trade test failed.",
          status: "failed"
        }
      }));
    }
  }

  function handleProjectXTest(folder: ProjectXConnectionSummary, account: ProjectXAccount) {
    void runAutoTradeTest(projectXTestKey(folder.id, account.id), `${account.name} (${account.id})`, {
      accountId: account.id,
      connectionId: folder.id,
      providerId: "projectx"
    });
  }

  async function handleProjectXAccountDetails(folder: ProjectXConnectionSummary, account: ProjectXAccount) {
    if (projectXFolderNeedsReconnect(folder)) return;

    const key = projectXAccountDetailKey(folder.id, account.id);
    setSelectedProjectXAccountKey(key);
    setProjectXAccountDetails((current) => ({
      ...current,
      [key]: {
        details: current[key]?.details,
        status: "loading"
      }
    }));

    try {
      const params = new URLSearchParams({
        accountId: String(account.id),
        connectionId: folder.id
      });
      const accessCode = unlockedProjectXFolderCodes[folder.id];
      if (accessCode) params.set("accessCode", accessCode);
      const response = await fetch(`/api/topstep/account?${params.toString()}`, {
        cache: "no-store",
        credentials: "same-origin"
      });
      const details = await parseProjectXAccountDetailsResponse(response);
      setProjectXAccountDetails((current) => ({
        ...current,
        [key]: {
          details,
          status: "loaded"
        }
      }));
    } catch (error) {
      setProjectXAccountDetails((current) => ({
        ...current,
        [key]: {
          error: error instanceof Error ? error.message : "ProjectX account details failed.",
          status: "failed"
        }
      }));
    }
  }

  function handleGenericTest(connection: SavedAutoTradeConnection) {
    void runAutoTradeTest(providerTestKey(connection.providerId, connection.id), connection.accountName ?? connection.accountId ?? connection.providerLabel, {
      connectionId: connection.id,
      providerId: connection.providerId
    });
  }

  async function unlockProjectXFolder(code = folderCodeInput) {
    if (!pendingProjectXFolder) return;
    const accessCode = cleanAccessCode(code, FOLDER_UNLOCK_CODE_MAX_LENGTH);
    if (!accessCode || isUnlockingFolder) return;

    setIsUnlockingFolder(true);
    setFolderAccessError("");
    try {
      const response = await fetch("/api/auto-trading/access-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessCode,
          connectionId: pendingProjectXFolder.id,
          type: "projectx"
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Incorrect code.");
      }

      setUnlockedProjectXFolderIds((current) => (current.includes(pendingProjectXFolder.id) ? current : [...current, pendingProjectXFolder.id]));
      setUnlockedProjectXFolderCodes((current) => ({ ...current, [pendingProjectXFolder.id]: accessCode }));
      setActiveProjectXFolderId(pendingProjectXFolder.id);
      setPendingProjectXFolder(null);
      setFolderCodeInput("");
    } catch (error) {
      setFolderCodeInput("");
      setFolderAccessError(error instanceof Error ? error.message : "Incorrect code.");
      window.requestAnimationFrame(() => folderCodeInputRef.current?.focus());
    } finally {
      setIsUnlockingFolder(false);
    }
  }

  function handleUnlockProjectXFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void unlockProjectXFolder();
  }

  const folderContextMenuElement =
    folderContextMenu && typeof document !== "undefined"
      ? createPortal(
          <div
            className="autoTradeFolderContextMenu"
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            role="menu"
            style={{ left: folderContextMenu.x, top: folderContextMenu.y }}
          >
            <button onClick={() => requestProjectXFolderAction("edit-password", folderContextMenu.folder)} role="menuitem" type="button">
              Edit Password
            </button>
            <button className="dangerButton" onClick={() => requestProjectXFolderAction("delete", folderContextMenu.folder)} role="menuitem" type="button">
              Delete Folder
            </button>
          </div>,
          document.body
        )
      : null;

  if (!isAccountModeReady) {
    return (
      <div className="topstepConnection">
        <div className="autoTradeGatePanel" />
      </div>
    );
  }

  if (!accountMode) {
    return (
      <div className="topstepConnection">
        <div className="topstepAccountEmpty autoTradeModeNotice">
          <strong>Choose account mode</strong>
          <span>Use the mode control above the market tabs to continue.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="topstepConnection">
      <div className="topstepConnectionActions topstepPrimaryActions">
        {isAddingAccount ? (
          <button type="button" onClick={() => {
            setReconnectProjectXConnectionId(null);
            setIsAddingAccount(false);
            setProjectXAccessCode("");
            setGenericAccessCode("");
            setAccountDisplayName("");
          }}>
            Back to Accounts
          </button>
        ) : pendingProjectXFolderAction ? (
          <button type="button" onClick={cancelProjectXFolderAction}>
            Back
          </button>
        ) : activeProjectXFolder ? (
          <>
            <button type="button" onClick={() => setActiveProjectXFolderId(null)}>
              Back to Folders
            </button>
            <button type="button" disabled={isChecking || isConnecting || market !== "futures"} onClick={() => refreshConnection()}>
              {isChecking ? "Checking..." : "Refresh"}
            </button>
          </>
        ) : pendingProjectXFolder ? (
          <button type="button" onClick={() => {
            setPendingProjectXFolder(null);
            setFolderCodeInput("");
            setFolderAccessError("");
          }}>
            Back to Folders
          </button>
        ) : (
          <>
            {canManageAutoTrade ? (
              <button
                type="button"
                disabled={market === "forex" && mt5ConnectionMode !== "credential_bridge"}
                onClick={() => {
                  setAccountDisplayName("");
                  setIsAddingAccount(true);
                }}
                title={market === "forex" && mt5ConnectionMode !== "credential_bridge" ? "Korra's central MT5 connection is being completed." : undefined}
              >
                {market === "forex" && mt5ConnectionMode !== "credential_bridge" ? "MT5 Setup Pending" : "Add Account"}
              </button>
            ) : null}
            <button type="button" disabled={isChecking || isConnecting || market !== "futures"} onClick={() => refreshConnection()}>
              {isChecking ? "Checking..." : "Refresh"}
            </button>
          </>
        )}
      </div>

      {isAddingAccount ? (
        <div className="autoTradeAddAccount">
          <div className="autoTradeSelectGrid">
            <label className="autoTradeSelectControl">
              <span>Prop firm</span>
              <select className={selectedFirmReady ? undefined : "is-muted"} value={selectedFirm.id} onChange={(event) => setSelectedFirmId(event.target.value)}>
                {propFirms.map((firm) => {
                  const isReady = firmHasFullyFunctioningPath(firm, providers);
                  return (
                    <option disabled={!isReady} key={firm.id} value={firm.id}>
                      {isReady ? firm.label : `${firm.label} - limited`}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="autoTradeSelectControl">
              <span>Platform</span>
              <select className={selectedProviderReady ? undefined : "is-muted"} value={selectedProvider.id} onChange={(event) => setSelectedProviderId(event.target.value as AutoTradeProviderId)}>
                {platformOptions.map((provider) => {
                  const isReady = autoTradeProviderFullyFunctioning(provider.id);
                  return (
                    <option disabled={!isReady} key={provider.id} value={provider.id}>
                      {isReady ? provider.shortLabel : `${provider.shortLabel} - limited`}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>

          {selectedFirm.id === "atlas-funded" ? (
            <div className="mt5ConnectNotice">
              <strong>Atlas Funded automation rules</strong>
              <span>
                Atlas Funded permits EAs and automated strategies, but prohibits trades held for less than three minutes,
                HFT or latency exploitation, account sharing, and copying between different traders. Only connect an Atlas
                account you personally own. {" "}
                <a href="https://help.atlasfunded.com/en/articles/9904237-what-are-the-prohibited-trading-activities-at-atlas-funded" rel="noreferrer" target="_blank">
                  Review the official rules
                </a>
                .
              </span>
            </div>
          ) : null}

          {canConnectSelectedProvider ? (
            <form className="topstepConnectForm" onSubmit={handleConnect}>
              <label>
                <span>Folder name</span>
                <input
                  autoComplete="organization-title"
                  name="projectx-folder-name"
                  onChange={(event) => setAccountDisplayName(event.target.value)}
                  placeholder="Foofs"
                  required
                  type="text"
                  value={accountDisplayName}
                />
              </label>
              <label>
                <span>TopstepX username</span>
                <input
                  autoComplete="username"
                  name="projectx-user-name"
                  onChange={(event) => setUserName(event.target.value)}
                  placeholder="trader@example.com"
                  required
                  type="text"
                  value={userName}
                />
              </label>
              <label>
                <span>ProjectX API key</span>
                <input
                  autoComplete="off"
                  name="projectx-api-key"
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="Paste API key"
                  required
                  type="password"
                  value={apiKey}
                />
              </label>
              <label>
                <span>Folder code</span>
                <input
                  autoComplete="new-password"
                  inputMode="numeric"
                  maxLength={ACCESS_CODE_MAX_LENGTH}
                  name="projectx-folder-code"
                  onChange={(event) => setProjectXAccessCode(cleanAccessCode(event.target.value))}
                  pattern="[0-9]{5}"
                  placeholder="5 digits"
                  required
                  type="password"
                  value={projectXAccessCode}
                />
              </label>
              <button type="submit" disabled={isConnecting}>
                {isConnecting ? "Connecting..." : reconnectProjectXConnectionId ? "Reconnect" : "Connect Account"}
              </button>
            </form>
          ) : selectedProviderReady && selectedProviderFields.length ? (
            <form className="topstepConnectForm" onSubmit={handleGenericConnect}>
              {selectedProvider.id === "mt5_ea" ? (
                <div className="mt5ConnectNotice">
                  <strong>Use the MT5 credentials from {selectedFirm.label}</strong>
                  <span>
                    {mt5ConnectionMode === "credential_bridge"
                      ? "Enter the login number, master trading password, and exact broker server. Korra handles the connection centrally—there is nothing to download or install."
                      : "Korra's central MT5 connection is being completed. You will not need to download an EA or configure a Connection ID."}
                    {mt5ConnectionMode === "credential_bridge" ? " Do not use the investor or read-only password." : ""}
                  </span>
                </div>
              ) : null}
              {selectedProvider.id !== "mt5_ea" ? (
                <label>
                  <span>Account name</span>
                  <input
                    autoComplete="organization-title"
                    name={`${selectedProvider.id}-account-name`}
                    onChange={(event) => setAccountDisplayName(event.target.value)}
                    placeholder={`${selectedFirm.label} account`}
                    required
                    type="text"
                    value={accountDisplayName}
                  />
                </label>
              ) : null}
              {primaryProviderFields.map((field) => (
                  <label key={field.key}>
                    <span>{field.label}</span>
                    <input
                      autoComplete={field.secret ? "off" : undefined}
                      inputMode={selectedProvider.id === "mt5_ea" && field.key === "login" ? "numeric" : undefined}
                      name={`${selectedProvider.id}-${field.key}`}
                      onChange={(event) =>
                        setGenericFields((current) => ({
                          ...current,
                          [field.key]: event.target.value
                        }))
                      }
                      placeholder={field.placeholder}
                      pattern={selectedProvider.id === "mt5_ea" && field.key === "login" ? "[0-9]+" : undefined}
                      required={field.required}
                      type={field.secret ? "password" : "text"}
                      value={genericFields[field.key] ?? ""}
                    />
                  </label>
                ))}
              <label>
                <span>{selectedProvider.id === "mt5_ea" ? "Korra security code" : "Account code"}</span>
                <input
                  autoComplete="new-password"
                  inputMode="numeric"
                  maxLength={ACCESS_CODE_MAX_LENGTH}
                  name={`${selectedProvider.id}-account-code`}
                  onChange={(event) => setGenericAccessCode(cleanAccessCode(event.target.value))}
                  pattern="[0-9]{5}"
                  placeholder="5 digits"
                  required
                  type="password"
                  value={genericAccessCode}
                />
              </label>
              <button
                type="submit"
                disabled={isConnecting || (selectedProvider.id === "mt5_ea" && mt5ConnectionMode !== "credential_bridge")}
              >
                {isConnecting
                  ? "Connecting..."
                  : selectedProvider.id === "mt5_ea"
                    ? mt5ConnectionMode === "credential_bridge" ? "Connect MT5 Account" : "MT5 Connection Pending"
                    : "Connect Account"}
              </button>
            </form>
          ) : (
            <div className="topstepAccountEmpty autoTradeUnavailable">
              <strong>{selectedProvider.label} is not fully functioning yet</strong>
              <span>ProjectX / TopstepX and MT5 are enabled for production auto-trading.</span>
            </div>
          )}
        </div>
      ) : (
        <div className="topstepAccountList" aria-live="polite">
          {pendingProjectXFolderAction ? (
            <form className="autoTradeFolderGate autoTradeFolderActionGate" onSubmit={handleProjectXFolderActionSubmit}>
              <div>
                <span>
                  {pendingProjectXFolderAction.action === "edit-password"
                    ? "Edit folder password"
                    : pendingProjectXFolderAction.action === "remove-account"
                      ? "Remove account"
                      : "Delete folder"}
                </span>
                <strong>{folderDisplayName(pendingProjectXFolderAction.folder)}</strong>
                {pendingProjectXFolderAction.account ? <span>{pendingProjectXFolderAction.account.name}</span> : null}
              </div>
              <label>
                <span>Current password</span>
                <input
                  autoComplete="current-password"
                  inputMode="numeric"
                  maxLength={FOLDER_UNLOCK_CODE_MAX_LENGTH}
                  onChange={(event) => {
                    setFolderActionCurrentCode(cleanAccessCode(event.target.value, FOLDER_UNLOCK_CODE_MAX_LENGTH));
                    setFolderActionError("");
                  }}
                  pattern="[0-9]*"
                  ref={folderActionCurrentInputRef}
                  required
                  type="password"
                  value={folderActionCurrentCode}
                />
              </label>
              {pendingProjectXFolderAction.action === "edit-password" ? (
                <label>
                  <span>New password</span>
                  <input
                    autoComplete="new-password"
                    inputMode="numeric"
                    maxLength={FOLDER_UNLOCK_CODE_MAX_LENGTH}
                    onChange={(event) => {
                      setFolderActionNewCode(cleanAccessCode(event.target.value, FOLDER_UNLOCK_CODE_MAX_LENGTH));
                      setFolderActionError("");
                    }}
                    pattern="[0-9]*"
                    required
                    type="password"
                    value={folderActionNewCode}
                  />
                </label>
              ) : null}
              {folderActionError ? <small>{folderActionError}</small> : null}
              <div className="autoTradeFolderActionButtons">
                <button type="button" disabled={isSubmittingFolderAction} onClick={cancelProjectXFolderAction}>
                  Cancel
                </button>
                <button className={pendingProjectXFolderAction.action !== "edit-password" ? "dangerButton" : undefined} type="submit" disabled={isSubmittingFolderAction}>
                  {isSubmittingFolderAction
                    ? "Checking..."
                    : pendingProjectXFolderAction.action === "edit-password"
                      ? "Update Password"
                      : pendingProjectXFolderAction.action === "remove-account"
                        ? "Remove Account"
                        : "Delete Folder"}
                </button>
              </div>
            </form>
          ) : projectXAccountFolders.length === 0 && visibleSavedConnections.length === 0 ? (
            <div className="topstepAccountEmpty">
              <strong>No accounts connected</strong>
            </div>
          ) : pendingProjectXFolder ? (
            <form className="autoTradeFolderGate" onClick={() => folderCodeInputRef.current?.focus()} onSubmit={handleUnlockProjectXFolder}>
              <div>
                <span>Locked folder</span>
                <strong>{folderDisplayName(pendingProjectXFolder)}</strong>
              </div>
              <div className="autoTradeFolderPinField">
                <span>Folder code</span>
                <input
                  autoFocus
                  className="autoTradePinHidden"
                  autoComplete="current-password"
                  inputMode="numeric"
                  maxLength={FOLDER_UNLOCK_CODE_MAX_LENGTH}
                  onChange={(event) => {
                    const nextValue = cleanAccessCode(event.target.value, FOLDER_UNLOCK_CODE_MAX_LENGTH);
                    setFolderCodeInput(nextValue);
                    setFolderAccessError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Backspace" && folderCodeInput.length === 0) {
                      setPendingProjectXFolder(null);
                      setFolderAccessError("");
                    }
                  }}
                  pattern="[0-9]*"
                  ref={folderCodeInputRef}
                  required
                  type="password"
                  value={folderCodeInput}
                />
                <div className="autoTradePinGrid autoTradeCompactPinGrid" aria-hidden>
                  {Array.from({ length: FOLDER_UNLOCK_CODE_MAX_LENGTH }, (_, index) => {
                    const digit = folderCodeInput[index] ?? "";
                    const isActiveSlot = folderCodeInput.length === index && folderCodeInput.length < FOLDER_UNLOCK_CODE_MAX_LENGTH;
                    return (
                      <span
                        className={`autoTradePinBox${digit ? " filled" : ""}${isActiveSlot ? " active" : ""}`}
                        key={`projectx-folder-pin-${index + 1}`}
                      >
                        {digit}
                      </span>
                    );
                  })}
                </div>
              </div>
              {folderAccessError ? <small>{folderAccessError}</small> : null}
            </form>
          ) : activeProjectXFolder ? (
            <div
              className="topstepAccountFolderPage"
              onContextMenu={(event) => openProjectXFolderContextMenu(event, activeProjectXFolder)}
              onMouseDown={(event) => handleProjectXFolderRightMouseDown(event, activeProjectXFolder)}
            >
              <div className="topstepFolderPageHead">
                <div>
                  <span>Name</span>
                  <strong>{folderDisplayName(activeProjectXFolder)}</strong>
                </div>
                <div>
                  <span>Provider</span>
                  <strong>ProjectX</strong>
                </div>
                <div>
                  <span>Platform</span>
                  <strong>TopstepX / Futures</strong>
                </div>
                <div>
                  <span>Accounts</span>
                  <strong>{accountCountLabel(activeProjectXFolder.accounts.length)}</strong>
                </div>
              </div>
              <div className="topstepFolderAccounts">
                {activeProjectXFolder.accounts.map((account) => {
                  const folderPausedAccountIds = new Set(activeProjectXFolder.pausedAccountIds ?? activeProjectXFolder.accounts.map((item) => item.id));
                  const accountPaused = folderPausedAccountIds.has(account.id);
                  const testKey = projectXTestKey(activeProjectXFolder.id, account.id);
                  const testState = autoTradeTests[testKey];
                  const isTesting = testState?.status === "running";
                  const needsReconnect = projectXFolderNeedsReconnect(activeProjectXFolder);
                  const connectionStatus = needsReconnect
                    ? { className: "status failed", dotClassName: "statusDot red", label: "Reconnect" }
                    : accountConnectionStatus(account, accountPaused);
                  const detailKey = projectXAccountDetailKey(activeProjectXFolder.id, account.id);
                  const detailState = projectXAccountDetails[detailKey];
                  const detailSelected = selectedProjectXAccountKey === detailKey;
                  return (
                    <div className={`topstepAccountRow isNested topstepAccountRowInteractive${detailSelected ? " isSelected" : ""}`} key={`projectx-${account.id}`}>
                      <button
                        aria-expanded={detailSelected}
                        className="topstepAccountFields topstepAccountFieldsButton"
                        onClick={() => void handleProjectXAccountDetails(activeProjectXFolder, account)}
                        title="View ProjectX trade history, orders, and open positions"
                        type="button"
                      >
                        <span className="topstepAccountField">
                          <span>Account number</span>
                          <strong>{account.id}</strong>
                        </span>
                        <span className="topstepAccountField">
                          <span>Account name</span>
                          <strong>{account.name}</strong>
                        </span>
                        <span className="topstepAccountField">
                          <span>Balance</span>
                          <strong>{fmtMoney(account.balance)}</strong>
                        </span>
                        <span className="topstepAccountField">
                          <span>Status</span>
                          <strong className={`topstepStatusValue ${connectionStatus.className}`}>
                            <span aria-hidden="true" className={connectionStatus.dotClassName} />
                            {connectionStatus.label}
                          </strong>
                        </span>
                      </button>
                      {canManageAutoTrade ? (
                        <div className="topstepAccountControls">
                          <button
                            className={needsReconnect ? "testButton" : accountPaused ? "playButton" : "pauseButton"}
                            type="button"
                            disabled={isUpdatingPaused || isDisconnecting}
                            onClick={() =>
                              needsReconnect
                                ? handleProjectXReconnect(activeProjectXFolder.id, activeProjectXFolder.userName, folderDisplayName(activeProjectXFolder))
                                : handleAutoTradePaused(account.id, !accountPaused, activeProjectXFolder.id)
                            }
                          >
                            {isUpdatingPaused ? "Updating..." : needsReconnect ? "Reconnect" : accountPaused ? "Play" : "Pause"}
                          </button>
                          {canTestAutoTrade ? (
                            <button
                              className="testButton"
                              type="button"
                              disabled={isTesting || isDisconnecting || isUpdatingPaused || accountPaused || needsReconnect}
                              onClick={() => handleProjectXTest(activeProjectXFolder, account)}
                              title={
                                needsReconnect
                                  ? "Reconnect this ProjectX account before testing."
                                  : accountPaused
                                    ? "Resume this account before testing."
                                    : "Send a live TP/SL test order."
                              }
                            >
                              {isTesting ? "Testing..." : "Test"}
                            </button>
                          ) : null}
                          <button
                            className="dangerButton"
                            type="button"
                            disabled={isDisconnecting}
                            onClick={() => requestProjectXFolderAction("remove-account", activeProjectXFolder, account)}
                          >
                            Remove Account
                          </button>
                          {testState ? <small className={`topstepAccountTestResult ${testState.status}`}>{testState.message}</small> : null}
                        </div>
                      ) : null}
                      {detailSelected ? <ProjectXAccountDetailPanel account={account} state={detailState} /> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              {projectXAccountFolders.map((folder) => (
                <button
                  className="topstepAccountFolderButton"
                  key={folder.id}
                  onClick={() => requestProjectXFolder(folder)}
                  onContextMenu={(event) => openProjectXFolderContextMenu(event, folder)}
                  onMouseDown={(event) => handleProjectXFolderRightMouseDown(event, folder)}
                  type="button"
                >
                  <span className="topstepFolderIcon" aria-hidden="true" />
                  <div className="topstepFolderIdentity">
                    <span>Name</span>
                    <strong>{folderDisplayName(folder)}</strong>
                  </div>
                  <div className="topstepFolderMeta provider">
                    <span>Provider</span>
                    <strong>ProjectX</strong>
                  </div>
                  <div className="topstepFolderMeta platform">
                    <span>Platform</span>
                    <strong>TopstepX / Futures</strong>
                  </div>
                </button>
              ))}
              {visibleSavedConnections.map((connection) => {
                const provider = providers.find((item) => item.id === connection.providerId);
                const connectionReady = autoTradeProviderFullyFunctioning(connection.providerId);
                const managedConnectionReady = connectionReady && (
                  connection.providerId !== "mt5_ea" || connection.executionMode === "credential_bridge"
                );
                const testKey = providerTestKey(connection.providerId, connection.id);
                const testState = autoTradeTests[testKey];
                const isTesting = testState?.status === "running";
                return (
                  <div className={`topstepAccountRow${connectionReady ? "" : " autoTradeDisabledRow"}`} key={connection.id}>
                    <div className="topstepAccountFields">
                      <div>
                        <span>Firm</span>
                        <strong>{connection.firmLabel ?? "--"}</strong>
                      </div>
                      <div>
                        <span>Provider</span>
                        <strong>{connection.providerLabel}</strong>
                      </div>
                      <div>
                        <span>Platform</span>
                        <strong>{provider?.shortLabel ?? connection.providerId}</strong>
                      </div>
                      <div>
                        <span>Account</span>
                        <strong>{connection.accountName ?? connection.accountId ?? "--"}</strong>
                      </div>
                      <div>
                        <span>{connection.providerId === "mt5_ea" ? "MT5 Login" : "Account ID"}</span>
                        <strong>{connection.eaConnectionId ?? connection.accountId ?? "--"}</strong>
                      </div>
                      <div>
                        <span>Saved</span>
                        <strong>{fmtTime(connection.checkedAt ?? connection.connectedAt)}</strong>
                      </div>
                      <div>
                        <span>Status</span>
                        <strong className={`topstepStatusValue status ${managedConnectionReady ? (connection.paused ? "skipped" : "sent") : "skipped"}`}>
                          <span aria-hidden="true" className={managedConnectionReady ? (connection.paused ? "statusDot orange" : "statusDot green") : "statusDot gray"} />
                          {managedConnectionReady ? (connection.paused ? "Paused" : "Connected") : connection.providerId === "mt5_ea" ? "Central setup pending" : "Limited"}
                        </strong>
                      </div>
                    </div>
                    {canManageAutoTrade ? (
                      <div className="topstepAccountControls">
                        {managedConnectionReady ? (
                          <>
                            <button
                              className={connection.paused ? "playButton" : "pauseButton"}
                              type="button"
                              disabled={isUpdatingPaused || isDisconnecting}
                              onClick={() => handleGenericPaused(connection, !connection.paused)}
                            >
                              {isUpdatingPaused ? "Updating..." : connection.paused ? "Play" : "Pause"}
                            </button>
                            {canTestAutoTrade ? (
                              <button
                                className="testButton"
                                type="button"
                                disabled={isTesting || isUpdatingPaused || isDisconnecting || connection.paused}
                                onClick={() => handleGenericTest(connection)}
                                title={connection.paused ? "Resume this account before testing." : "Send a live TP/SL test order."}
                              >
                                {isTesting ? "Testing..." : "Test"}
                              </button>
                            ) : null}
                          </>
                        ) : null}
                        <button className="dangerButton" type="button" disabled={isDisconnecting} onClick={() => handleGenericDisconnect(connection)}>
                          {isDisconnecting ? "Removing..." : "Remove"}
                        </button>
                        {testState ? <small className={`topstepAccountTestResult ${testState.status}`}>{testState.message}</small> : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {folderContextMenuElement}

      <div className="topstepConnectionFoot">
        <span>
          {status.persisted && market === "futures" ? `${fmtTime(status.checkedAt)} / saved in ${storageLabel}` : `${marketLabel} view`}
        </span>
        {status.error ? <strong>{status.error}</strong> : null}
      </div>
    </div>
  );
}
