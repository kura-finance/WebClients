"use client";

import {
  fetchPendingMultisigTxs,
  type SafeMultisigTx,
} from "@/lib/safeTxService";
import { useLoad } from "@/hooks/useLoad";

const NO_TXS: SafeMultisigTx[] = [];

export function useTreasuryPendingTxs(safeAddress: string | null) {
  const valid = !!safeAddress && /^0x[a-fA-F0-9]{40}$/i.test(safeAddress);

  const { data, fetching, error, refresh } = useLoad({
    key: ["treasury", "pending-txs", safeAddress?.toLowerCase() ?? null],
    load: () => fetchPendingMultisigTxs(safeAddress as string),
    errorMessage: "Failed to load pending Safe transactions",
    enabled: valid,
    refreshMs: 45_000,
  });

  // A failed load shows an empty queue rather than a stale one: a transaction
  // that looks pending may already have been executed.
  return { txs: valid && !error ? (data ?? NO_TXS) : NO_TXS, loading: fetching, error, refresh };
}
