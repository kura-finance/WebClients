"use client";

import { useCallback, useState } from "react";
import { useLoad } from "@/hooks/useLoad";
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

const EMPTY_STABLE_BALANCES = emptyStableBalances();
const NO_RECORD: WalletRecord = { walletAddress: null, scaAddress: null };

interface WalletBalances {
  stableBalances: StablecoinBalances;
  ethBalance: number;
  safeSigners: SafeSignerInfo | null;
  signersError: string | null;
}

/** Each part falls back on its own, so one failed read does not blank the rest. */
async function loadWalletBalances(sca: string | null, eoa: string | null): Promise<WalletBalances> {
  const [stableBalances, ethBalance, signers] = await Promise.all([
    isAddress(sca)
      ? fetchStablecoinBalances(sca).catch(() => emptyStableBalances())
      : emptyStableBalances(),
    isAddress(eoa) ? fetchEthBalance(eoa).catch(() => 0) : 0,
    isAddress(sca)
      ? fetchSafeSigners(sca)
          .then((info) => ({
            safeSigners: info as SafeSignerInfo | null,
            signersError: null as string | null,
          }))
          .catch((e) => ({
            safeSigners: null,
            // Undeployed counterfactual Safe is expected until first UserOp.
            signersError: e instanceof Error ? e.message : "Failed to read Safe owners (Base RPC)",
          }))
      : { safeSigners: null, signersError: null },
  ]);
  return { stableBalances, ethBalance, ...signers };
}

export function useHomeWallet(): HomeWalletState {
  const scaOverride = useWalletSessionStore((s) => s.scaOverride);
  const eoaOverride = useWalletSessionStore((s) => s.eoaOverride);

  // Addresses set by this view before the wallet record / session store has them.
  const [localEoa, setLocalEoa] = useState<string | null>(null);
  const [localSca, setLocalSca] = useState<string | null>(null);

  const recordQuery = useLoad({
    key: ["wallet", "record"],
    load: fetchWalletRecord,
    errorMessage: "Failed to load wallet",
    refreshMs: 90_000,
  });
  const record = recordQuery.data ?? NO_RECORD;

  const scaAddress = scaOverride ?? localSca ?? record.scaAddress;
  const eoaAddress = localEoa ?? eoaOverride ?? record.walletAddress;

  // Reloads by itself whenever either address changes.
  const balancesQuery = useLoad({
    key: ["wallet", "balances", scaAddress?.toLowerCase() ?? null, eoaAddress?.toLowerCase() ?? null],
    load: () => loadWalletBalances(scaAddress, eoaAddress),
    errorMessage: "Failed to load wallet",
    // Wait for the wallet record so a signed-in user is not shown empty balances first.
    enabled: recordQuery.data !== undefined || recordQuery.error !== null,
    refreshMs: 90_000,
  });
  const balances = balancesQuery.data;

  const loading = recordQuery.fetching || balancesQuery.loading;
  const provisioning = !loading && !scaAddress && Boolean(eoaAddress);

  const stableBalances = balances?.stableBalances ?? EMPTY_STABLE_BALANCES;
  const ethBalance = balances?.ethBalance ?? 0;
  const safeSigners = balances?.safeSigners ?? null;
  const signersError = balances?.signersError ?? null;
  const stablesLoading = balancesQuery.fetching;
  const ethLoading = balancesQuery.fetching;
  const signersLoading = balancesQuery.fetching;
  const error = recordQuery.error;

  const refreshRecord = recordQuery.refresh;
  const refreshBalances = balancesQuery.refresh;
  const refresh = useCallback(async () => {
    await refreshRecord();
    await refreshBalances();
  }, [refreshRecord, refreshBalances]);

  const applyEoaAddress = useCallback((address: string | null) => {
    if (address) setLocalEoa(address);
  }, []);

  const applyScaAddress = useCallback((address: string | null) => {
    if (address) setLocalSca(address);
  }, []);

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
