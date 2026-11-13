/**
 * Local wallet — vault storage and the in-memory session.
 *
 * - The encrypted record lives in localStorage under one key.
 * - The decrypted key lives only in this module's memory: never in
 *   localStorage / sessionStorage / the URL / logs. A reload or closing the tab
 *   locks the wallet; so does 15 minutes without activity.
 *
 * Relative imports only (testable under `node --test` with a stub localStorage).
 */

import type { PrivateKeyAccount } from "viem/accounts";
import { accountFromSecret, type WalletSecret } from "./keys.ts";
import { WalletLockedError } from "./provider.ts";
import { decryptVault, encryptVault, parseVaultRecord, type VaultRecord } from "./vault.ts";

export const VAULT_STORAGE_KEY = "kura-wallet-vault-v1";
/** Lock after this long without user activity. */
export const AUTO_LOCK_MS = 15 * 60 * 1000;

export type LocalWalletStatus = "unknown" | "none" | "locked" | "unlocked";

export interface LocalWalletSnapshot {
  /** "unknown" until storage has been read (server render / first paint). */
  status: LocalWalletStatus;
  /** EOA of the stored wallet (readable while locked). */
  address: `0x${string}` | null;
}

export class VaultExistsError extends Error {
  constructor() {
    super("A wallet is already saved in this browser. Remove it before adding another one.");
    this.name = "VaultExistsError";
  }
}

export class StorageUnavailableError extends Error {
  constructor() {
    super("This browser does not allow saving the wallet (storage is unavailable or full).");
    this.name = "StorageUnavailableError";
  }
}

export class NoVaultError extends Error {
  constructor() {
    super("No wallet is saved in this browser.");
    this.name = "NoVaultError";
  }
}

let session: { account: PrivateKeyAccount } | null = null;
let snapshot: LocalWalletSnapshot = { status: "unknown", address: null };
const listeners = new Set<() => void>();

let lastActivity = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function readRecord(): VaultRecord | null {
  const raw = storage()?.getItem(VAULT_STORAGE_KEY);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  // Throws VaultFormatError for a damaged record — never treated as "no wallet",
  // so a damaged vault cannot be silently overwritten.
  return parseVaultRecord(parsed);
}

function setSnapshot(next: LocalWalletSnapshot): void {
  if (next.status === snapshot.status && next.address === snapshot.address) return;
  snapshot = next;
  for (const listener of [...listeners]) listener();
}

function clearIdleTimer(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
}

function scheduleIdleCheck(delay: number): void {
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    if (!session) return;
    const idleFor = Date.now() - lastActivity;
    if (idleFor >= AUTO_LOCK_MS) lock();
    else scheduleIdleCheck(AUTO_LOCK_MS - idleFor);
  }, delay);
  (idleTimer as { unref?: () => void }).unref?.();
}

function startSession(secret: WalletSecret): void {
  const account = accountFromSecret(secret);
  session = { account };
  lastActivity = Date.now();
  scheduleIdleCheck(AUTO_LOCK_MS);
  setSnapshot({ status: "unlocked", address: account.address });
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): LocalWalletSnapshot {
  return snapshot;
}

/**
 * Re-read storage and settle the status. Call on startup and when another tab
 * changes the vault. Locks if the stored wallet is gone or is a different one.
 */
export function syncFromStorage(): LocalWalletSnapshot {
  let record: VaultRecord | null = null;
  let damaged = false;
  try {
    record = readRecord();
  } catch {
    damaged = true;
  }

  if (session && record && record.eoaAddress.toLowerCase() === session.account.address.toLowerCase()) {
    return snapshot;
  }
  if (session) {
    session = null;
    clearIdleTimer();
  }
  if (record) {
    setSnapshot({ status: "locked", address: record.eoaAddress as `0x${string}` });
  } else {
    // A damaged record still counts as "a wallet is saved": unlocking reports the damage.
    setSnapshot({ status: damaged ? "locked" : "none", address: null });
  }
  return snapshot;
}

/** True when an encrypted wallet (even a damaged one) is saved in this browser. */
export function hasVault(): boolean {
  return Boolean(storage()?.getItem(VAULT_STORAGE_KEY));
}

/**
 * Encrypt `secret` under `password`, save it, and unlock. Refuses to replace an
 * existing vault — that could be the only copy of a key.
 */
export async function createVault(secret: WalletSecret, password: string): Promise<void> {
  const store = storage();
  if (!store) throw new StorageUnavailableError();
  if (hasVault()) throw new VaultExistsError();

  const serialized = JSON.stringify(await encryptVault(secret, password));

  // Re-check after the (slow) key derivation: another tab may have saved a wallet meanwhile.
  if (hasVault()) throw new VaultExistsError();
  try {
    store.setItem(VAULT_STORAGE_KEY, serialized);
  } catch {
    throw new StorageUnavailableError();
  }
  if (store.getItem(VAULT_STORAGE_KEY) !== serialized) throw new StorageUnavailableError();

  startSession(secret);
}

/** Decrypt the saved wallet into memory. Throws WrongPasswordError on a bad password. */
export async function unlock(password: string): Promise<void> {
  const record = readRecord();
  if (!record) throw new NoVaultError();
  startSession(await decryptVault(record, password));
}

/** Drop the key from memory. The encrypted vault stays. */
export function lock(): void {
  if (!session && snapshot.status !== "unlocked") return;
  session = null;
  clearIdleTimer();
  syncFromStorage();
}

/** Decrypt again with the password (also while unlocked) and hand back the secret for display. */
export async function revealSecret(password: string): Promise<WalletSecret> {
  const record = readRecord();
  if (!record) throw new NoVaultError();
  return decryptVault(record, password);
}

/** Delete the encrypted wallet from this browser and lock. Irreversible. */
export function removeVault(): void {
  session = null;
  clearIdleTimer();
  storage()?.removeItem(VAULT_STORAGE_KEY);
  setSnapshot({ status: "none", address: null });
}

/** The unlocked signing account. Throws WalletLockedError while locked. */
export function getUnlockedAccount(): PrivateKeyAccount {
  if (!session) throw new WalletLockedError();
  return session.account;
}

/** Record user activity (resets the idle auto-lock). */
export function touchActivity(): void {
  if (session) lastActivity = Date.now();
}

/** Lock right away if the idle limit has passed (e.g. when the tab becomes visible again). */
export function lockIfIdle(): void {
  if (session && Date.now() - lastActivity >= AUTO_LOCK_MS) lock();
}
