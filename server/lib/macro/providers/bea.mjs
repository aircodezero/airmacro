/*
 * BEA — fichiers plats NIPA (sans clé) : NipaDataM.txt / NipaDataQ.txt (~36 Mo).
 * Lecture en flux filtrée sur les codes utiles + requête conditionnelle
 * (If-Modified-Since → 304) : le fichier complet n'est retéléchargé qu'après
 * une publication BEA.
 */
import { request } from '../../http.mjs'
import { csvNumber, splitCsvLine } from './csv.mjs'

export const BEA_CODES = {
  M: {
    corePce: 'DPCCRG', // indice des prix PCE hors alimentation et énergie
    pce: 'DPCERG', // indice des prix PCE
  },
  Q: {
    gdpQoQ: 'A191RL', // PIB réel, variation en rythme annualisé (%)
  },
}

const FILES = { M: 'NipaDataM.txt', Q: 'NipaDataQ.txt' }

/** '2026M07' → '2026-07-01' ; '2026Q2' → '2026-04-01'. */
export function beaPeriodToDate(period) {
  const m = /^(\d{4})M(0[1-9]|1[0-2])$/.exec(period)
  if (m) return `${m[1]}-${m[2]}-01`
  const q = /^(\d{4})Q([1-4])$/.exec(period)
  if (q) return `${q[1]}-${String((Number(q[2]) - 1) * 3 + 1).padStart(2, '0')}-01`
  return null
}

/** Lignes « CODE,PERIODE,"VALEUR" » → { key: [{ d, v }] }. */
export function parseNipaLines(lines, codesByKey) {
  const keyByCode = Object.fromEntries(Object.entries(codesByKey).map(([k, c]) => [c, k]))
  const series = Object.fromEntries(Object.keys(codesByKey).map((k) => [k, []]))
  for (const line of lines) {
    const [code, period, value] = splitCsvLine(line)
    const key = keyByCode[code]
    const d = key ? beaPeriodToDate(period) : null
    const v = csvNumber(value)
    if (key && d && v != null) series[key].push({ d, v })
  }
  for (const rows of Object.values(series)) rows.sort((a, b) => (a.d < b.d ? -1 : 1))
  return series
}

/**
 * @param {'M'|'Q'} freq
 * @param {string|null} ifModifiedSince en-tête Last-Modified de la copie détenue
 * @returns {Promise<{notModified: true} | {notModified: false, lastModified: string|null, series: Record<string, Array<{d:string,v:number}>>}>}
 */
export async function fetchNipa(freq, ifModifiedSince = null) {
  const codes = BEA_CODES[freq]
  const wanted = new Set(Object.values(codes))
  const res = await request(`https://apps.bea.gov/national/Release/TXT/${FILES[freq]}`, {
    as: 'lines',
    lineFilter: (line) => wanted.has(line.slice(0, line.indexOf(','))),
    headers: ifModifiedSince ? { 'If-Modified-Since': ifModifiedSince } : {},
    acceptStatus: [304],
    withMeta: true,
    timeoutMs: 120_000,
    retries: 2,
  })
  if (res.status === 304) return { notModified: true }
  const series = parseNipaLines(res.body, codes)
  if (Object.values(series).every((rows) => rows.length === 0)) {
    throw new Error(`bea ${FILES[freq]}: aucune ligne pour ${[...wanted].join(', ')}`)
  }
  return { notModified: false, lastModified: res.headers.lastModified, series }
}
