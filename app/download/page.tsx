"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

type DeviceType = "ios" | "android" | "desktop" | "unknown";

function detectDeviceType(): DeviceType {
  if (typeof navigator === "undefined") return "unknown";
  const userAgent = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(userAgent)) return "ios";
  if (/android/.test(userAgent)) return "android";
  if (/windows|mac|linux/.test(userAgent)) return "desktop";
  return "unknown";
}

const FEATURES = [
  "Connect bank accounts (Plaid)",
  "Real-time transaction tracking",
  "Crypto asset management",
  "Unified finance dashboard",
] as const;

function FeatureList() {
  return (
    <ul className="space-y-3 pt-8 border-t border-[var(--kura-border)]">
      {FEATURES.map((item) => (
        <li key={item} className="flex items-center gap-3 text-sm text-[var(--kura-text-secondary)]">
          <span className="text-[var(--kura-primary)] font-medium">✓</span>
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function DownloadPage() {
  const [deviceType] = useState<DeviceType>(detectDeviceType);

  return (
    <div className="marketing-site min-h-screen flex flex-col">
      <MarketingNav />

      <main className="flex-1 flex items-center justify-center px-6 py-16 md:py-24">
        <div className="w-full max-w-2xl">
          {(deviceType === "ios" || deviceType === "unknown") && (
            <div className="text-center space-y-6">
              <Image
                src="/logo.webp"
                alt="Kura"
                width={88}
                height={88}
                className="mx-auto rounded-[22px] shadow-[0_20px_50px_rgba(18,19,26,0.12)] dark:invert"
              />
              <div>
                <h1 className="font-display text-4xl tracking-tight text-[var(--kura-text)] mb-3">
                  Download Kura
                </h1>
                <p className="text-[var(--kura-text-secondary)] text-lg max-w-md mx-auto">
                  Manage all your finances in one place—from traditional banking to crypto.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <a
                  href="https://apps.apple.com/app/kura-finance/id6503625647"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-12 items-center justify-center rounded-full bg-[var(--kura-text)] px-7 text-sm font-medium text-white hover:bg-[#2a2d3a] transition-colors"
                >
                  App Store
                </a>
                <a
                  href="https://play.google.com/store/apps/details?id=com.kurafinance.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-12 items-center justify-center rounded-full border border-[var(--kura-border)] bg-[var(--kura-surface)] px-7 text-sm font-medium text-[var(--kura-text)] hover:bg-[var(--kura-bg-light)] transition-colors"
                >
                  Google Play
                </a>
              </div>
              {deviceType === "ios" ? (
                <p className="text-sm text-[var(--kura-text-secondary)]">iOS 14.0 or later</p>
              ) : null}
              <div className="max-w-sm mx-auto text-left">
                <FeatureList />
              </div>
              <p className="text-sm text-[var(--kura-text-secondary)] pt-4">
                Prefer the browser?{" "}
                <Link href="/" className="font-medium text-[var(--kura-primary-dark)] hover:underline">
                  Log in to web
                </Link>
              </p>
            </div>
          )}

          {deviceType === "android" && (
            <div className="text-center space-y-6">
              <Image
                src="/logo.webp"
                alt="Kura"
                width={88}
                height={88}
                className="mx-auto rounded-[22px] shadow-[0_20px_50px_rgba(18,19,26,0.12)] dark:invert"
              />
              <div>
                <h1 className="font-display text-4xl tracking-tight mb-3">Download Kura</h1>
                <p className="text-[var(--kura-text-secondary)] text-lg max-w-md mx-auto">
                  Manage all your finances in one place—from traditional banking to crypto.
                </p>
              </div>
              <a
                href="https://play.google.com/store/apps/details?id=com.kurafinance.app"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center justify-center rounded-full bg-[var(--kura-primary)] px-7 text-sm font-medium text-white hover:bg-[var(--kura-primary-dark)] transition-colors"
              >
                Get it on Google Play
              </a>
              <p className="text-sm text-[var(--kura-text-secondary)]">Android 8.0 or later</p>
              <div className="max-w-sm mx-auto text-left">
                <FeatureList />
              </div>
              <p className="text-sm text-[var(--kura-text-secondary)] pt-4">
                Prefer the browser?{" "}
                <Link href="/" className="font-medium text-[var(--kura-primary-dark)] hover:underline">
                  Log in to web
                </Link>
              </p>
            </div>
          )}

          {deviceType === "desktop" && (
            <div className="space-y-10">
              <div className="text-center space-y-4">
                <h1 className="font-display text-4xl sm:text-5xl tracking-tight text-[var(--kura-text)]">
                  Download Kura
                </h1>
                <p className="text-[var(--kura-text-secondary)] text-lg max-w-lg mx-auto">
                  Get the mobile app, or continue in your browser.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)] p-8 text-center space-y-5">
                  <Image src="/logo.webp" alt="Kura iOS" width={72} height={72} className="mx-auto rounded-2xl dark:invert" />
                  <div>
                    <h2 className="text-xl font-semibold mb-1">iOS</h2>
                    <p className="text-sm text-[var(--kura-text-secondary)]">iPhone and iPad</p>
                  </div>
                  <a
                    href="https://apps.apple.com/app/kura-finance/id6503625647"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full h-11 items-center justify-center rounded-full bg-[var(--kura-text)] text-sm font-medium text-white hover:bg-[#2a2d3a] transition-colors"
                  >
                    App Store
                  </a>
                </div>

                <div className="rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-surface)] p-8 text-center space-y-5">
                  <Image src="/logo.webp" alt="Kura Android" width={72} height={72} className="mx-auto rounded-2xl dark:invert" />
                  <div>
                    <h2 className="text-xl font-semibold mb-1">Android</h2>
                    <p className="text-sm text-[var(--kura-text-secondary)]">Phones and tablets</p>
                  </div>
                  <a
                    href="https://play.google.com/store/apps/details?id=com.kurafinance.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full h-11 items-center justify-center rounded-full bg-[var(--kura-text)] text-sm font-medium text-white hover:bg-[#2a2d3a] transition-colors"
                  >
                    Google Play
                  </a>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--kura-border)] bg-[var(--kura-bg-light)] p-8 text-center space-y-4">
                <h2 className="text-xl font-semibold tracking-tight">Or use the web app</h2>
                <p className="text-sm text-[var(--kura-text-secondary)]">
                  Full dashboard in your browser—passkey unlock, TrackFi, and more.
                </p>
                <Link
                  href="/"
                  className="inline-flex h-11 items-center justify-center rounded-full bg-[var(--kura-primary)] px-7 text-sm font-medium text-white hover:bg-[var(--kura-primary-dark)] transition-colors"
                >
                  Log in to web
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
