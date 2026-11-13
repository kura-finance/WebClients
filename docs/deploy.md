# Deploy the Kura Web Client

This is the operator guide for running the web dashboard locally and in production. Hosted production is **`app.kura-finance.com`**. The same image can be pointed at your own API, Privy app, and Cloud Run service.

The web client is a **Next.js standalone** Node server (port **8080** in Docker). There is no local `scripts/` deploy helper — production shipping is Docker + CI.

Related: [environment template](../.env.example) · [architecture](architecture.md) · [third parties](third-party-dependencies.md)

---

## Prerequisites

| Need | Notes |
|------|--------|
| Node.js **24** | Matches the production Dockerfile |
| npm | `npm ci --legacy-peer-deps` in Docker |
| A **backend** (`backendserver`) — optional | Treasuries sync, TrackFi, bank transfers, Stripe, passkeys, Dinari |
| Privy app — backend mode only | Login + embedded EOA |
| Reown project — backend mode only | External wallet connect (TrackFi) |
| GCP project (production) | Artifact Registry / GCR + Cloud Run |

Full TrackFi, server-side Treasuries persistence, bank transfers, billing, passkeys, and tokenized stocks require a correctly configured backend. With `NEXT_PUBLIC_BACKEND_URL` empty the app runs with a Base RPC and Pimlico alone — no Privy, no account: the user's key lives in a password-encrypted vault in their browser. Available: Smart Wallet, Treasury (browser-local list), Approvals, Team, Report, Earn, Borrow, Markets. Serve it over HTTPS (WebCrypto needs a secure context) and treat the deployed bundle as part of the wallet: whoever can change it can take users' keys.

---

## Local development

```bash
npm install
cp .env.example .env.local   # fill your keys
npm run dev
```

App origin defaults to `http://localhost:3000`. Leave `NEXT_PUBLIC_BACKEND_URL` empty for the on-chain-only app, or point it at a running API (example: `http://localhost:8080`) to enable the backend features.

Checks:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Standalone smoke (same mode as Cloud Run):

```bash
npm run build && npm run start:standalone
```

Static export (CDN) is optional: `npm run build:static` (`BUILD_MODE=export`). Production uses **standalone**.

---

## Environment variables

All client reads go through `app/config/env.ts`. **`NEXT_PUBLIC_*` is inlined at `next build`**. Changing Cloud Run runtime env does **not** change the browser bundle — rebuild and redeploy.

Publishable keys are visible to every user of that build. Treat leaks as rotation events.

### Minimum to boot login

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_BACKEND_URL` | Kura API (no trailing slash). Optional — empty disables backend features |
| `NEXT_PUBLIC_APP_URL` | Web origin (CORS, CSP, WebAuthn, Privy) |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Login — backend mode only (unused without a backend) |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | Reown AppKit — backend mode only |

### On-chain product

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_PIMLICO_API_KEY` | Smart Wallet UserOps (Transfer, Earn, Borrow, Markets) |
| `NEXT_PUBLIC_ALCHEMY_API_KEY` or `NEXT_PUBLIC_BASE_RPC_URL` | Base RPC (public `mainnet.base.org` rate-limits) |
| `NEXT_PUBLIC_PAY_GAS_IN_USDC` | Pay UserOp gas in USDC (`true` by default) |
| `NEXT_PUBLIC_LIFI_INTEGRATOR` | Li.Fi integrator id |
| `NEXT_PUBLIC_LIFI_FEE` | Integrator fee as a **fraction of 1** (hosted prod uses `0.25`) |
| `NEXT_PUBLIC_LIFI_API_KEY` | Optional |

### Optional UI / billing

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | CSP `connect-src` API origin (defaults to `https://api.kura-finance.com`) |
| `NEXT_PUBLIC_LOGODEV_TOKEN` | Ticker icons |
| `NEXT_PUBLIC_STRIPE_PRICE_*` | Plan price IDs shown in billing UI |

Backend-only secrets (Plaid, Stripe secret keys, DB, JWT) never belong in this repo.

### What is safe in git

| Path | Allowed |
|------|---------|
| `.env.example` | Yes — placeholders only |
| `docs/` | Yes — no live secrets |
| `.env` / `.env.local` | **No** |
| Service account JSON | **No** |

---

## Docker

```bash
docker build \
  --build-arg NEXT_PUBLIC_BACKEND_URL="https://api.example.com" \
  --build-arg NEXT_PUBLIC_APP_URL="https://app.example.com" \
  --build-arg NEXT_PUBLIC_PRIVY_APP_ID="..." \
  --build-arg NEXT_PUBLIC_REOWN_PROJECT_ID="..." \
  --build-arg NEXT_PUBLIC_PIMLICO_API_KEY="..." \
  -t kura-web:local \
  -f ./Dockerfile \
  .
```

