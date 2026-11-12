"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { usePrivy } from "@privy-io/react-auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/useAppStore";
import { isPrivyConfigured } from "@/context/PrivyProvider";
import MembershipGate from "@/components/MembershipGate";
import { features } from "@/config/features";
import logoIcon from "./logo.webp";
import referPreview from "./refer.webp";

function LoadingScreen() {
  return (
    <div className="flex-1 flex justify-center items-center p-10 min-h-screen">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--kura-primary)]/20 mb-4">
          <div className="w-8 h-8 border-2 border-[var(--kura-primary)] border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-[var(--kura-text-secondary)]">Loading...</p>
      </div>
    </div>
  );
}

function PrivyLoginButton() {
  const { ready, authenticated, login } = usePrivy();
  const authStatus = useAppStore((state) => state.authStatus);
  const membershipCheckStatus = useAppStore((state) => state.membershipCheckStatus);
  const authError = useAppStore((state) => state.authError);

  const isExchanging =
    authenticated &&
    (authStatus !== "authenticated" ||
      (authStatus === "authenticated" && membershipCheckStatus === "checking"));

  return (
    <div className="w-full space-y-4">
      {authError && (
        <Alert variant="destructive">
          <AlertDescription>{authError}</AlertDescription>
        </Alert>
      )}

      <p className="text-sm text-[var(--kura-text-secondary)] leading-relaxed">
        {features.e2ee
          ? "Sign in with your email or social account. Your financial data stays end-to-end encrypted and is unlocked on this device with a passkey."
          : "Sign in with your email or social account to open your Smart Wallet on Base."}
      </p>

      <Button
        type="button"
        onClick={() => login()}
        disabled={!ready || isExchanging}
        className="w-full h-11 rounded-xl bg-[var(--kura-primary)] text-white hover:bg-[var(--kura-primary-dark)] shadow-sm disabled:opacity-60"
      >
        {!ready ? "Loading…" : isExchanging ? "Signing in…" : "Continue"}
      </Button>
    </div>
  );
}

export default function RootHubPage() {
  const authStatus = useAppStore((state) => state.authStatus);
  const membershipCheckStatus = useAppStore((state) => state.membershipCheckStatus);
  const router = useRouter();

  useEffect(() => {
    if (authStatus === "authenticated" && membershipCheckStatus === "granted") {
      router.push("/dashboard");
    }
  }, [authStatus, membershipCheckStatus, router]);

  if (
    authStatus === "loading" ||
    (authStatus === "authenticated" && membershipCheckStatus === "checking")
  ) {
    return <LoadingScreen />;
  }

  if (authStatus === "authenticated" && membershipCheckStatus === "required") {
    return <MembershipGate />;
  }

  if (authStatus === "unauthenticated") {
    return (
      <div className="min-h-screen w-full bg-[var(--kura-bg)] text-[var(--kura-text)] px-6 py-6 md:px-8 flex flex-col">
        <header className="w-full flex items-center justify-between">
          <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center">
            <Image src={logoIcon} alt="Kura icon" width={28} height={28} className="object-cover" />
          </div>
          <a
            href="https://kura-finance.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--kura-text-secondary)] hover:text-[var(--kura-text)] transition-colors inline-flex items-center gap-1 px-4 h-9 rounded-full border border-[var(--kura-border)] bg-[var(--kura-surface)] hover:bg-[var(--kura-bg-light)]"
          >
            Official Website
          </a>
        </header>

        <div className="flex-1 flex justify-center items-center">
          <div
            className={`w-full rounded-xl border border-[var(--kura-border)] bg-[var(--kura-surface)] overflow-hidden grid grid-cols-1 shadow-[0_20px_60px_rgba(18,19,26,0.06)] ${
              features.billing ? "max-w-[760px] md:grid-cols-2" : "max-w-[380px]"
            }`}
          >
            <section
              className={`bg-[var(--kura-bg)] p-7 md:p-8 flex flex-col ${
                features.billing ? "border-b md:border-b-0 md:border-r border-[var(--kura-border)]" : ""
              }`}
            >
              <h1 className="text-[30px] leading-none font-semibold tracking-tight mb-6">
                Welcome to Kura
              </h1>

              {isPrivyConfigured ? (
                <PrivyLoginButton />
              ) : (
                <Alert variant="warning">
                  <AlertDescription>
                    Authentication is not configured. Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> to
                    enable sign-in.
                  </AlertDescription>
                </Alert>
              )}
            </section>

            {features.billing ? (
              <aside className="p-7 md:p-8 bg-[var(--kura-bg-light)]">
                <h2 className="text-xl font-semibold mb-2">
                  Refer Friends. Earn 10% Lifetime. Protect More Privacy.
                </h2>
                <p className="text-sm text-[var(--kura-text-secondary)] leading-relaxed mb-4">
                  Invite your friends to Kura and earn 10% lifetime commission every time they
                  subscribe to Pro or Ultimate — while they get a full month of Pro for free.
                </p>

                <div className="rounded-xl border border-[var(--kura-border)] bg-white overflow-hidden h-44 relative">
                  <Image src={referPreview} alt="Refer preview" fill className="object-cover" />
                </div>
              </aside>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
