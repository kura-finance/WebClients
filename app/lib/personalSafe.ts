/**
 * Personal Smart Wallet (saltNonce 0) — same derivation as mobile
 * `toSafeSmartAccount` / `resolveKuraSmartAccountClient`.
 *
 * Setup is counterfactual only: compute address + PUT /api/wallet/sca.
 * On-chain deploy happens on the first UserOp (transfer / swap / etc.).
 */

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  fallback,
  getAddress,
} from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { base } from "viem/chains";
import { toSafeSmartAccount } from "permissionless/accounts";
import { env } from "@/config/env";
import type { EthereumProvider } from "@/lib/smartAccountSend";
import { signerCopy } from "@/lib/signer/copy";

/** Personal Smart Wallet uses the default salt (0). Treasury uses 1. */
export const PERSONAL_SAFE_SALT_NONCE = BigInt(0);

const BASE_FALLBACK = "https://mainnet.base.org";

function rpcUrls(): string[] {
  const urls: string[] = [];
  if (env.alchemyApiKey) {
    urls.push(`https://base-mainnet.g.alchemy.com/v2/${env.alchemyApiKey}`);
  }
  if (env.baseRpcUrl) urls.push(env.baseRpcUrl);
  urls.push(BASE_FALLBACK);
  return [...new Set(urls)];
}

async function buildPersonalAccount(eip1193Provider: EthereumProvider) {
  const publicClient = createPublicClient({
    chain: base,
    transport: fallback(rpcUrls().map((url) => http(url))),
  });

  const accounts = (await eip1193Provider.request({
    method: "eth_accounts",
  })) as string[];
  const eoaAddress = accounts[0] as `0x${string}` | undefined;
  if (!eoaAddress) throw new Error(signerCopy.noWallet);

  try {
    await eip1193Provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${base.id.toString(16)}` }],
    });
  } catch {
    /* already on Base */
  }

  const ownerWalletClient = createWalletClient({
    account: eoaAddress,
    chain: base,
    transport: custom(eip1193Provider),
  });

  const account = await toSafeSmartAccount({
    client: publicClient,
    owners: [ownerWalletClient],
    entryPoint: { address: entryPoint07Address, version: "0.7" },
    version: "1.4.1",
    // Explicit salt 0 matches mobile default / permissionless omit behavior.
    saltNonce: PERSONAL_SAFE_SALT_NONCE,
  });

  return { account, eoaAddress, publicClient };
}

/** Counterfactual Smart Wallet address for the current Privy EOA. */
export async function computePersonalSafeAddress(
  eip1193Provider: EthereumProvider,
): Promise<`0x${string}`> {
  const { account } = await buildPersonalAccount(eip1193Provider);
  return getAddress(account.address);
}
