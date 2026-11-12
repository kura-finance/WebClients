"use client";

import React, { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAppStore } from '@/store/useAppStore';
import { getPasskeyStatus } from '@/lib/authApi';
import LocalWalletSecurity from '@/components/localWallet/LocalWalletSecurity';
import { features } from '@/config/features';

/** Backend: passkey / E2EE. No backend: back up or remove the browser wallet. */
export default function SecurityPage() {
  return features.e2ee ? <PasskeySecurity /> : <LocalWalletSecurity />;
}

function PasskeySecurity() {
  const userEmail = useAppStore((state) => state.userProfile.email);
  const isDecryptionReady = useAppStore((state) => state.isDecryptionReady);
  const e2eeError = useAppStore((state) => state.e2eeError);
  const unlockData = useAppStore((state) => state.unlockData);

  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [passkeyRegistered, setPasskeyRegistered] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPasskeyStatus()
      .then((res) => {
        if (!cancelled) setPasskeyRegistered(res.registered);
      })
      .catch(() => {
        if (!cancelled) setPasskeyRegistered(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isDecryptionReady]);

  const handleUnlock = async () => {
    try {
      setIsLoading(true);
      setErrorMessage('');
      setSuccessMessage('');
      await unlockData();
      setSuccessMessage('Your encrypted data is unlocked on this device.');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to unlock your data.';
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full pb-10 px-8 pt-10">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[var(--kura-text)]">Security &amp; Encryption</h1>
          <p className="text-[var(--kura-text-secondary)] mt-2">
            Your financial data is end-to-end encrypted. A passkey on this device unlocks it.
          </p>
        </div>

        {(successMessage || (!errorMessage && !e2eeError)) && successMessage && (
          <Alert variant="success" className="mb-6">
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}
        {(errorMessage || e2eeError) && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{errorMessage || e2eeError}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Data encryption (Passkey)</CardTitle>
            <CardDescription>
              Kura never sees your financial data in plaintext. It is sealed with a key that only
              your passkey can unlock — no password to remember or leak.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--kura-text)] mb-2">Email</label>
              <Input type="email" value={userEmail} disabled className="text-[var(--kura-text-secondary)]" />
            </div>

            <div className="flex flex-col gap-1 text-sm">
              <span className="text-[var(--kura-text-secondary)]">
                Passkey:{' '}
                <strong className="text-[var(--kura-text)]">
                  {passkeyRegistered === null ? 'Unknown' : passkeyRegistered ? 'Registered' : 'Not set up'}
                </strong>
              </span>
              <span className="text-[var(--kura-text-secondary)]">
                Data on this device:{' '}
                <strong className="text-[var(--kura-text)]">{isDecryptionReady ? 'Unlocked' : 'Locked'}</strong>
              </span>
            </div>

            <div className="flex gap-3 pt-2">
              <Button onClick={handleUnlock} disabled={isLoading || isDecryptionReady}>
                {isLoading
                  ? 'Unlocking…'
                  : isDecryptionReady
                    ? 'Unlocked'
                    : passkeyRegistered
                      ? 'Unlock with passkey'
                      : 'Set up passkey & unlock'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
