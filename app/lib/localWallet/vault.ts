/**
 * Local wallet — password-encrypted vault (the MetaMask model).
 *
 * The secret is encrypted with a key derived from the user's password and only
 * the encrypted record is stored. WebCrypto only:
 *
 *   password ──PBKDF2-HMAC-SHA256, 600 000 iterations, 16-byte random salt──▶ AES-256-GCM key
 *   secret   ──AES-256-GCM, 12-byte random IV, header as additional data────▶ ciphertext
 *
 * A fresh salt and IV are drawn for every encryption. The header (version, KDF
 * name, iteration count) is authenticated, so a stored record cannot be
 * downgraded without the decryption failing.
 *
 * Pure module: relative imports only, runs as-is under `node --test`.
 */

import {
  addressFromSecret,
  secretFromPhrase,
  secretFromPrivateKey,
  type WalletSecret,
} from "./keys.ts";

export const VAULT_VERSION = 1;
export const VAULT_KDF = "PBKDF2-SHA256";
export const VAULT_ITERATIONS = 600_000;
/** Bounds accepted when reading a record: never weaker than what we write, never absurdly slow. */
export const VAULT_MIN_ITERATIONS = VAULT_ITERATIONS;
export const VAULT_MAX_ITERATIONS = 10_000_000;
export const MIN_PASSWORD_LENGTH = 8;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

/** What is written to storage. Everything but `eoaAddress` is opaque. */
export interface VaultRecord {
  v: typeof VAULT_VERSION;
  kdf: typeof VAULT_KDF;
  iterations: number;
  /** base64, 16 bytes */
  salt: string;
  /** base64, 12 bytes */
  iv: string;
  /** base64, AES-256-GCM ciphertext + tag */
  ciphertext: string;
  /** In clear, so the unlock screen can say which wallet this is. */
  eoaAddress: string;
}

export class WrongPasswordError extends Error {
  constructor() {
    super("Wrong password.");
    this.name = "WrongPasswordError";
  }
}

export class WeakPasswordError extends Error {
  constructor() {
    super(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
    this.name = "WeakPasswordError";
  }
}

/** The stored record is missing, malformed, or from an unknown format. */
export class VaultFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultFormatError";
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new VaultFormatError("Saved wallet data is damaged.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** WebCrypto, which browsers only expose on HTTPS (or localhost). */
function subtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Encryption is unavailable: open this app over HTTPS (or on localhost).");
  }
  return subtle;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

/** Authenticated header: version, KDF and iteration count. */
function additionalData(iterations: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`kura-wallet-vault|v${VAULT_VERSION}|${VAULT_KDF}|${iterations}`);
}

/**
 * The password is used exactly as typed — no trimming, no truncation. It is
 * only Unicode-normalised (NFKD, as BIP-39 does) so the same characters typed
 * on another keyboard or OS still unlock the vault.
 */
async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  const subtle = subtleCrypto();
  const material = await subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKD")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false, // non-extractable
    [usage],
  );
}

/** Throws WeakPasswordError when the password is too short. */
export function assertPasswordStrength(password: string): void {
  if (Array.from(password).length < MIN_PASSWORD_LENGTH) throw new WeakPasswordError();
}

/** Validate the shape of a stored record before any key derivation. */
export function parseVaultRecord(value: unknown): VaultRecord {
  if (!value || typeof value !== "object") {
    throw new VaultFormatError("Saved wallet data is damaged.");
  }
  const record = value as Record<string, unknown>;
  if (record.v !== VAULT_VERSION || record.kdf !== VAULT_KDF) {
    throw new VaultFormatError("Saved wallet uses a format this version cannot read.");
  }
  const { iterations, salt, iv, ciphertext, eoaAddress } = record;
  if (
    typeof iterations !== "number" ||
    !Number.isInteger(iterations) ||
    iterations < VAULT_MIN_ITERATIONS ||
    iterations > VAULT_MAX_ITERATIONS
  ) {
    throw new VaultFormatError("Saved wallet data is damaged (key settings out of range).");
  }
  if (
    typeof salt !== "string" ||
    typeof iv !== "string" ||
    typeof ciphertext !== "string" ||
    typeof eoaAddress !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(eoaAddress) ||
    fromBase64(salt).length !== SALT_BYTES ||
    fromBase64(iv).length !== IV_BYTES ||
    fromBase64(ciphertext).length <= GCM_TAG_BYTES
  ) {
    throw new VaultFormatError("Saved wallet data is damaged.");
  }
  return { v: VAULT_VERSION, kdf: VAULT_KDF, iterations, salt, iv, ciphertext, eoaAddress };
}

/** Encrypt a secret under a password. New salt and IV every time. */
export async function encryptVault(secret: WalletSecret, password: string): Promise<VaultRecord> {
  assertPasswordStrength(password);

  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(password, salt, VAULT_ITERATIONS, "encrypt");

  const plaintext =
    secret.kind === "mnemonic"
      ? { kind: secret.kind, phrase: secret.phrase, privateKey: secret.privateKey }
      : { kind: secret.kind, privateKey: secret.privateKey };

  const ciphertext = await subtleCrypto().encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(VAULT_ITERATIONS) },
    key,
    new TextEncoder().encode(JSON.stringify(plaintext)),
  );

  return {
    v: VAULT_VERSION,
    kdf: VAULT_KDF,
    iterations: VAULT_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    eoaAddress: addressFromSecret(secret),
  };
}

/**
 * Decrypt a stored record. Throws WrongPasswordError when the password (or the
 * record's salt / IV / ciphertext / header) does not check out, and
 * VaultFormatError when the record itself is unusable.
 */
export async function decryptVault(value: unknown, password: string): Promise<WalletSecret> {
  const record = parseVaultRecord(value);
  const key = await deriveKey(password, fromBase64(record.salt), record.iterations, "decrypt");

  let plaintext: ArrayBuffer;
  try {
    plaintext = await subtleCrypto().decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(record.iv),
        additionalData: additionalData(record.iterations),
      },
      key,
      fromBase64(record.ciphertext),
    );
  } catch {
    // AES-GCM authentication failed: wrong password or altered record.
    throw new WrongPasswordError();
  }

  let secret: WalletSecret;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as {
      kind?: unknown;
      phrase?: unknown;
      privateKey?: unknown;
    };
    if (typeof parsed.privateKey !== "string") throw new Error("missing key");
    if (parsed.kind === "mnemonic") {
      if (typeof parsed.phrase !== "string") throw new Error("missing phrase");
      secret = secretFromPhrase(parsed.phrase);
      if (secret.privateKey !== parsed.privateKey.toLowerCase()) throw new Error("key mismatch");
    } else if (parsed.kind === "privateKey") {
      secret = secretFromPrivateKey(parsed.privateKey);
    } else {
      throw new Error("unknown kind");
    }
  } catch {
    throw new VaultFormatError("Saved wallet data is damaged.");
  }

  if (addressFromSecret(secret).toLowerCase() !== record.eoaAddress.toLowerCase()) {
    throw new VaultFormatError("Saved wallet data does not match its address.");
  }
  return secret;
}
