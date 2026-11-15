/**
 * Signer — where the Safe owner key lives.
 *
 *   backend mode  → Privy embedded EOA   (./privy)
 *   no backend    → browser wallet vault (./local), Privy is not used at all
 *
 * The implementation is picked once, at module load, from a build-time flag, so
 * the hooks below are stable for the lifetime of the page and no Privy hook ever
 * runs without a backend. Every component that signs goes through these hooks.
 */

import { isPrivyConfigured } from "@/config/env";
import { features } from "@/config/features";
import * as localSigner from "./local";
import * as privySigner from "./privy";

const signer = features.backend ? privySigner : localSigner;

/** The Safe owner wallet (`address` + `getEthereumProvider()`), or null when unavailable. */
export const useSignerWallet = signer.useSignerWallet;

/** Sign-in state of the active signer. */
export const useSignerSession = signer.useSignerSession;

/** False only in backend mode without a Privy app id. The browser wallet needs no configuration. */
export const isSignerConfigured = features.backend ? isPrivyConfigured : true;

export type { SignerSession, SignerWallet } from "./types";
