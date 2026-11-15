/**
 * Safe SCA UserOps on Base via the owner EOA + a Pimlico bundler.
 * Mirrors mobile `smartAccountClient` / `sendUsdcTx` for web Smart Wallet sends.
 *
 * Gas: with NEXT_PUBLIC_PIMLICO_API_KEY the keyed bundler and paymaster are used
 * (USDC gas unless NEXT_PUBLIC_PAY_GAS_IN_USDC=false). Without a key, UserOps go
 * through Pimlico's public bundler and the Safe pays gas in ETH — same as mobile.
 */

import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  http,
  maxUint256,
  fallback,
} from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { base } from "viem/chains";
import { createSmartAccountClient } from "permissionless";
import { toSafeSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { env, isPimlicoConfigured, paysGasInUsdc } from "@/config/env";
import { USDC_BASE } from "@/lib/baseChain";
import type { LiFiBridgeQuote } from "@/lib/lifiBridge";
import { signerCopy } from "@/lib/signer/copy";

const BASE_FALLBACK = "https://mainnet.base.org";

/** Loosen viem/permissionless client generics (matches mobile AnyClient pattern). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

function rpcUrls(): string[] {
  const urls: string[] = [];
  if (env.alchemyApiKey) {
    urls.push(`https://base-mainnet.g.alchemy.com/v2/${env.alchemyApiKey}`);
  }
  if (env.baseRpcUrl) urls.push(env.baseRpcUrl);
  urls.push(BASE_FALLBACK);
  return [...new Set(urls)];
}

/** Pimlico public bundler (no API key) — Base chain id 8453. */
const PIMLICO_PUBLIC_BUNDLER_URL = "https://public.pimlico.io/v2/8453/rpc";

/** Authenticated Pimlico when a key is set; otherwise the public endpoint. */
function bundlerUrl(): string {
  return env.pimlicoApiKey
    ? `https://api.pimlico.io/v2/base/rpc?apikey=${env.pimlicoApiKey}`
    : PIMLICO_PUBLIC_BUNDLER_URL;
}

/** Shown where a send is offered while gas is paid in ETH. */
export const ETH_GAS_NOTICE =
  "Network fees are paid in ETH: keep a little ETH on Base in the wallet you send from.";

export type Call = { to: `0x${string}`; data: `0x${string}`; value?: bigint };

/** Optional Safe account derivation overrides (treasury vs personal). */
export type SafeAccountOpts = {
  saltNonce?: bigint;
  accountAddress?: `0x${string}`;
  /**
   * Override env `payGasInUsdc`. Use `false` for first deploy of an empty Safe
   * (ERC-20 paymaster postOp needs USDC on the account).
   */
  payGasWithUsdc?: boolean;
};

function shouldPayGasWithUsdc(opts?: Pick<SafeAccountOpts, "payGasWithUsdc">): boolean {
  // The ERC-20 paymaster needs a Pimlico key; without one gas is always ETH.
  if (!isPimlicoConfigured()) return false;
  if (opts?.payGasWithUsdc !== undefined) return opts.payGasWithUsdc;
  return paysGasInUsdc();
}

/**
 * Public bundler, no paymaster: the Safe itself prefunds the UserOp in ETH.
 * Fail early with a readable message instead of the bundler's AA21 error.
 */
async function assertEthForGas(publicClient: AnyClient, scaAddress: `0x${string}`): Promise<void> {
  const balance = (await publicClient.getBalance({ address: scaAddress })) as bigint;
  if (balance > BigInt(0)) return;
  throw new Error(
    `No ETH for network fees. Send a little ETH on Base to ${scaAddress} and try again.`,
  );
}

async function withGasApprovalCalls(
  pimlicoClient: AnyClient,
  publicClient: AnyClient,
  scaAddress: `0x${string}`,
  calls: Call[],
  payGasWithUsdc: boolean,
): Promise<Call[]> {
  if (!payGasWithUsdc) return calls;

  const quotes = await pimlicoClient.getTokenQuotes({
    tokens: [USDC_BASE],
    chain: base,
  });
  const paymaster = quotes[0]?.paymaster as `0x${string}` | undefined;
  if (!paymaster) {
    throw new Error("Pimlico ERC-20 paymaster is unavailable for USDC on Base.");
  }

  const allowance = (await publicClient.readContract({
    address: USDC_BASE,
    abi: erc20Abi,
    functionName: "allowance",
    args: [scaAddress, paymaster],
  })) as bigint;

  if (allowance > maxUint256 / BigInt(2)) return calls;

  return [
    {
      to: USDC_BASE,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [paymaster, maxUint256],
      }),
    },
    ...calls,
  ];
}

