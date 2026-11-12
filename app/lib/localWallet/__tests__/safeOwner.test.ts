import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPublicClient,
  createWalletClient,
  custom,
  hashMessage,
  recoverAddress,
  recoverTypedDataAddress,
  type Hex,
} from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { base } from "viem/chains";
import { toSafeSmartAccount } from "permissionless/accounts";
import { accountFromSecret, secretFromPhrase } from "../keys.ts";
import { createLocalEip1193Provider, type Eip1193RequestArguments } from "../provider.ts";

/**
 * The app hands the Safe account (permissionless) a JSON-RPC wallet client over
 * the signer's EIP-1193 provider. This drives that exact path with the local
 * provider and records every method it is asked for.
 */
const owner = accountFromSecret(
  secretFromPhrase(
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  ),
);
const SAFE = "0x1111111111111111111111111111111111111111";

async function setup() {
  const asked: Eip1193RequestArguments[] = [];
  const local = createLocalEip1193Provider({
    chain: base,
    getAccount: () => owner,
    rpcRequest: async ({ method }) => {
      throw new Error(`the owner provider forwarded ${method}`);
    },
  });
  const provider = {
    request: (args: Eip1193RequestArguments) => {
      asked.push(args);
      return local.request(args);
    },
  };
  const publicClient = createPublicClient({
    chain: base,
    transport: custom({
      request: async ({ method }: { method: string }) => {
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_getCode") return "0x60806040"; // treat the Safe as deployed
        throw new Error(`unexpected public RPC call ${method}`);
      },
    }),
  });
  const ownerWalletClient = createWalletClient({
    account: owner.address,
    chain: base,
    transport: custom(provider),
  });
  const safe = await toSafeSmartAccount({
    client: publicClient,
    owners: [ownerWalletClient],
    entryPoint: { address: entryPoint07Address, version: "0.7" },
    version: "1.4.1",
    address: SAFE, // skip the on-chain address derivation (needs a Base RPC)
  });
  return { safe, asked };
}

describe("local provider as a Safe owner (permissionless)", () => {
  it("signs a UserOperation with eth_signTypedData_v4 as the owner", async () => {
    const { safe, asked } = await setup();
    const signature = await safe.signUserOperation({
      sender: SAFE,
      nonce: BigInt(5),
      callData: "0xdeadbeef",
      callGasLimit: BigInt(100_000),
      verificationGasLimit: BigInt(200_000),
      preVerificationGas: BigInt(50_000),
      maxFeePerGas: BigInt(2_000_000_000),
      maxPriorityFeePerGas: BigInt(1_000_000),
      signature: "0x",
      chainId: base.id,
    });

    const calls = asked.filter((call) => call.method === "eth_signTypedData_v4");
    assert.equal(calls.length, 1);
    const [address, json] = calls[0].params as [string, string];
    assert.equal(address, owner.address);
    const typed = JSON.parse(json);
    assert.equal(typed.primaryType, "SafeOp");

    // Packed as validAfter (6 bytes) + validUntil (6 bytes) + 65-byte owner signature.
    const ownerSignature = `0x${signature.slice(2 + 24)}` as Hex;
    assert.equal(ownerSignature.length, 2 + 130);
    assert.equal(await recoverTypedDataAddress({ ...typed, signature: ownerSignature }), owner.address);
  });

  it("signs a Safe message with personal_sign as the owner", async () => {
    const { safe, asked } = await setup();
    const signature = await safe.signMessage({ message: "hello" });

    const calls = asked.filter((call) => call.method === "personal_sign");
    assert.equal(calls.length, 1);
    const [raw, address] = calls[0].params as [Hex, string];
    assert.equal(address, owner.address);

    // Safe marks eth_sign-style signatures with v + 4.
    const v = Number.parseInt(signature.slice(-2), 16) - 4;
    const plain = `${signature.slice(0, -2)}${v.toString(16)}` as Hex;
    assert.equal(await recoverAddress({ hash: hashMessage({ raw }), signature: plain }), owner.address);
  });

  it("only ever asks the provider for methods it implements", async () => {
    const { safe, asked } = await setup();
    await safe.signUserOperation({
      sender: SAFE,
      nonce: BigInt(0),
      callData: "0x",
      callGasLimit: BigInt(1),
      verificationGasLimit: BigInt(1),
      preVerificationGas: BigInt(1),
      maxFeePerGas: BigInt(1),
      maxPriorityFeePerGas: BigInt(1),
      signature: "0x",
      chainId: base.id,
    });
    await safe.signMessage({ message: "hello" });
    await safe.signTypedData({
      domain: { chainId: base.id, verifyingContract: SAFE },
      types: { Order: [{ name: "amount", type: "uint256" }] },
      primaryType: "Order",
      message: { amount: BigInt(1) },
    });
    const methods = new Set(asked.map((call) => call.method));
    for (const method of methods) {
      assert.ok(
        ["eth_accounts", "eth_requestAccounts", "eth_chainId", "personal_sign", "eth_signTypedData_v4"].includes(method),
        method,
      );
    }
    assert.ok(methods.has("eth_signTypedData_v4"));
    assert.ok(methods.has("personal_sign"));
  });
});
