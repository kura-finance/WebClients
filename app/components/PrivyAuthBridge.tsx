'use client';

/**
 * Privy ↔ Kura session 橋接。
 *
 * - 當 Privy 完成登入但 Kura session 尚未建立時，取得 access/identity token →
 *   POST /api/auth/login（換取 HttpOnly cookie）。
 * - 不會因 Privy 未登入而主動登出 Kura：cookie（7 天）為 API 認證的真實來源；
 *   登出一律由 UI 透過 useKuraLogout 觸發（先登出 Privy 再清 Kura session）。
 */

import { useCallback, useEffect, useRef } from 'react';
import { usePrivy, useIdentityToken } from '@privy-io/react-auth';
import { useAppStore } from '@/store/useAppStore';
import { useSignerSession } from '@/lib/signer';

export default function PrivyAuthBridge() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const authStatus = useAppStore((s) => s.authStatus);
  const completePrivyLogin = useAppStore((s) => s.completePrivyLogin);
  const exchangingRef = useRef(false);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) return;
    // 只有在 Kura 尚未登入時才換 token；'loading' 期間（cookie 檢查中）先不動作
    if (authStatus !== 'unauthenticated') return;
    if (exchangingRef.current) return;

    exchangingRef.current = true;
    void (async () => {
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) {
          console.warn('[PrivyAuthBridge] No Privy access token available');
          return;
        }
        await completePrivyLogin(accessToken, identityToken ?? null);
      } catch (error) {
        console.error('[PrivyAuthBridge] Token exchange failed', error);
      } finally {
        exchangingRef.current = false;
      }
    })();
  }, [ready, authenticated, authStatus, getAccessToken, identityToken, completePrivyLogin]);

  return null;
}

/**
 * 統一登出：先登出 Privy（避免 bridge 再次換 token），再清除 Kura session。
 * 在會觸發登出的 UI（設定抽屜等）使用。
 *
 * Goes through the signer so it also works without Privy: with a browser wallet
 * (no backend) this locks the wallet — the encrypted vault is kept.
 */
export function useKuraLogout(): () => Promise<void> {
  const { logout: signerLogout } = useSignerSession();
  const storeLogout = useAppStore((s) => s.logout);

  return useCallback(async () => {
    try {
      await signerLogout();
    } catch (error) {
      console.warn('[useKuraLogout] Privy logout failed (continuing)', error);
    }
    await storeLogout();
  }, [signerLogout, storeLogout]);
}