Pass every `NEXT_PUBLIC_*` you need as `--build-arg` (see the Dockerfile `ARG` list). The image listens on **8080**, runs as standalone Node, and includes an HTTP healthcheck on `/`.

---

## Production: GitHub Actions → Cloud Run

Kura production topology:

```
Push to main on Kura-Finance/WebClients
  → .github/workflows/deploy.yml
  → docker build (NEXT_PUBLIC_* build-args from GitHub secrets)
  → Google Container Registry
  → Cloud Run service `app` (port 8080, us-central1)
```

The deploy workflow **does not run on forks**. It only runs when `github.repository` is `Kura-Finance/WebClients`. To deploy your own copy, set the same GitHub secrets on your repo and either change that `if:` guard or run the workflow via `workflow_dispatch` after updating the repository check.

### GitHub secrets

| Secret | Purpose |
|--------|---------|
| `GCP_PROJECT_ID` | GCP project (prefer the **Variable** `GCP_PROJECT_ID`; the Secret is a legacy fallback) |
| `GCP_SERVICE_ACCOUNT_KEY` | Deploy auth (JSON) |
| `NEXT_PUBLIC_BACKEND_URL` | API origin baked into the bundle |
| `NEXT_PUBLIC_APP_URL` | Web origin |
| `NEXT_PUBLIC_API_URL` | CSP API origin |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | Reown |
| `NEXT_PUBLIC_ALCHEMY_API_KEY` | Base RPC |
| `NEXT_PUBLIC_BASE_RPC_URL` | Optional explicit RPC URL |
| `NEXT_PUBLIC_LOGODEV_TOKEN` | Optional icons |
| `NEXT_PUBLIC_PIMLICO_API_KEY` | Smart Wallet |
| `NEXT_PUBLIC_PAY_GAS_IN_USDC` | Optional |
| `NEXT_PUBLIC_LIFI_API_KEY` | Optional |
| `NEXT_PUBLIC_STRIPE_PRICE_*` | Optional billing UI |

`GCP_REGION` is a GitHub **Variable** (default `us-central1`). Moving the service to another GCP project only needs `GCP_PROJECT_ID`, `GCP_REGION` and `GCP_SERVICE_ACCOUNT_KEY` updated — the backup/rebuild scripts live in `BackendServer/infra/gcp-migration/`.

Hosted production also pins Li.Fi integrator `kura` and fee `0.25` in the workflow. Override those build-args if you are not Kura.

PR / push **CI** (lint + typecheck) lives in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) and does not deploy.

### Cloud Run shape (hosted)

| Setting | Value |
|---------|--------|
| Service | `app` |
| Region | `us-central1` |
| Port | `8080` |
| Memory / CPU | 512Mi / 1 |
| Timeout | 900s |
| Ingress | `--allow-unauthenticated` (TLS on Cloud Run) |

---

## After deploy

- [ ] HTTPS
- [ ] Backend CORS allows `NEXT_PUBLIC_APP_URL`
- [ ] WebAuthn / passkey RP ID lists this origin
- [ ] Privy and Reown allowlists include the production domain
- [ ] Treasuries API live and membership-gated
- [ ] Pimlico key present — smoke a Smart Wallet send or Earn deposit
- [ ] CSP allows API, Morpho, Safe TX Service (Base), TradingView (Markets / stocks)
- [ ] Approvals: propose → co-sign → execute
- [ ] (Optional) Dinari KYC / tokenized stock path against the backend

---

## Failure modes

| Symptom | Likely cause |
|---------|----------------|
| Login works locally, not prod | Wrong Privy App ID at build, or origin not allowlisted |
| `/api/*` 404 | Wrong `NEXT_PUBLIC_BACKEND_URL` at build |
| Smart Wallet actions fail | Missing Pimlico build-arg |
| Morpho empty | Network / CSP to `api.morpho.org` |
| Approvals stuck | Safe undeployed / EOA not owner / TX Service blocked |
| Stale env in prod | Runtime env changed without rebuild |
| Fork Actions “skipped” | Deploy is restricted to `Kura-Finance/WebClients` |

---

## Key rotation

If a key may have leaked (chat, CI log, old image):

1. Rotate at the vendor console (Privy, Pimlico, Alchemy, Li.Fi, Reown, GCP, Stripe prices if recreated).
2. Rotate backend secrets via backend ops.
3. Update GitHub Actions secrets.
4. Rebuild and redeploy the web image.
5. Retire old Cloud Run revisions that embedded the old public keys.
6. Confirm Privy / Reown domain allowlists.

Any `NEXT_PUBLIC_*` value that shipped in a public web build is world-readable. Plan rotation after a domain or operator cutover.
