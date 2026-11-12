"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Receipt } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useHomeWallet } from "@/hooks/useHomeWallet";
import { useWalletActivityHistory } from "@/hooks/useWalletActivity";
import type { WalletActivity } from "@/hooks/useWalletActivity";
import { isSignerConfigured } from "@/lib/signer";
import PrivyEoaSync from "@/components/wallet/PrivyEoaSync";
import WalletTxRow, { WalletTxRowSkeleton } from "@/components/wallet/WalletTxRow";
import { WalletTxDetailModal } from "@/components/wallet/WalletHistorySection";
import { Button } from "@/components/ui/button";
import {
  DashboardPage,
  PageAlert,
  PageHeader,
  Panel,
} from "@/components/dashboard/PageShell";

export default function WalletHistoryPage() {
  const isBalanceHidden = useAppStore((s) => s.isBalanceHidden);
  const wallet = useHomeWallet();
  const {
    activities,
    loading,
    loadingMore,
    error,
    hasMore,
    monthsLoaded,
    refresh,
    loadMore,
  } = useWalletActivityHistory(wallet.scaAddress);

  const [selected, setSelected] = useState<WalletActivity | null>(null);

  return (
    <DashboardPage>
      {isSignerConfigured ? (
        <PrivyEoaSync onEoa={wallet.applyEoaAddress} persistedEoa={wallet.record.walletAddress} />
      ) : null}

      <PageHeader
        eyebrow="Activity"
        title="All history"
        description="Smart Wallet transfers, deposits, and withdrawals — loaded one month at a time."
        actions={
          <>
            <Button asChild size="sm" variant="ghost" className="rounded-full">
              <Link href="/dashboard">
                <ArrowLeft className="h-3.5 w-3.5" />
                Home
              </Link>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => void refresh()}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Refresh
            </Button>
          </>
        }
      />

      {error ? <PageAlert variant="warning">{error}</PageAlert> : null}

      <Panel padding="none" className="overflow-hidden">
        {loading && activities.length === 0 ? (
          <div>
            {Array.from({ length: 8 }).map((_, i) => (
              <WalletTxRowSkeleton key={i} />
            ))}
          </div>
        ) : !loading && activities.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <Receipt className="mb-2 h-8 w-8 text-[var(--kura-text-secondary)] opacity-50" />
            <p className="text-sm text-[var(--kura-text-secondary)]">
              {wallet.scaAddress
                ? "No transactions yet"
                : "Connect your Smart Wallet to see history"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--kura-border)]">
            {activities.map((tx) => (
              <WalletTxRow
                key={tx.id}
                tx={tx}
                hidden={isBalanceHidden}
                onClick={setSelected}
              />
            ))}
          </div>
        )}

        {hasMore ? (
          <div className="border-t border-[var(--kura-border)] p-4">
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-xl"
              disabled={loadingMore || loading}
              onClick={() => void loadMore()}
            >
              {loadingMore ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading previous month…
                </>
              ) : (
                "Load previous month"
              )}
            </Button>
            <p className="mt-2 text-center text-[11px] text-[var(--kura-text-secondary)]">
              Showing {activities.length} · {monthsLoaded} month
              {monthsLoaded === 1 ? "" : "s"} loaded
            </p>
          </div>
        ) : activities.length > 0 ? (
          <p className="border-t border-[var(--kura-border)] py-3.5 text-center text-[11px] text-[var(--kura-text-secondary)]">
            End of history · {activities.length} total
          </p>
        ) : null}
      </Panel>

      <WalletTxDetailModal
        selected={selected}
        onClose={() => setSelected(null)}
        hidden={isBalanceHidden}
      />
    </DashboardPage>
  );
}
