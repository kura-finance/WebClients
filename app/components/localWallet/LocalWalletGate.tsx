"use client";

/**
 * Entry screen without a backend: no account, no sign-up.
 *
 *   no wallet saved  → create a new wallet / import one, then set a password
 *   wallet saved     → enter the password to unlock
 *
 * Once unlocked, LocalWalletBridge marks the session authenticated and the root
 * page redirects to /dashboard.
 */

import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addressFromSecret,
  generatePhrase,
  secretFromPhrase,
  secretFromPrivateKey,
  type WalletSecret,
} from "@/lib/localWallet/keys";
import { createVault, removeVault, unlock } from "@/lib/localWallet/store";
import { useLocalWallet } from "@/lib/signer/local";
import {
  FieldLabel,
  FormError,
  PasswordSetupForm,
  PhraseGrid,
  SECRET_FIELD_CLASS,
  SECRET_INPUT_PROPS,
  errorText,
  shortAddress,
} from "./fields";

export default function LocalWalletGate() {
  const { status, address } = useLocalWallet();
  if (status === "none") return <Onboarding />;
  if (status === "locked") return <UnlockForm address={address} />;
  return null; // unknown (not read yet) or unlocked (redirecting)
}

/* ───────────────────────────── Onboarding ───────────────────────────── */

type OnboardingStep =
  | { name: "choose" }
  | { name: "backup"; phrase: string }
  | { name: "import" }
  | { name: "password"; secret: WalletSecret; from: "backup" | "import"; phrase?: string };

function Onboarding() {
  const [step, setStep] = useState<OnboardingStep>({ name: "choose" });

  if (step.name === "choose") {
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-[var(--kura-text-secondary)]">
          Kura is a self-custodial wallet. There is no account: your key is created in this browser
          and stays here, encrypted with a password only you know.
        </p>
        <Button
          type="button"
          className="h-11 w-full rounded-xl"
          onClick={() => setStep({ name: "backup", phrase: generatePhrase() })}
        >
          Create new wallet
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full rounded-xl"
          onClick={() => setStep({ name: "import" })}
        >
          I already have a wallet
        </Button>
      </div>
    );
  }

  if (step.name === "backup") {
    return (
      <BackupPhrase
        phrase={step.phrase}
        onBack={() => setStep({ name: "choose" })}
        onContinue={() =>
          setStep({
            name: "password",
            secret: secretFromPhrase(step.phrase),
            from: "backup",
            phrase: step.phrase,
          })
        }
      />
    );
  }

  if (step.name === "import") {
    return (
      <ImportWallet
        onBack={() => setStep({ name: "choose" })}
        onContinue={(secret) => setStep({ name: "password", secret, from: "import" })}
      />
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-[var(--kura-text)]">Set a password</h2>
      <p className="font-mono text-xs text-[var(--kura-text-secondary)]">
        Wallet {shortAddress(addressFromSecret(step.secret))}
      </p>
      <PasswordSetupForm
        submitLabel={step.from === "backup" ? "Create wallet" : "Import wallet"}
        busyLabel="Encrypting…"
        onSubmit={(password) => createVault(step.secret, password)}
        onBack={() =>
          setStep(
            step.from === "backup" && step.phrase
              ? { name: "backup", phrase: step.phrase }
              : { name: "import" },
          )
        }
      />
    </div>
  );
}

function BackupPhrase({
  phrase,
  onBack,
  onContinue,
}: {
  phrase: string;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-[var(--kura-text)]">Your recovery phrase</h2>
      <p className="text-sm leading-relaxed text-[var(--kura-text-secondary)]">
        Write these 12 words down, in order, and keep them somewhere safe and offline.
      </p>
      <PhraseGrid phrase={phrase} />
      <Alert variant="warning">
        <AlertDescription>
          This phrase is the only backup of your wallet. Nobody — not Kura, not anyone else — can
          restore it for you. Anyone who sees it can take your funds, so never share it or type it
          into another website.
        </AlertDescription>
      </Alert>
      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-[var(--kura-text)]">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span>I have written it down</span>
      </label>
      <div className="flex gap-3">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="button" className="flex-1" disabled={!confirmed} onClick={onContinue}>
          Continue
        </Button>
      </div>
    </div>
  );
}

