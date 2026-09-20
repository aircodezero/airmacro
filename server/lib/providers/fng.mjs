import { fetchJson } from '../http.mjs'

/** Historique Fear & Greed (alternative.me), ordre chronologique. */
export async function fearGreedHistory(limit = 120) {
  const json = await fetchJson(`https://api.alternative.me/fng/?limit=${limit}&format=json`, {
    timeoutMs: 8000,
  })
  const rows = (json.data ?? [])
    .map((row) => ({
      t: Number(row.timestamp),
      value: Number(row.value),
      classification: row.value_classification ?? null,
    }))
    .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.value))
    .sort((a, b) => a.t - b.t)
  if (!rows.length) throw new Error('fng: réponse vide')
  return rows
}
