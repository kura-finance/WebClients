"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  findStockMeta,
  formatStockPrice,
  type StockQuoteRow,
} from "@/lib/stockCatalog";
import { fetchCuratedStockQuotes } from "@/lib/stockCatalog";
import { stockLogoUrl } from "@/lib/assetLogos";
import { fetchUsdcBalance } from "@/lib/baseChain";
import {
  connectWallet,
  createKycLink,
  getAccount,
  getEntity,
  getStockQuote,
  getWalletNonce,
  listStocks,
  placeDinariOrder,
  type DinariEntity,
} from "@/lib/dinariApi";
import {
  signMessageFromSafe,
  signTypedDataFromSafe,
} from "@/lib/smartAccountSend";
import { isPimlicoConfigured } from "@/config/env";
import { isSignerConfigured, useSignerWallet } from "@/lib/signer";
import { signerCopy } from "@/lib/signer/copy";
import PrivyEoaSync from "@/components/wallet/PrivyEoaSync";
import TradingAccountPicker, {
  useTradingAccount,
} from "@/components/wallet/TradingAccountPicker";
import TradingViewChart from "@/components/markets/TradingViewChart";
import { Button } from "@/components/ui/button";
import AssetIcon from "@/components/ui/AssetIcon";
import { ApiError } from "@/lib/errorHandler";
import { DashboardPage } from "@/components/dashboard/PageShell";

interface StockDetailViewProps {
  symbol: string;
}

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message || e.userMessage;
  if (e instanceof Error) return e.message;
  return "Something went wrong. Please try again.";
}

