/**
 * Hydrate / persist org treasuries against /api/treasuries.
 *
 * Product rules:
 *   - Daily ops: POST / PATCH / DELETE / PUT active (never PUT / except migration)
 *   - After mutate: apply server response (or GET) as source of truth
 *   - localStorage is cache only when remote is unavailable
 *   - No backend configured: remote is skipped entirely and localStorage is
 *     the source of truth (no network calls)
 *   - Dashboard membership gate handles tier; 403 from API is surfaced
 */

import { ApiError } from "@/lib/errorHandler";
import {
  createTreasury,
  deleteTreasury,
  fetchTreasuries,
  isTreasuryApiUnavailable,
  patchTreasury,
  replaceTreasuries,
  setActiveTreasuryRemote,
  treasuryErrorCode,
  type CreateTreasuryInput,
} from "@/lib/treasuryApi";
import { useOrgStore, type OrgTreasury } from "@/store/useOrgStore";
import { features } from "@/config/features";

let remoteAvailable: boolean | null = null;
let hydratePromise: Promise<void> | null = null;

function markUnavailable(error: unknown): boolean {
  if (isTreasuryApiUnavailable(error)) {
    remoteAvailable = false;
    return true;
  }
  if (error instanceof ApiError && error.status === 401) {
    return true;
  }
  return false;
}

async function withRemote<T>(fn: () => Promise<T>): Promise<T | null> {
  if (!features.backend) return null;
  if (remoteAvailable === false) return null;
  try {
    const result = await fn();
    remoteAvailable = true;
    return result;
  } catch (error) {
    if (markUnavailable(error)) return null;
    throw error;
  }
}

/** Apply server workspace into the org store. */
export function applyTreasuryWorkspace(workspace: {
  treasuries: OrgTreasury[];
  activeTreasuryId: string | null;
}): void {
  useOrgStore.getState().replaceTreasuries(workspace);
}

function waitForOrgPersistHydration(): Promise<void> {
  const persistApi = useOrgStore.persist;
  if (persistApi.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = persistApi.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });
}

/**
 * GET /api/treasuries → hydrate store.
 * If server empty and local has data → one-shot PUT migrate (only safe use of PUT /).
 */
export async function hydrateTreasuryWorkspace(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    await waitForOrgPersistHydration();

    let remote: Awaited<ReturnType<typeof fetchTreasuries>> | null = null;
    try {
      remote = await withRemote(() => fetchTreasuries());
    } catch (error) {
      if (treasuryErrorCode(error) === "FORBIDDEN") {
        console.warn("[TreasurySync] Forbidden — membership required");
      } else {
        console.warn("[TreasurySync] hydrate failed", error);
      }
      return;
    }
    if (!remote) return;

    if (remote.treasuries.length > 0) {
      applyTreasuryWorkspace(remote);
      return;
    }

    const local = useOrgStore.getState();
    if (local.treasuries.length === 0) {
      applyTreasuryWorkspace(remote);
      return;
    }

    // One-shot migration only — do not use PUT / for everyday ops.
    try {
      const migrated = await withRemote(() =>
        replaceTreasuries({
          treasuries: local.treasuries,
          activeTreasuryId: local.activeTreasuryId,
        }),
      );
      if (migrated) applyTreasuryWorkspace(migrated);
    } catch (error) {
      console.warn("[TreasurySync] migrate failed", error);
    }
  })().finally(() => {
    hydratePromise = null;
  });
  return hydratePromise;
}

/** Reset remote-availability probe (e.g. after login / logout). */
export function resetTreasurySyncProbe(): void {
  remoteAvailable = null;
}

/**
 * Create or bind. Prefer server POST (idempotent on address).
 * Local add only when remote unavailable.
 */
export async function syncAddTreasury(
  input: CreateTreasuryInput,
): Promise<string> {
  try {
    const created = await withRemote(() => createTreasury(input));
    if (created) {
      const state = useOrgStore.getState();
      const withoutDup = state.treasuries.filter(
        (t) =>
          t.id !== created.id &&
          t.address.toLowerCase() !== created.address.toLowerCase(),
      );
      applyTreasuryWorkspace({
        treasuries: [...withoutDup, created],
        activeTreasuryId: created.id,
      });
      return created.id;
    }
  } catch (error) {
    const code = treasuryErrorCode(error);
    if (code === "PERSONAL_SCA" || code === "CONFLICT" || code === "FORBIDDEN") {
      throw error;
    }
    console.warn("[TreasurySync] create failed, falling back local", error);
  }

  return useOrgStore.getState().addTreasury(input);
}

export async function syncUpdateTreasury(
  id: string,
  patch: { name: string },
): Promise<void> {
  const name = patch.name.trim().slice(0, 64);
  try {
    const updated = await withRemote(() => patchTreasury(id, { name }));
    if (updated) {
      useOrgStore.setState((state) => ({
        treasuries: state.treasuries.map((t) =>
          t.id === id ? { ...t, ...updated } : t,
        ),
      }));
      return;
    }
  } catch (error) {
    if (treasuryErrorCode(error) === "FORBIDDEN") throw error;
    console.warn("[TreasurySync] patch failed, applying local", error);
  }
  useOrgStore.getState().updateTreasury(id, { name });
}

export async function syncRemoveTreasury(id: string): Promise<void> {
  try {
    const workspace = await withRemote(() => deleteTreasury(id));
    if (workspace) {
      applyTreasuryWorkspace(workspace);
      return;
    }
  } catch (error) {
    if (treasuryErrorCode(error) === "FORBIDDEN") throw error;
    console.warn("[TreasurySync] delete failed, applying local", error);
  }
  useOrgStore.getState().removeTreasury(id);
}

export async function syncSetActiveTreasury(id: string | null): Promise<void> {
  try {
    const remote = await withRemote(() => setActiveTreasuryRemote(id));
    if (remote) {
      applyTreasuryWorkspace(remote);
      return;
    }
  } catch (error) {
    if (treasuryErrorCode(error) === "FORBIDDEN") throw error;
    console.warn("[TreasurySync] setActive failed, applying local", error);
  }
  useOrgStore.getState().setActiveTreasury(id);
}

/**
 * @deprecated Prefer repeated syncAddTreasury (POST). PUT / clears then rebuilds.
 * Kept only for explicit disaster recovery — not used by Import UI.
 */
export async function syncReplaceWorkspace(): Promise<void> {
  const { treasuries, activeTreasuryId } = useOrgStore.getState();
  const remote = await withRemote(() =>
    replaceTreasuries({ treasuries, activeTreasuryId }),
  );
  if (remote) applyTreasuryWorkspace(remote);
}

/** Re-fetch workspace from server (after create/switch when response incomplete). */
export async function refreshTreasuryWorkspace(): Promise<void> {
  try {
    const remote = await withRemote(() => fetchTreasuries());
    if (remote) applyTreasuryWorkspace(remote);
  } catch (error) {
    console.warn("[TreasurySync] refresh failed", error);
  }
}
