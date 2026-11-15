import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createWalletClient,
  custom,
  hashMessage,
  parseTransaction,
  recoverAddress,
  recoverTransactionAddress,
  verifyMessage,
  verifyTypedData,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { accountFromSecret, secretFromPhrase } from "../keys.ts";
import {
  ProviderRpcError,
  WalletLockedError,
  createLocalEip1193Provider,
  type Eip1193RequestArguments,
} from "../provider.ts";

const account = accountFromSecret(
  secretFromPhrase(
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  ),
);
const OTHER = "0x000000000000000000000000000000000000dEaD";

function setup(options: { locked?: boolean } = {}) {
  const forwarded: Eip1193RequestArguments[] = [];
  const provider = createLocalEip1193Provider({
    chain: base,
    getAccount: () => {
      if (options.locked) throw new WalletLockedError();
      return account;
    },
    rpcRequest: async (args) => {
      forwarded.push(args);
      if (args.method === "eth_chainId") return "0x2105";
      if (args.method === "eth_getBalance") return "0x2a";
      if (args.method === "eth_sendRawTransaction") return `0x${"ab".repeat(32)}`;
      throw new Error(`unexpected RPC call ${args.method}`);
    },
  });
  // Same wiring as the app: JSON-RPC account + custom(provider) transport.
  const wallet = createWalletClient({
    account: account.address,
    chain: base,
    transport: custom(provider),
  });
  return { provider, wallet, forwarded };
}

const SAFE_TX = {
  domain: { chainId: base.id, verifyingContract: OTHER },
  types: {
    SafeTx: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "nonce", type: "uint256" },
    ],
  },
  primaryType: "SafeTx",
  message: {
    to: OTHER,
    value: BigInt("123456789012345678901234567890"),
    data: "0xdeadbeef",
    operation: 1,
    nonce: BigInt(7),
  },
} as const;

describe("local EIP-1193 provider", () => {
  it("answers account and chain queries locally", async () => {
    const { provider, forwarded } = setup();
    assert.deepEqual(await provider.request({ method: "eth_accounts" }), [account.address]);
    assert.deepEqual(await provider.request({ method: "eth_requestAccounts" }), [account.address]);
    assert.equal(await provider.request({ method: "eth_chainId" }), "0x2105");
    assert.equal(forwarded.length, 0);
  });

  it("treats a switch to Base as a no-op and refuses other chains", async () => {
    const { provider } = setup();
    assert.equal(
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] }),
      null,
    );
    await assert.rejects(
      provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] }),
      (error: unknown) => error instanceof ProviderRpcError && error.code === 4902,
    );
  });

  it("signs personal_sign messages (text and raw hash) as the wallet", async () => {
    const { wallet } = setup();
    const signature = await wallet.signMessage({ message: "hello" });
    assert.equal(await verifyMessage({ address: account.address, message: "hello", signature }), true);
    assert.equal(signature, await account.signMessage({ message: "hello" }));

    // What the Safe account does for a UserOp / Safe message hash.
    const raw: Hex = `0x${"11".repeat(32)}`;
    const rawSignature = await wallet.signMessage({ message: { raw } });
    const signer = await recoverAddress({ hash: hashMessage({ raw }), signature: rawSignature });
    assert.equal(signer, account.address);
  });

  it("signs EIP-712 typed data sent as JSON (eth_signTypedData_v4)", async () => {
    const { wallet, provider } = setup();
    const signature = await wallet.signTypedData(SAFE_TX);
    assert.equal(await verifyTypedData({ ...SAFE_TX, address: account.address, signature }), true);
    // Same bytes as signing directly with the key (big integers survive the JSON hop).
    assert.equal(signature, await account.signTypedData(SAFE_TX));

    await assert.rejects(
      provider.request({ method: "eth_signTypedData_v4", params: [account.address, "{not json"] }),
      ProviderRpcError,
    );
  });

  it("refuses to sign for another address", async () => {
    const { provider } = setup();
    await assert.rejects(
      provider.request({ method: "personal_sign", params: ["0x68656c6c6f", OTHER] }),
      ProviderRpcError,
    );
    await assert.rejects(
      provider.request({ method: "eth_sendTransaction", params: [{ from: OTHER, to: OTHER }] }),
      ProviderRpcError,
    );
  });

  it("signs and broadcasts eth_sendTransaction with the local key", async () => {
    const { wallet, forwarded } = setup();
    const hash = await wallet.sendTransaction({
      to: OTHER,
      data: "0x1234",
      value: BigInt(5),
      gas: BigInt(100_000),
      nonce: 3,
      maxFeePerGas: BigInt(2_000_000_000),
      maxPriorityFeePerGas: BigInt(1_000_000),
    });
    assert.equal(hash, `0x${"ab".repeat(32)}`);

    const sent = forwarded.find((call) => call.method === "eth_sendRawTransaction");
    assert.ok(sent);
    const raw = (sent.params as Hex[])[0];
    const tx = parseTransaction(raw);
    assert.equal(tx.chainId, base.id);
    assert.equal(tx.to?.toLowerCase(), OTHER.toLowerCase());
    assert.equal(tx.data, "0x1234");
    assert.equal(tx.value, BigInt(5));
    assert.equal(tx.nonce, 3);
    assert.equal(
      await recoverTransactionAddress({ serializedTransaction: raw as never }),
      account.address,
    );
    // No account method ever reaches the RPC.
    assert.equal(forwarded.some((call) => call.method === "eth_sendTransaction"), false);
  });

  it("forwards plain node reads to the RPC", async () => {
    const { provider, forwarded } = setup();
    assert.equal(
      await provider.request({ method: "eth_getBalance", params: [account.address, "latest"] }),
      "0x2a",
    );
    assert.deepEqual(forwarded, [{ method: "eth_getBalance", params: [account.address, "latest"] }]);
  });

  it("rejects unsupported methods with a clear error instead of forwarding them", async () => {
    const { provider, forwarded } = setup();
    for (const method of [
      "eth_sign",
      "eth_signTransaction",
      "eth_signTypedData",
      "eth_signTypedData_v3",
      "eth_decrypt",
      "wallet_addEthereumChain",
      "wallet_sendCalls",
      "foo_bar",
    ]) {
      await assert.rejects(provider.request({ method, params: [] }), (error: unknown) => {
        assert.ok(error instanceof ProviderRpcError, method);
        assert.equal(error.code, 4200);
        assert.ok(error.message.includes(method));
        return true;
      });
    }
    assert.equal(forwarded.length, 0);
  });

  it("fails with a clear 'locked' error while the wallet is locked", async () => {
    const { provider, wallet, forwarded } = setup({ locked: true });
    for (const call of [
      { method: "eth_accounts" },
      { method: "personal_sign", params: ["0x68656c6c6f", account.address] },
      { method: "eth_signTypedData_v4", params: [account.address, "{}"] },
      { method: "eth_sendTransaction", params: [{ from: account.address, to: OTHER }] },
    ]) {
      await assert.rejects(provider.request(call), (error: unknown) => {
        assert.ok(error instanceof WalletLockedError, call.method);
        assert.match(error.message, /locked/i);
        return true;
      });
    }
    await assert.rejects(wallet.signMessage({ message: "hello" }), /locked/i);
    assert.equal(forwarded.length, 0);
  });
});
