/**
 * Safe Transaction Service (Base) — pending multisig queue for Treasury, and
 * the transfer history of every Safe (see lib/chain/walletTransfers.ts).
 * https://api.safe.global/tx-service/base
 */

import {
  encodeFunctionData,
  erc20Abi,
  hashTypedData,
  parseUnits,
  type Hex,
  type WalletClient,
} from "viem";
import { USDC_BASE } from "@/lib/baseChain";

/**
 * The service moved here from safe-transaction-base.safe.global, which now
 * answers with a redirect to this host.
 */
export const SAFE_TX_SERVICE_URL = "https://api.safe.global/tx-service/base";
export const SAFE_TX_SERVICE_BASE = `${SAFE_TX_SERVICE_URL}/api`;

const ZERO = "0x0000000000000000000000000000000000000000" as const;

export interface SafeTxConfirmation {
  owner: string;
  submissionDate: string;
  signature: string;
  signatureType?: string;
}

export interface SafeMultisigTx {
  safe: string;
  to: string;
  value: string;
  data: string | null;
  operation: number;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: string;
  refundReceiver: string;
  nonce: number;
  safeTxHash: string;
  submissionDate: string;
  executionDate: string | null;
  isExecuted: boolean;
  isSuccessful: boolean | null;
  confirmationsRequired: number;
  confirmations: SafeTxConfirmation[] | null;
  proposer?: string | null;
  trusted?: boolean;
  dataDecoded?: {
    method?: string;
    parameters?: { name: string; type: string; value: string | string[] }[];
  } | null;
}

export interface SafeInfo {
  address: string;
  nonce: number;
  threshold: number;
  owners: string[];
}

type ProposeBody = {
  to: string;
  value: string;
  data: string;
  operation: number;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: string;
  refundReceiver: string;
  nonce: number;
  contractTransactionHash: string;
  sender: string;
  signature: string;
};

