import { fetchJson } from '../http.mjs'

const BASE = 'https://api.bybit.com'

/** Bougies quotidiennes spot, ordre chronologique (l'API renvoie du plus récent au plus ancien). */
export async function spotDailyCandles(base, limit = 365) {
  const symbol = `${base.toUpperCase()}USDT`
  const json = await fetchJson(
    `${BASE}/v5/market/kline?category=spot&symbol=${symbol}&interval=D&limit=${Math.min(limit, 1000)}`,
    { timeoutMs: 10000 },
  )
  if (json.retCode !== 0) throw new Error(`bybit retCode ${json.retCode}`)
  const rows = json.result?.list ?? []
  return rows
    .map((k) => ({
      t: Math.floor(Number(k[0]) / 1000),
      o: Number(k[1]),
      h: Number(k[2]),
      l: Number(k[3]),
      c: Number(k[4]),
      v: Number(k[5]),
    }))
    .sort((a, b) => a.t - b.t)
}

/** Tickers linear : funding + open interest en un appel. */
export async function linearTickers() {
  const json = await fetchJson(`${BASE}/v5/market/tickers?category=linear`, { timeoutMs: 10000 })
  if (json.retCode !== 0) throw new Error(`bybit retCode ${json.retCode}`)
  const bySymbol = new Map()
  for (const row of json.result?.list ?? []) {
    if (!row.symbol.endsWith('USDT')) continue
    bySymbol.set(row.symbol, {
      symbol: row.symbol,
      fundingRate8h: Number(row.fundingRate),
      nextFundingTime: Number(row.nextFundingTime) || null,
      openInterestValueUsd: Number(row.openInterestValue) || null,
      markPrice: Number(row.markPrice),
      indexPrice: Number(row.indexPrice),
    })
  }
  return bySymbol
}
