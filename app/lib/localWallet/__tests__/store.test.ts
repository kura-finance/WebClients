import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { secretFromPhrase, secretFromPrivateKey } from "../keys.ts";
import { WalletLockedError } from "../provider.ts";
import {
  AUTO_LOCK_MS,
  NoVaultError,
  VAULT_STORAGE_KEY,
  VaultExistsError,
  createVault,
  getSnapshot,
  getUnlockedAccount,
  hasVault,
  lock,
  lockIfIdle,
  removeVault,
  revealSecret,
  subscribe,
  syncFromStorage,
  touchActivity,
  unlock,
} from "../store.ts";
import { VaultFormatError, WrongPasswordError } from "../vault.ts";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const PASSWORD = "correct horse battery";

const data = new Map<string, string>();
const fakeStorage = {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => void data.set(key, value),
  removeItem: (key: string) => void data.delete(key),
};
(globalThis as { localStorage?: unknown }).localStorage = fakeStorage;

describe("local wallet store", () => {
  beforeEach(() => {
    removeVault();
    data.clear();
    syncFromStorage();
  });

  it("starts with no wallet", () => {
    assert.deepEqual(getSnapshot(), { status: "none", address: null });
    assert.equal(hasVault(), false);
    assert.throws(() => getUnlockedAccount(), WalletLockedError);
  });

  it("creates a vault, unlocks it, and keeps only ciphertext in storage", async () => {
    let notified = 0;
    const unsubscribe = subscribe(() => notified++);
    await createVault(secretFromPhrase(PHRASE), PASSWORD);
    unsubscribe();

    assert.deepEqual(getSnapshot(), { status: "unlocked", address: ADDRESS });
    assert.equal(getUnlockedAccount().address, ADDRESS);
    assert.equal(hasVault(), true);
    assert.ok(notified >= 1);

    assert.deepEqual([...data.keys()], [VAULT_STORAGE_KEY]);
    const stored = data.get(VAULT_STORAGE_KEY)!.toLowerCase();
    assert.equal(stored.includes("abandon"), false);
    assert.equal(stored.includes(secretFromPhrase(PHRASE).privateKey.slice(2)), false);
    assert.equal(JSON.parse(data.get(VAULT_STORAGE_KEY)!).eoaAddress, ADDRESS);
  });

  it("refuses to overwrite an existing vault", async () => {
    await createVault(secretFromPhrase(PHRASE), PASSWORD);
    const before = data.get(VAULT_STORAGE_KEY);
    const other = secretFromPrivateKey(`0x${"11".repeat(32)}`);
    await assert.rejects(createVault(other, PASSWORD), VaultExistsError);
    lock();
    await assert.rejects(createVault(other, PASSWORD), VaultExistsError);
    assert.equal(data.get(VAULT_STORAGE_KEY), before);
  });

  it("locks, rejects a wrong password, and unlocks with the right one", async () => {
    await createVault(secretFromPhrase(PHRASE), PASSWORD);
    lock();
    assert.deepEqual(getSnapshot(), { status: "locked", address: ADDRESS });
    assert.throws(() => getUnlockedAccount(), WalletLockedError);
    assert.equal(hasVault(), true);

    await assert.rejects(unlock("wrong password"), WrongPasswordError);
    assert.equal(getSnapshot().status, "locked");
    assert.throws(() => getUnlockedAccount(), WalletLockedError);

    await unlock(PASSWORD);
    assert.equal(getSnapshot().status, "unlocked");
    assert.equal(getUnlockedAccount().address, ADDRESS);
  });

  it("reads the vault after a reload as locked", async () => {
    await createVault(secretFromPhrase(PHRASE), PASSWORD);
    lock(); // a reload drops the in-memory session
    assert.deepEqual(syncFromStorage(), { status: "locked", address: ADDRESS });
  });

  it("re-checks the password before revealing the secret, even while unlocked", async () => {
    await createVault(secretFromPhrase(PHRASE), PASSWORD);
    await assert.rejects(revealSecret("wrong password"), WrongPasswordError);
    assert.deepEqual(await revealSecret(PASSWORD), secretFromPhrase(PHRASE));
    assert.equal(getSnapshot().status, "unlocked");
  });

  it("removes the vault and the session", async () => {
    await createVault(secretFromPhrase(PHRASE), PASSWORD);
    removeVault();
    assert.deepEqual(getSnapshot(), { status: "none", address: null });
    assert.equal(data.size, 0);
    assert.throws(() => getUnlockedAccount(), WalletLockedError);
    await assert.rejects(unlock(PASSWORD), NoVaultError);
    await assert.rejects(revealSecret(PASSWORD), NoVaultError);
    // A new wallet can be added afterwards.
    await createVault(secretFromPrivateKey(`0x${"11".repeat(32)}`), PASSWORD);
    assert.equal(getSnapshot().status, "unlocked");
  });

  it("locks when another tab removes or replaces the vault", async () => {
    await createVault(secretFromPhrase(PHRASE), PASSWORD);
    data.delete(VAULT_STORAGE_KEY);
    assert.deepEqual(syncFromStorage(), { status: "none", address: null });
    assert.throws(() => getUnlockedAccount(), WalletLockedError);
  });

  it("keeps a damaged record instead of treating it as 'no wallet'", async () => {
    data.set(VAULT_STORAGE_KEY, "{not json");
    assert.equal(syncFromStorage().status, "locked");
    assert.equal(hasVault(), true);
    await assert.rejects(unlock(PASSWORD), VaultFormatError);
    await assert.rejects(createVault(secretFromPhrase(PHRASE), PASSWORD), VaultExistsError);
    assert.equal(data.get(VAULT_STORAGE_KEY), "{not json");
  });

  it("auto-locks after 15 idle minutes, and activity postpones it", async (t) => {
    assert.equal(AUTO_LOCK_MS, 15 * 60 * 1000);
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    await createVault(secretFromPhrase(PHRASE), PASSWORD);

    t.mock.timers.tick(AUTO_LOCK_MS - 60_000);
    assert.equal(getSnapshot().status, "unlocked");
    touchActivity(); // user did something at minute 14
    t.mock.timers.tick(60_000);
    assert.equal(getSnapshot().status, "unlocked");
    t.mock.timers.tick(AUTO_LOCK_MS - 60_000 - 1);
    assert.equal(getSnapshot().status, "unlocked");
    t.mock.timers.tick(1);
    assert.equal(getSnapshot().status, "locked");
    assert.throws(() => getUnlockedAccount(), WalletLockedError);
    assert.equal(hasVault(), true);

    // lockIfIdle covers a tab whose timers were suspended.
    await unlock(PASSWORD);
    t.mock.timers.setTime(Date.now() + AUTO_LOCK_MS);
    lockIfIdle();
    assert.equal(getSnapshot().status, "locked");
  });
});
