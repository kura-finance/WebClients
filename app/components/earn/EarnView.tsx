"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, Search, ChevronRight } from "lucide-react";
import { useMorphoVaults } from "@/hooks/useMorphoVaults";
import {
  effectiveEarnNetApy,
  formatApy,
  formatTvl,
  type MorphoVault,
} from "@/lib/morphoApi";
import { useHomeWallet } from "@/hooks/useHomeWallet";
import PrivyEoaSync from "@/components/wallet/PrivyEoaSync";
import { PORTFOLIO_TOKENS } from "@/lib/portfolioTokens";
import { cryptoLogoUrl } from "@/lib/assetLogos";
import { Button } from "@/components/ui/button";
import { DashboardPage, PageHeader, Chip } from "@/components/dashboard/PageShell";
import AssetIcon from "@/components/ui/AssetIcon";

type SortKey = "apy" | "tvl" | "name";

const SORT_TABS: { key: SortKey; label: string }[] = [
  { key: "apy", label: "Highest APY" },
  { key: "tvl", label: "Max. TVL" },
  { key: "name", label: "A–Z" },
];

function vaultAssetLogo(vault: MorphoVault): { src: string | null; color: string } {
  const token = PORTFOLIO_TOKENS.find(
    (t) => t.symbol.toLowerCase() === vault.assetSymbol.toLowerCase(),
  );
  return {
    src: cryptoLogoUrl(vault.assetSymbol) ?? vault.assetLogoUrl ?? null,
    color: token?.color ?? "#6366F1",
  };
}

export default function EarnView() {
  const { vaults, loading, refreshing, error, refresh } = useMorphoVaults();
  const wallet = useHomeWallet();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("apy");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = vaults.filter(
      (v) =>
        !q ||
        v.name.toLowerCase().includes(q) ||
        v.symbol.toLowerCase().includes(q) ||
        v.assetSymbol.toLowerCase().includes(q),
    );

    switch (sort) {
      case "tvl":
        list = [...list].sort((a, b) => b.totalAssetsUsd - a.totalAssetsUsd);
        break;
      case "name":
        list = [...list].sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "apy":
      default:
        list = [...list].sort(
          (a, b) => effectiveEarnNetApy(b.netApy) - effectiveEarnNetApy(a.netApy),
        );
        break;
    }
    return list;
  }, [vaults, query, sort]);

  return (
    <DashboardPage>
      <PrivyEoaSync onEoa={wallet.applyEoaAddress} persistedEoa={wallet.record.walletAddress} />
      <PageHeader
        eyebrow="Market"
        title="Earn"
        description="Morpho vaults on Base · net APY after Kura fee"
        actions={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading || refreshing}
            className="rounded-full gap-1.5 text-[var(--kura-text-secondary)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      <div className="mb-4 flex gap-2">
        <span className="rounded-full bg-[var(--kura-primary)] px-3.5 py-1.5 text-xs font-semibold text-[var(--kura-on-primary)]">
          Morpho
        </span>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {SORT_TABS.map((tab) => (
            <Chip
              key={tab.key}
              active={sort === tab.key}
              onClick={() => setSort(tab.key)}
            >
              {tab.label}
            </Chip>
          ))}
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kura-text-secondary)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vaults"
            className="h-10 w-full rounded-xl border border-[var(--kura-border)] bg-[var(--kura-surface)] pl-10 pr-4 text-sm text-[var(--kura-text)] outline-none focus:ring-2 focus:ring-[var(--kura-primary)]/30"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)]">
        <div className="hidden items-center gap-3 border-b border-[var(--kura-border)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)] sm:flex">
          <span className="min-w-0 flex-[1.4]">Name</span>
          <span className="w-28 text-right">TVL</span>
          <span className="w-24 text-right">Asset</span>
          <span className="w-24 text-right">Net APY</span>
          <span className="w-8" />
        </div>

        {error ? (
          <div className="m-4 rounded-xl border border-[var(--kura-error-border)] bg-[var(--kura-error-bg)] px-3 py-2.5 text-sm text-[var(--kura-error-fg)]">
            {error}
          </div>
        ) : null}

        {loading && vaults.length === 0 ? (
          <div>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-b border-[var(--kura-border)] px-4 py-3.5 last:border-0"
              >
                <div className="h-10 w-10 animate-pulse rounded-full bg-[var(--kura-bg-lighter)]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-16 animate-pulse rounded bg-[var(--kura-bg-lighter)]" />
                  <div className="h-2.5 w-28 animate-pulse rounded bg-[var(--kura-bg-lighter)]" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-14 text-center text-sm text-[var(--kura-text-secondary)]">
            {query ? "No vaults match your search" : "No Morpho vaults available"}
          </p>
        ) : (
          <div className="divide-y divide-[var(--kura-border)]">
            {filtered.map((vault) => (
              <VaultMarketRow key={vault.address} vault={vault} />
            ))}
          </div>
        )}
      </div>

      <p className="mt-6 text-center text-[11px] text-[var(--kura-text-secondary)]">
        Earn powered by Morpho · Open a vault for holdings, yield sources, and deposit
      </p>
    </DashboardPage>
  );
}

function VaultMarketRow({ vault }: { vault: MorphoVault }) {
  const apy = effectiveEarnNetApy(vault.netApy);
  const logo = vaultAssetLogo(vault);
  return (
    <Link
      href={`/dashboard/earn/${vault.address}`}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--kura-bg-light)]/40"
    >
      <AssetIcon src={logo.src} label={vault.assetSymbol} color={logo.color} size={40} />
      <div className="min-w-0 flex-[1.4]">
        <p className="truncate text-sm font-semibold text-[var(--kura-text)]">{vault.name}</p>
        <p className="truncate text-xs text-[var(--kura-text-secondary)]">{vault.symbol}</p>
      </div>
      <div className="hidden w-28 shrink-0 text-right sm:block">
        <p className="text-sm font-semibold tabular-nums text-[var(--kura-text)]">
          {formatTvl(vault.totalAssetsUsd)}
        </p>
      </div>
      <div className="hidden w-24 shrink-0 text-right sm:block">
        <p className="text-xs font-medium tabular-nums text-[var(--kura-text-secondary)]">
          {vault.assetSymbol}
        </p>
      </div>
      <div className="ml-auto w-24 shrink-0 text-right sm:ml-0">
        <span className="inline-block rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-emerald-500">
          {formatApy(apy)}
        </span>
        <p className="mt-0.5 text-xs tabular-nums text-[var(--kura-text)] sm:hidden">
          TVL {formatTvl(vault.totalAssetsUsd)}
        </p>
      </div>
      <ChevronRight className="hidden h-4 w-4 shrink-0 text-[var(--kura-text-secondary)] opacity-50 sm:block" />
    </Link>
  );
}
