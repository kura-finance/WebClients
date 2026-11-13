// 頂部導覽列元件
"use client";

import React, { useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useAccount, useChainId } from 'wagmi';
import { Button } from '@/components/ui/button';
import UserSettingsDrawer from './UserSettingsDrawer';
import { useAppStore } from '@/store/useAppStore';
import { type Investment, useFinanceStore } from '@/store/useFinanceStore';
import { fetchDeBankProtocolPositions, fetchDeBankTokenPositions } from '@/lib/debankApi';
import { features } from '@/config/features';

const SYNC_VISIBLE_ROUTES = ['/dashboard/accounts', '/dashboard/crypto', '/dashboard/defi-protocol'] as const;

const CHAIN_NAME_BY_ID: Record<number, string> = {
  1: 'Ethereum',
  137: 'Polygon',
  42161: 'Arbitrum',
};

function normalizeAddress(value: string | undefined): string | null {
  if (!value) return null;
  return value.toLowerCase();
}

export default function TopNav() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname() || '';
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const userProfile = useAppStore(state => state.userProfile);
  const authStatus = useAppStore(state => state.authStatus);
  const isBalanceHidden = useAppStore((state) => state.isBalanceHidden);
  const toggleBalanceVisibility = useAppStore((state) => state.toggleBalanceVisibility);
  const hydratePlaidFinanceData = useFinanceStore((state) => state.hydratePlaidFinanceData);
  const syncConnectedWalletAssets = useFinanceStore((state) => state.syncConnectedWalletAssets);
  const hydrateAssetHistory = useFinanceStore((state) => state.hydrateAssetHistory);
  const plaidLastSyncedAt = useFinanceStore((state) => state.plaidLastSyncedAt);
  const displayName = userProfile.displayName.trim();
  const avatarInitial = displayName ? displayName.slice(0, 1).toUpperCase() : '?';
  // Sync refreshes TrackFi data (Plaid / DeBank / asset history) — backend only.
  const shouldShowSync = useMemo(
    () =>
      features.trackFi &&
      SYNC_VISIBLE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`)),
    [pathname],
  );

  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await hydratePlaidFinanceData();

      if (isConnected) {
        const normalizedAddress = normalizeAddress(address);
        if (normalizedAddress) {
          const [tokenResponse, protocolResponse] = await Promise.all([
            fetchDeBankTokenPositions(normalizedAddress, true),
            fetchDeBankProtocolPositions(normalizedAddress, true),
          ]);
          const tokens = tokenResponse.positions;
          const protocols = protocolResponse.positions;

          const accountId = `wallet-${chainId}-${normalizedAddress}`;
          const tokenAssets: Investment[] = tokens.map((token) => ({
            id: `wallet-token-${chainId}-${normalizedAddress}-${token.id}`,
            accountId,
            symbol: token.symbol || 'TOKEN',
            name: token.name || token.symbol || 'Token',
            holdings: token.amount,
            currentPrice: token.price,
            change24h: 0,
            type: 'crypto',
            logo: token.logo,
          }));
          const protocolAssets: Investment[] = protocols
            .filter((protocol) => protocol.usdValue > 0)
            .map((protocol) => ({
              id: `wallet-protocol-${chainId}-${normalizedAddress}-${protocol.id}`,
              accountId,
              symbol: 'LP',
              name: protocol.name,
              holdings: 1,
              currentPrice: protocol.usdValue,
              change24h: 0,
              type: 'crypto',
              logo: protocol.logo,
            }));

          syncConnectedWalletAssets({
            address: normalizedAddress,
            chainId,
            chainName: CHAIN_NAME_BY_ID[chainId] ?? `Chain ${chainId}`,
            assets: [...tokenAssets, ...protocolAssets],
          });
        }
      }

      await hydrateAssetHistory(30);

    } finally {
      setIsSyncing(false);
    }
  };

  // 僅在已認證時顯示導覽列
  if (authStatus !== 'authenticated') {
    return null;
  }

  return (
    <>
      <header className="w-full flex justify-between items-center px-6 md:px-8 h-14 bg-[var(--kura-bg)]/90 backdrop-blur-sm z-40 shrink-0 border-b border-[var(--kura-border)]/70">
        <div className="text-xs text-[var(--kura-text-secondary)] min-h-4 flex items-center gap-2">
          {shouldShowSync ? (
            <>
              <span>
                {`Last synced: ${
                  plaidLastSyncedAt
                    ? new Date(plaidLastSyncedAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Never'
                }`}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => void handleSync()}
                disabled={isSyncing}
                aria-label="Sync data"
                className="w-8 h-8 rounded-full text-[var(--kura-text-secondary)] hover:text-[var(--kura-text)] hover:bg-[var(--kura-bg-light)]"
              >
                <svg
                  viewBox="0 0 24 24"
                  className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 12a8 8 0 00-14.3-4.9" />
                  <path d="M4 4v4h4" />
                  <path d="M4 12a8 8 0 0014.3 4.9" />
                  <path d="M20 20v-4h-4" />
                </svg>
              </Button>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleBalanceVisibility}
            aria-label={isBalanceHidden ? 'Show balances' : 'Hide balances'}
            className="w-9 h-9 rounded-full text-[var(--kura-text-secondary)] hover:text-[var(--kura-text)] hover:bg-[var(--kura-bg-light)]"
          >
            {isBalanceHidden ? (
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3l18 18" />
                <path d="M10.58 10.58A2 2 0 0012 14a2 2 0 001.42-.58" />
                <path d="M9.88 5.09A10.94 10.94 0 0112 5c5 0 9 5 9 7a7.73 7.73 0 01-3.33 4.95" />
                <path d="M6.61 6.61C4.06 8.12 2.33 10.11 2 12c0 2 4 7 10 7a11.4 11.4 0 004.14-.74" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </Button>
          <Button
            ref={avatarButtonRef}
            onClick={() => setIsSettingsOpen(true)}
            variant="ghost"
            size="icon"
            className="w-9 h-9 rounded-full p-0 overflow-hidden hover:bg-[var(--kura-bg-light)]"
          >
            {userProfile.avatarUrl ? (
              <Image
                src={userProfile.avatarUrl}
                alt={`${userProfile.displayName || 'Account'} Avatar`}
                width={28}
                height={28}
                unoptimized
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[var(--kura-surface-strong)] text-[10px] font-bold text-[var(--kura-primary-light)]">
                {avatarInitial}
              </div>
            )}
          </Button>
        </div>
      </header>

      {/* 掛載浮動視窗 */}
      <UserSettingsDrawer 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)}
        anchorRef={avatarButtonRef}
      />
    </>
  );
}