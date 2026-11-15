"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  ReactNode,
} from 'react';
import { features } from '@/config/features';

interface PlaidContextType {
  isPlaidReady: boolean;
  plaidError: string | null;
}

const PlaidContext = createContext<PlaidContextType | null>(null);

const PLAID_POLL_MS = 100;
const PLAID_LOAD_TIMEOUT_MS = 10_000;

function isPlaidLoaded(): boolean {
  return features.trackFi && Boolean(window.Plaid);
}

/**
 * Tell React when the Plaid script (see app/layout.tsx) has defined
 * `window.Plaid`: on the page load events, with a poll as a fallback that gives
 * up after the load timeout.
 */
function subscribeToPlaid(onChange: () => void): () => void {
  // TrackFi off → the Plaid script is not loaded; nothing to wait for.
  if (!features.trackFi || window.Plaid) return () => undefined;

  let attempts = 0;
  const maxAttempts = PLAID_LOAD_TIMEOUT_MS / PLAID_POLL_MS;
  const poll = setInterval(() => {
    attempts++;
    if (window.Plaid) onChange();
    if (window.Plaid || attempts >= maxAttempts) clearInterval(poll);
  }, PLAID_POLL_MS);

  document.addEventListener('DOMContentLoaded', onChange);
  window.addEventListener('load', onChange);

  return () => {
    clearInterval(poll);
    document.removeEventListener('DOMContentLoaded', onChange);
    window.removeEventListener('load', onChange);
  };
}

export function PlaidProvider({ children }: { children: ReactNode }) {
  const isPlaidReady = useSyncExternalStore(subscribeToPlaid, isPlaidLoaded, () => false);
  const [plaidError, setPlaidError] = useState<string | null>(null);

  useEffect(() => {
    if (!features.trackFi || isPlaidReady) return;
    const timer = setTimeout(() => {
      if (window.Plaid) return;
      const errorMsg = 'Plaid SDK failed to load after 10 seconds';
      console.error('[PlaidProvider]', errorMsg);
      setPlaidError(errorMsg);
    }, PLAID_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isPlaidReady]);

  return (
    <PlaidContext.Provider value={{ isPlaidReady, plaidError }}>
      {children}
    </PlaidContext.Provider>
  );
}

export function usePlaidReady() {
  const context = useContext(PlaidContext);
  if (!context) {
    throw new Error('usePlaidReady must be used within PlaidProvider');
  }
  return context;
}
