import { fetchJson } from '../http.mjs'

const BASE = 'https://community-api.coinmetrics.io/v4'

/**
 * Historique long BTC (PriceUSD + MVRV) depuis 2010 via l'API community.
 * Suit la pagination next_page_url (garde-fou : 8 pages max).
 */
export async function btcLongHistory() {
  let url = `${BASE}/timeseries/asset-metrics?assets=btc&metrics=PriceUSD,CapMVRVCur&frequency=1d&page_size=10000&start_time=2010-07-17`
  const rows = []
  for (let page = 0; page < 8 && url; page++) {
    const json = await fetchJson(url, { timeoutMs: 15000 })
    for (const row of json.data ?? []) {
      const price = Number(row.PriceUSD)
      if (!Number.isFinite(price)) continue
      const mvrv = Number(row.CapMVRVCur)
      rows.push({
        d: String(row.time).slice(0, 10),
        c: price,
        mvrv: Number.isFinite(mvrv) ? mvrv : null,
      })
    }
    url = json.next_page_url ?? null
  }
  if (rows.length < 1000) throw new Error(`coinmetrics: historique trop court (${rows.length})`)
  rows.sort((a, b) => (a.d < b.d ? -1 : 1))
  return rows
}
