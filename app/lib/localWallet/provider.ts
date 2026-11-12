/**
 * Local wallet — EIP-1193 provider backed by the unlocked key.
 *
 * Gives the on-chain code (Safe owner signing, Safe Transaction Service
 * confirmations, Safe execution) the same `request()` surface a Privy embedded
 * wallet has. Signing happens in the page with the unlocked viem account;
 * everything read-only is forwarded to the Base RPC.
 *
 * Pure module: relative imports only, runs as-is under `node --test`.
 */

import {
  createWalletClient,
  custom,
  hexToBigInt,
  hexToNumber,
  isHex,
  numberToHex,
  type Chain,
  type Hex,
  type LocalAccount,
} from "viem";

export interface Eip1193RequestArguments {
  method: string;
  params?: unknown[];
}

export interface LocalEip1193Provider {
  request: (args: Eip1193RequestArguments) => Promise<unknown>;
}

/** EIP-1193 style error (`code` follows EIP-1193 / EIP-1474). */
export class ProviderRpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "ProviderRpcError";
    this.code = code;
  }
}

/** Thrown by `getAccount` (and so by every signing method) while the wallet is locked. */
export class WalletLockedError extends ProviderRpcError {
  constructor() {
    super(4100, "Wallet is locked. Unlock it with your password and try again.");
    this.name = "WalletLockedError";
  }
}

/** Methods answered locally. Anything else is forwarded only if it is a plain node read. */
const UNSUPPORTED_ACCOUNT_METHODS = new Set([
  "eth_sign", // blind hash signing — not needed by the Safe paths, deliberately off
  "eth_signTransaction",
  "eth_signTypedData",
  "eth_signTypedData_v1",
  "eth_signTypedData_v3",
  "eth_getEncryptionPublicKey",
  "eth_decrypt",
]);

function unsupported(method: string): ProviderRpcError {
  return new ProviderRpcError(4200, `"${method}" is not supported by the local wallet.`);
}

function sameAddress(a: unknown, b: string): boolean {
  return typeof a === "string" && a.toLowerCase() === b.toLowerCase();
}

function optionalBigInt(value: unknown): bigint | undefined {
  return isHex(value) ? hexToBigInt(value) : undefined;
}

export function createLocalEip1193Provider(options: {
  /** Unlocked signing account; must throw WalletLockedError while locked. */
  getAccount: () => LocalAccount;
  /** Read-only JSON-RPC transport for the chain (the app's Base RPC). */
  rpcRequest: (args: Eip1193RequestArguments) => Promise<unknown>;
  /** The only chain this wallet signs for. */
  chain: Chain;
}): LocalEip1193Provider {
  const { getAccount, rpcRequest, chain } = options;
  const chainIdHex = numberToHex(chain.id);

  const requireSigner = (address: unknown): LocalAccount => {
    const account = getAccount();
    if (!sameAddress(address, account.address)) {
      throw new ProviderRpcError(4100, "The requested account is not this wallet.");
    }
    return account;
  };

  const request = async ({ method, params = [] }: Eip1193RequestArguments): Promise<unknown> => {
    switch (method) {
      case "eth_accounts":
      case "eth_requestAccounts":
        return [getAccount().address];

      case "eth_coinbase":
        return getAccount().address;

      case "eth_chainId":
        return chainIdHex;

      case "wallet_switchEthereumChain": {
        const target = (params[0] as { chainId?: unknown } | undefined)?.chainId;
        if (isHex(target) && hexToNumber(target) === chain.id) return null;
        throw new ProviderRpcError(4902, `The local wallet only works on ${chain.name}.`);
      }

      case "personal_sign": {
        // params: [message, address]
        const account = requireSigner(params[1]);
        const data = params[0];
        if (typeof data !== "string") {
          throw new ProviderRpcError(-32602, "personal_sign expects a message.");
        }
        return account.signMessage({ message: isHex(data) ? { raw: data } : data });
      }

      case "eth_signTypedData_v4": {
        // params: [address, typedData (JSON string or object)]
        const account = requireSigner(params[0]);
        let typedData: {
          domain?: Record<string, unknown>;
          types?: Record<string, unknown>;
          primaryType?: string;
          message?: Record<string, unknown>;
        };
        try {
          typedData = typeof params[1] === "string" ? JSON.parse(params[1]) : (params[1] as never);
        } catch {
          throw new ProviderRpcError(-32602, "eth_signTypedData_v4 expects EIP-712 typed data.");
        }
        if (!typedData?.types || !typedData.primaryType || !typedData.message) {
          throw new ProviderRpcError(-32602, "eth_signTypedData_v4 expects EIP-712 typed data.");
        }
        return account.signTypedData({
          domain: typedData.domain ?? {},
          types: typedData.types,
          primaryType: typedData.primaryType,
          message: typedData.message,
        } as never);
      }

      case "eth_sendTransaction": {
        // params: [{ from, to, data, value, gas, nonce, maxFeePerGas, maxPriorityFeePerGas }]
        const tx = (params[0] ?? {}) as Record<string, unknown>;
        const account = requireSigner(tx.from);
        const wallet = createWalletClient({
          account,
          chain,
          transport: custom({ request: rpcRequest as never }),
        });
        return wallet.sendTransaction({
          to: isHex(tx.to) ? tx.to : undefined,
          data: isHex(tx.data) ? tx.data : isHex(tx.input) ? (tx.input as Hex) : undefined,
          value: optionalBigInt(tx.value),
          gas: optionalBigInt(tx.gas),
          nonce: isHex(tx.nonce) ? hexToNumber(tx.nonce) : undefined,
          maxFeePerGas: optionalBigInt(tx.maxFeePerGas),
          maxPriorityFeePerGas: optionalBigInt(tx.maxPriorityFeePerGas),
        });
      }

      default:
        break;
    }

    if (UNSUPPORTED_ACCOUNT_METHODS.has(method) || method.startsWith("wallet_")) {
      throw unsupported(method);
    }
    if (method.startsWith("eth_") || method.startsWith("net_") || method.startsWith("web3_")) {
      return rpcRequest({ method, params });
    }
    throw unsupported(method);
  };

  return { request };
}
