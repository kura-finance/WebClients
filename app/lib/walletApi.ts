/**
 * Wallet API — /api/wallet
 *
 *   GET  /api/wallet        → { walletAddress, scaAddress }
 *   PUT  /api/wallet/sca    → { scaAddress }
 *   PUT  /api/wallet/eoa    → { walletAddress }
 *
 * Without a backend there is no wallet record: reads return an empty record and
 * saves are no-ops. Addresses then come from Privy (EOA) and local derivation
 * (personal Safe — see lib/personalSafe.ts) via useWalletSessionStore.
 */

import { ApiError } from "./errorHandler";
import { requestJson } from "./httpClient";
import { features } from "@/config/features";

const apiName = "WalletApi";

export interface WalletRecord {
  /** Privy embedded EOA address */
  walletAddress: string | null;
  /** Smart Wallet (ERC-4337 Safe SCA) address on Base */
  scaAddress: string | null;
}

export async function fetchWalletRecord(): Promise<WalletRecord> {
  if (!features.backend) return { walletAddress: null, scaAddress: null };
  try {
    return await requestJson<WalletRecord>("/api/wallet", { method: "GET" }, apiName);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { walletAddress: null, scaAddress: null };
    }
    return { walletAddress: null, scaAddress: null };
  }
}

export async function saveScaAddress(scaAddress: string): Promise<void> {
  if (!features.backend) return;
  await requestJson<WalletRecord>(
    "/api/wallet/sca",
    { method: "PUT", body: JSON.stringify({ scaAddress }) },
    apiName,
  );
}

export async function saveEoaAddress(walletAddress: string): Promise<void> {
  if (!features.backend) return;
  await requestJson<WalletRecord>(
    "/api/wallet/eoa",
    { method: "PUT", body: JSON.stringify({ walletAddress }) },
    apiName,
  );
}
