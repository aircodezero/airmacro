/* Cboe — historique quotidien officiel du VIX (CSV public). */
import { fetchText } from '../../http.mjs'
import { csvNumber, parseCsv, usDateToIso, sortDedupe } from './csv.mjs'

export function parseVixCsv(text, fromDate = '0000-00-00') {
  const { header, rows } = parseCsv(text)
  const iDate = header.findIndex((h) => /^date$/i.test(h))
  const iClose = header.findIndex((h) => /^close$/i.test(h))
  if (iDate < 0 || iClose < 0) throw new Error('cboe: colonnes introuvables')
  const out = []
  for (const row of rows) {
    const d = usDateToIso(row[iDate])
    const v = csvNumber(row[iClose])
    if (d && v != null && d >= fromDate) out.push({ d, v })
  }
  if (!out.length) throw new Error('cboe: série VIX vide')
  return sortDedupe(out)
}

export async function vixHistory(fromDate) {
  const text = await fetchText('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv', {
    timeoutMs: 20_000,
  })
  return parseVixCsv(text, fromDate)
}
