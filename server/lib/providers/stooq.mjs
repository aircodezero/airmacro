import { fetchText } from '../http.mjs'

/**
 * Clôtures quotidiennes Stooq, bornées à ~3 ans (payload léger, Stooq limite
 * les gros téléchargements et les rafales).
 */
export async function dailyCloses(symbol, keep = 640) {
  const id = `${symbol.toLowerCase()}.us`
  const now = new Date()
  const from = new Date(now.getTime() - 3.1 * 365 * 86_400_000)
  const fmt = (d) => d.toISOString().slice(0, 10).replaceAll('-', '')
  const csv = await fetchText(
    `https://stooq.com/q/d/l/?s=${encodeURIComponent(id)}&i=d&d1=${fmt(from)}&d2=${fmt(now)}`,
    { timeoutMs: 12000 },
  )
  const lines = csv.trim().split('\n')
  if (lines.length < 3 || !/^date,open/i.test(lines[0])) {
    throw new Error(`stooq: réponse invalide pour ${id}`)
  }
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const [date, , , , close] = lines[i].split(',')
    const c = Number(close)
    if (date && Number.isFinite(c)) rows.push({ d: date, c })
  }
  rows.sort((a, b) => (a.d < b.d ? -1 : 1))
  return rows.slice(-keep)
}
