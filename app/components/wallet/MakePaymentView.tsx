"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  Check,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useWallets } from "@privy-io/react-auth";
import { useHomeWallet } from "@/hooks/useHomeWallet";
import { useAppStore } from "@/store/useAppStore";
import { isPimlicoConfigured, isPrivyConfigured } from "@/config/env";
import { features } from "@/config/features";
import PrivyEoaSync from "@/components/wallet/PrivyEoaSync";
import BridgeVerifyGate from "@/components/wallet/BridgeVerifyGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DashboardPage } from "@/components/dashboard/PageShell";
import { ApiError } from "@/lib/errorHandler";
import { executeLiFiBridgeFromSafe, sendUsdcFromSafe } from "@/lib/smartAccountSend";
import {
  BASE_CHAIN,
  BASE_CHAIN_ID,
  SEND_CHAINS,
  fetchBridgeQuote,
  formatBridgeFeeTotal,
  formatBridgeReceive,
  formatBridgeTime,
  type BridgeChain,
  type LiFiBridgeQuote,
} from "@/lib/lifiBridge";
import {
  createExternalAccount,
  formatDepositFeeLabel,
  getBridgeCustomer,
  getOrCreatePayoutAddress,
  isBridgeTransactReady,
  isBusinessCustomer,
  isKycApproved,
  isKycInReview,
  listExternalAccounts,
  listPayoutDrains,
  listPayoutOptions,
  payoutRailLabel,
  type BridgeCustomer,
  type ExternalAccountResult,
  type PayoutAddressResult,
  type PayoutDrainResult,
  type PayoutOption,
} from "@/lib/bridgeRampApi";

const QUOTE_REFRESH_SEC = 30;

type Step = "method" | "crypto" | "bank";

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message || e.userMessage;
  if (e instanceof Error) return e.message;
  return "Something went wrong. Please try again.";
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function basescanTx(hash: string): string {
  return `https://basescan.org/tx/${hash}`;
}

export default function MakePaymentView() {
  const wallet = useHomeWallet();
  const userProfile = useAppStore((s) => s.userProfile);
  const { wallets } = useWallets();
  // Bank payouts go through Bridge (backend). Without it, crypto is the only method.
  const [step, setStep] = useState<Step>(features.fiatRamp ? "method" : "crypto");

  const balance = wallet.stableBalances.USDC ?? 0;
  const sca = wallet.scaAddress;
  const privyWallet =
    wallets.find((w) => w.walletClientType === "privy") ?? wallets[0] ?? null;

  return (
    <DashboardPage variant="wizard">
      {isPrivyConfigured ? (
        <PrivyEoaSync onEoa={wallet.applyEoaAddress} persistedEoa={wallet.record.walletAddress} />
      ) : null}

      {features.fiatRamp && step !== "method" ? (
        <button
          type="button"
          onClick={() => setStep("method")}
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--kura-text-secondary)] transition-colors hover:text-[var(--kura-text)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      ) : null}

      {step === "method" ? (
        <>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--kura-text-secondary)]">
            Wallet
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--kura-text)]">
            Transfer
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--kura-text-secondary)]">
            Send USDC from your Smart Wallet on Base, or cash out to a bank via Bridge.
          </p>

          {!wallet.loading && sca ? (
            <div className="mt-5 rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
                Available · USDC
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kura-text)]">
                {wallet.stablesLoading ? "…" : formatUsd(balance)}
              </p>
            </div>
          ) : null}

          <div className="mt-8 space-y-3">
            <MethodRow
              icon={<ArrowUpRight className="h-5 w-5 text-[var(--kura-primary-light)]" />}
              title="Send crypto"
              subtitle="USDC on Base from your Smart Wallet"
              onClick={() => setStep("crypto")}
            />
            <MethodRow
              icon={<Building2 className="h-5 w-5 text-[var(--kura-primary-light)]" />}
              title="Bank transfer"
              subtitle="ACH, Wire, SEPA — via Bridge"
              onClick={() => setStep("bank")}
            />
          </div>
        </>
      ) : null}

      {step === "crypto" ? (
        <CryptoSendPanel
          balance={balance}
          scaAddress={sca}
          privyWallet={privyWallet}
          onSent={() => void wallet.refresh()}
        />
      ) : null}

      {features.fiatRamp && step === "bank" ? (
        <BankPayoutPanel
          balance={balance}
          scaAddress={sca}
          privyWallet={privyWallet}
          defaultName={userProfile.displayName}
          defaultEmail={userProfile.email}
          onSent={() => void wallet.refresh()}
        />
      ) : null}
    </DashboardPage>
  );
}

