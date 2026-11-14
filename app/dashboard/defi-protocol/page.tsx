"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ChevronDown, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ICON_BACKGROUND_SRC } from "@/components/ui/AssetIcon";
import {
  fetchDeBankProtocolPositions,
  fetchLinkedDeBankAddresses,
  type DeBankProtocolPosition,
} from "@/lib/debankApi";
import {
  DashboardPage,
  PageAlert,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/dashboard/PageShell";
import AssetSegmentChartCard from "@/dashboard/_components/trackfi/AssetSegmentChartCard";
import { useAppStore } from "@/store/useAppStore";
import { useLoad } from "@/hooks/useLoad";

function formatCurrency(value: number, mask: boolean): string {
  if (mask) return "••••••";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatUnits(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

function formatShortAddress(value: string): string {
  if (!value) return "No address";
  if (value.length <= 10) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function resolveProtocolIcon(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (normalized) {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(normalized)}.fi&sz=128`;
  }
  return "https://www.google.com/s2/favicons?domain=debank.com&sz=128";
}

function ProtocolAvatar({ logo, name }: { logo?: string; name: string }) {
  const firstChar = name.slice(0, 1).toUpperCase();
  return (
    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--kura-border)]">
      <Image
        src={ICON_BACKGROUND_SRC}
        alt=""
        fill
        sizes="36px"
        className="object-cover"
        aria-hidden
        unoptimized
      />
      {logo ? (
        <div
          className="relative z-[1] h-full w-full bg-cover bg-center"
          style={{ backgroundImage: `url("${logo}")` }}
          aria-hidden="true"
        />
      ) : (
        <span className="relative z-[1] text-xs font-semibold text-white">
          {firstChar || "?"}
        </span>
      )}
    </div>
  );
}

const NO_ADDRESSES: string[] = [];
const NO_POSITIONS: DeBankProtocolPosition[] = [];

export default function DefiProtocolPage() {
  const isBalanceHidden = useAppStore((state) => state.isBalanceHidden);
  const [pickedAddress, setPickedAddress] = useState("");
  const [isAddressPickerOpen, setIsAddressPickerOpen] = useState(false);
  // Set right before a load that must bypass the server-side DeBank cache.
  const forceRefresh = useRef(false);

  const addressesQuery = useLoad({
    key: ["debank", "linked-addresses"],
    load: fetchLinkedDeBankAddresses,
    errorMessage: "Failed to load linked wallet addresses",
  });
  const linkedAddresses = addressesQuery.data ?? NO_ADDRESSES;
  const isLoadingAddresses = addressesQuery.loading;
  // The picked wallet while it is still linked, else the first linked one.
  const selectedAddress =
    pickedAddress && linkedAddresses.includes(pickedAddress)
      ? pickedAddress
      : (linkedAddresses[0] ?? "");

  const positionsQuery = useLoad({
    key: ["debank", "protocol-positions", selectedAddress.toLowerCase()],
    load: async () => {
      const force = forceRefresh.current;
      forceRefresh.current = false;
      const response = await fetchDeBankProtocolPositions(selectedAddress, force);
      return response.positions.filter((item) => item.usdValue > 0);
    },
    errorMessage: "Failed to load DeFi protocol assets",
    enabled: Boolean(selectedAddress),
  });
  const positions = selectedAddress ? (positionsQuery.data ?? NO_POSITIONS) : NO_POSITIONS;
  const isLoading = positionsQuery.fetching;
  const error = addressesQuery.error ?? (selectedAddress ? positionsQuery.error : null);

  const reloadPositions = positionsQuery.refresh;
  const refreshPositions = useCallback(() => {
    forceRefresh.current = true;
    void reloadPositions();
  }, [reloadPositions]);

  const applyAddress = useCallback((address: string) => {
    // Switching wallets loads its positions fresh.
    forceRefresh.current = true;
    setPickedAddress(address);
    setIsAddressPickerOpen(false);
  }, []);

  const { totalValue, sortedPositions } = useMemo(() => {
    const total = positions.reduce((sum, item) => sum + item.usdValue, 0);
    return {
      totalValue: total,
      sortedPositions: [...positions].sort((a, b) => b.usdValue - a.usdValue),
    };
  }, [positions]);

  return (
    <DashboardPage>
      <PageHeader
        eyebrow="DeFi"
        title="Protocol positions"
        description="LP and protocol balances from linked wallets. Native tokens stay in Crypto."
        actions={
          <>
            <div className="relative">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => setIsAddressPickerOpen((prev) => !prev)}
                disabled={isLoading || isLoadingAddresses || linkedAddresses.length === 0}
              >
                {formatShortAddress(selectedAddress)}
                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
              </Button>
              {isAddressPickerOpen ? (
                <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-[var(--kura-border)] bg-[var(--kura-surface)] p-2 shadow-lg">
                  <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
                    Switch address
                  </p>
                  {linkedAddresses.length === 0 ? (
                    <p className="px-2 py-3 text-sm text-[var(--kura-text-secondary)]">
                      No linked wallet found.
                    </p>
                  ) : (
                    <div className="max-h-64 space-y-1 overflow-y-auto">
                      {linkedAddresses.map((address) => (
                        <button
                          key={address}
                          type="button"
                          onClick={() => applyAddress(address)}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--kura-bg-lighter)] ${
                            address === selectedAddress
                              ? "bg-[var(--kura-bg-lighter)] font-semibold text-[var(--kura-text)]"
                              : "text-[var(--kura-text)]"
                          }`}
                        >
                          <span className="font-mono">{formatShortAddress(address)}</span>
                          {address === selectedAddress ? (
                            <Badge variant="outline">Active</Badge>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={refreshPositions}
              disabled={isLoading || !selectedAddress}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </>
        }
      />

      {error ? <PageAlert variant="error">{error}</PageAlert> : null}

      <AssetSegmentChartCard
        segment="defiProtocol"
        title="Protocol value"
        description="Synced protocol positions across linked wallets"
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <Panel padding="sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
            Total value
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--kura-text)]">
            {formatCurrency(totalValue, isBalanceHidden)}
          </p>
        </Panel>
        <Panel padding="sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
            Protocols
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--kura-text)]">
            {positions.length}
          </p>
        </Panel>
        <Panel padding="sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kura-text-secondary)]">
            Wallet
          </p>
          <p className="mt-2 truncate font-mono text-sm font-semibold text-[var(--kura-text)]">
            {isLoadingAddresses
              ? "Loading…"
              : selectedAddress
                ? formatShortAddress(selectedAddress)
                : "None linked"}
          </p>
        </Panel>
      </section>

      <Panel padding="md" className="mb-6">
        <PanelHeader title="Overview" description="Protocols ranked by USD value" />
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-[var(--kura-bg-lighter)]" />
            ))}
          </div>
        ) : sortedPositions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--kura-border)] px-4 py-12 text-center text-sm text-[var(--kura-text-secondary)]">
            {selectedAddress
              ? "No protocol positions for this wallet."
              : "Link a wallet to sync DeFi protocol balances."}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sortedPositions.map((protocol) => (
              <div
                key={`summary-${protocol.id}`}
                className="rounded-xl border border-[var(--kura-border)] bg-[var(--kura-bg-lighter)]/40 px-4 py-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <ProtocolAvatar
                      logo={protocol.logo || resolveProtocolIcon(protocol.name)}
                      name={protocol.name}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--kura-text)]">
                        {protocol.name}
                      </p>
                      <p className="truncate text-[11px] text-[var(--kura-text-secondary)]">
                        {protocol.chain || "Multi-chain"}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline">{protocol.assets.length}</Badge>
                </div>
                <p className="mt-3 text-lg font-semibold tabular-nums text-[var(--kura-text)]">
                  {formatCurrency(protocol.usdValue, isBalanceHidden)}
                </p>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel padding="none">
        <div className="border-b border-[var(--kura-border)] px-5 py-4">
          <PanelHeader
            className="mb-0"
            title="Asset breakdown"
            description="Per-protocol positions and underlying assets"
          />
        </div>

        {isLoading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-[var(--kura-bg-lighter)]" />
            ))}
          </div>
        ) : sortedPositions.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--kura-text-secondary)]">
            Nothing to show yet.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--kura-border)]">
            {sortedPositions.map((position) => (
              <li key={position.id} className="px-5 py-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <ProtocolAvatar
                      logo={position.logo || resolveProtocolIcon(position.name)}
                      name={position.name}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--kura-text)]">
                        {position.name}
                      </p>
                      <p className="truncate text-[11px] text-[var(--kura-text-secondary)]">
                        {position.chain || "Multi-chain"}
                      </p>
                    </div>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-[var(--kura-text)]">
                    {formatCurrency(position.usdValue, isBalanceHidden)}
                  </p>
                </div>

                {position.assets.length === 0 ? (
                  <p className="text-xs text-[var(--kura-text-secondary)]">
                    No asset-level breakdown for this protocol.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {[...position.assets]
                      .sort((a, b) => b.usdValue - a.usdValue)
                      .map((asset) => (
                        <div
                          key={`${position.id}-${asset.id}`}
                          className="flex items-center justify-between gap-3 rounded-xl border border-[var(--kura-border)] px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-[var(--kura-text)]">
                              {asset.symbol}
                              <span className="text-[var(--kura-text-secondary)]">
                                {" "}
                                · {asset.name}
                              </span>
                            </p>
                            <p className="text-[11px] text-[var(--kura-text-secondary)]">
                              {asset.amount > 0
                                ? `${formatUnits(asset.amount)} × ${formatCurrency(asset.price, isBalanceHidden)}`
                                : "Position asset"}
                            </p>
                          </div>
                          <p className="shrink-0 text-sm font-semibold tabular-nums text-[var(--kura-text)]">
                            {formatCurrency(asset.usdValue, isBalanceHidden)}
                          </p>
                        </div>
                      ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </DashboardPage>
  );
}
