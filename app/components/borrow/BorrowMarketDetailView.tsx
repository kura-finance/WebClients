"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  collateralDisplayName,
  computeUserLtvRatio,
  fetchBorrowMarketDetail,
  formatApy,
  formatLltv,
  formatTvl,
  formatUtilization,
  formatUserLtvPercent,
  ltvRiskLevel,
  morphoMarketAppUrl,
  parseMarketMaxLltv,
  type MorphoMarketDetail,
} from "@/lib/morphoApi";
import {
  buildMorphoBorrowCalls,
  buildMorphoRepayCalls,
  readMorphoUserPositionDisplay,
  toMorphoMarketParams,
} from "@/lib/morphoBlue";
import { readErc20Balance } from "@/lib/morphoEarn";
import { submitCallsSmartOrTreasury } from "@/lib/submitTradingCalls";
import { errMessage, formatUsd, truncateAddress } from "@/lib/formatDisplay";
import { isPimlicoConfigured } from "@/config/env";
import { PORTFOLIO_TOKENS } from "@/lib/portfolioTokens";
import { cryptoLogoUrl } from "@/lib/assetLogos";
import { isSignerConfigured, useSignerWallet } from "@/lib/signer";
import PrivyEoaSync from "@/components/wallet/PrivyEoaSync";
import TradingAccountPicker, {
  useTradingAccount,
} from "@/components/wallet/TradingAccountPicker";
import { Button } from "@/components/ui/button";
import AssetIcon from "@/components/ui/AssetIcon";
import {
  DashboardPage,
  PageAlert,
  Panel,
  PanelHeader,
} from "@/components/dashboard/PageShell";

function marketLogo(market: MorphoMarketDetail): { src: string | null; color: string } {
  const symbol = market.collateralAsset.symbol;
  const token = PORTFOLIO_TOKENS.find(
    (t) => t.symbol.toLowerCase() === symbol.toLowerCase(),
  );
  return {
    src: cryptoLogoUrl(symbol),
    color: token?.color ?? "#6366F1",
  };
}

function borrowApy(market: MorphoMarketDetail): number {
  return market.avgNetBorrowApy || market.borrowApy;
}

