/**
 * Feature flags — one boolean per product area.
 *
 * The community edition talks to chain / public APIs directly and needs no
 * Kura backend and no Privy: the key lives in a password-encrypted vault in the
 * browser. Anything that depends on the backend (including the Privy login) is
 * gated here and turns back on when a self-hosted backend is configured via
 * NEXT_PUBLIC_BACKEND_URL.
 *
 * Gate UI and network calls on these flags instead of calling
 * `hasBackendUrl()` ad hoc.
 */

import { hasBackendUrl } from './env';

const backend = hasBackendUrl();

export const features = {
  /** A Kura backend is configured (session cookie, wallet record, treasury sync). */
  backend,
  /** TrackFi: Plaid banks / brokers, DeBank DeFi, CEX, asset history, tracked wallets (Reown). */
  trackFi: backend,
  /** Bridge.xyz fiat on/off-ramp — the "bank" paths in Add Money and Transfer. */
  fiatRamp: backend,
  /** Card waitlist. */
  card: backend,
  /** Dinari tokenized stocks. */
  stocks: backend,
  /** Stripe plans, membership gate, referral promo. */
  billing: backend,
  /** Passkey-unlocked E2EE data layer (unlock banner, passkey content of the Security page). */
  e2ee: backend,
  /** Backend-stored profile: edit display name, delete account. */
  accountProfile: backend,

  // On-chain features — always on (Privy + Base RPC / public APIs only).
  wallet: true,
  earn: true,
  borrow: true,
  markets: true,
  treasury: true,
} as const;

export type FeatureFlag = keyof typeof features;

/** Routes that only work when their feature is on (prefix match). */
const ROUTE_FEATURES: readonly (readonly [string, FeatureFlag])[] = [
  ['/dashboard/accounts', 'trackFi'],
  ['/dashboard/investment', 'trackFi'],
  ['/dashboard/transactions', 'trackFi'],
  ['/dashboard/defi-protocol', 'trackFi'],
  ['/dashboard/exchange', 'trackFi'],
  ['/dashboard/card', 'card'],
  ['/dashboard/rwa', 'stocks'],
  ['/dashboard/plan-billing', 'billing'],
  ['/settings/plan-billing', 'billing'],
];

/** False when `pathname` belongs to a feature that is currently off. */
export function isRouteEnabled(pathname: string): boolean {
  return ROUTE_FEATURES.every(
    ([route, flag]) =>
      features[flag] || !(pathname === route || pathname.startsWith(`${route}/`)),
  );
}
