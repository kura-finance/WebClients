/**
 * Wording that depends on where the key lives, so the UI never mentions Privy
 * when Privy is not used. Backend-mode strings are the original ones.
 */

import { features } from "@/config/features";

export const signerCopy = features.backend
  ? {
      /** "Your {eoa} is not an owner…" */
      eoa: "Privy EOA",
      key: "Privy key",
      account: "Privy account",
      /** "{connect} to manage Safe signers." */
      connect: "Connect Privy",
      connectWith: "Connect with Privy",
      signIn: "Sign in with Privy",
      connectEoaFirst: "Connect your Privy EOA first.",
      walletUnavailable: "Privy wallet unavailable. Sign in again.",
      walletNotReady: "Privy wallet not ready. Sign in again and retry.",
      noWallet: "No Privy wallet available. Sign in again and retry.",
      noWalletShort: "No Privy wallet available. Sign in again.",
      smartWalletNotReady: "Smart Wallet / Privy not ready.",
      memberAddressHint: "Privy / EOA address",
      memberAddressPlaceholder: "EOA / Privy address (0x…)",
    }
  : {
      eoa: "wallet address (EOA)",
      key: "wallet key",
      account: "wallet",
      connect: "Unlock your wallet",
      connectWith: "Unlock your wallet",
      signIn: "Unlock your wallet",
      connectEoaFirst: "Unlock your wallet first.",
      walletUnavailable: "Wallet is locked. Unlock it and try again.",
      walletNotReady: "Wallet is locked. Unlock it and try again.",
      noWallet: "Wallet is locked. Unlock it and try again.",
      noWalletShort: "Wallet is locked. Unlock it and try again.",
      smartWalletNotReady: "Smart Wallet not ready. Unlock your wallet and try again.",
      memberAddressHint: "wallet (EOA) address",
      memberAddressPlaceholder: "EOA address (0x…)",
    };
