# Threat model

**Scope:** Kura Web Client in modern browsers.  
**Out of scope:** Backend internals, vendor infra, L1/L2 consensus, Morpho/Safe/Dinari contract bugs (unless separately audited).

## Assets

| Asset | Where | Sensitivity |
|-------|-------|-------------|
| Wallet key / recovery phrase (no-backend mode) | Decrypted: page memory while unlocked. At rest: encrypted vault in `localStorage` | Critical |
| Vault password (no-backend mode) | The user's head; in page memory only while typed | Critical |
| Passkey material | OS authenticator + backend registration | Critical |
| TrackFi DEK (unlocked) | Browser memory | Critical |
| Encrypted finance snapshots | Backend | Medium–High |
| Session cookie | HttpOnly cookie | High |
| CEX API keys (encrypted at rest) | Backend; plaintext after unlock | Critical |
| Smart Wallet / Treasury control | Owner EOA (browser vault key, or Privy EOA in backend mode) + Safe owners | Critical |
| Dinari KYC / trading session | Backend + browser after auth | High |
| Publishable `NEXT_PUBLIC_*` keys | JS bundle | Medium (by design) |

## Adversaries

| Adversary | Example goal |
|-----------|--------------|
| XSS on app origin | Steal the unlocked wallet key, or DEK / session after unlock |
| Compromised site build or dependency | Ship code that exfiltrates the key or password on unlock |
| Someone with access to the device / browser profile | Copy the encrypted vault and guess the password offline |
| Malicious extension | Exfiltrate decrypted TrackFi or prompt phishing UserOps |
| Network MITM | Cookie theft (mitigated by HTTPS + HttpOnly) |
| Compromised SDK | Alter Privy / Reown / Plaid / TradingView flows |
| Compromised backend | Malicious ciphertext or Plaid / Dinari abuse |
| Phishing | Fake login / fake Approvals UX |
| Unauthorized copy of the client | Tampered bundle for key theft |

## Browser wallet (no-backend mode): what the password does and does not protect

- The key is **decrypted in the page while the wallet is unlocked**. A compromised site build, a malicious dependency, XSS on the app origin or a hostile browser extension can read it (or capture the password as it is typed) and take the funds. No client-side measure prevents this; it is the same exposure as any browser wallet served as a web page, without the isolation a browser-extension or hardware wallet has.
- The password only protects the **stored copy**. Someone who copies the vault from the browser profile must still guess the password (PBKDF2-HMAC-SHA256, 600 000 iterations → AES-256-GCM); a weak password can be guessed offline. Minimum length is 8 characters and there is no other strength check.
- **Nobody can reset the password or restore the key.** Losing the password *and* the recovery phrase (or private key) loses the funds for good.
- **Browser storage is not durable.** Clearing site data, a browser "clear on exit" setting, private windows, storage eviction or a new device removes the vault. The recovery phrase is the only backup.
- A wallet imported from a private key has no recovery phrase; the private key is its only backup.
- The app locks on reload, tab close, "Lock", and after 15 minutes without activity. Locking drops the key from the app's state; it cannot guarantee the JavaScript engine has wiped the memory.

## Client mitigations

| Threat | Mitigation |
|--------|------------|
| Theft of the stored wallet | Password-encrypted vault (PBKDF2 600k → AES-256-GCM, authenticated header); key never written to storage in clear |
| Key left unlocked | Memory-only session; auto-lock after 15 idle minutes; reveal / remove require the password again |
| Losing the only copy | Refuses to overwrite an existing vault; backup shown and acknowledged at creation; reveal in Settings → Security |
| JS session theft | HttpOnly cookie; no token in `localStorage` for Kura session |
| Silent finance read | E2EE until passkey unlock |
| Post-logout residue | Clear in-memory vault / stores |
| XSS blast radius | CSP in `proxy.ts` |
| Misconfigured auth | Feature gates on env (`app/config/env.ts`) |
| Accidental secret commit | `.gitignore`; rotation playbook in [deploy.md](deploy.md) |

## Residual risks (accepted)

- Hostile browser extensions after unlock
- Key theft through a compromised deployment, dependency or XSS while the browser wallet is unlocked
- Offline guessing of a weak vault password by someone who obtained the stored vault
- Loss of funds when the password and the backup are both lost, or the browser storage is cleared without a backup
- Supply-chain compromise of npm / Privy / Pimlico
- User approving malicious Safe txs in Approvals
- Protocol risk on Morpho / Base / Li.Fi / Dinari routes
- Backend compromise (TrackFi ciphertext + Plaid tokens + Dinari)

## Goals vs non-goals

| Goal | Non-goal |
|------|----------|
| Strong client-side E2EE for TrackFi after unlock | Zero-knowledge Plaid aggregation |
| Hardened CSP + cookie session (backend mode) | Hardware-wallet-grade key isolation in the browser wallet |
| Self-custody without any account (no-backend mode) | Password reset or key recovery by anyone but the user |
| Clear Smart Wallet vs Treasury separation | Making web a full mobile SCA substitute |
| Honest third-party inventory | Claiming “non-custodial banking” for Plaid |

## High-level data flows

```
Unlock (no backend): password → PBKDF2 → AES-GCM decrypt vault → key in memory → sign locally
Login (backend):     Privy → Kura exchange → HttpOnly cookie
TrackFi:   Passkey unlock → DEK → decrypt snapshots → UI
Treasury:  localStorage list (no backend) or backend hydrate → holdings via RPC / Morpho
Approvals: Sign Safe tx → Safe TX Service → execute on Base
Team:      Owner/threshold changes → on-chain Safe txs
Earn/Borrow (personal): Pimlico UserOps
Earn/Borrow (treasury): propose → Approvals
Stocks:    Dinari KYC + signed orders via Kura API
Card:      Waitlist email via Kura API
```
