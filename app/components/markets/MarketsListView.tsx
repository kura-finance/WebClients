"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Search, RefreshCw, ChevronRight } from "lucide-react";
import {
  isStablecoinSymbol,
  PORTFOLIO_TOKENS,
  type PortfolioTokenMeta,
} from "@/lib/portfolioTokens";
import { useCoinGeckoPrices } from "@/hooks/useCoinGeckoPrices";
import { marketSlug } from "@/lib/tradingViewSymbols";
import { cryptoLogoUrl } from "@/lib/assetLogos";
import { Button } from "@/components/ui/button";
import AssetIcon from "@/components/ui/AssetIcon";
import {
  Chip,
  DashboardPage,
  PageHeader,
} from "@/components/dashboard/PageShell";

type SortKey = "popular" | "gainers" | "losers" | "price";

const SORT_TABS: { key: SortKey; label: string }[] = [
  { key: "popular", label: "Popular" },
  { key: "price", label: "Price" },
  { key: "gainers", label: "Trending Up" },
  { key: "losers", label: "Trending Down" },
];

function formatPrice(price: number): string {
  if (!(price > 0)) return "—";
  if (price >= 1000) {
    return `$${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
  if (price >= 1) {
    return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  }
  return `$${price.toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
}

function changeBadge(change: number, hasPrice: boolean) {
  if (!hasPrice || !Number.isFinite(change)) {
    return { text: "—", className: "text-[var(--kura-text-secondary)]" };
  }
  const up = change >= 0;
  return {
    text: `${up ? "+" : ""}${change.toFixed(2)}%`,
    className: up
      ? "bg-emerald-500/15 text-emerald-500"
      : "bg-red-500/15 text-red-500",
  };
}

/** Exchange-style crypto list — native ETH is shown as WETH only. */
const MARKET_TOKENS = PORTFOLIO_TOKENS.filter(
  (t) =>
    t.symbol !== "ETH" &&
    (!isStablecoinSymbol(t.symbol) || t.symbol === "USDC"),
);

interface Row {
  token: PortfolioTokenMeta;
  price: number;
  change24h: number;
}

export default function MarketsListView() {
  const { prices, loading, refreshing, error, refresh } = useCoinGeckoPrices();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("popular");

  const rows: Row[] = useMemo(
    () =>
      MARKET_TOKENS.map((token) => {
        const row = prices[token.geckoId];
        return {
          token,
          price: row?.usd ?? 0,
          change24h: row?.usd_24h_change ?? 0,
        };
      }),
    [prices],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows.filter(
      (r) =>
        !q ||
        r.token.symbol.toLowerCase().includes(q) ||
        r.token.name.toLowerCase().includes(q) ||
        r.token.displayName.toLowerCase().includes(q),
    );

    switch (sort) {
      case "gainers":
        list = [...list].sort((a, b) => b.change24h - a.change24h);
        break;
      case "losers":
        list = [...list].sort((a, b) => a.change24h - b.change24h);
        break;
      case "price":
        list = [...list].sort((a, b) => b.price - a.price);
        break;
      default:
        list = [...list].sort((a, b) => {
          if (a.token.symbol === "USDC") return -1;
          if (b.token.symbol === "USDC") return 1;
          return (b.price > 0 ? 1 : 0) - (a.price > 0 ? 1 : 0);
        });
        break;
    }
    return list;
  }, [rows, query, sort]);

  return (
    <DashboardPage>
      <PageHeader
        eyebrow="Market"
        title="Crypto"
        description="Spot markets on Base · tap a coin for the chart"
        actions={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading || refreshing}
            className="gap-1.5 text-[var(--kura-text-secondary)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      <div className="mb-4 flex gap-2">
        <span className="rounded-full bg-[var(--kura-primary)] px-3.5 py-1.5 text-xs font-semibold text-[var(--kura-on-primary)]">
          Spot
        </span>
        <span className="rounded-full border border-[var(--kura-border)] px-3.5 py-1.5 text-xs font-semibold text-[var(--kura-text-secondary)] opacity-60">
          Perps
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
            placeholder="Search crypto"
            className="h-10 w-full rounded-xl border border-[var(--kura-border)] bg-[var(--kura-surface)] pl-10 pr-4 text-sm text-[var(--kura-text)] outline-none focus:ring-2 focus:ring-[var(--kura-primary)]/30"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)]">
        <div className="hidden items-center gap-3 border-b border-[var(--kura-border)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)] sm:flex">
          <span className="min-w-0 flex-[1.4]">Name</span>
          <span className="w-28 text-right">Market Price</span>
          <span className="w-24 text-right">Change</span>
          <span className="w-8" />
        </div>

        {error ? (
          <div className="m-4 rounded-xl border border-[var(--kura-error-border)] bg-[var(--kura-error-bg)] px-3 py-2.5 text-sm text-[var(--kura-error-fg)]">
            {error}
          </div>
        ) : null}

        {loading && rows.every((r) => r.price === 0) ? (
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
            {query ? "No markets match your search" : "Loading markets…"}
          </p>
        ) : (
          <div className="divide-y divide-[var(--kura-border)]">
            {filtered.map((row) => (
              <CryptoMarketRow key={row.token.symbol} row={row} />
            ))}
          </div>
        )}
      </div>

      <p className="mt-6 text-center text-[11px] text-[var(--kura-text-secondary)]">
        Prices via CoinGecko · Charts by TradingView
      </p>
    </DashboardPage>
  );
}

function CryptoMarketRow({ row }: { row: Row }) {
  const badge = changeBadge(row.change24h, row.price > 0);
  const logo = cryptoLogoUrl(row.token.symbol);
  return (
    <Link
      href={`/dashboard/markets/${marketSlug(row.token.symbol)}`}
      className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-[var(--kura-bg-light)]/40"
    >
      <AssetIcon
        src={logo}
        label={row.token.displayName}
        color={row.token.color}
        size={40}
      />
      <div className="min-w-0 flex-[1.4]">
        <p className="text-sm font-semibold text-[var(--kura-text)]">{row.token.displayName}</p>
        <p className="truncate text-xs text-[var(--kura-text-secondary)]">{row.token.name}</p>
      </div>
      <div className="hidden w-28 shrink-0 text-right sm:block">
        <p className="text-sm font-semibold tabular-nums text-[var(--kura-text)]">
          {formatPrice(row.price)}
        </p>
      </div>
      <div className="ml-auto w-24 shrink-0 text-right sm:ml-0">
        <span
          className={`inline-block rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${badge.className}`}
        >
          {badge.text}
        </span>
        <p className="mt-0.5 text-xs tabular-nums text-[var(--kura-text)] sm:hidden">
          {formatPrice(row.price)}
        </p>
      </div>
      <ChevronRight className="hidden h-4 w-4 shrink-0 text-[var(--kura-text-secondary)] opacity-50 sm:block" />
    </Link>
  );
}
