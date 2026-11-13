# Trust model

## Principles

| Principle | Implication |
|-----------|-------------|
| **Clear boundaries** | Browser client vs Kura API vs third-party SaaS are separate. |
| **Two modes** | Default (no backend): no account, no Privy, the user's key is in a password-encrypted vault in their browser. Backend mode: Privy login + embedded wallet + Kura API features. |
| **Honest residual trust** | DeFi / auth / banking vendors cannot be eliminated by client code alone. |
| **E2EE for TrackFi** | Bank/CEX plaintext is intended to exist in browser memory only after passkey unlock. |
| **MIT source** | This client is MIT-licensed ([LICENSE](../LICENSE)); hosted API and vendor keys remain outside the repo. |

## In this repository

| Component | Note |
|-----------|------|
| Next.js UI and routing | Full product surface for web |
| Client crypto helpers | Passkey unlock + finance vault (backend mode) |
| Browser wallet | Key generation / import, password vault, local signing (`app/lib/localWallet`, no-backend mode) |
| API clients | Kura backend + public chain APIs |
| CSP policy | `proxy.ts` |
| Deploy workflow | GitHub Actions → GCR → Cloud Run (official repo only) |
| `.env.example` | Placeholders only |

## Outside this repository

| Component | Note |
|-----------|------|
| **Kura API** | Session, Treasuries DB, Plaid tokens, Stripe secrets, Dinari, ciphertext storage |
| **Privy** | Identity / embedded wallet infrastructure (backend mode only) |
| **Plaid** | Bank linking (tokens server-side) |
| **Pimlico** | ERC-4337 bundler / paymaster |
| **Dinari** | Tokenized stock broker / KYC |
| **Morpho / Safe / Li.Fi** | Protocol and infrastructure risk |
| **TradingView** | Chart content integrity |
| **Production secrets** | Never stored in git |

## Client security behaviours

No backend (default):

1. The key never leaves the browser. It is stored only as AES-256-GCM ciphertext under a key derived from the user's password (PBKDF2-HMAC-SHA256, 600 000 iterations).
2. The decrypted key exists only in page memory while unlocked; reload, closing the tab, "Lock" or 15 idle minutes drop it.
3. Revealing the recovery phrase / private key and removing the wallet ask for the password again.
4. No Privy, no backend, no account: nothing can reset the password or restore the key.

Backend mode:

1. Privy login → backend exchange → HttpOnly session cookie
2. TrackFi decrypt only after WebAuthn PRF unlock
3. Plaid Link via hosted UI; no Plaid secrets in the browser bundle
4. Explicit wallet / UserOp confirmation paths for on-chain actions
5. Logout clears in-memory finance keys
6. CSP restricts script and connect targets (including TradingView)

## Residual trust

| Party | What you still trust |
|-------|----------------------|
| Whoever serves this web app | The JavaScript you are served: it handles the decrypted key (no-backend mode) |
| Privy (backend mode) | Auth integrity and availability |
| Pimlico | UserOp inclusion / paymaster behaviour |
| Alchemy (or RPC) | Honest chain reads |
| Morpho API | Market / vault metadata integrity |
| Safe Transaction Service | Queue availability and authenticity of stored txs |
| Li.Fi | Quote / route integrity |
| Dinari | KYC, quotes, and settlement |
| TradingView | Chart feeds |
| Kura backend (backend mode) | Ciphertext storage, Plaid orchestration, no malicious payloads |
| End-user browser | No malware / hostile extensions after unlock; keeps (or loses) the stored vault |

## Dual-repo dependency

Privy login, full TrackFi, server-side Treasury persistence, billing, passkeys, and Dinari **require** a backend deployment. The web client alone is the on-chain wallet (Smart Wallet, Treasury, Approvals, Team, Earn / Borrow / Markets) with the key in the browser vault; it needs only a Base RPC and Pimlico.
