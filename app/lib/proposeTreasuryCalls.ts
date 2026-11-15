/**
 * Propose Call[] to Treasury via Safe Transaction Service (Approvals queue).
 * Multi-call → MultiSendCallOnly (DelegateCall); single call → direct Call.
 */

import { createWalletClient, custom, type Hex } from "viem";
import { base } from "viem/chains";
import type { Call, EthereumProvider } from "@/lib/smartAccountSend";
import {
  SAFE_MULTI_SEND_CALL_ONLY,
  encodeMultiSendCallData,
} from "@/lib/safeMultiSend";
import {
  buildSafeTx,
  fetchSafeInfo,
  proposeMultisigTx,
  signSafeTx,
} from "@/lib/safeTxService";
import { isSafeOwner, normalizeAddress } from "@/lib/safeOwners";
import { signerCopy } from "@/lib/signer/copy";

export async function proposeTreasuryCalls(params: {
  eip1193Provider: EthereumProvider;
  treasurySafe: `0x${string}`;
  eoaAddress: string;
  calls: Call[];
}): Promise<{ safeTxHash: Hex; nonce: number }> {
  if (!params.calls.length) throw new Error("No calls to propose.");

  const accounts = (await params.eip1193Provider.request({
    method: "eth_accounts",
  })) as string[];
  const account = (accounts[0] ?? params.eoaAddress) as `0x${string}`;
  if (!account) throw new Error(signerCopy.noWalletShort);

  try {
    await params.eip1193Provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${base.id.toString(16)}` }],
    });
  } catch {
    /* already on Base */
  }

  const safe = normalizeAddress(params.treasurySafe);
  const info = await fetchSafeInfo(safe);
  if (!info.owners.length) {
    throw new Error("Treasury Safe is not deployed on Base yet. Activate it under Treasury first.");
  }
  if (!isSafeOwner(info.owners as `0x${string}`[], account)) {
    throw new Error(`Your ${signerCopy.eoa} is not a Treasury Safe owner — only owners can propose.`);
  }

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: custom(params.eip1193Provider),
  });

  let tx;
  if (params.calls.length === 1) {
    const c = params.calls[0];
    tx = buildSafeTx({
      to: c.to,
      data: c.data,
      value: c.value ?? BigInt(0),
      operation: 0,
      nonce: info.nonce,
    });
  } else {
    tx = buildSafeTx({
      to: SAFE_MULTI_SEND_CALL_ONLY,
      data: encodeMultiSendCallData(params.calls),
      value: BigInt(0),
      operation: 1, // DelegateCall
      nonce: info.nonce,
    });
  }

  const { signature, safeTxHash } = await signSafeTx({
    walletClient,
    account,
    safeAddress: safe,
    chainId: base.id,
    tx,
  });

  await proposeMultisigTx({
    safeAddress: safe,
    sender: account,
    tx,
    safeTxHash,
    signature,
  });

  return { safeTxHash, nonce: info.nonce };
}
