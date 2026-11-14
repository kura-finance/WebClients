/**
 * Token and network logos that need no API key.
 *
 * Fixed image URLs on CoinGecko's public image CDN, used when no logo.dev key
 * is configured (the default without a backend). The apps already ask
 * CoinGecko for prices, so this adds no new third party, and the URLs are the
 * same for every user: they say nothing about what a wallet holds.
 *
 * This file is identical in mobile-app (src/config/tokenLogos.ts) and
 * WebClients (app/lib/tokenLogos.ts). Change one, copy it to the other.
 */

const COIN_IMAGES = 'https://coin-images.coingecko.com/coins/images';
const PLATFORM_IMAGES = 'https://coin-images.coingecko.com/asset_platforms/images';

/** Lower-case symbol → path under COIN_IMAGES. */
const TOKEN_LOGO_PATHS: Record<string, string> = {
  // Dollar and regional stablecoins
  usdc: '6319/large/USDC.png',
  usdt: '325/large/Tether.png',
  dai: '9956/large/Badge_Dai.png',
  usds: '39926/large/usds.webp',
  susds: '52721/large/sUSDS_Coin.png',
  usde: '33613/large/usde.png',
  susde: '33669/large/sUSDe-Symbol-Color.png',
  usr: '40008/large/USR_LOGO.png',
  usdy: '31700/large/usdy_%281%29.png',
  ousg: '29023/large/OUSG.png',
  eurc: '26045/large/EURC.png',
  xsgd: '12832/large/XSGD_Logo_Full_Colour_1.png',
  audd: '33263/large/AUDD-Logo-Blue_512.png',
  brz: '8472/large/MicrosoftTeams-image_%286%29.png',
  mxne: '54735/large/mxne-logo-200.png',
  // Ether and its wrappers
  eth: '279/large/ethereum.png',
  weth: '2518/large/weth.png',
  cbeth: '27008/large/cbeth.png',
  wsteth: '18834/large/wstETH.png',
  weeth: '33033/large/weETH.png',
  reth: '20764/large/reth.png',
  // Bitcoin and its wrappers
  btc: '1/large/bitcoin.png',
  cbbtc: '40143/large/cbbtc.webp',
  lbtc: '39969/large/lbtc-token-circle-200.png',
  // Other assets
  aero: '31745/large/token.png',
  morpho: '29837/large/Morpho-token-icon.png',
  virtual: '34057/large/LOGOMARK.png',
  degen: '34515/large/android-chrome-512x512.png',
  sol: '4128/large/solana.png',
  jitosol: '28046/large/JitoSOL_Token_Logo_Green.png',
  xrp: '44/large/xrp-symbol-white-128.png',
  ada: '975/large/cardano.png',
  ltc: '2/large/litecoin.png',
  doge: '5/large/dogecoin.png',
  cbdoge: '66268/large/Coinbase_Wrapped_Doge_%28cbDOGE%29.png',
  zec: '486/large/Brandmark-Yellow_%281%29.png',
  hype: '50882/large/hyperliquid.jpg',
  paxg: '9519/large/asset-paxg.png',
  yfi: '11849/large/yearn.jpg',
};

/** Other spellings of a symbol in TOKEN_LOGO_PATHS (lower-case). */
const TOKEN_LOGO_ALIASES: Record<string, string> = {
  // logo.dev's slug for EURC
  euroc: 'eurc',
  // Coinbase-wrapped assets without a logo of their own show the asset itself
  cbxrp: 'xrp',
  cbada: 'ada',
  cbltc: 'ltc',
  cbzec: 'zec',
  cbhype: 'hype',
};

/** Chain key (as used by send / bridge) → path under PLATFORM_IMAGES. */
const CHAIN_LOGO_PATHS: Record<string, string> = {
  BASE: '131/large/base.png',
  ETH: '279/large/ethereum.png',
  OP: '41/large/optimism.png',
  POL: '15/large/polygon_pos.png',
  ARB: '33/large/AO_logomark.png',
  GNO: '11062/large/Aatar_green_white.png',
};

/** Own entries only: symbols come from outside (Morpho), so "constructor" must miss. */
function lookup(table: Record<string, string>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** Logo for a token symbol in any case, or null when it is not listed here. */
export function tokenLogoUrl(symbol: string | null | undefined): string | null {
  const key = (symbol ?? '').trim().toLowerCase();
  if (!key) return null;
  const path = lookup(TOKEN_LOGO_PATHS, lookup(TOKEN_LOGO_ALIASES, key) ?? key);
  return path ? `${COIN_IMAGES}/${path}` : null;
}

/** Logo for a chain key such as "BASE", or null when it is not listed here. */
export function chainLogoUrl(chainKey: string | null | undefined): string | null {
  const path = lookup(CHAIN_LOGO_PATHS, (chainKey ?? '').trim().toUpperCase());
  return path ? `${PLATFORM_IMAGES}/${path}` : null;
}
