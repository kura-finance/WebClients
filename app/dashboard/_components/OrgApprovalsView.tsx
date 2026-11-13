"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  FileText,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Shield,
  Users,
  Wallet,
} from "lucide-react";
import {
  createWalletClient,
  custom,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { useAppStore } from "@/store/useAppStore";
import { useOrgStore } from "@/store/useOrgStore";
import { useHomeWallet } from "@/hooks/useHomeWallet";
import { useTreasuryWallet } from "@/hooks/useTreasuryWallet";
import { useTreasuryPendingTxs } from "@/hooks/useTreasuryPendingTxs";
import { isSafeOwner, isEthAddress, normalizeAddress } from "@/lib/safeOwners";
import {
  buildUsdcTransferSafeTx,
  confirmMultisigTx,
  fetchPendingMultisigTxs,
  fetchSafeInfo,
  fieldsFromMultisigTx,
  hasOwnerConfirmed,
  isReadyToExecute,
  packConfirmations,
  proposeMultisigTx,
  SAFE_EXEC_ABI,
  signSafeTx,
  summarizeSafeTx,
  confirmationCount,
  type SafeMultisigTx,
} from "@/lib/safeTxService";
import { isSignerConfigured, useSignerWallet } from "@/lib/signer";
import { signerCopy } from "@/lib/signer/copy";
import PrivyEoaSync from "@/components/wallet/PrivyEoaSync";
import TreasurySwitcher from "@/components/wallet/TreasurySwitcher";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import Modal from "@/components/ui/Modal";
import {
  Chip,
  DashboardPage,
  EmptyGate,
  PageAlert,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/dashboard/PageShell";

type Tab = "queue" | "recipients" | "propose";

function tabFromSearch(value: string | null): Tab {
  if (value === "recipients" || value === "propose" || value === "new") return value === "new" ? "propose" : value;
  return "queue";
}

function formatUsd(value: number, hidden = false): string {
  if (hidden) return "••••";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function truncate(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function errMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return "Something went wrong.";
}

export default function OrgApprovalsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isBalanceHidden = useAppStore((s) => s.isBalanceHidden);
  const recipients = useOrgStore((s) => s.recipients);
  const addRecipient = useOrgStore((s) => s.addRecipient);
  const removeRecipient = useOrgStore((s) => s.removeRecipient);

  const personal = useHomeWallet();
  const treasury = useTreasuryWallet();
  const pending = useTreasuryPendingTxs(treasury.scaAddress);
  const signerWallet = useSignerWallet(personal.eoaAddress);

  const owners = treasury.safeSigners?.owners ?? [];
  const safeThreshold = treasury.safeSigners?.threshold ?? 1;
  const isSigner = isSafeOwner(owners, personal.eoaAddress);
  const usdcBalance = treasury.stableBalances.USDC ?? 0;

  const [tab, setTabState] = useState<Tab>(() => tabFromSearch(searchParams.get("tab")));
  const [busyHash, setBusyHash] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);
  const [recipientOpen, setRecipientOpen] = useState(false);

  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);

  const [rcpName, setRcpName] = useState("");
  const [rcpEmail, setRcpEmail] = useState("");
  const [rcpWallet, setRcpWallet] = useState("");

  const setTab = (next: Tab) => {
    setTabState(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "queue") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `/dashboard/approvals?${qs}` : "/dashboard/approvals", { scroll: false });
  };

  useEffect(() => {
    setTabState(tabFromSearch(searchParams.get("tab")));
  }, [searchParams]);

  const usdcRecipients = useMemo(
    () => recipients.filter((r) => r.method === "usdc" || !!r.walletAddress),
    [recipients],
  );

  const needsMySignature = useMemo(() => {
    if (!personal.eoaAddress) return pending.txs;
    return pending.txs.filter((tx) => !hasOwnerConfirmed(tx, personal.eoaAddress));
  }, [pending.txs, personal.eoaAddress]);

  const proposeAmount = Number(amount);
  const proposeDestValid = isEthAddress(toAddress.trim());
  const proposeAmountValid =
    Number.isFinite(proposeAmount) && proposeAmount > 0 && proposeAmount <= usdcBalance;
  const selectedRecipient = usdcRecipients.find((r) => r.id === recipientId) ?? null;
  const canPropose =
    isSigner && proposeDestValid && proposeAmountValid && !formBusy && !!treasury.scaAddress;

  const getWalletClient = async () => {
    if (!signerWallet) throw new Error(signerCopy.walletUnavailable);
    if (!personal.eoaAddress || !isEthAddress(personal.eoaAddress)) {
      throw new Error(signerCopy.connectEoaFirst);
    }
    const provider = (await signerWallet.getEthereumProvider()) as {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
    const walletClient = createWalletClient({
      account: personal.eoaAddress as `0x${string}`,
      chain: base,
      transport: custom(provider),
    });
    return { walletClient, account: personal.eoaAddress as `0x${string}`, provider };
  };

  const handlePropose = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setActionError(null);
    setActionOk(null);

    const numeric = Number(amount);
    const dest = toAddress.trim();
    if (!treasury.scaAddress || !isEthAddress(treasury.scaAddress)) {
      setFormError("Treasury Safe not linked.");
      return;
    }
    if (!isSigner) {
      setFormError("Only Treasury Safe owners can propose payments.");
      return;
    }
    if (!dest || !isEthAddress(dest)) {
      setFormError("Enter a valid destination address (0x…).");
      return;
    }
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setFormError("Enter a valid USDC amount.");
      return;
    }
    if (numeric > usdcBalance) {
      setFormError(`Insufficient Treasury USDC. Available ${usdcBalance.toFixed(2)}.`);
      return;
    }

    setFormBusy(true);
    try {
      const { walletClient, account } = await getWalletClient();
      const info = await fetchSafeInfo(treasury.scaAddress);
      const tx = buildUsdcTransferSafeTx({
        to: normalizeAddress(dest),
        amountUsdc: numeric,
        nonce: info.nonce,
      });
      const { signature, safeTxHash } = await signSafeTx({
        walletClient,
        account,
        safeAddress: treasury.scaAddress as `0x${string}`,
        chainId: base.id,
        tx,
      });
      await proposeMultisigTx({
        safeAddress: treasury.scaAddress,
        sender: account,
        tx,
        safeTxHash,
        signature,
      });
      setActionOk(
        memo.trim()
          ? `Proposed USDC payment · ${memo.trim()} · ${truncate(safeTxHash)}`
          : `Proposed USDC payment · ${truncate(safeTxHash)}`,
      );
      setToAddress("");
      setAmount("");
      setMemo("");
      setRecipientId("");
      setTab("queue");
      await pending.refresh();
    } catch (err) {
      setFormError(errMessage(err));
    } finally {
      setFormBusy(false);
    }
  };

  const handleSign = async (tx: SafeMultisigTx) => {
    setActionError(null);
    setActionOk(null);
    if (!treasury.scaAddress) {
      setActionError("Treasury Safe not linked.");
      return;
    }
    if (!isSigner) {
      setActionError("Only Treasury Safe owners can sign.");
      return;
    }
    if (hasOwnerConfirmed(tx, personal.eoaAddress)) {
      setActionError("You already signed this transaction.");
      return;
    }

    setBusyHash(tx.safeTxHash);
    try {
      const { walletClient, account } = await getWalletClient();
      const fields = fieldsFromMultisigTx(tx);
      const { signature } = await signSafeTx({
        walletClient,
        account,
        safeAddress: treasury.scaAddress as `0x${string}`,
        chainId: base.id,
        tx: fields,
      });
      await confirmMultisigTx({ safeTxHash: tx.safeTxHash, signature });
      setActionOk(`Signature submitted · ${truncate(tx.safeTxHash)}`);
      await pending.refresh();
    } catch (err) {
      setActionError(errMessage(err));
    } finally {
      setBusyHash(null);
    }
  };

  const handleExecute = async (tx: SafeMultisigTx) => {
    setActionError(null);
    setActionOk(null);
    if (!treasury.scaAddress) {
      setActionError("Treasury Safe not linked.");
      return;
    }
    if (!isReadyToExecute(tx)) {
      setActionError(
        `Need ${tx.confirmationsRequired} signatures (have ${confirmationCount(tx)}).`,
      );
      return;
    }

    setBusyHash(tx.safeTxHash);
    try {
      const { walletClient, account } = await getWalletClient();
      const list = await fetchPendingMultisigTxs(treasury.scaAddress);
      const latest = list.find((t) => t.safeTxHash === tx.safeTxHash) ?? tx;

      if (!isReadyToExecute(latest)) {
        setActionError("Not enough confirmations yet — refresh and try again.");
        await pending.refresh();
        return;
      }

      const signatures = packConfirmations(latest);
      const hash = await walletClient.writeContract({
        account,
        address: treasury.scaAddress as `0x${string}`,
        abi: SAFE_EXEC_ABI,
        functionName: "execTransaction",
        args: [
          latest.to as `0x${string}`,
          BigInt(latest.value || "0"),
          (latest.data || "0x") as Hex,
          latest.operation,
          BigInt(latest.safeTxGas || "0"),
          BigInt(latest.baseGas || "0"),
          BigInt(latest.gasPrice || "0"),
          (latest.gasToken ||
            "0x0000000000000000000000000000000000000000") as `0x${string}`,
          (latest.refundReceiver ||
            "0x0000000000000000000000000000000000000000") as `0x${string}`,
          signatures,
        ],
        chain: base,
      });
      setActionOk(`Executed on-chain · ${truncate(String(hash))}`);
      void treasury.refresh();
      await pending.refresh();
    } catch (err) {
      setActionError(errMessage(err));
    } finally {
      setBusyHash(null);
    }
  };

  const handleAddRecipient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rcpName.trim()) return;
    const wallet = rcpWallet.trim();
    if (!wallet || !isEthAddress(wallet)) return;
    addRecipient({
      name: rcpName.trim(),
      email: rcpEmail.trim() || undefined,
      method: "usdc",
      walletAddress: wallet,
    });
    setRcpName("");
    setRcpEmail("");
    setRcpWallet("");
    setRecipientOpen(false);
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "queue", label: "Needs signing" },
    { id: "recipients", label: "Recipients" },
    { id: "propose", label: "Propose" },
  ];

  if (!treasury.bound) {
    return (
      <>
        {isSignerConfigured ? (
          <PrivyEoaSync onEoa={personal.applyEoaAddress} persistedEoa={personal.record.walletAddress} />
        ) : null}
        <EmptyGate
          eyebrow="Approvals"
          title="Treasury Safe required"
          description="Pending signatures are loaded from your Treasury Safe on Base. Create or bind one under Treasury first."
          action={
            <Button asChild size="sm" className="rounded-full">
              <Link href="/dashboard/treasury">Go to Treasury</Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <DashboardPage>
      {isSignerConfigured ? (
        <PrivyEoaSync onEoa={personal.applyEoaAddress} persistedEoa={personal.record.walletAddress} />
      ) : null}

      <PageHeader
        eyebrow="Approvals"
        title={treasury.name ? `${treasury.name} queue` : "Treasury queue"}
        description="Pending Safe transactions from the Base Transaction Service — sign as an owner, then execute when the threshold is met."
        actions={
          <>
            <TreasurySwitcher
              treasuries={treasury.treasuries}
              activeId={treasury.treasuryId}
              onSelect={treasury.setActiveTreasury}
            />
            <Button asChild size="sm" className="rounded-full">
              <Link href="/dashboard/approvals?tab=propose">
                <Plus className="h-3.5 w-3.5" />
                Propose USDC
              </Link>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full"
              onClick={() => void pending.refresh()}
              disabled={pending.loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${pending.loading ? "animate-spin" : ""}`} />
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <Panel padding="sm" className="text-xs text-[var(--kura-text-secondary)]">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--kura-primary)]/10 text-[var(--kura-primary-light)]">
              <Shield className="h-4 w-4" />
            </span>
            <span>
              On-chain threshold{" "}
              <span className="font-semibold text-[var(--kura-text)]">
                {safeThreshold}-of-{owners.length || "?"}
              </span>
            </span>
            <span className="hidden sm:inline text-[var(--kura-border)]">·</span>
            <span>
              Awaiting your signature{" "}
              <span className="font-semibold text-[var(--kura-text)]">
                {needsMySignature.length}
              </span>
            </span>
            <Link
              href="/dashboard/team"
              className="ml-auto font-semibold text-[var(--kura-primary)] hover:underline"
            >
              Manage signers
            </Link>
          </div>
          <p className="mt-2 pl-11 text-[11px] leading-relaxed">
            Flow: propose → owners sign (Safe TX Service) → execute on Base
          </p>
        </Panel>
        <Panel padding="sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
            Treasury USDC
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--kura-text)]">
            {treasury.stablesLoading ? "…" : formatUsd(usdcBalance, isBalanceHidden)}
          </p>
          {treasury.scaAddress ? (
            <p className="mt-0.5 font-mono text-[11px] text-[var(--kura-text-secondary)]">
              {truncate(treasury.scaAddress)}
            </p>
          ) : null}
        </Panel>
      </div>

      {actionError ? <PageAlert variant="warning">{actionError}</PageAlert> : null}
      {actionOk ? <PageAlert variant="success">{actionOk}</PageAlert> : null}
      {pending.error ? <PageAlert variant="warning">{pending.error}</PageAlert> : null}

      <div className="mb-5 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Chip key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "queue" && pending.txs.length > 0 ? (
              <span className="ml-1 opacity-70">{pending.txs.length}</span>
            ) : null}
          </Chip>
        ))}
      </div>

      {tab === "queue" ? (
        <Panel padding="none">
          {pending.loading && pending.txs.length === 0 ? (
            <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-[var(--kura-text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading pending Safe transactions…
            </div>
          ) : pending.txs.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <FileText className="mx-auto mb-3 h-8 w-8 text-[var(--kura-text-secondary)]" />
              <p className="text-sm font-medium text-[var(--kura-text)]">No pending signatures</p>
              <p className="mt-1 text-xs text-[var(--kura-text-secondary)]">
                Propose a USDC payment to queue it on the Safe Transaction Service.
              </p>
              <Button asChild size="sm" className="mt-4 rounded-full">
                <Link href="/dashboard/approvals?tab=propose">Propose USDC</Link>
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--kura-border)]">
              {pending.txs.map((tx) => {
                const summary = summarizeSafeTx(tx);
                const confirmed = confirmationCount(tx);
                const already = hasOwnerConfirmed(tx, personal.eoaAddress);
                const ready = isReadyToExecute(tx);
                const busy = busyHash === tx.safeTxHash;
                return (
                  <li
                    key={tx.safeTxHash}
                    className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-[var(--kura-text)]">
                          {summary.title}
                        </p>
                        <Badge variant={ready ? "success" : "default"}>
                          <KeyRound className="mr-1 h-3 w-3" />
                          {confirmed}/{tx.confirmationsRequired} signed
                        </Badge>
                        {!already && isSigner ? (
                          <Badge variant="outline">Needs your signature</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-[var(--kura-text-secondary)]">
                        {summary.subtitle}
                        {` · nonce ${tx.nonce}`}
                        {` · ${truncate(tx.safeTxHash)}`}
                      </p>
                      {summary.amountUsdc != null ? (
                        <p className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--kura-text)]">
                          {formatUsd(summary.amountUsdc, isBalanceHidden)}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                      {!already && isSigner ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full"
                          disabled={busy}
                          onClick={() => void handleSign(tx)}
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Sign
                        </Button>
                      ) : null}
                      {ready ? (
                        <Button
                          size="sm"
                          className="rounded-full"
                          disabled={busy || !isSigner}
                          onClick={() => void handleExecute(tx)}
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Execute
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      ) : null}

      {tab === "recipients" ? (
        <Panel padding="none">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--kura-border)] p-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--kura-text)]">USDC recipients</h2>
              <p className="text-xs text-[var(--kura-text-secondary)]">
                Local address book for propose shortcuts
              </p>
            </div>
            <Button size="sm" className="rounded-full" onClick={() => setRecipientOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>
          {usdcRecipients.length === 0 ? (
            <div className="px-6 py-14 text-center text-sm text-[var(--kura-text-secondary)]">
              <Users className="mx-auto mb-3 h-8 w-8 opacity-60" />
              No recipients yet.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--kura-border)]">
              {usdcRecipients.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 px-4 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--kura-text)]">{r.name}</p>
                    <p className="mt-0.5 text-xs text-[var(--kura-text-secondary)]">
                      {r.email ? `${r.email} · ` : ""}
                      {r.walletAddress ? truncate(r.walletAddress) : "No wallet"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-full text-[var(--kura-text-secondary)]"
                    onClick={() => removeRecipient(r.id)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      {tab === "propose" ? (
        <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <Panel padding="lg">
            <PanelHeader
              title="Propose USDC payment"
              description="Queue a Treasury withdrawal for owner signatures on Base."
            />

            {!isSigner ? (
              <div className="mb-5 rounded-xl border border-[var(--kura-warning-border)] bg-[var(--kura-warning-bg)] px-4 py-3 text-sm text-[var(--kura-warning-fg)]">
                Your {signerCopy.eoa} is not an owner of this Treasury Safe. Ask a signer to propose, or
                update owners under{" "}
                <Link href="/dashboard/team" className="font-semibold underline">
                  Team
                </Link>
                .
              </div>
            ) : null}

            <form onSubmit={(e) => void handlePropose(e)} className="space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
                    Pay to
                  </label>
                  <button
                    type="button"
                    onClick={() => setTab("recipients")}
                    className="text-[11px] font-semibold text-[var(--kura-primary)] hover:underline"
                  >
                    Manage recipients
                  </button>
                </div>
                {usdcRecipients.length > 0 ? (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {usdcRecipients.map((r) => {
                      const active = recipientId === r.id;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            if (active) {
                              setRecipientId("");
                              return;
                            }
                            setRecipientId(r.id);
                            if (r.walletAddress) setToAddress(r.walletAddress);
                          }}
                          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                            active
                              ? "bg-[var(--kura-text)] text-[var(--kura-bg)]"
                              : "border border-[var(--kura-border)] bg-[var(--kura-surface)] text-[var(--kura-text-secondary)] hover:text-[var(--kura-text)]"
                          }`}
                        >
                          {r.name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mb-3 text-xs text-[var(--kura-text-secondary)]">
                    No saved recipients — paste an address below, or{" "}
                    <button
                      type="button"
                      onClick={() => setRecipientOpen(true)}
                      className="font-semibold text-[var(--kura-primary)] hover:underline"
                    >
                      add one
                    </button>
                    .
                  </p>
                )}
                <Input
                  value={toAddress}
                  onChange={(e) => {
                    setToAddress(e.target.value);
                    if (recipientId) {
                      const r = usdcRecipients.find((x) => x.id === recipientId);
                      if (!r?.walletAddress || normalizeAddress(e.target.value) !== normalizeAddress(r.walletAddress)) {
                        setRecipientId("");
                      }
                    }
                  }}
                  placeholder="0x recipient address"
                  className="font-mono text-xs"
                  spellCheck={false}
                  autoComplete="off"
                />
                {toAddress.trim() && !proposeDestValid ? (
                  <p className="mt-1.5 text-[11px] text-[var(--kura-error-fg)]">Enter a valid 0x address.</p>
                ) : null}
                {selectedRecipient && proposeDestValid ? (
                  <p className="mt-1.5 text-[11px] text-[var(--kura-text-secondary)]">
                    Paying <span className="font-semibold text-[var(--kura-text)]">{selectedRecipient.name}</span>
                    {selectedRecipient.email ? ` · ${selectedRecipient.email}` : ""}
                  </p>
                ) : null}
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
                    Amount
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setAmount(usdcBalance > 0 ? String(Math.floor(usdcBalance * 100) / 100) : "0")
                    }
                    className="text-[11px] font-semibold text-[var(--kura-primary)] hover:underline"
                  >
                    Max · {isBalanceHidden ? "••••" : `${usdcBalance.toFixed(2)} USDC`}
                  </button>
                </div>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="pr-16 text-lg font-semibold tabular-nums"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-[var(--kura-text-secondary)]">
                    USDC
                  </span>
                </div>
                {amount.trim() && Number.isFinite(proposeAmount) && proposeAmount > usdcBalance ? (
                  <p className="mt-1.5 text-[11px] text-[var(--kura-error-fg)]">
                    Exceeds Treasury balance ({usdcBalance.toFixed(2)} USDC).
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {[0.25, 0.5, 1].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => {
                        const v = Math.floor(usdcBalance * pct * 100) / 100;
                        setAmount(v > 0 ? String(v) : "0");
                      }}
                      className="rounded-lg border border-[var(--kura-border)] bg-[var(--kura-bg-light)] px-2.5 py-1 text-[11px] font-semibold text-[var(--kura-text-secondary)] transition-colors hover:text-[var(--kura-text)]"
                    >
                      {pct === 1 ? "100%" : `${pct * 100}%`}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
                  Memo
                </label>
                <Input
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="Invoice #, vendor, or internal note"
                  maxLength={120}
                />
                <p className="mt-1.5 text-[11px] text-[var(--kura-text-secondary)]">
                  Stored locally in this session confirmation only — not on-chain.
                </p>
              </div>

              {formError ? (
                <div className="rounded-xl border border-[var(--kura-error-border)] bg-[var(--kura-error-bg)] px-3.5 py-2.5 text-xs text-[var(--kura-error-fg)]">
                  {formError}
                </div>
              ) : null}

              <Button
                type="submit"
                className="w-full rounded-full"
                size="lg"
                disabled={!canPropose}
              >
                {formBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Proposing…
                  </>
                ) : (
                  <>
                    Propose &amp; sign
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          </Panel>

          <div className="space-y-4">
            <Panel padding="md">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
                Payment preview
              </p>
              <div className="mt-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] text-[var(--kura-text-secondary)]">From</p>
                    <p className="mt-0.5 text-sm font-semibold text-[var(--kura-text)]">
                      {treasury.name ?? "Treasury"}
                    </p>
                    {treasury.scaAddress ? (
                      <p className="mt-0.5 font-mono text-[11px] text-[var(--kura-text-secondary)]">
                        {truncate(treasury.scaAddress)}
                      </p>
                    ) : null}
                  </div>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--kura-primary)]/12 text-[var(--kura-primary-light)]">
                    <Wallet className="h-4 w-4" />
                  </span>
                </div>

                <div className="flex justify-center">
                  <ArrowRight className="h-3.5 w-3.5 text-[var(--kura-text-secondary)]" />
                </div>

                <div>
                  <p className="text-[11px] text-[var(--kura-text-secondary)]">To</p>
                  <p className="mt-0.5 text-sm font-semibold text-[var(--kura-text)]">
                    {selectedRecipient?.name ??
                      (proposeDestValid ? "External wallet" : "Recipient")}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-[var(--kura-text-secondary)]">
                    {proposeDestValid ? truncate(normalizeAddress(toAddress.trim())) : "—"}
                  </p>
                </div>

                <div className="rounded-xl border border-[var(--kura-border)] bg-[var(--kura-bg-light)] px-3.5 py-3">
                  <p className="text-[11px] text-[var(--kura-text-secondary)]">Amount</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-[var(--kura-text)]">
                    {proposeAmountValid
                      ? formatUsd(proposeAmount, isBalanceHidden)
                      : formatUsd(0, isBalanceHidden)}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--kura-text-secondary)]">USDC on Base</p>
                </div>

                {memo.trim() ? (
                  <div>
                    <p className="text-[11px] text-[var(--kura-text-secondary)]">Memo</p>
                    <p className="mt-0.5 text-sm text-[var(--kura-text)]">{memo.trim()}</p>
                  </div>
                ) : null}
              </div>
            </Panel>

            <Panel padding="md">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
                Approval flow
              </p>
              <ol className="mt-3 space-y-3">
                {[
                  {
                    step: "1",
                    title: "Propose & sign",
                    body: "You submit the Safe tx and add your signature.",
                  },
                  {
                    step: "2",
                    title: `${safeThreshold}-of-${owners.length || "?"} owners`,
                    body: "Remaining owners confirm in Needs signing.",
                  },
                  {
                    step: "3",
                    title: "Execute on Base",
                    body: "When the threshold is met, any owner can execute.",
                  },
                ].map((item) => (
                  <li key={item.step} className="flex gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--kura-border)] bg-[var(--kura-surface)] text-[11px] font-semibold text-[var(--kura-text-secondary)]">
                      {item.step}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--kura-text)]">{item.title}</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--kura-text-secondary)]">
                        {item.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>
          </div>
        </section>
      ) : null}

      <Modal
        isOpen={recipientOpen}
        onClose={() => setRecipientOpen(false)}
        title="Add USDC recipient"
        description="Local address book only"
      >
        <form onSubmit={handleAddRecipient} className="space-y-3">
          <Input
            value={rcpName}
            onChange={(e) => setRcpName(e.target.value)}
            placeholder="Name"
            required
          />
          <Input
            type="email"
            value={rcpEmail}
            onChange={(e) => setRcpEmail(e.target.value)}
            placeholder="Email (optional)"
          />
          <Input
            value={rcpWallet}
            onChange={(e) => setRcpWallet(e.target.value)}
            placeholder="0x wallet address"
            className="font-mono text-xs"
            required
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setRecipientOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Modal>
    </DashboardPage>
  );
}
