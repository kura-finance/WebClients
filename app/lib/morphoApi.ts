/**
 * Morpho Earn — public GraphQL vault listings on Base.
 * Mirrors mobile `listEarnMorphoVaults` (allowlisted vaults only).
 */

export const MORPHO_GRAPHQL_URL = "https://api.morpho.org/graphql";
export const MORPHO_BASE_CHAIN_ID = 8453;

/** Same allowlist as mobile DEFAULT_MORPHO_EARN_VAULT_ALLOWLIST. */
export const EARN_VAULT_ALLOWLIST = [
  "0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9",
  "0x94Af495DE1F56Aa5576dEB17986bDCeE5Dd9778D",
  "0x050cE30b927Da55177A4914EC73480238BAD56f0",
  "0x1deEfABEe758AAbdC29a542B24ca3b75aFD56765",
] as const;

/** Display fee applied on top of Morpho net APY (matches mobile default 10%). */
export const EARN_SERVICE_FEE_RATE = 0.1;

export interface MorphoVault {
  address: string;
  name: string;
  symbol: string;
  assetSymbol: string;
  assetAddress: string;
  assetDecimals: number;
  /** Morpho's own logo for the asset (an SVG on cdn.morpho.org). */
  assetLogoUrl?: string | null;
  netApy: number;
  totalAssetsUsd: number;
  fee: number;
  sharePriceUsd: number;
  description: string | null;
  imageUrl: string | null;
}

interface GqlVaultItem {
  address: string;
  name: string;
  symbol: string;
  asset: { symbol: string; address: string; decimals: number; logoURI?: string | null };
  state: {
    netApy: number;
    totalAssetsUsd: number;
    fee: number;
    sharePriceUsd: number;
  } | null;
  metadata: { description: string | null; image: string | null } | null;
}

interface GqlVaultV2Item {
  address: string;
  name: string;
  symbol: string;
  asset: { symbol: string; address: string; decimals: number; logoURI?: string | null };
  netApy: number | null;
  totalAssetsUsd: number | null;
  performanceFee: number | null;
  sharePrice: number | null;
  metadata: { description: string | null; image: string | null } | null;
}

async function morphoQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(MORPHO_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || json.errors?.length) {
    throw new Error(json.errors?.[0]?.message ?? `Morpho API ${res.status}`);
  }
  return json.data as T;
}

function mapVault(item: GqlVaultItem): MorphoVault {
  return {
    address: item.address,
    name: item.name,
    symbol: item.symbol,
    assetSymbol: item.asset.symbol,
    assetAddress: item.asset.address,
    assetDecimals: item.asset.decimals,
    assetLogoUrl: item.asset.logoURI ?? null,
    netApy: item.state?.netApy ?? 0,
    totalAssetsUsd: item.state?.totalAssetsUsd ?? 0,
    fee: item.state?.fee ?? 0,
    sharePriceUsd: item.state?.sharePriceUsd ?? 0,
    description: item.metadata?.description ?? null,
    imageUrl: item.metadata?.image ?? null,
  };
}

function mapVaultV2(item: GqlVaultV2Item): MorphoVault {
  return {
    address: item.address,
    name: item.name,
    symbol: item.symbol,
    assetSymbol: item.asset.symbol,
    assetAddress: item.asset.address,
    assetDecimals: item.asset.decimals,
    assetLogoUrl: item.asset.logoURI ?? null,
    netApy: item.netApy ?? 0,
    totalAssetsUsd: item.totalAssetsUsd ?? 0,
    fee: item.performanceFee ?? 0,
    sharePriceUsd: item.sharePrice ?? 0,
    description: item.metadata?.description ?? null,
    imageUrl: item.metadata?.image ?? null,
  };
}

const LIST_VAULTS_QUERY = `
  query ListVaults($first: Int!, $skip: Int!) {
    vaults(
      first: $first
      skip: $skip
      orderBy: TotalAssetsUsd
      orderDirection: Desc
      where: { chainId_in: [8453], listed: true }
    ) {
      items {
        address
        name
        symbol
        asset { symbol address decimals logoURI }
        state { netApy totalAssetsUsd fee sharePriceUsd }
        metadata { description image }
      }
    }
  }
`;

