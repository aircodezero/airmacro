/*
 * BCE — taux de référence quotidiens (API Data Portal, sans clé) utilisés pour
 * répliquer le Dollar Index (formule ICE) quand DXY n'est pas joignable.
 * Fixing 14:15 CET : la réplique suit DXY de près sans lui être identique.
 */
import { fetchText } from '../../http.mjs'
import { dxyFromEurCrosses } from '../../../../shared/analytics/macroseries.mjs'
import { csvNumber, parseCsv, sortDedupe } from './csv.mjs'

export function parseEcbExrToDxy(text) {
  const { header, rows } = parseCsv(text)
  const iCur = header.indexOf('CURRENCY')
  const iDate = header.indexOf('TIME_PERIOD')
  const iVal = header.indexOf('OBS_VALUE')
  if (iCur < 0 || iDate < 0 || iVal < 0) throw new Error('ecb: colonnes introuvables')
  const byDate = new Map()
  for (const row of rows) {
    const d = row[iDate]
    const v = csvNumber(row[iVal])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d ?? '') || v == null) continue
    if (!byDate.has(d)) byDate.set(d, {})
    byDate.get(d)[row[iCur]] = v
  }
  const out = []
  for (const [d, crosses] of byDate) {
    const v = dxyFromEurCrosses(crosses)
    if (v != null) out.push({ d, v: Math.round(v * 1000) / 1000 })
  }
  if (!out.length) throw new Error('ecb: aucune date complète pour la réplique DXY')
  return sortDedupe(out)
}

export async function dxyReplica(startDate) {
  const url =
    'https://data-api.ecb.europa.eu/service/data/EXR/D.USD+JPY+GBP+CAD+SEK+CHF.EUR.SP00.A' +
    `?startPeriod=${startDate}&format=csvdata&detail=dataonly`
  return parseEcbExrToDxy(await fetchText(url, { timeoutMs: 30_000 }))
}
