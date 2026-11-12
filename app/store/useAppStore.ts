import { create } from 'zustand';
import {
  fetchCurrentUserProfile,
  updateCurrentUserProfile,
  loginWithPrivy,
  logoutUser,
  deleteCurrentUserAccount,
  type BackendUserProfile,
} from '@/lib/authApi';
import {
  ensureE2EEUnlocked,
  clearCryptoSession,
  tryRestoreSessionFromStorage,
} from '@/lib/crypto/zkAuth';
import {
  createPlaidLinkToken,
  exchangePlaidPublicToken,
  clearPlaidCache,
  disconnectPlaidAccount as disconnectPlaidAccountApi,
} from '@/lib/plaidApi';
import { fetchStripeBillingStatus } from '@/lib/stripeApi';
import {
  hasDashboardMembershipAccess,
  parseMembershipTier,
} from '@/lib/membership';
import { useFinanceStore } from './useFinanceStore';
import { claimOrgWorkspace, useOrgStore } from './useOrgStore';
import { useWalletSessionStore } from './useWalletSessionStore';
import { resetTreasurySyncProbe } from '@/lib/treasurySync';
import { isPrivyConfigured } from '@/config/env';
import { features } from '@/config/features';

export type MembershipCheckStatus = 'idle' | 'checking' | 'granted' | 'required';

export type BaseCurrency = 'USD' | 'EUR' | 'TWD';

export interface UserProfile {
  displayName: string;
  email: string;
  avatarUrl: string;
  membershipLabel: string;
}

/** Signed-in Privy user, as needed for a session without a backend. */
export interface PrivySessionUser {
  userId: string;
  displayName: string;
  email: string;
  /** Privy embedded EOA, when already known from the user object. */
  walletAddress: string | null;
}

export interface UserPreferences {
  baseCurrency: BaseCurrency;
  largeTransactionAlerts: boolean;
  weeklyAiSummary: boolean;
}

interface AppState {
  authStatus: 'loading' | 'authenticated' | 'unauthenticated';
  /**
   * 是否擁有有效的 in-memory crypto session（X25519 私鑰已解開）。
   * Privy 登入後預設為 false，需透過 Passkey 解鎖（unlockData）才會為 true。
   * Page reload 後若 sessionStorage 還原 keypair 成功也會是 true。
   * 加密資料（Plaid / asset history 解密）依賴此旗標。
   */
  isDecryptionReady: boolean;
  /** 後端回報尚未設定 E2EE keypair（首次登入）。 */
  needsKeyPairSetup: boolean;
  userProfile: UserProfile;
  preferences: UserPreferences;
  isBalanceHidden: boolean;
  plaidLinkToken: string | null;
  authToken: string | null;
  authError: string | null;
  /** Passkey 解鎖失敗訊息。 */
  e2eeError: string | null;
  /** Pro / Ultimate membership gate after login. */
  membershipCheckStatus: MembershipCheckStatus;

  // 認證方法（Privy 驅動）
  completePrivyLogin: (accessToken: string, identityToken: string | null) => Promise<void>;
  /**
   * No-backend mode: the Privy user is the session (no token exchange, no
   * membership check). Pass null when Privy reports signed out.
   */
  applyPrivySession: (user: PrivySessionUser | null) => void;
  verifyMembership: () => Promise<void>;
  unlockData: () => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  hydrateFromStorage: () => Promise<void>;

  // 使用者方法
  setDisplayName: (displayName: string) => Promise<void>;
  setBaseCurrency: (currency: BaseCurrency) => void;
  toggleLargeTransactionAlerts: () => void;
  toggleWeeklyAiSummary: () => void;
  toggleBalanceVisibility: () => void;
  setPlaidLinkToken: (token: string | null) => void;
  clearAuthSession: () => void;
  hydrateUserProfile: () => Promise<void>;

  // Plaid 方法
  requestPlaidLinkToken: () => Promise<string | null>;
  confirmPlaidExchange: (publicToken: string, institutionName?: string) => Promise<void>;
  disconnectPlaidAccount: (accountId: string) => Promise<void>;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  baseCurrency: 'USD',
  largeTransactionAlerts: false,
  weeklyAiSummary: false,
};

function mapProfile(user: BackendUserProfile, fallbackEmail = ''): UserProfile {
  return {
    displayName: user.displayName || '',
    email: user.email || fallbackEmail,
    avatarUrl: user.avatarUrl || '',
    membershipLabel: user.membershipLabel || '',
  };
}

