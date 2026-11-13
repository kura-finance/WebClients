"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type OrgMember,
  type OrgRecipient,
  type OrgRole,
} from "@/lib/orgTypes";
import {
  defaultTreasuryName,
  nextTreasurySaltNonce,
  type OrgTreasury,
  type TreasurySource,
} from "@/lib/orgTreasury";

export type { OrgTreasury, TreasurySource };

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function migrateLegacyTreasuries(raw: unknown): {
  treasuries: OrgTreasury[];
  activeTreasuryId: string | null;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const state = raw as {
    state?: {
      treasuryScaAddress?: string | null;
      treasurySource?: TreasurySource | null;
      companyName?: string;
      treasuries?: OrgTreasury[];
      activeTreasuryId?: string | null;
    };
  };
  const s = state.state;
  if (!s) return null;
  if (Array.isArray(s.treasuries) && s.treasuries.length > 0) {
    const active =
      s.activeTreasuryId && s.treasuries.some((t) => t.id === s.activeTreasuryId)
        ? s.activeTreasuryId
        : s.treasuries[0]?.id ?? null;
    return { treasuries: s.treasuries, activeTreasuryId: active };
  }
  if (s.treasuryScaAddress && /^0x[a-fA-F0-9]{40}$/.test(s.treasuryScaAddress)) {
    const id = "try_migrated";
    return {
      treasuries: [
        {
          id,
          name: s.companyName?.trim() || "Treasury",
          address: s.treasuryScaAddress,
          source: s.treasurySource === "bound" ? "bound" : "created",
          createdAt: new Date().toISOString(),
          saltNonce: s.treasurySource === "bound" ? undefined : "1",
        },
      ],
      activeTreasuryId: id,
    };
  }
  return null;
}

interface OrgState {
  companyName: string;
  members: OrgMember[];
  recipients: OrgRecipient[];
  treasuries: OrgTreasury[];
  activeTreasuryId: string | null;

  replaceTreasuries: (workspace: {
    treasuries: OrgTreasury[];
    activeTreasuryId: string | null;
  }) => void;

  ensureOwner: (name: string, email: string, walletAddress?: string | null) => void;

  addTreasury: (input: {
    name?: string;
    address: string;
    source: TreasurySource;
    saltNonce?: string;
  }) => string;
  updateTreasury: (id: string, patch: Partial<Pick<OrgTreasury, "name">>) => void;
  removeTreasury: (id: string) => void;
  setActiveTreasury: (id: string | null) => void;
  /** Wipe org workspace (call on logout). */
  resetOrgWorkspace: () => void;

  inviteMember: (input: {
    name: string;
    email: string;
    role: OrgRole;
    walletAddress?: string;
    canSign?: boolean;
  }) => void;
  updateMemberRole: (id: string, role: OrgRole) => void;
  updateMemberWallet: (id: string, walletAddress: string) => void;
  setMemberCanSign: (id: string, canSign: boolean) => void;
  removeMember: (id: string) => void;
  /** Merge on-chain Safe owners into the members list. */
  syncSafeOwners: (owners: `0x${string}`[], eoaAddress?: string | null) => void;

  addRecipient: (input: Omit<OrgRecipient, "id" | "createdAt">) => void;
  removeRecipient: (id: string) => void;
}

