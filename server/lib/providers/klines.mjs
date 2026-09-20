/*
 * Bougies quotidiennes d'une crypto avec chaîne de repli :
 * Binance → Bybit → CoinGecko (clôtures seules, bougies plates).
 */
import * as binance from './binance.mjs'
import * as bybit from './bybit.mjs'
import * as coingecko from './coingecko.mjs'

/** Correspondance symbole → id CoinGecko pour le repli (complétée par /markets). */
const knownIds = new Map([
  ['BTC', 'bitcoin'],
  ['ETH', 'ethereum'],
  ['SOL', 'solana'],
  ['BNB', 'binancecoin'],
  ['XRP', 'ripple'],
  ['DOGE', 'dogecoin'],
  ['ADA', 'cardano'],
  ['AVAX', 'avalanche-2'],
  ['LINK', 'chainlink'],
  ['LTC', 'litecoin'],
])

export function registerCoinIds(items) {
  for (const item of items) {
    if (item.symbol && item.id && !knownIds.has(item.symbol)) {
      knownIds.set(item.symbol, item.id)
    }
  }
}

/**
 * @param {string} base ex. « BTC »
 * @param {number} limit nombre de jours
 * @returns {Promise<{provider: string, candles: Array<{t:number,o:number,h:number,l:number,c:number,v:number}>}>}
 */
export async function dailyCandles(base, limit = 365) {
  try {
    const candles = await binance.spotDailyCandles(base, limit)
    if (candles.length >= 30) return { provider: 'binance', candles }
  } catch {
    /* repli suivant */
  }
  try {
    const candles = await bybit.spotDailyCandles(base, limit)
    if (candles.length >= 30) return { provider: 'bybit', candles }
  } catch {
    /* repli suivant */
  }
  const id = knownIds.get(base.toUpperCase())
  if (!id) throw new Error(`klines: aucun fournisseur pour ${base}`)
  const closes = await coingecko.dailyCloses(id, Math.min(limit, 365))
  const candles = closes.map(({ t, c }) => ({ t, o: c, h: c, l: c, c, v: 0 }))
  if (candles.length < 30) throw new Error(`klines: série trop courte pour ${base}`)
  return { provider: 'coingecko', candles }
}
