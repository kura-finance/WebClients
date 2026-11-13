"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { features } from '@/config/features';

interface PlaidContextType {
  isPlaidReady: boolean;
  plaidError: string | null;
}

const PlaidContext = createContext<PlaidContextType | null>(null);

export function PlaidProvider({ children }: { children: ReactNode }) {
  const [isPlaidReady, setIsPlaidReady] = useState(false);
  const [plaidError, setPlaidError] = useState<string | null>(null);

  useEffect(() => {
    // TrackFi off → the Plaid script is not loaded (see app/layout.tsx); nothing to wait for.
    if (!features.trackFi) return;

    // 檢查 Plaid 是否已可用
    if (typeof window !== 'undefined' && window.Plaid) {
      setIsPlaidReady(true);
      return;
    }

    // 監聽 script 載入事件（比輪詢更可靠）
    const handlePlaidReady = () => {
      if (window.Plaid) {
        setIsPlaidReady(true);
      }
    };

    // 另外使用動態檢查作為備援
    let attempts = 0;
    const maxAttempts = 100; // 最多 10 秒
    
    const checkInterval = setInterval(() => {
      attempts++;
      
      if (window.Plaid) {
        setIsPlaidReady(true);
        clearInterval(checkInterval);
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        const errorMsg = 'Plaid SDK failed to load after 10 seconds';
        console.error('[PlaidProvider]', errorMsg);
        setPlaidError(errorMsg);
      }
    }, 100);

    document.addEventListener('DOMContentLoaded', handlePlaidReady);
    window.addEventListener('load', handlePlaidReady);

    return () => {
      clearInterval(checkInterval);
      document.removeEventListener('DOMContentLoaded', handlePlaidReady);
      window.removeEventListener('load', handlePlaidReady);
    };
  }, []);

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