export const useOrgStore = create<OrgState>()(
  persist(
    (set, get) => ({
      companyName: "Treasury",
      members: [],
      recipients: [],
      treasuries: [],
      activeTreasuryId: null,

      replaceTreasuries: ({ treasuries, activeTreasuryId }) => {
        const active =
          activeTreasuryId && treasuries.some((t) => t.id === activeTreasuryId)
            ? activeTreasuryId
            : treasuries[0]?.id ?? null;
        set({ treasuries, activeTreasuryId: active });
      },

      ensureOwner: (name, email, walletAddress) => {
        const { members } = get();
        const ownerEmail = email || "owner@example.com";
        const addr = walletAddress?.trim() || undefined;
        const existingOwner = members.find((m) => m.role === "owner");
        if (existingOwner) {
          if (addr && !existingOwner.walletAddress) {
            set({
              members: members.map((m) =>
                m.id === existingOwner.id
                  ? { ...m, walletAddress: addr, canSign: true, name: name || m.name, email: ownerEmail }
                  : m,
              ),
            });
          }
          return;
        }
        set({
          members: [
            {
              id: uid("mem"),
              name: name || "Owner",
              email: ownerEmail,
              role: "owner",
              status: "active",
              invitedAt: new Date().toISOString(),
              walletAddress: addr,
              canSign: Boolean(addr),
            },
            ...members.filter((m) => m.email !== ownerEmail),
          ],
        });
      },

      addTreasury: ({ name, address, source, saltNonce }) => {
        const trimmed = address.trim();
        if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return "";
        const lower = trimmed.toLowerCase();
        const existing = get().treasuries.find((t) => t.address.toLowerCase() === lower);
        if (existing) {
          set({ activeTreasuryId: existing.id });
          return existing.id;
        }
        const id = uid("try");
        const entry: OrgTreasury = {
          id,
          name: (name?.trim() || defaultTreasuryName(get().treasuries)).slice(0, 64),
          address: trimmed,
          source,
          createdAt: new Date().toISOString(),
          ...(source === "created"
            ? { saltNonce: saltNonce ?? nextTreasurySaltNonce(get().treasuries).toString() }
            : {}),
        };
        set({
          treasuries: [...get().treasuries, entry],
          activeTreasuryId: id,
        });
        return id;
      },

      updateTreasury: (id, patch) => {
        set({
          treasuries: get().treasuries.map((t) =>
            t.id === id
              ? {
                  ...t,
                  ...(patch.name !== undefined
                    ? { name: patch.name.trim().slice(0, 64) || t.name }
                    : {}),
                }
              : t,
          ),
        });
      },

      removeTreasury: (id) => {
        const next = get().treasuries.filter((t) => t.id !== id);
        const active = get().activeTreasuryId;
        set({
          treasuries: next,
          activeTreasuryId:
            active === id ? next[0]?.id ?? null : active && next.some((t) => t.id === active) ? active : next[0]?.id ?? null,
        });
      },

      setActiveTreasury: (id) => {
        if (id === null) {
          set({ activeTreasuryId: null });
          return;
        }
        if (!get().treasuries.some((t) => t.id === id)) return;
        set({ activeTreasuryId: id });
      },

      resetOrgWorkspace: () => {
        set({
          companyName: "Treasury",
          members: [],
          recipients: [],
          treasuries: [],
          activeTreasuryId: null,
        });
      },

      inviteMember: ({ name, email, role, walletAddress, canSign }) => {
        const existing = get().members.find((m) => m.email.toLowerCase() === email.toLowerCase());
        if (existing) return;
        const addr = walletAddress?.trim() || undefined;
        if (addr) {
          const dup = get().members.find(
            (m) => m.walletAddress?.toLowerCase() === addr.toLowerCase(),
          );
          if (dup) return;
        }
        set({
          members: [
            ...get().members,
            {
              id: uid("mem"),
              name,
              email,
              role,
              status: "invited",
              invitedAt: new Date().toISOString(),
              walletAddress: addr,
              canSign: Boolean(canSign && addr),
            },
          ],
        });
      },

      updateMemberRole: (id, role) => {
        set({
          members: get().members.map((m) => (m.id === id && m.role !== "owner" ? { ...m, role } : m)),
        });
      },

      updateMemberWallet: (id, walletAddress) => {
        const addr = walletAddress.trim();
        set({
          members: get().members.map((m) =>
            m.id === id ? { ...m, walletAddress: addr || undefined } : m,
          ),
        });
      },

      setMemberCanSign: (id, canSign) => {
        set({
          members: get().members.map((m) => (m.id === id ? { ...m, canSign } : m)),
        });
      },

      removeMember: (id) => {
        set({
          members: get().members.filter((m) => m.id !== id || m.role === "owner"),
        });
      },

      syncSafeOwners: (owners, eoaAddress) => {
        const { members } = get();
        const byAddr = new Map(
          members
            .filter((m) => m.walletAddress)
            .map((m) => [m.walletAddress!.toLowerCase(), m] as const),
        );

        let changed = false;
        const next = members.map((m) => {
          if (!m.walletAddress) return m;
          const onChain = owners.some(
            (o) => o.toLowerCase() === m.walletAddress!.toLowerCase(),
          );
          if (m.canSign === onChain && (!onChain || m.status === "active")) return m;
          changed = true;
          return { ...m, canSign: onChain, status: onChain ? ("active" as const) : m.status };
        });

        for (const owner of owners) {
          const key = owner.toLowerCase();
          if (byAddr.has(key) || next.some((m) => m.walletAddress?.toLowerCase() === key)) {
            continue;
          }
          const isSelf = Boolean(eoaAddress && eoaAddress.toLowerCase() === key);
          const selfMember = isSelf
            ? next.find((m) => m.role === "owner" && !m.walletAddress)
            : undefined;
          if (selfMember) {
            const idx = next.findIndex((m) => m.id === selfMember.id);
            next[idx] = {
              ...selfMember,
              walletAddress: owner,
              canSign: true,
              status: "active",
            };
            byAddr.set(key, next[idx]!);
            changed = true;
            continue;
          }
          const short = `${owner.slice(0, 6)}…${owner.slice(-4)}`;
          const created = {
            id: uid("mem"),
            name: isSelf ? "You" : `Signer ${short}`,
            email: isSelf
              ? members.find((m) => m.role === "owner")?.email || ""
              : `${short.replace("…", "")}@safe.local`,
            role: (isSelf ? "owner" : "admin") as OrgRole,
            status: "active" as const,
            invitedAt: new Date().toISOString(),
            walletAddress: owner,
            canSign: true,
          };
          next.push(created);
          byAddr.set(key, created);
          changed = true;
        }

        if (changed) set({ members: next });
      },

      addRecipient: (input) => {
        set({
          recipients: [
            ...get().recipients,
            { ...input, id: uid("rcp"), createdAt: new Date().toISOString() },
          ],
        });
      },

      removeRecipient: (id) => {
        set({ recipients: get().recipients.filter((r) => r.id !== id) });
      },
    }),
    {
      name: "kura-org-banking-v8",
      partialize: (state) => ({
        companyName: state.companyName,
        members: state.members,
        recipients: state.recipients,
        treasuries: state.treasuries,
        activeTreasuryId: state.activeTreasuryId,
      }),
      onRehydrateStorage: () => (state) => {
        try {
          const legacyRaw = localStorage.getItem("kura-org-banking-v7");
          if (legacyRaw && (!state?.treasuries || state.treasuries.length === 0)) {
            const migrated = migrateLegacyTreasuries(JSON.parse(legacyRaw));
            if (migrated) {
              useOrgStore.setState({
                treasuries: migrated.treasuries,
                activeTreasuryId: migrated.activeTreasuryId,
              });
            }
            localStorage.removeItem("kura-org-banking-v7");
          }
        } catch {
          /* ignore migration errors */
        }
        const current = useOrgStore.getState();
        if (
          current.activeTreasuryId &&
          !current.treasuries.some((t) => t.id === current.activeTreasuryId)
        ) {
          useOrgStore.setState({
            activeTreasuryId: current.treasuries[0]?.id ?? null,
          });
        }
      },
    },
  ),
);

const ORG_OWNER_KEY = "kura-org-owner";

/**
 * Local-only mode (no backend): localStorage is the only copy of the workspace,
 * so sign-out keeps it. Tag it with the signed-in user instead and wipe it only
 * when a different user signs in on this browser.
 */
export function claimOrgWorkspace(ownerId: string): void {
  if (typeof window === "undefined") return;
  // No wait on persist hydration: localStorage rehydrates synchronously when the
  // store is created, so the workspace is already loaded by the time a user signs in.
  try {
    const previous = localStorage.getItem(ORG_OWNER_KEY);
    if (previous && previous !== ownerId) {
      useOrgStore.getState().resetOrgWorkspace();
    }
    localStorage.setItem(ORG_OWNER_KEY, ownerId);
  } catch {
    /* storage unavailable */
  }
}

/** Active treasury entry (null if none). */
export function selectActiveTreasury(state: {
  treasuries: OrgTreasury[];
  activeTreasuryId: string | null;
}): OrgTreasury | null {
  const { treasuries, activeTreasuryId } = state;
  if (!treasuries.length) return null;
  return treasuries.find((t) => t.id === activeTreasuryId) ?? treasuries[0] ?? null;
}