export const useAppStore = create<AppState>((set) => ({
  authStatus: 'loading',
  isDecryptionReady: false,
  needsKeyPairSetup: false,
  userProfile: {
    displayName: '',
    email: '',
    avatarUrl: '',
    membershipLabel: '',
  },
  preferences: { ...DEFAULT_PREFERENCES },
  isBalanceHidden: false,
  plaidLinkToken: null,
  authToken: null,
  authError: null,
  e2eeError: null,
  membershipCheckStatus: 'idle',

  // 認證方法（Privy 驅動）
  verifyMembership: async () => {
    const state = useAppStore.getState();
    if (state.authStatus !== 'authenticated') {
      set({ membershipCheckStatus: 'idle' });
      return;
    }

    if (!features.billing) {
      // No plans without a backend — every signed-in user has full access.
      set({ membershipCheckStatus: 'granted' });
      return;
    }

    set({ membershipCheckStatus: 'checking' });

    let membershipLabel = state.userProfile.membershipLabel;
    try {
      const response = await fetchCurrentUserProfile();
      membershipLabel = response.user.membershipLabel || membershipLabel;
      set({ userProfile: mapProfile(response.user) });
    } catch (error) {
      console.warn('[AppStore] Failed to refresh profile for membership check', error);
    }

    let tier = parseMembershipTier(membershipLabel);
    try {
      const billing = await fetchStripeBillingStatus();
      const hasActive =
        billing.hasActiveSubscription === true || billing.isActive === true;
      if (hasActive && billing.tier) {
        tier = parseMembershipTier(billing.tier);
        // Prefer live billing over stale profile label ("paid but still Basic").
        const nextLabel =
          billing.membershipLabel ||
          (tier === "ultimate" || tier === "vip"
            ? "Ultimate Member"
            : tier === "pro"
              ? "Pro Member"
              : membershipLabel);
        if (nextLabel && nextLabel !== membershipLabel) {
          membershipLabel = nextLabel;
          set({
            userProfile: {
              ...useAppStore.getState().userProfile,
              membershipLabel: nextLabel,
            },
          });
        }
      }
    } catch (error) {
      console.warn('[AppStore] Failed to fetch billing status for membership check', error);
    }

    const granted = hasDashboardMembershipAccess(tier);
    set({ membershipCheckStatus: granted ? 'granted' : 'required' });
    console.info('[AppStore] Membership check complete', { tier, granted });
  },

  completePrivyLogin: async (accessToken: string, identityToken: string | null) => {
    try {
      console.debug('[AppStore] Exchanging Privy token for Kura session');
      set({ authStatus: 'loading', authError: null });

      const { user, needsKeyPairSetup } = await loginWithPrivy({ accessToken, identityToken });

      set({
        authToken: 'web-client',
        authStatus: 'authenticated',
        isDecryptionReady: false,
        needsKeyPairSetup,
        userProfile: mapProfile(user),
        authError: null,
        preferences: { ...DEFAULT_PREFERENCES },
        membershipCheckStatus: 'checking',
      });
      console.info('[AppStore] Privy login complete', { needsKeyPairSetup });
      await useAppStore.getState().verifyMembership();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Login failed';
      console.error('[AppStore] Privy login failed', { error: errorMessage });
      set({ authStatus: 'unauthenticated', authError: errorMessage, authToken: null });
      throw error;
    }
  },

  applyPrivySession: (user) => {
    if (!user) {
      if (useAppStore.getState().authStatus === 'unauthenticated') return;
      useWalletSessionStore.getState().clearWalletSession();
      useAppStore.getState().clearAuthSession();
      return;
    }

    claimOrgWorkspace(user.userId);
    if (user.walletAddress) {
      useWalletSessionStore.getState().setEoaOverride(user.walletAddress);
    }
    set({
      authToken: null,
      authStatus: 'authenticated',
      isDecryptionReady: false,
      needsKeyPairSetup: false,
      userProfile: {
        displayName: user.displayName,
        email: user.email,
        avatarUrl: '',
        membershipLabel: '',
      },
      authError: null,
      membershipCheckStatus: 'granted',
    });
  },

  // 用 Passkey 解鎖 E2EE 資料層（需使用者手勢觸發 WebAuthn）
  unlockData: async () => {
    try {
      console.debug('[AppStore] Unlocking E2EE data layer via passkey');
      set({ e2eeError: null });

      await ensureE2EEUnlocked();

      set({ isDecryptionReady: true, needsKeyPairSetup: false, e2eeError: null });

      const { hydratePlaidFinanceData, hydrateAssetHistory } = useFinanceStore.getState();
      try {
        await hydratePlaidFinanceData();
      } catch (plaidError) {
        console.warn('[AppStore] Failed to load Plaid data after unlock', plaidError);
      }
      try {
        await hydrateAssetHistory(30);
      } catch (assetError) {
        console.warn('[AppStore] Failed to load asset history after unlock', assetError);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to unlock your data';
      console.error('[AppStore] Unlock failed', {
        error: errorMessage,
        name: error instanceof Error ? error.name : typeof error,
        cause: error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined,
      });
      set({ isDecryptionReady: false, e2eeError: errorMessage });
      throw error;
    }
  },

  logout: async () => {
    try {
      console.info('[AppStore] Logging out');
      if (features.backend) {
        await logoutUser().catch(() => undefined);
      }
      clearCryptoSession();
      clearPlaidCache();
      // Without a backend the workspace only lives in localStorage — keep it
      // for this user's next sign-in (see claimOrgWorkspace).
      if (features.backend) {
        useOrgStore.getState().resetOrgWorkspace();
      }
      useWalletSessionStore.getState().clearWalletSession();
      resetTreasurySyncProbe();
      set({
        authToken: null,
        authStatus: 'unauthenticated',
        isDecryptionReady: false,
        needsKeyPairSetup: false,
        userProfile: { displayName: '', email: '', avatarUrl: '', membershipLabel: '' },
        plaidLinkToken: null,
        authError: null,
        e2eeError: null,
        membershipCheckStatus: 'idle',
      });
      console.info('[AppStore] Logout successful');
    } catch (error) {
      console.error('[AppStore] Logout failed', error);
      throw error;
    }
  },

  deleteAccount: async () => {
    try {
      console.info('[AppStore] Deleting account');
      await deleteCurrentUserAccount();
      clearCryptoSession();
      clearPlaidCache();
      useOrgStore.getState().resetOrgWorkspace();
      useWalletSessionStore.getState().clearWalletSession();
      resetTreasurySyncProbe();
      set({
        authToken: null,
        authStatus: 'unauthenticated',
        isDecryptionReady: false,
        needsKeyPairSetup: false,
        userProfile: { displayName: '', email: '', avatarUrl: '', membershipLabel: '' },
        plaidLinkToken: null,
        authError: null,
        e2eeError: null,
        membershipCheckStatus: 'idle',
      });
      console.info('[AppStore] Account deleted successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Account deletion failed';
      console.error('[AppStore] Account deletion failed', { error: errorMessage });
      throw error;
    }
  },

  hydrateFromStorage: async () => {
    try {
      if (!features.backend) {
        // No backend session to restore: PrivyAuthBridge resolves authStatus once
        // Privy is ready, so stay 'loading' until then (no login-page flash).
        if (typeof window !== 'undefined') {
          set({ isBalanceHidden: localStorage.getItem('kura-hide-balance') === '1' });
        }
        if (!isPrivyConfigured) {
          set({ authStatus: 'unauthenticated', authError: null });
        }
        return;
      }

      console.debug('[AppStore] Hydrating from storage');
      set({ authStatus: 'loading' });

      if (typeof window === 'undefined') {
        set({ authStatus: 'unauthenticated', authError: null });
        return;
      }

      set({ isBalanceHidden: localStorage.getItem('kura-hide-balance') === '1' });

      // page reload 後嘗試還原 crypto session（x25519 keypair 仍在 sessionStorage）
      const sessionRestored = tryRestoreSessionFromStorage();

      // Web 客戶端：Token 在 HttpOnly Cookie 中，直接嘗試呼叫 API
      try {
        const response = await fetchCurrentUserProfile();

        console.info('[AppStore] Profile fetched from cookie');
        set({
          authToken: 'web-client',
          authStatus: 'authenticated',
          isDecryptionReady: sessionRestored,
          userProfile: mapProfile(response.user),
          authError: null,
          preferences: { ...DEFAULT_PREFERENCES },
          membershipCheckStatus: 'checking',
        });

        await useAppStore.getState().verifyMembership();

        if (sessionRestored) {
          try {
            const { hydratePlaidFinanceData, hydrateAssetHistory } = useFinanceStore.getState();
            await hydratePlaidFinanceData();
            await hydrateAssetHistory(30);
          } catch (cacheError) {
            console.warn('[AppStore] Failed to load financial data after session restore', cacheError);
          }
        }
      } catch {
        console.info('[AppStore] No valid session found');
        set({ authStatus: 'unauthenticated', authError: null, authToken: null, membershipCheckStatus: 'idle' });
      }
    } catch (error) {
      console.warn('[AppStore] Failed to hydrate from storage', error);
      set({ authStatus: 'unauthenticated', authToken: null, membershipCheckStatus: 'idle' });
    }
  },

  // 使用者方法
  setDisplayName: async (displayName) => {
    try {
      console.debug('[AppStore] Updating display name', { displayName });
      const response = await updateCurrentUserProfile({ displayName });
      console.info('[AppStore] Display name updated');

      set((state) => ({
        userProfile: {
          ...state.userProfile,
          displayName: response.user.displayName,
        },
      }));
    } catch (error) {
      console.error('[AppStore] Failed to update display name', error);
    }
  },

  setBaseCurrency: (baseCurrency) =>
    set((state) => ({ preferences: { ...state.preferences, baseCurrency } })),

  toggleLargeTransactionAlerts: () =>
    set((state) => ({
      preferences: {
        ...state.preferences,
        largeTransactionAlerts: !state.preferences.largeTransactionAlerts,
      },
    })),

  toggleWeeklyAiSummary: () =>
    set((state) => ({
      preferences: {
        ...state.preferences,
        weeklyAiSummary: !state.preferences.weeklyAiSummary,
      },
    })),

  toggleBalanceVisibility: () =>
    set((state) => {
      const nextHidden = !state.isBalanceHidden;
      if (typeof window !== 'undefined') {
        localStorage.setItem('kura-hide-balance', nextHidden ? '1' : '0');
      }
      return { isBalanceHidden: nextHidden };
    }),

  setPlaidLinkToken: (plaidLinkToken) => set({ plaidLinkToken }),

  clearAuthSession: () => {
    set(() => ({
      authToken: null,
      authStatus: 'unauthenticated',
      isDecryptionReady: false,
      needsKeyPairSetup: false,
      plaidLinkToken: null,
      userProfile: {
        displayName: '',
        email: '',
        avatarUrl: '',
        membershipLabel: '',
      },
      authError: null,
      e2eeError: null,
      membershipCheckStatus: 'idle',
    }));
  },

  hydrateUserProfile: async () => {
    try {
      const response = await fetchCurrentUserProfile();
      set({
        userProfile: {
          displayName: response.user.displayName,
          email: response.user.email,
          avatarUrl: response.user.avatarUrl || '',
          membershipLabel: response.user.membershipLabel || '',
        },
        authStatus: 'authenticated',
        membershipCheckStatus: 'checking',
      });
      await useAppStore.getState().verifyMembership();
    } catch (error) {
      console.error('[AppStore] Failed to hydrate user profile', error);
      set({ authStatus: 'unauthenticated' });
    }
  },

  // Plaid 方法
  requestPlaidLinkToken: async () => {
    try {
      console.debug('[AppStore] Requesting Plaid link token');
      const result = await createPlaidLinkToken();
      console.debug('[AppStore] Plaid API response received', { result });

      const token = result.link_token;
      if (!token) {
        console.error('[AppStore] No link token in response', { result });
        throw new Error('No link token returned from backend');
      }

      set({ plaidLinkToken: token });
      console.info('[AppStore] Plaid link token received', { token });
      return token;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get Plaid link token';
      console.error('[AppStore] Failed to request Plaid link token', { error: errorMessage });
      throw error;
    }
  },

  confirmPlaidExchange: async (publicToken: string, institutionName?: string) => {
    try {
      console.debug('[AppStore] Exchanging Plaid public token', {
        institution: institutionName,
      });

      const result = await exchangePlaidPublicToken({
        public_token: publicToken,
        institution_name: institutionName,
      });

      console.info('[AppStore] Plaid token exchanged successfully', { result });

      // 載入更新後的財務資料
      const hydratePlaidFinanceData = useFinanceStore.getState().hydratePlaidFinanceData;
      await hydratePlaidFinanceData();

      // 清除 link token
      set({ plaidLinkToken: null });
      console.info('[AppStore] Finance data reloaded after Plaid exchange');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to exchange Plaid token';
      console.error('[AppStore] Plaid exchange failed', { error: errorMessage });
      throw error;
    }
  },

  disconnectPlaidAccount: async (accountId: string) => {
    try {
      console.debug('[AppStore] Disconnecting Plaid account', { accountId });

      const result = await disconnectPlaidAccountApi(accountId);
      console.info('[AppStore] Plaid account disconnected successfully', { result });

      // 更新本地 state 以移除帳戶
      const disconnectBankingAccount = useFinanceStore.getState().disconnectBankingAccount;
      await disconnectBankingAccount(accountId);

      // 重新載入更新後的財務資料
      const hydratePlaidFinanceData = useFinanceStore.getState().hydratePlaidFinanceData;
      await hydratePlaidFinanceData();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to disconnect Plaid account';
      console.error('[AppStore] Failed to disconnect Plaid account', { error: errorMessage });
      throw error;
    }
  },
}));
