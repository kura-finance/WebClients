"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowDownUp, ChevronDown, Loader2 } from "lucide-react";
import { HOME_STABLECOINS, type StablecoinBalances, type StablecoinToken } from "@/lib/baseChain";
import {
  fetchSwapQuote,
  formatSwapReceive,
  toTokenWei,
  type SwapQuote,
} from "@/lib/lifiSwap";
import { executeLiFiSwapFromSafe } from "@/lib/smartAccountSend";
import { isPimlicoConfigured } from "@/config/env";
import { cryptoLogoUrl } from "@/lib/assetLogos";
import { isSignerConfigured, useSignerWallet } from "@/lib/signer";
import { signerCopy } from "@/lib/signer/copy";
import AssetIcon from "@/components/ui/AssetIcon";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/dashboard/PageShell";
import StablecoinPickerModal from "@/components/wallet/StablecoinPickerModal";

const STABLE_COLORS: Record<string, string> = {
  USDC: "#2775CA",
  EURC: "#1E4BD2",
  DAI: "#F5AC37",
  XSGD: "#E31C23",
  AUDD: "#00843D",
  BRZ: "#009C3B",
  MXNe: "#006847",
};

function errMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return "Something went wrong. Please try again.";
}

function tokenBySymbol(symbol: string): StablecoinToken {
  return HOME_STABLECOINS.find((t) => t.symbol === symbol) ?? HOME_STABLECOINS[0]!;
}

interface HomeStableSwapPanelProps {
  scaAddress: string | null;
  balances: StablecoinBalances;
  balancesLoading?: boolean;
  onSwapped?: () => void;
}

export default function HomeStableSwapPanel(props: HomeStableSwapPanelProps) {
  if (!isSignerConfigured) {
    return (
      <Panel padding="md" className="flex h-full flex-col">
        <PanelHeader title="Swap" description="Stablecoins on Base · Li.Fi" />
        <p className="py-6 text-center text-sm text-[var(--kura-text-secondary)]">
          Privy is not configured — stablecoin swaps are unavailable.
        </p>
      </Panel>
    );
  }

  return <HomeStableSwapPanelInner {...props} />;
}

