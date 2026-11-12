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
  EARN_SERVICE_FEE_RATE,
  effectiveEarnNetApy,
  fetchEarnVaultDetail,
  formatApy,
  formatTvl,
  type MorphoVaultDetail,
} from "@/lib/morphoApi";
import {
  buildMorphoDepositCalls,
  buildMorphoWithdrawCalls,
  readErc20Balance,
  readVaultPosition,
  resolveDepositVault,
} from "@/lib/morphoEarn";
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

function vaultAssetLogo(detail: MorphoVaultDetail): { src: string | null; color: string } {
  const token = PORTFOLIO_TOKENS.find(
    (t) => t.symbol.toLowerCase() === detail.assetSymbol.toLowerCase(),
  );
  return {
    src: detail.imageUrl || cryptoLogoUrl(detail.assetSymbol),
    color: token?.color ?? "#6366F1",
  };
}

function formatPct(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return "—";
  if (pct >= 10) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(2)}%`;
}

export default function EarnVaultDetailView({ address }: { address: string }) {
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

  const [detail, setDetail] = useState<MorphoVaultDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [assetBal, setAssetBal] = useState(0);
  const [vaultBal, setVaultBal] = useState(0);
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
        const next = await fetchEarnVaultDetail(address);
        if (!next) {
          setDetail(null);
          setError("Vault not found on Morpho.");
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
    [address],
  );

  const loadPosition = useCallback(async () => {
    if (!scaAddress || !detail) {
      setAssetBal(0);
      setVaultBal(0);
      return;
    }
    setPositionLoading(true);
    try {
      const { depositAddress } = resolveDepositVault(detail.address);
      const [a, pos] = await Promise.all([
        readErc20Balance(
          detail.assetAddress as `0x${string}`,
          scaAddress as `0x${string}`,
          detail.assetDecimals,
        ),
        readVaultPosition(
          depositAddress,
          scaAddress as `0x${string}`,
          detail.assetDecimals,
        ),
      ]);
      setAssetBal(a);
      setVaultBal(pos.assetsFormatted);
    } catch {
      setAssetBal(0);
      setVaultBal(0);
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

  const numeric = Number(amount);
  const available = mode === "deposit" ? assetBal : vaultBal;
  const canSubmit =
    !!detail &&
    !!scaAddress &&
    !!signerWallet &&
    (isTreasury || isPimlicoConfigured()) &&
    numeric > 0 &&
    numeric <= available &&
    !busy;

  const holdingUsd =
    vaultBal *
    (detail?.assetSymbol.toUpperCase().includes("USD")
      ? 1
      : detail && detail.sharePriceUsd > 0
        ? detail.sharePriceUsd
        : 1);

  const submit = async () => {
    if (!detail || !scaAddress || !signerWallet || !canSubmit) return;
    setActionError(null);
    setTxHash(null);
    setProposedHash(null);
    setBusy(true);
    try {
      const calls =
        mode === "deposit"
          ? await buildMorphoDepositCalls({
              innerVaultAddress: detail.address,
              assetAddress: detail.assetAddress as `0x${string}`,
              assetDecimals: detail.assetDecimals,
              amount: numeric,
              receiver: scaAddress as `0x${string}`,
            })
          : await buildMorphoWithdrawCalls({
              innerVaultAddress: detail.address,
              assetDecimals: detail.assetDecimals,
              owner: scaAddress as `0x${string}`,
              amountAssets: numeric,
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
      setAmount("");
      void loadDetail(true);
    } catch (e) {
      setActionError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

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
          href="/dashboard/earn"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--kura-text-secondary)] hover:text-[var(--kura-text)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Earn
        </Link>
        <PageAlert variant="warning">{error ?? "Vault not found."}</PageAlert>
      </DashboardPage>
    );
  }

  const logo = vaultAssetLogo(detail);
  const netApy = effectiveEarnNetApy(detail.netApy);

  return (
    <DashboardPage>
      {isSignerConfigured ? (
        <PrivyEoaSync
          onEoa={personal.applyEoaAddress}
          persistedEoa={personal.record.walletAddress}
        />
      ) : null}

      <Link
        href="/dashboard/earn"
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--kura-text-secondary)] transition-colors hover:text-[var(--kura-text)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Earn
      </Link>

      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <AssetIcon
            src={logo.src}
            label={detail.assetSymbol}
            color={logo.color}
            size={48}
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--kura-text-secondary)]">
              Morpho Earn · Base
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--kura-text)]">
              {detail.name}
            </h1>
            <p className="mt-1 text-sm text-[var(--kura-text-secondary)]">
              {detail.symbol} · {detail.assetSymbol}
              {" · "}
              <span className="font-mono text-xs">{truncateAddress(detail.address)}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`https://app.morpho.org/base/vault/${detail.address}`}
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
            Net APY
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-500">
            {formatApy(netApy)}
          </p>
          <p className="mt-1 text-[11px] text-[var(--kura-text-secondary)]">
            After {(EARN_SERVICE_FEE_RATE * 100).toFixed(0)}% Kura fee · Morpho {formatApy(detail.netApy)}
          </p>
        </Panel>
        <Panel padding="md">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
            TVL
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--kura-text)]">
            {formatTvl(detail.totalAssetsUsd)}
          </p>
          <p className="mt-1 text-[11px] text-[var(--kura-text-secondary)]">
            Idle {formatTvl(detail.idleAssetsUsd)}
          </p>
        </Panel>
        <Panel padding="md">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
            Your holding
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--kura-text)]">
            {positionLoading
              ? "…"
              : `${vaultBal.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${detail.assetSymbol}`}
          </p>
          <p className="mt-1 text-[11px] text-[var(--kura-text-secondary)]">
            ≈ {positionLoading ? "…" : formatUsd(holdingUsd)} ·{" "}
            {isTreasury ? treasury.name ?? "Treasury" : "Smart Wallet"}
          </p>
        </Panel>
      </section>

      {detail.description ? (
        <Panel padding="md" className="mb-4">
          <p className="text-sm leading-relaxed text-[var(--kura-text-secondary)]">
            {detail.description}
          </p>
        </Panel>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          <Panel padding="md">
            <PanelHeader
              title="Holdings · allocation"
              description="Where this vault deploys liquidity on Morpho Blue"
            />
            {detail.allocations.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--kura-text-secondary)]">
                No allocation breakdown available.
              </p>
            ) : (
              <ul className="space-y-3">
                {detail.allocations.map((row) => (
                  <li key={row.id}>
                    <div className="mb-1 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--kura-text)]">
                          {row.label}
                        </p>
                        <p className="truncate text-[11px] text-[var(--kura-text-secondary)]">
                          {row.subtitle}
                          {row.supplyApy > 0 ? ` · Supply ${formatApy(row.supplyApy)}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums text-[var(--kura-text)]">
                          {formatTvl(row.supplyAssetsUsd)}
                        </p>
                        <p className="text-[11px] tabular-nums text-[var(--kura-text-secondary)]">
                          {formatPct(row.pct)}
                        </p>
                      </div>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--kura-bg-lighter)]">
                      <div
                        className="h-full rounded-full bg-[var(--kura-primary)]/70"
                        style={{ width: `${Math.min(100, Math.max(0.5, row.pct))}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel padding="md">
            <PanelHeader
              title="Yield sources"
              description="What contributes to the displayed net APY"
            />
            {detail.yieldSources.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--kura-text-secondary)]">
                No yield source breakdown available.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--kura-border)]">
                {detail.yieldSources.map((src) => (
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
                        src.kind === "fee"
                          ? "text-[var(--kura-text-secondary)]"
                          : src.kind === "reward"
                            ? "text-amber-500"
                            : "text-emerald-500"
                      }`}
                    >
                      {src.displayValue
                        ? src.displayValue
                        : src.apr == null
                          ? "—"
                          : `${src.apr < 0 ? "−" : "+"}${formatApy(Math.abs(src.apr))}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex items-center justify-between rounded-xl border border-[var(--kura-border)] bg-[var(--kura-bg-light)] px-3.5 py-2.5">
              <span className="text-xs font-semibold text-[var(--kura-text-secondary)]">
                Your net APY
              </span>
              <span className="text-sm font-semibold tabular-nums text-emerald-500">
                {formatApy(netApy)}
              </span>
            </div>
          </Panel>
        </div>

        <Panel padding="lg" className="h-fit lg:sticky lg:top-6">
          <PanelHeader
            title={mode === "deposit" ? "Deposit" : "Withdraw"}
            description={`${detail.assetSymbol} via ${isTreasury ? "Treasury Safe" : "Smart Wallet"}`}
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
              onClick={() => setMode("deposit")}
              className={`rounded-lg py-2 text-sm font-semibold ${
                mode === "deposit"
                  ? "bg-emerald-500 text-white"
                  : "text-[var(--kura-text-secondary)]"
              }`}
            >
              Deposit
            </button>
            <button
              type="button"
              onClick={() => setMode("withdraw")}
              className={`rounded-lg py-2 text-sm font-semibold ${
                mode === "withdraw"
                  ? "bg-[var(--kura-text)] text-[var(--kura-bg)]"
                  : "text-[var(--kura-text-secondary)]"
              }`}
            >
              Withdraw
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-[var(--kura-border)] p-3">
            <div className="mb-1.5 flex justify-between text-[11px] text-[var(--kura-text-secondary)]">
              <span>Amount</span>
              <button
                type="button"
                className="font-semibold text-[var(--kura-primary)]"
                onClick={() =>
                  setAmount(available > 0 ? String(Math.floor(available * 100) / 100) : "0")
                }
              >
                MAX {available.toFixed(2)}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="min-w-0 flex-1 bg-transparent text-xl font-semibold outline-none"
              />
              <span className="text-xs font-semibold">{detail.assetSymbol}</span>
            </div>
          </div>

          <dl className="mt-3 space-y-1.5 text-xs text-[var(--kura-text-secondary)]">
            <div className="flex justify-between">
              <dt>Wallet {detail.assetSymbol}</dt>
              <dd className="font-semibold tabular-nums text-[var(--kura-text)]">
                {assetBal.toFixed(2)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Vault position</dt>
              <dd className="font-semibold tabular-nums text-[var(--kura-text)]">
                {vaultBal.toFixed(2)}
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
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="mt-4 w-full rounded-full"
            size="lg"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isTreasury
              ? mode === "deposit"
                ? "Propose deposit"
                : "Propose withdraw"
              : mode === "deposit"
                ? "Deposit"
                : "Withdraw"}
          </Button>
        </Panel>
      </section>
    </DashboardPage>
  );
}
