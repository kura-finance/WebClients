import type { EthereumProvider } from "@/lib/smartAccountSend";

/** The Safe owner EOA, as the on-chain code needs it. */
export interface SignerWallet {
  address: string;
  /** EIP-1193 provider that signs as `address`. */
  getEthereumProvider: () => Promise<EthereumProvider>;
}

/** Who is signed in, independent of where the key lives. */
export interface SignerSession {
  /** False until the signer has finished starting up. */
  ready: boolean;
  authenticated: boolean;
  /** Stable per-user id (Privy DID, or `local:<eoa>` for a browser wallet). */
  userId: string | null;
  /** Privy: sign out. Browser wallet: lock (the encrypted vault stays). */
  logout: () => Promise<void>;
}
