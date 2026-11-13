/**
 * Treasury Safe — separate from personal Smart Wallet (saltNonce 0).
 * Multiple treasuries use saltNonce 1, 2, 3… (or bound existing Safes).
 */

import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  erc20Abi,
  http,
  fallback,
  getAddress,
} from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { base } from "viem/chains";
import { toSafeSmartAccount } from "permissionless/accounts";
import { env } from "@/config/env";
import { fetchSafeSigners, USDC_BASE } from "@/lib/baseChain";
import {
  executeCallsFromSafe,
  type EthereumProvider,
  type SafeAccountOpts,
} from "@/lib/smartAccountSend";
import { isSafeOwner, isEthAddress, normalizeAddress } from "@/lib/safeOwners";
import type { TreasurySource } from "@/lib/orgTreasury";
import { signerCopy } from "@/lib/signer/copy";

/** Default salt for the first created Treasury (personal Smart Wallet = 0). */
export const TREASURY_SAFE_SALT_NONCE = BigInt(1);

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

/** Resolve SafeAccountOpts for treasury execute / owner management. */
export function treasuryAccountOpts(
  source: TreasurySource | null | undefined,
  treasurySca: `0x${string}`,
  saltNonce?: bigint | string | null,
): SafeAccountOpts {
  if (source === "bound") {
    return { accountAddress: treasurySca };
  }
  const salt =
    saltNonce !== undefined && saltNonce !== null && `${saltNonce}` !== ""
      ? BigInt(saltNonce)
      : TREASURY_SAFE_SALT_NONCE;
  return { saltNonce: salt };
}

async function buildTreasuryAccount(
  eip1193Provider: EthereumProvider,
  saltNonce: bigint = TREASURY_SAFE_SALT_NONCE,
) {
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
    saltNonce,
  });

  return { account, eoaAddress, publicClient, saltNonce };
}

/** Counterfactual Treasury Safe address for the current Privy EOA + salt. */
export async function computeTreasurySafeAddress(
  eip1193Provider: EthereumProvider,
  saltNonce: bigint = TREASURY_SAFE_SALT_NONCE,
): Promise<`0x${string}`> {
  const { account } = await buildTreasuryAccount(eip1193Provider, saltNonce);
  return getAddress(account.address);
}

/**
 * Deploy the counterfactual Treasury Safe by sending a first UserOp.
 * Uses a zero-amount USDC self-transfer so the bundler runs factory setup.
 * Requires USDC on the address when ERC-20 paymaster is enabled — fund first.
 * If already deployed, returns the address without a tx.
 */
export async function deployTreasurySafe(params: {
  eip1193Provider: EthereumProvider;
  saltNonce?: bigint;
}): Promise<{ address: `0x${string}`; txHash: string | null; saltNonce: bigint }> {
  const salt = params.saltNonce ?? TREASURY_SAFE_SALT_NONCE;
  const { account, publicClient } = await buildTreasuryAccount(params.eip1193Provider, salt);
  const address = getAddress(account.address);

  const code = await publicClient.getBytecode({ address });
  if (code && code !== "0x") {
    return { address, txHash: null, saltNonce: salt };
  }

  const hash = await executeCallsFromSafe({
    eip1193Provider: params.eip1193Provider,
    expectedScaAddress: address,
    saltNonce: salt,
    calls: [
      {
        to: USDC_BASE,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [address, BigInt(0)],
        }),
      },
    ],
  });

  return { address, txHash: hash, saltNonce: salt };
}

/** Whether the Treasury Safe contract is on-chain (vs counterfactual only). */
export async function isTreasurySafeDeployed(address: `0x${string}`): Promise<boolean> {
  const publicClient = createPublicClient({
    chain: base,
    transport: fallback(rpcUrls().map((url) => http(url))),
  });
  const code = await publicClient.getBytecode({ address: getAddress(address) });
  return Boolean(code && code !== "0x");
}

/** Verify Privy EOA is an on-chain owner of the given Safe (for bind flow). */
export async function assertEoaIsOwner(
  scaAddress: string,
  eoaAddress: string | null | undefined,
): Promise<{ owners: `0x${string}`[]; threshold: number }> {
  if (!isEthAddress(scaAddress)) {
    throw new Error("Enter a valid Safe address (0x…).");
  }
  if (!eoaAddress || !isEthAddress(eoaAddress)) {
    throw new Error(`${signerCopy.connect} before binding a Treasury Safe.`);
  }

  const info = await fetchSafeSigners(normalizeAddress(scaAddress));
  if (!info.owners.length) {
    throw new Error("No owners found — address may not be a deployed Safe on Base.");
  }
  if (!isSafeOwner(info.owners, eoaAddress)) {
    throw new Error(
      `Your ${signerCopy.eoa} is not an owner of this Safe. Add it as a signer first, or create a new Treasury Safe.`,
    );
  }
  return info;
}
