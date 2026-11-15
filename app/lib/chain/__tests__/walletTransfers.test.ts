/**
 * walletTransfers.ts is shared verbatim with the mobile app, where the full
 * suite lives (src/lib/chain/__tests__). These cases check the copy here: the
 * two sources, how they are combined, and the limits public RPCs impose.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WalletTransferHistory,
  type HttpFetch,
  type TransferLogToken,
} from "../walletTransfers.ts";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const WALLET = "0x8F5B8F40E5c49eE791cF6EDA74523cAb08546418";
const OTHER = "0x1111111111111111111111111111111111111111";
const USDC: TransferLogToken = {
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
};
const RPC = "https://rpc.example";
const SAFE_SERVICE = "https://safe.example/tx-service/base";
const HEAD = 1_000_000;
const blockTime = (block: number) => 1_700_000_000 + block;
const pad = (address: string) => `0x${address.toLowerCase().slice(2).padStart(64, "0")}`;
const hex = (n: number | bigint) => `0x${n.toString(16)}`;
const txHash = (block: number) => `0x${block.toString(16).padStart(64, "0")}`;

interface ChainTransfer {
  block: number;
  from: string;
  to: string;
  value: bigint;
}

interface World {
  /** USDC transfers on chain. */
  transfers: ChainTransfer[];
  /** Blocks of the transfers the Safe service has indexed; null = it does not know the Safe. */
  indexed: number[] | null;
  deployed: boolean;
  usdcBalance: bigint;
}

function world(w: World) {
  const requests: { kind: "rpc" | "safe"; method?: string; span?: number; addresses?: number }[] = [];

  const fetchFn: HttpFetch = async (url, init) => {
    const reply = (body: unknown, status = 200) => ({
      ok: status < 300,
      status,
      json: async () => body,
    });

    if (init.method === "GET") {
      requests.push({ kind: "safe" });
      const query = new URL(url).searchParams;
      const limit = Number(query.get("limit"));
      const offset = Number(query.get("offset"));
      const known = (w.indexed ?? []).map((block) => {
        const t = w.transfers.find((x) => x.block === block) as ChainTransfer;
        return {
          type: "ERC20_TRANSFER",
          executionDate: new Date(blockTime(block) * 1000).toISOString(),
          blockNumber: block,
          transactionHash: txHash(block),
          from: t.from,
          to: t.to,
          value: t.value.toString(),
          tokenAddress: USDC.address,
          tokenInfo: { symbol: "USDC", name: "USD Coin", decimals: 6 },
        };
      });
      return reply({
        count: known.length,
        next: offset + limit < known.length ? "more" : null,
        results: known.slice(offset, offset + limit),
      });
    }

    const { method, params } = JSON.parse(init.body ?? "{}") as { method: string; params: unknown[] };
    const rpc = (result: unknown) => reply({ jsonrpc: "2.0", id: 1, result });
    if (method === "eth_blockNumber") {
      requests.push({ kind: "rpc", method });
      return rpc(hex(HEAD));
    }
    if (method === "eth_getCode") {
      requests.push({ kind: "rpc", method });
      return rpc(w.deployed ? "0x6080" : "0x");
    }
    if (method === "eth_call") {
      requests.push({ kind: "rpc", method });
      return rpc(hex(w.usdcBalance));
    }
    if (method === "eth_getBlockByNumber") {
      requests.push({ kind: "rpc", method });
      const block = Number.parseInt(params[0] as string, 16);
      return rpc({ timestamp: hex(blockTime(block)) });
    }
    if (method === "eth_getLogs") {
      const filter = params[0] as {
        fromBlock: string;
        toBlock: string;
        address: string[];
        topics: (string | null)[];
      };
      const from = Number.parseInt(filter.fromBlock, 16);
      const to = Number.parseInt(filter.toBlock, 16);
      requests.push({ kind: "rpc", method, span: to - from + 1, addresses: filter.address.length });
      // The limits of the public endpoint the app falls back to.
      if (to - from + 1 > 50_000) {
        return reply({ jsonrpc: "2.0", id: 1, error: { message: "exceed maximum block range: 50000" } });
      }
      if (filter.address.length > 10) {
        return reply({ jsonrpc: "2.0", id: 1, error: { message: "A maximum of 10 addresses is allowed." } });
      }
      return rpc(
        w.transfers
          .filter((t) => t.block >= from && t.block <= to)
          .filter((t) => !filter.topics[1] || filter.topics[1] === pad(t.from))
          .filter((t) => !filter.topics[2] || filter.topics[2] === pad(t.to))
          .map((t) => ({
            address: USDC.address.toLowerCase(),
            topics: [TRANSFER_TOPIC, pad(t.from), pad(t.to)],
            data: hex(t.value),
            blockNumber: hex(t.block),
            blockTimestamp: hex(blockTime(t.block)),
            transactionHash: txHash(t.block),
            logIndex: "0x0",
          })),
      );
    }
    throw new Error(`unexpected RPC method ${method}`);
  };

  const history = new WalletTransferHistory({
    address: WALLET,
    tokens: [USDC],
    rpcUrls: [RPC],
    safeServiceUrl: SAFE_SERVICE,
    fetchFn,
  });
  return { history, requests };
}

