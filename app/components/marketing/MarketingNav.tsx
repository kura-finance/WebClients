"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

export default function MarketingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--kura-border)]/80 bg-[var(--kura-bg)]/85 backdrop-blur-md">
      <div className="marketing-container flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <Image src="/logo.webp" alt="Kura" width={28} height={28} className="rounded-md dark:invert" />
          <span className="text-[15px] font-semibold tracking-tight text-[var(--kura-text)]">
            Kura
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm text-[var(--kura-text-secondary)]">
          <a href="#product" className="hover:text-[var(--kura-text)] transition-colors">
            Product
          </a>
          <a href="#principles" className="hover:text-[var(--kura-text)] transition-colors">
            Principles
          </a>
          <a href="#trust" className="hover:text-[var(--kura-text)] transition-colors">
            Infrastructure
          </a>
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/"
            className="text-sm font-medium text-[var(--kura-text-secondary)] hover:text-[var(--kura-text)] transition-colors px-3 py-2"
          >
            Log in
          </Link>
          <Link
            href="/download"
            className="inline-flex h-10 items-center rounded-full bg-[var(--kura-text)] px-5 text-sm font-medium text-white transition-colors hover:bg-[#2a2d3a]"
          >
            Download
          </Link>
        </div>

        <button
          type="button"
          className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--kura-border)] text-[var(--kura-text)]"
          aria-label="Menu"
          onClick={() => setOpen((v) => !v)}
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            {open ? (
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            ) : (
              <>
                <path d="M4 7h16" strokeLinecap="round" />
                <path d="M4 12h16" strokeLinecap="round" />
                <path d="M4 17h16" strokeLinecap="round" />
              </>
            )}
          </svg>
        </button>
      </div>

      {open ? (
        <div className="md:hidden border-t border-[var(--kura-border)] bg-[var(--kura-bg)] px-6 py-4 space-y-3">
          <a href="#product" className="block text-sm text-[var(--kura-text-secondary)]" onClick={() => setOpen(false)}>
            Product
          </a>
          <a href="#principles" className="block text-sm text-[var(--kura-text-secondary)]" onClick={() => setOpen(false)}>
            Principles
          </a>
          <a href="#trust" className="block text-sm text-[var(--kura-text-secondary)]" onClick={() => setOpen(false)}>
            Infrastructure
          </a>
          <div className="flex gap-3 pt-2">
            <Link href="/" className="flex-1 text-center h-10 leading-10 rounded-full border border-[var(--kura-border)] text-sm font-medium">
              Log in
            </Link>
            <Link href="/download" className="flex-1 text-center h-10 leading-10 rounded-full bg-[var(--kura-text)] text-white text-sm font-medium">
              Download
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
