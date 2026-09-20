/*
 * Univers de l'application : filtres stablecoins/wrapped, symboles perp de
 * référence, paniers actions.
 */

export const STABLE_SYMBOLS = new Set([
  'usdt', 'usdc', 'dai', 'usds', 'usde', 'fdusd', 'tusd', 'pyusd', 'usd1',
  'usdd', 'gusd', 'usdp', 'frax', 'lusd', 'susd', 'usdy', 'usdf', 'usdtb',
  'rlusd', 'eurc', 'eurt', 'busd', 'usdx',
])

export const WRAPPED_OR_STAKED_SYMBOLS = new Set([
  'wbtc', 'weth', 'wsteth', 'steth', 'wbeth', 'weeth', 'reth', 'cbbtc',
  'cbeth', 'rseth', 'meth', 'lseth', 'ezeth', 'sweth', 'oseth', 'lbtc',
  'solvbtc', 'tbtc', 'eeth', 'jitosol', 'msol', 'bnsol', 'wbnb', 'weth.e',
  'clbtc', 'stbtc', 'susds', 'jupsol', 'whype',
])

/** Or tokenisé, RWA, fonds tokenisés : hors univers de signaux. */
export const RWA_OR_PEGGED_SYMBOLS = new Set([
  'xaut', 'paxg', 'buidl', 'usdg', 'figr_heloc', 'usyc', 'benji', 'ousg',
])

export function isExcludedFromSignals(symbol) {
  const s = String(symbol).toLowerCase()
  return STABLE_SYMBOLS.has(s) || WRAPPED_OR_STAKED_SYMBOLS.has(s) || RWA_OR_PEGGED_SYMBOLS.has(s)
}

export function isStable(symbol) {
  return STABLE_SYMBOLS.has(String(symbol).toLowerCase())
}

/** Symboles perp suivis pour le funding (base, sans « USDT »). */
export const HEADLINE_PERPS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'LTC']

/** Actions/indices suivis (source Stooq — suffixe .us — puis Yahoo). */
export const EQUITY_SYMBOLS = [
  'QQQ', 'NVDA',
  'COIN', 'MSTR', 'HOOD', 'MARA', 'RIOT', 'CLSK',
  'AMD', 'AVGO', 'MSFT', 'GOOGL', 'PLTR', 'TSM',
]

export const CRYPTO_EQUITY_BASKET = ['COIN', 'MSTR', 'HOOD', 'MARA', 'RIOT', 'CLSK']
export const AI_EQUITY_BASKET = ['NVDA', 'AMD', 'AVGO', 'MSFT', 'GOOGL', 'PLTR', 'TSM']

/** Nombre d'actifs de l'univers des signaux. */
export const SIGNALS_UNIVERSE_SIZE = 30
