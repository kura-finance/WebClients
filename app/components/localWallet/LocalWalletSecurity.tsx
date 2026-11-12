"use client";

/**
 * Security page without a backend: back up or remove the browser wallet.
 * Both actions ask for the password again, even though the wallet is unlocked.
 */

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DashboardPage, PageHeader } from "@/components/dashboard/PageShell";
import type { WalletSecret } from "@/lib/localWallet/keys";
import { AUTO_LOCK_MS, removeVault, revealSecret } from "@/lib/localWallet/store";
import { useLocalWallet } from "@/lib/signer/local";
import {
  CopyButton,
  FieldLabel,
  FormError,
  PhraseGrid,
  errorText,
} from "./fields";

export default function LocalWalletSecurity() {
  const { address } = useLocalWallet();

  return (
    <DashboardPage variant="narrow">
      <PageHeader
        eyebrow="Settings"
        title="Security"
        description="Your key is stored in this browser, encrypted with your password. Nobody else holds a copy."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Wallet key</CardTitle>
          <CardDescription>
            The wallet locks when you reload or close the tab, and after{" "}
            {Math.round(AUTO_LOCK_MS / 60_000)} minutes without activity.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
            Address (EOA)
          </p>
          <p className="mt-1 break-all font-mono text-sm text-[var(--kura-text)]" data-testid="eoa-address">
            {address ?? "—"}
          </p>
        </CardContent>
      </Card>

      <RevealSecretCard />
      <RemoveWalletCard />
    </DashboardPage>
  );
}

function RevealSecretCard() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<WalletSecret | null>(null);
  const [showKey, setShowKey] = useState(false);

  const hide = () => {
    setSecret(null);
    setShowKey(false);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !password) return;
    setError(null);
    setBusy(true);
    try {
      setSecret(await revealSecret(password));
      setPassword("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Reveal recovery phrase / private key</CardTitle>
        <CardDescription>
          Your backup. Anyone who sees it can take your funds — make sure nobody is watching your
          screen, and never enter it on another website.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {secret ? (
          <div className="space-y-4">
            {secret.kind === "mnemonic" ? (
              <>
                <PhraseGrid phrase={secret.phrase} />
                <CopyButton value={secret.phrase} label="Copy phrase" />
              </>
            ) : (
              <p className="text-sm text-[var(--kura-text-secondary)]">
                This wallet was imported from a private key, so it has no recovery phrase.
              </p>
            )}

            {showKey ? (
              <div className="space-y-2">
                <p
                  data-testid="private-key"
                  className="break-all rounded-md border border-[var(--kura-border)] bg-[var(--kura-bg-light)] p-3 font-mono text-xs text-[var(--kura-text)]"
                >
                  {secret.privateKey}
                </p>
                <CopyButton value={secret.privateKey} label="Copy private key" />
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setShowKey(true)}>
                Show private key
              </Button>
            )}

            <div>
              <Button type="button" variant="secondary" onClick={hide}>
                Hide
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <FieldLabel htmlFor="reveal-password">Password</FieldLabel>
              <Input
                id="reveal-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <FormError message={error} />
            <Button type="submit" disabled={busy || !password}>
              {busy ? "Checking…" : "Reveal"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function RemoveWalletCard() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !password) return;
    setError(null);
    setBusy(true);
    try {
      await revealSecret(password); // proves the password before anything is deleted
      removeVault(); // locks; the app returns to the start screen
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Card className="border-[var(--kura-error-border)] bg-[var(--kura-error-bg)]">
      <CardHeader className="pb-3">
        <CardTitle className="text-[var(--kura-error-fg)]">Remove wallet from this browser</CardTitle>
        <CardDescription className="text-[var(--kura-error-fg)]/90">
          Deletes the encrypted key stored in this browser. Your funds stay on-chain, but without
          your recovery phrase or private key they cannot be recovered — by you or by anyone else.
          Back it up above before you continue.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <FieldLabel htmlFor="remove-password">Type your password to confirm</FieldLabel>
            <Input
              id="remove-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <FormError message={error} />
          <Button type="submit" variant="destructive" disabled={busy || !password}>
            {busy ? "Checking…" : "Remove wallet"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
