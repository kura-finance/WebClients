"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import TopNav from '@/components/TopNav';
import AppSidebar from '@/components/AppSidebar';
import FeatureRouteGuard from '@/components/FeatureRouteGuard';
import { useAppStore } from '@/store/useAppStore';

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authStatus = useAppStore((state) => state.authStatus);
  const membershipCheckStatus = useAppStore((state) => state.membershipCheckStatus);
  const verifyMembership = useAppStore((state) => state.verifyMembership);
  const router = useRouter();

  React.useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/');
      return;
    }
    if (authStatus === 'authenticated' && membershipCheckStatus === 'required') {
      router.push('/');
    }
  }, [authStatus, membershipCheckStatus, router]);

  React.useEffect(() => {
    if (authStatus === 'authenticated' && membershipCheckStatus === 'idle') {
      void verifyMembership();
    }
  }, [authStatus, membershipCheckStatus, verifyMembership]);

  if (
    authStatus === 'loading' ||
    membershipCheckStatus === 'checking' ||
    membershipCheckStatus === 'idle'
  ) {
    return (
      <div className="flex items-center justify-center h-screen w-full bg-[var(--kura-bg)]">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--kura-primary)]/20 mb-4">
              <div className="w-8 h-8 border-2 border-[var(--kura-primary)] border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="text-[var(--kura-text-secondary)]">Loading...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (authStatus !== 'authenticated' || membershipCheckStatus !== 'granted') {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 w-full bg-[var(--kura-bg)]">
      <AppSidebar />
      <main className="relative z-30 flex-1 overflow-y-auto bg-[var(--kura-bg)] w-full min-w-0">
        <TopNav />
        <div className="mx-auto w-full max-w-[1200px]">
          <FeatureRouteGuard>{children}</FeatureRouteGuard>
        </div>
      </main>
    </div>
  );
}
