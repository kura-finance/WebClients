import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { english } from "viem/accounts";
import {
  InvalidSecretError,
  addressFromSecret,
  generatePhrase,
  isValidPhrase,
  normalizePhrase,
  secretFromPhrase,
  secretFromPrivateKey,
} from "../keys.ts";

// BIP-39 reference vector: all-zero 128-bit entropy.
const ZERO_PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
// Widely published first account (m/44'/60'/0'/0/0) for that phrase.
const ZERO_PHRASE_ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
// secp256k1 group order n — the first value that is NOT a valid private key.
const CURVE_ORDER = "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141";

describe("recovery phrase", () => {
  it("derives the standard first Ethereum account for the BIP-39 reference vector", () => {
    const secret = secretFromPhrase(ZERO_PHRASE);
    assert.equal(secret.kind, "mnemonic");
    assert.equal(addressFromSecret(secret), ZERO_PHRASE_ADDRESS);
    assert.match(secret.privateKey, /^0x[0-9a-f]{64}$/);
  });

  it("tolerates extra whitespace and capitals", () => {
    const messy = `  ${ZERO_PHRASE.toUpperCase().replace(/ /g, " \t ")}\n`;
    assert.equal(normalizePhrase(messy), ZERO_PHRASE);
    assert.deepEqual(secretFromPhrase(messy), secretFromPhrase(ZERO_PHRASE));
  });

  it("accepts the other BIP-39 reference vectors (12, 18 and 24 words)", () => {
    for (const phrase of [
      "legal winner thank year wave sausage worth useful legal winner thank yellow",
      "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
      "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong",
      `${"abandon ".repeat(17)}agent`,
      `${"abandon ".repeat(23)}art`,
    ]) {
      assert.equal(isValidPhrase(phrase), true, phrase);
    }
  });

  it("rejects a bad checksum, unknown words and wrong lengths", () => {
    for (const phrase of [
      ZERO_PHRASE.replace(/about$/, "abandon"), // bad checksum
      ZERO_PHRASE.replace(/about$/, "abouts"), // not in the word list
      ZERO_PHRASE.split(" ").slice(1).join(" "), // 11 words
      `${ZERO_PHRASE} abandon`, // 13 words
      "",
    ]) {
      assert.equal(isValidPhrase(phrase), false, phrase);
      assert.throws(() => secretFromPhrase(phrase), InvalidSecretError);
    }
  });

  it("does not echo the input in the error", () => {
    const typo = ZERO_PHRASE.replace(/about$/, "abandon");
    assert.throws(
      () => secretFromPhrase(typo),
      (error: Error) => !error.message.includes("abandon"),
    );
  });

  it("generates 12 valid words, different every time", () => {
    const phrases = Array.from({ length: 20 }, () => generatePhrase());
    for (const phrase of phrases) {
      const words = phrase.split(" ");
      assert.equal(words.length, 12);
      assert.ok(words.every((word) => english.includes(word)));
      assert.equal(isValidPhrase(phrase), true);
      assert.equal(secretFromPhrase(phrase).kind, "mnemonic");
    }
    assert.equal(new Set(phrases).size, phrases.length);
  });

  it("agrees with the reference BIP-39 implementation (@scure/bip39) when it is installed", async (t) => {
    // Shipped as a dependency of viem; resolved dynamically so the app itself does not rely on it.
    const load = (name: string) => import(name).catch(() => null);
    const bip39 = await load("@scure/bip39");
    const words = await load("@scure/bip39/wordlists/english");
    if (!bip39 || !words) return t.skip("@scure/bip39 not resolvable");

    const samples: string[] = [];
    for (let i = 0; i < 100; i++) {
      const good = generatePhrase();
      const parts = good.split(" ");
      // Same words with the last one swapped: almost always a checksum failure.
      const swapped = [...parts.slice(0, 11), english[(english.indexOf(parts[11]) + 1 + i) % 2048]];
      samples.push(good, swapped.join(" "));
    }
    for (const phrase of samples) {
      assert.equal(isValidPhrase(phrase), bip39.validateMnemonic(phrase, words.wordlist), phrase);
    }
  });
});

describe("private key", () => {
  const key = secretFromPhrase(ZERO_PHRASE).privateKey.slice(2);

  it("accepts hex with or without 0x, in any case, and gives the same account", () => {
    const expected = { kind: "privateKey", privateKey: `0x${key}` };
    assert.deepEqual(secretFromPrivateKey(key), expected);
    assert.deepEqual(secretFromPrivateKey(`0x${key.toUpperCase()}`), expected);
    assert.deepEqual(secretFromPrivateKey(`  0X${key}\n`), expected);
    assert.equal(addressFromSecret(secretFromPrivateKey(key)), ZERO_PHRASE_ADDRESS);
  });

  it("rejects the wrong length, non-hex input, zero and out-of-range keys", () => {
    for (const bad of [
      "",
      key.slice(2), // 62 characters
      `${key}00`, // 66 characters
      `${key.slice(0, 63)}g`, // not hex
      `0x0x${key.slice(4)}`,
      "0".repeat(64), // zero
      CURVE_ORDER, // = n
      "f".repeat(64), // > n
    ]) {
      assert.throws(() => secretFromPrivateKey(bad), InvalidSecretError, bad);
    }
  });

  it("accepts the largest valid key (n - 1)", () => {
    const max = `${CURVE_ORDER.slice(0, 63)}0`;
    assert.equal(secretFromPrivateKey(max).privateKey, `0x${max}`);
  });

  it("does not echo the input in the error", () => {
    assert.throws(
      () => secretFromPrivateKey(key.slice(2)),
      (error: Error) => !error.message.includes(key.slice(2, 20)),
    );
  });
});
