"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/useAppStore';
import { useKuraLogout } from '@/components/PrivyAuthBridge';
import PlansModal from '@/dashboard/plan-billing/_components/PlansModal';
import { parseMembershipTier } from '@/lib/membership';
import type { StripePlanId } from '@/lib/stripeApi';
import logoIcon from '@/logo.webp';

function toStripePlanId(label: string): StripePlanId {
  const tier = parseMembershipTier(label);
  if (tier === 'pro' || tier === 'ultimate') return tier;
  return 'basic';
}

export default function MembershipGate() {
  const membershipLabel = useAppStore((state) => state.userProfile.membershipLabel);
  const verifyMembership = useAppStore((state) => state.verifyMembership);
  const membershipCheckStatus = useAppStore((state) => state.membershipCheckStatus);
  const logout = useKuraLogout();
  const [isPlansModalOpen, setIsPlansModalOpen] = useState(false);

  const currentPlanTier = toStripePlanId(membershipLabel || 'Basic');

  return (
    <div className="flex min-h-screen w-full flex-col bg-[var(--kura-bg)] px-6 py-6 text-[var(--kura-text)] md:px-8">
      <header className="flex w-full items-center justify-between">
        <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full">
          <Image src={logoIcon} alt="Kura icon" width={28} height={28} className="object-cover dark:invert" />
        </div>
        <Button type="button" variant="ghost" onClick={() => void logout()} className="text-sm">
          Sign out
        </Button>
      </header>

      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-[760px] overflow-hidden rounded-xl border border-[var(--kura-border)] bg-[var(--kura-surface)] p-7 md:p-10">
          <div className="mx-auto max-w-xl text-center">
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--kura-primary-light)]">
              Membership required
            </p>
            <h1 className="mb-3 text-[30px] font-semibold leading-tight tracking-tight">
              Upgrade to access Kura
            </h1>
            <p className="mb-6 text-sm leading-relaxed text-[var(--kura-text-secondary)]">
              The web dashboard requires an active <strong>Pro</strong> or <strong>Ultimate</strong> plan.
              Choose a plan below to access our more professional and powerful desktop web experience
              and fully achieve your goals. You can also continue using the mobile app — it will always
              remain free.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                type="button"
                onClick={() => setIsPlansModalOpen(true)}
                className="h-11 rounded-xl px-8 shadow-sm"
              >
                View plans
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void verifyMembership()}
                disabled={membershipCheckStatus === 'checking'}
                className="h-11 rounded-xl px-8"
              >
                {membershipCheckStatus === 'checking' ? 'Checking…' : 'I already upgraded'}
              </Button>
            </div>

            <p className="mt-6 text-xs text-[var(--kura-text-secondary)]">
              Current plan: {membershipLabel || 'Basic Member'}
            </p>
          </div>
        </div>
      </div>

      <PlansModal
        isOpen={isPlansModalOpen}
        onClose={() => setIsPlansModalOpen(false)}
        currentPlanTier={currentPlanTier}
      />
    </div>
  );
}
