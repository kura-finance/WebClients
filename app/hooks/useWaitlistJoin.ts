"use client";

import { useCallback, useState } from "react";
import { useLoad } from "@/hooks/useLoad";
import { useAppStore } from "@/store/useAppStore";
import { features } from "@/config/features";
import {
  getWaitlistStatus,
  joinWaitlist,
  type WaitlistProduct,
} from "@/lib/waitlistApi";

const STATUS_CACHE_TTL_MS = 5 * 60 * 1000;
const statusCache = new Map<string, { joined: boolean; expiresAt: number }>();

function cacheKey(email: string, product: WaitlistProduct): string {
  return `${email.toLowerCase()}:${product}`;
}

function readCached(email: string, product: WaitlistProduct): boolean | null {
  const hit = statusCache.get(cacheKey(email, product));
  if (!hit || hit.expiresAt <= Date.now()) return null;
  return hit.joined;
}

function writeCached(email: string, product: WaitlistProduct, joined: boolean): void {
  statusCache.set(cacheKey(email, product), {
    joined,
    expiresAt: Date.now() + STATUS_CACHE_TTL_MS,
  });
}

export function useWaitlistJoin(product: WaitlistProduct, enabled = true) {
  const email = useAppStore((s) => s.userProfile.email);
  const displayName = useAppStore((s) => s.userProfile.displayName);
  const hasRealEmail = Boolean(email?.trim() && email.includes("@"));

  const [submitting, setSubmitting] = useState(false);
  // Set by a successful join() so the UI flips without waiting for a reload.
  const [joinedKey, setJoinedKey] = useState<string | null>(null);

  const active = enabled && features.card && hasRealEmail;
  const statusKey = active ? cacheKey(email, product) : null;

  const status = useLoad({
    key: ["waitlist", "status", statusKey],
    load: async () => {
      const cached = readCached(email, product);
      if (cached !== null) return cached;
      const { joined: isJoined } = await getWaitlistStatus(email, product);
      writeCached(email, product, isJoined);
      return isJoined;
    },
    errorMessage: "Failed to check waitlist status",
    enabled: active,
  });

  // A failed check reads as "not joined", as before.
  const joined = statusKey !== null && (joinedKey === statusKey || status.data === true);
  const checking = active && status.loading;

  const join = useCallback(async () => {
    if (!features.card) throw new Error("WAITLIST_UNAVAILABLE");
    if (!hasRealEmail) throw new Error("EMAIL_REQUIRED");

    setSubmitting(true);
    try {
      const result = await joinWaitlist({
        email,
        product,
        name: displayName.trim() || undefined,
        source: "web_app",
      });
      writeCached(email, product, true);
      setJoinedKey(cacheKey(email, product));
      return result;
    } finally {
      setSubmitting(false);
    }
  }, [displayName, email, hasRealEmail, product]);

  return {
    join,
    joined,
    checking,
    submitting,
    hasRealEmail,
    backendAvailable: features.card,
  };
}
