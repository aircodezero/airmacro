import { fetchJson } from '../http.mjs'

const SPOT = 'https://api.binance.com'
const FUTURES = 'https://fapi.binance.com'

/** Bougies quotidiennes spot, ordre chronologique. limit ≤ 1000. */
export async function spotDailyCandles(base, limit = 365) {
  const symbol = `${base.toUpperCase()}USDT`
  const json = await fetchJson(`${SPOT}/api/v3/klines?symbol=${symbol}&interval=1d&limit=${limit}`, {
    timeoutMs: 10000,
  })
  return json.map((k) => ({
    t: Math.floor(k[0] / 1000),
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
  }))
}

/** premiumIndex de tous les perps USDT-M : funding courant, mark/index. */
export async function premiumIndexAll() {
  const json = await fetchJson(`${FUTURES}/fapi/v1/premiumIndex`, { timeoutMs: 10000 })
  const bySymbol = new Map()
  for (const row of json) {
    bySymbol.set(row.symbol, {
      symbol: row.symbol,
      markPrice: Number(row.markPrice),
      indexPrice: Number(row.indexPrice),
      fundingRate8h: Number(row.lastFundingRate),
      nextFundingTime: Number(row.nextFundingTime) || null,
    })
  }
  return bySymbol
}

/** Historique de funding d'un perp (limit max 1000, ~3 par jour). */
export async function fundingHistory(base, limit = 270) {
  const symbol = `${base.toUpperCase()}USDT`
  const json = await fetchJson(`${FUTURES}/fapi/v1/fundingRate?symbol=${symbol}&limit=${limit}`, {
    timeoutMs: 10000,
  })
  return json.map((row) => ({
    t: Math.floor(Number(row.fundingTime) / 1000),
    rate8h: Number(row.fundingRate),
  }))
}

/** Dernier prix spot (paire USDT). */
export async function spotPrice(base) {
  const symbol = `${base.toUpperCase()}USDT`
  const json = await fetchJson(`${SPOT}/api/v3/ticker/price?symbol=${symbol}`, { timeoutMs: 6000 })
  const price = Number(json.price)
  if (!Number.isFinite(price)) throw new Error(`binance: prix invalide pour ${symbol}`)
  return price
}

/** Open interest courant (en quantité de base). */
export async function openInterest(base) {
  const symbol = `${base.toUpperCase()}USDT`
  const json = await fetchJson(`${FUTURES}/fapi/v1/openInterest?symbol=${symbol}`, { timeoutMs: 8000 })
  return Number(json.openInterest)
}
