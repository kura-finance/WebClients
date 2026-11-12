"use client";

/**
 * Dashboard-wide Privy wallet bootstrap (EOA + personal Smart Wallet SCA).
 * Mirrors mobile card wallet provision so web-first signups get a Smart Wallet address.
 * Also hydrates Treasury workspace from /api/treasuries (migrates localStorage once).
 */

import { useCallback, useEffect, useState } from "react";
import { fetchWalletRecord } from "@/lib/walletApi";
import {
  hydrateTreasuryWorkspace,
  resetTreasurySyncProbe,
} from "@/lib/treasurySync";
import { useWalletSessionStore } from "@/store/useWalletSessionStore";
import { isSignerConfigured } from "@/lib/signer";
import PrivyEoaSync from "@/components/wallet/PrivyEoaSync";
import PrivySafeSetup from "@/components/wallet/PrivySafeSetup";

export default function DashboardWalletBootstrap() {
  const setEoaOverride = useWalletSessionStore((s) => s.setEoaOverride);
  const setScaOverride = useWalletSessionStore((s) => s.setScaOverride);
  const [persistedEoa, setPersistedEoa] = useState<string | null>(null);
  const [persistedSca, setPersistedSca] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        resetTreasurySyncProbe();
        const record = await fetchWalletRecord();
        if (cancelled) return;
        setPersistedEoa(record.walletAddress);
        setPersistedSca(record.scaAddress);
        if (record.walletAddress) setEoaOverride(record.walletAddress);
        if (record.scaAddress) setScaOverride(record.scaAddress);
        await hydrateTreasuryWorkspace();
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setEoaOverride, setScaOverride]);

  const onEoa = useCallback(
    (address: string) => {
      setEoaOverride(address);
    },
    [setEoaOverride],
  );

  const onSca = useCallback(
    (address: string) => {
      setScaOverride(address);
      setPersistedSca(address);
    },
    [setScaOverride],
  );

  if (!isSignerConfigured || !loaded) return null;

  return (
    <>
      <PrivyEoaSync onEoa={onEoa} persistedEoa={persistedEoa} />
      <PrivySafeSetup persistedSca={persistedSca} onSca={onSca} />
    </>
  );
}
