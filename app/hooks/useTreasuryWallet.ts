"use client";

import { useCallback, useMemo } from "react";
import { useLoad } from "@/hooks/useLoad";
import { selectActiveTreasury, useOrgStore, type OrgTreasury } from "@/store/useOrgStore";
import {
  fetchSafeSigners,
  fetchStablecoinBalances,
  HOME_STABLECOINS,
  type SafeSignerInfo,
  type StablecoinBalances,
} from "@/lib/baseChain";
import type { TreasurySource } from "@/lib/orgTreasury";
import { isTreasurySafeDeployed, treasuryAccountOpts } from "@/lib/treasurySafe";
import type { SafeAccountOpts } from "@/lib/smartAccountSend";
import { syncSetActiveTreasury } from "@/lib/treasurySync";

function isAddress(value: string | null | undefined): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function emptyStableBalances(): StablecoinBalances {
  return Object.fromEntries(HOME_STABLECOINS.map((t) => [t.symbol, 0]));
}

const EMPTY_STABLE_BALANCES = emptyStableBalances();

interface TreasurySafeSnapshot {
  deployed: boolean;
  stableBalances: StablecoinBalances;
  safeSigners: SafeSignerInfo | null;
  signersError: string | null;
}

/** Each part falls back on its own, so one failed read does not blank the rest. */
async function loadTreasurySafe(scaAddress: `0x${string}`): Promise<TreasurySafeSnapshot> {
  const deployed = await isTreasurySafeDeployed(scaAddress).catch(() => false);

  const [stableBalances, signers] = await Promise.all([
    fetchStablecoinBalances(scaAddress).catch(() => emptyStableBalances()),
    deployed
      ? fetchSafeSigners(scaAddress)
          .then((info) => ({ safeSigners: info as SafeSignerInfo | null, signersError: null as string | null }))
          .catch((e) => ({
            safeSigners: null,
            signersError: e instanceof Error ? e.message : "Failed to read Treasury Safe owners",
          }))
      : Promise.resolve({ safeSigners: null, signersError: null }),
  ]);

  return { deployed, stableBalances, ...signers };
}

export interface TreasuryWalletState {
  loading: boolean;
  bound: boolean;
  treasuries: OrgTreasury[];
  active: OrgTreasury | null;
  treasuryId: string | null;
  name: string | null;
  scaAddress: string | null;
  source: TreasurySource | null;
  deployed: boolean;
  accountOpts: SafeAccountOpts;
  stableBalances: StablecoinBalances;
  stablesLoading: boolean;
  safeSigners: SafeSignerInfo | null;
  signersLoading: boolean;
  signersError: string | null;
  error: string | null;
  setActiveTreasury: (id: string | null) => void;
  refresh: () => Promise<void>;
}

export function useTreasuryWallet(): TreasuryWalletState {
  const treasuries = useOrgStore((s) => s.treasuries);
  const activeTreasuryId = useOrgStore((s) => s.activeTreasuryId);
  const setActiveTreasury = useCallback((id: string | null) => {
    void syncSetActiveTreasury(id);
  }, []);

  const active = useMemo(
    () => selectActiveTreasury({ treasuries, activeTreasuryId }),
    [treasuries, activeTreasuryId],
  );

  const scaAddress = active?.address ?? null;
  const source = active?.source ?? null;

  const accountOpts: SafeAccountOpts = isAddress(scaAddress)
    ? treasuryAccountOpts(source, scaAddress, active?.saltNonce)
    : {};

  const valid = isAddress(scaAddress);
  const { data, fetching, error, refresh } = useLoad({
    key: ["treasury", "wallet", valid ? scaAddress.toLowerCase() : null],
    load: () => loadTreasurySafe(scaAddress as `0x${string}`),
    errorMessage: "Failed to load Treasury Safe",
    enabled: valid,
    refreshMs: 90_000,
  });

  const safe = valid ? data : undefined;
  const loading = fetching;
  const deployed = safe?.deployed ?? false;
  const stableBalances = safe?.stableBalances ?? EMPTY_STABLE_BALANCES;
  const stablesLoading = fetching;
  const safeSigners = safe?.safeSigners ?? null;
  const signersLoading = fetching;
  const signersError = safe?.signersError ?? null;

  return {
    loading,
    bound: Boolean(scaAddress),
    treasuries,
    active,
    treasuryId: active?.id ?? null,
    name: active?.name ?? null,
    scaAddress,
    source,
    deployed,
    accountOpts,
    stableBalances,
    stablesLoading,
    safeSigners,
    signersLoading,
    signersError,
    error,
    setActiveTreasury,
    refresh,
  };
}
