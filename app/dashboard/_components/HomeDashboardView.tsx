"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Briefcase,
  HandCoins,
  LineChart,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useHomeWallet } from "@/hooks/useHomeWallet";
import { useWalletActivity } from "@/hooks/useWalletActivity";
import { useHomeSummaryCards } from "@/hooks/useHomeSummaryCards";
import { HOME_STABLECOINS } from "@/lib/baseChain";
import { cryptoLogoUrl } from "@/lib/assetLogos";
import { isPrivyConfigured } from "@/config/env";
import { features } from "@/config/features";
import PrivyEoaSync from "@/components/wallet/PrivyEoaSync";
import HomeStableSwapPanel from "@/components/wallet/HomeStableSwapPanel";
import WalletHistorySection from "@/components/wallet/WalletHistorySection";
import AssetIcon from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import {
  DashboardPage,
  PageAlert,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/dashboard/PageShell";

function truncate(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatToken(value: number, digits = 4): string {
  if (value === 0) return "0.00";
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function formatUsd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STABLE_COLORS: Record<string, string> = {
  USDC: "#2775CA",
  EURC: "#1E4BD2",
  DAI: "#F5AC37",
  XSGD: "#E31C23",
  AUDD: "#00843D",
  BRZ: "#009C3B",
  MXNe: "#006847",
};

export default function HomeDashboardView() {
  const isBalanceHidden = useAppStore((s) => s.isBalanceHidden);
  const displayName = useAppStore((s) => s.userProfile.displayName)?.trim();
  const email = useAppStore((s) => s.userProfile.email)?.trim();
  const firstName =
    displayName?.split(/\s+/)[0] ||
    (email ? email.split("@")[0] : null) ||
    "there";

  const wallet = useHomeWallet();
  const summary = useHomeSummaryCards();
  const { activities, loading: activityLoading, error: activityError, refresh: refreshActivity } =
    useWalletActivity(wallet.scaAddress);

  const cashRows = useMemo(
    () =>
      HOME_STABLECOINS.map((token) => ({
        token,
        amount: wallet.stableBalances[token.symbol] ?? 0,
      })),
    [wallet.stableBalances],
  );

  const refreshing = wallet.loading || summary.loading || activityLoading;

  const handleRefresh = () => {
    void wallet.refresh();
    void summary.refresh();
    void refreshActivity();
  };

  return (
    <DashboardPage>
      {isPrivyConfigured ? (
        <PrivyEoaSync onEoa={wallet.applyEoaAddress} persistedEoa={wallet.record.walletAddress} />
      ) : null}

      <PageHeader
        eyebrow="Home"
        title={`Welcome, ${firstName}`}
        description="Cash, stablecoin swaps, and recent activity."
        actions={
          <>
            <Button asChild size="sm" className="rounded-full">
              <Link href="/dashboard/add-money">
                <ArrowDownLeft className="h-3.5 w-3.5" />
                Add Money
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="rounded-full">
              <Link href="/dashboard/payment">
                <ArrowUpRight className="h-3.5 w-3.5" />
                Transfer
              </Link>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full text-[var(--kura-text-secondary)]"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </>
        }
      />

      {wallet.error ? <PageAlert variant="warning">{wallet.error}</PageAlert> : null}

      {/* Net worth + TrackFi, then Invest / Loan / Earn */}
      <section className="mb-6 space-y-3">
        <div className={`grid gap-3 ${features.trackFi ? "sm:grid-cols-2" : ""}`}>
          <Link
            href="/dashboard/crypto"
            className="rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)] p-6 transition-colors hover:bg-[var(--kura-bg-light)]/30"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
              Net Worth
            </p>
            {summary.loading ? (
              <div className="mt-3 h-10 w-40 animate-pulse rounded-lg bg-[var(--kura-bg-lighter)]" />
            ) : (
              <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-[var(--kura-text)] sm:text-4xl">
                {isBalanceHidden ? "••••••" : formatUsd(summary.netWorth)}
              </p>
            )}
            <p className="mt-2 text-xs text-[var(--kura-text-secondary)]">
              {features.trackFi
                ? "Cash · Invest · TrackFi · Earn − Loans"
                : "Cash · Invest · Earn − Loans"}
              {wallet.scaAddress ? (
                <>
                  {" · "}
                  <span className="font-mono">{truncate(wallet.scaAddress)}</span>
                </>
              ) : null}
            </p>
          </Link>

          {features.trackFi ? (
            <Link
              href="/dashboard/investment"
              className="rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)] p-6 transition-colors hover:bg-[var(--kura-bg-light)]/30"
            >
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
                <LineChart className="h-3.5 w-3.5" />
                TrackFi
              </p>
              {summary.loading ? (
                <div className="mt-3 h-10 w-40 animate-pulse rounded-lg bg-[var(--kura-bg-lighter)]" />
              ) : (
                <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-[var(--kura-text)] sm:text-4xl">
                  {isBalanceHidden ? "••••••" : formatUsd(summary.trackFiUsd)}
                </p>
              )}
              <p className="mt-2 text-xs text-[var(--kura-text-secondary)]">
                Banks · Brokers · CEX
              </p>
            </Link>
          ) : null}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <MetricCard
            href="/dashboard/crypto"
            label="Invest"
            value={summary.investUsd}
            loading={summary.loading}
            hidden={isBalanceHidden}
            icon={<Briefcase className="h-3.5 w-3.5" />}
          />
          <MetricCard
            href="/dashboard/borrow"
            label="Loan"
            value={summary.loanUsd}
            loading={summary.loading}
            hidden={isBalanceHidden}
            icon={<HandCoins className="h-3.5 w-3.5" />}
          />
          <MetricCard
            href="/dashboard/earn"
            label="Earn"
            value={summary.earnUsd}
            loading={summary.loading}
            hidden={isBalanceHidden}
            icon={<TrendingUp className="h-3.5 w-3.5" />}
          />
        </div>
      </section>

      {/* Cash + Swap */}
      <section className="mb-4 grid gap-4 lg:grid-cols-2 lg:items-stretch">
        <Panel padding="md" className="flex h-full flex-col">
          <PanelHeader
            title="Cash"
            description="USDC · DAI · EURC · XSGD · AUDD · MXNe · BRZ"
            action={
              <Link
                href="/dashboard/add-money"
                className="text-xs font-semibold text-[var(--kura-primary)] hover:underline"
              >
                Top up
              </Link>
            }
          />

          {wallet.loading || wallet.stablesLoading ? (
            <div className="flex flex-1 flex-col justify-center space-y-3">
              {HOME_STABLECOINS.map((token) => (
                <div key={token.symbol} className="h-12 animate-pulse rounded-xl bg-[var(--kura-bg-lighter)]" />
              ))}
            </div>
          ) : wallet.provisioning ? (
            <p className="flex flex-1 items-center justify-center py-6 text-center text-sm text-[var(--kura-text-secondary)]">
              Setting up your Smart Wallet…
            </p>
          ) : !wallet.scaAddress ? (
            <p className="flex flex-1 items-center justify-center py-6 text-center text-sm text-[var(--kura-text-secondary)]">
              Connect with Privy to create your Smart Wallet address. You can fund it before the first
              on-chain transaction.
            </p>
          ) : (
            <ul className="flex flex-1 flex-col justify-center divide-y divide-[var(--kura-border)]">
              {cashRows.map(({ token, amount }) => (
                <li key={token.symbol} className="flex items-center gap-3 py-3">
                  <AssetIcon
                    src={cryptoLogoUrl(token.symbol)}
                    label={token.symbol}
                    color={STABLE_COLORS[token.symbol] ?? "#64748B"}
                    size={36}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--kura-text)]">{token.symbol}</p>
                    <p className="truncate text-[11px] text-[var(--kura-text-secondary)]">
                      {token.name}
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-[var(--kura-text)]">
                    {isBalanceHidden ? "••••" : formatToken(amount, 2)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <HomeStableSwapPanel
          scaAddress={wallet.scaAddress}
          balances={wallet.stableBalances}
          balancesLoading={wallet.loading || wallet.stablesLoading}
          onSwapped={() => {
            void wallet.refresh();
            void refreshActivity();
          }}
        />
      </section>

      <WalletHistorySection
        activities={activities}
        loading={activityLoading}
        error={activityError}
        hidden={isBalanceHidden}
        hasWallet={!!wallet.scaAddress}
        previewLimit={5}
      />
    </DashboardPage>
  );
}

function MetricCard({
  href,
  label,
  value,
  loading,
  hidden,
  icon,
}: {
  href: string;
  label: string;
  value: number;
  loading: boolean;
  hidden: boolean;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)] p-4 transition-colors hover:bg-[var(--kura-bg-light)]/30"
    >
      <span className="mb-3 flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--kura-primary)]/10 text-[var(--kura-primary-light)]">
        {icon}
      </span>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
        {label}
      </p>
      {loading ? (
        <div className="mt-1.5 h-6 w-16 animate-pulse rounded bg-[var(--kura-bg-lighter)]" />
      ) : (
        <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-[var(--kura-text)] sm:text-xl">
          {hidden ? "••••" : formatUsd(value)}
        </p>
      )}
    </Link>
  );
}
