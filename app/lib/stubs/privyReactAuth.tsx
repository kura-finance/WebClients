/**
 * Stand-in for `@privy-io/react-auth` in builds without a backend.
 *
 * The community edition never signs in with Privy (see lib/signer), so
 * next.config.ts aliases the SDK to this file when NEXT_PUBLIC_BACKEND_URL is
 * empty and none of Privy's code is shipped to the browser. Nothing here should
 * ever run: each export throws so a stray call is noticed instead of silently
 * behaving as "signed out".
 */

function notInThisBuild(name: string): never {
  throw new Error(
    `${name} is not available: this build has no backend, so Privy is not included. ` +
      "Set NEXT_PUBLIC_BACKEND_URL to build with Privy login.",
  );
}

export function usePrivy(): never {
  return notInThisBuild("usePrivy");
}

export function useWallets(): never {
  return notInThisBuild("useWallets");
}

export function useIdentityToken(): never {
  return notInThisBuild("useIdentityToken");
}

export function PrivyProvider(): never {
  return notInThisBuild("PrivyProvider");
}
