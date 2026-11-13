# Kura Web Client

Next.js dashboard for [app.kura-finance.com](https://app.kura-finance.com): personal Smart Wallet, organization Treasuries, TrackFi, and on-chain Earn / Borrow / Markets on Base.

| | |
|---|---|
| **License** | [MIT](LICENSE) — Copyright (c) 2026 Rick Weng |
| **Deploy** | [docs/deploy.md](docs/deploy.md) |
| **Security** | [SECURITY.md](SECURITY.md) — **security@kura-finance.com** |

The hosted **API** and **mobile wallet** are separate products. This repository is the browser app only.

The backend is **optional**. With `NEXT_PUBLIC_BACKEND_URL` empty (the default) the app is a self-custodial, on-chain wallet with no account, no backend and no Privy: you create or import a key in the browser (12-word recovery phrase or private key), it is stored in a password-encrypted vault in that browser, and the app only talks to Base RPC / public APIs. The same recovery phrase gives the same wallet in the mobile app. Pointing the build at a self-hosted backend switches to Privy login and turns the backend features back on — see [docs/product-overview.md](docs/product-overview.md) and [docs/threat-model.md](docs/threat-model.md).

---

## What it does

- Personal **Smart Wallet** on Base (Transfer, Add Money)
- Organization **Treasury** Safes (multi-owner cash + holdings)
- **Approvals** (propose → sign → execute Safe transactions)
- **Team** (Safe owners / threshold) and **Report** (treasury activity)
- **Earn / Borrow** (Morpho on Base)
- **Markets** (spot crypto / Li.Fi) with TradingView charts

Only with a backend configured (hidden otherwise):

- **Tokenized stocks** (Dinari dShares on Base, via the Kura API)
- **Card** waitlist (metal / virtual)
- **TrackFi** — Bank (Plaid), Broker, DeFi (DeBank), CEX — via the Kura backend and passkey E2EE
- **Bank transfers** in Add Money / Transfer (Bridge)
- **Billing** (Stripe subscription UI)

---

## Quick start

```bash
npm install
cp .env.example .env.local
# Leave NEXT_PUBLIC_BACKEND_URL empty for the on-chain-only app (no other key is required to start)
npm run dev
```

Nothing is required to open the app and create a wallet. Sending from the Smart Wallet needs Pimlico, and a Base RPC is recommended. A backend URL, a Privy app ID and a Reown project ID are only needed for backend mode. Full list and production Cloud Run steps: **[docs/deploy.md](docs/deploy.md)**.

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

---

## Docs

| Document | Contents |
|----------|----------|
| [docs/deploy.md](docs/deploy.md) | Local, Docker, GitHub Actions, Cloud Run, secrets |
| [docs/product-overview.md](docs/product-overview.md) | Capability matrix |
| [docs/architecture.md](docs/architecture.md) | System design and route map |
| [docs/trust-model.md](docs/trust-model.md) | Trust boundaries |
| [docs/threat-model.md](docs/threat-model.md) | Threat model |
| [docs/third-party-dependencies.md](docs/third-party-dependencies.md) | Vendor matrix |
| [docs/README.md](docs/README.md) | Doc index |

---

## Related systems

| System | Role |
|--------|------|
| **backendserver** | API (`api.kura-finance.com`), optional — auth, Treasuries sync, TrackFi, Stripe, passkeys, Dinari |
| **mobile-app** | React Native wallet (iOS / Android) |

Security reports: **security@kura-finance.com**
