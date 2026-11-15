"use client";

/**
 * Profile without a backend: there is no account — only a local display name
 * and the wallet's addresses.
 */

import { useState } from "react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DashboardPage, PageHeader } from "@/components/dashboard/PageShell";
import { useLocalWallet } from "@/lib/signer/local";
import { useAppStore } from "@/store/useAppStore";
import { useWalletSessionStore } from "@/store/useWalletSessionStore";
import { CopyButton } from "./fields";

export default function LocalProfile() {
  const storedName = useAppStore((s) => s.userProfile.displayName);
  const setDisplayName = useAppStore((s) => s.setDisplayName);
  const { address } = useLocalWallet();
  const safeAddress = useWalletSessionStore((s) => s.scaOverride);

  const [name, setName] = useState(storedName);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    await setDisplayName(name);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <DashboardPage variant="narrow">
      <PageHeader
        eyebrow="Settings"
        title="Profile"
        description="There is no account here — just your wallet and a name for it, kept in this browser."
      />

      {saved ? (
        <Alert variant="success" className="mb-6">
          <AlertDescription>Display name saved.</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Display name</CardTitle>
          <CardDescription>Only shown to you, on this device.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter a display name"
              className="flex-1"
            />
            <Button onClick={() => void handleSave()} disabled={name.trim() === storedName}>
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Wallet addresses</CardTitle>
          <CardDescription>
            Your Smart Wallet is a Safe on Base owned by your key. Receive funds at the Smart Wallet
            address. Back up or remove the key under{" "}
            <Link href="/settings/security" className="font-medium text-[var(--kura-primary)] hover:underline">
              Security
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <AddressRow
            label="Smart Wallet (Safe)"
            value={safeAddress}
            pending="Setting up your Smart Wallet…"
            testId="safe-address"
          />
          <AddressRow label="Key address (EOA, Safe owner)" value={address} pending="—" testId="eoa-address" />
        </CardContent>
      </Card>
    </DashboardPage>
  );
}

function AddressRow({
  label,
  value,
  pending,
  testId,
}: {
  label: string;
  value: string | null;
  pending: string;
  testId: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
        {label}
      </p>
      <div className="mt-1 flex items-start justify-between gap-3">
        <p className="break-all font-mono text-sm text-[var(--kura-text)]" data-testid={testId}>
          {value ?? pending}
        </p>
        {value ? <CopyButton value={value} label="Copy" /> : null}
      </div>
    </div>
  );
}
