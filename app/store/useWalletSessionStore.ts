/**
 * Session-scoped wallet overrides so dashboard layout can provision SCA once
 * and all useHomeWallet() instances see it immediately (same as mobile global SCA).
 */

import { create } from "zustand";
import { queryClient } from "@/lib/queryClient";

interface WalletSessionState {
  eoaOverride: string | null;
  scaOverride: string | null;
  setEoaOverride: (address: string) => void;
  setScaOverride: (address: string) => void;
  clearWalletSession: () => void;
}

export const useWalletSessionStore = create<WalletSessionState>((set) => ({
  eoaOverride: null,
  scaOverride: null,
  setEoaOverride: (address) => {
    const trimmed = address.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return;
    set({ eoaOverride: trimmed });
  },
  setScaOverride: (address) => {
    const trimmed = address.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return;
    set({ scaOverride: trimmed });
  },
  clearWalletSession: () => {
    set({ eoaOverride: null, scaOverride: null });
    // Balances, positions and history loaded for this wallet go with the session.
    queryClient.clear();
  },
}));
