"use client";

/**
 * Smart Wallet setup — mirrors mobile `useKuraCardWallet` provision:
 *   compute counterfactual Safe (salt 0) → PUT /api/wallet/sca (+ eoa)
 * The owner EOA comes from the signer: Privy with a backend, the browser wallet
 * without one (then nothing is saved remotely).
 * Does not deploy on-chain; first UserOp deploys like mobile.
 */

import { useEffect, useRef } from "react";
import { features } from "@/config/features";
import { isSignerConfigured, useSignerWallet } from "@/lib/signer";
import {
  computePersonalSafeAddress,
  readCachedPersonalSafe,
  writeCachedPersonalSafe,
} from "@/lib/personalSafe";
import { saveEoaAddress, saveScaAddress } from "@/lib/walletApi";

interface PersonalSafeSetupProps {
  /** Existing SCA from GET /api/wallet (or session). Skip compute when set. */
  persistedSca: string | null;
  onSca: (address: string) => void;
  onError?: (message: string) => void;
}

/** Waits between attempts to derive the address; the last one repeats. */
const RETRY_DELAYS_MS = [1_500, 4_000, 10_000, 30_000];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export default function PersonalSafeSetup({ persistedSca, onSca, onError }: PersonalSafeSetupProps) {
  const signerWallet = useSignerWallet();
  const busyRef = useRef(false);
  const doneRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
        if (!eoa) throw new Error("Signer wallet has no account.");

        // Without a backend nothing remembers the address between visits: show
        // the one derived last time now, then confirm it below.
        const cached = features.backend ? null : readCachedPersonalSafe(eoa);
        if (cached) onSca(cached);

        // Deriving the address reads the Safe factory over RPC. Public Base RPCs
        // rate-limit, so keep trying instead of leaving the wallet "setting up".
        let sca: `0x${string}`;
        for (let attempt = 0; ; attempt++) {
          try {
            sca = await computePersonalSafeAddress(provider);
            break;
          } catch (e) {
            if (!mountedRef.current) return;
            if (attempt === 0) {
              const msg = e instanceof Error ? e.message : "Failed to set up Smart Wallet.";
              console.warn("[PersonalSafeSetup] Retrying:", msg);
              onError?.(msg);
            }
            await sleep(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]!);
            if (!mountedRef.current) return;
          }
        }
        if (!mountedRef.current) return;

        if (!features.backend) writeCachedPersonalSafe(eoa, sca);

        await Promise.all([
          saveScaAddress(sca).catch((err) => {
            console.warn("[PersonalSafeSetup] Failed to save SCA", err);
            throw err;
          }),
          saveEoaAddress(eoa).catch((err) => {
            console.warn("[PersonalSafeSetup] Failed to save EOA", err);
          }),
        ]);

        doneRef.current = sca.toLowerCase();
        if (sca.toLowerCase() !== cached?.toLowerCase()) onSca(sca);
      } catch (e) {
        doneRef.current = null;
        const msg = e instanceof Error ? e.message : "Failed to set up Smart Wallet.";
        console.error("[PersonalSafeSetup]", msg);
        onError?.(msg);
      } finally {
        busyRef.current = false;
      }
    })();
  }, [signerWallet, persistedSca, onSca, onError]);

  return null;
}
