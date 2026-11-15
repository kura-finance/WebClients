"use client";

import React, { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  FileSpreadsheet,
  RefreshCw,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useFinanceStore } from "@/store/useFinanceStore";
import { useOrgStore } from "@/store/useOrgStore";
import { useTreasuryWallet } from "@/hooks/useTreasuryWallet";
import { useWalletActivity } from "@/hooks/useWalletActivity";
import { Button } from "@/components/ui/button";
import TreasurySwitcher from "@/components/wallet/TreasurySwitcher";
import {
  Chip,
  DashboardPage,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/dashboard/PageShell";
import CashFlowChartCard from "@/dashboard/_components/trackfi/CashFlowChartCard";
import { features } from "@/config/features";

type Period = "mtd" | "last_month" | "qtd" | "ytd";

function formatUsd(value: number, hidden = false): string {
  if (hidden) return "••••••";
  const sign = value < 0 ? "−" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function startOfPeriod(period: Period): Date {
  const now = new Date();
  if (period === "mtd") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  if (period === "last_month") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  }
  if (period === "qtd") {
    const q = Math.floor(now.getUTCMonth() / 3) * 3;
    return new Date(Date.UTC(now.getUTCFullYear(), q, 1));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
}

function endOfPeriod(period: Period): Date {
  const now = new Date();
  if (period === "last_month") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59));
  }
  return now;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportView() {
  const isBalanceHidden = useAppStore((s) => s.isBalanceHidden);
  const companyName = useOrgStore((s) => s.companyName);
  const bankAccounts = useFinanceStore((s) => s.accounts);
  const plaidTx = useFinanceStore((s) => s.transactions);
  const treasury = useTreasuryWallet();
  const { activities, loading: activityLoading, refresh: refreshActivity } = useWalletActivity(
    treasury.scaAddress,
  );

  const [period, setPeriod] = useState<Period>("mtd");

  const bankCash = useMemo(
    () =>
      bankAccounts.reduce((sum, account) => {
        const bal = Number(account.balance) || 0;
        return sum + (account.type === "credit" ? 0 : bal);
      }, 0),
    [bankAccounts],
  );

  const range = useMemo(() => {
    const from = startOfPeriod(period);
    const to = endOfPeriod(period);
    return { from, to };
  }, [period]);

  const periodActivities = useMemo(() => {
    return activities.filter((a) => {
      const t = new Date(a.timestamp);
      return t >= range.from && t <= range.to;
    });
  }, [activities, range]);

  const inflow = useMemo(
    () => periodActivities.filter((a) => a.direction === "in").reduce((s, a) => s + a.amount, 0),
    [periodActivities],
  );

  const outflow = useMemo(
    () =>
      periodActivities
        .filter((a) => a.direction === "out")
        .reduce((s, a) => s + a.amount, 0),
    [periodActivities],
  );

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of periodActivities.filter((x) => x.direction === "out")) {
      const key = a.title;
      map.set(key, (map.get(key) ?? 0) + a.amount);
    }
    return [...map.entries()]
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
  }, [periodActivities]);

  const exportTransactions = () => {
    const rows: string[][] = [
      ["Date", "Type", "Description", "Direction", "Amount", "Asset", "Status"],
    ];
    for (const a of periodActivities) {
      rows.push([
        a.timestamp,
        a.source,
        a.title,
        a.direction,
        String(a.amount),
        a.tokenSymbol,
        a.statusLabel ?? "",
      ]);
    }
    downloadCsv(`kura-transactions-${period}.csv`, rows);
  };

  const exportStatement = () => {
    const rows: string[][] = [
      ["Kura Treasury Statement"],
      ["Treasury", treasury.name || companyName],
      ["Period", period],
      ["Generated", new Date().toISOString()],
      [],
      ["Metric", "Amount (USD)"],
      ["Inflow", String(inflow)],
      ["Outflow", String(outflow)],
      ["Net", String(inflow - outflow)],
      ...(features.trackFi ? [["Connected bank cash", String(bankCash)]] : []),
    ];
    downloadCsv(`kura-statement-${period}.csv`, rows);
  };

  const periods: { id: Period; label: string }[] = [
    { id: "mtd", label: "This month" },
    { id: "last_month", label: "Last month" },
    { id: "qtd", label: "Quarter" },
    { id: "ytd", label: "Year to date" },
  ];

  return (
    <DashboardPage>
      <PageHeader
        eyebrow="Report"
        title={treasury.name ? `${treasury.name} statements` : "Statements & activity"}
        description={
          <>
            Activity for the active Treasury, period summaries, and CSV exports.
            {!treasury.bound ? " Add a Treasury to see on-chain ledger entries." : ""}
          </>
        }
        actions={
          <>
            <TreasurySwitcher
              treasuries={treasury.treasuries}
              activeId={treasury.treasuryId}
              onSelect={treasury.setActiveTreasury}
            />
            <Button size="sm" variant="outline" className="rounded-full" onClick={exportStatement}>
              <Download className="h-3.5 w-3.5" />
              Statement
            </Button>
            <Button size="sm" variant="outline" className="rounded-full" onClick={exportTransactions}>
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Export CSV
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full"
              onClick={() => void refreshActivity()}
              disabled={activityLoading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${activityLoading ? "animate-spin" : ""}`} />
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {periods.map((p) => (
          <Chip key={p.id} active={period === p.id} onClick={() => setPeriod(p.id)}>
            {p.label}
          </Chip>
        ))}
      </div>

      {/* Summary metrics */}
      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <Panel padding="md">
          <div className="mb-2 flex items-center gap-2 text-[var(--kura-text-secondary)]">
            <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-[11px] font-semibold uppercase tracking-wide">Inflow</span>
          </div>
          <p className="text-2xl font-semibold tabular-nums text-[var(--kura-text)]">
            {formatUsd(inflow, isBalanceHidden)}
          </p>
        </Panel>
        <Panel padding="md">
          <div className="mb-2 flex items-center gap-2 text-[var(--kura-text-secondary)]">
            <ArrowUpRight className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wide">Outflow</span>
          </div>
          <p className="text-2xl font-semibold tabular-nums text-[var(--kura-text)]">
            {formatUsd(outflow, isBalanceHidden)}
          </p>
        </Panel>
        <Panel padding="md">
          <div className="mb-2 flex items-center gap-2 text-[var(--kura-text-secondary)]">
            <span className="text-[11px] font-semibold uppercase tracking-wide">Net</span>
          </div>
          <p
            className={`text-2xl font-semibold tabular-nums ${
              inflow - outflow >= 0 ? "text-emerald-500" : "text-[var(--kura-text)]"
            }`}
          >
            {formatUsd(inflow - outflow, isBalanceHidden)}
          </p>
        </Panel>
      </section>

      {features.trackFi ? (
        <CashFlowChartCard totalBalance={bankCash} accountCount={bankAccounts.length} days={30} />
      ) : null}

      <section className="mt-6">
        <Panel padding="md">
          <PanelHeader
            title="Top spend"
            description="Outflows in this period"
          />
          {categoryBreakdown.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--kura-text-secondary)]">
              No spend recorded for this period.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--kura-border)]">
              {categoryBreakdown.map((row) => {
                const max = categoryBreakdown[0]?.amount || 1;
                return (
                  <li key={row.label} className="py-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-[var(--kura-text)]">{row.label}</p>
                      <p className="shrink-0 text-sm font-semibold tabular-nums text-[var(--kura-text)]">
                        {formatUsd(row.amount, isBalanceHidden)}
                      </p>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--kura-bg-lighter)]">
                      <div
                        className="h-full rounded-full bg-[var(--kura-primary)]/70"
                        style={{ width: `${Math.max(6, (row.amount / max) * 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </section>

      {/* Ledger */}
      <Panel padding="none" className="mt-6">
        <div className="border-b border-[var(--kura-border)] px-5 py-4">
          <h2 className="text-base font-semibold text-[var(--kura-text)]">Transaction ledger</h2>
          <p className="mt-0.5 text-xs text-[var(--kura-text-secondary)]">
            On-chain Treasury Safe activity for the selected period
            {plaidTx.length > 0 ? ` · ${plaidTx.length} bank txs synced` : ""}
          </p>
        </div>
        {activityLoading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-[var(--kura-bg-lighter)]" />
            ))}
          </div>
        ) : periodActivities.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--kura-text-secondary)]">
            No treasury activity in this period.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--kura-border)]">
            {periodActivities.slice(0, 20).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--kura-text)]">{a.title}</p>
                  <p className="truncate text-[11px] text-[var(--kura-text-secondary)]">
                    {new Date(a.timestamp).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                    {" · "}
                    {a.subtitle}
                  </p>
                </div>
                <p
                  className={`shrink-0 text-sm font-semibold tabular-nums ${
                    a.direction === "in" ? "text-emerald-500" : "text-[var(--kura-text)]"
                  }`}
                >
                  {isBalanceHidden
                    ? "••••"
                    : `${a.direction === "in" ? "+" : a.direction === "out" ? "−" : ""}${formatUsd(a.amount).replace("$", "")} ${a.tokenSymbol}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </DashboardPage>
  );
}
