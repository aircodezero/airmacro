import { fetchJson } from '../http.mjs'

const BASE = 'https://www.deribit.com/api/v2'

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 }

/** Parse « BTC-26DEC26 » → date UTC 08:00 (heure de règlement Deribit). */
export function parseExpiry(instrumentName) {
  const part = instrumentName.split('-')[1]
  if (!part || part === 'PERPETUAL') return null
  const m = part.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/)
  if (!m) return null
  const [, day, mon, yy] = m
  const month = MONTHS[mon]
  if (month == null) return null
  return new Date(Date.UTC(2000 + Number(yy), month, Number(day), 8, 0, 0))
}

/** Courbe des futures datés d'une devise : prix mark + échéance. */
export async function futuresCurve(currency = 'BTC') {
  const [summary, index] = await Promise.all([
    fetchJson(`${BASE}/public/get_book_summary_by_currency?currency=${currency}&kind=future`, {
      timeoutMs: 10000,
    }),
    fetchJson(`${BASE}/public/get_index_price?index_name=${currency.toLowerCase()}_usd`, {
      timeoutMs: 8000,
    }),
  ])
  const indexPrice = index.result?.index_price
  if (!Number.isFinite(indexPrice)) throw new Error('deribit: index indisponible')
  const now = Date.now()
  const points = []
  for (const row of summary.result ?? []) {
    const expiry = parseExpiry(row.instrument_name)
    if (!expiry || !Number.isFinite(row.mark_price)) continue
    const daysToExpiry = (expiry.getTime() - now) / 86_400_000
    if (daysToExpiry <= 1) continue
    points.push({
      instrument: row.instrument_name,
      expiry: expiry.toISOString().slice(0, 10),
      daysToExpiry: Math.round(daysToExpiry * 10) / 10,
      markPrice: row.mark_price,
      openInterest: row.open_interest ?? null,
    })
  }
  points.sort((a, b) => a.daysToExpiry - b.daysToExpiry)
  return { indexPrice, points }
}
