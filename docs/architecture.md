# Architecture

## Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js (App Router), React 19 |
| Key / sign-in | Browser wallet vault (no backend) · Privy (backend mode) |
| State | Zustand |
| On-chain (Base) | viem, permissionless / Pimlico, Safe |
| DeFi data | Morpho GraphQL |
| Multisig queue | Safe Transaction Service (Base) |
| Swaps / bridge | Li.Fi |
| Tokenized stocks | Dinari (via Kura API) |
| Charts | TradingView widgets |
| TrackFi | Plaid Link + backend E2EE snapshots |
| Billing | Stripe (server-created sessions) |
| Deploy | Docker standalone → Google Cloud Run |

## Logical architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser — Kura Web Client                                   │
│  layout / providers → dashboard routes → domain components   │
│  Zustand stores · app/lib API clients · app/lib/crypto       │
│  proxy.ts (CSP + security headers)                           │
└───────────────┬────────────────────────────┬─────────────────┘
                │                            │
                ▼                            ▼
     Kura API (backendserver)      Public / SaaS endpoints
     auth · treasuries · plaid     Privy · Morpho · Safe TX
     stripe · passkeys · dinari    Pimlico · Li.Fi · Alchemy
     waitlist                      TradingView
```

The Kura API (left branch) is **optional**. `app/config/features.ts` derives one flag per product area from `NEXT_PUBLIC_BACKEND_URL`. When it is empty the client only uses the right branch, without Privy: an unlocked browser wallet is the app session (no account, token exchange or membership check), the personal Safe address is derived locally from that wallet's EOA (`app/lib/personalSafe.ts`), the Treasury list lives in localStorage, and backend-only routes and UI are hidden (`FeatureRouteGuard` redirects direct visits to `/dashboard`).

### Key custody: the signer

Every component that signs goes through `app/lib/signer` (`useSignerWallet()` → `{ address, getEthereumProvider() }`, `useSignerSession()`). The implementation is chosen once from the build-time flag:

| Mode | Signer | Session |
|------|--------|---------|
| No backend (default) | `app/lib/localWallet` — key generated (12-word BIP-39, `m/44'/60'/0'/0/0`, same as mobile) or imported in the browser, stored encrypted, decrypted into memory on unlock; a local EIP-1193 provider signs with it and forwards reads to the Base RPC | `LocalWalletBridge`: authenticated ⇔ vault unlocked |
| Backend | Privy embedded EOA (`<PrivyProvider>`) | `PrivyAuthBridge`: Privy token → Kura session cookie |

Vault record (`localStorage["kura-wallet-vault-v1"]`): `{ v: 1, kdf: "PBKDF2-SHA256", iterations: 600000, salt, iv, ciphertext, eoaAddress }` — PBKDF2-HMAC-SHA256 (600 000 iterations, 16-byte salt) → AES-256-GCM (12-byte IV, header as additional data), WebCrypto only. The decrypted key is held in memory only; reload, closing the tab, "Lock" or 15 idle minutes drop it. In this mode `<PrivyProvider>` is not mounted and no Privy host is contacted. See [threat-model.md](threat-model.md).

## Route map

| Area | Primary routes |
|------|----------------|
| Home / cash | `/dashboard` |
| Transfer / Add Money | `/dashboard/payment`, `/dashboard/add-money` |
| Card waitlist | `/dashboard/card` |
| Portfolio | `/dashboard/crypto` |
| Treasury | `/dashboard/treasury` |
| Approvals | `/dashboard/approvals` |
| Team | `/dashboard/team` |
| Report | `/dashboard/report` |
| Earn | `/dashboard/earn`, `/dashboard/earn/[address]` |
| Borrow | `/dashboard/borrow`, `/dashboard/borrow/[marketId]` |
| Markets | `/dashboard/markets`, `/dashboard/markets/[symbol]` |
| Tokenized stocks | `/dashboard/rwa`, `/dashboard/rwa/[symbol]` |
| TrackFi Bank | `/dashboard/accounts` |
| TrackFi Broker | `/dashboard/investment` |
| TrackFi DeFi | `/dashboard/defi-protocol` |
| CEX | `/dashboard/exchange` |
| Wallet history | `/dashboard/history`, `/dashboard/transactions` |
| Billing | `/dashboard/plan-billing`, `/settings/plan-billing` |
| Settings | `/settings/profile`, `/settings/security` |

## Backend domain alignment

Same API family as mobile; used only when a backend is configured. Representative modules:

| Backend domain | Client module | Purpose |
|----------------|---------------|---------|
| `auth` | `app/lib/authApi.ts` | Privy exchange, session, passkey |
| `treasuries` | `app/lib/treasuryApi.ts`, `treasurySync.ts` | Org Safe persistence |
| `plaid` | `app/lib/plaidApi.ts` | Link + encrypted snapshots |
| `exchange` | `useExchangeStore.ts` | CEX credentials (encrypted) |
| `debank` | `app/lib/debankApi.ts` | DeFi portfolio proxy |
| `asset` | `app/lib/assetApi.ts` | Aggregated history |
| `dinari` | `app/lib/dinariApi.ts` | Tokenized stock KYC / orders |
| `waitlist` | `app/lib/waitlistApi.ts` | Card waitlists |
| `stripe` | `app/lib/stripeApi.ts` | Checkout / portal |

HTTP: cookie session (`credentials: 'include'`), envelope `{ success, data, error }` via `httpClient.ts`.  
Production: Next rewrites `/api/*` → backend (`next.config.ts`).

## On-chain execution paths

| Path | Mechanism | Code anchors |
|------|-----------|--------------|
| Smart Wallet UserOp | Pimlico bundler / paymaster | `app/lib/smartAccountSend.ts` |
| Treasury propose | Sign + Safe TX Service | `app/lib/proposeTreasuryCalls.ts`, `safeTxService.ts` |
| Morpho Earn | ERC-4626 (+ fee wrapper map) | `app/lib/morphoEarn.ts`, `morphoApi.ts` |
| Morpho Borrow | Morpho Blue | `app/lib/morphoBlue.ts` |
| Shared submit | Smart execute **or** Treasury propose | `app/lib/submitTradingCalls.ts` |
| Dinari | Backend + signed typed data | `app/lib/dinariApi.ts` |

## Security-relevant client layers

| Concern | Location |
|---------|----------|
| Env centralization | `app/config/env.ts` |
| CSP / headers | `proxy.ts` |
| Passkey + finance vault | `app/lib/crypto/` |
| Session bootstrap | `SignerProvider` → `LocalWalletBridge` (no backend) or `PrivyAuthBridge` (backend), `AppSessionHydrator` |
| Browser wallet vault | `app/lib/localWallet/` (`npm test`) |
| Signer abstraction | `app/lib/signer/` |

## Repository layout

```
app/                 App Router, components, lib, store, config
proxy.ts             CSP (Next.js proxy)
Dockerfile           Standalone Node server (port 8080)
.github/workflows/   ci.yml (lint) · deploy.yml (Cloud Run, official repo only)
docs/                Operator and architecture guides
.env.example         Placeholder config only (no secrets)
```

How to ship: [deploy.md](deploy.md).
