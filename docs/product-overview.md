# Product overview

The Kura Web Client is a **Next.js** finance dashboard that combines:

1. **On-chain treasury and DeFi** on Base (Smart Wallet, Treasury Safes, Morpho Earn/Borrow, Markets, Dinari stocks)
2. **TrackFi** aggregation (banks, brokerages, CEX, DeFi) via the Kura backend with passkey E2EE
3. **Membership billing** via Stripe
4. **Card** waitlists (metal / virtual) — waitlist only in this client

Hosted production: **`app.kura-finance.com`**. How to run and ship: [deploy.md](deploy.md).

The backend is optional. With `NEXT_PUBLIC_BACKEND_URL` empty (the default) only group 1 minus Dinari stocks is available. There is no account and no Privy: the Safe owner key is created or imported in the browser and kept in a password-encrypted vault there. The client talks to Base RPC and public APIs only, never calls a backend, and hides every backend-only surface (direct visits redirect to `/dashboard`). Setting the variable to a self-hosted backend switches to Privy login and restores the rest. Flags live in `app/config/features.ts`.

## Capability matrix

| Capability | User surface | Execution model | Backend required? |
|------------|--------------|-----------------|-------------------|
| Sign-in | `/` | No backend: create / import a wallet, then unlock it with its password (locks on reload and after 15 idle minutes). Backend: Privy email / social, session cookie after exchange + membership check | No |
| Wallet backup | `/settings/security` | No backend: reveal recovery phrase / private key, remove the wallet from the browser (password required) | No (no-backend mode only) |
| Profile | `/settings/profile` | No backend: local display name, EOA and Safe addresses. Backend: account profile, edit name, delete account | No (account profile: **Yes**) |
| Passkey E2EE unlock | Settings / finance unlock | WebAuthn PRF → in-memory DEK | **Yes** |
| Personal Smart Wallet | Home, Transfer, Add Money | Owner EOA (browser vault, or Privy with a backend) + Safe + **Pimlico** UserOps; Safe address derived locally without a backend | No (bank transfers via Bridge: **Yes**) |
| Org Treasury | `/dashboard/treasury` | Counterfactual / deployed Safe; holdings | No — list kept in browser localStorage (server sync: **Yes**) |
| Approvals | `/dashboard/approvals` | Safe Transaction Service propose → sign → execute | No* (*owners on-chain) |
| Team | `/dashboard/team` | Add/remove Safe owners, change threshold | No (on-chain; labels in localStorage) |
| Report | `/dashboard/report` | Treasury activity (Blockscout) and CSV export | No (bank cash-flow card: **Yes**) |
| Earn | `/dashboard/earn/[vault]` | Morpho vault deposit/withdraw | No* (*Pimlico if Smart Wallet) |
| Borrow | `/dashboard/borrow/[market]` | Morpho Blue borrow/repay | No* (*Pimlico if Smart Wallet) |
| Markets | `/dashboard/markets/[symbol]` | Li.Fi swap on Base; TradingView | No* (*Pimlico) |
| Tokenized stocks | `/dashboard/rwa`, `/dashboard/rwa/[symbol]` | Dinari dShares on Base | **Yes** (Dinari + KYC) |
| Card | `/dashboard/card` | Waitlist (metal / virtual) | **Yes** (waitlist API) |
| TrackFi banks | `/dashboard/accounts` | Plaid + encrypted snapshots | **Yes** |
| TrackFi brokers | `/dashboard/investment` | Encrypted snapshots | **Yes** |
| TrackFi DeFi | `/dashboard/defi-protocol` | DeBank proxy | **Yes** |
| CEX connections | `/dashboard/exchange` | Encrypted API keys on server | **Yes** |
| Portfolio | `/dashboard/crypto` | Smart Wallet holdings (Base RPC, CoinGecko, Morpho) | No |
| Billing | Plan / billing | Stripe Checkout / portal | **Yes** |

\* Treasury Morpho / Markets actions from an org Safe **propose** into Approvals instead of immediate UserOps.

## Product boundaries

| Included in web client | Not included / separate |
|------------------------|-------------------------|
| UI, routing, client crypto helpers | Backend business logic and DB |
| Smart Wallet and Treasury UX | Mobile SCA / deep wallet features |
| Morpho / Li.Fi / Safe TX Service calls from the browser | Smart-contract audits of Morpho / Safe / Dinari |
| TrackFi presentation after decrypt | Plaid token custody (backend) |
| Stripe price ID display and redirect | Stripe secret keys (backend) |
| Card waitlist UI | Card issuing / processor |
| Dinari KYC and order UX | Dinari custody / broker backend |

## Dual account model

| Account | Salt / role | Typical use |
|---------|-------------|-------------|
| **Personal Smart Wallet** | Distinct Safe (personal) | Everyday Transfer, Earn, Borrow, Markets, stocks |
| **Treasury Safe(s)** | Org Safe(s), multi-owner | Company cash, Approvals, Team |

Personal Smart Wallet ≠ Treasury. Fiat KYC (including Dinari) attaches to the personal / ops path, not to Treasury cash itself.

## License and packaging

- This web client is **MIT** licensed, Copyright (c) 2026 **Rick Weng** ([LICENSE](../LICENSE)).
- Security reports: **security@kura-finance.com**.
- This repo alone runs the on-chain wallet (browser key vault, no Privy). Privy login, TrackFi, server-side Treasuries persistence, bank transfers, billing, passkey E2EE, the card waitlist and Dinari need a **backendserver** deployment.
