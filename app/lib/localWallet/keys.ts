/**
 * Local wallet — key helpers (no backend, no Privy).
 *
 * The Safe owner is an EOA whose key is created or imported in this browser.
 * Same rules as the mobile app, so one recovery phrase gives the same EOA (and
 * therefore the same Safe) on both: 12-word BIP-39 phrase, first BIP-44
 * Ethereum account.
 *
 * Pure module: no React, no storage, relative imports only — it runs as-is
 * under `node --test`.
 */

import { bytesToHex, sha256 } from "viem";
import {
  english,
  generateMnemonic,
  mnemonicToAccount,
  privateKeyToAccount,
} from "viem/accounts";

/** BIP-44 path of the first Ethereum account (MetaMask, hardware wallets, mobile app). */
export const BIP44_ETH_PATH = "m/44'/60'/0'/0/0";

type Hex = `0x${string}`;

/** What the vault protects. `privateKey` is always the Safe owner key. */
export type WalletSecret =
  | { kind: "mnemonic"; phrase: string; privateKey: Hex }
  | { kind: "privateKey"; privateKey: Hex };

/** Input that is not a usable recovery phrase / private key. Never carries the input. */
export class InvalidSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSecretError";
  }
}

const PHRASE_WORD_COUNTS = [12, 15, 18, 21, 24];

/** Trim, lowercase, single spaces — tolerant of pasted phrases. */
export function normalizePhrase(input: string): string {
  return input.trim().toLowerCase().split(/\s+/).join(" ");
}

/**
 * BIP-39 check (English word list): known words, valid length, valid checksum.
 * `phrase` must already be normalised.
 */
export function isValidPhrase(phrase: string): boolean {
  const words = phrase.split(" ");
  if (!PHRASE_WORD_COUNTS.includes(words.length)) return false;

  // 11 bits per word → entropy followed by its checksum.
  const bits: number[] = [];
  for (const word of words) {
    const index = english.indexOf(word);
    if (index === -1) return false;
    for (let bit = 10; bit >= 0; bit--) bits.push((index >> bit) & 1);
  }

  const checksumBits = bits.length / 33;
  const entropyBits = bits.length - checksumBits;
  const entropy = new Uint8Array(entropyBits / 8);
  for (let i = 0; i < entropyBits; i++) {
    entropy[i >> 3] |= bits[i] << (7 - (i & 7));
  }

  const hash = sha256(entropy, "bytes");
  for (let i = 0; i < checksumBits; i++) {
    const expected = (hash[i >> 3] >> (7 - (i & 7))) & 1;
    if (bits[entropyBits + i] !== expected) return false;
  }
  return true;
}

/** New 12-word recovery phrase (128 bits from crypto.getRandomValues). */
export function generatePhrase(): string {
  return generateMnemonic(english);
}

/** Recovery phrase → secret (first account, m/44'/60'/0'/0/0). */
export function secretFromPhrase(input: string): WalletSecret {
  const phrase = normalizePhrase(input);
  if (!isValidPhrase(phrase)) {
    throw new InvalidSecretError(
      "Invalid recovery phrase — check every word and its order, then try again.",
    );
  }
  const key = mnemonicToAccount(phrase).getHdKey().privateKey;
  if (!key) throw new InvalidSecretError("Could not derive a key from this recovery phrase.");
  return { kind: "mnemonic", phrase, privateKey: bytesToHex(key) };
}

/** Raw private key (64 hex characters, optional 0x) → secret. */
export function secretFromPrivateKey(input: string): WalletSecret {
  const hex = input.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new InvalidSecretError("A private key is 64 hexadecimal characters.");
  }
  const privateKey: Hex = `0x${hex}`;
  try {
    privateKeyToAccount(privateKey);
  } catch {
    throw new InvalidSecretError("This is not a valid private key.");
  }
  return { kind: "privateKey", privateKey };
}

/** Signing account for a secret. */
export function accountFromSecret(secret: WalletSecret) {
  return privateKeyToAccount(secret.privateKey);
}

/** Checksummed EOA address — the Safe owner. */
export function addressFromSecret(secret: WalletSecret): Hex {
  return accountFromSecret(secret).address;
}
