"use client";

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAppStore } from '@/store/useAppStore';
import { Button } from '@/components/ui/button';
import { features } from '@/config/features';

/** TrackFi surfaces only — Bank / Broker / DeFi. */
const TRACKFI_UNLOCK_ROUTES = [
  '/dashboard/accounts',
  '/dashboard/investment',
  '/dashboard/defi-protocol',
] as const;

/**
 * 登入後若 E2EE 資料層尚未解鎖（isDecryptionReady=false），顯示提示橫幅，
 * 讓使用者用 Passkey 解鎖（WebAuthn 需使用者手勢，故用按鈕觸發）。
 * 僅在 TrackFi 三個介面顯示，其餘頁面不打擾。
 */
export default function UnlockDataBanner() {
  const pathname = usePathname() || '';
  const authStatus = useAppStore((state) => state.authStatus);
  const isDecryptionReady = useAppStore((state) => state.isDecryptionReady);
  const e2eeError = useAppStore((state) => state.e2eeError);
  const unlockData = useAppStore((state) => state.unlockData);
  const [isUnlocking, setIsUnlocking] = useState(false);

  const isTrackFiRoute = TRACKFI_UNLOCK_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (!features.e2ee || !isTrackFiRoute || authStatus !== 'authenticated' || isDecryptionReady) {
    return null;
  }

  const handleUnlock = async () => {
    try {
      setIsUnlocking(true);
      await unlockData();
    } catch {
      // 錯誤已存進 store.e2eeError，於下方顯示
    } finally {
      setIsUnlocking(false);
    }
  };

  return (
    <div className="mx-4 mt-4 rounded-xl border border-[var(--kura-primary)]/30 bg-[var(--kura-primary)]/5 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-sm font-semibold text-[var(--kura-text)]">Your data is locked</div>
          <div className="mt-1 text-xs text-[var(--kura-text-secondary)]">
            Unlock your end-to-end encrypted finances on this device with your passkey.
          </div>
          {e2eeError && <div className="mt-1 text-xs text-red-500">{e2eeError}</div>}
        </div>
        <Button onClick={handleUnlock} disabled={isUnlocking} className="shrink-0">
          {isUnlocking ? 'Unlocking…' : 'Unlock data'}
        </Button>
      </div>
    </div>
  );
}
