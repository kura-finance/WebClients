"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchWalletRecord, type WalletRecord } from "@/lib/walletApi";
import {
  fetchEthBalance,
  fetchSafeSigners,
  fetchStablecoinBalances,
  HOME_STABLECOINS,
  type SafeSignerInfo,
  type StablecoinBalances,
} from "@/lib/baseChain";
import { useWalletSessionStore } from "@/store/useWalletSessionStore";

function isAddress(value: string | null | undefined): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function emptyStableBalances(): StablecoinBalances {
  return Object.fromEntries(HOME_STABLECOINS.map((t) => [t.symbol, 0]));
}

export interface HomeWalletState {
  loading: boolean;
  /** True while Smart Wallet address is being computed / saved (web-first signup). */
  provisioning: boolean;
  record: WalletRecord;
  scaAddress: string | null;
  stableBalances: StablecoinBalances;
  stablesLoading: boolean;
  eoaAddress: string | null;
  ethBalance: number;
  ethLoading: boolean;
  /** Safe owners from on-chain getOwners() */
  safeSigners: SafeSignerInfo | null;
  signersLoading: boolean;
  /** Why getOwners failed (RPC / undeployed / not a Safe). */
  signersError: string | null;
  error: string | null;
  refresh: () => Promise<void>;
  applyEoaAddress: (address: string | null) => void;
  applyScaAddress: (address: string | null) => void;
}

export function useHomeWallet(): HomeWalletState {
  const scaOverride = useWalletSessionStore((s) => s.scaOverride);
  const eoaOverride = useWalletSessionStore((s) => s.eoaOverride);

  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState<WalletRecord>({ walletAddress: null, scaAddress: null });
  const [localEoa, setLocalEoa] = useState<string | null>(null);
  const [stableBalances, setStableBalances] = useState<StablecoinBalances>(emptyStableBalances);
  const [stablesLoading, setStablesLoading] = useState(false);
  const [ethBalance, setEthBalance] = useState(0);
  const [ethLoading, setEthLoading] = useState(false);
  const [safeSigners, setSafeSigners] = useState<SafeSignerInfo | null>(null);
  const [signersLoading, setSignersLoading] = useState(false);
  const [signersError, setSignersError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scaAddress = scaOverride ?? record.scaAddress;
  const eoaAddress = localEoa ?? eoaOverride ?? record.walletAddress;
  const provisioning = !loading && !scaAddress && Boolean(eoaAddress);

  const refreshBalances = useCallback(async (sca: string | null, eoa: string | null) => {
    setStablesLoading(true);
    setEthLoading(true);
    setSignersLoading(true);
    try {
      await Promise.all([
        isAddress(sca)
          ? fetchStablecoinBalances(sca)
              .then(setStableBalances)
              .catch(() => setStableBalances(emptyStableBalances()))
          : Promise.resolve(setStableBalances(emptyStableBalances())),
        isAddress(eoa)
          ? fetchEthBalance(eoa)
              .then(setEthBalance)
              .catch(() => setEthBalance(0))
          : Promise.resolve(setEthBalance(0)),
        isAddress(sca)
          ? fetchSafeSigners(sca)
              .then((info) => {
                setSafeSigners(info);
                setSignersError(null);
              })
              .catch((e) => {
                setSafeSigners(null);
                // Undeployed counterfactual Safe is expected until first UserOp.
                setSignersError(
                  e instanceof Error ? e.message : "Failed to read Safe owners (Base RPC)",
                );
              })
          : Promise.resolve(
              (() => {
                setSafeSigners(null);
                setSignersError(null);
              })(),
            ),
      ]);
    } finally {
      setStablesLoading(false);
      setEthLoading(false);
      setSignersLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchWalletRecord();
      setRecord(next);
      const session = useWalletSessionStore.getState();
      const eoa = localEoa ?? session.eoaOverride ?? next.walletAddress;
      const sca = session.scaOverride ?? next.scaAddress;
      await refreshBalances(sca, eoa);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load wallet");
    } finally {
      setLoading(false);
    }
  }, [localEoa, refreshBalances]);

  const applyEoaAddress = useCallback(
    (address: string | null) => {
      if (!address) return;
      setLocalEoa(address);
      void refreshBalances(scaAddress, address);
    },
    [scaAddress, refreshBalances],
  );

  const applyScaAddress = useCallback(
    (address: string | null) => {
      if (!address) return;
      setRecord((prev) => ({ ...prev, scaAddress: address }));
      void refreshBalances(address, eoaAddress);
    },
    [eoaAddress, refreshBalances],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!scaOverride && !eoaOverride) return;
    void refreshBalances(
      scaOverride ?? record.scaAddress,
      localEoa ?? eoaOverride ?? record.walletAddress,
    );
  }, [
    scaOverride,
    eoaOverride,
    localEoa,
    record.scaAddress,
    record.walletAddress,
    refreshBalances,
  ]);

  useEffect(() => {
    const id = setInterval(() => {
      void refresh();
    }, 90_000);
    return () => clearInterval(id);
  }, [refresh]);

  return {
    loading,
    provisioning,
    record: {
      walletAddress: eoaAddress,
      scaAddress,
    },
    scaAddress,
    stableBalances,
    stablesLoading,
    eoaAddress,
    ethBalance,
    ethLoading,
    safeSigners,
    signersLoading,
    signersError,
    error,
    refresh,
    applyEoaAddress,
    applyScaAddress,
  };
}
