/*
 * NY Fed Markets API (public) : EFFR quotidien avec la fourchette cible de la Fed
 * (targetRateFrom / targetRateTo). Publié le jour ouvré suivant vers 9:00 ET.
 */
import { fetchJson } from '../../http.mjs'
import { sortDedupe } from './csv.mjs'

export function parseEffr(json) {
  const rows = []
  for (const r of json?.refRates ?? []) {
    const d = typeof r.effectiveDate === 'string' ? r.effectiveDate.slice(0, 10) : null
    const effr = Number(r.percentRate)
    const lower = Number(r.targetRateFrom)
    const upper = Number(r.targetRateTo)
    if (!d || !Number.isFinite(effr)) continue
    rows.push({
      d,
      effr,
      lower: Number.isFinite(lower) ? lower : null,
      upper: Number.isFinite(upper) ? upper : null,
    })
  }
  if (!rows.length) throw new Error('nyfed: aucune observation EFFR')
  return sortDedupe(rows)
}

export async function effrHistory(startDate, endDate) {
  const json = await fetchJson(
    `https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json?startDate=${startDate}&endDate=${endDate}`,
    { timeoutMs: 25_000 },
  )
  return parseEffr(json)
}