function ImportWallet({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: (secret: WalletSecret) => void;
}) {
  const [tab, setTab] = useState<"phrase" | "privateKey">("phrase");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const switchTab = (next: "phrase" | "privateKey") => {
    setTab(next);
    setValue("");
    setError(null);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    try {
      onContinue(tab === "phrase" ? secretFromPhrase(value) : secretFromPrivateKey(value));
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-base font-semibold text-[var(--kura-text)]">Import a wallet</h2>
      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-lg bg-[var(--kura-bg-light)] p-1">
        {(
          [
            ["phrase", "Recovery phrase"],
            ["privateKey", "Private key"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => switchTab(id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === id
                ? "bg-[var(--kura-surface)] text-[var(--kura-text)] shadow-sm"
                : "text-[var(--kura-text-secondary)] hover:text-[var(--kura-text)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "phrase" ? (
        <div>
          <FieldLabel htmlFor="import-phrase">Recovery phrase</FieldLabel>
          <textarea
            id="import-phrase"
            rows={3}
            {...SECRET_INPUT_PROPS}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="12 words separated by spaces"
            className={SECRET_FIELD_CLASS}
          />
          <p className="mt-1.5 text-xs text-[var(--kura-text-secondary)]">
            The same phrase gives the same wallet here and in the Kura mobile app.
          </p>
        </div>
      ) : (
        <div>
          <FieldLabel htmlFor="import-private-key">Private key</FieldLabel>
          <Input
            id="import-private-key"
            type="text"
            {...SECRET_INPUT_PROPS}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="64 hexadecimal characters"
            className="font-mono"
          />
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--kura-text-secondary)]">
            Used the hosted Kura app before? Export your private key at{" "}
            <a
              href="https://home.privy.io"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--kura-primary)] hover:underline"
            >
              home.privy.io
            </a>{" "}
            and paste it here to get the same wallet address.
          </p>
        </div>
      )}

      <FormError message={error} />
      <div className="flex gap-3">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" className="flex-1" disabled={!value.trim()}>
          Continue
        </Button>
      </div>
    </form>
  );
}

/* ─────────────────────────────── Unlock ─────────────────────────────── */

function UnlockForm({ address }: { address: string | null }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [removeConfirmed, setRemoveConfirmed] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !password) return;
    setError(null);
    setBusy(true);
    try {
      await unlock(password);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm leading-relaxed text-[var(--kura-text-secondary)]">
          Enter your password to unlock{" "}
          {address ? (
            <span className="font-mono text-[var(--kura-text)]" data-testid="vault-address">
              {shortAddress(address)}
            </span>
          ) : (
            "your wallet"
          )}
          .
        </p>
        <div>
          <FieldLabel htmlFor="unlock-password">Password</FieldLabel>
          <Input
            id="unlock-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <FormError message={error} />
        <Button type="submit" className="h-11 w-full rounded-xl" disabled={busy || !password}>
          {busy ? "Unlocking…" : "Unlock"}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => setForgot((open) => !open)}
        className="text-xs font-medium text-[var(--kura-text-secondary)] hover:text-[var(--kura-text)]"
      >
        Forgot password?
      </button>

      {forgot ? (
        <div className="space-y-3 rounded-xl border border-[var(--kura-error-border)] bg-[var(--kura-error-bg)] p-4">
          <p className="text-xs leading-relaxed text-[var(--kura-error-fg)]">
            The password cannot be reset. If you still have your recovery phrase or private key, you
            can remove this wallet from the browser and import it again with a new password. Without
            that backup the wallet and its funds are lost for good.
          </p>
          <label className="flex cursor-pointer items-start gap-2.5 text-xs text-[var(--kura-error-fg)]">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={removeConfirmed}
              onChange={(e) => setRemoveConfirmed(e.target.checked)}
            />
            <span>I have my recovery phrase or private key</span>
          </label>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={!removeConfirmed}
            onClick={() => removeVault()}
          >
            Remove wallet from this browser
          </Button>
        </div>
      ) : null}
    </div>
  );
}
