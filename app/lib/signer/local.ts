"use client";

/**
 * Signer backed by the browser wallet (no backend, no Privy): the Safe owner is
 * the key held in the password-encrypted vault (lib/localWallet).
 */

import { useMemo, useSyncExternalStore } from "react";
import { base } from "viem/chains";
import { basePublicClient } from "@/lib/baseChain";
import { createLocalEip1193Provider } from "@/lib/localWallet/provider";
import {
  getSnapshot,
  getUnlockedAccount,
  lock,
  subscribe,
  type LocalWalletSnapshot,
} from "@/lib/localWallet/store";
import type { SignerSession, SignerWallet } from "./types";

const SERVER_SNAPSHOT: LocalWalletSnapshot = { status: "unknown", address: null };

/** Vault status for React (`unknown` until storage has been read on the client). */
export function useLocalWallet(): LocalWalletSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
}

/**
 * One provider for the page. It reads the unlocked key on every call, so a
 * provider handed out earlier stops signing the moment the wallet locks.
 */
const localProvider = createLocalEip1193Provider({
  chain: base,
  getAccount: getUnlockedAccount,
  rpcRequest: (args) => basePublicClient.request(args as never),
});

const getEthereumProvider = async () => localProvider;

export function useSignerWallet(_preferAddress?: string | null): SignerWallet | null {
  void _preferAddress;
  const { status, address } = useLocalWallet();
  return useMemo(
    () => (status === "unlocked" && address ? { address, getEthereumProvider } : null),
    [status, address],
  );
}

/** Per-user id for anything keyed by user in this mode. */
export function localUserId(address: string): string {
  return `local:${address.toLowerCase()}`;
}

async function lockWallet(): Promise<void> {
  lock();
}

export function useSignerSession(): SignerSession {
  const { status, address } = useLocalWallet();
  const authenticated = status === "unlocked" && !!address;
  return {
    ready: status !== "unknown",
    authenticated,
    userId: authenticated && address ? localUserId(address) : null,
    logout: lockWallet,
  };
}
