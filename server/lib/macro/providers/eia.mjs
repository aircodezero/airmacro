/*
 * EIA API v2 — prix spot quotidien du WTI (Cushing). Clé via EIA_API_KEY ;
 * à défaut, clé de démonstration publique d'api.data.gov (DEMO_KEY, limitée à
 * ~30 requêtes/h et 50/jour par IP — le cache disque garde l'usage très bas).
 * La clé n'est jamais journalisée ni renvoyée.
 */
import { fetchJson } from '../../http.mjs'
import { sortDedupe } from './csv.mjs'

export function parseEiaSeries(json) {
  const rows = []
  for (const r of json?.response?.data ?? []) {
    const d = String(r?.period ?? '').slice(0, 10)
    const v = Number(r?.value)
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(v)) rows.push({ d, v })
  }
  if (!rows.length) throw new Error('eia: série WTI vide')
  return sortDedupe(rows)
}

export const eiaKeyKind = () => (process.env.EIA_API_KEY?.trim() ? 'EIA_API_KEY' : 'DEMO_KEY')

export async function wtiSpot(startDate) {
  const params = new URLSearchParams({
    frequency: 'daily',
    'data[0]': 'value',
    'facets[series][]': 'RWTC',
    start: startDate,
    'sort[0][column]': 'period',
    'sort[0][direction]': 'asc',
    length: '5000',
    api_key: process.env.EIA_API_KEY?.trim() || 'DEMO_KEY',
  })
  const json = await fetchJson(`https://api.eia.gov/v2/petroleum/pri/spt/data/?${params}`, {
    timeoutMs: 20_000,
    retries: 1,
  })
  return parseEiaSeries(json)
}