function HomeStableSwapPanelInner({
  scaAddress,
  balances,
  balancesLoading = false,
  onSwapped,
}: HomeStableSwapPanelProps) {
  const signerWallet = useSignerWallet();

  const [fromSymbol, setFromSymbol] = useState("USDC");
  const [toSymbol, setToSymbol] = useState("EURC");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const fromToken = useMemo(() => tokenBySymbol(fromSymbol), [fromSymbol]);
  const toToken = useMemo(() => tokenBySymbol(toSymbol), [toSymbol]);
  const numericAmount = Number(amount);
  const available = balances[fromToken.symbol] ?? 0;

  const flipTokens = () => {
    setFromSymbol(toSymbol);
    setToSymbol(fromSymbol);
    setAmount("");
    setQuote(null);
    setQuoteError(null);
  };

  useEffect(() => {
    if (fromSymbol === toSymbol) {
      const next = HOME_STABLECOINS.find((t) => t.symbol !== fromSymbol);
      if (next) setToSymbol(next.symbol);
    }
  }, [fromSymbol, toSymbol]);

  useEffect(() => {
    if (
      !scaAddress ||
      fromToken.address.toLowerCase() === toToken.address.toLowerCase() ||
      !(numericAmount > 0) ||
      numericAmount > available
    ) {
      setQuote(null);
      setQuoteError(null);
      return;
    }

    const wei = toTokenWei(numericAmount, fromToken.decimals);
    if (wei === "0") return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setIsQuoting(true);
      setQuoteError(null);
      void fetchSwapQuote({
        fromAmountWei: wei,
        fromAddress: scaAddress,
        fromTokenAddress: fromToken.address,
        toTokenAddress: toToken.address,
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
  }, [scaAddress, fromToken, toToken, numericAmount, available]);

  const canSwap =
    !!scaAddress &&
    !!signerWallet &&
    isPimlicoConfigured() &&
    !!quote &&
    !isQuoting &&
    !isSending &&
    numericAmount > 0 &&
    numericAmount <= available &&
    fromToken.symbol !== toToken.symbol;

  const handleSwap = async () => {
    setTxError(null);
    setTxHash(null);
    if (!canSwap || !quote || !scaAddress || !signerWallet) return;

    setIsSending(true);
    try {
      const provider = (await signerWallet.getEthereumProvider()) as {
        request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      };
      const hash = await executeLiFiSwapFromSafe({
        eip1193Provider: provider,
        expectedScaAddress: scaAddress as `0x${string}`,
        quote,
      });
      setTxHash(hash);
      setAmount("");
      setQuote(null);
      onSwapped?.();
    } catch (e) {
      setTxError(errMessage(e));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Panel padding="md" className="flex h-full flex-col">
      <PanelHeader title="Swap" description="Stablecoins on Base · Li.Fi" />

      <div className="flex flex-1 flex-col justify-center space-y-3">
        <SwapLeg
          label="You pay"
          symbol={fromSymbol}
          amount={amount}
          editable
          available={available}
          loading={balancesLoading}
          balances={balances}
          excludeSymbol={toSymbol}
          onAmountChange={setAmount}
          onSymbolChange={(symbol) => {
            setFromSymbol(symbol);
            if (symbol === toSymbol) {
              const next = HOME_STABLECOINS.find((t) => t.symbol !== symbol);
              if (next) setToSymbol(next.symbol);
            }
          }}
          onMax={() =>
            setAmount(available > 0 ? String(Math.floor(available * 1e6) / 1e6) : "0")
          }
        />

        <div className="flex justify-center">
          <button
            type="button"
            onClick={flipTokens}
            aria-label="Flip tokens"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--kura-border)] bg-[var(--kura-bg-light)] text-[var(--kura-text-secondary)] transition-colors hover:text-[var(--kura-text)]"
          >
            <ArrowDownUp className="h-4 w-4" />
          </button>
        </div>

        <SwapLeg
          label="You receive (min)"
          symbol={toSymbol}
          amount={isQuoting && !quote ? "…" : quote ? formatSwapReceive(quote) : ""}
          editable={false}
          available={balances[toToken.symbol] ?? 0}
          loading={balancesLoading}
          balances={balances}
          excludeSymbol={fromSymbol}
          onSymbolChange={(symbol) => {
            setToSymbol(symbol);
            if (symbol === fromSymbol) {
              const next = HOME_STABLECOINS.find((t) => t.symbol !== symbol);
              if (next) setFromSymbol(next.symbol);
            }
          }}
        />

        {quote ? (
          <p className="text-[11px] text-[var(--kura-text-secondary)]">
            Fee ~${quote.feeUSD}
            {quote.tools.length ? ` · ${quote.tools.join(" → ")}` : ""}
          </p>
        ) : null}

        {!scaAddress ? (
          <p className="text-xs text-[var(--kura-warning-fg)]">
            {signerCopy.connectWith} to swap from your Smart Wallet.
          </p>
        ) : null}
        {scaAddress && !isPimlicoConfigured() ? (
          <p className="text-xs text-[var(--kura-warning-fg)]">
            Set NEXT_PUBLIC_PIMLICO_API_KEY to enable Smart Wallet swaps.
          </p>
        ) : null}
        {quoteError ? <p className="text-xs text-[var(--kura-error-fg)]">{quoteError}</p> : null}
        {txError ? <p className="text-xs text-[var(--kura-error-fg)]">{txError}</p> : null}
        {txHash ? (
          <p className="text-xs text-[var(--kura-success-fg)]">
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

        <Button
          type="button"
          disabled={!canSwap}
          onClick={() => void handleSwap()}
          className="mt-auto h-11 w-full rounded-xl text-sm font-bold"
        >
          {isSending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Confirming…
            </>
          ) : (
            `Swap ${fromToken.symbol} → ${toToken.symbol}`
          )}
        </Button>
      </div>
    </Panel>
  );
}

function SwapLeg({
  label,
  symbol,
  amount,
  editable,
  available,
  loading,
  balances,
  excludeSymbol,
  onAmountChange,
  onSymbolChange,
  onMax,
}: {
  label: string;
  symbol: string;
  amount: string;
  editable: boolean;
  available: number;
  loading?: boolean;
  balances?: StablecoinBalances;
  excludeSymbol?: string;
  onAmountChange?: (value: string) => void;
  onSymbolChange: (symbol: string) => void;
  onMax?: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="rounded-xl border border-[var(--kura-border)] p-3">
      <div className="mb-1.5 flex items-center justify-between text-[11px] text-[var(--kura-text-secondary)]">
        <span>{label}</span>
        {editable && onMax ? (
          <button
            type="button"
            className="font-semibold text-[var(--kura-primary)] hover:underline"
            onClick={onMax}
          >
            MAX
          </button>
        ) : (
          <span>
            Bal{" "}
            {loading
              ? "…"
              : available.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {editable ? (
          <input
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => onAmountChange?.(e.target.value)}
            placeholder="0.00"
            className="min-w-0 flex-1 bg-transparent text-xl font-semibold tabular-nums outline-none"
          />
        ) : (
          <p className="min-w-0 flex-1 text-xl font-semibold tabular-nums text-[var(--kura-text)]">
            {amount || "—"}
          </p>
        )}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-[var(--kura-border)] bg-[var(--kura-bg-light)] py-1 pl-1.5 pr-2 transition-all hover:border-[var(--kura-primary)]/40 hover:bg-[var(--kura-primary)]/10 hover:shadow-sm"
          aria-label={`${label} token`}
        >
          <AssetIcon
            src={cryptoLogoUrl(symbol)}
            label={symbol}
            color={STABLE_COLORS[symbol] ?? "#64748B"}
            size={22}
          />
          <span className="text-xs font-semibold text-[var(--kura-text)]">{symbol}</span>
          <ChevronDown className="h-3.5 w-3.5 text-[var(--kura-text-secondary)] transition-colors group-hover:text-[var(--kura-text)]" />
        </button>
      </div>
      {editable ? (
        <p className="mt-1.5 text-[11px] text-[var(--kura-text-secondary)]">
          Available:{" "}
          {loading
            ? "…"
            : available.toLocaleString("en-US", { maximumFractionDigits: 2 })}{" "}
          {symbol}
        </p>
      ) : null}

      <StablecoinPickerModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={editable ? "Pay with" : "Receive"}
        selectedSymbol={symbol}
        excludedSymbol={excludeSymbol}
        balances={balances}
        onSelect={(token) => onSymbolChange(token.symbol)}
      />
    </div>
  );
}