const VAULT_V2_BY_ADDRESS_QUERY = `
  query VaultV2ByAddress($address: String!, $chainId: Int!) {
    vaultV2ByAddress(address: $address, chainId: $chainId) {
      address
      name
      symbol
      asset { symbol address decimals logoURI }
      netApy
      totalAssetsUsd
      performanceFee
      sharePrice
      metadata { description image }
    }
  }
`;

async function getVaultV2(address: string): Promise<MorphoVault | null> {
  const data = await morphoQuery<{ vaultV2ByAddress: GqlVaultV2Item | null }>(
    VAULT_V2_BY_ADDRESS_QUERY,
    { address, chainId: MORPHO_BASE_CHAIN_ID },
  );
  return data.vaultV2ByAddress ? mapVaultV2(data.vaultV2ByAddress) : null;
}

/** Allowlisted Morpho earn vaults on Base. */
export async function listEarnMorphoVaults(): Promise<MorphoVault[]> {
  const data = await morphoQuery<{ vaults: { items: GqlVaultItem[] } }>(LIST_VAULTS_QUERY, {
    first: 100,
    skip: 0,
  });
  const byAddress = new Map(
    (data.vaults?.items ?? []).map((item) => [item.address.toLowerCase(), mapVault(item)]),
  );

  const missing = EARN_VAULT_ALLOWLIST.filter((addr) => !byAddress.has(addr.toLowerCase()));
  if (missing.length > 0) {
    const supplemental = await Promise.all(missing.map((addr) => getVaultV2(addr)));
    for (const vault of supplemental) {
      if (vault) byAddress.set(vault.address.toLowerCase(), vault);
    }
  }

  return EARN_VAULT_ALLOWLIST.map((addr) => byAddress.get(addr.toLowerCase())).filter(
    (v): v is MorphoVault => v != null,
  );
}

export function effectiveEarnNetApy(netApy: number): number {
  if (!Number.isFinite(netApy) || netApy <= 0) return 0;
  return netApy * (1 - EARN_SERVICE_FEE_RATE);
}

export function formatApy(apy: number): string {
  if (!Number.isFinite(apy) || apy <= 0) return "—";
  return `${(apy * 100).toFixed(2)}%`;
}

