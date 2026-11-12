"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Check,
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useHomeWallet } from "@/hooks/useHomeWallet";
import { useAppStore } from "@/store/useAppStore";
import { isPrivyConfigured } from "@/config/env";
import { features } from "@/config/features";
import PrivyEoaSync from "@/components/wallet/PrivyEoaSync";
import BridgeVerifyGate from "@/components/wallet/BridgeVerifyGate";
import { Button } from "@/components/ui/button";
import { DashboardPage } from "@/components/dashboard/PageShell";
import { ApiError } from "@/lib/errorHandler";
import {
  buildFiatDepositBullets,
  createEndorsementLink,
  depositInstructionRows,
  FIAT_OPTIONS,
  formatDepositFeeLabel,
  formatMinDepositLabel,
  getBridgeCustomer,
  getOrCreateOnRampAccount,
  getPendingFiatEndorsement,
  isBridgeTransactReady,
  isBusinessCustomer,
  isEndorsementRequiredError,
  isKycApproved,
  isKycInReview,
  isUnsupportedCurrencyError,
  listDeposits,
  listOnRampAccounts,
  type BridgeCustomer,
  type DepositResult,
  type FiatCurrency,
  type VirtualAccount,
} from "@/lib/bridgeRampApi";

type Step = "method" | "bank" | "crypto";

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message || e.userMessage;
  if (e instanceof Error) return e.message;
  return "Something went wrong. Please try again.";
}

