"use client";

/**
 * On-chain holdings for a Treasury Safe:
 *   Loan       — Morpho borrow debt
 *   Investment — Morpho Earn vault deposits
 *   Crypto     — Base spot portfolio (excludes dust)
 */

import { useLoad } from "@/hooks/useLoad";
import { fetchPortfolioBalances } from "@/lib/baseChain";
import { fetchCoinGeckoPrices, type PriceMap } from "@/lib/coingeckoPrices";
import { isHexAddress } from "@/lib/formatDisplay";
import {
  borrowPositionLabel,
  listBorrowPositions,
  listEarnPositions,
} from "@/lib/morphoPositions";
import {
  PORTFOLIO_TOKENS,
  getPortfolioGroup,
  shouldShowHolding,
} from "@/lib/portfolioTokens";

export interface TreasuryHoldingRow {
  id: string;
  label: string;
  subtitle?: string;
  amountUsd: number;
  href?: string;
}

async function loadInvestmentRows(sca: `0x${string}`): Promise<TreasuryHoldingRow[]> {
  const rows = await listEarnPositions(sca);
  return rows.map((r) => ({
    id: `earn-${r.vault.address}`,
    label: r.vault.name || r.vault.assetSymbol,
    subtitle: `Earn · ${r.vault.assetSymbol}`,
    amountUsd: r.amountUsd,
    href: `/dashboard/earn/${r.vault.address}`,
  }));
}

async function loadLoanRows(sca: `0x${string}`): Promise<TreasuryHoldingRow[]> {
  const rows = await listBorrowPositions(sca);
  return rows.map((r) => ({
    id: `loan-${r.market.marketId}`,
    label: borrowPositionLabel(r.market),
    subtitle: `Borrow · ${r.market.loanAsset.symbol}`,
    amountUsd: r.borrowAssetsUsd,
    href: `/dashboard/borrow/${r.market.marketId}`,
  }));
}

async function loadCryptoRows(sca: `0x${string}`): Promise<TreasuryHoldingRow[]> {
  const emptyPrices: PriceMap = {};
  const [balances, prices] = await Promise.all([
    fetchPortfolioBalances(sca),
    fetchCoinGeckoPrices(false).catch(() => emptyPrices),
  ]);

  const rows: TreasuryHoldingRow[] = [];
  for (const token of PORTFOLIO_TOKENS) {
    const holdings = balances[token.symbol] ?? 0;
    if (holdings <= 0) continue;
    const group = getPortfolioGroup(token.symbol);
    if (group !== "crypto") continue;
    const price = prices[token.geckoId]?.usd ?? 0;
    const value = holdings * price;
    if (!shouldShowHolding(value, holdings, true)) continue;
    rows.push({
      id: `crypto-${token.symbol}`,
      label: token.symbol,
      subtitle: token.name,
      amountUsd: value,
      href: `/dashboard/markets/${token.symbol.toLowerCase()}`,
    });
  }
  return rows.sort((a, b) => b.amountUsd - a.amountUsd);
}

const NO_ROWS: TreasuryHoldingRow[] = [];

export function useTreasuryHoldings(scaAddress: string | null | undefined) {
  const valid = isHexAddress(scaAddress);

  const { data, fetching, error, refresh } = useLoad({
    key: ["treasury", "holdings", valid ? scaAddress.toLowerCase() : null],
    load: async () => {
      const address = scaAddress as `0x${string}`;
      const [loanRows, investmentRows, cryptoRows] = await Promise.all([
        loadLoanRows(address),
        loadInvestmentRows(address),
        loadCryptoRows(address),
      ]);
      return { loanRows, investmentRows, cryptoRows };
    },
    errorMessage: "Failed to load Treasury holdings",
    enabled: valid,
  });

  // As before: nothing is shown for a failed load or a missing address.
  const rows = valid && !error ? data : undefined;
  const loanRows = rows?.loanRows ?? NO_ROWS;
  const investmentRows = rows?.investmentRows ?? NO_ROWS;
  const cryptoRows = rows?.cryptoRows ?? NO_ROWS;

  const sum = (list: TreasuryHoldingRow[]) => list.reduce((s, r) => s + r.amountUsd, 0);

  return {
    loanRows,
    investmentRows,
    cryptoRows,
    loanUsd: sum(loanRows),
    investmentUsd: sum(investmentRows),
    cryptoUsd: sum(cryptoRows),
    loading: fetching,
    refresh,
  };
}
