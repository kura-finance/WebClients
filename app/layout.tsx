// 應用程式根版面配置
import type { Metadata } from "next";
import Script from "next/script";
import { Inter, Newsreader } from "next/font/google";
import "./globals.css";
import Web3ModalProvider from '@/context/Web3ModalProvider';
import { PlaidProvider } from '@/context/PlaidProvider';
import SignerProvider from '@/context/SignerProvider';
import { features } from '@/config/features';

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
});

const siteTitle = "Kura — Modern finance, redesigned.";
const siteDescription =
  "One account to save, spend, invest, earn, and move money globally—with the simplicity of a bank and the freedom of modern finance.";

export const metadata: Metadata = {
  metadataBase: new URL('https://app.kura-finance.com'),
  title: siteTitle,
  description: siteDescription,
  keywords: ["finance", "neobank", "crypto", "investing", "Kura"],
  authors: [{ name: "Kura" }],
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico' },
    ],
    apple: [
      { url: '/ios/AppIcon.appiconset/icon-60@3x.png', sizes: '180x180', type: 'image/png' },
      { url: '/ios/AppIcon.appiconset/icon-60@2x.png', sizes: '120x120', type: 'image/png' },
    ],
  },
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    url: "https://app.kura-finance.com",
    siteName: "Kura",
    images: [
      {
        url: '/og.jpg',
        width: 1200,
        height: 630,
        alt: 'Kura — Modern finance, redesigned.',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: siteTitle,
    description: siteDescription,
    images: '/og.jpg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable}`}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Kura" />
        <meta name="theme-color" content="#8B5CF6" />
        <Script id="kura-theme-init" strategy="beforeInteractive">
          {`
            (function () {
              try {
                var stored = localStorage.getItem('kura-theme');
                var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                var mode = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
                var useDark = mode === 'dark' || (mode === 'system' && prefersDark);
                document.documentElement.classList.toggle('dark', useDark);
              } catch (_) {}
            })();
          `}
        </Script>
        {/* Plaid Link is only used by TrackFi (backend). */}
        {features.trackFi ? (
          <Script
            src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"
            strategy="beforeInteractive"
          />
        ) : null}
      </head>
      <body className="w-full h-screen bg-[var(--kura-bg)] text-[var(--kura-text)] flex flex-col antialiased selection:bg-[var(--kura-primary)]/30">
        <SignerProvider>
          <PlaidProvider>
            <Web3ModalProvider>
              <div className="flex flex-col flex-1 min-h-0 overflow-y-auto w-full h-full">
                {children}
              </div>
            </Web3ModalProvider>
          </PlaidProvider>
        </SignerProvider>
      </body>
    </html>
  );
}
