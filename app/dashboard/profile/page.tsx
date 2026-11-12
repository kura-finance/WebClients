"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAppStore } from '@/store/useAppStore';
import { DashboardPage, PageHeader } from '@/components/dashboard/PageShell';
import { features } from '@/config/features';

export default function ProfilePage() {
  const router = useRouter();
  const { userProfile, setDisplayName, deleteAccount } = useAppStore();
  const membershipLabel = userProfile.membershipLabel;

  const [displayName, setDisplayNameInput] = useState(userProfile.displayName);
  const [email] = useState(userProfile.email);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleProfilePictureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
  };

  const handleSave = async () => {
    try {
      setIsLoading(true);
      setErrorMessage('');
      setSuccessMessage('');

      if (displayName !== userProfile.displayName) {
        await setDisplayName(displayName);
      }

      setSuccessMessage('Profile updated successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      setErrorMessage('Failed to update profile. Please try again.');
      console.error('Profile update error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm('Are you sure you want to permanently delete your account? This action cannot be undone.');
    if (!confirmed) return;

    try {
      setIsDeletingAccount(true);
      setErrorMessage('');
      setSuccessMessage('');
      await deleteAccount();
      router.push('/');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete account. Please try again.';
      setErrorMessage(message);
    } finally {
      setIsDeletingAccount(false);
    }
  };

  return (
    <DashboardPage variant="narrow">
      <PageHeader
        eyebrow="Settings"
        title="Profile"
        description={
          features.accountProfile
            ? 'Manage your account information and preferences.'
            : 'Your sign-in details, as provided by your Privy login.'
        }
      />

      {successMessage ? (
        <Alert variant="success" className="mb-6">
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      ) : null}
      {errorMessage ? (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Profile Picture</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[var(--kura-primary)] to-[var(--kura-primary-dark)]">
              {userProfile.avatarUrl ? (
                <Image
                  src={userProfile.avatarUrl}
                  alt="Avatar"
                  width={96}
                  height={96}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-2xl font-bold text-[var(--kura-on-primary)]">
                  {userProfile.displayName?.charAt(0).toUpperCase() || 'U'}
                </span>
              )}
            </div>
            {features.accountProfile ? (
              <div className="flex-1">
                <Button asChild variant="secondary">
                  <label className="cursor-pointer">
                    Upload Image
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={handleProfilePictureUpload}
                      className="hidden"
                    />
                  </label>
                </Button>
                <p className="mt-2 text-sm text-[var(--kura-text-secondary)]">
                  JPG, PNG or GIF (Max 5MB)
                </p>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Email Address</CardTitle>
        </CardHeader>
        <CardContent>
          <Input type="email" value={email} disabled />
          <CardDescription className="mt-2">
            {features.accountProfile
              ? 'Your email cannot be changed. Please contact support if you need to update it.'
              : 'Your email comes from your Privy login and cannot be changed here.'}
          </CardDescription>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Display Name</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayNameInput(e.target.value)}
              placeholder="Enter your display name"
              className="flex-1"
              disabled={!features.accountProfile}
            />
            {membershipLabel ? (
              <span className="whitespace-nowrap rounded-full border border-[var(--kura-border)] bg-[var(--kura-bg-light)] px-2 py-1 text-[10px] leading-none text-[var(--kura-text-secondary)]">
                {membershipLabel}
              </span>
            ) : null}
          </div>
          <CardDescription className="mt-2">
            {features.accountProfile
              ? 'This is how your name appears across the platform'
              : 'Taken from your Privy login. Editing needs a Kura backend.'}
          </CardDescription>
        </CardContent>
      </Card>

      {features.accountProfile ? (
        <>
          <div className="mb-8 flex gap-3">
            <Button
              onClick={() => {
                setDisplayNameInput(userProfile.displayName);
                setErrorMessage('');
                setSuccessMessage('');
              }}
              variant="outline"
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>

          <Card className="border-[var(--kura-error-border)] bg-[var(--kura-error-bg)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-[var(--kura-error-fg)]">Danger Zone</CardTitle>
              <CardDescription className="text-[var(--kura-error-fg)]/90">
                Permanently delete your account and all related data. This action cannot be undone.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-[var(--kura-error-fg)]/90">
                Make sure you have exported any data you need before continuing.
              </p>
              <Button
                onClick={handleDeleteAccount}
                variant="destructive"
                disabled={isDeletingAccount}
                className="w-full sm:w-auto"
              >
                {isDeletingAccount ? 'Deleting Account...' : 'Delete Account'}
              </Button>
            </CardContent>
          </Card>
        </>
      ) : null}
    </DashboardPage>
  );
}