export default function StockDetailView({ symbol }: StockDetailViewProps) {
  const meta = useMemo(() => findStockMeta(symbol), [symbol]);
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
  const { refresh, applyEoaAddress, record } = personal;
  const signerWallet = useSignerWallet();

  const [quote, setQuote] = useState<StockQuoteRow | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [stockId, setStockId] = useState<string | null>(null);
  const [dinariQuote, setDinariQuote] = useState<{ bid?: number; ask?: number } | null>(null);
  const [entity, setEntity] = useState<DinariEntity | null>(null);
  const [walletLinked, setWalletLinked] = useState(false);
  const [usdcBal, setUsdcBal] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [kycUrl, setKycUrl] = useState<string | null>(null);

  const numericAmount = Number(amount);
  const mid =
    dinariQuote?.ask && dinariQuote?.bid
      ? (dinariQuote.ask + dinariQuote.bid) / 2
      : dinariQuote?.ask ?? dinariQuote?.bid ?? quote?.price ?? 0;
  const receiveEstimate =
    numericAmount > 0 && mid > 0
      ? side === "buy"
        ? numericAmount / mid
        : numericAmount * mid
      : null;

  useEffect(() => {
    let cancelled = false;
    void fetchCuratedStockQuotes()
      .then((rows) => {
        if (cancelled) return;
        const row = rows.find((r) => r.symbol.toLowerCase() === symbol.toLowerCase());
        setQuote(row ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    void listStocks({ symbols: [symbol.toUpperCase()], pageSize: 5 })
      .then((stocks) => {
        if (cancelled) return;
        const match =
          stocks.find((s) => s.symbol.toUpperCase() === symbol.toUpperCase()) ?? stocks[0];
        setStockId(match?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setStockId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    if (!stockId) return;
    let cancelled = false;
    void getStockQuote(stockId)
      .then((q) => {
        if (!cancelled) setDinariQuote(q);
      })
      .catch(() => {
        if (!cancelled) setDinariQuote(null);
      });
    return () => {
      cancelled = true;
    };
  }, [stockId]);

  const refreshGate = useCallback(async () => {
    try {
      const ent = await getEntity();
      setEntity(ent);
      if (ent.canTransact && scaAddress) {
        const acct = await getAccount();
        const linked =
          !!acct.walletAddress &&
          acct.walletAddress.toLowerCase() === scaAddress.toLowerCase();
        setWalletLinked(linked);
      }
    } catch {
      setEntity(null);
      setWalletLinked(false);
    }
  }, [scaAddress]);

  useEffect(() => {
    void refreshGate();
  }, [refreshGate]);

  useEffect(() => {
    if (!scaAddress) {
      setUsdcBal(0);
      return;
    }
    void fetchUsdcBalance(scaAddress as `0x${string}`)
      .then(setUsdcBal)
      .catch(() => setUsdcBal(0));
  }, [scaAddress]);

  const ensureWalletLinked = async () => {
    if (!scaAddress || !signerWallet) throw new Error(signerCopy.smartWalletNotReady);
    if (walletLinked) return;
    const nonce = await getWalletNonce(scaAddress);
    const provider = (await signerWallet.getEthereumProvider()) as {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
    const signature = await signMessageFromSafe({
      eip1193Provider: provider,
      expectedScaAddress: scaAddress as `0x${string}`,
      message: nonce.message,
      ...accountOpts,
    });
    await connectWallet({
      walletAddress: scaAddress,
      nonce: nonce.nonce,
      signature,
    });
    setWalletLinked(true);
  };

  const handleKyc = async () => {
    setError(null);
    setIsBusy(true);
    try {
      const link = await createKycLink();
      setKycUrl(link.embedUrl);
      window.open(link.embedUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setIsBusy(false);
    }
  };

  const handleTrade = async () => {
    setError(null);
    setSuccess(null);
    if (!meta || !stockId || !scaAddress || !signerWallet) return;
    if (isTreasury) {
      setError("Stock orders use Smart Wallet signing. Switch to Smart Wallet to trade.");
      return;
    }
    if (!(numericAmount > 0)) {
      setError("Enter an amount greater than 0.");
      return;
    }
    if (!entity?.canTransact) {
      setError("Complete Dinari KYC before trading.");
      return;
    }

    setIsBusy(true);
    try {
      await ensureWalletLinked();
      const provider = (await signerWallet.getEthereumProvider()) as {
        request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      };
      const result = await placeDinariOrder({
        side: side === "buy" ? "BUY" : "SELL",
        stockId,
        paymentTokenQuantity: side === "buy" ? String(numericAmount) : undefined,
        assetTokenQuantity: side === "sell" ? String(numericAmount) : undefined,
        signPermit: (permit) =>
          signTypedDataFromSafe({
            eip1193Provider: provider,
            expectedScaAddress: scaAddress as `0x${string}`,
            typedData: permit,
            ...accountOpts,
          }),
      });
      setSuccess(`Order ${result.status}${result.orderId ? ` · ${result.orderId}` : ""}`);
      setAmount("");
      await refresh();
      const bal = await fetchUsdcBalance(scaAddress as `0x${string}`);
      setUsdcBal(bal);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setIsBusy(false);
    }
  };

  if (!meta) {
    return (
      <DashboardPage>
        <Link
          href="/dashboard/rwa"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--kura-primary-light)] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Market
        </Link>
        <p className="text-sm text-[var(--kura-text-secondary)]">Unknown stock: {symbol}</p>
      </DashboardPage>
    );
  }

  const price = dinariQuote?.ask ?? dinariQuote?.bid ?? quote?.price ?? 0;
  const change = quote?.change24h;
  const up = (change ?? 0) >= 0;
  const tvSymbol = quote?.tvSymbol ?? meta.tvSymbol;
  const canTrade =
    !!stockId &&
    !!scaAddress &&
    !!signerWallet &&
    isPimlicoConfigured() &&
    isSignerConfigured &&
    !!entity?.canTransact &&
    numericAmount > 0 &&
    !isBusy;

  return (
    <DashboardPage className="!max-w-none px-4 pb-10 pt-4 sm:px-5 lg:px-6">
      <PrivyEoaSync onEoa={applyEoaAddress} persistedEoa={record.walletAddress} />
      <Link
        href="/dashboard/rwa"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--kura-text-secondary)] hover:text-[var(--kura-text)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Market
      </Link>

      {/* Lighter-style: chart ~3/4 · trade panel ~1/4 */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(280px,1fr)] lg:items-stretch lg:gap-4">
        <section className="flex min-w-0 flex-col">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)] px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <AssetIcon
                src={stockLogoUrl(meta.symbol)}
                label={meta.symbol}
                color={meta.color}
                size={40}
              />
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold tracking-tight text-[var(--kura-text)] sm:text-2xl">
                  {meta.symbol}
                </h1>
                <p className="text-xs text-[var(--kura-text-secondary)]">{meta.name} · dShare</p>
              </div>
            </div>
            <div className="text-right">
              {loading ? (
                <div className="ml-auto h-8 w-24 animate-pulse rounded-lg bg-[var(--kura-border)]" />
              ) : (
                <>
                  <p className="text-2xl font-semibold tabular-nums tracking-tight text-[var(--kura-text)] sm:text-3xl">
                    {formatStockPrice(price)}
                  </p>
                  {change != null ? (
                    <p
                      className={`mt-0.5 text-sm font-semibold tabular-nums ${
                        up ? "text-emerald-500" : "text-red-500"
                      }`}
                    >
                      {up ? "+" : ""}
                      {change.toFixed(2)}% · 24h
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </div>

          <TradingViewChart
            symbol={tvSymbol}
            interval="D"
            className="min-h-[420px] flex-1 lg:min-h-[calc(100vh-11rem)]"
          />

          <p className="mt-2 text-[11px] text-[var(--kura-text-secondary)]">
            Underlying chart via TradingView ({tvSymbol}). Tokenized trading settles as Dinari
            dShares on Base.
          </p>
        </section>

        <aside className="flex h-fit flex-col rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)] p-4 lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-[var(--kura-bg-lighter)] p-1">
            <button
              type="button"
              onClick={() => setSide("buy")}
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
              onClick={() => setSide("sell")}
              className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                side === "sell"
                  ? "bg-red-500 text-white"
                  : "text-[var(--kura-text-secondary)]"
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
              treasuryDisabledReason="Stock orders use Dinari EIP-712 — Smart Wallet only (Treasury Approvals does not apply)."
            />
          </div>

          <div className="mb-3 flex gap-2 text-xs font-semibold">
            <span className="rounded-md bg-[var(--kura-text)] px-2.5 py-1 text-[var(--kura-bg)]">
              Market
            </span>
            <span className="rounded-md border border-[var(--kura-border)] px-2.5 py-1 text-[var(--kura-text-secondary)] opacity-60">
              Limit
            </span>
          </div>

          <div className="mb-3 rounded-xl border border-[var(--kura-border)] p-3">
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-[var(--kura-text-secondary)]">
              <span>You trade</span>
              {side === "buy" ? (
                <button
                  type="button"
                  className="font-semibold text-[var(--kura-primary)] hover:underline"
                  onClick={() =>
                    setAmount(usdcBal > 0 ? String(Math.floor(usdcBal * 100) / 100) : "0")
                  }
                >
                  MAX
                </button>
              ) : (
                <span>MAX</span>
              )}
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
                {side === "buy" ? "USDC" : meta.symbol}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] text-[var(--kura-text-secondary)]">
              Available: {usdcBal.toFixed(2)} USDC
            </p>
          </div>

          <div className="mb-4 rounded-xl border border-[var(--kura-border)] p-3">
            <p className="mb-1.5 text-[11px] text-[var(--kura-text-secondary)]">You receive (est.)</p>
            <div className="flex items-center justify-between">
              <p className="text-xl font-semibold tabular-nums text-[var(--kura-text)]">
                {receiveEstimate != null
                  ? receiveEstimate.toLocaleString("en-US", { maximumFractionDigits: 4 })
                  : "—"}
              </p>
              <span className="rounded-full border border-[var(--kura-border)] px-2.5 py-1 text-xs font-semibold">
                {side === "buy" ? meta.symbol : "USDC"}
              </span>
            </div>
          </div>

          {entity && !entity.canTransact ? (
            <div className="mb-3 space-y-2">
              <p className="text-xs text-[var(--kura-warning-fg)]">
                Dinari KYC required ({entity.kycStatus}). Complete verification to trade.
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={isBusy}
                onClick={() => void handleKyc()}
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Start KYC
              </Button>
              {kycUrl ? (
                <a
                  href={kycUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center text-[11px] text-[var(--kura-primary)] underline"
                >
                  Open KYC link again
                </a>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="mb-3 text-xs text-[var(--kura-error-fg)]">{error}</p> : null}
          {success ? <p className="mb-3 text-xs text-[var(--kura-success-fg)]">{success}</p> : null}

          <Button
            type="button"
            disabled={!canTrade}
            onClick={() => void handleTrade()}
            className="h-12 w-full rounded-xl text-[15px] font-bold"
          >
            {isBusy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting…
              </>
            ) : side === "buy" ? (
              `Buy ${meta.symbol}`
            ) : (
              `Sell ${meta.symbol}`
            )}
          </Button>

          <p className="mt-3 text-center text-[11px] text-[var(--kura-text-secondary)]">
            Powered by Dinari
          </p>
        </aside>
      </div>
    </DashboardPage>
  );
}
