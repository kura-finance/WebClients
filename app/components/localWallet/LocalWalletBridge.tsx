"use client";

/**
 * Browser wallet ↔ app session (no-backend mode).
 *
 * `authStatus === 'authenticated'` ⇔ the vault is unlocked. Until the vault has
 * been read on the client the store stays 'loading', so a reload shows neither
 * the dashboard nor a flash of the wrong screen.
 *
 * Also feeds the idle auto-lock and follows vault changes made in other tabs.
 */

import { useEffect } from "react";
import {
  VAULT_STORAGE_KEY,
  lockIfIdle,
  syncFromStorage,
  touchActivity,
} from "@/lib/localWallet/store";
import { localUserId, useLocalWallet } from "@/lib/signer/local";
import { useAppStore } from "@/store/useAppStore";

const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

export default function LocalWalletBridge() {
  const { status, address } = useLocalWallet();
  const applyLocalSession = useAppStore((s) => s.applyLocalSession);

  useEffect(() => {
    syncFromStorage();

    const onVisible = () => {
      if (document.visibilityState === "visible") lockIfIdle();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === VAULT_STORAGE_KEY) syncFromStorage();
    };

    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, touchActivity, { passive: true, capture: true });
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", onStorage);
    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, touchActivity, { capture: true });
      }
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (status === "unknown") return;
    if (status === "unlocked" && address) {
      applyLocalSession({ userId: localUserId(address), walletAddress: address });
    } else {
      applyLocalSession(null);
    }
  }, [status, address, applyLocalSession]);

  return null;
}
