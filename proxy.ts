import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { env, hasBackendUrl } from './app/config/env';

function resolvePublicOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  if (forwardedHost && !forwardedHost.startsWith('0.0.0.0')) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = request.headers.get('host');
  if (host && !host.startsWith('0.0.0.0') && !host.startsWith('127.0.0.1')) {
    const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
      || request.nextUrl.protocol.replace(':', '')
      || 'https';
    return `${proto}://${host}`;
  }

  if (env.appUrl && !env.appUrl.includes('0.0.0.0')) {
    return env.appUrl;
  }

  return request.nextUrl.origin;
}

export function proxy(request: NextRequest) {
  const response = NextResponse.next();

  // Prefer public Host / X-Forwarded-* over Cloud Run's bind address (0.0.0.0:8080).
  const requestOrigin = resolvePublicOrigin(request);

  const appDomain = env.appUrl || requestOrigin;

  // Community edition (no backend): no Privy, Plaid, Reown or Kura API, so their
  // hosts stay out of the policy. They are only allowed in backend mode.
  const backend = hasBackendUrl();
  const backendOrigin = (() => {
    try {
      return backend ? new URL(env.backendUrl).origin : '';
    } catch {
      return '';
    }
  })();

  // Privy auth, WalletConnect verify, and Turnstile CAPTCHA (see docs.privy.io CSP guide)
  const privyFrameSources = backend
    ? [
        'https://auth.privy.io',
        'https://verify.walletconnect.com',
        'https://verify.walletconnect.org',
        'https://challenges.cloudflare.com',
      ].join(' ')
    : '';
  const plaidSources = backend ? ['https://cdn.plaid.com', 'https://*.plaid.com'] : [];

  // TradingView free widgets (script → iframe). No API key required.
  // Hosts: s3 (loader), s. / www.tradingview-widget.com (embed iframe).
  const tradingViewFrameSources = [
    'https://s3.tradingview.com',
    'https://s.tradingview.com',
    'https://static.tradingview.com',
    'https://*.tradingview.com',
    'https://www.tradingview.com',
    'https://tradingview.com',
    'https://tradingview-widget.com',
    'https://www.tradingview-widget.com',
    'https://*.tradingview-widget.com',
  ].join(' ');

  // Define CSP sources
  const connectSources = [
    "'self'",
    requestOrigin,
    appDomain,
    ...(backend
      ? [
          // Kura backend (NEXT_PUBLIC_API_URL, plus the rewrite target itself)
          env.apiUrl,
          backendOrigin,
          ...plaidSources,
          // Privy
          'https://auth.privy.io',
          'https://*.privy.io',
          'https://*.rpc.privy.systems',
          'wss://*.rpc.privy.systems',
          // Reown / WalletConnect (TrackFi wallet tracking)
          'wss://relay.reown.com',
          'wss://*.reown.com',
          'wss://relay.walletconnect.com',
          'wss://relay.walletconnect.org',
          'wss://www.walletlink.org',
          'https://api.reown.org',
          'https://api.web3modal.org',
          'https://explorer-api.walletconnect.com',
          'https://*.walletconnect.org',
          'https://*.walletconnect.com',
          // Coinbase Wallet SDK (bundled with Privy)
          'https://cca-lite.coinbase.com',
          'https://static.cloudflareinsights.com', // Cloudflare Insights
        ]
      : []),
    'https://*.coingecko.com',
    'https://api.coingecko.com',
    // Base RPC (Home / Portfolio balances, Safe owners, recent transfer logs)
    'https://mainnet.base.org',
    'https://*.base.org',
    'https://base-rpc.publicnode.com',
    'https://base.drpc.org',
    'https://*.g.alchemy.com',
    'https://api.morpho.org',
    'https://li.quest',
    'https://*.li.quest',
    // Safe Transaction Service (transfer history, Treasury Approvals, import owned Safes)
    'https://api.safe.global',
    'https://*.safe.global',
    'https://s3.tradingview.com',
    'https://s.tradingview.com',
    'https://static.tradingview.com',
    'https://*.tradingview.com',
    'https://www.tradingview.com',
    'https://tradingview-widget.com',
    'https://www.tradingview-widget.com',
    'https://*.tradingview-widget.com',
    'wss://*.tradingview.com',
    'wss://*.tradingview-widget.com',
    'https://api.pimlico.io',
    'https://*.pimlico.io',
    ...(env.baseRpcUrl
      ? (() => {
          try {
            return [new URL(env.baseRpcUrl).origin];
          } catch {
            return [] as string[];
          }
        })()
      : []),
    ...(env.isDevelopment ? ['ws://localhost', 'ws://127.0.0.1'] : []), // Allow WebSocket for dev HMR
  ].filter(Boolean).join(' ');

  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    "'wasm-unsafe-eval'", // libsodium-wasm crypto
    ...(env.isDevelopment ? ["'unsafe-eval'"] : []), // Allow eval() for React dev mode debugging
    requestOrigin,
    appDomain,
    ...(backend
      ? [
          ...plaidSources,
          'https://challenges.cloudflare.com', // Turnstile (Privy login)
          'https://static.cloudflareinsights.com', // Cloudflare Insights
        ]
      : []),
    'https://s3.tradingview.com',
    'https://s.tradingview.com',
    'https://static.tradingview.com',
    'https://*.tradingview.com',
    'https://www.tradingview.com',
    'https://tradingview-widget.com',
    'https://www.tradingview-widget.com',
    'https://*.tradingview-widget.com',
  ].join(' ');

  const cspValue = `
    default-src 'self';
    script-src ${scriptSources};
    connect-src ${connectSources};
    img-src 'self' data: https: blob:;
    font-src 'self' data: https: https://fonts.reown.com;
    style-src 'self' 'unsafe-inline';
    frame-src 'self' ${plaidSources.join(' ')} ${tradingViewFrameSources} ${privyFrameSources};
    child-src 'self' ${tradingViewFrameSources} ${privyFrameSources};
    worker-src 'self' blob:;
    frame-ancestors 'self';
  `.replace(/\s+/g, ' ').trim();

  // Enforce CSP. Do not mirror as Report-Only: frame-ancestors is ignored there and
  // without report-to the browser treats Report-Only as a no-op / noise.
  response.headers.set('Content-Security-Policy', cspValue);
  response.headers.delete('Content-Security-Policy-Report-Only');

  // Allow cross-origin resource sharing for scripts
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
