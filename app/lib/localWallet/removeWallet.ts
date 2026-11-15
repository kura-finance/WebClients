/**
 * "Remove wallet from this browser": delete the encrypted key and everything
 * else this browser kept for that wallet, so nothing about it is left behind
 * (its address, the Treasury workspace, its display name).
 *
 * The vault itself lives in ./store, which knows nothing about the app's other
 * stores; this is the one place that ties the two together. Other tabs follow
 * through the storage event (see LocalWalletBridge).
 */

import { localUserId } from "@/lib/signer/local";
import { forgetLocalDisplayName } from "@/store/useAppStore";
import { forgetOrgWorkspace } from "@/store/useOrgStore";
import { getSnapshot, removeVault } from "./store";

export function removeWalletFromBrowser(): void {
  // Known while locked too: the vault record carries the address in the clear.
  const { address } = getSnapshot();
  removeVault();
  forgetOrgWorkspace();
  if (address) forgetLocalDisplayName(localUserId(address));
}
