"use client";

import { useCallback, useState } from "react";
import { useLoad } from "@/hooks/useLoad";
import {
  listDeposits,
  listPayoutAddresses,
  listPayoutDrains,
  listTransfers,
  type DepositResult,
  type PayoutDrainResult,
  type TransferResult,
} from "@/lib/bridgeRampApi";
import { hasBackendUrl } from "@/config/env";
import { getAddress } from "viem";
import { getBaseRpcUrls, HOME_STABLECOINS } from "@/lib/baseChain";
import { PORTFOLIO_TOKENS } from "@/lib/portfolioTokens";
import { SAFE_TX_SERVICE_URL } from "@/lib/safeTxService";
import {
  WalletTransferHistory,
  type TransferLogRow,
  type TransferLogToken,
} from "@/lib/chain/walletTransfers";

export type ActivitySource = "chain" | "fiat_deposit" | "crypto_deposit" | "fiat_withdraw";
export type ActivityDirection = "in" | "out" | "self";

export interface WalletActivity {
  id: string;
  source: ActivitySource;
  hash: string;
  timestamp: string;
  direction: ActivityDirection;
  title: string;
  subtitle: string;
  tokenSymbol: string;
  amount: number;
  pending?: boolean;
  statusLabel?: string;
}

/** One ERC-20 transfer, in the Etherscan-style shape `mapChainTransfer` was written for. */
interface ChainTransfer {
  hash: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  tokenSymbol: string | null;
  tokenDecimal: string | null;
  contractAddress: string;
}

/** History detail: keep loading month segments until at least this many rows (or exhausted). */
export const HISTORY_MIN_INITIAL = 30;
const HISTORY_MAX_MONTHS = 36;
const CHAIN_PAGE_SIZE = 100;