/** Rough USDC (6 decimals) reserve so ERC-20 paymaster postOp can charge gas. */
const USDC_GAS_RESERVE = BigInt(50_000); // 0.05 USDC

async function assertUsdcForPaymaster(
  publicClient: AnyClient,
  scaAddress: `0x${string}`,
  calls: Call[],
): Promise<void> {
  const balance = (await publicClient.readContract({
    address: USDC_BASE,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [scaAddress],
  })) as bigint;

  let outflow = BigInt(0);
  for (const call of calls) {
    if (call.to.toLowerCase() !== USDC_BASE.toLowerCase()) continue;
    try {
      const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data });
      if (decoded.functionName === "transfer") {
        outflow += decoded.args[1] as bigint;
      }
    } catch {
      /* ignore non-transfer */
    }
  }

  if (balance < outflow + USDC_GAS_RESERVE) {
    const bal = Number(balance) / 1e6;
    const need = Number(outflow + USDC_GAS_RESERVE) / 1e6;
    throw new Error(
      `Insufficient USDC for gas. Balance ${bal.toFixed(4)} USDC, need ~${need.toFixed(4)} USDC (incl. network fees). Fund this Safe with USDC first, or disable USDC gas (NEXT_PUBLIC_PAY_GAS_IN_USDC=false).`,
    );
  }
}

async function buildAllowanceAndTxCalls(params: {
  spender: `0x${string}`;
  fromToken: `0x${string}`;
  fromAmount: bigint;
  scaAddress: `0x${string}`;
  publicClient: AnyClient;
  tx: Call;
}): Promise<Call[]> {
  const { spender, fromToken, fromAmount, scaAddress, publicClient, tx } = params;
  const calls: Call[] = [];
  const currentAllowance = (await publicClient.readContract({
    address: fromToken,
    abi: erc20Abi,
    functionName: "allowance",
    args: [scaAddress, spender],
  })) as bigint;
  if (currentAllowance < fromAmount) {
    calls.push({
      to: fromToken,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, maxUint256],
      }),
    });
  }
  calls.push(tx);
  return calls;
}

