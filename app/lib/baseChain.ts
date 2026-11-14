/**
 * Base mainnet reads — stablecoins + native ETH via public RPC (viem).
 */

import { createPublicClient, erc20Abi, formatUnits, http, fallback, parseAbi } from "viem";
import { base } from "viem/chains";
import { env } from "@/config/env";
import { PORTFOLIO_TOKENS } from "@/lib/portfolioTokens";

const SAFE_OWNERS_ABI = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
]);

export interface SafeSignerInfo {
  owners: `0x${string}`[];
  threshold: number;
}

/** Native USDC on Base */
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

export interface StablecoinToken {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
}

/** Home Stablecoin card — matches mobile blue-chip stables on Base. */
export const HOME_STABLECOINS: readonly StablecoinToken[] = [
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
  },
  {
    symbol: "DAI",
    name: "Dai Stablecoin",
    address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    decimals: 18,
  },
  {
    symbol: "EURC",
    name: "Euro Coin",
    address: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
    decimals: 6,
  },
  {
    symbol: "XSGD",
    name: "XSGD",
    address: "0x0A4C9cb2778aB3302996A34BeFCF9a8Bc288C33b",
    decimals: 6,
  },
  {
    symbol: "AUDD",
    name: "Australian Digital Dollar",
    address: "0x449b3317a6d1efb1bc3ba0700c9eaa4ffff4ae65",
    decimals: 6,
  },
  {
    symbol: "MXNe",
    name: "Real MXN",
    address: "0x269cae7dc59803e5c596c95756faeebb6030e0af",
    decimals: 6,
  },
  {
    symbol: "BRZ",
    name: "Brazilian Digital Token",
    address: "0xE9185Ee218cae427aF7B9764A011bb89FeA761B4",
    decimals: 18,
  },
] as const;

export type StablecoinBalances = Record<string, number>;

/**
 * Public Base RPCs — mainnet.base.org is last (aggressive 429 rate limits).
 * Every entry must answer browser requests (CORS) without a key, and must be
 * listed in the CSP in proxy.ts.
 */
const PUBLIC_BASE_RPCS = [
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org",
  "https://mainnet.base.org",
] as const;

/** Base RPC endpoints in the order they are tried: configured ones, then public. */
export function getBaseRpcUrls(): string[] {
  const urls: string[] = [];
  if (env.alchemyApiKey) {
    urls.push(`https://base-mainnet.g.alchemy.com/v2/${env.alchemyApiKey}`);
  }
  if (env.baseRpcUrl) {
    urls.push(env.baseRpcUrl);
  }
  urls.push(...PUBLIC_BASE_RPCS);
  return [...new Set(urls)];
}

const publicClient = createPublicClient({
  chain: base,
  transport: fallback(
    getBaseRpcUrls().map((url) =>
      http(url, {
        // Avoid retry storms when an endpoint returns 429.
        retryCount: 0,
        timeout: 12_000,
      }),
    ),
    { rank: false },
  ),
});

export async function fetchStablecoinBalances(address: `0x${string}`): Promise<StablecoinBalances> {
  const results = await publicClient.multicall({
    allowFailure: true,
    contracts: HOME_STABLECOINS.map((token) => ({
      address: token.address,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [address] as const,
    })),
  });

  const balances: StablecoinBalances = {};
  results.forEach((result, i) => {
    const token = HOME_STABLECOINS[i]!;
    if (result.status === "success") {
      balances[token.symbol] = parseFloat(formatUnits(result.result as bigint, token.decimals));
    } else {
      balances[token.symbol] = 0;
    }
  });
  return balances;
}

export async function fetchUsdcBalance(address: `0x${string}`): Promise<number> {
  const balances = await fetchStablecoinBalances(address);
  return balances.USDC ?? 0;
}

/** All Portfolio blue-chip balances on an SCA (native ETH + ERC-20s). */
export async function fetchPortfolioBalances(
  address: `0x${string}`,
): Promise<Record<string, number>> {
  const erc20Tokens = PORTFOLIO_TOKENS.filter(
    (t) => t.baseAddress !== null && t.trackBalance !== false,
  );
  const nativeTokens = PORTFOLIO_TOKENS.filter(
    (t) => t.baseAddress === null && t.trackBalance !== false,
  );

  const [results, nativeBalance] = await Promise.all([
    erc20Tokens.length > 0
      ? publicClient.multicall({
          allowFailure: true,
          contracts: erc20Tokens.map((t) => ({
            address: t.baseAddress as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf" as const,
            args: [address] as const,
          })),
        })
      : Promise.resolve([]),
    nativeTokens.length > 0
      ? publicClient.getBalance({ address })
      : Promise.resolve(BigInt(0)),
  ]);

  const balances: Record<string, number> = {};

  results.forEach((result, i) => {
    const token = erc20Tokens[i]!;
    if (result.status === "success") {
      balances[token.symbol] = parseFloat(formatUnits(result.result as bigint, token.decimals));
    } else {
      balances[token.symbol] = 0;
    }
  });

  if (nativeTokens.length > 0) {
    const amount = parseFloat(formatUnits(nativeBalance, nativeTokens[0]!.decimals));
    for (const token of nativeTokens) {
      balances[token.symbol] = amount;
    }
  }

  for (const token of PORTFOLIO_TOKENS.filter((t) => t.trackBalance === false)) {
    balances[token.symbol] = 0;
  }

  return balances;
}

export async function fetchEthBalance(address: `0x${string}`): Promise<number> {
  const raw = await publicClient.getBalance({ address });
  return parseFloat(formatUnits(raw, 18));
}

/** Read Safe 1.4.x owners + threshold from the SCA contract on Base. */
export async function fetchSafeSigners(scaAddress: `0x${string}`): Promise<SafeSignerInfo> {
  const [owners, threshold] = await Promise.all([
    publicClient.readContract({
      address: scaAddress,
      abi: SAFE_OWNERS_ABI,
      functionName: "getOwners",
    }),
    publicClient.readContract({
      address: scaAddress,
      abi: SAFE_OWNERS_ABI,
      functionName: "getThreshold",
    }),
  ]);

  return {
    owners: owners as `0x${string}`[],
    threshold: Number(threshold),
  };
}

export { publicClient as basePublicClient };
