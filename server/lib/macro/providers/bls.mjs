/*
 * BLS Public Data API v1 (sans clé) : 25 séries / requête, 10 ans, 25 requêtes / jour.
 * Une seule requête POST groupée pour toutes les séries AirMacro.
 */
import { request } from '../../http.mjs'

export const BLS_SERIES = {
  cpiNsa: 'CUUR0000SA0', // IPC tous éléments, non désaisonnalisé (glissement annuel officiel)
  coreCpiNsa: 'CUUR0000SA0L1E', // IPC hors alimentation et énergie, NSA
  cpiSa: 'CUSR0000SA0', // IPC désaisonnalisé (variation mensuelle officielle)
  coreCpiSa: 'CUSR0000SA0L1E',
  unrate: 'LNS14000000', // taux de chômage, CVS
  payems: 'CES0000000001', // emplois non agricoles (milliers), CVS
  ahe: 'CES0500000003', // salaire horaire moyen, secteur privé, CVS
  ppiSa: 'WPSFD4', // prix à la production, demande finale, CVS (variation mensuelle officielle)
  corePpiSa: 'WPSFD49104', // demande finale hors alimentation et énergie, CVS
  ppiNsa: 'WPUFD4', // demande finale, non désaisonnalisé (glissement annuel)
  corePpiNsa: 'WPUFD49104',
  jolts: 'JTS000000000000000JOL', // offres d'emploi JOLTS (milliers), CVS
}

/** Normalise une réponse BLS v1 → { key: [{ d, v }] } (+ drapeau préliminaire). */
export function parseBlsResponse(json) {
  if (json?.status !== 'REQUEST_SUCCEEDED') {
    const detail = Array.isArray(json?.message) ? json.message.join(' ') : ''
    throw new Error(`bls: ${json?.status ?? 'réponse invalide'} ${detail}`.trim().slice(0, 200))
  }
  const keyById = Object.fromEntries(Object.entries(BLS_SERIES).map(([k, id]) => [id, k]))
  const series = {}
  const preliminary = {}
  for (const s of json.Results?.series ?? []) {
    const key = keyById[s.seriesID]
    if (!key) continue
    const rows = []
    for (const obs of s.data ?? []) {
      const m = /^M(0[1-9]|1[0-2])$/.exec(obs.period ?? '') // M13 = moyenne annuelle, ignorée
      const v = Number(obs.value)
      if (!m || !Number.isFinite(v)) continue
      rows.push({ d: `${obs.year}-${m[1]}-01`, v })
      if (obs.latest === 'true' && (obs.footnotes ?? []).some((f) => f?.code === 'P')) preliminary[key] = true
    }
    rows.sort((a, b) => (a.d < b.d ? -1 : 1))
    series[key] = rows
  }
  const missing = Object.keys(BLS_SERIES).filter((k) => !series[k]?.length)
  if (missing.length === Object.keys(BLS_SERIES).length) throw new Error('bls: aucune série exploitable')
  return { series, preliminary, missing }
}

export async function fetchBls(startYear, endYear) {
  const json = await request('https://api.bls.gov/publicAPI/v1/timeseries/data/', {
    method: 'POST',
    body: JSON.stringify({
      seriesid: Object.values(BLS_SERIES),
      startyear: String(startYear),
      endyear: String(endYear),
    }),
    headers: { 'Content-Type': 'application/json' },
    timeoutMs: 20_000,
    retries: 1,
  })
  return parseBlsResponse(json)
}
