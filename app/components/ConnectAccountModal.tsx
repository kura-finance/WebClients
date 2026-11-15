// 連結帳戶彈窗元件
"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { useAppStore } from '@/store/useAppStore';
import { useFinanceStore } from '@/store/useFinanceStore';
import { useAppKit } from '@reown/appkit/react';
import { useAccount } from 'wagmi';
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from 'react-plaid-link';
import { usePlaidReady } from '@/context/PlaidProvider';
import { useLoad } from '@/hooks/useLoad';
import {
  PlaidApiError,
  createPlaidLinkToken,
  exchangePlaidPublicToken,
} from '@/lib/plaidApi';

/** Ask the backend for a Plaid Link token. Throws when none comes back. */
async function requestPlaidLinkToken(): Promise<string> {
  console.debug('[ConnectAccountModal] Requesting Plaid link token');
  const result = await createPlaidLinkToken();
  if (!result.link_token) {
    throw new PlaidApiError('Server did not return a link token', 500);
  }
  console.info('[ConnectAccountModal] Link token received');
  return result.link_token;
}

function describePlaidLinkError(error: unknown): string {
  if (error instanceof PlaidApiError) {
    switch (error.status) {
      case 401:
        return 'Your session expired. Please sign in again.';
      case 429:
        return 'Too many attempts. Please wait and try again.';
      case 500:
      case 502:
      case 503:
        return 'Plaid service temporarily unavailable. Please try again later.';
      default:
        return error.message;
    }
  }
  if (error instanceof Error && error.message.includes('NetworkError')) {
    return 'Network error. Please check your connection and try again.';
  }
  return 'Failed to initialize Plaid. Please try again.';
}

interface ConnectAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PlaidLinkError {
  display_message?: string;
  error_code?: string;
  error_message?: string;
}

/**
 * 內層彈窗內容元件 - 僅在 Plaid 準備完成時渲染
 */
