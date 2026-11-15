"use client";

/**
 * Signer backed by Privy (backend mode): the Safe owner is the Privy embedded
 * EOA. Must only run under <PrivyProvider>.
 */

import { useMemo } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import type { SignerSession, SignerWallet } from "./types";

/**
 * The Privy embedded wallet, else the first connected wallet. Pass
 * `preferAddress` to try that address before falling back to the first wallet.
 */
export function useSignerWallet(preferAddress?: string | null): SignerWallet | null {
  const { wallets } = useWallets();
  const usePreferred = preferAddress !== undefined;
  return useMemo(() => {
    return (
      wallets.find((w) => w.walletClientType === "privy") ??
      (usePreferred
        ? wallets.find((w) => w.address?.toLowerCase() === preferAddress?.toLowerCase())
        : undefined) ??
      wallets[0] ??
      null
    );
  }, [wallets, usePreferred, preferAddress]);
}

export function useSignerSession(): SignerSession {
  const { ready, authenticated, user, logout } = usePrivy();
  return { ready, authenticated, userId: user?.id ?? null, logout };
}