async function resolveSmartAccount(
  params: {
    eip1193Provider: EthereumProvider;
    expectedScaAddress: `0x${string}`;
    /** Distinct Safe when ≠ personal (e.g. treasury saltNonce = 1n). */
    saltNonce?: bigint;
    /**
     * Force account address (bound Safes that were not derived with our salt).
     * Prefer this for `treasurySource === "bound"`.
     */
    accountAddress?: `0x${string}`;
  } & Pick<SafeAccountOpts, "payGasWithUsdc">,
): Promise<{
  smartAccountClient: AnyClient;
  publicClient: AnyClient;
  pimlicoClient: AnyClient;
  scaAddress: `0x${string}`;
  payGasWithUsdc: boolean;
  /** No paymaster: the Safe needs ETH for the UserOp prefund. */
  selfPaysGas: boolean;
}> {
  const payGasWithUsdc = shouldPayGasWithUsdc(params);
  const entryPoint = { address: entryPoint07Address, version: "0.7" as const };
  const publicClient: AnyClient = createPublicClient({
    chain: base,
    transport: fallback(rpcUrls().map((url) => http(url))),
  });

  const accounts = (await params.eip1193Provider.request({
    method: "eth_accounts",
  })) as string[];
  const eoaAddress = accounts[0] as `0x${string}` | undefined;
  if (!eoaAddress) throw new Error(signerCopy.noWallet);

  try {
    await params.eip1193Provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${base.id.toString(16)}` }],
    });
  } catch {
    /* Privy may already be on Base */
  }

  const ownerWalletClient = createWalletClient({
    account: eoaAddress,
    chain: base,
    transport: custom(params.eip1193Provider),
  });

  const account = await toSafeSmartAccount({
    client: publicClient,
    owners: [ownerWalletClient],
    entryPoint,
    version: "1.4.1",
    ...(params.saltNonce !== undefined ? { saltNonce: params.saltNonce } : {}),
    ...(params.accountAddress ? { address: params.accountAddress } : {}),
  });

  if (account.address.toLowerCase() !== params.expectedScaAddress.toLowerCase()) {
    throw new Error(
      `Smart Wallet address mismatch. Expected ${params.expectedScaAddress}, got ${account.address}. Use the same ${signerCopy.account} that owns your Smart Wallet.`,
    );
  }

  const pimlicoTransport = http(bundlerUrl());
  const pimlicoClient: AnyClient = createPimlicoClient({
    transport: pimlicoTransport,
    entryPoint,
  });

  // The public bundler has no paymaster: the Safe pays its own gas in ETH.
  const usePaymaster = isPimlicoConfigured();

  const smartAccountClient: AnyClient = createSmartAccountClient({
    account,
    chain: base,
    bundlerTransport: pimlicoTransport,
    ...(usePaymaster ? { paymaster: pimlicoClient } : {}),
    ...(payGasWithUsdc ? { paymasterContext: { token: USDC_BASE } } : {}),
    userOperation: {
      estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
    },
  });

  return {
    smartAccountClient,
    publicClient,
    pimlicoClient,
    scaAddress: account.address,
    payGasWithUsdc,
    selfPaysGas: !usePaymaster,
  };
}

/**
 * Send USDC from the user's Smart Wallet (Privy EOA must be an owner).
 * Returns the UserOperation / transaction hash.
 */
export async function sendUsdcFromSafe(params: {
  eip1193Provider: EthereumProvider;
  expectedScaAddress: `0x${string}`;
  toAddress: `0x${string}`;
  amountUsdc: number;
} & SafeAccountOpts): Promise<string> {
  if (!(params.amountUsdc > 0)) throw new Error("Amount must be greater than 0.");

  const { smartAccountClient, publicClient, pimlicoClient, scaAddress, payGasWithUsdc, selfPaysGas } =
    await resolveSmartAccount(params);
  if (selfPaysGas) await assertEthForGas(publicClient, scaAddress);

  const amountRaw = BigInt(Math.round(params.amountUsdc * 1_000_000));
  const rawCalls: Call[] = [
    {
      to: USDC_BASE,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [params.toAddress, amountRaw],
      }),
    },
  ];
  if (payGasWithUsdc) {
    await assertUsdcForPaymaster(publicClient, scaAddress, rawCalls);
  }
  const calls = await withGasApprovalCalls(
    pimlicoClient,
    publicClient,
    scaAddress,
    rawCalls,
    payGasWithUsdc,
  );

  const hash = await smartAccountClient.sendTransaction({ calls });
  return hash as string;
}

/**
 * Execute a Li.Fi bridge quote from the Safe (approve spender + bridge tx).
 * Source chain is always Base USDC.
 */
export async function executeLiFiBridgeFromSafe(params: {
  eip1193Provider: EthereumProvider;
  expectedScaAddress: `0x${string}`;
  quote: LiFiBridgeQuote;
} & SafeAccountOpts): Promise<string> {
  const { smartAccountClient, publicClient, pimlicoClient, scaAddress, payGasWithUsdc, selfPaysGas } =
    await resolveSmartAccount(params);
  if (selfPaysGas) await assertEthForGas(publicClient, scaAddress);

  const fromToken = (params.quote.fromToken.address || USDC_BASE) as `0x${string}`;
  const callsRaw = await buildAllowanceAndTxCalls({
    spender: params.quote.approvalAddress as `0x${string}`,
    fromToken,
    fromAmount: BigInt(params.quote.fromAmount),
    scaAddress,
    publicClient,
    tx: {
      to: params.quote.transactionRequest.to as `0x${string}`,
      data: params.quote.transactionRequest.data as `0x${string}`,
      value: BigInt(params.quote.transactionRequest.value ?? "0"),
    },
  });

  if (payGasWithUsdc) {
    await assertUsdcForPaymaster(publicClient, scaAddress, callsRaw);
  }
  const calls = await withGasApprovalCalls(
    pimlicoClient,
    publicClient,
    scaAddress,
    callsRaw,
    payGasWithUsdc,
  );
  const hash = await smartAccountClient.sendTransaction({ calls });
  return hash as string;
}

/**
 * Execute arbitrary calls from the Safe (Morpho, swaps, etc.).
 */
export async function executeCallsFromSafe(params: {
  eip1193Provider: EthereumProvider;
  expectedScaAddress: `0x${string}`;
  calls: Call[];
} & SafeAccountOpts): Promise<string> {
  if (!params.calls.length) throw new Error("No calls to execute.");

  const { smartAccountClient, publicClient, pimlicoClient, scaAddress, payGasWithUsdc, selfPaysGas } =
    await resolveSmartAccount(params);
  if (selfPaysGas) await assertEthForGas(publicClient, scaAddress);

  if (payGasWithUsdc) {
    await assertUsdcForPaymaster(publicClient, scaAddress, params.calls);
  }
  const calls = await withGasApprovalCalls(
    pimlicoClient,
    publicClient,
    scaAddress,
    params.calls,
    payGasWithUsdc,
  );
  const hash = await smartAccountClient.sendTransaction({ calls });
  return hash as string;
}

/**
 * Build approve + swap calls for a Li.Fi quote (no send). Used by Treasury propose path.
 */
export async function buildLiFiSwapCalls(params: {
  expectedScaAddress: `0x${string}`;
  quote: {
    approvalAddress: string;
    fromToken: { address: string };
    fromAmount: string;
    transactionRequest: { to: string; data: string; value?: string };
  };
}): Promise<Call[]> {
  const publicClient: AnyClient = createPublicClient({
    chain: base,
    transport: fallback(rpcUrls().map((url) => http(url))),
  });
  const fromToken = params.quote.fromToken.address as `0x${string}`;
  return buildAllowanceAndTxCalls({
    spender: params.quote.approvalAddress as `0x${string}`,
    fromToken,
    fromAmount: BigInt(params.quote.fromAmount),
    scaAddress: params.expectedScaAddress,
    publicClient,
    tx: {
      to: params.quote.transactionRequest.to as `0x${string}`,
      data: params.quote.transactionRequest.data as `0x${string}`,
      value: BigInt(params.quote.transactionRequest.value ?? "0"),
    },
  });
}

/**
 * Execute a Li.Fi same-chain swap quote from the Safe.
 */
export async function executeLiFiSwapFromSafe(params: {
  eip1193Provider: EthereumProvider;
  expectedScaAddress: `0x${string}`;
  quote: {
    approvalAddress: string;
    fromToken: { address: string };
    fromAmount: string;
    transactionRequest: { to: string; data: string; value?: string };
  };
} & SafeAccountOpts): Promise<string> {
  const { smartAccountClient, publicClient, pimlicoClient, scaAddress, payGasWithUsdc, selfPaysGas } =
    await resolveSmartAccount(params);
  if (selfPaysGas) await assertEthForGas(publicClient, scaAddress);

  const fromToken = params.quote.fromToken.address as `0x${string}`;
  const callsRaw = await buildAllowanceAndTxCalls({
    spender: params.quote.approvalAddress as `0x${string}`,
    fromToken,
    fromAmount: BigInt(params.quote.fromAmount),
    scaAddress,
    publicClient,
    tx: {
      to: params.quote.transactionRequest.to as `0x${string}`,
      data: params.quote.transactionRequest.data as `0x${string}`,
      value: BigInt(params.quote.transactionRequest.value ?? "0"),
    },
  });

  if (payGasWithUsdc) {
    await assertUsdcForPaymaster(publicClient, scaAddress, callsRaw);
  }
  const calls = await withGasApprovalCalls(
    pimlicoClient,
    publicClient,
    scaAddress,
    callsRaw,
    payGasWithUsdc,
  );
  const hash = await smartAccountClient.sendTransaction({ calls });
  return hash as string;
}

export type TypedDataInput = {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
};

/** Sign a plain message as the Safe (Dinari wallet connect). */
export async function signMessageFromSafe(params: {
  eip1193Provider: EthereumProvider;
  expectedScaAddress: `0x${string}`;
  message: string;
} & SafeAccountOpts): Promise<string> {
  const { smartAccountClient } = await resolveSmartAccount(params);
  return (await smartAccountClient.signMessage({ message: params.message })) as string;
}

/** Sign EIP-712 typed data as the Safe (Dinari order permit). */
export async function signTypedDataFromSafe(params: {
  eip1193Provider: EthereumProvider;
  expectedScaAddress: `0x${string}`;
  typedData: TypedDataInput;
} & SafeAccountOpts): Promise<string> {
  const { smartAccountClient } = await resolveSmartAccount(params);
  const { typedData } = params;
  return (await smartAccountClient.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  })) as string;
}

export interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}