function parseAmount(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function truncateAddr(address: string): string {
  if (!address || address.length < 10) return address || "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function statusLabel(state: string): string {
  const map: Record<string, string> = {
    funds_scheduled: "Scheduled",
    funds_received: "Converting",
    in_review: "In review",
    payment_submitted: "On its way",
    payment_processed: "Completed",
    awaiting_funds: "Awaiting funds",
    refunded: "Refunded",
    returned: "Returned",
    error: "Failed",
    canceled: "Canceled",
    undeliverable: "Undeliverable",
  };
  return map[state] ?? state.replace(/_/g, " ");
}

function mapChainTransfer(tx: ChainTransfer, address: string): WalletActivity {
  const me = address.toLowerCase();
  const from = (tx.from ?? "").toLowerCase();
  const to = (tx.to ?? "").toLowerCase();
  let direction: ActivityDirection = "in";
  if (from === me && to === me) direction = "self";
  else if (from === me) direction = "out";

  const decimals = tx.tokenDecimal ? parseInt(tx.tokenDecimal, 10) : 18;
  const amount =
    parseFloat(tx.value ?? "0") / Math.pow(10, Number.isFinite(decimals) ? decimals : 18);
  const ts = parseInt(tx.timeStamp ?? "", 10);
  const timestamp = Number.isFinite(ts)
    ? new Date(ts * 1000).toISOString()
    : new Date().toISOString();
  const counterparty = direction === "out" ? tx.to : tx.from;
  const symbol = tx.tokenSymbol ?? "TOKEN";

  return {
    id: `chain-${tx.hash}-${tx.contractAddress}-${tx.value}`,
    source: "chain",
    hash: tx.hash,
    timestamp,
    direction,
    title: direction === "in" ? "Received" : direction === "out" ? "Sent" : "Converted",
    subtitle: `${symbol} · ${truncateAddr(counterparty)}`,
    tokenSymbol: symbol,
    amount,
  };
}

/**
 * Tokens the RPC log scan looks for: everything the app shows a balance for.
 * (The Safe Transaction Service, which serves most of the history, lists every token.)
 */
const HISTORY_TOKENS: TransferLogToken[] = (() => {
  const byAddress = new Map<string, TransferLogToken>();
  for (const t of HOME_STABLECOINS) {
    byAddress.set(t.address.toLowerCase(), {
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
    });
  }
  for (const t of PORTFOLIO_TOKENS) {
    if (!t.baseAddress || t.trackBalance === false) continue;
    const key = t.baseAddress.toLowerCase();
    if (!byAddress.has(key)) {
      byAddress.set(key, {
        address: t.baseAddress,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
      });
    }
  }
  return [...byAddress.values()];
})();

function checksum(address: string): string {
  try {
    return getAddress(address);
  } catch {
    return address;
  }
}

/** On-chain history source — see lib/chain/walletTransfers.ts for what it covers. */
function createTransferHistory(address: string): WalletTransferHistory {
  return new WalletTransferHistory({
    address: checksum(address),
    tokens: HISTORY_TOKENS,
    rpcUrls: getBaseRpcUrls(),
    safeServiceUrl: SAFE_TX_SERVICE_URL,
  });
}

function activityFromRow(row: TransferLogRow, address: string): WalletActivity {
  return mapChainTransfer(
    {
      hash: row.hash,
      timeStamp: String(row.timestamp),
      from: checksum(row.from),
      to: checksum(row.to),
      value: row.value,
      tokenSymbol: row.token.symbol,
      tokenDecimal: String(row.token.decimals),
      contractAddress: row.token.address,
    },
    address,
  );
}

/** Home / treasury preview — the most recent transfers. */
async function fetchChainTokenTxs(address: string): Promise<WalletActivity[]> {
  const page = await createTransferHistory(address).nextPage(40);
  return page.rows.map((row) => activityFromRow(row, address));
}

function depositToActivity(d: DepositResult): WalletActivity {
  const currency = (d.currency ?? "usd").toUpperCase();
  const net = parseAmount(d.netAmount);
  const gross = parseAmount(d.amount);
  const amount = net || gross;
  return {
    id: `fiat-deposit-${d.depositId ?? d.createdAt}`,
    source: "fiat_deposit",
    hash: d.destinationTxHash ?? "",
    timestamp: d.createdAt,
    direction: "in",
    title: "Fiat deposit",
    subtitle: d.senderName
      ? `${d.senderName}${d.accountLast4 ? ` ···${d.accountLast4}` : ""}`
      : `${currency}${d.paymentRail ? ` · ${d.paymentRail.replace(/_/g, " ")}` : ""}`,
    tokenSymbol: "USDC",
    amount,
    pending: !d.completed,
    statusLabel: statusLabel(d.status),
  };
}

function transferToActivity(t: TransferResult): WalletActivity | null {
  if (t.direction === "offramp") return null;
  const currency = (t.sourceCurrency ?? "usd").toUpperCase();
  const complete = t.state === "payment_processed";
  const terminal = ["returned", "refunded", "error", "canceled"].includes(t.state);
  if (t.direction === "crypto") {
    return {
      id: `crypto-deposit-${t.bridgeTransferId}`,
      source: "crypto_deposit",
      hash: "",
      timestamp: t.createdAt,
      direction: "in",
      title: "Crypto deposit",
      subtitle: `${currency} → ${(t.destinationCurrency ?? "usdc").toUpperCase()}`,
      tokenSymbol: currency,
      amount: parseAmount(t.amount),
      pending: !complete && !terminal,
      statusLabel: statusLabel(t.state),
    };
  }
  return {
    id: `onramp-transfer-${t.bridgeTransferId}`,
    source: "fiat_deposit",
    hash: "",
    timestamp: t.createdAt,
    direction: "in",
    title: "Fiat deposit",
    subtitle: currency,
    tokenSymbol: "USDC",
    amount: parseAmount(t.amount),
    pending: !complete && !terminal,
    statusLabel: statusLabel(t.state),
  };
}

function drainToActivity(drain: PayoutDrainResult): WalletActivity {
  const complete = drain.state === "payment_processed";
  const terminal = ["undeliverable", "returned", "refunded", "error", "canceled"].includes(
    drain.state,
  );
  const fiat = (drain.destination?.currency ?? drain.currency ?? "usd").toUpperCase();
  return {
    id: `fiat-withdraw-${drain.bridgeDrainId ?? drain.drainId ?? drain.createdAt}`,
    source: "fiat_withdraw",
    hash: drain.depositTxHash ?? "",
    timestamp: drain.createdAt,
    direction: "out",
    title: "Fiat withdrawal",
    subtitle: `${fiat}${drain.destination?.last4 ? ` ···${drain.destination.last4}` : ""}`,
    tokenSymbol: "USDC",
    amount: parseAmount(drain.amount),
    pending: !complete && !terminal,
    statusLabel: statusLabel(drain.state),
  };
}

async function fetchBridgeActivities(): Promise<WalletActivity[]> {
  if (!hasBackendUrl()) return [];
  const rows: WalletActivity[] = [];
  try {
    const deposits = await listDeposits();
    rows.push(...deposits.map(depositToActivity));
  } catch {
    /* Bridge may be unavailable for this user */
  }
  try {
    const transfers = await listTransfers();
    for (const t of transfers) {
      const row = transferToActivity(t);
      if (row) rows.push(row);
    }
  } catch {
    /* optional */
  }
  try {
    const payouts = await listPayoutAddresses();
    const drainBatches = await Promise.all(
      payouts.map(async (p) => {
        try {
          const drains = await listPayoutDrains(p.bridgeLiquidationAddressId);
          return drains.map((d) => drainToActivity(d));
        } catch {
          return [] as WalletActivity[];
        }
      }),
    );
    rows.push(...drainBatches.flat());
  } catch {
    /* optional */
  }
  return rows;
}

function mergeActivities(bridge: WalletActivity[], chain: WalletActivity[]): WalletActivity[] {
  const bridgeHashes = new Set(
    bridge.map((b) => b.hash.toLowerCase()).filter((h) => h.length > 0),
  );
  const filteredChain = chain.filter((c) => !bridgeHashes.has(c.hash.toLowerCase()));
  return [...bridge, ...filteredChain].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

function dedupeById(rows: WalletActivity[]): WalletActivity[] {
  const seen = new Set<string>();
  const out: WalletActivity[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/** Calendar month window. monthsAgo=0 is current month through now. */
export function monthWindow(monthsAgo: number): { startMs: number; endMs: number; label: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
  const endExclusive =
    monthsAgo === 0
      ? new Date(now.getTime() + 1)
      : new Date(now.getFullYear(), now.getMonth() - monthsAgo + 1, 1);
  return {
    startMs: start.getTime(),
    endMs: endExclusive.getTime(),
    label: start.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  };
}

function inMonth(iso: string, startMs: number, endMs: number): boolean {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= startMs && t < endMs;
}

/**
 * Pages on-chain history newest→oldest so month windows can filter locally.
 */
class ChainTxCursor {
  private address: string;
  private history: WalletTransferHistory;
  private buffer: WalletActivity[] = [];
  /** History is complete back to this time; null until the source says. */
  private coveredBackToMs: number | null = null;
  exhausted = false;

  constructor(address: string) {
    this.address = address;
    this.history = createTransferHistory(address);
  }

  /** Load pages until history is complete back to `oldestNeededMs`, or runs out. */
  async ensureThrough(oldestNeededMs: number): Promise<void> {
    while (!this.exhausted) {
      if (this.coveredBackToMs !== null && this.coveredBackToMs < oldestNeededMs) return;

      let page;
      try {
        page = await this.history.nextPage(CHAIN_PAGE_SIZE);
      } catch (error) {
        // Provider messages mean nothing to the user; keep the detail for debugging.
        console.warn("[WalletActivity] Failed to load transfers", error);
        throw new Error("Could not load on-chain activity. Try again in a moment.");
      }

      this.buffer = dedupeById([
        ...this.buffer,
        ...page.rows.map((row) => activityFromRow(row, this.address)),
      ]);
      // A page can be empty while older blocks remain, so go by what the source
      // says it has covered rather than by the rows it returned.
      if (page.coveredBackToMs !== null) this.coveredBackToMs = page.coveredBackToMs;
      if (!page.hasMore) this.exhausted = true;
    }
  }

  inRange(startMs: number, endMs: number): WalletActivity[] {
    return this.buffer.filter((r) => inMonth(r.timestamp, startMs, endMs));
  }
}

const NO_ACTIVITY: WalletActivity[] = [];

export function useWalletActivity(smartAddress: string | null) {
  const { data, fetching, error, refresh } = useLoad({
    key: ["wallet", "activity", smartAddress?.toLowerCase() ?? null],
    load: async () => {
      const chainPromise = smartAddress
        ? fetchChainTokenTxs(smartAddress).catch(() => [] as WalletActivity[])
        : Promise.resolve([] as WalletActivity[]);
      const bridgePromise = fetchBridgeActivities().catch(() => [] as WalletActivity[]);
      const [chain, bridge] = await Promise.all([chainPromise, bridgePromise]);
      return mergeActivities(bridge, chain);
    },
    errorMessage: "Failed to load activity",
    enabled: Boolean(smartAddress) || hasBackendUrl(),
    refreshMs: 45_000,
  });

  return { activities: data ?? NO_ACTIVITY, loading: fetching, error, refresh };
}

/** Sources of one history load. The chain cursor only caches pages it has read. */
interface HistorySession {
  bridge: WalletActivity[];
  chain: ChainTxCursor | null;
}

/** Rows loaded so far, and where the next page continues. */
interface HistoryPage {
  activities: WalletActivity[];
  monthsLoaded: number;
  emptyStreak: number;
  hasMore: boolean;
}

interface HistoryLoad extends HistoryPage {
  /** Distinguishes one initial load from the next, so later pages never mix. */
  loadId: number;
  session: HistorySession;
}

let nextHistoryLoadId = 0;

async function loadMonthSegment(
  session: HistorySession,
  monthsAgo: number,
): Promise<WalletActivity[]> {
  const { startMs, endMs } = monthWindow(monthsAgo);
  const bridgeMonth = session.bridge.filter((r) => inMonth(r.timestamp, startMs, endMs));

  let chainMonth: WalletActivity[] = [];
  if (session.chain) {
    await session.chain.ensureThrough(startMs);
    chainMonth = session.chain.inRange(startMs, endMs);
  }

  return mergeActivities(bridgeMonth, chainMonth);
}

const EMPTY_HISTORY: HistoryPage = { activities: [], monthsLoaded: 0, emptyStreak: 0, hasMore: true };

/**
 * Fetch month segments after `from`, until `enough` says so or the history runs
 * out. Returns a new page; `from` is left as it was.
 */
async function extendHistory(
  session: HistorySession,
  from: HistoryPage,
  enough: (rows: WalletActivity[], addedRows: boolean) => boolean,
): Promise<HistoryPage> {
  let local = from.activities;
  let monthsAgo = from.monthsLoaded;
  let emptyStreak = from.emptyStreak;
  let more = true;
  let addedRows = false;

  while (monthsAgo < HISTORY_MAX_MONTHS && !enough(local, addedRows)) {
    const batch = await loadMonthSegment(session, monthsAgo);
    monthsAgo += 1;

    if (batch.length === 0) {
      emptyStreak += 1;
      const chainDone = !session.chain || session.chain.exhausted;
      if ((emptyStreak >= 3 && chainDone) || emptyStreak >= 6) {
        more = false;
        break;
      }
      continue;
    }

    emptyStreak = 0;
    addedRows = true;
    local = dedupeById(
      [...local, ...batch].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      ),
    );
  }

  if (monthsAgo >= HISTORY_MAX_MONTHS) more = false;

  return {
    activities: local,
    monthsLoaded: monthsAgo,
    emptyStreak,
    hasMore: more && monthsAgo < HISTORY_MAX_MONTHS,
  };
}

async function loadInitialHistory(smartAddress: string | null): Promise<HistoryLoad> {
  const session: HistorySession = {
    bridge: await fetchBridgeActivities().catch(() => [] as WalletActivity[]),
    chain: smartAddress ? new ChainTxCursor(smartAddress) : null,
  };
  const page = await extendHistory(
    session,
    EMPTY_HISTORY,
    (rows) => rows.length >= HISTORY_MIN_INITIAL,
  );
  nextHistoryLoadId += 1;
  return { ...page, session, loadId: nextHistoryLoadId };
}

/**
 * All-history loader: one calendar month per segment.
 * Initial load keeps fetching months until ≥ HISTORY_MIN_INITIAL rows (or exhausted = load all).
 */
export function useWalletActivityHistory(smartAddress: string | null) {
  const enabled = Boolean(smartAddress) || hasBackendUrl();

  const initial = useLoad({
    key: ["wallet", "activity-history", smartAddress?.toLowerCase() ?? null],
    load: () => loadInitialHistory(smartAddress),
    errorMessage: "Failed to load activity",
    enabled,
  });

  // Later pages, valid only for the initial load they continue (`loadId`): a
  // refresh or another address starts over without an effect to reset this.
  const [extra, setExtra] = useState<(HistoryPage & { loadId: number }) | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<{ loadId: number; message: string } | null>(null);

  const base = enabled ? initial.data : undefined;
  const page: HistoryPage | undefined = extra && base && extra.loadId === base.loadId ? extra : base;

  const activities = page?.activities ?? NO_ACTIVITY;
  const monthsLoaded = page?.monthsLoaded ?? 0;
  // Nothing more to offer when history is off, or the initial load failed.
  const hasMore = page ? page.hasMore : enabled && !initial.error;
  const loading = initial.fetching;
  const error = initial.error ?? (moreError && moreError.loadId === base?.loadId ? moreError.message : null);
  const refresh = initial.refresh;

  const loadMore = useCallback(async () => {
    if (!base || !page || !page.hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = await extendHistory(base.session, page, (_rows, addedRows) => addedRows);
      setExtra({ ...next, loadId: base.loadId });
    } catch (e) {
      setMoreError({
        loadId: base.loadId,
        message: e instanceof Error ? e.message : "Failed to load more",
      });
    } finally {
      setLoadingMore(false);
    }
  }, [base, page, loadingMore, loading]);

  return {
    activities,
    loading,
    loadingMore,
    error,
    hasMore,
    monthsLoaded,
    refresh,
    loadMore,
  };
}
