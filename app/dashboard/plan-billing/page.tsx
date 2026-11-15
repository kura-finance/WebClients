"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/useAppStore';
import PlansModal from './_components/PlansModal';
import { getPlanById, getPlanDisplayPrice } from '@/config/plans';
import { parseMembershipTier } from '@/lib/membership';
import {
  createStripeBillingPortalSession,
  fetchStripeBillingStatus,
  StripeBillingStatus,
  StripePlanId,
} from '@/lib/stripeApi';

function formatMembershipLabel(label: string): string {
  const tier = parseMembershipTier(label);
  const plan = getPlanById(tier === 'vip' ? 'ultimate' : tier);
  return plan?.name ?? label.replace(/\s+Member$/i, '') ?? 'Kura Basic';
}

/** What Pro and Ultimate add on top of Basic. Built from static plan config, so computed once. */
const UPGRADE_HIGHLIGHTS = (() => {
  const pro = getPlanById('pro');
  const ultimate = getPlanById('ultimate');
  if (!pro || !ultimate) return [];

  return [
    ...pro.features.filter((feature) => feature.title !== 'Everything in Basic'),
    ...ultimate.features.filter((feature) => feature.title !== 'Everything in Pro'),
  ];
})();

export default function PlanBillingPage() {
  const membershipLabel = useAppStore((state) => state.userProfile.membershipLabel);
  const currentPlan = membershipLabel || 'Basic';
  const [isPlansModalOpen, setIsPlansModalOpen] = useState(false);
  const [isBillingPortalLoading, setIsBillingPortalLoading] = useState(false);
  const [billingError, setBillingError] = useState('');
  const [billingStatus, setBillingStatus] = useState<StripeBillingStatus | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setBillingError('');
        const status = await fetchStripeBillingStatus();
        if (!cancelled) {
          setBillingStatus(status);
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Failed to load billing status.';
        setBillingError(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const currentPlanTier = React.useMemo<StripePlanId>(() => {
    const tier = parseMembershipTier(currentPlan);
    if (tier === 'ultimate' || tier === 'vip') return 'ultimate';
    if (tier === 'pro') return 'pro';
    return 'basic';
  }, [currentPlan]);

  const currentPlanDefinition = getPlanById(currentPlanTier);
  const displayPlanName = formatMembershipLabel(currentPlan);
  const displayPrice = currentPlanDefinition
    ? getPlanDisplayPrice(currentPlanDefinition, 'monthly')
    : 'Free';

  const hasPaidPlan =
    currentPlanTier !== 'basic' ||
    billingStatus?.hasActiveSubscription === true ||
    billingStatus?.isActive === true;

  const upgradeHighlights = UPGRADE_HIGHLIGHTS;

  const handleOpenBillingPortal = async () => {
    try {
      setBillingError('');
      setIsBillingPortalLoading(true);
      const portalUrl = await createStripeBillingPortalSession({
        returnUrl: window.location.href,
      });
      window.location.assign(portalUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open billing portal.';
      setBillingError(message);
    } finally {
      setIsBillingPortalLoading(false);
    }
  };

  return (
    <div className="w-full pb-10 px-8 pt-10">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_0.65fr] gap-8 lg:gap-10">
          <section>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--kura-text)]">Plan & Billing</h1>

            <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-md">
              <div>
                <p className="text-xs text-[var(--kura-text-secondary)]">Your plan</p>
                <p className="mt-1 text-xl font-semibold text-[var(--kura-text)]">{displayPlanName}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--kura-text-secondary)]">Pricing</p>
                <p className="mt-1 text-xl font-semibold text-[var(--kura-text)]">{displayPrice}</p>
              </div>
            </div>

            {currentPlanDefinition ? (
              <p className="mt-3 text-sm text-[var(--kura-text-secondary)]">{currentPlanDefinition.summary}</p>
            ) : null}

            <div className="mt-6 border-t border-[var(--kura-border)] pt-6 space-y-8">
              <div>
                <h2 className="text-base font-medium text-[var(--kura-text)]">
                  Included with {displayPlanName}
                </h2>
                <ul className="mt-3 space-y-3">
                  {(currentPlanDefinition?.features ?? []).map((feature) => (
                    <li key={feature.title} className="flex items-start gap-2 text-sm text-[var(--kura-text)]">
                      <span className="text-[var(--kura-success)] mt-0.5">✓</span>
                      <span>
                        <span className="font-medium">{feature.title}</span>
                        {feature.description ? (
                          <span className="block text-xs text-[var(--kura-text-secondary)] mt-0.5">
                            {feature.description}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
                <a
                  href="https://kura-finance.com/pricing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-3 text-sm text-[var(--kura-text-secondary)] hover:text-[var(--kura-text)] transition-colors"
                >
                  View all features
                </a>
              </div>

              {currentPlanTier === 'basic' && upgradeHighlights.length > 0 ? (
                <div>
                  <p className="text-sm text-[var(--kura-text-secondary)]">Upgrade highlights</p>
                  <ul className="mt-2 space-y-3">
                    {upgradeHighlights.map((feature) => (
                      <li key={feature.title} className="flex items-start gap-2 text-sm text-[var(--kura-text)]">
                        <span className="text-[var(--kura-success)] mt-0.5">✓</span>
                        <span>
                          <span className="font-medium">{feature.title}</span>
                          {feature.description ? (
                            <span className="block text-xs text-[var(--kura-text-secondary)] mt-0.5">
                              {feature.description}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>

          <aside className="lg:border-l lg:border-[var(--kura-border)] lg:pl-10">
            <div className="py-1">
              <div className="relative h-32 overflow-hidden rounded-xl border border-[var(--kura-border)]">
                <Image
                  src="/og.jpg"
                  alt="Kura — Modern money, redefined."
                  fill
                  className="object-cover object-left"
                  sizes="(max-width: 1024px) 100vw, 320px"
                  priority
                />
              </div>
              <h3 className="mt-4 text-2xl font-medium text-[var(--kura-text)]">Explore plans</h3>
              <p className="mt-2 text-sm text-[var(--kura-text-secondary)]">
                Compare Basic, Pro, and Ultimate — aligned with{' '}
                <a
                  href="https://kura-finance.com/pricing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--kura-primary)] hover:underline"
                >
                  kura-finance.com/pricing
                </a>
                .
              </p>
              <Button className="w-full mt-5" onClick={() => setIsPlansModalOpen(true)}>
                View all plans
              </Button>
              {hasPaidPlan && (
                <Button
                  variant="secondary"
                  className="w-full mt-2"
                  onClick={() => void handleOpenBillingPortal()}
                  disabled={isBillingPortalLoading}
                >
                  {isBillingPortalLoading ? 'Opening billing portal...' : 'Manage billing'}
                </Button>
              )}
              {billingError && <p className="mt-2 text-xs text-[var(--kura-error)]">{billingError}</p>}
            </div>
          </aside>
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
