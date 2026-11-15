"use client";

import { useMemo } from "react";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useFinanceStore } from "@/store/useFinanceStore";
import { useExchangeStore } from "@/store/useExchangeStore";
import { features } from "@/config/features";

/**
 * Home summary cards.
 *
 * - Net Worth = SCA spot + TrackFi + Earn − Loans
 * - TrackFi   = Plaid brokerages + CEX (0 when the TrackFi feature is off)
 * - Invest    = SCA crypto + tokenized stocks (non-stable)
 */
export function useHomeSummaryCards() {
  const portfolio = usePortfolio();
  const investments = useFinanceStore((s) => s.investments);
  const exchangeInvestments = useExchangeStore((s) => s.exchangeInvestments);

  const trackFiUsd = useMemo(() => {
    if (!features.trackFi) return 0;
    const plaid = investments.reduce(
      (sum, i) => sum + Math.max(0, i.holdings * i.currentPrice),
      0,
    );
    const cex = exchangeInvestments.reduce(
      (sum, i) => sum + Math.max(0, i.holdings * i.currentPrice),
      0,
    );
    return plaid + cex;
  }, [investments, exchangeInvestments]);

  const investUsd = portfolio.investUsd;
  const earnUsd = portfolio.earnUsd;
  const loanUsd = portfolio.loanUsd;
  const netWorth = portfolio.totalValue + trackFiUsd + earnUsd - loanUsd;

  return {
    netWorth,
    trackFiUsd,
    investUsd,
    portfolioInvestUsd: portfolio.portfolioInvestUsd,
    loanUsd,
    earnUsd,
    /** @deprecated use trackFiUsd */
    investmentUsd: trackFiUsd,
    loading: portfolio.loading,
    refresh: portfolio.refresh,
  };
}
