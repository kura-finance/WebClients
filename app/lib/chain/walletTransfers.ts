/**
 * ERC-20 transfer history of a Smart Wallet (a Safe on Base), without an API key.
 *
 * History used to come from Blockscout's public API, which now answers every
 * API request — from apps and from browsers — with a Cloudflare challenge.
 * {@link WalletTransferHistory} replaces it with two sources:
 *
 *   1. The Safe Transaction Service, which indexes every Safe: the full
 *      history, paged, including what the address received before the Safe
 *      contract was deployed. It only knows a Safe once it IS deployed, and it
 *      trails the chain by a short while.
 *   2. `Transfer` logs read straight from the Base RPC ({@link TransferLogCursor}),
 *      newest blocks first. This covers a wallet that has received funds but
 *      not yet sent anything (so is not deployed), and the minutes the indexer
 *      lags behind. Public RPCs only serve small block ranges and only for
 *      named contracts, so it reaches back hours to days, not months, and
 *      lists only the tokens it is given.
 *
 * The first page asks both and merges them. After that the indexer pages on if
 * it knows the Safe; otherwise the log scan continues, a bounded number of
 * blocks per page — such a page can be short or empty while `hasMore` is true.
 *
 * Native ETH is left out, as before: gas prefunds would fill the list.
 *
 * No imports and no platform APIs beyond `fetch`, so the same file runs in the
 * app, in the web client and under the unit tests.
 */

export interface TransferLogToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

export interface TransferLogRow {
  hash: string;
  /** Position in the block; null when the source does not report it. */
  logIndex: number | null;
  blockNumber: number;
  /** Block time, Unix seconds. */
  timestamp: number;
  /** Lower-case addresses, as they appear in the log topics. */
  from: string;
  to: string;
  /** Raw token amount as a decimal string. */
  value: string;
  token: TransferLogToken;
}

export interface TransferLogPage {
  rows: TransferLogRow[];
  /** Older blocks (or buffered rows) remain; ask for another page. */
  hasMore: boolean;
  /** Time of the oldest block scanned so far, Unix ms. Null if unknown. */
  scannedBackToMs: number | null;
}

export interface HttpFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** The part of `fetch` used here; tests pass a fake. */
export type HttpFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<HttpFetchResponse>;

export interface TransferLogCursorOptions {
  /** Account whose incoming and outgoing transfers are listed. */
  address: string;
  tokens: readonly TransferLogToken[];
  /** Tried in order; the first one that answers is kept for later calls. */
  rpcUrls: readonly string[];
  fetchFn?: HttpFetch;
}

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/**
 * Blocks per `eth_getLogs` call, largest first. Providers cap the range at
 * different sizes (50 000 on publicnode, 10 000 or less elsewhere); when every
 * endpoint rejects a size the next smaller one is used from then on.
 */
const WINDOW_SPANS = [50_000, 10_000, 2_000] as const;
/**
 * Contracts named in one `eth_getLogs` filter. publicnode rejects more than
 * ten, so a longer token list is split over several requests per window.
 */
const ADDRESSES_PER_REQUEST = 10;
/**
 * Requests in flight at once. A window costs two requests (sent / received)
 * per group of contracts, and as many windows as fit are fetched together.
 */
const MAX_CONCURRENT_REQUESTS = 8;
/** balanceOf(address) */
const BALANCE_OF_SELECTOR = '0x70a08231';
/**
 * Blocks scanned for one page before returning what was found. Base has
 * shortened its block time more than once (2 s at launch, 0.2 s in late 2026),
 * so this is about a day of history now and was about eleven at launch.
 */
const BLOCKS_PER_PAGE = 500_000;
/**
 * How far back the log scan goes at all: 6 pages, about 120 requests. Deeper
 * history needs an indexer — see WalletTransferHistory.
 */
const MAX_LOOKBACK_BLOCKS = 3_000_000;
const BLOCK_HEADER_CONCURRENCY = 8;

interface RawLog {
  address?: string;
  topics?: string[];
  data?: string;
  blockNumber?: string;
  blockTimestamp?: string;
  transactionHash?: string;
  logIndex?: string;
  removed?: boolean;
}

