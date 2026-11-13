"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { PORTFOLIO_TOKENS } from "@/lib/portfolioTokens";
import { fetchCoinGeckoPrices } from "@/lib/coingeckoPrices";
import { tradingViewSymbol } from "@/lib/tradingViewSymbols";
import { cryptoLogoUrl } from "@/lib/assetLogos";
import { fetchPortfolioBalances, USDC_BASE } from "@/lib/baseChain";
import {
  fetchSwapQuote,
  formatSwapReceive,
  toTokenWei,
  type SwapQuote,
} from "@/lib/lifiSwap";
import { buildLiFiSwapCalls, executeLiFiSwapFromSafe } from "@/lib/smartAccountSend";
import { proposeTreasuryCalls } from "@/lib/proposeTreasuryCalls";
import { isPimlicoConfigured } from "@/config/env";
import { useSignerWallet } from "@/lib/signer";
import { signerCopy } from "@/lib/signer/copy";
import PrivyEoaSync from "@/components/wallet/PrivyEoaSync";
import TradingAccountPicker, {
  useTradingAccount,
} from "@/components/wallet/TradingAccountPicker";
import TradingViewChart from "@/components/markets/TradingViewChart";
import { Button } from "@/components/ui/button";
import AssetIcon from "@/components/ui/AssetIcon";
import { DashboardPage } from "@/components/dashboard/PageShell";

interface MarketDetailViewProps {
  symbol: string;
}

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

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return "Something went wrong. Please try again.";
}

