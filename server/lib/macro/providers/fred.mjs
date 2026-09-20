/*
 * FRED (St. Louis Fed) — repli générique : fredgraph.csv sans clé, ou API
 * officielle si FRED_API_KEY est défini. Bloqué depuis certaines machines :
 * délai court, aucune nouvelle tentative (le disjoncteur borne le coût).
 */
import { fetchJson, fetchText } from '../../http.mjs'
import { csvNumber, parseCsv, sortDedupe } from './csv.mjs'

/** CSV fredgraph (« observation_date,ID1,ID2 » ou « DATE,… ») → { ID: [{ d, v }] }. */
export function parseFredGraphCsv(text, startDate = '0000-00-00') {
  const { header, rows } = parseCsv(text)
  if (!header.length || !/^(observation_date|date)$/i.test(header[0])) throw new Error('fred: en-tête inattendu')
  const out = {}
  header.slice(1).forEach((id, j) => {
    out[id] = sortDedupe(
      rows
        .map((r) => ({ d: r[0], v: csvNumber(r[j + 1]) }))
        .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.d) && r.v != null && r.d >= startDate),
    )
  })
  return out
}

/** @returns {Promise<{ series: Record<string, Array<{d:string,v:number}>>, via: string }>} */
export async function fredSeries(ids, startDate) {
  const key = process.env.FRED_API_KEY?.trim()
  if (key) {
    const series = {}
    for (const id of ids) {
      const params = new URLSearchParams({
        series_id: id,
        api_key: key,
        file_type: 'json',
        observation_start: startDate,
      })
      const json = await fetchJson(`https://api.stlouisfed.org/fred/series/observations?${params}`, {
        timeoutMs: 10_000,
        retries: 1,
      })
      series[id] = sortDedupe(
        (json?.observations ?? [])
          .map((o) => ({ d: o.date, v: csvNumber(o.value) }))
          .filter((r) => r.v != null),
      )
    }
    return { series, via: 'FRED API' }
  }
  const text = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${ids.join(',')}`, {
    timeoutMs: 8000,
    retries: 0,
  })
  return { series: parseFredGraphCsv(text, startDate), via: 'FRED' }
}