function openExternal(url: string | null | undefined) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AddMoneyView() {
  const wallet = useHomeWallet();
  const userProfile = useAppStore((s) => s.userProfile);
  // Bank transfers go through Bridge (backend). Without it, crypto is the only method.
  const [step, setStep] = useState<Step>(features.fiatRamp ? "method" : "crypto");
  const [copied, setCopied] = useState<string | null>(null);

  const address = wallet.scaAddress;
  const usdcBalance = wallet.stableBalances.USDC ?? 0;

  const copyValue = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

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
            Add Money
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--kura-text-secondary)]">
            Fund your Smart Wallet with a bank transfer or crypto on Base.
          </p>

          {!wallet.loading && address ? (
            <div className="mt-5 rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
                Smart Wallet · USDC
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kura-text)]">
                {wallet.stablesLoading ? "…" : formatUsd(usdcBalance)}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-[var(--kura-text-secondary)]">
                {address.slice(0, 6)}…{address.slice(-4)}
              </p>
            </div>
          ) : null}

          <div className="mt-8 space-y-3">
            <MethodRow
              icon={<Building2 className="h-5 w-5 text-[var(--kura-primary-light)]" />}
              title="Bank Transfer"
              subtitle="ACH, Wire, SEPA, Pix — via Bridge"
              onClick={() => setStep("bank")}
            />
            <MethodRow
              icon={<Plus className="h-5 w-5 text-[var(--kura-primary-light)]" />}
              title="Crypto"
              subtitle="Deposit USDC to your Smart Wallet on Base"
              onClick={() => setStep("crypto")}
            />
          </div>
        </>
      ) : null}

      {features.fiatRamp && step === "bank" ? (
        <BankTransferPanel
          smartAddress={address}
          defaultName={userProfile.displayName}
          defaultEmail={userProfile.email}
          copied={copied}
          onCopy={copyValue}
        />
      ) : null}

      {step === "crypto" ? (
        <CryptoDepositPanel
          address={address}
          loading={wallet.loading}
          usdcBalance={usdcBalance}
          copied={copied}
          onCopy={copyValue}
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

function BankTransferPanel({
  smartAddress,
  defaultName,
  defaultEmail,
  copied,
  onCopy,
}: {
  smartAddress: string | null;
  defaultName: string;
  defaultEmail: string;
  copied: string | null;
  onCopy: (key: string, value: string) => void;
}) {
  const [currency, setCurrency] = useState<FiatCurrency>("usd");
  const [customer, setCustomer] = useState<BridgeCustomer | null>(null);
  const [accountsByCurrency, setAccountsByCurrency] = useState<Record<string, VirtualAccount>>({});
  const [recentDeposits, setRecentDeposits] = useState<DepositResult[]>([]);
  const [loadingCustomer, setLoadingCustomer] = useState(true);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [startingEndorsement, setStartingEndorsement] = useState(false);
  const [unsupported, setUnsupported] = useState<Record<string, boolean>>({});
  const [pendingEndorsement, setPendingEndorsement] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const selected = FIAT_OPTIONS.find((o) => o.code === currency)!;
  const account = accountsByCurrency[currency] ?? null;
  const ready = isBridgeTransactReady(customer);

  const refresh = useCallback(async () => {
    setLoadingCustomer(true);
    setError(null);
    try {
      const c = await getBridgeCustomer();
      setCustomer(c);
      if (c && (c.canTransact || isKycApproved(c.kycStatus))) {
        try {
          const [list, deposits] = await Promise.all([
            listOnRampAccounts(),
            listDeposits().catch(() => [] as DepositResult[]),
          ]);
          const byCurrency: Record<string, VirtualAccount> = {};
          for (const va of list) {
            byCurrency[va.sourceCurrency.toLowerCase()] = va;
          }
          setAccountsByCurrency(byCurrency);
          setRecentDeposits(
            deposits
              .slice()
              .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
              .slice(0, 5),
          );
        } catch {
          /* accounts load lazily */
        }
      }
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setLoadingCustomer(false);
    }
  }, []);

  const loadAccount = useCallback(
    async (code: FiatCurrency) => {
      setLoadingAccount(true);
      setError(null);
      setAttempted((prev) => ({ ...prev, [code]: true }));
      try {
        const pending = getPendingFiatEndorsement(customer, code);
        if (pending) {
          setPendingEndorsement((prev) => ({ ...prev, [code]: pending }));
          return;
        }
        const va = await getOrCreateOnRampAccount({
          sourceCurrency: code,
          toAddress: smartAddress || undefined,
        });
        setAccountsByCurrency((prev) => ({ ...prev, [code]: va }));
        setPendingEndorsement((prev) => {
          const next = { ...prev };
          delete next[code];
          return next;
        });
      } catch (e) {
        if (isUnsupportedCurrencyError(e)) {
          setUnsupported((prev) => ({ ...prev, [code]: true }));
          return;
        }
        if (isEndorsementRequiredError(e)) {
          const endorsement = getPendingFiatEndorsement(customer, code) || "required";
          setPendingEndorsement((prev) => ({ ...prev, [code]: endorsement }));
          return;
        }
        setError(errMessage(e));
      } finally {
        setLoadingAccount(false);
      }
    },
    [customer, smartAddress],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (
      !ready ||
      account ||
      unsupported[currency] ||
      pendingEndorsement[currency] ||
      attempted[currency] ||
      loadingAccount
    ) {
      return;
    }
    const pending = getPendingFiatEndorsement(customer, currency);
    if (pending) {
      setPendingEndorsement((prev) => ({ ...prev, [currency]: pending }));
      return;
    }
    void loadAccount(currency);
  }, [
    currency,
    ready,
    customer,
    account,
    unsupported,
    pendingEndorsement,
    attempted,
    loadingAccount,
    loadAccount,
  ]);

  const enableEndorsement = async () => {
    setStartingEndorsement(true);
    setError(null);
    try {
      const result = await createEndorsementLink(currency);
      openExternal(result.tosLink);
      openExternal(result.kycLink);
      await refresh();
      await loadAccount(currency);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setStartingEndorsement(false);
    }
  };

  const di = account?.depositInstructions;
  const rows = di ? depositInstructionRows(di) : [];
  const bullets = buildFiatDepositBullets(currency, {
    minDeposit: account?.minDeposit,
    feeLabel: formatDepositFeeLabel(account?.depositFee),
    paymentRails: di?.payment_rails,
  });

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--kura-text)]">
            Bank Transfer
          </h1>
          <p className="mt-2 text-sm text-[var(--kura-text-secondary)]">
            Deposit {selected.label} → receive USDC on Base via Bridge.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          disabled={loadingCustomer}
          className="shrink-0 gap-1.5 text-[var(--kura-text-secondary)]"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingCustomer ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="mb-5 flex flex-wrap gap-1.5">
        {FIAT_OPTIONS.map((opt) => (
          <button
            key={opt.code}
            type="button"
            onClick={() => setCurrency(opt.code)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              currency === opt.code
                ? "bg-[var(--kura-text)] text-[var(--kura-bg)]"
                : "border border-[var(--kura-border)] text-[var(--kura-text-secondary)] hover:text-[var(--kura-text)]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <p className="mb-4 text-xs text-[var(--kura-text-secondary)]">
        {selected.name} · {selected.rails}
      </p>

      <StatusPill customer={customer} loading={loadingCustomer} />

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--kura-error-border)] bg-[var(--kura-error-bg)] px-3 py-2.5 text-sm text-[var(--kura-error-fg)]">
          {error}
        </div>
      ) : null}

      {loadingCustomer && !customer ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--kura-text-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Bridge account…
        </div>
      ) : !ready ? (
        <BridgeVerifyGate
          mode="deposit"
          customer={customer}
          defaultName={defaultName}
          defaultEmail={defaultEmail}
          redirectPath="/dashboard/add-money"
          onComplete={() => refresh()}
          onError={(message) => setError(message || null)}
        />
      ) : unsupported[currency] ? (
        <div className="rounded-2xl border border-dashed border-[var(--kura-border)] px-4 py-10 text-center text-sm text-[var(--kura-text-secondary)]">
          {selected.label} deposits are not available for your account yet.
        </div>
      ) : pendingEndorsement[currency] ? (
        <div className="rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)] p-5">
          <h2 className="text-base font-semibold text-[var(--kura-text)]">
            Enable {selected.label} deposits
          </h2>
          <p className="mt-1.5 text-sm text-[var(--kura-text-secondary)]">
            One extra Bridge approval is required for {selected.rails}.
          </p>
          <Button
            type="button"
            className="mt-4 w-full"
            size="lg"
            disabled={startingEndorsement}
            onClick={() => void enableEndorsement()}
          >
            {startingEndorsement ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Opening Bridge…
              </>
            ) : (
              `Enable ${selected.label}`
            )}
          </Button>
        </div>
      ) : loadingAccount && !account ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--kura-text-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Setting up {selected.label} deposit account…
        </div>
      ) : account && rows.length > 0 ? (
        <>
          <div className="overflow-hidden rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)]">
            {rows.map((row, i) => (
              <div
                key={row.key}
                className={`flex items-start gap-3 px-4 py-3 ${
                  i > 0 ? "border-t border-[var(--kura-border)]" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
                    {row.label}
                  </p>
                  <p className="mt-0.5 break-all font-mono text-sm text-[var(--kura-text)]">
                    {row.value}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void onCopy(row.key, row.value)}
                  className="mt-1 rounded-md p-1.5 text-[var(--kura-text-secondary)] hover:bg-[var(--kura-bg-lighter)] hover:text-[var(--kura-text)]"
                  aria-label={`Copy ${row.label}`}
                >
                  {copied === row.key ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--kura-text-secondary)]">
            {formatMinDepositLabel(account.minDeposit) ? (
              <span className="rounded-full border border-[var(--kura-border)] px-2.5 py-1">
                Min {formatMinDepositLabel(account.minDeposit)}
              </span>
            ) : null}
            {formatDepositFeeLabel(account.depositFee) ? (
              <span className="rounded-full border border-[var(--kura-border)] px-2.5 py-1">
                Fee {formatDepositFeeLabel(account.depositFee)}
              </span>
            ) : null}
            <span className="rounded-full border border-[var(--kura-border)] px-2.5 py-1">
              → Base USDC
            </span>
          </div>

          <ul className="mt-4 space-y-1.5 text-xs leading-relaxed text-[var(--kura-text-secondary)]">
            {bullets.map((b) => (
              <li key={b} className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--kura-text-secondary)]" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <Button
          type="button"
          className="w-full"
          size="lg"
          disabled={loadingAccount || !smartAddress}
          onClick={() => void loadAccount(currency)}
        >
          {loadingAccount ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </>
          ) : (
            "Get deposit details"
          )}
        </Button>
      )}

      {recentDeposits.length > 0 ? (
        <div className="mt-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
            Recent bank deposits
          </p>
          <div className="overflow-hidden rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)]">
            {recentDeposits.map((d, i) => (
              <div
                key={d.depositId ?? `${d.bridgeVirtualAccountId}-${d.createdAt}`}
                className={`flex items-center justify-between gap-3 px-4 py-3 ${
                  i > 0 ? "border-t border-[var(--kura-border)]" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--kura-text)]">
                    {(d.currency || "fiat").toUpperCase()} · {d.status}
                  </p>
                  <p className="text-[11px] text-[var(--kura-text-secondary)]">
                    {new Date(d.createdAt).toLocaleString()}
                    {d.paymentRail ? ` · ${d.paymentRail}` : ""}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-[var(--kura-text)]">
                  {d.netAmount || d.amount || "—"}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
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
      ? "KYB verified · ready to deposit"
      : "Verified · ready to deposit";
    className = "bg-[var(--kura-success-bg)] text-[var(--kura-success-fg)]";
  } else if (isKycInReview(customer?.kycStatus)) {
    label = isBusinessCustomer(customer) ? "KYB under review" : "Verification under review";
    className = "bg-[var(--kura-warning-bg)] text-[var(--kura-warning-fg)]";
  } else if (normalizeRejected(customer?.kycStatus)) {
    label = "Verification rejected";
    className = "bg-[var(--kura-error-bg)] text-[var(--kura-error-fg)]";
  } else if (customer) {
    label = isBusinessCustomer(customer)
      ? `KYB: ${customer.kycStatus}`
      : `KYC: ${customer.kycStatus}`;
  }

  return (
    <div className={`mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${className}`}>
      <ShieldCheck className="h-3.5 w-3.5" />
      {label}
    </div>
  );
}

function normalizeRejected(status: string | null | undefined): boolean {
  const key = (status || "").toLowerCase().replace(/-/g, "_");
  return key === "rejected" || key === "failed" || key === "paused";
}

function CryptoDepositPanel({
  address,
  loading,
  usdcBalance,
  copied,
  onCopy,
}: {
  address: string | null;
  loading: boolean;
  usdcBalance: number;
  copied: string | null;
  onCopy: (key: string, value: string) => void;
}) {
  const qrSrc = address
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(address)}`
    : null;

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight text-[var(--kura-text)]">
        Deposit crypto
      </h1>
      <p className="mt-2 text-sm text-[var(--kura-text-secondary)]">
        Send only USDC on Base to your Smart Wallet.
      </p>

      <div className="mt-4 rounded-xl border border-[var(--kura-border)] bg-[var(--kura-surface)] px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
          Current USDC balance
        </p>
        <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--kura-text)]">
          {loading ? "…" : formatUsd(usdcBalance)}
        </p>
      </div>

      <div className="mt-8 flex flex-col items-center gap-5">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[var(--kura-border)]">
          {qrSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrSrc} alt="Deposit address QR" width={180} height={180} className="h-44 w-44" />
          ) : (
            <div className="flex h-44 w-44 items-center justify-center text-xs text-[var(--kura-text-secondary)]">
              {loading ? "Loading wallet…" : "No address"}
            </div>
          )}
        </div>

        <div className="w-full">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
            Your Base address
          </p>
          <div className="flex items-start gap-2 rounded-xl border border-[var(--kura-border)] bg-[var(--kura-surface)] px-3 py-2.5">
            <span className="min-w-0 flex-1 break-all font-mono text-xs text-[var(--kura-text)]">
              {address ?? "No wallet address available"}
            </span>
            {address ? (
              <button
                type="button"
                onClick={() => void onCopy("address", address)}
                className="shrink-0 rounded-md p-1 text-[var(--kura-text-secondary)] hover:bg-[var(--kura-bg-lighter)]"
                aria-label="Copy address"
              >
                {copied === "address" ? (
                  <Check className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            ) : null}
          </div>
        </div>

        <div className="w-full rounded-xl border border-[var(--kura-warning)]/30 bg-[var(--kura-warning)]/10 px-3 py-2.5 text-xs text-[var(--kura-warning)]">
          Only send USDC on the Base network. Other assets or chains may be lost permanently.
        </div>

        <Button
          type="button"
          onClick={() => address && void onCopy("address", address)}
          disabled={!address}
          className="w-full"
          size="lg"
        >
          {copied === "address" ? "Copied!" : "Copy Address"}
        </Button>
      </div>
    </>
  );
}