function ConnectAccountModalContent({
  isOpen,
  onClose,
  linkToken,
}: ConnectAccountModalProps & { linkToken: string | null }) {
  const [isConnecting, setIsConnecting] = useState<'plaid' | 'reown' | null>(null);
  const [plaidError, setPlaidError] = useState<string | null>(null);
  const [isExchangingToken, setIsExchangingToken] = useState(false);

  const authToken = useAppStore((state) => state.authToken);
  const setPlaidLinkToken = useAppStore((state) => state.setPlaidLinkToken);
  const hydratePlaidFinanceData = useFinanceStore((state) => state.hydratePlaidFinanceData);
  const { isConnected } = useAccount();
  const { open: openAppKit } = useAppKit();

  // Closing the dialog clears its error, so reopening starts clean.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (!isOpen) setPlaidError(null);
  }

  const onPlaidSuccess = useCallback(
    async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
      if (!authToken) {
        setPlaidError('Please sign in before connecting a bank account.');
        return;
      }

      setIsExchangingToken(true);
      setPlaidError(null);

      try {
        console.debug('[ConnectAccountModal] Exchanging Plaid public token', {
          institution: metadata.institution?.name,
        });

        const result = await exchangePlaidPublicToken({
          public_token: publicToken,
          institution_name: metadata.institution?.name,
        });

        console.info('[ConnectAccountModal] Public token exchanged successfully');

        // 載入更新後的財務資料
        try {
          await hydratePlaidFinanceData();
          console.info('[ConnectAccountModal] Finance data reloaded');
        } catch (reloadError) {
          // 若重載失敗，仍視為交換成功，使用者可手動重新整理
          console.warn('[ConnectAccountModal] Finance data reload failed, but exchange succeeded', reloadError);
        }

        alert(result.message || 'Bank account connected successfully.');
        onClose();
      } catch (error) {
        let message = 'Failed to connect bank account.';

        if (error instanceof PlaidApiError) {
          switch (error.status) {
            case 401:
              message = 'Your session expired. Please sign in again and try connecting your account.';
              break;
            case 429:
              message = 'Too many connection attempts. Please wait a moment and try again.';
              break;
            case 400:
              message = error.errorCode === 'INVALID_REQUEST' 
                ? 'Invalid bank credentials. Please verify and try again.'
                : 'Invalid request. Please try again.';
              break;
            case 500:
            case 502:
            case 503:
              message = 'Server error. Please try again in a few moments.';
              break;
            default:
              message = error.message;
          }
        }

        setPlaidError(message);
        console.error('[ConnectAccountModal] Token exchange failed:', { error, message });
      } finally {
        setIsExchangingToken(false);
      }
    },
    [authToken, hydratePlaidFinanceData, onClose]
  );

  // 初始化 Plaid Link hook（僅在 Plaid ready 後渲染，因此可安全執行）
  const { open: openPlaid, ready: isPlaidReady } = usePlaidLink({
    token: linkToken,
    onSuccess: onPlaidSuccess,
    onExit: (error: PlaidLinkError | null) => {
      if (error) {
        const errorMessage = error.display_message || error.error_message || 'Plaid error occurred';
        setPlaidError(errorMessage);
        console.error('[ConnectAccountModal] Plaid exited with error:', error);
      }
    },
  });

  const fetchPlaidLinkToken = useCallback(
    async (): Promise<string | null> => {
      // Callers clear `plaidError` themselves: the dialog on close, the Connect
      // button before it starts. This only reports a failure.
      try {
        const token = await requestPlaidLinkToken();
        setPlaidLinkToken(token);
        return token;
      } catch (error) {
        const message = describePlaidLinkError(error);
        setPlaidError(message);
        console.error('[ConnectAccountModal] Failed to fetch link token:', { error, message });
        return null;
      }
    },
    [setPlaidLinkToken]
  );

  // Fetch the link token as soon as the dialog opens, so Connect is instant.
  const linkTokenPrefetch = useLoad({
    key: ['plaid', 'link-token'],
    load: async () => {
      const token = await requestPlaidLinkToken();
      setPlaidLinkToken(token);
      return token;
    },
    errorMessage: 'Failed to initialize Plaid. Please try again.',
    describeError: describePlaidLinkError,
    enabled: isOpen && !linkToken,
  });
  const shownError = plaidError ?? (isOpen && !linkToken ? linkTokenPrefetch.error : null);

  const handlePlaidConnect = async () => {
    setPlaidError(null);

    if (!authToken) {
      setPlaidError('Please sign in first to connect a bank account.');
      return;
    }

    setIsConnecting('plaid');

    try {
      let activeToken = linkToken;

      // 必要時先取得 token
      if (!activeToken) {
        console.debug('[ConnectAccountModal] Fetching link token');
        activeToken = await fetchPlaidLinkToken();
        if (!activeToken) {
          setPlaidError('Failed to load Plaid Link. Please check your connection and try again.');
          return;
        }
      }

      // 檢查 Plaid SDK 是否已就緒
      if (!isPlaidReady) {
        setPlaidError('Plaid is still initializing. Please wait and try again.');
        console.warn('[ConnectAccountModal] Plaid SDK not ready when attempting to open');
        return;
      }

      // 開啟 Plaid Link
      console.debug('[ConnectAccountModal] Opening Plaid Link UI');
      openPlaid();
    } catch (error) {
      console.error('[ConnectAccountModal] Error in handlePlaidConnect:', error);

      if (error instanceof PlaidApiError) {
        if (error.status === 429) {
          setPlaidError('Too many attempts. Please wait a few minutes before trying again.');
        } else {
          setPlaidError(`Failed to initialize Plaid: ${error.message}`);
        }
      } else {
        setPlaidError('Failed to connect account. Please refresh and try again.');
      }
    } finally {
      setIsConnecting(null);
    }
  };

  const handleReownConnect = async () => {
    setIsConnecting('reown');
    setPlaidError(null);

    try {
      if (isConnected) {
        // 已連線時直接打開 Reown 管理頁。
        await openAppKit({ view: 'Account' });
        return;
      }
      await openAppKit();
      onClose();
    } catch (error: unknown) {
      const walletError = error as { code?: number; message?: string };
      const message = walletError.message?.toLowerCase() || '';

      if (walletError.code === 4001 || message.includes('user rejected') || message.includes('rejected')) {
        // 使用者主動取消連線，維持安靜不提示。
      } else if (message.includes('already connected')) {
        await openAppKit({ view: 'Account' });
      } else {
        console.error('Wallet connection failed', error);
        setPlaidError('Reown connection failed. Please retry from the wallet modal.');
      }
    } finally {
      setIsConnecting(null);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex w-full max-w-md flex-col overflow-hidden rounded-3xl border border-[var(--kura-border)] bg-[var(--kura-surface)] shadow-[0_20px_60px_rgba(18,19,26,0.18)]"
          >
            <div className="relative z-10 flex items-center justify-between border-b border-[var(--kura-border)] p-6">
              <div>
                <h2 className="text-xl font-bold text-[var(--kura-text)]">Connect Account</h2>
                <p className="mt-1 text-sm text-[var(--kura-text-secondary)]">
                  Select the type of account to link.
                </p>
              </div>
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--kura-bg-lighter)] text-[var(--kura-text-secondary)] transition-colors hover:bg-[var(--kura-bg-light)] hover:text-[var(--kura-text)]"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 relative z-10">
              {authToken ? (
                <>
                  {shownError ? (
                    <div className="rounded-xl border border-[var(--kura-error-border)] bg-[var(--kura-error-bg)] px-3 py-2 text-xs text-[var(--kura-error-fg)]">
                      {shownError}
                    </div>
                  ) : null}

                  <button
                    onClick={handlePlaidConnect}
                    disabled={isConnecting !== null || isExchangingToken}
                    className={`group flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all duration-300 ${
                      isConnecting === 'plaid'
                        ? 'border-[var(--kura-primary)] bg-[var(--kura-primary)]/10'
                        : 'border-[var(--kura-border)] bg-[var(--kura-bg-light)] hover:border-[var(--kura-primary)]/50 hover:bg-[var(--kura-bg-lighter)]'
                    }`}
                  >
                    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full">
                      <Image
                        src="/icon_background.webp"
                        alt=""
                        fill
                        sizes="48px"
                        className="object-cover"
                        aria-hidden
                        unoptimized
                      />
                      <Image
                        src="https://www.google.com/s2/favicons?domain=plaid.com&sz=128"
                        alt="Plaid"
                        width={28}
                        height={28}
                        className="relative z-[1] object-contain opacity-90"
                      />
                    </div>
                    <div className="flex-1">
                      <div className="mb-0.5 text-base font-bold text-[var(--kura-text)] transition-colors group-hover:text-[var(--kura-primary)]">
                        Bank & Brokerage
                      </div>
                      <div className="line-clamp-2 text-xs text-[var(--kura-text-secondary)]">
                        Connect Robinhood, Fidelity, Chase, and other traditional financial
                        institutions via Plaid.
                      </div>
                    </div>
                    {isConnecting === 'plaid' ? (
                      <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[var(--kura-primary)] border-t-transparent" />
                    ) : (
                      <div className="shrink-0 text-[var(--kura-text-secondary)] transition-colors group-hover:text-[var(--kura-primary)]">
                        →
                      </div>
                    )}
                  </button>

                  <button
                    onClick={handleReownConnect}
                    disabled={isConnecting !== null || isExchangingToken}
                    className={`group flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all duration-300 ${
                      isConnecting === 'reown'
                        ? 'border-[var(--kura-secondary)] bg-[var(--kura-secondary)]/10'
                        : 'border-[var(--kura-border)] bg-[var(--kura-bg-light)] hover:border-[var(--kura-secondary)]/50 hover:bg-[var(--kura-bg-lighter)]'
                    }`}
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#3B99FC]">
                      <svg viewBox="0 0 40 40" width="24" height="24" fill="white">
                        <path d="M12.26 11.26c4.27-4.14 11.2-4.14 15.47 0l.48.46c.38.36.38.96 0 1.33l-2.07 2a.94.94 0 0 1-1.33 0l-.58-.56a6.83 6.83 0 0 0-9.45 0l-.56.54a.95.95 0 0 1-1.34 0l-2.07-2a.94.94 0 0 1 0-1.32l1.45-1.45zm19.8 8.65l1.96 1.9a.94.94 0 0 1 0 1.32l-9.15 8.87a.95.95 0 0 1-1.34 0l-3.53-3.42a1.9 1.9 0 0 0-2.67 0l-3.53 3.42a.95.95 0 0 1-1.34 0l-9.15-8.87a.94.94 0 0 1 0-1.32l1.95-1.9a.95.95 0 0 1 1.34 0l6.23 6.03c.74.72 1.94.72 2.68 0l3.52-3.41a1.9 1.9 0 0 1 2.68 0l3.52 3.4a.95.95 0 0 0 1.34 0l6.24-6.03a.94.94 0 0 1 1.32 0z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <div className="mb-0.5 text-base font-bold text-[var(--kura-text)] transition-colors group-hover:text-[var(--kura-secondary)]">
                        {isConnected ? 'Manage Web3 Wallet' : 'Web3 Wallet'}
                      </div>
                      <div className="line-clamp-2 text-xs text-[var(--kura-text-secondary)]">
                        {isConnected
                          ? 'Wallet is connected. Click to open Reown account manager (disconnect / switch wallet).'
                          : 'Connect Metamask, Phantom, Trust Wallet, and 100+ decentralized wallets via Reown.'}
                      </div>
                    </div>
                    {isConnecting === 'reown' ? (
                      <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[var(--kura-secondary)] border-t-transparent" />
                    ) : (
                      <div className="shrink-0 text-[var(--kura-text-secondary)] transition-colors group-hover:text-[var(--kura-secondary)]">
                        →
                      </div>
                    )}
                  </button>
                </>
              ) : (
                <div className="rounded-xl border border-[var(--kura-warning-border)] bg-[var(--kura-warning-bg)] px-3 py-2 text-xs text-[var(--kura-warning-fg)]">
                  Please sign in first to connect accounts.
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/**
 * 包裝元件 - 僅在 Plaid SDK 就緒時渲染彈窗
 */
export default function ConnectAccountModal(props: ConnectAccountModalProps) {
  const [mounted, setMounted] = useState(false);
  const { isPlaidReady, plaidError: plaidSdkError } = usePlaidReady();
  const linkToken = useAppStore((state) => state.plaidLinkToken);

  // SSR 安全：僅在 mounted 後渲染
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <>
      {!isPlaidReady && props.isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            onClick={props.onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full max-w-md rounded-3xl border border-[var(--kura-border)] bg-[var(--kura-surface)] p-6 shadow-[0_20px_60px_rgba(18,19,26,0.18)]"
          >
            <div className="text-center">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-[var(--kura-primary)] border-t-transparent" />
              <p className="font-medium text-[var(--kura-text)]">Loading Plaid...</p>
              {plaidSdkError ? (
                <p className="mt-2 text-sm text-[var(--kura-error-fg)]">{plaidSdkError}</p>
              ) : null}
            </div>
          </motion.div>
        </div>
      )}
      {isPlaidReady && props.isOpen && (
        <ConnectAccountModalContent {...props} linkToken={linkToken} />
      )}
    </>,
    document.body
  );
}
