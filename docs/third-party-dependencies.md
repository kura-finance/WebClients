# Third-party dependencies

## Connection classes

| Class | Examples | Config |
|-------|----------|--------|
| **Kura API** | Auth, Treasuries, Plaid, Stripe, passkeys, Dinari, waitlist | `NEXT_PUBLIC_BACKEND_URL` |
| **Keyed SaaS** | Privy, Reown, Pimlico, Alchemy, Li.Fi | `NEXT_PUBLIC_*` at **build** time |
| **Public protocol APIs** | Morpho GraphQL, Safe TX Service | CSP allowlist — no client secret |
| **Browser UX** | Plaid Link iframe, Privy modal, TradingView widgets | Hosted by vendor |

## Vendor matrix

| Vendor | Role | Client secret? | Failure impact |
|--------|------|----------------|----------------|
| **Privy** (backend mode only) | Login + embedded EOA | App ID (public) | Login / signing blocked |
| **Reown** | External wallet AppKit | Project ID (public) | External portfolio connect |
| **Pimlico** | ERC-4337 bundler / paymaster | API key | Smart Wallet UserOps fail |
| **Alchemy** (or RPC) | Base JSON-RPC | API key / URL | Reads / some writes degrade |
| **Li.Fi** | Swap / bridge quotes | Integrator + fee + optional key | Cross-chain / swap UX |
| **Morpho** | Vault and market metadata | None | Earn / Borrow lists empty |
| **Safe** | TX Service (Base) | None | Approvals queue unavailable |
| **Dinari** | Tokenized US stocks (dShares) | **Backend** | `/dashboard/rwa` unavailable |
| **TradingView** | Market / stock charts | None (widget) | Charts empty; CSP must allow |
| **Plaid** | Bank link | **Backend only** | TrackFi banks |
| **Stripe** | Subscriptions | Price IDs in web; secrets on API | Billing UI |
| **CoinGecko / logo.dev** | Prices / icons | Optional | Cosmetic / pricing display |

## Li.Fi fee

`NEXT_PUBLIC_LIFI_FEE` is Li.Fi’s integrator fee as a **fraction of 1**.  
Hosted production pins **`0.25` (25%)** in the deploy workflow. Set your own share when self-hosting. See `.env.example` and [deploy.md](deploy.md).

## Feature → dependency map

| Feature | Must have |
|---------|-----------|
| Sign-in (no backend) | Nothing external — browser wallet vault |
| Login (backend mode) | Privy + Kura API |
| TrackFi | Kura API + Plaid (backend) + passkey |
| Treasuries persistence | Kura API (`/api/treasuries`) |
| Approvals / Team | Owner EOA (browser wallet, or Privy in backend mode) + Safe TX Service + Base |
| Smart Wallet Transfer / Earn / Borrow / Markets | Pimlico + Base RPC (+ Li.Fi for swap/bridge) |
| Earn / Borrow catalogs | Morpho GraphQL |
| Tokenized stocks | Kura API (`/api/dinari`) + KYC |
| Card waitlist | Kura API (`/api/waitlist`) |
| Charts | TradingView (CSP in `proxy.ts`) |

## Data processing (high level)

| Data | Processed by |
|------|----------------|
| Email / social identity | Privy |
| Session | Kura API |
| Bank credentials | Plaid (Link); tokens on Kura API |
| TrackFi plaintext | Browser after unlock only (design intent) |
| On-chain balances / txs | Public Base network + indexers |
| Stock KYC / orders | Dinari via Kura API |
| Card / billing PII | Stripe + Kura API (as configured) |
| Chart market data | TradingView |

Map this to your DPA / subprocessors schedule before a production deployment.
