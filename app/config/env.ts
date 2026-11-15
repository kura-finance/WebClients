/**
 * Centralised environment configuration for the web client.
 *
 * All NEXT_PUBLIC_* variables should be read here (or via helpers exported
 * from this module). See docs/deploy.md and docs/third-party-dependencies.md.
 */

function trimEnv(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * NEXT_PUBLIC_* must be read via static `process.env.NEXT_PUBLIC_*` access so
 * Next.js can inline them into the client bundle at build time. Dynamic
 * `process.env[key]` lookups are not replaced and stay empty in the browser.
 */
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isDevelopment: process.env.NODE_ENV === 'development',

  backendUrl: trimEnv(process.env.NEXT_PUBLIC_BACKEND_URL),
  appUrl: trimEnv(process.env.NEXT_PUBLIC_APP_URL) || 'http://localhost:3000',
  apiUrl: trimEnv(process.env.NEXT_PUBLIC_API_URL) || 'https://api.kura-finance.com',

  privyAppId: trimEnv(process.env.NEXT_PUBLIC_PRIVY_APP_ID),
  reownProjectId: trimEnv(process.env.NEXT_PUBLIC_REOWN_PROJECT_ID),
  alchemyApiKey: trimEnv(process.env.NEXT_PUBLIC_ALCHEMY_API_KEY),
  baseRpcUrl: trimEnv(process.env.NEXT_PUBLIC_BASE_RPC_URL),
  /** logo.dev publishable key (pk_…) — stock / crypto ticker icons */
  logodevToken: trimEnv(process.env.NEXT_PUBLIC_LOGODEV_TOKEN),
  /** Pimlico bundler/paymaster — Safe UserOps on Base */
  pimlicoApiKey: trimEnv(process.env.NEXT_PUBLIC_PIMLICO_API_KEY),
  /** When true, SCA gas is paid in USDC (matches mobile default). */
  payGasInUsdc: (() => {
    const raw = trimEnv(process.env.NEXT_PUBLIC_PAY_GAS_IN_USDC).toLowerCase();
    if (raw === "false" || raw === "0") return false;
    return true;
  })(),
  /** Li.FI integrator id (optional fee share) */
  lifiIntegrator: trimEnv(process.env.NEXT_PUBLIC_LIFI_INTEGRATOR),
  lifiFee: trimEnv(process.env.NEXT_PUBLIC_LIFI_FEE),
  lifiApiKey: trimEnv(process.env.NEXT_PUBLIC_LIFI_API_KEY),

  stripePrices: {
    proMonthly: trimEnv(process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_MONTHLY),
    proYearly: trimEnv(process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_YEARLY),
    ultimateMonthly: trimEnv(process.env.NEXT_PUBLIC_STRIPE_PRICE_ULTIMATE_MONTHLY),
    ultimateYearly: trimEnv(process.env.NEXT_PUBLIC_STRIPE_PRICE_ULTIMATE_YEARLY),
  },
};

/** Resolved Kura backend base URL (no trailing slash), or empty when unset. */
export function getBackendBaseUrl(): string {
  const url = env.backendUrl;
  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_BACKEND_URL environment variable is not set. ' +
        'Please configure it in your environment or .env.local file.',
    );
  }
  return url.replace(/\/+$/, '');
}

export function hasBackendUrl(): boolean {
  return env.backendUrl.length > 0;
}

export const isPrivyConfigured = env.privyAppId.length > 0;

export function isPimlicoConfigured(): boolean {
  return env.pimlicoApiKey.length > 0;
}

/**
 * True when Smart Wallet gas is paid in USDC (Pimlico ERC-20 paymaster — needs
 * the API key). Otherwise UserOps use Pimlico's public bundler and the Safe pays
 * gas in ETH.
 */
export function paysGasInUsdc(): boolean {
  return isPimlicoConfigured() && env.payGasInUsdc;
}

export function isReownConfigured(): boolean {
  return env.reownProjectId.length > 0;
}
