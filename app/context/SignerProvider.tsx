'use client';

/**
 * Mounts whatever owns the session for the current mode:
 *
 *   backend mode → <PrivyProvider> (Privy login + PrivyAuthBridge)
 *   no backend   → <LocalWalletBridge> only. Privy is not mounted, not
 *                  configured and never contacted; the key lives in the
 *                  browser wallet vault (lib/localWallet).
 */

import type { ReactNode } from 'react';
import LocalWalletBridge from '@/components/localWallet/LocalWalletBridge';
import { features } from '@/config/features';
import PrivyProvider from './PrivyProvider';

export default function SignerProvider({ children }: { children: ReactNode }) {
  if (features.backend) {
    return <PrivyProvider>{children}</PrivyProvider>;
  }
  return (
    <>
      <LocalWalletBridge />
      {children}
    </>
  );
}