describe("WalletTransferHistory", () => {
  it("lists indexed history, plus a transfer the indexer has not caught up with", async () => {
    const { history } = world({
      deployed: true,
      usdcBalance: BigInt(0),
      transfers: [
        { block: HEAD - 3, from: WALLET, to: OTHER, value: BigInt(9) }, // seconds old
        { block: HEAD - 400_000, from: OTHER, to: WALLET, value: BigInt(5) },
        { block: HEAD - 900_000, from: OTHER, to: WALLET, value: BigInt(7) },
      ],
      indexed: [HEAD - 400_000, HEAD - 900_000],
    });

    const page = await history.nextPage(20);

    assert.deepEqual(
      page.rows.map((r) => r.value),
      ["9", "5", "7"],
    );
    assert.equal(page.hasMore, false);
    // Everything is listed: nothing older is missing.
    assert.equal(page.coveredBackToMs, 0);
  });

  it("makes no log queries for an undeployed wallet that holds nothing", async () => {
    const { history, requests } = world({
      deployed: false,
      usdcBalance: BigInt(0),
      transfers: [],
      indexed: null,
    });

    assert.deepEqual(await history.nextPage(20), { rows: [], hasMore: false, coveredBackToMs: 0 });
    assert.equal(requests.filter((r) => r.method === "eth_getLogs").length, 0);
  });

  it("finds the deposit of a wallet that is not deployed yet, within public RPC limits", async () => {
    const { history, requests } = world({
      deployed: false,
      usdcBalance: BigInt(25000000),
      transfers: [{ block: HEAD - 120_000, from: OTHER, to: WALLET, value: BigInt(25000000) }],
      indexed: null,
    });

    const page = await history.nextPage(20);

    assert.deepEqual(
      page.rows.map((r) => [r.from, r.to, r.value, r.timestamp]),
      [[OTHER.toLowerCase(), WALLET.toLowerCase(), "25000000", blockTime(HEAD - 120_000)]],
    );
    // The receipt equals the balance, so the history is complete.
    assert.equal(page.hasMore, false);
    assert.equal(page.coveredBackToMs, 0);
    const logQueries = requests.filter((r) => r.method === "eth_getLogs");
    assert.ok(logQueries.length > 0);
    assert.ok(logQueries.every((r) => (r.span ?? 0) <= 50_000 && (r.addresses ?? 0) <= 10));
  });

  it("reports how far back it has looked when a page comes back empty", async () => {
    const { history } = world({
      deployed: true, // deployed, but the indexer has not picked it up
      usdcBalance: BigInt(0),
      transfers: [],
      indexed: null,
    });

    const page = await history.nextPage(20);

    assert.deepEqual(page.rows, []);
    assert.equal(page.hasMore, true);
    assert.equal(page.coveredBackToMs, blockTime(HEAD - 500_000 + 1) * 1000);
  });
});
