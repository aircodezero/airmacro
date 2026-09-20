import { fetchJson } from '../http.mjs'

const BASE = 'https://api.coingecko.com/api/v3'

/** Statistiques globales du marché crypto. */
export async function globalStats() {
  const json = await fetchJson(`${BASE}/global`)
  const d = json.data
  return {
    provider: 'coingecko',
    data: {
      totalMcapUsd: d.total_market_cap?.usd ?? null,
      totalVolumeUsd: d.total_volume?.usd ?? null,
      btcDominancePct: d.market_cap_percentage?.btc ?? null,
      ethDominancePct: d.market_cap_percentage?.eth ?? null,
      mcapChange24hPct: d.market_cap_change_percentage_24h_usd ?? null,
      activeCryptocurrencies: d.active_cryptocurrencies ?? null,
    },
  }
}

/** Top N par capitalisation, avec sparkline 7 j et variations 24h/7j/30j. */
export async function markets(perPage = 50) {
  const url =
    `${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}` +
    `&page=1&sparkline=true&price_change_percentage=24h,7d,30d`
  const json = await fetchJson(url, { timeoutMs: 12000 })
  const items = json.map((c) => ({
    id: c.id,
    symbol: String(c.symbol ?? '').toUpperCase(),
    name: c.name,
    rank: c.market_cap_rank,
    price: c.current_price,
    chg24hPct: c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h ?? null,
    chg7dPct: c.price_change_percentage_7d_in_currency ?? null,
    chg30dPct: c.price_change_percentage_30d_in_currency ?? null,
    mcap: c.market_cap,
    volume24h: c.total_volume,
    athChangePct: c.ath_change_percentage ?? null,
    spark7d: Array.isArray(c.sparkline_in_7d?.price)
      ? decimate(c.sparkline_in_7d.price, 42)
      : [],
  }))
  return { provider: 'coingecko', data: { items } }
}

/** Clôtures quotidiennes (repli OHLC : bougies plates). */
export async function dailyCloses(id, days = 365) {
  const url = `${BASE}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}&interval=daily`
  const json = await fetchJson(url, { timeoutMs: 12000 })
  const prices = Array.isArray(json.prices) ? json.prices : []
  return prices.map(([ms, price]) => ({ t: Math.floor(ms / 1000), c: price }))
}

function decimate(values, target) {
  if (values.length <= target) return values
  const step = values.length / target
  const out = []
  for (let i = 0; i < target; i++) out.push(values[Math.floor(i * step)])
  out[out.length - 1] = values[values.length - 1]
  return out
}