export default function MarketDetailView({ symbol }: MarketDetailViewProps) {
  const token = useMemo(
    () =>
      PORTFOLIO_TOKENS.find((t) => t.symbol.toLowerCase() === symbol.toLowerCase()) ?? null,
    [symbol],
  );

  const tvSymbol = token ? tradingViewSymbol(token.symbol) : null;
  const tradeAddress = token?.baseAddress ?? null;

  const {
    kind,
    setKind,
    scaAddress,
    accountOpts,
    isTreasury,
    treasuryReady,
    personal,
    treasury,
  } = useTradingAccount();
  const { applyEoaAddress, record } = personal;
  const signerWallet = useSignerWallet();

  const [price, setPrice] = useState(0);
  const [change24h, setChange24h] = useState(0);
  const [loading, setLoading] = useState(true);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [proposedHash, setProposedHash] = useState<string | null>(null);

  const numericAmount = Number(amount);
  const usdcBal = balances.USDC ?? 0;
  const tokenBal = balances[token?.symbol ?? ""] ?? 0;
  const available = side === "buy" ? usdcBal : tokenBal;

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void fetchCoinGeckoPrices()
      .then((prices) => {
        if (cancelled) return;
        const row = prices[token.geckoId];
        setPrice(row?.usd ?? 0);
        setChange24h(row?.usd_24h_change ?? 0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const loadBalances = useCallback(async () => {
    if (!scaAddress) {
      setBalances({});
      return;
    }
    try {
      const next = await fetchPortfolioBalances(scaAddress as `0x${string}`);
      setBalances(next);
    } catch {
      setBalances({});
    }
  }, [scaAddress]);

  useEffect(() => {
    void loadBalances();
  }, [loadBalances]);

  useEffect(() => {
    if (!scaAddress || !tradeAddress || !(numericAmount > 0) || numericAmount > available) {
      setQuote(null);
      setQuoteError(null);
      return;
    }

    const fromToken = side === "buy" ? USDC_BASE : tradeAddress;
    const toToken = side === "buy" ? tradeAddress : USDC_BASE;
    const fromDecimals = side === "buy" ? 6 : (token?.decimals ?? 18);
    const wei = toTokenWei(numericAmount, fromDecimals);
    if (wei === "0") return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setIsQuoting(true);
      setQuoteError(null);
      void fetchSwapQuote({
        fromAmountWei: wei,
        fromAddress: scaAddress,
        fromTokenAddress: fromToken,
        toTokenAddress: toToken,
      })
        .then((q) => {
          if (!cancelled) setQuote(q);
        })
        .catch((e) => {
          if (!cancelled) {
            setQuote(null);
            setQuoteError(errMessage(e));
          }
        })
        .finally(() => {
          if (!cancelled) setIsQuoting(false);
        });
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [scaAddress, tradeAddress, numericAmount, available, side, token?.decimals]);

  const canTrade =
    !!scaAddress &&
    !!signerWallet &&
    !!tradeAddress &&
    (isTreasury || isPimlicoConfigured()) &&
    !!quote &&
    !isQuoting &&
    !isSending &&
    numericAmount > 0 &&
    numericAmount <= available;

  const handleTrade = async () => {
    setTxError(null);
    setTxHash(null);
    setProposedHash(null);
    if (!canTrade || !quote || !scaAddress || !signerWallet) return;

    setIsSending(true);
    try {
      const provider = (await signerWallet.getEthereumProvider()) as {
        request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      };

      if (isTreasury) {
        if (!treasury.scaAddress) throw new Error("Treasury Safe not linked.");
        const calls = await buildLiFiSwapCalls({
          expectedScaAddress: scaAddress as `0x${string}`,
          quote,
        });
        const { safeTxHash } = await proposeTreasuryCalls({
          eip1193Provider: provider,
          treasurySafe: treasury.scaAddress as `0x${string}`,
          eoaAddress: personal.eoaAddress ?? "",
          calls,
        });
        setProposedHash(safeTxHash);
        setAmount("");
        setQuote(null);
      } else {
        const hash = await executeLiFiSwapFromSafe({
          eip1193Provider: provider,
          expectedScaAddress: scaAddress as `0x${string}`,
          quote,
          ...accountOpts,
        });
        setTxHash(hash);
        setAmount("");
        setQuote(null);
        await loadBalances();
        await personal.refresh();
      }
    } catch (e) {
      setTxError(errMessage(e));
    } finally {
      setIsSending(false);
    }
  };

  if (!token) {
    return (
      <DashboardPage>
        <Link
          href="/dashboard/markets"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--kura-primary-light)] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Crypto
        </Link>
        <p className="text-sm text-[var(--kura-text-secondary)]">Unknown market: {symbol}</p>
      </DashboardPage>
    );
  }

  const up = change24h >= 0;

  return (
    <DashboardPage className="!max-w-none px-4 pb-10 pt-4 sm:px-5 lg:px-6">
      <PrivyEoaSync onEoa={applyEoaAddress} persistedEoa={record.walletAddress} />
      <Link
        href="/dashboard/markets"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--kura-text-secondary)] hover:text-[var(--kura-text)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Crypto
      </Link>

      {/* Lighter-style: chart ~3/4 · trade panel ~1/4 */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(280px,1fr)] lg:items-stretch lg:gap-4">
        <section className="flex min-w-0 flex-col">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)] px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <AssetIcon
                src={cryptoLogoUrl(token.symbol)}
                label={token.displayName}
                color={token.color}
                size={40}
              />
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold tracking-tight text-[var(--kura-text)] sm:text-2xl">
                  {token.displayName}
                </h1>
                <p className="text-xs text-[var(--kura-text-secondary)]">{token.name} · Base</p>
              </div>
            </div>
            <div className="text-right">
              {loading ? (
                <div className="ml-auto h-8 w-24 animate-pulse rounded-lg bg-[var(--kura-border)]" />
              ) : (
                <>
                  <p className="text-2xl font-semibold tabular-nums tracking-tight text-[var(--kura-text)] sm:text-3xl">
                    {formatPrice(price)}
                  </p>
                  <p
                    className={`mt-0.5 text-sm font-semibold tabular-nums ${
                      up ? "text-emerald-500" : "text-red-500"
                    }`}
                  >
                    {up ? "+" : ""}
                    {change24h.toFixed(2)}% · 24h
                  </p>
                </>
              )}
            </div>
          </div>

          {tvSymbol ? (
            <TradingViewChart
              symbol={tvSymbol}
              interval="60"
              className="min-h-[420px] flex-1 lg:min-h-[calc(100vh-11rem)]"
            />
          ) : (
            <div className="flex min-h-[320px] flex-1 items-center justify-center rounded-2xl border border-dashed border-[var(--kura-border)] bg-[var(--kura-surface)] px-6 text-center text-sm text-[var(--kura-text-secondary)] lg:min-h-[calc(100vh-11rem)]">
              TradingView chart is not available for {token.displayName} yet.
            </div>
          )}

          <p className="mt-2 text-[11px] text-[var(--kura-text-secondary)]">
            Chart by TradingView · Swap via Li.Fi on Base
          </p>
        </section>

        <aside className="flex h-fit flex-col rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)] p-4 lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-[var(--kura-bg-lighter)] p-1">
            <button
              type="button"
              onClick={() => {
                setSide("buy");
                setAmount("");
                setQuote(null);
                setTxError(null);
              }}
              className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                side === "buy"
                  ? "bg-emerald-500 text-white"
                  : "text-[var(--kura-text-secondary)]"
              }`}
            >
              Buy
            </button>
            <button
              type="button"
              onClick={() => {
                setSide("sell");
                setAmount("");
                setQuote(null);
                setTxError(null);
              }}
              className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                side === "sell" ? "bg-red-500 text-white" : "text-[var(--kura-text-secondary)]"
              }`}
            >
              Sell
            </button>
          </div>

          <div className="mb-3">
            <TradingAccountPicker
              kind={kind}
              onChange={setKind}
              treasuryReady={treasuryReady}
              treasuryAddress={treasury.scaAddress}
              smartAddress={personal.scaAddress}
              treasuryLabel={treasury.name}
            />
          </div>

          <div className="mb-3 rounded-xl border border-[var(--kura-border)] p-3">
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-[var(--kura-text-secondary)]">
              <span>You pay</span>
              <button
                type="button"
                className="font-semibold text-[var(--kura-primary)] hover:underline"
                onClick={() =>
                  setAmount(
                    available > 0 ? String(Math.floor(available * 1e6) / 1e6) : "0",
                  )
                }
              >
                MAX
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="min-w-0 flex-1 bg-transparent text-xl font-semibold tabular-nums outline-none"
              />
              <span className="rounded-full border border-[var(--kura-border)] px-2.5 py-1 text-xs font-semibold">
                {side === "buy" ? "USDC" : token.displayName}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] text-[var(--kura-text-secondary)]">
              Available: {available.toFixed(side === "buy" ? 2 : 4)}{" "}
              {side === "buy" ? "USDC" : token.displayName}
            </p>
          </div>

          <div className="mb-4 rounded-xl border border-[var(--kura-border)] p-3">
            <p className="mb-1.5 text-[11px] text-[var(--kura-text-secondary)]">You receive (min)</p>
            <div className="flex items-center justify-between">
              <p className="text-xl font-semibold tabular-nums text-[var(--kura-text)]">
                {isQuoting && !quote ? "…" : quote ? formatSwapReceive(quote) : "—"}
              </p>
              <span className="rounded-full border border-[var(--kura-border)] px-2.5 py-1 text-xs font-semibold">
                {side === "buy" ? token.displayName : "USDC"}
              </span>
            </div>
            {quote ? (
              <p className="mt-1.5 text-[11px] text-[var(--kura-text-secondary)]">
                Fee ~${quote.feeUSD}
                {quote.tools.length ? ` · ${quote.tools.join(" → ")}` : ""}
              </p>
            ) : null}
          </div>

          {!tradeAddress ? (
            <p className="mb-3 text-xs text-[var(--kura-warning-fg)]">This token cannot be swapped on web yet.</p>
          ) : null}
          {!scaAddress ? (
            <p className="mb-3 text-xs text-[var(--kura-warning-fg)]">
              No Smart Wallet found. {signerCopy.signIn} — setup runs automatically.
            </p>
          ) : null}
          {!isTreasury && !isPimlicoConfigured() ? (
            <p className="mb-3 text-xs text-[var(--kura-warning-fg)]">
              Set NEXT_PUBLIC_PIMLICO_API_KEY to enable Smart Wallet swaps.
            </p>
          ) : null}
          {quoteError ? <p className="mb-3 text-xs text-[var(--kura-error-fg)]">{quoteError}</p> : null}
          {txError ? <p className="mb-3 text-xs text-[var(--kura-error-fg)]">{txError}</p> : null}
          {txHash ? (
            <p className="mb-3 text-xs text-[var(--kura-success-fg)]">
              Submitted.{" "}
              <a
                href={`https://basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold underline"
              >
                Basescan
              </a>
            </p>
          ) : null}
          {proposedHash ? (
            <p className="mb-3 text-xs text-[var(--kura-success-fg)]">
              Proposed to Treasury.{" "}
              <Link href="/dashboard/approvals" className="font-semibold underline">
                Open Approvals to sign
              </Link>
            </p>
          ) : null}

          <Button
            type="button"
            disabled={!canTrade}
            onClick={() => void handleTrade()}
            className="h-12 w-full rounded-xl text-[15px] font-bold"
          >
            {isSending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {isTreasury ? "Proposing…" : "Confirming…"}
              </>
            ) : isTreasury ? (
              side === "buy" ? `Propose buy ${token.displayName}` : `Propose sell ${token.displayName}`
            ) : side === "buy" ? (
              `Buy ${token.displayName}`
            ) : (
              `Sell ${token.displayName}`
            )}
          </Button>

          <p className="mt-3 text-center text-[11px] text-[var(--kura-text-secondary)]">
            Powered by Li.Fi · {isTreasury ? "Treasury · Approvals queue" : "Smart Wallet on Base"}
          </p>
        </aside>
      </div>
    </DashboardPage>
  );
}