export default function BorrowMarketDetailView({ marketId }: { marketId: string }) {
  const {
    kind,
    setKind,
    scaAddress,
    accountOpts,
    isTreasury,
    treasuryReady,
    personal,
    treasury,
  } = useTradingAccount();
  const signerWallet = useSignerWallet();

  const [detail, setDetail] = useState<MorphoMarketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<"borrow" | "repay">("borrow");
  const [collateralAmount, setCollateralAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [repayAmount, setRepayAmount] = useState("");
  const [collateralBal, setCollateralBal] = useState(0);
  const [usdcBal, setUsdcBal] = useState(0);
  const [positionCollateral, setPositionCollateral] = useState(0);
  const [borrowUsd, setBorrowUsd] = useState(0);
  const [collateralUsd, setCollateralUsd] = useState(0);
  const [hasDebt, setHasDebt] = useState(false);
  const [positionLoading, setPositionLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [proposedHash, setProposedHash] = useState<string | null>(null);

  const loadDetail = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const next = await fetchBorrowMarketDetail(marketId);
        if (!next) {
          setDetail(null);
          setError("Market not found on Morpho.");
        } else {
          setDetail(next);
        }
      } catch (e) {
        setError(errMessage(e));
        setDetail(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [marketId],
  );

  const loadPosition = useCallback(async () => {
    if (!scaAddress || !detail) {
      setCollateralBal(0);
      setUsdcBal(0);
      setPositionCollateral(0);
      setBorrowUsd(0);
      setCollateralUsd(0);
      setHasDebt(false);
      return;
    }
    setPositionLoading(true);
    try {
      const mp = toMorphoMarketParams(detail);
      const [cBal, uBal, display] = await Promise.all([
        readErc20Balance(
          detail.collateralAsset.address as `0x${string}`,
          scaAddress as `0x${string}`,
          detail.collateralAsset.decimals,
        ),
        readErc20Balance(
          detail.loanAsset.address as `0x${string}`,
          scaAddress as `0x${string}`,
          detail.loanAsset.decimals,
        ),
        readMorphoUserPositionDisplay(mp, scaAddress as `0x${string}`),
      ]);
      setCollateralBal(cBal);
      setUsdcBal(uBal);
      setPositionCollateral(display.collateralFormatted);
      setBorrowUsd(display.borrowAssetsUsd);
      setCollateralUsd(display.collateralUsd);
      setHasDebt(display.hasDebt);
    } catch {
      setCollateralBal(0);
      setUsdcBal(0);
      setPositionCollateral(0);
      setBorrowUsd(0);
      setCollateralUsd(0);
      setHasDebt(false);
    } finally {
      setPositionLoading(false);
    }
  }, [scaAddress, detail]);

  useEffect(() => {
    void loadDetail(false);
  }, [loadDetail]);

  useEffect(() => {
    void loadPosition();
  }, [loadPosition]);

  const apy = detail ? borrowApy(detail) : 0;
  const maxLltv = detail ? parseMarketMaxLltv(detail.lltv) : null;
  const userLtv = computeUserLtvRatio(borrowUsd, collateralUsd);
  const risk =
    userLtv != null && maxLltv != null ? ltvRiskLevel(userLtv, maxLltv) : "safe";
  const ltvFillPct =
    userLtv != null && maxLltv != null ? Math.min(100, (userLtv / maxLltv) * 100) : 0;

  const canBorrow =
    !!detail &&
    !!scaAddress &&
    !!signerWallet &&
    (isTreasury || isPimlicoConfigured()) &&
    !!detail.oracleAddress &&
    !!detail.irmAddress &&
    Number(collateralAmount) > 0 &&
    Number(borrowAmount) > 0 &&
    Number(collateralAmount) <= collateralBal &&
    !busy;

  const canRepay =
    !!detail &&
    !!scaAddress &&
    !!signerWallet &&
    (isTreasury || isPimlicoConfigured()) &&
    hasDebt &&
    (Number(repayAmount) > 0 || repayAmount === "") &&
    !busy;

  const submit = async () => {
    if (!detail || !scaAddress || !signerWallet) return;
    setActionError(null);
    setTxHash(null);
    setProposedHash(null);
    setBusy(true);
    try {
      const calls =
        mode === "borrow"
          ? await buildMorphoBorrowCalls({
              market: detail,
              collateralAmount: Number(collateralAmount),
              borrowAmount: Number(borrowAmount),
              onBehalf: scaAddress as `0x${string}`,
            })
          : await buildMorphoRepayCalls({
              market: detail,
              onBehalf: scaAddress as `0x${string}`,
              repayAll: !(Number(repayAmount) > 0),
              repayAmount: Number(repayAmount) > 0 ? Number(repayAmount) : undefined,
            });
      const provider = (await signerWallet.getEthereumProvider()) as {
        request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      };
      const result = await submitCallsSmartOrTreasury({
        isTreasury,
        eip1193Provider: provider,
        scaAddress: scaAddress as `0x${string}`,
        eoaAddress: personal.eoaAddress ?? "",
        treasurySafe: treasury.scaAddress,
        calls,
        accountOpts,
      });
      if (result.kind === "proposed") {
        setProposedHash(result.safeTxHash);
      } else {
        setTxHash(result.txHash);
        await loadPosition();
      }
      setCollateralAmount("");
      setBorrowAmount("");
      setRepayAmount("");
      void loadDetail(true);
    } catch (e) {
      setActionError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const riskColor =
    risk === "danger"
      ? "text-red-500"
      : risk === "warning"
        ? "text-amber-500"
        : "text-emerald-500";
  const riskBar =
    risk === "danger"
      ? "bg-red-500"
      : risk === "warning"
        ? "bg-amber-500"
        : "bg-emerald-500";

  if (loading && !detail) {
    return (
      <DashboardPage>
        <div className="mb-6 h-8 w-40 animate-pulse rounded-lg bg-[var(--kura-bg-lighter)]" />
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="h-72 animate-pulse rounded-2xl bg-[var(--kura-bg-lighter)]" />
          <div className="h-72 animate-pulse rounded-2xl bg-[var(--kura-bg-lighter)]" />
        </div>
      </DashboardPage>
    );
  }

  if (!detail) {
    return (
      <DashboardPage variant="narrow">
        <Link
          href="/dashboard/borrow"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--kura-text-secondary)] hover:text-[var(--kura-text)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Borrow
        </Link>
        <PageAlert variant="warning">{error ?? "Market not found."}</PageAlert>
      </DashboardPage>
    );
  }

  const logo = marketLogo(detail);
  const name = collateralDisplayName(detail.collateralAsset.symbol);
  const borrowedPct =
    detail.supplyAssetsUsd > 0
      ? (detail.borrowAssetsUsd / detail.supplyAssetsUsd) * 100
      : 0;
  const liquidityPct =
    detail.supplyAssetsUsd > 0
      ? (detail.liquidityAssetsUsd / detail.supplyAssetsUsd) * 100
      : 0;

  return (
    <DashboardPage>
      {isSignerConfigured ? (
        <PrivyEoaSync
          onEoa={personal.applyEoaAddress}
          persistedEoa={personal.record.walletAddress}
        />
      ) : null}

      <Link
        href="/dashboard/borrow"
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--kura-text-secondary)] transition-colors hover:text-[var(--kura-text)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Borrow
      </Link>

      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <AssetIcon
            src={logo.src}
            label={detail.collateralAsset.symbol}
            color={logo.color}
            size={48}
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--kura-text-secondary)]">
              Morpho Borrow · Base
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--kura-text)]">
              {name} Loan
            </h1>
            <p className="mt-1 text-sm text-[var(--kura-text-secondary)]">
              {detail.collateralAsset.symbol} / {detail.loanAsset.symbol}
              {" · "}
              <span className="font-mono text-xs">{truncateAddress(detail.marketId, 8, 6)}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={morphoMarketAppUrl(detail.marketId)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--kura-border)] px-3 py-1.5 text-xs font-semibold text-[var(--kura-text-secondary)] hover:text-[var(--kura-text)]"
          >
            Morpho
            <ExternalLink className="h-3 w-3" />
          </a>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-full text-[var(--kura-text-secondary)]"
            disabled={refreshing}
            onClick={() => {
              void loadDetail(true);
              void loadPosition();
            }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </header>

      {error ? <PageAlert variant="warning">{error}</PageAlert> : null}

      <section className="mb-4 grid gap-3 sm:grid-cols-3">
        <Panel padding="md">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
            Borrow APY
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-500">
            {formatApy(apy)}
          </p>
          <p className="mt-1 text-[11px] text-[var(--kura-text-secondary)]">
            Supply APY {formatApy(detail.supplyApy)}
          </p>
        </Panel>
        <Panel padding="md">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
            Liquidity
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--kura-text)]">
            {formatTvl(detail.liquidityAssetsUsd)}
          </p>
          <p className="mt-1 text-[11px] text-[var(--kura-text-secondary)]">
            Util {formatUtilization(detail.utilization)} · Max LLTV {formatLltv(detail.lltv)}
          </p>
        </Panel>
        <Panel padding="md">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
            Your holding
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--kura-text)]">
            {positionLoading ? "…" : formatUsd(borrowUsd)}
          </p>
          <p className="mt-1 text-[11px] text-[var(--kura-text-secondary)]">
            {positionLoading
              ? "…"
              : hasDebt || positionCollateral > 0
                ? `Collateral ${positionCollateral.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${detail.collateralAsset.symbol} · ${formatUsd(collateralUsd)}`
                : `No open position · ${isTreasury ? treasury.name ?? "Treasury" : "Smart Wallet"}`}
          </p>
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          <Panel padding="md">
            <PanelHeader
              title="Holdings · market pool"
              description="How liquidity is used in this Morpho Blue market"
            />
            <ul className="space-y-3">
              {[
                {
                  id: "borrowed",
                  label: "Total borrowed",
                  subtitle: `${detail.loanAsset.symbol} debt outstanding`,
                  usd: detail.borrowAssetsUsd,
                  pct: borrowedPct,
                },
                {
                  id: "liquidity",
                  label: "Available liquidity",
                  subtitle: `Ready to borrow`,
                  usd: detail.liquidityAssetsUsd,
                  pct: liquidityPct,
                },
                {
                  id: "collateral",
                  label: "Collateral locked",
                  subtitle: `${detail.collateralAsset.symbol} posted by borrowers`,
                  usd: detail.collateralAssetsUsd,
                  pct: 0,
                },
                {
                  id: "supply",
                  label: "Total supply",
                  subtitle: `Lenders’ ${detail.loanAsset.symbol}`,
                  usd: detail.supplyAssetsUsd,
                  pct: 100,
                },
              ].map((row) => (
                <li key={row.id}>
                  <div className="mb-1 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--kura-text)]">
                        {row.label}
                      </p>
                      <p className="truncate text-[11px] text-[var(--kura-text-secondary)]">
                        {row.subtitle}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-[var(--kura-text)]">
                        {formatTvl(row.usd)}
                      </p>
                      {row.id !== "collateral" && row.id !== "supply" ? (
                        <p className="text-[11px] tabular-nums text-[var(--kura-text-secondary)]">
                          {row.pct >= 10 ? `${row.pct.toFixed(1)}%` : `${row.pct.toFixed(2)}%`} of
                          supply
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {row.id === "borrowed" || row.id === "liquidity" ? (
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--kura-bg-lighter)]">
                      <div
                        className={`h-full rounded-full ${
                          row.id === "borrowed"
                            ? "bg-amber-500/70"
                            : "bg-[var(--kura-primary)]/70"
                        }`}
                        style={{ width: `${Math.min(100, Math.max(0.5, row.pct))}%` }}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            {hasDebt && userLtv != null ? (
              <div className="mt-5 rounded-xl border border-[var(--kura-border)] bg-[var(--kura-bg-light)] px-3.5 py-3">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--kura-text-secondary)]">Your LTV</span>
                  <span className={`font-semibold tabular-nums ${riskColor}`}>
                    {formatUserLtvPercent(userLtv)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--kura-bg-lighter)]">
                  <div
                    className={`h-full rounded-full ${riskBar}`}
                    style={{ width: `${ltvFillPct}%` }}
                  />
                </div>
                {maxLltv != null ? (
                  <p className="mt-1.5 text-[11px] text-[var(--kura-text-secondary)]">
                    Max LLTV {formatUserLtvPercent(maxLltv)} · Liquidation risk rises as you approach
                    the limit
                  </p>
                ) : null}
              </div>
            ) : null}
          </Panel>

          <Panel padding="md">
            <PanelHeader
              title="Cost & yield sources"
              description="What borrowers pay and what lenders earn on this market"
            />
            {detail.costSources.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--kura-text-secondary)]">
                No rate breakdown available.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--kura-border)]">
                {detail.costSources.map((src) => (
                  <li
                    key={src.id}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--kura-text)]">{src.label}</p>
                      {src.subtitle ? (
                        <p className="text-[11px] text-[var(--kura-text-secondary)]">
                          {src.subtitle}
                        </p>
                      ) : null}
                    </div>
                    <p
                      className={`shrink-0 text-sm font-semibold tabular-nums ${
                        src.id.startsWith("borrow") && src.kind === "native"
                          ? "text-amber-500"
                          : src.kind === "reward"
                            ? "text-amber-500"
                            : "text-emerald-500"
                      }`}
                    >
                      {src.displayValue
                        ? src.displayValue
                        : src.apr == null
                          ? "—"
                          : formatApy(Math.abs(src.apr))}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex items-center justify-between rounded-xl border border-[var(--kura-border)] bg-[var(--kura-bg-light)] px-3.5 py-2.5">
              <span className="text-xs font-semibold text-[var(--kura-text-secondary)]">
                Your borrow rate
              </span>
              <span className="text-sm font-semibold tabular-nums text-amber-500">
                {formatApy(apy)}
              </span>
            </div>
          </Panel>
        </div>

        <Panel padding="lg" className="h-fit lg:sticky lg:top-6">
          <PanelHeader
            title={mode === "borrow" ? "Borrow" : "Repay"}
            description={`${detail.loanAsset.symbol} against ${detail.collateralAsset.symbol} · ${
              isTreasury ? "Treasury Safe" : "Smart Wallet"
            }`}
          />

          <TradingAccountPicker
            kind={kind}
            onChange={setKind}
            treasuryReady={treasuryReady}
            treasuryAddress={treasury.scaAddress}
            smartAddress={personal.scaAddress}
            treasuryLabel={treasury.name}
          />

          <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-[var(--kura-bg-lighter)] p-1">
            <button
              type="button"
              onClick={() => setMode("borrow")}
              className={`rounded-lg py-2 text-sm font-semibold ${
                mode === "borrow"
                  ? "bg-emerald-500 text-white"
                  : "text-[var(--kura-text-secondary)]"
              }`}
            >
              Borrow
            </button>
            <button
              type="button"
              onClick={() => setMode("repay")}
              className={`rounded-lg py-2 text-sm font-semibold ${
                mode === "repay"
                  ? "bg-[var(--kura-text)] text-[var(--kura-bg)]"
                  : "text-[var(--kura-text-secondary)]"
              }`}
            >
              Repay
            </button>
          </div>

          {mode === "borrow" ? (
            <>
              <div className="mt-4 rounded-xl border border-[var(--kura-border)] p-3">
                <div className="mb-1.5 flex justify-between text-[11px] text-[var(--kura-text-secondary)]">
                  <span>Collateral</span>
                  <button
                    type="button"
                    className="font-semibold text-[var(--kura-primary)]"
                    onClick={() =>
                      setCollateralAmount(
                        collateralBal > 0
                          ? String(Math.floor(collateralBal * 1e6) / 1e6)
                          : "0",
                      )
                    }
                  >
                    MAX {collateralBal.toFixed(4)}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={collateralAmount}
                    onChange={(e) => setCollateralAmount(e.target.value)}
                    placeholder="0.00"
                    className="min-w-0 flex-1 bg-transparent text-xl font-semibold outline-none"
                  />
                  <span className="text-xs font-semibold">{detail.collateralAsset.symbol}</span>
                </div>
              </div>
              <div className="mt-3 rounded-xl border border-[var(--kura-border)] p-3">
                <p className="mb-1.5 text-[11px] text-[var(--kura-text-secondary)]">Borrow</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={borrowAmount}
                    onChange={(e) => setBorrowAmount(e.target.value)}
                    placeholder="0.00"
                    className="min-w-0 flex-1 bg-transparent text-xl font-semibold outline-none"
                  />
                  <span className="text-xs font-semibold">{detail.loanAsset.symbol}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="mt-4 rounded-xl border border-[var(--kura-border)] p-3">
              <div className="mb-1.5 flex justify-between text-[11px] text-[var(--kura-text-secondary)]">
                <span>Repay amount (empty = repay all)</span>
                <span>
                  {detail.loanAsset.symbol} {usdcBal.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={repayAmount}
                  onChange={(e) => setRepayAmount(e.target.value)}
                  placeholder="Repay all"
                  className="min-w-0 flex-1 bg-transparent text-xl font-semibold outline-none"
                />
                <span className="text-xs font-semibold">{detail.loanAsset.symbol}</span>
              </div>
              {!hasDebt ? (
                <p className="mt-1.5 text-[11px] text-[var(--kura-text-secondary)]">
                  No outstanding debt.
                </p>
              ) : null}
            </div>
          )}

          <dl className="mt-3 space-y-1.5 text-xs text-[var(--kura-text-secondary)]">
            <div className="flex justify-between">
              <dt>Wallet {detail.collateralAsset.symbol}</dt>
              <dd className="font-semibold tabular-nums text-[var(--kura-text)]">
                {collateralBal.toFixed(4)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Wallet {detail.loanAsset.symbol}</dt>
              <dd className="font-semibold tabular-nums text-[var(--kura-text)]">
                {usdcBal.toFixed(2)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Debt</dt>
              <dd className="font-semibold tabular-nums text-[var(--kura-text)]">
                {formatUsd(borrowUsd)}
              </dd>
            </div>
          </dl>

          {actionError ? (
            <p className="mt-3 text-xs text-[var(--kura-error-fg)]">{actionError}</p>
          ) : null}
          {txHash ? (
            <p className="mt-3 text-xs text-[var(--kura-success-fg)]">
              Done.{" "}
              <a
                href={`https://basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Basescan
              </a>
            </p>
          ) : null}
          {proposedHash ? (
            <p className="mt-3 text-xs text-[var(--kura-success-fg)]">
              Proposed to Treasury.{" "}
              <Link href="/dashboard/approvals" className="font-semibold underline">
                Open Approvals to sign
              </Link>
            </p>
          ) : null}

          <Button
            type="button"
            disabled={mode === "borrow" ? !canBorrow : !canRepay}
            onClick={() => void submit()}
            className="mt-4 w-full rounded-full"
            size="lg"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isTreasury
              ? mode === "borrow"
                ? "Propose borrow"
                : "Propose repay"
              : mode === "borrow"
                ? "Borrow"
                : "Repay"}
          </Button>
        </Panel>
      </section>
    </DashboardPage>
  );
}
