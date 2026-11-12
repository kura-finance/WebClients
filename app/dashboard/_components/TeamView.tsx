"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  PenLine,
  RefreshCw,
  Shield,
  UserPlus,
  Users,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useOrgStore } from "@/store/useOrgStore";
import { useHomeWallet } from "@/hooks/useHomeWallet";
import { useTreasuryWallet } from "@/hooks/useTreasuryWallet";
import Link from "next/link";
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type OrgMember,
  type OrgRole,
} from "@/lib/orgTypes";
import {
  buildAddOwnerCall,
  buildChangeThresholdCall,
  buildRemoveOwnerCall,
  clampThreshold,
  isEthAddress,
  isSafeOwner,
  normalizeAddress,
} from "@/lib/safeOwners";
import { executeCallsFromSafe } from "@/lib/smartAccountSend";
import { isPimlicoConfigured } from "@/config/env";
import { isSignerConfigured, useSignerWallet } from "@/lib/signer";
import { signerCopy } from "@/lib/signer/copy";
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
} from "@/components/dashboard/PageShell";

function truncate(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function roleBadge(role: OrgRole): "default" | "success" | "outline" {
  if (role === "owner") return "success";
  if (role === "admin") return "default";
  return "outline";
}

export default function TeamView() {
  const profile = useAppStore((s) => s.userProfile);
  const members = useOrgStore((s) => s.members);
  const ensureOwner = useOrgStore((s) => s.ensureOwner);
  const inviteMember = useOrgStore((s) => s.inviteMember);
  const updateMemberRole = useOrgStore((s) => s.updateMemberRole);
  const updateMemberWallet = useOrgStore((s) => s.updateMemberWallet);
  const setMemberCanSign = useOrgStore((s) => s.setMemberCanSign);
  const removeMember = useOrgStore((s) => s.removeMember);
  const syncSafeOwners = useOrgStore((s) => s.syncSafeOwners);
  const personal = useHomeWallet();
  const treasury = useTreasuryWallet();
  const signerWallet = useSignerWallet(personal.eoaAddress);

  const owners = treasury.safeSigners?.owners ?? [];
  const onChainThreshold = treasury.safeSigners?.threshold ?? 1;
  const signerCount = owners.length;
  const ownersKey = owners.map((o) => o.toLowerCase()).join(",");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("admin");
  const [walletAddress, setWalletAddress] = useState("");
  const [canSign, setCanSign] = useState(true);
  const [thresholdDraft, setThresholdDraft] = useState("1");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    ensureOwner(profile.displayName || "Owner", profile.email || "", personal.eoaAddress);
  }, [ensureOwner, profile.displayName, profile.email, personal.eoaAddress]);

  useEffect(() => {
    if (!ownersKey) return;
    syncSafeOwners(owners, personal.eoaAddress);
    // ownersKey captures owner set; owners array identity is unstable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownersKey, syncSafeOwners, personal.eoaAddress]);

  useEffect(() => {
    setThresholdDraft(String(onChainThreshold));
  }, [onChainThreshold]);

  const canMutateSafe =
    !!treasury.scaAddress &&
    !!signerWallet &&
    isPimlicoConfigured() &&
    isSafeOwner(owners, personal.eoaAddress);

  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      const aSign = isSafeOwner(owners, a.walletAddress) ? 0 : 1;
      const bSign = isSafeOwner(owners, b.walletAddress) ? 0 : 1;
      if (aSign !== bSign) return aSign - bSign;
      if (a.role === "owner" && b.role !== "owner") return -1;
      if (b.role === "owner" && a.role !== "owner") return 1;
      return a.name.localeCompare(b.name);
    });
  }, [members, owners]);

  const runSafeCalls = useCallback(
    async (label: string, calls: Parameters<typeof executeCallsFromSafe>[0]["calls"]) => {
      if (!treasury.scaAddress) throw new Error("Treasury Safe not found. Create one under Treasury.");
      if (!signerWallet) throw new Error(signerCopy.walletUnavailable);
      if (!isPimlicoConfigured()) {
        throw new Error("Pimlico is not configured. Set NEXT_PUBLIC_PIMLICO_API_KEY.");
      }
      if (!isSafeOwner(owners, personal.eoaAddress)) {
        throw new Error("Your EOA is not a Treasury Safe owner, so you cannot change signers.");
      }
      setTxError(null);
      setTxHash(null);
      setBusyId(label);
      try {
        const provider = (await signerWallet.getEthereumProvider()) as {
          request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
        };
        const hash = await executeCallsFromSafe({
          eip1193Provider: provider,
          expectedScaAddress: treasury.scaAddress as `0x${string}`,
          calls,
          ...treasury.accountOpts,
        });
        setTxHash(hash);
        await treasury.refresh();
        return hash;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Safe owner update failed.";
        setTxError(msg);
        throw e;
      } finally {
        setBusyId(null);
      }
    },
    [owners, personal.eoaAddress, signerWallet, treasury],
  );

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setTxError(null);
    if (!name.trim() || !email.trim()) return;

    const addr = walletAddress.trim();
    if (canSign) {
      if (!isEthAddress(addr)) {
        setTxError("Signer members need a valid EOA address (0x…).");
        return;
      }
      if (isSafeOwner(owners, addr)) {
        setTxError("This address is already a Safe signer.");
        return;
      }
      if (!treasury.scaAddress) {
        setTxError("Create a Treasury Safe before adding signers.");
        return;
      }
      try {
        await runSafeCalls("invite", [
          buildAddOwnerCall({
            safeAddress: treasury.scaAddress as `0x${string}`,
            newOwner: normalizeAddress(addr),
            threshold: onChainThreshold,
          }),
        ]);
      } catch {
        return;
      }
    } else if (addr && !isEthAddress(addr)) {
      setTxError("Wallet address looks invalid.");
      return;
    }

    inviteMember({
      name: name.trim(),
      email: email.trim(),
      role,
      walletAddress: addr || undefined,
      canSign: canSign && Boolean(addr),
    });
    setName("");
    setEmail("");
    setWalletAddress("");
    setRole("admin");
    setCanSign(true);
    setInviteOpen(false);
  };

  const toggleSign = async (member: OrgMember, next: boolean) => {
    setTxError(null);
    const addr = member.walletAddress?.trim();
    if (!addr || !isEthAddress(addr)) {
      setTxError(`Add a wallet address for ${member.name} before enabling signing.`);
      return;
    }
    if (!treasury.scaAddress) {
      setTxError("Treasury Safe not found.");
      return;
    }

    const onChain = isSafeOwner(owners, addr);
    if (next === onChain) {
      setMemberCanSign(member.id, next);
      return;
    }

    if (next) {
      try {
        await runSafeCalls(member.id, [
          buildAddOwnerCall({
            safeAddress: treasury.scaAddress as `0x${string}`,
            newOwner: normalizeAddress(addr),
            threshold: onChainThreshold,
          }),
        ]);
        setMemberCanSign(member.id, true);
      } catch {
        /* error set in runSafeCalls */
      }
      return;
    }

    if (owners.length <= 1) {
      setTxError("Cannot remove the last Safe signer.");
      return;
    }
    const newThreshold = clampThreshold(onChainThreshold, owners.length - 1);
    try {
      await runSafeCalls(member.id, [
        buildRemoveOwnerCall({
          safeAddress: treasury.scaAddress as `0x${string}`,
          owners,
          ownerToRemove: normalizeAddress(addr),
          threshold: newThreshold,
        }),
      ]);
      setMemberCanSign(member.id, false);
    } catch {
      /* error set */
    }
  };

  const handleRemoveMember = async (member: OrgMember) => {
    if (member.role === "owner") return;
    const onChain = isSafeOwner(owners, member.walletAddress);
    if (onChain && member.walletAddress && treasury.scaAddress) {
      if (owners.length <= 1) {
        setTxError("Cannot remove the last Safe signer.");
        return;
      }
      const newThreshold = clampThreshold(onChainThreshold, owners.length - 1);
      try {
        await runSafeCalls(member.id, [
          buildRemoveOwnerCall({
            safeAddress: treasury.scaAddress as `0x${string}`,
            owners,
            ownerToRemove: normalizeAddress(member.walletAddress),
            threshold: newThreshold,
          }),
        ]);
      } catch {
        return;
      }
    }
    removeMember(member.id);
  };

  const saveThreshold = async () => {
    const n = Number(thresholdDraft);
    if (!Number.isInteger(n) || n < 1) {
      setTxError("Threshold must be a whole number ≥ 1.");
      return;
    }
    if (n > signerCount) {
      setTxError(`Threshold cannot exceed signer count (${signerCount}).`);
      return;
    }
    if (n === onChainThreshold) return;
    if (!treasury.scaAddress) return;
    try {
      await runSafeCalls("threshold", [
        buildChangeThresholdCall({
          safeAddress: treasury.scaAddress as `0x${string}`,
          threshold: n,
        }),
      ]);
    } catch {
      /* error set */
    }
  };

  const copyAddress = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(address);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };

  const inviteRoles = (Object.keys(ROLE_LABELS) as OrgRole[]).filter((r) => r !== "owner");

  if (!treasury.bound) {
    return (
      <>
        {isSignerConfigured ? (
          <PrivyEoaSync onEoa={personal.applyEoaAddress} persistedEoa={personal.record.walletAddress} />
        ) : null}
        <EmptyGate
          eyebrow="Team"
          title="Treasury Safe required"
          description="Team signers are bound to your Treasury Safe — not your Smart Wallet. Create or bind one first."
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
        eyebrow="Team"
        title={treasury.name ? `${treasury.name} signers & team` : "Treasury Safe signers & team"}
        description="Members and on-chain owners for the active Treasury. Switch vaults to manage another Safe."
        actions={
          <>
            <TreasurySwitcher
              treasuries={treasury.treasuries}
              activeId={treasury.treasuryId}
              onSelect={treasury.setActiveTreasury}
            />
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full"
              onClick={() => void treasury.refresh()}
              disabled={treasury.signersLoading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${treasury.signersLoading ? "animate-spin" : ""}`} />
            </Button>
            <Button size="sm" className="rounded-full" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-3.5 w-3.5" />
              Add member
            </Button>
          </>
        }
      />

      {/* Safe binding strip */}
      <section className="mb-6 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <Panel padding="md">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--kura-primary)]/10 text-[var(--kura-primary-light)]">
              <KeyRound className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
                Active Treasury
              </p>
              {treasury.scaAddress ? (
                <button
                  type="button"
                  onClick={() => void copyAddress(treasury.scaAddress!)}
                  className="mt-1 flex items-center gap-2 font-mono text-sm text-[var(--kura-text)] hover:text-[var(--kura-primary-light)]"
                >
                  {truncate(treasury.scaAddress)}
                  {copied === treasury.scaAddress ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 opacity-60" />
                  )}
                </button>
              ) : (
                <p className="mt-1 text-sm text-[var(--kura-text-secondary)]">
              No Treasury Safe yet — create one under Treasury.
                </p>
              )}
              <p className="mt-2 text-xs text-[var(--kura-text-secondary)]">
                {signerCount > 0
                  ? `${onChainThreshold}-of-${signerCount} signatures required`
                  : "Owners will appear once the Safe is detected on Base."}
                {personal.eoaAddress ? (
                  <>
                    {" · Your EOA "}
                    <span className="font-mono">{truncate(personal.eoaAddress)}</span>
                    {isSafeOwner(owners, personal.eoaAddress) ? " (signer)" : " (not a signer)"}
                  </>
                ) : null}
              </p>
            </div>
          </div>
        </Panel>

        <Panel padding="md">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
            Signature threshold
          </p>
          <div className="mt-3 flex items-end gap-2">
            <div className="flex-1">
              <Input
                type="number"
                min={1}
                max={Math.max(1, signerCount)}
                value={thresholdDraft}
                onChange={(e) => setThresholdDraft(e.target.value)}
                disabled={!canMutateSafe || busyId !== null}
              />
            </div>
            <Button
              size="sm"
              className="rounded-full mb-0.5"
              onClick={() => void saveThreshold()}
              disabled={!canMutateSafe || busyId !== null || signerCount < 1}
            >
              {busyId === "threshold" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Update"}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-[var(--kura-text-secondary)]">
            How many Safe owners must approve each treasury transaction.
          </p>
        </Panel>
      </section>

      {txError ? <PageAlert variant="warning">{txError}</PageAlert> : null}
      {txHash ? (
        <PageAlert variant="success">
          Safe updated ·{" "}
          <a
            href={`https://basescan.org/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="font-semibold underline"
          >
            View on Basescan
          </a>
        </PageAlert>
      ) : null}
      {!canMutateSafe && treasury.scaAddress ? (
        <div className="mb-4 rounded-xl border border-[var(--kura-border)] bg-[var(--kura-surface)] px-4 py-3 text-xs text-[var(--kura-text-secondary)]">
          {!isPimlicoConfigured()
            ? "Pimlico is not configured — signing changes are view-only."
            : !isSafeOwner(owners, personal.eoaAddress)
              ? `Your ${signerCopy.eoa} is not an on-chain Safe owner, so you can view but not change signers.`
              : `${signerCopy.connect} to manage Safe signers.`}
        </div>
      ) : null}

      {/* Members = Safe team */}
      <Panel padding="none" className="mb-6">
        <div className="flex items-center justify-between border-b border-[var(--kura-border)] px-5 py-4">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-[var(--kura-text-secondary)]" />
            <h2 className="text-base font-semibold text-[var(--kura-text)]">Members</h2>
            <Badge variant="outline">{sortedMembers.length}</Badge>
            <Badge variant="success">{signerCount} signers</Badge>
          </div>
        </div>

        <div className="hidden grid-cols-[1.5fr_0.9fr_1.2fr_0.7fr_auto] gap-3 border-b border-[var(--kura-border)] px-5 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)] lg:grid">
          <span>Person</span>
          <span>Role</span>
          <span>Wallet</span>
          <span>Can sign</span>
          <span className="text-right">Actions</span>
        </div>

        {treasury.signersLoading && !sortedMembers.length ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-[var(--kura-bg-lighter)]" />
            ))}
          </div>
        ) : sortedMembers.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--kura-text-secondary)]">
            No members yet. Add a teammate and optionally make them a Safe signer.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--kura-border)]">
            {sortedMembers.map((m) => {
              const onChain = isSafeOwner(owners, m.walletAddress);
              const busy = busyId === m.id;
              return (
                <li
                  key={m.id}
                  className="grid gap-3 px-5 py-4 lg:grid-cols-[1.5fr_0.9fr_1.2fr_0.7fr_auto] lg:items-center"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--kura-primary)]/10 text-xs font-semibold text-[var(--kura-primary-light)]">
                      {m.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--kura-text)]">{m.name}</p>
                      <p className="truncate text-xs text-[var(--kura-text-secondary)]">
                        {m.email || "—"}
                      </p>
                    </div>
                  </div>

                  <div>
                    {m.role === "owner" ? (
                      <Badge variant={roleBadge(m.role)}>{ROLE_LABELS[m.role]}</Badge>
                    ) : (
                      <select
                        value={m.role}
                        onChange={(e) => updateMemberRole(m.id, e.target.value as OrgRole)}
                        className="h-8 rounded-md border border-[var(--kura-border)] bg-[var(--kura-bg-light)] px-2 text-xs font-medium text-[var(--kura-text)] outline-none"
                      >
                        {inviteRoles.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="min-w-0">
                    {m.walletAddress ? (
                      <button
                        type="button"
                        onClick={() => void copyAddress(m.walletAddress!)}
                        className="flex items-center gap-1.5 font-mono text-xs text-[var(--kura-text)]"
                      >
                        {truncate(m.walletAddress)}
                        {copied === m.walletAddress ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3 opacity-50" />
                        )}
                      </button>
                    ) : (
                      <Input
                        placeholder="0x… EOA"
                        className="h-8 text-xs font-mono"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && isEthAddress(v)) updateMemberWallet(m.id, v);
                        }}
                      />
                    )}
                    {onChain ? (
                      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-500">
                        On-chain owner
                      </p>
                    ) : m.walletAddress ? (
                      <p className="mt-1 text-[10px] text-[var(--kura-text-secondary)]">Not a signer</p>
                    ) : null}
                  </div>

                  <div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={onChain}
                      disabled={busy || !canMutateSafe || (m.role === "owner" && onChain && owners.length <= 1)}
                      onClick={() => void toggleSign(m, !onChain)}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-40 ${
                        onChain ? "bg-[var(--kura-primary)]" : "bg-[var(--kura-bg-lighter)]"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                          onChain ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                      {busy ? (
                        <Loader2 className="absolute inset-0 m-auto h-3.5 w-3.5 animate-spin text-white" />
                      ) : null}
                    </button>
                  </div>

                  <div className="flex justify-end">
                    {m.role !== "owner" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-full"
                        disabled={busy}
                        onClick={() => void handleRemoveMember(m)}
                      >
                        Remove
                      </Button>
                    ) : (
                      <span className="text-xs text-[var(--kura-text-secondary)]">—</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel padding="md">
        <div className="mb-3 flex items-center gap-2">
          <Shield className="h-4 w-4 text-[var(--kura-text-secondary)]" />
          <h2 className="text-base font-semibold text-[var(--kura-text)]">How signing works</h2>
        </div>
        <ul className="space-y-2 text-sm text-[var(--kura-text-secondary)]">
          <li className="flex gap-2">
            <PenLine className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--kura-primary-light)]" />
            <span>
              <span className="font-semibold text-[var(--kura-text)]">Can sign = Safe owner.</span> Turning
              it on submits an on-chain <code className="text-[11px]">addOwnerWithThreshold</code> from
              your Treasury Safe; turning it off removes that owner.
            </span>
          </li>
          <li className="flex gap-2">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--kura-primary-light)]" />
            <span>
              Use each member&apos;s {signerCopy.memberAddressHint}. They must control that key to approve UserOps
              for transfers and payments.
            </span>
          </li>
          <li className="flex gap-2">
            <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--kura-primary-light)]" />
            <span>
              Non-signing members (bookkeepers, viewers) can still hold Team roles without on-chain
              authority — leave “Can sign” off.
            </span>
          </li>
        </ul>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {(Object.keys(ROLE_DESCRIPTIONS) as OrgRole[]).map((r) => (
            <p key={r} className="text-[11px] text-[var(--kura-text-secondary)]">
              <span className="font-semibold text-[var(--kura-text)]">{ROLE_LABELS[r]}:</span>{" "}
              {ROLE_DESCRIPTIONS[r]}
            </p>
          ))}
        </div>
      </Panel>

      <Modal
        isOpen={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Add member"
        description="Optionally make them a Safe signer so they can authorize treasury moves."
        maxWidthClassName="max-w-md"
      >
        <form onSubmit={(e) => void handleInvite(e)} className="space-y-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            required
          />
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="work@example.com"
            required
          />
          <Input
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
            placeholder={signerCopy.memberAddressPlaceholder}
            className="font-mono text-xs"
            required={canSign}
          />
          <div>
            <p className="mb-1.5 text-xs font-semibold text-[var(--kura-text-secondary)]">Role</p>
            <div className="flex flex-wrap gap-2">
              {inviteRoles.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    role === r
                      ? "bg-[var(--kura-primary)] text-white"
                      : "border border-[var(--kura-border)] text-[var(--kura-text-secondary)]"
                  }`}
                >
                  {ROLE_LABELS[r]}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-start gap-3 rounded-xl border border-[var(--kura-border)] bg-[var(--kura-bg-light)] px-3 py-3">
            <input
              type="checkbox"
              checked={canSign}
              onChange={(e) => setCanSign(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[var(--kura-border)]"
            />
            <span>
              <span className="block text-sm font-semibold text-[var(--kura-text)]">
                Can sign (Safe owner)
              </span>
              <span className="mt-0.5 block text-[11px] text-[var(--kura-text-secondary)]">
                Adds this wallet as an on-chain Safe owner. Requires your {signerCopy.key} to approve the
                change.
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busyId === "invite"}>
              {busyId === "invite" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Updating Safe…
                </>
              ) : canSign ? (
                "Add & enable signing"
              ) : (
                "Add member"
              )}
            </Button>
          </div>
        </form>
      </Modal>
    </DashboardPage>
  );
}
