"use client";

/**
 * Smart Wallet setup — mirrors mobile `useKuraCardWallet` provision:
 *   compute counterfactual Safe (salt 0) → PUT /api/wallet/sca (+ eoa)
 * The owner EOA comes from the signer: Privy with a backend, the browser wallet
 * without one (then nothing is saved remotely).
 * Does not deploy on-chain; first UserOp deploys like mobile.
 */

import { useEffect, useRef } from "react";
import { isSignerConfigured, useSignerWallet } from "@/lib/signer";
import { computePersonalSafeAddress } from "@/lib/personalSafe";
import { saveEoaAddress, saveScaAddress } from "@/lib/walletApi";

interface PrivySafeSetupProps {
  /** Existing SCA from GET /api/wallet (or session). Skip compute when set. */
  persistedSca: string | null;
  onSca: (address: string) => void;
  onError?: (message: string) => void;
}

export default function PrivySafeSetup({ persistedSca, onSca, onError }: PrivySafeSetupProps) {
  const signerWallet = useSignerWallet();
  const busyRef = useRef(false);
  const doneRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isSignerConfigured) return;

    if (persistedSca) {
      onSca(persistedSca);
      doneRef.current = persistedSca.toLowerCase();
      return;
    }

    if (!signerWallet) return;
    if (busyRef.current) return;
    if (doneRef.current) return;

    busyRef.current = true;

    void (async () => {
      try {
        const provider = (await signerWallet.getEthereumProvider()) as {
          request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
        };
        const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
        const eoa = accounts[0];
        if (!eoa) throw new Error("Privy wallet has no account.");

        const sca = await computePersonalSafeAddress(provider);

        await Promise.all([
          saveScaAddress(sca).catch((err) => {
            console.warn("[PrivySafeSetup] Failed to save SCA", err);
            throw err;
          }),
          saveEoaAddress(eoa).catch((err) => {
            console.warn("[PrivySafeSetup] Failed to save EOA", err);
          }),
        ]);

        doneRef.current = sca.toLowerCase();
        onSca(sca);
      } catch (e) {
        busyRef.current = false;
        doneRef.current = null;
        const msg = e instanceof Error ? e.message : "Failed to set up Smart Wallet.";
        console.error("[PrivySafeSetup]", msg);
        onError?.(msg);
      } finally {
        busyRef.current = false;
      }
    })();
  }, [signerWallet, persistedSca, onSca, onError]);

  return null;
}
