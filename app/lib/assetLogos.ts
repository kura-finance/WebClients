/**
 * Asset / ticker logos (same as mobile): logo.dev when a key is set, otherwise
 * the keyless table in tokenLogos.ts for crypto. Stocks and company domains
 * have no keyless source and fall back to a glyph.
 */

import { env } from "@/config/env";
import { tokenLogoUrl } from "@/lib/tokenLogos";

function logoDevToken(): string {
  return env.logodevToken;
}

/** US equity ticker logo — `img.logo.dev/ticker/{SYMBOL}`. */
export function stockLogoUrl(symbol: string, size = 64): string | null {
  const token = logoDevToken();
  const ticker = symbol.trim().toUpperCase();
  if (!token || !ticker) return null;
  return (
    `https://img.logo.dev/ticker/${encodeURIComponent(ticker)}` +
    `?token=${encodeURIComponent(token)}&size=${size}&format=png`
  );
}

/**
 * Crypto symbol logo — `img.logo.dev/crypto/{symbol}` with a key, else the
 * keyless table (null for symbols it does not list).
 */
export function cryptoLogoUrl(symbol: string, size = 128): string | null {
  const token = logoDevToken();
  if (!symbol) return null;
  if (!token) return tokenLogoUrl(symbol);
  return (
    `https://img.logo.dev/crypto/${encodeURIComponent(symbol.trim().toLowerCase())}` +
    `?token=${encodeURIComponent(token)}&size=${size}&format=png`
  );
}

/** Company logo by domain — `img.logo.dev/{domain}`. */
export function domainLogoUrl(domain: string, size = 64): string | null {
  const token = logoDevToken();
  if (!token || !domain) return null;
  const host = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!host) return null;
  return (
    `https://img.logo.dev/${encodeURIComponent(host)}` +
    `?token=${encodeURIComponent(token)}&size=${size}&format=png`
  );
}

export function stockGlyph(symbol: string): string {
  return (symbol || "?").slice(0, 2).toUpperCase();
}