export function formatTvl(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "—";
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${usd.toFixed(0)}`;
}

export interface MorphoVaultAllocation {
  id: string;
  label: string;
  subtitle: string;
  supplyAssetsUsd: number;
  supplyApy: number;
  lltvLabel: string;
  pct: number;
}

export interface MorphoVaultYieldSource {
  id: string;
  label: string;
  subtitle?: string;
  /** APR contribution (can be negative for fee drag). Null when displayValue is used. */
  apr: number | null;
  /** Non-APR display (e.g. "10% of profits"). */
  displayValue?: string;
  kind: "native" | "reward" | "asset" | "fee";
}

export interface MorphoVaultDetail extends MorphoVault {
  idleAssetsUsd: number;
  nativeApy: number;
  netApyExcludingRewards: number;
  performanceFee: number;
  managementFee: number;
  assetYieldApr: number;
  liquidityUsd: number | null;
  allocations: MorphoVaultAllocation[];
  yieldSources: MorphoVaultYieldSource[];
  rewards: { symbol: string; supplyApr: number }[];
}

interface GqlV2AdapterPosition {
  market: {
    marketId: string;
    loanAsset: { symbol: string } | null;
    collateralAsset: { symbol: string } | null;
    lltv: string | null;
    state: { supplyApy: number } | null;
  } | null;
  state: { supplyAssetsUsd: number } | null;
}

interface GqlV2AdapterItem {
  __typename: string;
  address: string;
  assetsUsd: number | null;
  type: string | null;
  positions?: { items: GqlV2AdapterPosition[] } | null;
  metaMorpho?: { address: string; name: string; asset: { symbol: string } } | null;
  innerVault?: { address: string; name: string; asset: { symbol: string } } | null;
}

interface GqlVaultV2Detail {
  address: string;
  name: string;
  symbol: string;
  asset: {
    symbol: string;
    address: string;
    decimals: number;
    logoURI?: string | null;
    yield: { apr: number } | null;
  };
  totalAssetsUsd: number | null;
  idleAssetsUsd: number | null;
  netApy: number | null;
  avgNetApy: number | null;
  performanceFee: number | null;
  managementFee: number | null;
  sharePrice: number | null;
  metadata: { description: string | null; image: string | null } | null;
  rewards: { asset: { symbol: string } | null; supplyApr: number | null }[] | null;
  adapters: { items: GqlV2AdapterItem[] } | null;
}

const VAULT_V2_DETAIL_QUERY = `
  query VaultV2Detail($address: String!, $chainId: Int!) {
    vaultV2ByAddress(address: $address, chainId: $chainId) {
      address
      name
      symbol
      asset {
        symbol
        address
        decimals
        logoURI
        yield { apr }
      }
      totalAssetsUsd
      idleAssetsUsd
      netApy
      avgNetApy
      performanceFee
      managementFee
      sharePrice
      metadata { description image }
      rewards {
        asset { symbol }
        supplyApr
      }
      adapters(first: 20) {
        items {
          __typename
          address
          assetsUsd
          type
          ... on MorphoMarketV1Adapter {
            positions(first: 50) {
              items {
                market {
                  marketId
                  loanAsset { symbol }
                  collateralAsset { symbol }
                  lltv
                  state { supplyApy }
                }
                state { supplyAssetsUsd }
              }
            }
          }
          ... on MetaMorphoAdapter {
            metaMorpho {
              address
              name
              asset { symbol }
            }
          }
          ... on MorphoVaultV2Adapter {
            innerVault {
              address
              name
              asset { symbol }
            }
          }
        }
      }
    }
  }
`;

function buildAllocationsFromV2(
  detail: GqlVaultV2Detail,
): MorphoVaultAllocation[] {
  const rows: MorphoVaultAllocation[] = [];
  const idle = detail.idleAssetsUsd ?? 0;
  const totalAssets = detail.totalAssetsUsd ?? 0;

  for (const adapter of detail.adapters?.items ?? []) {
    if (adapter.__typename === "MorphoMarketV1Adapter") {
      for (const pos of adapter.positions?.items ?? []) {
        const usd = pos.state?.supplyAssetsUsd ?? 0;
        if (usd < 0.01) continue;
        const collat = pos.market?.collateralAsset?.symbol ?? "Asset";
        const loan = pos.market?.loanAsset?.symbol ?? detail.asset.symbol;
        rows.push({
          id: pos.market?.marketId ?? `${adapter.address}-${rows.length}`,
          label: `${collat} / ${loan}`,
          subtitle: `Morpho Blue · LLTV ${formatLltv(pos.market?.lltv)}`,
          supplyAssetsUsd: usd,
          supplyApy: pos.market?.state?.supplyApy ?? 0,
          lltvLabel: formatLltv(pos.market?.lltv),
          pct: 0,
        });
      }
      continue;
    }

    const nestedName =
      adapter.metaMorpho?.name ??
      adapter.innerVault?.name ??
      adapter.type ??
      adapter.__typename;
    const usd = adapter.assetsUsd ?? 0;
    if (usd < 0.01) continue;
    rows.push({
      id: adapter.address,
      label: nestedName,
      subtitle: adapter.__typename.replace(/Adapter$/, ""),
      supplyAssetsUsd: usd,
      supplyApy: 0,
      lltvLabel: "—",
      pct: 0,
    });
  }

  if (idle >= 0.01) {
    rows.push({
      id: "idle",
      label: "Idle cash",
      subtitle: "Unallocated liquidity",
      supplyAssetsUsd: idle,
      supplyApy: 0,
      lltvLabel: "—",
      pct: 0,
    });
  }

  const denom =
    totalAssets > 0
      ? totalAssets
      : rows.reduce((s, r) => s + r.supplyAssetsUsd, 0) || 1;

  return rows
    .map((r) => ({ ...r, pct: (r.supplyAssetsUsd / denom) * 100 }))
    .sort((a, b) => b.supplyAssetsUsd - a.supplyAssetsUsd);
}

function buildYieldSourcesFromV2(detail: GqlVaultV2Detail): MorphoVaultYieldSource[] {
  const sources: MorphoVaultYieldSource[] = [];
  const native = detail.netApy ?? detail.avgNetApy ?? 0;
  if (native > 0) {
    sources.push({
      id: "native",
      label: "Morpho net APY",
      subtitle: "Lending yield after Morpho fees",
      apr: native,
      kind: "native",
    });
  }
  const assetYield = detail.asset?.yield?.apr ?? 0;
  if (assetYield > 0) {
    sources.push({
      id: "asset-yield",
      label: `${detail.asset.symbol} native yield`,
      subtitle: "Underlying asset APR",
      apr: assetYield,
      kind: "asset",
    });
  }
  for (const reward of detail.rewards ?? []) {
    const apr = reward.supplyApr ?? 0;
    const sym = reward.asset?.symbol ?? "Reward";
    if (apr <= 0) continue;
    sources.push({
      id: `reward-${sym}`,
      label: `${sym} rewards`,
      subtitle: "Incentive APR",
      apr,
      kind: "reward",
    });
  }
  const perf = detail.performanceFee ?? 0;
  if (perf > 0) {
    sources.push({
      id: "perf-fee",
      label: "Performance fee",
      subtitle: "Share of vault profits",
      apr: null,
      displayValue: `${(perf * 100).toFixed(0)}%`,
      kind: "fee",
    });
  }
  const mgmt = detail.managementFee ?? 0;
  if (mgmt > 0) {
    sources.push({
      id: "mgmt-fee",
      label: "Management fee",
      subtitle: "Annual vault fee",
      apr: null,
      displayValue: `${(mgmt * 100).toFixed(2)}%`,
      kind: "fee",
    });
  }
  // Display Kura service fee as informational deduction vs Morpho net.
  if (native > 0 && EARN_SERVICE_FEE_RATE > 0) {
    sources.push({
      id: "kura-fee",
      label: "Kura service fee",
      subtitle: `${(EARN_SERVICE_FEE_RATE * 100).toFixed(0)}% of Morpho net APY`,
      apr: -(native * EARN_SERVICE_FEE_RATE),
      kind: "fee",
    });
  }
  return sources;
}

function mapVaultV2Detail(item: GqlVaultV2Detail): MorphoVaultDetail {
  const netApy = item.netApy ?? item.avgNetApy ?? 0;
  return {
    address: item.address,
    name: item.name,
    symbol: item.symbol,
    assetSymbol: item.asset.symbol,
    assetAddress: item.asset.address,
    assetDecimals: item.asset.decimals,
    assetLogoUrl: item.asset.logoURI ?? null,
    netApy,
    totalAssetsUsd: item.totalAssetsUsd ?? 0,
    fee: item.performanceFee ?? 0,
    sharePriceUsd: item.sharePrice ?? 0,
    description: item.metadata?.description ?? null,
    imageUrl: item.metadata?.image ?? null,
    idleAssetsUsd: item.idleAssetsUsd ?? 0,
    nativeApy: netApy,
    netApyExcludingRewards: netApy,
    performanceFee: item.performanceFee ?? 0,
    managementFee: item.managementFee ?? 0,
    assetYieldApr: item.asset.yield?.apr ?? 0,
    liquidityUsd: null,
    allocations: buildAllocationsFromV2(item),
    yieldSources: buildYieldSourcesFromV2(item),
    rewards: (item.rewards ?? [])
      .filter((r) => (r.supplyApr ?? 0) > 0 && r.asset?.symbol)
      .map((r) => ({ symbol: r.asset!.symbol, supplyApr: r.supplyApr ?? 0 })),
  };
}

/** Detailed Morpho Earn vault (allocations + yield sources). Prefers Vault V2. */
export async function fetchEarnVaultDetail(
  address: string,
): Promise<MorphoVaultDetail | null> {
  const data = await morphoQuery<{ vaultV2ByAddress: GqlVaultV2Detail | null }>(
    VAULT_V2_DETAIL_QUERY,
    { address, chainId: MORPHO_BASE_CHAIN_ID },
  );
  if (data.vaultV2ByAddress) return mapVaultV2Detail(data.vaultV2ByAddress);
  return null;
}

/* ─── Borrow (Morpho Blue markets on Base) ─── */

/** Loan asset for Morpho Base borrow (USDC only). */
export const MORPHO_BORROW_LOAN_SYMBOLS = ["USDC"] as const;

/** Collateral assets supported for borrow (mirrors mobile). */
export const MORPHO_BORROW_COLLATERAL_SYMBOLS = [
  "WETH",
  "ETH",
  "cbBTC",
  "cbDOGE",
  "DOGE",
  "SOL",
  "cbXRP",
  "XRP",
  "cbETH",
  "wstETH",
  "weETH",
  "rETH",
  "USDe",
] as const;

export const MORPHO_BORROW_MIN_SUPPLY_USD = 5_000_000;
export const MORPHO_BORROW_MAX_MARKETS = 24;

const MORPHO_BORROW_COLLATERAL_MIN_SUPPLY_USD: Partial<
  Record<(typeof MORPHO_BORROW_COLLATERAL_SYMBOLS)[number], number>
> = {
  cbDOGE: 1_000_000,
  DOGE: 1_000_000,
  SOL: 1_000_000,
};

export interface MorphoMarketAsset {
  symbol: string;
  address: string;
  decimals: number;
  /** Morpho's own logo for the asset (an SVG on cdn.morpho.org). */
  logoURI?: string | null;
}

export interface MorphoMarket {
  marketId: string;
  lltv: string;
  loanAsset: MorphoMarketAsset;
  collateralAsset: MorphoMarketAsset;
  borrowApy: number;
  avgNetBorrowApy: number;
  borrowAssetsUsd: number;
  supplyAssetsUsd: number;
  liquidityAssetsUsd: number;
  collateralAssetsUsd: number;
  utilization: number;
  oracleAddress: string | null;
  irmAddress: string | null;
}

interface GqlMarketItem {
  marketId: string;
  lltv: string;
  loanAsset: MorphoMarketAsset | null;
  collateralAsset: MorphoMarketAsset | null;
  oracle?: { address?: string } | null;
  irmAddress?: string | null;
  state: {
    borrowApy: number;
    avgNetBorrowApy: number;
    borrowAssetsUsd: number;
    supplyAssetsUsd: number;
    liquidityAssetsUsd: number;
    collateralAssetsUsd: number;
    utilization: number;
  } | null;
}

const LIST_MARKETS_QUERY = `
  query ListMarkets($first: Int!, $skip: Int!) {
    markets(
      first: $first
      skip: $skip
      orderBy: SupplyAssetsUsd
      orderDirection: Desc
      where: { chainId_in: [8453], listed: true }
    ) {
      items {
        marketId
        lltv
        loanAsset { symbol address decimals logoURI }
        collateralAsset { symbol address decimals logoURI }
        oracle { address }
        irmAddress
        state {
          borrowApy
          avgNetBorrowApy
          borrowAssetsUsd
          supplyAssetsUsd
          liquidityAssetsUsd
          collateralAssetsUsd
          utilization
        }
      }
    }
  }
`;

const borrowLoanSet = new Set(MORPHO_BORROW_LOAN_SYMBOLS.map((s) => s.toLowerCase()));
const borrowCollateralSet = new Set(
  MORPHO_BORROW_COLLATERAL_SYMBOLS.map((s) => s.toLowerCase()),
);

function normalizeBorrowSymbol(symbol: string): string {
  return symbol.trim().toLowerCase();
}

function minSupplyUsdForCollateral(symbol: string): number {
  const key = normalizeBorrowSymbol(symbol);
  for (const [collateral, minUsd] of Object.entries(MORPHO_BORROW_COLLATERAL_MIN_SUPPLY_USD)) {
    if (normalizeBorrowSymbol(collateral) === key && minUsd != null) return minUsd;
  }
  return MORPHO_BORROW_MIN_SUPPLY_USD;
}

function isValidMarketItem(
  item: GqlMarketItem,
): item is GqlMarketItem & { loanAsset: MorphoMarketAsset; collateralAsset: MorphoMarketAsset } {
  return Boolean(item.loanAsset?.symbol && item.collateralAsset?.symbol);
}

function mapMarket(
  item: GqlMarketItem & { loanAsset: MorphoMarketAsset; collateralAsset: MorphoMarketAsset },
): MorphoMarket {
  return {
    marketId: item.marketId,
    lltv: item.lltv,
    loanAsset: item.loanAsset,
    collateralAsset: item.collateralAsset,
    borrowApy: item.state?.borrowApy ?? 0,
    avgNetBorrowApy: item.state?.avgNetBorrowApy ?? 0,
    borrowAssetsUsd: item.state?.borrowAssetsUsd ?? 0,
    supplyAssetsUsd: item.state?.supplyAssetsUsd ?? 0,
    liquidityAssetsUsd: item.state?.liquidityAssetsUsd ?? 0,
    collateralAssetsUsd: item.state?.collateralAssetsUsd ?? 0,
    utilization: item.state?.utilization ?? 0,
    oracleAddress: item.oracle?.address ?? null,
    irmAddress: item.irmAddress ?? null,
  };
}

export function isMainstreamBorrowMarket(market: MorphoMarket): boolean {
  const loan = normalizeBorrowSymbol(market.loanAsset.symbol);
  const collateral = normalizeBorrowSymbol(market.collateralAsset.symbol);
  if (!borrowLoanSet.has(loan)) return false;
  if (!borrowCollateralSet.has(collateral)) return false;
  if (market.supplyAssetsUsd < minSupplyUsdForCollateral(market.collateralAsset.symbol)) {
    return false;
  }
  return true;
}

export function filterMainstreamBorrowMarkets(markets: MorphoMarket[]): MorphoMarket[] {
  return markets
    .filter(isMainstreamBorrowMarket)
    .sort((a, b) => b.supplyAssetsUsd - a.supplyAssetsUsd)
    .slice(0, MORPHO_BORROW_MAX_MARKETS);
}

/** One USDC loan market per collateral — lowest borrow APY. */
export function pickMarketsByCollateral(markets: MorphoMarket[]): MorphoMarket[] {
  const byCollateral = new Map<string, MorphoMarket>();

  for (const market of markets) {
    if (!isMainstreamBorrowMarket(market)) continue;
    const key = market.collateralAsset.symbol.toLowerCase();
    const apy = market.avgNetBorrowApy || market.borrowApy;
    const existing = byCollateral.get(key);
    if (!existing) {
      byCollateral.set(key, market);
      continue;
    }
    const existingApy = existing.avgNetBorrowApy || existing.borrowApy;
    if (apy < existingApy) byCollateral.set(key, market);
  }

  return [...byCollateral.values()].sort(
    (a, b) => b.liquidityAssetsUsd - a.liquidityAssetsUsd,
  );
}

/** Listed Morpho borrow markets on Base (mainstream filter). */
export async function listBorrowMorphoMarkets(): Promise<MorphoMarket[]> {
  const data = await morphoQuery<{ markets: { items: GqlMarketItem[] } }>(LIST_MARKETS_QUERY, {
    first: 100,
    skip: 0,
  });
  const raw = (data.markets?.items ?? []).filter(isValidMarketItem).map(mapMarket);
  return filterMainstreamBorrowMarkets(raw);
}

export interface MorphoMarketDetail extends MorphoMarket {
  supplyApy: number;
  rewards: { symbol: string; supplyApr: number; borrowApr: number }[];
  /** Informational cost / incentive rows for the detail page. */
  costSources: MorphoVaultYieldSource[];
}

interface GqlMarketDetailItem extends GqlMarketItem {
  state: GqlMarketItem["state"] & {
    supplyApy?: number;
    rewards?: {
      asset: { symbol: string } | null;
      supplyApr: number | null;
      borrowApr: number | null;
    }[] | null;
  } | null;
}

const MARKET_BY_ID_QUERY = `
  query MarketById($marketId: String!, $chainId: Int!) {
    marketById(marketId: $marketId, chainId: $chainId) {
      marketId
      lltv
      loanAsset { symbol address decimals logoURI }
      collateralAsset { symbol address decimals logoURI }
      oracle { address }
      irmAddress
      state {
        borrowApy
        supplyApy
        avgNetBorrowApy
        borrowAssetsUsd
        supplyAssetsUsd
        liquidityAssetsUsd
        collateralAssetsUsd
        utilization
        rewards {
          asset { symbol }
          supplyApr
          borrowApr
        }
      }
    }
  }
`;

function buildBorrowCostSources(market: MorphoMarketDetail): MorphoVaultYieldSource[] {
  const sources: MorphoVaultYieldSource[] = [];
  const borrow = market.avgNetBorrowApy || market.borrowApy;
  if (borrow > 0) {
    sources.push({
      id: "borrow-apy",
      label: "Borrow APY",
      subtitle: `Interest on ${market.loanAsset.symbol} debt`,
      apr: borrow,
      kind: "native",
    });
  }
  if (market.supplyApy > 0) {
    sources.push({
      id: "supply-apy",
      label: "Supply APY",
      subtitle: `What lenders earn on ${market.loanAsset.symbol}`,
      apr: market.supplyApy,
      kind: "asset",
    });
  }
  for (const reward of market.rewards) {
    if (reward.borrowApr > 0) {
      sources.push({
        id: `borrow-reward-${reward.symbol}`,
        label: `${reward.symbol} borrow rewards`,
        subtitle: "Incentive APR (offsets borrow cost)",
        apr: reward.borrowApr,
        kind: "reward",
      });
    }
    if (reward.supplyApr > 0) {
      sources.push({
        id: `supply-reward-${reward.symbol}`,
        label: `${reward.symbol} supply rewards`,
        subtitle: "Lender incentive APR",
        apr: reward.supplyApr,
        kind: "reward",
      });
    }
  }
  return sources;
}

function mapMarketDetail(
  item: GqlMarketDetailItem & {
    loanAsset: MorphoMarketAsset;
    collateralAsset: MorphoMarketAsset;
  },
): MorphoMarketDetail {
  const base = mapMarket(item);
  const rewards = (item.state?.rewards ?? [])
    .filter((r) => r.asset?.symbol)
    .map((r) => ({
      symbol: r.asset!.symbol,
      supplyApr: r.supplyApr ?? 0,
      borrowApr: r.borrowApr ?? 0,
    }))
    .filter((r) => r.supplyApr > 0 || r.borrowApr > 0);

  const detail: MorphoMarketDetail = {
    ...base,
    supplyApy: item.state?.supplyApy ?? 0,
    rewards,
    costSources: [],
  };
  detail.costSources = buildBorrowCostSources(detail);
  return detail;
}

/** Single Morpho Blue market detail (APY, liquidity, rewards). */
export async function fetchBorrowMarketDetail(
  marketId: string,
): Promise<MorphoMarketDetail | null> {
  const data = await morphoQuery<{ marketById: GqlMarketDetailItem | null }>(
    MARKET_BY_ID_QUERY,
    { marketId, chainId: MORPHO_BASE_CHAIN_ID },
  );
  const item = data.marketById;
  if (!item || !isValidMarketItem(item)) return null;
  return mapMarketDetail(item);
}

export function parseMarketMaxLltv(raw: string): number | null {
  const value = Number(raw) / 1e18;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function formatLltv(raw: string | null | undefined): string {
  if (!raw) return "—";
  const value = parseMarketMaxLltv(raw);
  if (value == null) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

export function formatUtilization(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatUserLtvPercent(ratio: number | null): string {
  if (ratio == null) return "—";
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Debt / collateral in USD (0–1 fraction). */
export function computeUserLtvRatio(
  borrowedUsd: number,
  collateralUsd: number,
): number | null {
  if (borrowedUsd <= 0 || collateralUsd <= 0) return null;
  const ratio = borrowedUsd / collateralUsd;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

export type LtvRiskLevel = "safe" | "warning" | "danger";

export function ltvRiskLevel(userLtv: number, maxLltv: number): LtvRiskLevel {
  const util = maxLltv > 0 ? userLtv / maxLltv : 0;
  if (util >= 0.9) return "danger";
  if (util >= 0.75) return "warning";
  return "safe";
}

const COLLATERAL_LABELS: Record<string, string> = {
  cbbtc: "Bitcoin",
  cbdoge: "Dogecoin",
  doge: "Dogecoin",
  sol: "Solana",
  cbxrp: "XRP",
  xrp: "XRP",
  weth: "Ethereum",
  eth: "Ethereum",
  cbeth: "Ethereum",
  wsteth: "Ethereum",
  weeth: "Ethereum",
  reth: "Ethereum",
  usde: "USDe",
};

export function collateralDisplayName(symbol: string): string {
  return COLLATERAL_LABELS[symbol.trim().toLowerCase()] ?? symbol;
}

export function morphoMarketAppUrl(marketId: string): string {
  return `https://app.morpho.org/base/market/${marketId}`;
}
