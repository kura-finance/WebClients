"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Check,
  Copy,
  Import,
  KeyRound,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Vault,
} from "lucide-react";
import { useWallets } from "@privy-io/react-auth";
import { useAppStore } from "@/store/useAppStore";
import { useFinanceStore } from "@/store/useFinanceStore";
import { useOrgStore } from "@/store/useOrgStore";
import { useHomeWallet } from "@/hooks/useHomeWallet";
import { useTreasuryWallet } from "@/hooks/useTreasuryWallet";
import { useTreasuryPendingTxs } from "@/hooks/useTreasuryPendingTxs";
import { useTreasuryHoldings, type TreasuryHoldingRow } from "@/hooks/useTreasuryHoldings";
import { useWalletActivity } from "@/hooks/useWalletActivity";
import { HOME_STABLECOINS } from "@/lib/baseChain";
import {
  assertEoaIsOwner,
  deployTreasurySafe,
  computeTreasurySafeAddress,
} from "@/lib/treasurySafe";
import { defaultTreasuryName, nextTreasurySaltNonce } from "@/lib/orgTreasury";
import { sendUsdcFromSafe } from "@/lib/smartAccountSend";
import { normalizeAddress } from "@/lib/safeOwners";
import { ApiError } from "@/lib/errorHandler";
import { summarizeSafeTx, fetchSafesByOwner } from "@/lib/safeTxService";
import {
  syncAddTreasury,
  syncRemoveTreasury,
  syncSetActiveTreasury,
  syncUpdateTreasury,
} from "@/lib/treasurySync";
import { treasuryErrorCode } from "@/lib/treasuryApi";
import { isPimlicoConfigured, isPrivyConfigured } from "@/config/env";
import { features } from "@/config/features";
import PrivyEoaSync from "@/components/wallet/PrivyEoaSync";
import TreasurySwitcher from "@/components/wallet/TreasurySwitcher";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import Modal from "@/components/ui/Modal";
import {
  DashboardPage,
  EmptyGate,
  PageAlert,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/dashboard/PageShell";

function formatUsd(value: number, hidden = false): string {
  if (hidden) return "••••••";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function truncate(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function treasuryActionError(err: unknown, fallback: string): string {
  const code = treasuryErrorCode(err);
  if (code === "PERSONAL_SCA") {
    return "That address is your personal Smart Wallet — use a separate Treasury Safe.";
  }
  if (code === "CONFLICT") {
    return "That Treasury id is already taken. Try again without a custom id.";
  }
  if (code === "FORBIDDEN") {
    return "Membership required to manage Treasuries.";
  }
  if (err instanceof ApiError) return err.userMessage || err.message || fallback;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function HoldingPanel({
  title,
  description,
  totalUsd,
  rows,
  loading,
  hidden,
  empty,
  actionHref,
  actionLabel,
}: {
  title: string;
  description: string;
  totalUsd: number;
  rows: TreasuryHoldingRow[];
  loading: boolean;
  hidden: boolean;
  empty: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <Panel padding="md">
      <PanelHeader
        title={title}
        description={description}
        action={
          <Link
            href={actionHref}
            className="text-xs font-semibold text-[var(--kura-primary)] hover:underline"
          >
            {actionLabel}
          </Link>
        }
      />
      <p className="mb-3 text-xl font-semibold tabular-nums text-[var(--kura-text)]">
        {loading ? "…" : formatUsd(totalUsd, hidden)}
      </p>
      {loading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-xl bg-[var(--kura-bg-lighter)]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--kura-text-secondary)]">{empty}</p>
      ) : (
        <ul className="divide-y divide-[var(--kura-border)]">
          {rows.map((row) => {
            const inner = (
              <>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--kura-text)]">{row.label}</p>
                  {row.subtitle ? (
                    <p className="truncate text-[11px] text-[var(--kura-text-secondary)]">
                      {row.subtitle}
                    </p>
                  ) : null}
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-[var(--kura-text)]">
                  {formatUsd(row.amountUsd, hidden)}
                </p>
              </>
            );
            return (
              <li key={row.id}>
                {row.href ? (
                  <Link
                    href={row.href}
                    className="flex items-center justify-between gap-3 py-3 transition-colors hover:opacity-80"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="flex items-center justify-between gap-3 py-3">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export default function TreasuryView() {
  const isBalanceHidden = useAppStore((s) => s.isBalanceHidden);
  const companyName = useOrgStore((s) => s.companyName);
  const treasuries = useOrgStore((s) => s.treasuries);
  const setActiveTreasury = (id: string | null) => {
    void syncSetActiveTreasury(id);
  };

  const personal = useHomeWallet();
  const treasury = useTreasuryWallet();
  const pending = useTreasuryPendingTxs(treasury.scaAddress);
  const bankAccounts = useFinanceStore((s) => s.accounts);
  const { wallets } = useWallets();

  const privyWallet = useMemo(() => {
    return (
      wallets.find((w) => w.walletClientType === "privy") ??
      wallets.find((w) => w.address?.toLowerCase() === personal.eoaAddress?.toLowerCase()) ??
      wallets[0] ??
      null
    );
  }, [wallets, personal.eoaAddress]);

  const { activities, loading: activityLoading, refresh: refreshActivity } = useWalletActivity(
    treasury.scaAddress,
  );
  const holdings = useTreasuryHoldings(treasury.scaAddress);

  const [busy, setBusy] = useState<"create" | "bind" | "fund" | "activate" | "import" | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);
  const [bindOpen, setBindOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [bindAddress, setBindAddress] = useState("");
  const [bindName, setBindName] = useState("");
  const [createName, setCreateName] = useState("");
  const [fundOpen, setFundOpen] = useState(false);
  const [fundAmount, setFundAmount] = useState("");
  const [discoveredSafes, setDiscoveredSafes] = useState<`0x${string}`[]>([]);
  const [selectedSafes, setSelectedSafes] = useState<Set<string>>(new Set());
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [previewAddress, setPreviewAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");

  const stableCash = useMemo(
    () => HOME_STABLECOINS.reduce((sum, t) => sum + (treasury.stableBalances[t.symbol] ?? 0), 0),
    [treasury.stableBalances],
  );

  const personalUsdc = personal.stableBalances.USDC ?? 0;
  const treasuryUsdc = treasury.stableBalances.USDC ?? 0;
  const canActivate = !treasury.deployed && treasuryUsdc >= 0.05;

  const bankCash = useMemo(
    () =>
      bankAccounts.reduce((sum, account) => {
        const bal = Number(account.balance) || 0;
        return sum + (account.type === "credit" ? 0 : bal);
      }, 0),
    [bankAccounts],
  );

  const totalCash = stableCash;
  const outgoingDue = useMemo(
    () =>
      pending.txs.reduce((sum, tx) => {
        const { amountUsdc } = summarizeSafeTx(tx);
        return sum + (amountUsdc ?? 0);
      }, 0),
    [pending.txs],
  );

  const refreshing =
    treasury.loading || treasury.stablesLoading || activityLoading || holdings.loading;

  React.useEffect(() => {
    setRenameDraft(treasury.name ?? "");
  }, [treasury.treasuryId, treasury.name]);

  const handleRefresh = () => {
    void treasury.refresh();
    void refreshActivity();
    void holdings.refresh();
  };

  const getProvider = async () => {
    if (!privyWallet) throw new Error("Privy wallet unavailable. Sign in again.");
    return (await privyWallet.getEthereumProvider()) as {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  };

  const handleCreate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setActionError(null);
    setActionOk(null);
    setBusy("create");
    try {
      const provider = await getProvider();
      const salt = nextTreasurySaltNonce(treasuries);
      const address = await computeTreasurySafeAddress(provider, salt);
      setPreviewAddress(address);
      const name = createName.trim() || defaultTreasuryName(treasuries);
      await syncAddTreasury({
        name,
        address,
        source: "created",
        saltNonce: salt.toString(),
      });
      setCreateOpen(false);
      setCreateName("");
      setActionOk(
        `${name} ready · ${truncate(address)}. Send USDC on Base here, then Activate.`,
      );
      await treasury.refresh();
    } catch (err) {
      setActionError(treasuryActionError(err, "Failed to create Treasury address."));
    } finally {
      setBusy(null);
    }
  };

  const handleActivate = async () => {
    setActionError(null);
    setActionOk(null);
    if (!isPimlicoConfigured()) {
      setActionError("Pimlico is not configured. Set NEXT_PUBLIC_PIMLICO_API_KEY.");
      return;
    }
    if (treasuryUsdc < 0.05) {
      setActionError("Fund at least ~0.05 USDC on Base first (needed for network fees).");
      return;
    }
    if (!treasury.active || treasury.source !== "created") {
      setActionError("Only created Treasuries can be activated from this flow.");
      return;
    }
    setBusy("activate");
    try {
      const provider = await getProvider();
      const salt = treasury.active.saltNonce
        ? BigInt(treasury.active.saltNonce)
        : nextTreasurySaltNonce([]);
      const { address, txHash } = await deployTreasurySafe({
        eip1193Provider: provider,
        saltNonce: salt,
      });
      setActionOk(
        txHash
          ? `${treasury.name ?? "Treasury"} activated · ${truncate(address)}`
          : `${treasury.name ?? "Treasury"} already on-chain · ${truncate(address)}`,
      );
      await treasury.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to activate Treasury Safe.");
    } finally {
      setBusy(null);
    }
  };

  const discoverOwnedSafes = useCallback(async () => {
    if (!personal.eoaAddress) {
      setDiscoveredSafes([]);
      setSelectedSafes(new Set());
      setDiscoverError("Connect Privy to discover Safes you own.");
      return;
    }
    setDiscoverLoading(true);
    setDiscoverError(null);
    try {
      const safes = await fetchSafesByOwner(personal.eoaAddress);
      const existing = new Set(treasuries.map((t) => t.address.toLowerCase()));
      const personalLower = personal.scaAddress?.toLowerCase() ?? null;
      const candidates = safes.filter((addr) => {
        const lower = addr.toLowerCase();
        if (personalLower && lower === personalLower) return false;
        if (existing.has(lower)) return false;
        return true;
      });
      setDiscoveredSafes(candidates);
      setSelectedSafes(new Set(candidates.map((a) => a.toLowerCase())));
      if (candidates.length === 0) {
        setDiscoverError(
          safes.length === 0
            ? "No Safes found for your Privy EOA on Base."
            : "All Safes you own are already imported (Smart Wallet excluded).",
        );
      }
    } catch (err) {
      setDiscoveredSafes([]);
      setSelectedSafes(new Set());
      setDiscoverError(err instanceof Error ? err.message : "Failed to discover Safes.");
    } finally {
      setDiscoverLoading(false);
    }
  }, [personal.eoaAddress, personal.scaAddress, treasuries]);

  const openBindModal = useCallback(() => {
    setBindName(defaultTreasuryName(treasuries));
    setBindAddress("");
    setDiscoverError(null);
    setBindOpen(true);
  }, [treasuries]);

  useEffect(() => {
    if (!bindOpen) return;
    void discoverOwnedSafes();
  }, [bindOpen, discoverOwnedSafes]);

  const handleImportSelected = async () => {
    setActionError(null);
    setActionOk(null);
    const selected = discoveredSafes.filter((a) => selectedSafes.has(a.toLowerCase()));
    if (selected.length === 0) {
      setActionError("Select at least one Safe to import.");
      return;
    }
    setBusy("import");
    try {
      let imported = 0;
      for (const addr of selected) {
        if (personal.scaAddress && addr.toLowerCase() === personal.scaAddress.toLowerCase()) {
          continue;
        }
        const current = useOrgStore.getState().treasuries;
        if (current.some((t) => t.address.toLowerCase() === addr.toLowerCase())) continue;
        const name = defaultTreasuryName(current);
        const id = await syncAddTreasury({
          name,
          address: normalizeAddress(addr),
          source: "bound",
        });
        if (id) imported += 1;
      }
      setBindOpen(false);
      setActionOk(
        imported === 1
          ? `Imported 1 Treasury Safe`
          : `Imported ${imported} Treasury Safes`,
      );
      await treasury.refresh();
    } catch (err) {
      setActionError(treasuryActionError(err, "Failed to import Safes."));
    } finally {
      setBusy(null);
    }
  };

  const toggleSafeSelection = (address: string) => {
    const key = address.toLowerCase();
    setSelectedSafes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const copyTreasuryAddress = async () => {
    if (!treasury.scaAddress) return;
    try {
      await navigator.clipboard.writeText(treasury.scaAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setActionError("Could not copy address.");
    }
  };

  const handleBind = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionOk(null);
    setBusy("bind");
    try {
      await assertEoaIsOwner(bindAddress.trim(), personal.eoaAddress);
      if (personal.scaAddress && bindAddress.trim().toLowerCase() === personal.scaAddress.toLowerCase()) {
        throw new Error(
          "That is your Smart Wallet. Create a separate Treasury Safe, or bind a different one.",
        );
      }
      const addr = normalizeAddress(bindAddress.trim());
      if (treasuries.some((t) => t.address.toLowerCase() === addr.toLowerCase())) {
        throw new Error("That Treasury is already in your list.");
      }
      const name = bindName.trim() || defaultTreasuryName(treasuries);
      await syncAddTreasury({ name, address: addr, source: "bound" });
      setBindOpen(false);
      setBindAddress("");
      setBindName("");
      setActionOk(`${name} bound · ${truncate(addr)}`);
      await treasury.refresh();
    } catch (err) {
      setActionError(treasuryActionError(err, "Failed to bind Safe."));
    } finally {
      setBusy(null);
    }
  };

  const bindModal = (
    <Modal
      isOpen={bindOpen}
      onClose={() => setBindOpen(false)}
      title="Import / bind Safe"
      description="Safes on Base where your Privy EOA is already an owner. Your Smart Wallet is excluded."
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
            Owned on Base
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="rounded-full"
            onClick={() => void discoverOwnedSafes()}
            disabled={discoverLoading || busy !== null}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${discoverLoading ? "animate-spin" : ""}`} />
            Rescan
          </Button>
        </div>

        {discoverLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-[var(--kura-text-secondary)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Scanning Safe Transaction Service…
          </div>
        ) : discoveredSafes.length > 0 ? (
          <ul className="max-h-52 space-y-2 overflow-y-auto">
            {discoveredSafes.map((addr) => {
              const checked = selectedSafes.has(addr.toLowerCase());
              return (
                <li key={addr}>
                  <button
                    type="button"
                    onClick={() => toggleSafeSelection(addr)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      checked
                        ? "border-[var(--kura-primary)]/40 bg-[var(--kura-primary)]/5"
                        : "border-[var(--kura-border)] hover:bg-[var(--kura-bg-lighter)]"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked
                          ? "border-[var(--kura-primary)] bg-[var(--kura-primary)] text-white"
                          : "border-[var(--kura-border)]"
                      }`}
                    >
                      {checked ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="min-w-0 font-mono text-xs text-[var(--kura-text)]">
                      {truncate(addr)}
                      <span className="mt-0.5 block truncate text-[10px] text-[var(--kura-text-secondary)]">
                        {addr}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-2 text-sm text-[var(--kura-text-secondary)]">
            {discoverError || "No importable Safes found."}
          </p>
        )}

        {discoveredSafes.length > 0 ? (
          <Button
            type="button"
            className="w-full rounded-full"
            disabled={busy !== null || selectedSafes.size === 0}
            onClick={() => void handleImportSelected()}
          >
            {busy === "import" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Import className="h-3.5 w-3.5" />
            )}
            Import selected ({selectedSafes.size})
          </Button>
        ) : null}

        <div className="border-t border-[var(--kura-border)] pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
            Or paste address
          </p>
          <form onSubmit={(e) => void handleBind(e)} className="space-y-3">
            <Input
              value={bindName}
              onChange={(e) => setBindName(e.target.value)}
              placeholder="Name (e.g. Operating)"
            />
            <Input
              value={bindAddress}
              onChange={(e) => setBindAddress(e.target.value)}
              placeholder="0x… Safe on Base"
              className="font-mono text-xs"
              required
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setBindOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy === "bind"}>
                {busy === "bind" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Bind"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </Modal>
  );

  const handleFund = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionOk(null);
    const amount = Number(fundAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setActionError("Enter a valid USDC amount.");
      return;
    }
    if (!personal.scaAddress || !treasury.scaAddress) {
      setActionError("Personal and Treasury Safes are both required.");
      return;
    }
    if (amount > personalUsdc) {
      setActionError(`Insufficient Smart Wallet USDC (${personalUsdc.toFixed(2)} available).`);
      return;
    }
    if (!isPimlicoConfigured()) {
      setActionError("Pimlico is not configured.");
      return;
    }
    setBusy("fund");
    try {
      const provider = await getProvider();
      const hash = await sendUsdcFromSafe({
        eip1193Provider: provider,
        expectedScaAddress: personal.scaAddress as `0x${string}`,
        toAddress: normalizeAddress(treasury.scaAddress),
        amountUsdc: amount,
      });
      setFundOpen(false);
      setFundAmount("");
      setActionOk(`Funded Treasury with ${formatUsd(amount)} · ${truncate(hash)}`);
      void personal.refresh();
      void treasury.refresh();
      void refreshActivity();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Funding failed.");
    } finally {
      setBusy(null);
    }
  };

  // ── No treasuries yet ──
  if (treasuries.length === 0) {
    return (
      <>
        {isPrivyConfigured ? (
          <PrivyEoaSync
            onEoa={personal.applyEoaAddress}
            persistedEoa={personal.record.walletAddress}
          />
        ) : null}

        <EmptyGate
          eyebrow="Treasury"
          title="Treasury Safe"
          description={`Treasury is a multi-sig Safe for USDC — separate from your Smart Wallet (Home / Transfer).${
            features.fiatRamp ? " For bank ACH / Wire / FPS / SEPA, use an ops account with KYC." : ""
          }`}
          action={
            <>
              {actionError ? <PageAlert variant="warning">{actionError}</PageAlert> : null}
              {actionOk ? <PageAlert variant="success">{actionOk}</PageAlert> : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <Panel padding="lg">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kura-primary)]/10 text-[var(--kura-primary-light)]">
                    <Plus className="h-5 w-5" />
                  </span>
                  <h2 className="mt-4 text-base font-semibold text-[var(--kura-text)]">
                    Create Treasury Safe
                  </h2>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--kura-text-secondary)]">
                    Get a counterfactual Treasury address from your Privy EOA (salt ≠ Smart Wallet). No
                    on-chain deploy yet — fund with USDC on Base first.
                    {personal.scaAddress ? (
                      <> Smart Wallet: {truncate(personal.scaAddress)}.</>
                    ) : null}
                  </p>
                  {previewAddress ? (
                    <p className="mt-3 font-mono text-[11px] text-[var(--kura-text-secondary)]">
                      Preview {truncate(previewAddress)}
                    </p>
                  ) : null}
                  <Button
                    className="mt-5 w-full rounded-full"
                    disabled={busy !== null || !privyWallet}
                    onClick={() => {
                      setCreateName(defaultTreasuryName([]));
                      setCreateOpen(true);
                    }}
                  >
                    <Vault className="h-3.5 w-3.5" />
                    Get Treasury address
                  </Button>
                </Panel>

                <Panel padding="lg">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kura-primary)]/10 text-[var(--kura-primary-light)]">
                    <Import className="h-5 w-5" />
                  </span>
                  <h2 className="mt-4 text-base font-semibold text-[var(--kura-text)]">
                    Import Safes you own
                  </h2>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--kura-text-secondary)]">
                    Scan Base for Safes where your Privy EOA is already an owner, or paste an address.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-5 w-full rounded-full"
                    disabled={busy !== null}
                    onClick={openBindModal}
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    Import / bind
                  </Button>
                </Panel>
              </div>

              {features.fiatRamp ? (
                <p className="mt-6 text-center text-xs text-[var(--kura-text-secondary)]">
                  Personal / ops fiat stays on{" "}
                  <Link href="/dashboard" className="font-semibold text-[var(--kura-primary)] hover:underline">
                    Home
                  </Link>{" "}
                  / Transfer with KYC — never mixed into this Treasury Safe.
                </p>
              ) : null}

              <Modal
                isOpen={createOpen}
                onClose={() => setCreateOpen(false)}
                title="Create Treasury"
                description="Computes a new Safe address (unique salt). Fund before Activate."
              >
                <form onSubmit={(e) => void handleCreate(e)} className="space-y-3">
                  <Input
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="Name (e.g. Operating)"
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={busy === "create" || !privyWallet}>
                      {busy === "create" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "Create address"
                      )}
                    </Button>
                  </div>
                </form>
              </Modal>

              {bindModal}
            </>
          }
        />
      </>
    );
  }

  // ── Bound treasury dashboard ──
  return (
    <DashboardPage>
      {isPrivyConfigured ? (
        <PrivyEoaSync
          onEoa={personal.applyEoaAddress}
          persistedEoa={personal.record.walletAddress}
        />
      ) : null}

      <PageHeader
        eyebrow="Treasury"
        title={
          <>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--kura-text)]">
              {treasury.name ?? "Cash position"}
            </h1>
            <TreasurySwitcher
              treasuries={treasuries}
              activeId={treasury.treasuryId}
              onSelect={setActiveTreasury}
            />
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => {
                setCreateName(defaultTreasuryName(treasuries));
                setCreateOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={openBindModal}
            >
              <Import className="h-3.5 w-3.5" />
              Import
            </Button>
          </>
        }
        description={
          <>
            Fund, propose payments, and manage Team for the active Treasury.
            {treasury.scaAddress ? (
              <>
                {" "}
                <span className="font-mono text-xs">{truncate(treasury.scaAddress)}</span>
                {treasury.source ? (
                  <Badge variant="outline" className="ml-2">
                    {treasury.source}
                  </Badge>
                ) : null}
                {!treasury.deployed ? (
                  <Badge variant="outline" className="ml-2">
                    undeployed
                  </Badge>
                ) : null}
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <Button size="sm" className="rounded-full" onClick={() => setFundOpen(true)}>
              <ArrowDownLeft className="h-3.5 w-3.5" />
              Fund
            </Button>
            <Button asChild size="sm" variant="outline" className="rounded-full">
              <Link href="/dashboard/approvals?tab=propose">
                <Banknote className="h-3.5 w-3.5" />
                Propose payment
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="rounded-full">
              <Link href="/dashboard/team">
                <KeyRound className="h-3.5 w-3.5" />
                Team
              </Link>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full text-[var(--kura-text-secondary)]"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          </>
        }
      />

      {actionError ? <PageAlert variant="warning">{actionError}</PageAlert> : null}
      {actionOk ? <PageAlert variant="success">{actionOk}</PageAlert> : null}

      {!treasury.deployed ? (
        <section className="mb-6 overflow-hidden rounded-2xl border border-[var(--kura-warning-border)] bg-[var(--kura-warning-bg)] p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--kura-text)]">
                Fund this address before activating
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--kura-text-secondary)]">
                Your Privy EOA still owns this Safe. The contract is not on-chain yet — send USDC on
                Base to the address below (counterfactual balances work). Keep ~0.05 USDC for gas,
                then Activate.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="break-all rounded-lg bg-[var(--kura-bg-lighter)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--kura-text)]">
                  {treasury.scaAddress}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => void copyTreasuryAddress()}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-[var(--kura-text-secondary)]">
                Balance{" "}
                <span className="font-semibold tabular-nums text-[var(--kura-text)]">
                  {formatUsd(treasuryUsdc, isBalanceHidden)}
                </span>{" "}
                USDC
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:items-end">
              <Button
                size="sm"
                className="rounded-full"
                onClick={() => setFundOpen(true)}
                disabled={busy !== null}
              >
                <ArrowDownLeft className="h-3.5 w-3.5" />
                Fund from Smart Wallet
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                disabled={busy !== null || !canActivate || !privyWallet}
                onClick={() => void handleActivate()}
              >
                {busy === "activate" ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Activating…
                  </>
                ) : (
                  <>
                    <Vault className="h-3.5 w-3.5" />
                    Activate Safe
                  </>
                )}
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mb-6 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <Panel padding="lg">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
            Available cash · {treasury.name ?? companyName}
          </p>
          {treasury.loading || treasury.stablesLoading ? (
            <div className="mt-3 h-10 w-52 animate-pulse rounded-lg bg-[var(--kura-bg-lighter)]" />
          ) : (
            <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums text-[var(--kura-text)]">
              {formatUsd(totalCash, isBalanceHidden)}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-[var(--kura-text-secondary)]">
            <span>
              Treasury stables{" "}
              <span className="font-semibold tabular-nums text-[var(--kura-text)]">
                {formatUsd(stableCash, isBalanceHidden)}
              </span>
            </span>
            {features.trackFi ? (
              <span>
                Connected banks (TrackFi){" "}
                <span className="font-semibold tabular-nums text-[var(--kura-text)]">
                  {formatUsd(bankCash, isBalanceHidden)}
                </span>
              </span>
            ) : null}
          </div>
        </Panel>

        <Panel padding="sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
            Pending signatures
          </p>
          <p className="mt-2 text-xl font-semibold tabular-nums text-[var(--kura-text)]">
            {pending.loading ? "…" : formatUsd(outgoingDue, isBalanceHidden)}
          </p>
          <Link
            href="/dashboard/approvals"
            className="mt-2 inline-block text-xs font-semibold text-[var(--kura-primary)] hover:underline"
          >
            {pending.txs.length > 0
              ? `Review queue (${pending.txs.length})`
              : "Open Approvals"}
          </Link>
        </Panel>
      </section>

      <section className="mb-6 overflow-hidden rounded-2xl border border-[var(--kura-border)] bg-gradient-to-r from-[var(--kura-primary)]/10 via-[var(--kura-surface)] to-[var(--kura-surface)] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--kura-primary)]/15 text-[var(--kura-primary-light)]">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--kura-text)]">Put idle cash to work</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--kura-text-secondary)]">
                Sweep excess Treasury USDC into Earn when you do not need it for payments.
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline" className="rounded-full shrink-0">
            <Link href="/dashboard/earn">Explore Earn</Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel padding="md">
          <PanelHeader
            title="Treasury balances"
            description="Stablecoins on Treasury Safe"
            action={
              <button
                type="button"
                onClick={() => setFundOpen(true)}
                className="text-xs font-semibold text-[var(--kura-primary)] hover:underline"
              >
                Fund
              </button>
            }
          />
          <ul className="divide-y divide-[var(--kura-border)]">
            {HOME_STABLECOINS.filter((t) => (treasury.stableBalances[t.symbol] ?? 0) > 0)
              .concat(
                HOME_STABLECOINS.every((t) => (treasury.stableBalances[t.symbol] ?? 0) === 0)
                  ? [HOME_STABLECOINS[0]]
                  : [],
              )
              .map((token) => {
                const amount = treasury.stableBalances[token.symbol] ?? 0;
                return (
                  <li key={token.symbol} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--kura-text)]">{token.symbol}</p>
                      <p className="text-[11px] text-[var(--kura-text-secondary)]">{token.name}</p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums text-[var(--kura-text)]">
                      {isBalanceHidden
                        ? "••••"
                        : amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </p>
                  </li>
                );
              })}
          </ul>
          {treasury.treasuryId ? (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!treasury.treasuryId) return;
                void syncUpdateTreasury(treasury.treasuryId, { name: renameDraft });
              }}
            >
              <Input
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                placeholder="Rename treasury"
                className="h-8 text-xs"
              />
              <Button type="submit" size="sm" variant="outline" className="shrink-0 rounded-full">
                Save
              </Button>
            </form>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (!treasury.treasuryId) return;
              if (confirm(`Remove “${treasury.name ?? "Treasury"}” from this workspace?`)) {
                void syncRemoveTreasury(treasury.treasuryId);
              }
            }}
            className="mt-4 text-[11px] text-[var(--kura-text-secondary)] hover:text-[var(--kura-error)]"
          >
            Remove this Treasury
          </button>
        </Panel>

        <Panel padding="md">
          <PanelHeader
            title="Recent movement"
            description="Treasury Safe activity"
            action={
              <Link
                href="/dashboard/report"
                className="text-xs font-semibold text-[var(--kura-primary)] hover:underline"
              >
                Full report
              </Link>
            }
          />
          {activityLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-[var(--kura-bg-lighter)]" />
              ))}
            </div>
          ) : activities.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--kura-text-secondary)]">
              No recent treasury movement yet. Fund from Smart Wallet to get started.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--kura-border)]">
              {activities.slice(0, 6).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--kura-text)]">{a.title}</p>
                    <p className="truncate text-[11px] text-[var(--kura-text-secondary)]">
                      {a.subtitle}
                      {a.statusLabel ? ` · ${a.statusLabel}` : ""}
                    </p>
                  </div>
                  <p
                    className={`shrink-0 text-sm font-semibold tabular-nums ${
                      a.direction === "in" ? "text-emerald-500" : "text-[var(--kura-text)]"
                    }`}
                  >
                    {isBalanceHidden
                      ? "••••"
                      : `${a.direction === "in" ? "+" : a.direction === "out" ? "−" : ""}${a.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${a.tokenSymbol}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <HoldingPanel
          title="Loan Holding"
          description="Morpho borrow on this Treasury"
          totalUsd={holdings.loanUsd}
          rows={holdings.loanRows}
          loading={holdings.loading}
          hidden={isBalanceHidden}
          empty="No open loans on this Treasury."
          actionHref="/dashboard/borrow"
          actionLabel="Borrow"
        />
        <HoldingPanel
          title="Investment Holding"
          description="Morpho Earn vaults on this Treasury"
          totalUsd={holdings.investmentUsd}
          rows={holdings.investmentRows}
          loading={holdings.loading}
          hidden={isBalanceHidden}
          empty="No Earn deposits on this Treasury."
          actionHref="/dashboard/earn"
          actionLabel="Earn"
        />
        <HoldingPanel
          title="Crypto Holding"
          description="Non-stable tokens on this Treasury"
          totalUsd={holdings.cryptoUsd}
          rows={holdings.cryptoRows}
          loading={holdings.loading}
          hidden={isBalanceHidden}
          empty="No crypto holdings on this Treasury."
          actionHref="/dashboard/markets"
          actionLabel="Markets"
        />
      </section>

      <Modal
        isOpen={fundOpen}
        onClose={() => setFundOpen(false)}
        title="Fund from Smart Wallet"
        description={`Available Smart Wallet USDC: ${formatUsd(personalUsdc, isBalanceHidden)}`}
      >
        <form onSubmit={(e) => void handleFund(e)} className="space-y-3">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={fundAmount}
            onChange={(e) => setFundAmount(e.target.value)}
            placeholder="Amount USDC"
            required
          />
          <p className="text-[11px] text-[var(--kura-text-secondary)]">
            Sends USDC from your Smart Wallet
            {personal.scaAddress ? ` (${truncate(personal.scaAddress)})` : ""} →{" "}
            {treasury.name ?? "Treasury"}
            {treasury.scaAddress ? ` (${truncate(treasury.scaAddress)})` : ""}.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFundOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy === "fund"}>
              {busy === "fund" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowUpRight className="h-3.5 w-3.5" />
              )}
              Send
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add Treasury"
        description="Computes a new Safe address with a unique salt. Fund before Activate."
      >
        <form onSubmit={(e) => void handleCreate(e)} className="space-y-3">
          <Input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Name (e.g. Operating)"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy === "create" || !privyWallet}>
              {busy === "create" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create address"}
            </Button>
          </div>
        </form>
      </Modal>

      {bindModal}
    </DashboardPage>
  );
}