async function txServiceFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SAFE_TX_SERVICE_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string; message?: string };
      detail = body.detail || body.message || JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(`Safe TX Service: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function fetchSafeInfo(safeAddress: string): Promise<SafeInfo> {
  return txServiceFetch<SafeInfo>(`/v1/safes/${safeAddress}/`);
}

/** Safes on Base where `ownerAddress` is an on-chain owner (Safe TX Service). */
export async function fetchSafesByOwner(
  ownerAddress: string,
): Promise<`0x${string}`[]> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(ownerAddress)) {
    throw new Error("Invalid owner address.");
  }
  const data = await txServiceFetch<{ safes?: string[] }>(
    `/v1/owners/${ownerAddress}/safes/`,
  );
  const out: `0x${string}`[] = [];
  const seen = new Set<string>();
  for (const raw of data.safes ?? []) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) continue;
    const lower = raw.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(raw as `0x${string}`);
  }
  return out;
}

/** Pending (not executed) multisig transactions for a Safe. */
export async function fetchPendingMultisigTxs(
  safeAddress: string,
): Promise<SafeMultisigTx[]> {
  const page = await txServiceFetch<{
    count: number;
    results: SafeMultisigTx[];
  }>(
    `/v1/safes/${safeAddress}/multisig-transactions/?executed=false&ordering=-nonce&limit=50`,
  );
  return (page.results ?? []).filter((tx) => !tx.isExecuted);
}

export function confirmationCount(tx: SafeMultisigTx): number {
  return tx.confirmations?.length ?? 0;
}

export function hasOwnerConfirmed(
  tx: SafeMultisigTx,
  owner: string | null | undefined,
): boolean {
  if (!owner) return false;
  const target = owner.toLowerCase();
  return (tx.confirmations ?? []).some((c) => c.owner.toLowerCase() === target);
}

export function isReadyToExecute(tx: SafeMultisigTx): boolean {
  return confirmationCount(tx) >= Math.max(1, tx.confirmationsRequired);
}

/** Human-readable summary for USDC / generic Safe txs. */
export function summarizeSafeTx(tx: SafeMultisigTx): {
  title: string;
  subtitle: string;
  amountUsdc: number | null;
  toAddress: string | null;
} {
  const method = tx.dataDecoded?.method;
  const params = tx.dataDecoded?.parameters ?? [];
  if (method === "transfer" && tx.to.toLowerCase() === USDC_BASE.toLowerCase()) {
    const to =
      (params.find((p) => p.name === "to" || p.name === "recipient")?.value as string) ??
      null;
    const raw = params.find((p) => p.name === "value" || p.name === "amount")?.value;
    const amountUsdc =
      typeof raw === "string" ? Number(raw) / 1e6 : null;
    return {
      title: "Send USDC",
      subtitle: to ? `To ${to.slice(0, 6)}…${to.slice(-4)}` : "ERC-20 transfer",
      amountUsdc: Number.isFinite(amountUsdc) ? amountUsdc : null,
      toAddress: to,
    };
  }
  if (method) {
    return {
      title: method,
      subtitle: `To ${tx.to.slice(0, 6)}…${tx.to.slice(-4)} · nonce ${tx.nonce}`,
      amountUsdc: null,
      toAddress: tx.to,
    };
  }
  const valueEth = Number(tx.value) / 1e18;
  return {
    title: valueEth > 0 ? "Send ETH" : "Contract call",
    subtitle: `To ${tx.to.slice(0, 6)}…${tx.to.slice(-4)} · nonce ${tx.nonce}`,
    amountUsdc: null,
    toAddress: tx.to,
  };
}

const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export type SafeTxFields = {
  to: `0x${string}`;
  value: bigint;
  data: Hex;
  operation: number;
  safeTxGas: bigint;
  baseGas: bigint;
  gasPrice: bigint;
  gasToken: `0x${string}`;
  refundReceiver: `0x${string}`;
  nonce: bigint;
};

export function buildUsdcTransferSafeTx(params: {
  to: `0x${string}`;
  amountUsdc: number;
  nonce: number;
}): SafeTxFields {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [params.to, parseUnits(String(params.amountUsdc), 6)],
  });
  return buildSafeTx({
    to: USDC_BASE,
    data,
    nonce: params.nonce,
  });
}

/** Generic Safe tx fields (gas fields zeroed — Service / exec fill as needed). */
export function buildSafeTx(params: {
  to: `0x${string}`;
  data: Hex;
  value?: bigint;
  operation?: number;
  nonce: number;
}): SafeTxFields {
  return {
    to: params.to,
    value: params.value ?? BigInt(0),
    data: params.data,
    operation: params.operation ?? 0,
    safeTxGas: BigInt(0),
    baseGas: BigInt(0),
    gasPrice: BigInt(0),
    gasToken: ZERO,
    refundReceiver: ZERO,
    nonce: BigInt(params.nonce),
  };
}

export async function signSafeTx(params: {
  walletClient: WalletClient;
  account: `0x${string}`;
  safeAddress: `0x${string}`;
  chainId: number;
  tx: SafeTxFields;
}): Promise<{ signature: Hex; safeTxHash: Hex }> {
  const message = {
    to: params.tx.to,
    value: params.tx.value,
    data: params.tx.data,
    operation: params.tx.operation,
    safeTxGas: params.tx.safeTxGas,
    baseGas: params.tx.baseGas,
    gasPrice: params.tx.gasPrice,
    gasToken: params.tx.gasToken,
    refundReceiver: params.tx.refundReceiver,
    nonce: params.tx.nonce,
  };

  const signature = await params.walletClient.signTypedData({
    account: params.account,
    domain: {
      chainId: params.chainId,
      verifyingContract: params.safeAddress,
    },
    types: SAFE_TX_TYPES,
    primaryType: "SafeTx",
    message,
  });

  const safeTxHash = hashTypedData({
    domain: {
      chainId: params.chainId,
      verifyingContract: params.safeAddress,
    },
    types: SAFE_TX_TYPES,
    primaryType: "SafeTx",
    message,
  });

  return { signature: signature as Hex, safeTxHash };
}

/**
 * Adjust ECDSA signature for Safe: some wallets return v=0/1; Safe wants 27/28.
 * For eth_sign (personal), Safe wants v += 4 → 31/32. Typed data stays 27/28.
 */
export function normalizeSafeSignature(signature: Hex): Hex {
  const sig = signature.toLowerCase();
  if (!sig.startsWith("0x") || sig.length !== 132) return signature;
  const v = Number.parseInt(sig.slice(130, 132), 16);
  if (v === 0 || v === 1) {
    return `${sig.slice(0, 130)}${(v + 27).toString(16).padStart(2, "0")}` as Hex;
  }
  return signature;
}

export async function proposeMultisigTx(params: {
  safeAddress: string;
  sender: string;
  tx: SafeTxFields;
  safeTxHash: string;
  signature: string;
}): Promise<void> {
  const body: ProposeBody = {
    to: params.tx.to,
    value: params.tx.value.toString(),
    data: params.tx.data,
    operation: params.tx.operation,
    safeTxGas: params.tx.safeTxGas.toString(),
    baseGas: params.tx.baseGas.toString(),
    gasPrice: params.tx.gasPrice.toString(),
    gasToken: params.tx.gasToken,
    refundReceiver: params.tx.refundReceiver,
    nonce: Number(params.tx.nonce),
    contractTransactionHash: params.safeTxHash,
    sender: params.sender,
    signature: normalizeSafeSignature(params.signature as Hex),
  };
  await txServiceFetch(`/v1/safes/${params.safeAddress}/multisig-transactions/`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function confirmMultisigTx(params: {
  safeTxHash: string;
  signature: string;
}): Promise<void> {
  await txServiceFetch(`/v1/multisig-transactions/${params.safeTxHash}/confirmations/`, {
    method: "POST",
    body: JSON.stringify({
      signature: normalizeSafeSignature(params.signature as Hex),
    }),
  });
}

export function fieldsFromMultisigTx(tx: SafeMultisigTx): SafeTxFields {
  return {
    to: tx.to as `0x${string}`,
    value: BigInt(tx.value || "0"),
    data: (tx.data || "0x") as Hex,
    operation: tx.operation,
    safeTxGas: BigInt(tx.safeTxGas || "0"),
    baseGas: BigInt(tx.baseGas || "0"),
    gasPrice: BigInt(tx.gasPrice || "0"),
    gasToken: (tx.gasToken || ZERO) as `0x${string}`,
    refundReceiver: (tx.refundReceiver || ZERO) as `0x${string}`,
    nonce: BigInt(tx.nonce),
  };
}

/** Pack confirmations sorted by owner for Safe.execTransaction. */
export function packConfirmations(tx: SafeMultisigTx): Hex {
  const list = [...(tx.confirmations ?? [])].sort((a, b) =>
    a.owner.toLowerCase().localeCompare(b.owner.toLowerCase()),
  );
  return `0x${list.map((c) => c.signature.replace(/^0x/i, "")).join("")}` as Hex;
}

export const SAFE_EXEC_ABI = [
  {
    type: "function",
    name: "execTransaction",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "signatures", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;
