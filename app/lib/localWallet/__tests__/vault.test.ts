import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { secretFromPhrase, secretFromPrivateKey } from "../keys.ts";
import {
  VAULT_ITERATIONS,
  VaultFormatError,
  WeakPasswordError,
  WrongPasswordError,
  decryptVault,
  encryptVault,
  type VaultRecord,
} from "../vault.ts";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const PASSWORD = "correct horse battery";

/** Flip one bit of a base64 field, keeping its length. */
function flip(base64: string): string {
  const bytes = Buffer.from(base64, "base64");
  bytes[0] ^= 0x01;
  return bytes.toString("base64");
}

describe("vault", () => {
  it("round-trips a recovery phrase", async () => {
    const secret = secretFromPhrase(PHRASE);
    const record = await encryptVault(secret, PASSWORD);
    assert.deepEqual(await decryptVault(record, PASSWORD), secret);
    // ...and survives JSON (what localStorage holds).
    assert.deepEqual(await decryptVault(JSON.parse(JSON.stringify(record)), PASSWORD), secret);
  });

  it("round-trips a raw private key", async () => {
    const secret = secretFromPrivateKey(secretFromPhrase(PHRASE).privateKey);
    const record = await encryptVault(secret, PASSWORD);
    assert.deepEqual(await decryptVault(record, PASSWORD), secret);
  });

  it("writes the documented record format", async () => {
    const record = await encryptVault(secretFromPhrase(PHRASE), PASSWORD);
    assert.deepEqual(Object.keys(record).sort(), [
      "ciphertext",
      "eoaAddress",
      "iterations",
      "iv",
      "kdf",
      "salt",
      "v",
    ]);
    assert.equal(record.v, 1);
    assert.equal(record.kdf, "PBKDF2-SHA256");
    assert.equal(record.iterations, 600_000);
    assert.equal(record.iterations, VAULT_ITERATIONS);
    assert.equal(Buffer.from(record.salt, "base64").length, 16);
    assert.equal(Buffer.from(record.iv, "base64").length, 12);
    assert.equal(record.eoaAddress, ADDRESS);
  });

  it("fails cleanly on a wrong password", async () => {
    const record = await encryptVault(secretFromPhrase(PHRASE), PASSWORD);
    await assert.rejects(decryptVault(record, "correct horse batterY"), (error: unknown) => {
      assert.ok(error instanceof WrongPasswordError);
      assert.equal(error.message, "Wrong password.");
      return true;
    });
  });

  it("uses the password exactly as typed (no trimming, no truncation)", async () => {
    const spaced = "  spaced password  ";
    const record = await encryptVault(secretFromPhrase(PHRASE), spaced);
    await assert.rejects(decryptVault(record, spaced.trim()), WrongPasswordError);
    await assert.rejects(decryptVault(record, spaced.trimEnd()), WrongPasswordError);
    assert.equal((await decryptVault(record, spaced)).kind, "mnemonic");

    const long = "x".repeat(300);
    const longRecord = await encryptVault(secretFromPhrase(PHRASE), `${long}a`);
    await assert.rejects(decryptVault(longRecord, `${long}b`), WrongPasswordError);
    await assert.rejects(decryptVault(longRecord, long), WrongPasswordError);
  });

  it("rejects passwords shorter than 8 characters", async () => {
    await assert.rejects(encryptVault(secretFromPhrase(PHRASE), "1234567"), WeakPasswordError);
    await assert.rejects(encryptVault(secretFromPhrase(PHRASE), ""), WeakPasswordError);
    assert.equal((await encryptVault(secretFromPhrase(PHRASE), "12345678")).v, 1);
  });

  it("fails when the ciphertext, iv or salt is altered", async () => {
    const record = await encryptVault(secretFromPhrase(PHRASE), PASSWORD);
    for (const field of ["ciphertext", "iv", "salt"] as const) {
      const tampered: VaultRecord = { ...record, [field]: flip(record[field]) };
      await assert.rejects(decryptVault(tampered, PASSWORD), WrongPasswordError, field);
    }
    // Truncated ciphertext (tag cut off).
    const cut = Buffer.from(record.ciphertext, "base64").subarray(0, -1).toString("base64");
    await assert.rejects(decryptVault({ ...record, ciphertext: cut }, PASSWORD), WrongPasswordError);
  });

  it("fails when the iteration count is altered", async () => {
    const record = await encryptVault(secretFromPhrase(PHRASE), PASSWORD);
    // In range: the header is authenticated, so the right password no longer works.
    await assert.rejects(
      decryptVault({ ...record, iterations: record.iterations + 1 }, PASSWORD),
      WrongPasswordError,
    );
    // Out of range: refused before any key derivation (no trivial or endless unlock).
    for (const iterations of [0, 1, 1000, 599_999, 10_000_001, 2 ** 31, 600_000.5, NaN]) {
      await assert.rejects(decryptVault({ ...record, iterations }, PASSWORD), VaultFormatError);
    }
    await assert.rejects(decryptVault({ ...record, iterations: "600000" }, PASSWORD), VaultFormatError);
  });

  it("rejects unknown versions, KDFs and malformed records", async () => {
    const record = await encryptVault(secretFromPhrase(PHRASE), PASSWORD);
    for (const bad of [
      null,
      "not a record",
      {},
      { ...record, v: 2 },
      { ...record, kdf: "scrypt" },
      { ...record, kdf: "PBKDF2-SHA1" },
      { ...record, salt: "" },
      { ...record, iv: Buffer.alloc(16).toString("base64") },
      { ...record, salt: "***" },
      { ...record, ciphertext: Buffer.alloc(16).toString("base64") },
      { ...record, eoaAddress: "0x1234" },
    ]) {
      await assert.rejects(decryptVault(bad, PASSWORD), VaultFormatError);
    }
  });

  it("refuses a record whose clear-text address was swapped", async () => {
    const record = await encryptVault(secretFromPhrase(PHRASE), PASSWORD);
    const swapped = { ...record, eoaAddress: "0x000000000000000000000000000000000000dEaD" };
    await assert.rejects(decryptVault(swapped, PASSWORD), VaultFormatError);
  });

  it("uses a fresh salt and iv for every encryption", async () => {
    const secret = secretFromPhrase(PHRASE);
    const a = await encryptVault(secret, PASSWORD);
    const b = await encryptVault(secret, PASSWORD);
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.ciphertext, b.ciphertext);
    assert.deepEqual(await decryptVault(a, PASSWORD), await decryptVault(b, PASSWORD));
  });

  it("stores neither the phrase nor the private key in clear", async () => {
    const secret = secretFromPhrase(
      "legal winner thank year wave sausage worth useful legal winner thank yellow",
    );
    const stored = JSON.stringify(await encryptVault(secret, PASSWORD));
    const lower = stored.toLowerCase();
    assert.equal(secret.kind, "mnemonic");
    for (const word of new Set(secret.kind === "mnemonic" ? secret.phrase.split(" ") : [])) {
      assert.equal(lower.includes(word), false, word);
    }
    assert.equal(lower.includes(secret.privateKey.slice(2)), false);
    assert.equal(stored.includes(PASSWORD), false);
    // Not merely base64 of the plaintext either.
    const decoded = Buffer.from(JSON.parse(stored).ciphertext, "base64").toString("latin1");
    assert.equal(decoded.includes("winner"), false);
    assert.equal(decoded.includes(secret.privateKey.slice(2)), false);

    const keyOnly = JSON.stringify(
      await encryptVault(secretFromPrivateKey(secret.privateKey), PASSWORD),
    );
    assert.equal(keyOnly.toLowerCase().includes(secret.privateKey.slice(2)), false);
  });
});