function MethodRow({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3.5 rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)] px-4 py-4 text-left transition-colors hover:bg-[var(--kura-bg-lighter)]"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--kura-primary)]/12">
        {icon}
      </span>
      <span className="min-w-0 pt-0.5">
        <span className="block text-[15px] font-semibold text-[var(--kura-text)]">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-[var(--kura-text-secondary)]">
          {subtitle}
        </span>
      </span>
    </button>
  );
}

type PrivyWalletLike = {
  getEthereumProvider: () => Promise<unknown>;
  address?: string;
} | null;

function CryptoSendPanel({
  balance,
  scaAddress,
  privyWallet,
  onSent,
}: {
  balance: number;
  scaAddress: string | null;
  privyWallet: PrivyWalletLike;
  onSent: () => void;
}) {
  const [chain, setChain] = useState<BridgeChain>(BASE_CHAIN);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [quote, setQuote] = useState<LiFiBridgeQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isFetchingQuote, setIsFetchingQuote] = useState(false);
  const [countdown, setCountdown] = useState(QUOTE_REFRESH_SEC);

  const isBridge = chain.id !== BASE_CHAIN_ID;
  const numericAmount = Number(amount);
  const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(to.trim());
  const canQuote =
    isBridge &&
    !!scaAddress &&
    isValidAddress &&
    numericAmount > 0 &&
    numericAmount <= balance;

  const canSend =
    !!scaAddress &&
    !!privyWallet &&
    isPimlicoConfigured() &&
    isValidAddress &&
    numericAmount > 0 &&
    numericAmount <= balance &&
    !isSending &&
    (!isBridge || (!!quote && !quoteError && !isFetchingQuote));

  const loadQuote = useCallback(async () => {
    if (!canQuote || !scaAddress) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    setIsFetchingQuote(true);
    setQuoteError(null);
    try {
      const q = await fetchBridgeQuote({
        fromChainId: BASE_CHAIN_ID,
        toChainId: chain.id,
        fromAmountWei: String(Math.round(numericAmount * 1_000_000)),
        fromAddress: scaAddress,
        toAddress: to.trim(),
      });
      setQuote(q);
      setCountdown(QUOTE_REFRESH_SEC);
    } catch (e) {
      setQuote(null);
      setQuoteError(errMessage(e));
    } finally {
      setIsFetchingQuote(false);
    }
  }, [canQuote, scaAddress, chain.id, numericAmount, to]);

  useEffect(() => {
    if (!isBridge) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    if (!canQuote) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const debounce = window.setTimeout(() => {
      void loadQuote();
    }, 400);
    return () => window.clearTimeout(debounce);
  }, [isBridge, canQuote, loadQuote]);

  useEffect(() => {
    if (!isBridge || !quote || !canQuote) return;
    const tick = window.setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          void loadQuote();
          return QUOTE_REFRESH_SEC;
        }
        return c - 1;
      });
    }, 1000);
    return () => window.clearInterval(tick);
  }, [isBridge, quote, canQuote, loadQuote]);

  const handleSend = async () => {
    setError(null);
    setTxHash(null);
    if (!scaAddress) {
      setError("No Smart Wallet found. Sign in with Privy — setup runs automatically.");
      return;
    }
    if (!privyWallet) {
      setError("Privy wallet not ready. Sign in again and retry.");
      return;
    }
    if (!isPimlicoConfigured()) {
      setError("Sending is not configured (missing Pimlico API key).");
      return;
    }
    if (!isValidAddress) {
      setError("Enter a valid recipient address.");
      return;
    }
    if (!(numericAmount > 0)) {
      setError("Enter an amount greater than 0.");
      return;
    }
    if (numericAmount > balance) {
      setError("Amount exceeds your available balance.");
      return;
    }
    if (isBridge && !quote) {
      setError("Waiting for a bridge quote. Try again in a moment.");
      return;
    }

    setIsSending(true);
    try {
      const provider = (await privyWallet.getEthereumProvider()) as {
        request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      };
      const hash = isBridge
        ? await executeLiFiBridgeFromSafe({
            eip1193Provider: provider,
            expectedScaAddress: scaAddress as `0x${string}`,
            quote: quote!,
          })
        : await sendUsdcFromSafe({
            eip1193Provider: provider,
            expectedScaAddress: scaAddress as `0x${string}`,
            toAddress: to.trim() as `0x${string}`,
            amountUsdc: numericAmount,
          });
      setTxHash(hash);
      setAmount("");
      setQuote(null);
      onSent();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight text-[var(--kura-text)]">
        Send crypto
      </h1>
      <p className="mt-2 text-sm text-[var(--kura-text-secondary)]">
        Send USDC from your Smart Wallet on Base. Same-chain or cross-chain via Li.Fi.
      </p>

      <div className="mt-8 space-y-5">
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
            Destination chain
          </label>
          <div className="flex flex-wrap gap-2">
            {SEND_CHAINS.map((c) => {
              const selected = c.id === chain.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setChain(c);
                    setTxHash(null);
                    setError(null);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    selected
                      ? "text-white"
                      : "bg-[var(--kura-surface)] text-[var(--kura-text-secondary)] hover:text-[var(--kura-text)]"
                  }`}
                  style={selected ? { backgroundColor: c.color } : undefined}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
            Recipient address
          </label>
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="0x…"
            className="font-mono"
            spellCheck={false}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
              Amount
            </label>
            <button
              type="button"
              onClick={() => setAmount(balance > 0 ? String(Math.floor(balance * 100) / 100) : "0")}
              className="text-[11px] font-semibold text-[var(--kura-primary)] hover:underline"
            >
              Max: {balance.toFixed(2)} USDC
            </button>
          </div>
          <div className="relative">
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              className="pr-16"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-[var(--kura-text-secondary)]">
              USDC
            </span>
          </div>
        </div>

        {isBridge ? (
          <div className="rounded-xl border border-[var(--kura-border)] bg-[var(--kura-surface)] px-3.5 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
                Bridge quote
              </span>
              <button
                type="button"
                onClick={() => void loadQuote()}
                disabled={!canQuote || isFetchingQuote}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--kura-primary)] hover:underline disabled:opacity-40"
              >
                <RefreshCw className={`h-3 w-3 ${isFetchingQuote ? "animate-spin" : ""}`} />
                {quote ? `${countdown}s` : "Refresh"}
              </button>
            </div>
            {!canQuote ? (
              <p className="text-xs text-[var(--kura-text-secondary)]">
                Enter recipient and amount to get a Li.Fi quote.
              </p>
            ) : quoteError ? (
              <p className="text-xs text-[var(--kura-error-fg)]">{quoteError}</p>
            ) : isFetchingQuote && !quote ? (
              <p className="inline-flex items-center gap-1.5 text-xs text-[var(--kura-text-secondary)]">
                <Loader2 className="h-3 w-3 animate-spin" /> Fetching quote…
              </p>
            ) : quote ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div>
                  <dt className="text-[var(--kura-text-secondary)]">You receive (min)</dt>
                  <dd className="font-semibold text-[var(--kura-text)]">
                    {formatBridgeReceive(quote)} USDC
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--kura-text-secondary)]">Bridge fee</dt>
                  <dd className="font-semibold text-[var(--kura-text)]">
                    {formatBridgeFeeTotal(quote)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--kura-text-secondary)]">Est. time</dt>
                  <dd className="font-semibold text-[var(--kura-text)]">
                    {formatBridgeTime(quote)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--kura-text-secondary)]">Route</dt>
                  <dd className="font-semibold text-[var(--kura-text)]">
                    {quote.tools.length ? quote.tools.join(" → ") : "Li.Fi"}
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>
        ) : null}

        {!isPimlicoConfigured() ? (
          <div className="rounded-xl border border-[var(--kura-warning-border)] bg-[var(--kura-warning-bg)] px-3 py-2.5 text-xs text-[var(--kura-warning-fg)]">
            Set <code className="font-mono">NEXT_PUBLIC_PIMLICO_API_KEY</code> to enable on-chain
            sends from web.
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-[var(--kura-error-border)] bg-[var(--kura-error-bg)] px-3 py-2.5 text-xs text-[var(--kura-error-fg)]">
            {error}
          </div>
        ) : null}

        {txHash ? (
          <div className="rounded-xl border border-[var(--kura-success-border)] bg-[var(--kura-success-bg)] px-3 py-2.5 text-xs text-[var(--kura-success-fg)]">
            {isBridge ? "Bridge submitted. " : "Sent. "}
            <a
              href={basescanTx(txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold underline"
            >
              View on Basescan <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        ) : null}

        <Button
          type="button"
          onClick={() => void handleSend()}
          disabled={!canSend}
          className="w-full"
          size="lg"
        >
          {isSending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {isBridge ? "Bridging…" : "Sending…"}
            </>
          ) : isBridge ? (
            `Bridge to ${chain.name}`
          ) : (
            "Send"
          )}
        </Button>
      </div>
    </>
  );
}

function BankPayoutPanel({
  balance,
  scaAddress,
  privyWallet,
  defaultName,
  defaultEmail,
  onSent,
}: {
  balance: number;
  scaAddress: string | null;
  privyWallet: PrivyWalletLike;
  defaultName: string;
  defaultEmail: string;
  onSent: () => void;
}) {
  const [customer, setCustomer] = useState<BridgeCustomer | null>(null);
  const [accounts, setAccounts] = useState<ExternalAccountResult[]>([]);
  const [options, setOptions] = useState<PayoutOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedRail, setSelectedRail] = useState<string | null>(null);
  const [payoutAddress, setPayoutAddress] = useState<PayoutAddressResult | null>(null);
  const [drains, setDrains] = useState<PayoutDrainResult[]>([]);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingPayout, setLoadingPayout] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showAddBank, setShowAddBank] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Add bank (USD ACH) form
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [savingBank, setSavingBank] = useState(false);

  const ready = isBridgeTransactReady(customer);
  const selectedAccount = accounts.find((a) => a.bridgeExternalAccountId === selectedAccountId) ?? null;

  const railsForAccount = useMemo(() => {
    if (!selectedAccount) return [];
    const currency = selectedAccount.currency.toLowerCase();
    return options.filter((o) => String(o.destinationCurrency).toLowerCase() === currency);
  }, [options, selectedAccount]);

  const selectedOption =
    railsForAccount.find((o) => o.destinationRail === selectedRail) ?? railsForAccount[0] ?? null;

  const numericAmount = Number(amount);
  const canSend =
    !!scaAddress &&
    !!privyWallet &&
    !!payoutAddress?.depositAddress &&
    isPimlicoConfigured() &&
    numericAmount > 0 &&
    numericAmount <= balance &&
    !isSending;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const c = await getBridgeCustomer();
      setCustomer(c);
      if (c && (c.canTransact || isKycApproved(c.kycStatus))) {
        const [ext, opts] = await Promise.all([
          listExternalAccounts().catch(() => [] as ExternalAccountResult[]),
          listPayoutOptions().catch(() => [] as PayoutOption[]),
        ]);
        setAccounts(ext.filter((a) => a.active !== false));
        setOptions(opts.length ? opts : []);
        if (ext.length && !selectedAccountId) {
          setSelectedAccountId(ext[0].bridgeExternalAccountId);
        }
      }
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedAccount || !selectedOption || !scaAddress || !ready) {
      setPayoutAddress(null);
      return;
    }
    let cancelled = false;
    setLoadingPayout(true);
    setError(null);
    void getOrCreatePayoutAddress({
      destinationRail: String(selectedOption.destinationRail),
      destinationCurrency: String(selectedOption.destinationCurrency),
      externalAccountId: selectedAccount.bridgeExternalAccountId,
      returnAddress: scaAddress,
    })
      .then(async (pa) => {
        if (cancelled) return;
        setPayoutAddress(pa);
        try {
          const d = await listPayoutDrains(pa.bridgeLiquidationAddressId);
          if (!cancelled) {
            setDrains(
              d
                .slice()
                .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
                .slice(0, 5),
            );
          }
        } catch {
          /* non-fatal */
        }
      })
      .catch((e) => {
        if (!cancelled) setError(errMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingPayout(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAccount, selectedOption, scaAddress, ready]);

  useEffect(() => {
    if (railsForAccount.length && !selectedRail) {
      setSelectedRail(String(railsForAccount[0].destinationRail));
    }
  }, [railsForAccount, selectedRail]);

  const saveBank = async () => {
    setSavingBank(true);
    setError(null);
    try {
      const created = await createExternalAccount({
        currency: "usd",
        accountType: "us",
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        accountOwnerName: `${firstName.trim()} ${lastName.trim()}`.trim(),
        routingNumber: routingNumber.trim(),
        accountNumber: accountNumber.trim(),
        checkingOrSavings: "checking",
      });
      setAccounts((prev) => [created, ...prev]);
      setSelectedAccountId(created.bridgeExternalAccountId);
      setShowAddBank(false);
      setFirstName("");
      setLastName("");
      setRoutingNumber("");
      setAccountNumber("");
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setSavingBank(false);
    }
  };

  const handleSend = async () => {
    setError(null);
    setTxHash(null);
    if (!scaAddress || !privyWallet || !payoutAddress?.depositAddress) return;
    if (!(numericAmount > 0) || numericAmount > balance) {
      setError("Enter a valid amount within your balance.");
      return;
    }
    if (!isPimlicoConfigured()) {
      setError("Sending is not configured (missing Pimlico API key).");
      return;
    }

    setIsSending(true);
    try {
      const provider = (await privyWallet.getEthereumProvider()) as {
        request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      };
      const hash = await sendUsdcFromSafe({
        eip1193Provider: provider,
        expectedScaAddress: scaAddress as `0x${string}`,
        toAddress: payoutAddress.depositAddress as `0x${string}`,
        amountUsdc: numericAmount,
      });
      setTxHash(hash);
      setAmount("");
      onSent();
      try {
        const d = await listPayoutDrains(payoutAddress.bridgeLiquidationAddressId);
        setDrains(
          d
            .slice()
            .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
            .slice(0, 5),
        );
      } catch {
        /* ignore */
      }
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--kura-text)]">
            Bank transfer
          </h1>
          <p className="mt-2 text-sm text-[var(--kura-text-secondary)]">
            Cash out Base USDC to your bank via Bridge.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading}
          className="shrink-0 gap-1.5 text-[var(--kura-text-secondary)]"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <StatusPill customer={customer} loading={loading} />

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--kura-error-border)] bg-[var(--kura-error-bg)] px-3 py-2.5 text-sm text-[var(--kura-error-fg)]">
          {error}
        </div>
      ) : null}

      {loading && !customer ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--kura-text-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Bridge account…
        </div>
      ) : !ready ? (
        <BridgeVerifyGate
          mode="withdraw"
          customer={customer}
          defaultName={defaultName}
          defaultEmail={defaultEmail}
          redirectPath="/dashboard/payment"
          onComplete={() => refresh()}
          onError={(message) => setError(message || null)}
        />
      ) : (
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
                Bank account
              </p>
              <button
                type="button"
                onClick={() => setShowAddBank((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--kura-primary)] hover:underline"
              >
                <Plus className="h-3 w-3" />
                Add USD account
              </button>
            </div>

            {showAddBank ? (
              <div className="mb-3 space-y-3 rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)] p-4">
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="First name"
                  />
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Last name"
                  />
                </div>
                <Input
                  value={routingNumber}
                  onChange={(e) => setRoutingNumber(e.target.value)}
                  placeholder="Routing number"
                  inputMode="numeric"
                />
                <Input
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="Account number"
                  inputMode="numeric"
                />
                <Button
                  type="button"
                  className="w-full"
                  disabled={
                    savingBank ||
                    !firstName.trim() ||
                    !lastName.trim() ||
                    routingNumber.trim().length < 9 ||
                    !accountNumber.trim()
                  }
                  onClick={() => void saveBank()}
                >
                  {savingBank ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save bank account"
                  )}
                </Button>
              </div>
            ) : null}

            {accounts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--kura-border)] px-4 py-8 text-center text-sm text-[var(--kura-text-secondary)]">
                No bank accounts yet. Add a USD ACH account to continue.
              </div>
            ) : (
              <div className="space-y-2">
                {accounts.map((a) => {
                  const active = a.bridgeExternalAccountId === selectedAccountId;
                  return (
                    <button
                      key={a.bridgeExternalAccountId}
                      type="button"
                      onClick={() => {
                        setSelectedAccountId(a.bridgeExternalAccountId);
                        setSelectedRail(null);
                      }}
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left transition-colors ${
                        active
                          ? "border-[var(--kura-primary)] bg-[var(--kura-primary)]/8"
                          : "border-[var(--kura-border)] bg-[var(--kura-surface)] hover:bg-[var(--kura-bg-lighter)]"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--kura-text)]">
                          {a.accountOwnerName || a.bankName || "Bank account"}
                        </p>
                        <p className="text-xs text-[var(--kura-text-secondary)]">
                          {(a.currency || "").toUpperCase()}
                          {a.last4 ? ` · •••• ${a.last4}` : ""}
                        </p>
                      </div>
                      {active ? <Check className="h-4 w-4 text-[var(--kura-primary)]" /> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {railsForAccount.length > 0 ? (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
                Rail
              </p>
              <div className="flex flex-wrap gap-1.5">
                {railsForAccount.map((o) => {
                  const rail = String(o.destinationRail);
                  const active = rail === (selectedOption ? String(selectedOption.destinationRail) : "");
                  return (
                    <button
                      key={rail}
                      type="button"
                      onClick={() => setSelectedRail(rail)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                        active
                          ? "bg-[var(--kura-text)] text-[var(--kura-bg)]"
                          : "border border-[var(--kura-border)] text-[var(--kura-text-secondary)]"
                      }`}
                    >
                      {o.label || payoutRailLabel(rail)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {loadingPayout ? (
            <div className="flex items-center gap-2 text-sm text-[var(--kura-text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Preparing payout address…
            </div>
          ) : payoutAddress ? (
            <div className="rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
                Payout route
              </p>
              <p className="mt-1 text-sm text-[var(--kura-text)]">
                USDC → {payoutRailLabel(String(payoutAddress.destinationRail ?? ""))}{" "}
                {(payoutAddress.destinationCurrency || "").toUpperCase()}
              </p>
              {formatDepositFeeLabel(payoutAddress.payoutFee) ? (
                <p className="mt-1 text-xs text-[var(--kura-text-secondary)]">
                  Fee {formatDepositFeeLabel(payoutAddress.payoutFee)}
                </p>
              ) : null}
            </div>
          ) : null}

          {selectedAccount && payoutAddress ? (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
                  Amount
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setAmount(balance > 0 ? String(Math.floor(balance * 100) / 100) : "0")
                  }
                  className="text-[11px] font-semibold text-[var(--kura-primary)] hover:underline"
                >
                  Max: {balance.toFixed(2)} USDC
                </button>
              </div>
              <div className="relative">
                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="pr-16"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-[var(--kura-text-secondary)]">
                  USDC
                </span>
              </div>
            </div>
          ) : null}

          {!isPimlicoConfigured() ? (
            <div className="rounded-xl border border-[var(--kura-warning-border)] bg-[var(--kura-warning-bg)] px-3 py-2.5 text-xs text-[var(--kura-warning-fg)]">
              Set <code className="font-mono">NEXT_PUBLIC_PIMLICO_API_KEY</code> to send USDC from
              web.
            </div>
          ) : null}

          {txHash ? (
            <div className="rounded-xl border border-[var(--kura-success-border)] bg-[var(--kura-success-bg)] px-3 py-2.5 text-xs text-[var(--kura-success-fg)]">
              Submitted to Bridge.{" "}
              <a
                href={basescanTx(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold underline"
              >
                View tx <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          ) : null}

          {selectedAccount && payoutAddress ? (
            <Button
              type="button"
              className="w-full"
              size="lg"
              disabled={!canSend}
              onClick={() => void handleSend()}
            >
              {isSending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                "Withdraw to bank"
              )}
            </Button>
          ) : null}

          {drains.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
                Recent payouts
              </p>
              <div className="overflow-hidden rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)]">
                {drains.map((d, i) => (
                  <div
                    key={d.bridgeDrainId ?? d.drainId ?? `${d.createdAt}-${i}`}
                    className={`flex items-center justify-between gap-3 px-4 py-3 ${
                      i > 0 ? "border-t border-[var(--kura-border)]" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--kura-text)]">{d.state}</p>
                      <p className="text-[11px] text-[var(--kura-text-secondary)]">
                        {new Date(d.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">
                      {d.amount || "—"} {(d.currency || "").toUpperCase()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}

function StatusPill({
  customer,
  loading,
}: {
  customer: BridgeCustomer | null;
  loading: boolean;
}) {
  if (loading && !customer) return null;

  let label = "KYC not started";
  let className = "bg-[var(--kura-bg-lighter)] text-[var(--kura-text-secondary)]";

  if (customer?.canTransact || isKycApproved(customer?.kycStatus)) {
    label = isBusinessCustomer(customer)
      ? "KYB verified · ready to withdraw"
      : "Verified · ready to withdraw";
    className = "bg-[var(--kura-success-bg)] text-[var(--kura-success-fg)]";
  } else if (isKycInReview(customer?.kycStatus)) {
    label = isBusinessCustomer(customer) ? "KYB under review" : "Verification under review";
    className = "bg-[var(--kura-warning-bg)] text-[var(--kura-warning-fg)]";
  } else if (customer) {
    label = isBusinessCustomer(customer)
      ? `KYB: ${customer.kycStatus}`
      : `KYC: ${customer.kycStatus}`;
  }

  return (
    <div
      className={`mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${className}`}
    >
      <ShieldCheck className="h-3.5 w-3.5" />
      {label}
    </div>
  );
}
