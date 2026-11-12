'use client';

/**
 * Privy ↔ Kura session 橋接。
 *
 * Backend mode (NEXT_PUBLIC_BACKEND_URL set):
 * - 當 Privy 完成登入但 Kura session 尚未建立時，取得 access/identity token →
 *   POST /api/auth/login（換取 HttpOnly cookie）。
 * - 不會因 Privy 未登入而主動登出 Kura：cookie（7 天）為 API 認證的真實來源；
 *   登出一律由 UI 透過 useKuraLogout 觸發（先登出 Privy 再清 Kura session）。
 *
 * No-backend mode: a ready + authenticated Privy user IS the session — no token
 * exchange, no cookie. The app store simply mirrors Privy's state.
 */

import { useCallback, useEffect, useRef } from 'react';
import { usePrivy, useIdentityToken, type User } from '@privy-io/react-auth';
import { useAppStore } from '@/store/useAppStore';
import { features } from '@/config/features';

export default function PrivyAuthBridge() {
  return features.backend ? <BackendSessionBridge /> : <PrivySessionBridge />;
}

function BackendSessionBridge() {
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

/** Profile fields the UI needs, derived from the Privy user (no backend profile). */
function privyProfile(user: User) {
  const email = user.email?.address ?? user.google?.email ?? user.apple?.email ?? '';
  const displayName = user.google?.name?.trim() || email.split('@')[0] || '';
  const embedded = user.linkedAccounts.find(
    (account) => account.type === 'wallet' && account.walletClientType === 'privy',
  );
  const walletAddress = embedded && 'address' in embedded ? embedded.address : null;
  return { email, displayName, walletAddress };
}

function PrivySessionBridge() {
  const { ready, authenticated, user } = usePrivy();
  const applyPrivySession = useAppStore((s) => s.applyPrivySession);

  const userId = user?.id ?? null;
  const { email, displayName, walletAddress } = user
    ? privyProfile(user)
    : { email: '', displayName: '', walletAddress: null };

  useEffect(() => {
    // Until Privy is ready authStatus stays 'loading', so a reload neither flashes
    // the login page nor bounces an already signed-in user off the dashboard.
    if (!ready) return;
    if (!authenticated) {
      applyPrivySession(null);
      return;
    }
    if (!userId) return;
    applyPrivySession({ userId, displayName, email, walletAddress });
  }, [ready, authenticated, userId, displayName, email, walletAddress, applyPrivySession]);

  return null;
}

/**
 * 統一登出：先登出 Privy（避免 bridge 再次換 token），再清除 Kura session。
 * 在會觸發登出的 UI（設定抽屜等）使用。
 * (No-backend mode: the store's logout skips the backend call.)
 */
export function useKuraLogout(): () => Promise<void> {
  const { logout: privyLogout } = usePrivy();
  const storeLogout = useAppStore((s) => s.logout);

  return useCallback(async () => {
    try {
      await privyLogout();
    } catch (error) {
      console.warn('[useKuraLogout] Privy logout failed (continuing)', error);
    }
    await storeLogout();
  }, [privyLogout, storeLogout]);
}
