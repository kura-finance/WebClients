"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchWalletRecord } from "@/lib/walletApi";
import { fetchPortfolioBalances } from "@/lib/baseChain";
import { fetchCoinGeckoPrices, type PriceMap } from "@/lib/coingeckoPrices";
import {
  ALLOCATION_COLORS,
  getPortfolioGroup,
  PORTFOLIO_TOKENS,
  shouldShowHolding,
  type PortfolioDisplayGroup,
  type PortfolioTokenMeta,
} from "@/lib/portfolioTokens";
import { features } from "@/config/features";
import { useWalletSessionStore } from "@/store/useWalletSessionStore";
import { isHexAddress } from "@/lib/formatDisplay";
import {
  sumBorrowDebtsUsd,
  sumEarnPositionsUsd,
} from "@/lib/morphoPositions";

export interface PortfolioHolding {
  token: PortfolioTokenMeta;
  price: number;
  change24h: number;
  holdings: number;
  value: number;
  group: PortfolioDisplayGroup;
}

export interface AllocationSlice {
  key: PortfolioDisplayGroup;
  label: string;
  color: string;
  value: number;
  pct: number;
}

function isAddress(value: string | null | undefined): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function computePnL(holdings: PortfolioHolding[]) {
  let total = 0;
  let todayChangeUsd = 0;
  for (const item of holdings) {
    if (item.holdings <= 0 || item.value <= 0) continue;
    total += item.value;
    todayChangeUsd += item.value * (item.change24h / 100);
  }
  const todayChangePct = total > 0 ? (todayChangeUsd / total) * 100 : 0;
  return { todayChangeUsd, todayChangePct };
}

export function usePortfolio() {
  const [scaAddress, setScaAddress] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [earnUsd, setEarnUsd] = useState(0);
  const [loanUsd, setLoanUsd] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // No backend: the Smart Wallet address is derived locally (DashboardWalletBootstrap)
  // and published through the session store — reload once it is known.
  const localSca = useWalletSessionStore((s) => (features.backend ? null : s.scaOverride));

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const wallet = await fetchWalletRecord();
      const sca = localSca ?? wallet.scaAddress;
      setScaAddress(sca);

      const emptyPrices: PriceMap = {};
      const [rawBalances, prices] = await Promise.all([
        isAddress(sca) ? fetchPortfolioBalances(sca) : Promise.resolve({} as Record<string, number>),
        fetchCoinGeckoPrices(isRefresh).catch(() => emptyPrices),
      ]);
      setBalances(rawBalances);

      const next: PortfolioHolding[] = PORTFOLIO_TOKENS.filter(
        (t) => t.trackBalance !== false,
      ).map((token) => {
        const priceData = prices[token.geckoId];
        const price = priceData?.usd ?? (getPortfolioGroup(token.symbol) === "cash" ? 1 : 0);
        const change24h = priceData?.usd_24h_change ?? 0;
        const amount = rawBalances[token.symbol] ?? 0;
        return {
          token,
          price,
          change24h,
          holdings: amount,
          value: amount * price,
          group: getPortfolioGroup(token.symbol),
        };
      });

      next.sort((a, b) => {
        if (a.value !== b.value) return b.value - a.value;
        return (
          PORTFOLIO_TOKENS.findIndex((t) => t.symbol === a.token.symbol) -
          PORTFOLIO_TOKENS.findIndex((t) => t.symbol === b.token.symbol)
        );
      });

      setHoldings(next);

      if (isHexAddress(sca)) {
        try {
          const [earn, loan] = await Promise.all([
            sumEarnPositionsUsd(sca),
            sumBorrowDebtsUsd(sca),
          ]);
          setEarnUsd(earn);
          setLoanUsd(loan);
        } catch {
          setEarnUsd(0);
          setLoanUsd(0);
        }
      } else {
        setEarnUsd(0);
        setLoanUsd(0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load portfolio");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [localSca]);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      void load(true);
    }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const totalValue = useMemo(
    () => holdings.reduce((sum, h) => sum + (h.value > 0 ? h.value : 0), 0),
    [holdings],
  );

  const pnl = useMemo(() => computePnL(holdings), [holdings]);

  const groups = useMemo(() => {
    const cash = holdings.filter((h) => h.group === "cash");
    const crypto = holdings.filter((h) => h.group === "crypto");
    return { cash, crypto };
  }, [holdings]);

  const investUsd = useMemo(
    () => groups.crypto.reduce((s, h) => s + Math.max(0, h.value), 0),
    [groups.crypto],
  );

  /** Invest KPI on Portfolio = crypto/tokenized stocks + Earn. */
  const portfolioInvestUsd = investUsd + earnUsd;

  const allocation = useMemo((): AllocationSlice[] => {
    const cashValue = groups.cash.reduce((s, h) => s + h.value, 0);
    const cryptoValue = groups.crypto.reduce((s, h) => s + h.value, 0);
    const total = cashValue + cryptoValue;
    return [
      {
        key: "cash",
        label: "Cash",
        color: ALLOCATION_COLORS.cash,
        value: cashValue,
        pct: total > 0 ? (cashValue / total) * 100 : 0,
      },
      {
        key: "crypto",
        label: "Crypto",
        color: ALLOCATION_COLORS.crypto,
        value: cryptoValue,
        pct: total > 0 ? (cryptoValue / total) * 100 : 0,
      },
    ];
  }, [groups]);

  const visibleByGroup = useCallback(
    (group: PortfolioDisplayGroup, hideSmall: boolean) => {
      const list = group === "cash" ? groups.cash : groups.crypto;
      return list.filter((h) => shouldShowHolding(h.value, h.holdings, hideSmall));
    },
    [groups],
  );

  return {
    scaAddress,
    balances,
    holdings,
    totalValue,
    pnl,
    groups,
    allocation,
    investUsd,
    portfolioInvestUsd,
    earnUsd,
    loanUsd,
    visibleByGroup,
    loading,
    refreshing,
    error,
    refresh: () => load(true),
  };
}
