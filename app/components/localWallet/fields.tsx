"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MIN_PASSWORD_LENGTH } from "@/lib/localWallet/vault";

/** Attributes for any field that holds a recovery phrase or private key. */
export const SECRET_INPUT_PROPS = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "none",
  spellCheck: false,
} as const;

export const SECRET_FIELD_CLASS =
  "w-full rounded-md border border-[var(--kura-border)] bg-[var(--kura-bg-light)] px-3 py-2 font-mono text-sm text-[var(--kura-text)] outline-none placeholder:text-[var(--kura-text-secondary)] focus-visible:border-[var(--kura-primary)]";

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong. Please try again.";
}

export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-[var(--kura-text)]">
      {children}
    </label>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** The 12 (or more) words, numbered. */
export function PhraseGrid({ phrase }: { phrase: string }) {
  return (
    <ol
      data-testid="recovery-phrase"
      className="grid grid-cols-3 gap-2 rounded-xl border border-[var(--kura-border)] bg-[var(--kura-bg-light)] p-3"
    >
      {phrase.split(" ").map((word, index) => (
        <li
          key={`${index}-${word}`}
          className="flex items-baseline gap-1.5 rounded-md bg-[var(--kura-surface)] px-2 py-1.5 font-mono text-sm text-[var(--kura-text)]"
        >
          <span className="w-4 shrink-0 text-right text-[10px] text-[var(--kura-text-secondary)]">
            {index + 1}
          </span>
          <span data-word>{word}</span>
        </li>
      ))}
    </ol>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/**
 * "Set a password" step (entered twice). The password is passed on exactly as
 * typed — it is never trimmed.
 */
export function PasswordSetupForm({
  submitLabel,
  busyLabel,
  onSubmit,
  onBack,
}: {
  submitLabel: string;
  busyLabel: string;
  onSubmit: (password: string) => Promise<void>;
  onBack: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (Array.from(password).length < MIN_PASSWORD_LENGTH) {
      setError(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit(password);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm leading-relaxed text-[var(--kura-text-secondary)]">
        This password encrypts your wallet in this browser. You will need it every time you open
        the app. It cannot be reset — if you forget it, you can only get back in with your recovery
        phrase or private key.
      </p>
      <div>
        <FieldLabel htmlFor="wallet-password">Password</FieldLabel>
        <Input
          id="wallet-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
        />
      </div>
      <div>
        <FieldLabel htmlFor="wallet-password-confirm">Repeat password</FieldLabel>
        <Input
          id="wallet-password-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <FormError message={error} />
      <div className="flex gap-3">
        <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button type="submit" className="flex-1" disabled={busy}>
          {busy ? busyLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
