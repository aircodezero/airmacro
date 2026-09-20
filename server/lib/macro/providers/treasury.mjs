/*
 * US Treasury — courbe des taux CMT quotidienne (CSV public, un fichier par année).
 * Source officielle des séries FRED DGS10 / DGS3MO.
 */
import { fetchText } from '../../http.mjs'
import { csvNumber, parseCsv, usDateToIso, sortDedupe } from './csv.mjs'

export function parseTreasuryCsv(text) {
  const { header, rows } = parseCsv(text)
  const iDate = header.findIndex((h) => /^date$/i.test(h))
  const i3m = header.findIndex((h) => /^3 mo$/i.test(h))
  const i10y = header.findIndex((h) => /^10 yr$/i.test(h))
  if (iDate < 0 || i3m < 0 || i10y < 0) throw new Error('treasury: colonnes introuvables')
  const m3 = []
  const y10 = []
  for (const row of rows) {
    const d = usDateToIso(row[iDate])
    if (!d) continue
    const v3 = csvNumber(row[i3m])
    const v10 = csvNumber(row[i10y])
    if (v3 != null) m3.push({ d, v: v3 })
    if (v10 != null) y10.push({ d, v: v10 })
  }
  return { m3: sortDedupe(m3), y10: sortDedupe(y10) }
}

export async function yieldCurveYear(year) {
  const url =
    `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all` +
    `?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`
  return parseTreasuryCsv(await fetchText(url, { timeoutMs: 20_000 }))
}
