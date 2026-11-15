"use client";

import React, { useCallback, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import KuraVirtualCard from "@/components/card/KuraVirtualCard";
import MetalCardPreview from "@/components/card/MetalCardPreview";
import { useWaitlistJoin } from "@/hooks/useWaitlistJoin";
import { WAITLIST_PRODUCTS } from "@/lib/waitlistApi";
import { ApiError } from "@/lib/errorHandler";
import { features } from "@/config/features";
import { DashboardPage, PageHeader } from "@/components/dashboard/PageShell";

type CardTab = "virtual" | "metal";

const VIRTUAL_FEATURES = [
  { title: "Apple Pay & Google Pay", icon: "📱" },
  { title: "0.5% cashback on every purchase", icon: "🎁" },
  { title: "Zero foreign exchange fees", icon: "🌍" },
  { title: "Self-custody wallet — you hold the keys", icon: "🛡️" },
] as const;

const METAL_FEATURES = [
  {
    title: "Precision metal design",
    body: "Contactless tap-to-pay on a precision-milled metal card, weighted for a premium feel in hand.",
    icon: "◆",
  },
  {
    title: "Airport lounge access",
    body: "Complimentary lounge visits at airports worldwide — relax before every departure.",
    icon: "✈",
  },
  {
    title: "24/7 concierge",
    body: "Personal assistance for travel, dining, and exclusive experiences — anytime, anywhere.",
    icon: "🎧",
  },
  {
    title: "Travel & purchase protection",
    body: "Trip disruption coverage, purchase protection, and emergency assistance — built for global travel.",
    icon: "🛡",
  },
] as const;

export default function CardWaitlistView() {
  const [tab, setTab] = useState<CardTab>("virtual");
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const virtualWaitlist = useWaitlistJoin(WAITLIST_PRODUCTS.VIRTUAL_CARD, tab === "virtual");
  const metalWaitlist = useWaitlistJoin(WAITLIST_PRODUCTS.METAL_CARD, tab === "metal");
  const active = tab === "virtual" ? virtualWaitlist : metalWaitlist;

  const submit = useCallback(async () => {
    setMessage(null);
    if (!active.hasRealEmail) {
      setMessage({
        type: "err",
        text: "Link a real email address in Profile & Security before joining the waitlist.",
      });
      return;
    }
    if (active.joined) {
      setMessage({
        type: "ok",
        text:
          tab === "virtual"
            ? "You're on the list. We'll notify you when Kura Card is ready."
            : "You're on the list. We'll let you know when Kura Premier Card launches.",
      });
      return;
    }
    try {
      await active.join();
      setMessage({
        type: "ok",
        text:
          tab === "virtual"
            ? "You're on the list. We'll notify you when Kura Card is ready."
            : "You're on the list. We'll let you know when Kura Premier Card launches.",
      });
    } catch (error) {
      if (error instanceof Error && error.message === "WAITLIST_UNAVAILABLE") {
        setMessage({ type: "err", text: "Waitlist is temporarily unavailable. Please try again later." });
        return;
      }
      if (error instanceof ApiError && error.status === 429) {
        setMessage({ type: "err", text: "Too many requests. Please wait a moment and try again." });
        return;
      }
      setMessage({
        type: "err",
        text: error instanceof Error ? error.message : "Could not join the waitlist.",
      });
    }
  }, [active, tab]);

  const ctaLabel = active.joined
    ? "You're on the list"
    : active.checking || active.submitting
      ? "Please wait…"
      : "Notify me";

  return (
    <DashboardPage variant="wizard">
      <PageHeader
        eyebrow="Card"
        title="Kura Card"
        description="Join the waitlist — we'll notify you at launch."
        className="mb-6"
      />

      {/* Product tabs */}
      <div className="mb-6 flex gap-2 rounded-full bg-[var(--kura-bg-light)] p-1 border border-[var(--kura-border)]">
        <button
          type="button"
          onClick={() => {
            setTab("virtual");
            setMessage(null);
          }}
          className={`flex-1 rounded-full py-2 text-sm font-semibold transition-colors ${
            tab === "virtual"
              ? "bg-[var(--kura-primary)] text-white shadow-sm"
              : "text-[var(--kura-text-secondary)] hover:text-[var(--kura-text)]"
          }`}
        >
          Virtual
        </button>
        <button
          type="button"
          onClick={() => {
            setTab("metal");
            setMessage(null);
          }}
          className={`flex-1 rounded-full py-2 text-sm font-semibold transition-colors ${
            tab === "metal"
              ? "bg-[#B45309] text-white shadow-sm"
              : "text-[var(--kura-text-secondary)] hover:text-[var(--kura-text)]"
          }`}
        >
          Premier
        </button>
      </div>

      {/* Card preview */}
      <div className="mb-8">
        {tab === "virtual" ? (
          <KuraVirtualCard balance="Kura Card" masked last4="••••" />
        ) : (
          <MetalCardPreview />
        )}
      </div>

      {/* DM copy + features */}
      {tab === "virtual" ? (
        <div className="space-y-5">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-[var(--kura-text)]">
              Kura Card
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--kura-text-secondary)]">
              A self-custody Visa debit card powered by your wallet — tap to pay worldwide, with no
              middleman holding your funds.
            </p>
          </div>
          <ul className="space-y-3.5">
            {VIRTUAL_FEATURES.map((f) => (
              <li key={f.title} className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--kura-primary)]/20 bg-[var(--kura-primary)]/10 text-base">
                  {f.icon}
                </span>
                <span className="text-[15px] font-bold text-[var(--kura-text)]">{f.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-[var(--kura-text)]">
              Kura Premier Card
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--kura-text-secondary)]">
              Our top tier — a weighted stainless metal card with exclusive travel and lifestyle
              benefits.
            </p>
          </div>
          <ul className="space-y-4">
            {METAL_FEATURES.map((f) => (
              <li key={f.title} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[#B45309]/25 bg-[#B45309]/10 text-sm text-[#B45309]">
                  {f.icon}
                </span>
                <div>
                  <p className="text-[15px] font-bold text-[var(--kura-text)]">{f.title}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--kura-text-secondary)]">
                    {f.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {message ? (
        <div
          className={`mt-6 rounded-xl border px-4 py-3 text-sm ${
            message.type === "ok"
              ? "border-[var(--kura-success-border)] bg-[var(--kura-success-bg)] text-[var(--kura-success-fg)]"
              : "border-[var(--kura-error-border)] bg-[var(--kura-error-bg)] text-[var(--kura-error-fg)]"
          }`}
        >
          {message.text}
          {message.type === "err" && !active.hasRealEmail ? (
            <span className="mt-1 block">
              <Link href="/settings/profile" className="underline underline-offset-2">
                Open Profile
              </Link>
            </span>
          ) : null}
        </div>
      ) : null}

      <Button
        type="button"
        onClick={() => void submit()}
        disabled={active.checking || active.submitting || !features.card}
        className={`mt-6 h-12 w-full rounded-[14px] text-[15px] font-bold text-white ${
          tab === "metal"
            ? "bg-[#B45309] hover:bg-[#92400e]"
            : "bg-[var(--kura-primary)] hover:bg-[var(--kura-primary-dark)]"
        } ${active.joined ? "opacity-70" : !features.card ? "opacity-55" : ""}`}
      >
        {ctaLabel}
      </Button>

      <p className="mt-3 text-center text-xs leading-relaxed text-[var(--kura-text-secondary)]">
        {tab === "virtual"
          ? "Join the waitlist — we'll notify you when Kura Card launches."
          : "Kura Premier Card isn't available yet. We'll notify you when you can upgrade."}
      </p>
    </DashboardPage>
  );
}
