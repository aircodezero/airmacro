import { fetchJson } from '../http.mjs'

const BASE = 'https://www.okx.com'

/** Funding courant d'un swap OKX (instId ex. BTC-USDT-SWAP). */
export async function fundingRate(base) {
  const instId = `${base.toUpperCase()}-USDT-SWAP`
  const json = await fetchJson(`${BASE}/api/v5/public/funding-rate?instId=${instId}`, { timeoutMs: 8000 })
  const row = json.data?.[0]
  if (!row) throw new Error(`okx: pas de funding pour ${instId}`)
  return {
    fundingRate8h: Number(row.fundingRate),
    nextFundingTime: Number(row.nextFundingTime) || null,
  }
}
