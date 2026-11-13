"use client";

import { useEffect, useRef } from "react";
import { saveEoaAddress } from "@/lib/walletApi";
import { isSignerConfigured, useSignerWallet } from "@/lib/signer";

interface PrivyEoaSyncProps {
  onEoa: (address: string) => void;
  persistedEoa: string | null;
}

/**
 * Discovers the signer EOA (Privy embedded wallet, or the browser wallet when
 * there is no backend) and persists it via /api/wallet/eoa in backend mode.
 */
export default function PrivyEoaSync({ onEoa, persistedEoa }: PrivyEoaSyncProps) {
  const signerWallet = useSignerWallet();
  const savedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isSignerConfigured) return;
    const embedded = signerWallet?.address ?? null;
    if (!embedded) return;

    onEoa(embedded);

    if (persistedEoa?.toLowerCase() === embedded.toLowerCase()) return;
    if (savedRef.current === embedded.toLowerCase()) return;
    savedRef.current = embedded.toLowerCase();

    void saveEoaAddress(embedded).catch(() => {
      savedRef.current = null;
    });
  }, [signerWallet, onEoa, persistedEoa]);

  return null;
}