interface PendingRow extends Omit<TransferLogRow, 'timestamp' | 'logIndex'> {
  logIndex: number;
  timestamp: number | null;
}

function toHex(n: number): string {
  return `0x${n.toString(16)}`;
}

function topicForAddress(address: string): string {
  return `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
}

function addressFromTopic(topic: string): string {
  return `0x${topic.slice(-40).toLowerCase()}`;
}

function parseHexInt(value: unknown): number | null {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  const n = Number.parseInt(value, 16);
  return Number.isSafeInteger(n) ? n : null;
}

function newestFirst(a: PendingRow, b: PendingRow): number {
  return b.blockNumber - a.blockNumber || b.logIndex - a.logIndex;
}

async function inChunks<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(run));
  }
}

/**
 * Pages backwards through one account's ERC-20 transfers. Make a new cursor to
 * start over from the current chain head (pull-to-refresh).
 */
export class TransferLogCursor {
  private readonly address: string;
  private readonly tokensByAddress: Map<string, TransferLogToken>;
  /** Token contracts, in groups small enough for one log filter each. */
  private readonly addressGroups: string[][];
  private readonly rpcUrls: readonly string[];
  private readonly fetchFn: HttpFetch;

  private rpcIndex = 0;
  private spanIndex = 0;
  private requestId = 0;

  /** Next block to scan down from; null until the chain head is known. */
  private nextTo: number | null = null;
  /** Oldest block history is allowed to reach. */
  private floor = 0;
  /** Rows found but not handed out yet, newest first. */
  private buffer: TransferLogRow[] = [];
  /** Every row found so far, handed out or not. */
  private found: TransferLogRow[] = [];
  private scannedBackToMs: number | null = null;

  constructor(options: TransferLogCursorOptions) {
    if (options.rpcUrls.length === 0) throw new Error('No Base RPC endpoint configured.');
    this.address = options.address.toLowerCase();
    this.tokensByAddress = new Map(options.tokens.map((t) => [t.address.toLowerCase(), t]));
    const addresses = [...this.tokensByAddress.keys()];
    this.addressGroups = [];
    for (let i = 0; i < addresses.length; i += ADDRESSES_PER_REQUEST) {
      this.addressGroups.push(addresses.slice(i, i + ADDRESSES_PER_REQUEST));
    }
    this.rpcUrls = options.rpcUrls;
    this.fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
  }

  /** Whether the account has contract code, i.e. the Safe has been deployed. */
  async isDeployed(): Promise<boolean> {
    const code = await this.call('eth_getCode', [this.address, 'latest']);
    return typeof code === 'string' && code.length > 2;
  }

  /** Raw balance of every listed token the account holds any of, by lower-case address. */
  async heldBalances(): Promise<Map<string, bigint>> {
    const data = `${BALANCE_OF_SELECTOR}${topicForAddress(this.address).slice(2)}`;
    const held = new Map<string, bigint>();
    await inChunks([...this.tokensByAddress.keys()], MAX_CONCURRENT_REQUESTS, async (token) => {
      const result = await this.call('eth_call', [{ to: token, data }, 'latest']);
      const balance = typeof result === 'string' && result.length > 2 ? BigInt(result) : BigInt(0);
      if (balance > BigInt(0)) held.set(token, balance);
    });
    return held;
  }

  /** Scan only these token contracts from now on (lower-case addresses). */
  restrictTokens(addresses: Iterable<string>): void {
    const keep = new Set(addresses);
    for (const address of [...this.tokensByAddress.keys()]) {
      if (!keep.has(address)) this.tokensByAddress.delete(address);
    }
    const remaining = [...this.tokensByAddress.keys()];
    this.addressGroups.length = 0;
    for (let i = 0; i < remaining.length; i += ADDRESSES_PER_REQUEST) {
      this.addressGroups.push(remaining.slice(i, i + ADDRESSES_PER_REQUEST));
    }
  }

  /**
   * @param maxBlocks Blocks to scan at most for this page (default: a full page's worth).
   * @param complete Given every row found so far, says whether history is
   *   known to be complete; scanning then stops for good.
   */
  async nextPage(
    pageSize: number,
    maxBlocks: number = BLOCKS_PER_PAGE,
    complete?: (found: readonly TransferLogRow[]) => boolean,
  ): Promise<TransferLogPage> {
    if (this.tokensByAddress.size === 0) {
      return { rows: [], hasMore: false, scannedBackToMs: null };
    }

    if (this.nextTo === null) {
      const head = parseHexInt(await this.call('eth_blockNumber', []));
      if (head === null) throw new Error('Base RPC returned no block number.');
      this.nextTo = head;
      this.floor = Math.max(0, head - MAX_LOOKBACK_BLOCKS);
    }

    let budget = maxBlocks;
    let scanned = false;
    while (this.buffer.length < pageSize && this.nextTo >= this.floor && budget > 0) {
      budget -= await this.scanNextWindows(budget);
      scanned = true;
      if (complete?.(this.found)) {
        this.nextTo = this.floor - 1;
        break;
      }
    }
    if (scanned && this.nextTo >= this.floor) await this.refreshScannedBackTo();

    return {
      rows: this.buffer.splice(0, pageSize),
      hasMore: this.buffer.length > 0 || this.nextTo >= this.floor,
      scannedBackToMs: this.scannedBackToMs,
    };
  }

  /** Scan the next few windows below `nextTo`; returns the blocks covered. */
  private async scanNextWindows(maxBlocks: number): Promise<number> {
    for (;;) {
      const span = WINDOW_SPANS[this.spanIndex];
      const windows: { from: number; to: number }[] = [];
      let to = this.nextTo as number;
      let left = maxBlocks;
      const windowsAtOnce = Math.max(
        1,
        Math.floor(MAX_CONCURRENT_REQUESTS / (2 * this.addressGroups.length)),
      );
      while (windows.length < windowsAtOnce && to >= this.floor && left > 0) {
        const from = Math.max(this.floor, to - Math.min(span, left) + 1);
        windows.push({ from, to });
        left -= to - from + 1;
        to = from - 1;
      }

      let found: PendingRow[][];
      try {
        found = await Promise.all(windows.map((w) => this.fetchWindow(w.from, w.to)));
      } catch (error) {
        // Every endpoint refused this window size: retry the same blocks smaller.
        if (this.spanIndex >= WINDOW_SPANS.length - 1) throw error;
        this.spanIndex += 1;
        continue;
      }

      const rows = found.flat();
      await this.fillTimestamps(rows);
      rows.sort(newestFirst);
      this.buffer.push(...(rows as TransferLogRow[]));
      this.found.push(...(rows as TransferLogRow[]));
      this.nextTo = to;
      return maxBlocks - left;
    }
  }

  private async fetchWindow(from: number, to: number): Promise<PendingRow[]> {
    const me = topicForAddress(this.address);
    const queries = this.addressGroups.flatMap((address) =>
      // Sent by the wallet, then received by it.
      [[TRANSFER_TOPIC, me], [TRANSFER_TOPIC, null, me]].map((topics) =>
        this.call('eth_getLogs', [
          { fromBlock: toHex(from), toBlock: toHex(to), address, topics },
        ]),
      ),
    );
    const results = (await Promise.all(queries)) as RawLog[][];

    // A transfer to oneself matches both queries: keep one copy.
    const byId = new Map<string, PendingRow>();
    for (const log of results.flat()) {
      const row = this.rowFromLog(log);
      if (row) byId.set(`${row.hash}:${row.logIndex}`, row);
    }
    return [...byId.values()];
  }

  private rowFromLog(log: RawLog): PendingRow | null {
    if (log.removed) return null;
    // ERC-721 also emits Transfer, with the token id as a fourth topic.
    if (!log.topics || log.topics.length !== 3) return null;
    const token = this.tokensByAddress.get((log.address ?? '').toLowerCase());
    const blockNumber = parseHexInt(log.blockNumber);
    const logIndex = parseHexInt(log.logIndex);
    if (!token || blockNumber === null || logIndex === null || !log.transactionHash) return null;

    let value: string;
    try {
      value = BigInt(!log.data || log.data === '0x' ? '0x0' : log.data).toString();
    } catch {
      return null;
    }

    return {
      hash: log.transactionHash,
      logIndex,
      blockNumber,
      // Recent nodes include the block time with each log; older ones do not.
      timestamp: parseHexInt(log.blockTimestamp),
      from: addressFromTopic(log.topics[1]),
      to: addressFromTopic(log.topics[2]),
      value,
      token,
    };
  }

  /** Look up block times for rows whose log did not carry one. */
  private async fillTimestamps(rows: PendingRow[]): Promise<void> {
    const missing = [...new Set(rows.filter((r) => r.timestamp === null).map((r) => r.blockNumber))];
    if (missing.length === 0) return;

    const timeByBlock = new Map<number, number>();
    await inChunks(missing, BLOCK_HEADER_CONCURRENCY, async (blockNumber) => {
      const time = await this.blockTime(blockNumber);
      if (time === null) throw new Error(`Base RPC returned no time for block ${blockNumber}.`);
      timeByBlock.set(blockNumber, time);
    });
    for (const row of rows) {
      if (row.timestamp === null) row.timestamp = timeByBlock.get(row.blockNumber) ?? null;
    }
  }

  private async blockTime(blockNumber: number): Promise<number | null> {
    const block = (await this.call('eth_getBlockByNumber', [toHex(blockNumber), false])) as
      | { timestamp?: string }
      | null;
    return parseHexInt(block?.timestamp);
  }

  /** Best effort: callers only use this to decide whether to keep paging. */
  private async refreshScannedBackTo(): Promise<void> {
    const oldestScanned = Math.max(this.floor, (this.nextTo as number) + 1);
    try {
      const time = await this.blockTime(oldestScanned);
      if (time !== null) this.scannedBackToMs = time * 1000;
    } catch {
      /* keep the previous value */
    }
  }

  /** JSON-RPC call against the first endpoint that answers, starting with the last good one. */
  private async call(method: string, params: unknown[]): Promise<unknown> {
    let lastError: unknown = new Error('Base RPC request failed.');
    for (let attempt = 0; attempt < this.rpcUrls.length; attempt++) {
      const index = (this.rpcIndex + attempt) % this.rpcUrls.length;
      try {
        const result = await this.callOne(this.rpcUrls[index], method, params);
        this.rpcIndex = index;
        return result;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private async callOne(url: string, method: string, params: unknown[]): Promise<unknown> {
    this.requestId += 1;
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: this.requestId, method, params }),
    });

    // A body that is not JSON is reported through the status below.
    const body = (await response.json().catch(() => null)) as {
      result?: unknown;
      error?: { message?: string };
    } | null;
    if (body?.error) throw new Error(body.error.message || `Base RPC error (${method}).`);
    if (!response.ok || !body || !('result' in body)) {
      throw new Error(`Base RPC error ${response.status} (${method}).`);
    }
    return body.result;
  }
}

// ── Safe Transaction Service ───────────────────────────────────────────────────

interface SafeTransfer {
  type?: string;
  executionDate?: string;
  blockNumber?: number;
  transactionHash?: string;
  from?: string;
  to?: string;
  value?: string | null;
  tokenAddress?: string | null;
  tokenInfo?: { symbol?: string | null; name?: string | null; decimals?: number | null } | null;
}

interface SafeTransferPage {
  rows: TransferLogRow[];
  hasMore: boolean;
  /** Transfers the service knows for this Safe; 0 for a Safe it has not indexed. */
  total: number;
}

/** Pages through `/api/v1/safes/{address}/transfers/` (ERC-20 only), newest first. */
class SafeTransferPager {
  private readonly url: string;
  private readonly fetchFn: HttpFetch;
  private offset = 0;

  constructor(serviceUrl: string, checksumAddress: string, fetchFn: HttpFetch) {
    this.url = `${serviceUrl.replace(/\/+$/, '')}/api/v1/safes/${checksumAddress}/transfers/`;
    this.fetchFn = fetchFn;
  }

  async nextPage(pageSize: number): Promise<SafeTransferPage> {
    const response = await this.fetchFn(
      `${this.url}?erc20=true&limit=${pageSize}&offset=${this.offset}`,
      { method: 'GET', headers: { accept: 'application/json' } },
    );
    if (!response.ok) throw new Error(`Safe Transaction Service error ${response.status}.`);
    const body = (await response.json()) as {
      count?: number;
      next?: string | null;
      results?: SafeTransfer[];
    } | null;
    const results = Array.isArray(body?.results) ? (body as { results: SafeTransfer[] }).results : [];
    this.offset += results.length;

    const rows: TransferLogRow[] = [];
    for (const transfer of results) {
      const row = rowFromSafeTransfer(transfer);
      if (row) rows.push(row);
    }
    return { rows, hasMore: Boolean(body?.next), total: body?.count ?? results.length };
  }
}

function rowFromSafeTransfer(transfer: SafeTransfer): TransferLogRow | null {
  if (transfer.type !== 'ERC20_TRANSFER') return null;
  const timeMs = Date.parse(transfer.executionDate ?? '');
  if (!transfer.transactionHash || !transfer.tokenAddress || !transfer.from || !transfer.to) return null;
  if (!Number.isFinite(timeMs) || !/^\d+$/.test(transfer.value ?? '')) return null;
  return {
    hash: transfer.transactionHash,
    logIndex: null,
    blockNumber: transfer.blockNumber ?? 0,
    timestamp: Math.floor(timeMs / 1000),
    from: transfer.from.toLowerCase(),
    to: transfer.to.toLowerCase(),
    value: transfer.value as string,
    token: {
      address: transfer.tokenAddress,
      // The service knows no metadata for some tokens (mostly spam airdrops).
      symbol: transfer.tokenInfo?.symbol || 'TOKEN',
      name: transfer.tokenInfo?.name || '',
      decimals: transfer.tokenInfo?.decimals ?? 18,
    },
  };
}

// ── Both sources together ──────────────────────────────────────────────────────

export interface WalletTransferPage {
  rows: TransferLogRow[];
  hasMore: boolean;
  /**
   * History is complete back to this time (Unix ms): 0 when all of it has been
   * listed, null when unknown. Rows may be older — this is about gaps.
   */
  coveredBackToMs: number | null;
}

export interface WalletTransferHistoryOptions {
  /** The Smart Wallet, EIP-55 checksummed (the Safe service rejects other casing). */
  address: string;
  /** Tokens the RPC log scan covers. The Safe service lists every token. */
  tokens: readonly TransferLogToken[];
  rpcUrls: readonly string[];
  /** e.g. https://api.safe.global/tx-service/base — omit to use RPC logs only. */
  safeServiceUrl?: string;
  fetchFn?: HttpFetch;
}

/**
 * With an indexed Safe the RPC only has to bridge the indexer's lag, which is
 * minutes: one window of the newest blocks (three requests) is plenty.
 */
const RECENT_BLOCKS_WITH_INDEXER = WINDOW_SPANS[0];

/** Same transfer from either source: hash, token, parties and amount. */
function transferKey(row: TransferLogRow): string {
  return [row.hash, row.token.address, row.from, row.to, row.value].join('|').toLowerCase();
}

function mergeNewestFirst(...lists: TransferLogRow[][]): TransferLogRow[] {
  const byKey = new Map<string, TransferLogRow>();
  for (const row of lists.flat()) {
    if (!byKey.has(transferKey(row))) byKey.set(transferKey(row), row);
  }
  return [...byKey.values()].sort(
    (a, b) => b.timestamp - a.timestamp || b.blockNumber - a.blockNumber,
  );
}

/**
 * One wallet's transfer history, page by page. Make a new one to start over
 * (pull-to-refresh): which source pages on is decided again from the first page.
 */
export class WalletTransferHistory {
  private readonly logs: TransferLogCursor;
  private readonly indexer: SafeTransferPager | null;
  private readonly address: string;
  private source: 'undecided' | 'indexer' | 'logs' | 'empty' = 'undecided';
  /** Balances of an undeployed Safe: the log scan is complete once receipts reach them. */
  private expectedReceipts: Map<string, bigint> | null = null;
  private receiptsComplete = false;

  constructor(options: WalletTransferHistoryOptions) {
    const fetchFn: HttpFetch = options.fetchFn ?? ((url, init) => fetch(url, init));
    this.address = options.address.toLowerCase();
    this.logs = new TransferLogCursor({ ...options, fetchFn });
    this.indexer = options.safeServiceUrl
      ? new SafeTransferPager(options.safeServiceUrl, options.address, fetchFn)
      : null;
  }

  async nextPage(pageSize: number): Promise<WalletTransferPage> {
    if (this.source === 'indexer') return this.indexerPage(pageSize, []);
    if (this.source === 'logs') return this.logsPage(pageSize);
    if (this.source === 'empty') return { rows: [], hasMore: false, coveredBackToMs: 0 };

    // First page. Ask the indexer first: whether it knows this Safe decides how
    // much of the chain has to be scanned.
    const indexed = this.indexer
      ? await this.indexer.nextPage(pageSize).catch(() => null)
      : null;

    if (indexed && indexed.total > 0) {
      this.source = 'indexer';
      // Best effort: without it the newest transfers show up a little later.
      const recent = await this.logs
        .nextPage(pageSize, RECENT_BLOCKS_WITH_INDEXER)
        .catch(() => null);
      return this.pageFromIndexer(indexed, recent ? recent.rows : []);
    }

    // The indexer does not know this Safe (or cannot be reached): the chain
    // itself is the only source, so a failure here is the caller's failure and
    // the next call starts over.
    if (!(await this.logs.isDeployed())) {
      // An undeployed Safe has never sent anything, so what it received is
      // exactly what it holds: only those tokens can have history, and the
      // history is complete once the receipts add up to the balances.
      const held = await this.logs.heldBalances();
      if (held.size === 0) {
        this.source = 'empty';
        return { rows: [], hasMore: false, coveredBackToMs: 0 };
      }
      this.logs.restrictTokens(held.keys());
      this.expectedReceipts = held;
    }
    const page = await this.logsPage(pageSize);
    this.source = 'logs';
    return page;
  }

  private async indexerPage(pageSize: number, recentRows: TransferLogRow[]): Promise<WalletTransferPage> {
    return this.pageFromIndexer(await (this.indexer as SafeTransferPager).nextPage(pageSize), recentRows);
  }

  private pageFromIndexer(page: SafeTransferPage, recentRows: TransferLogRow[]): WalletTransferPage {
    const oldest = page.rows.length > 0 ? page.rows[page.rows.length - 1].timestamp * 1000 : null;
    return {
      rows: mergeNewestFirst(recentRows, page.rows),
      hasMore: page.hasMore,
      coveredBackToMs: page.hasMore ? oldest : 0,
    };
  }

  private async logsPage(pageSize: number): Promise<WalletTransferPage> {
    const expected = this.expectedReceipts;
    const page = await this.logs.nextPage(
      pageSize,
      undefined,
      expected
        ? (found) => {
            if (this.receiptsReach(expected, found)) this.receiptsComplete = true;
            return this.receiptsComplete;
          }
        : undefined,
    );
    return {
      rows: page.rows,
      hasMore: page.hasMore,
      // Every receipt accounted for and handed out: nothing older is missing.
      coveredBackToMs: this.receiptsComplete && !page.hasMore ? 0 : page.scannedBackToMs,
    };
  }

  /** Whether transfers into the wallet add up to at least `expected`, per token. */
  private receiptsReach(expected: Map<string, bigint>, rows: readonly TransferLogRow[]): boolean {
    const received = new Map<string, bigint>();
    for (const row of rows) {
      if (row.to !== this.address) continue;
      const token = row.token.address.toLowerCase();
      received.set(token, (received.get(token) ?? BigInt(0)) + BigInt(row.value));
    }
    for (const [token, balance] of expected) {
      if ((received.get(token) ?? BigInt(0)) < balance) return false;
    }
    return true;
  }
}
