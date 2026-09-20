import { fetchText } from '../http.mjs'

/**
 * Historique quotidien de l'indice CCi30 (cci30.com), CSV
 * « Date,Open,High,Low,Close,Volume » du plus récent au plus ancien.
 * Retour : ordre chronologique.
 */
export async function indexHistory() {
  const csv = await fetchText('https://cci30.com/ajax/getIndexHistory.php', { timeoutMs: 20000 })
  const lines = csv.trim().split('\n')
  if (lines.length < 100 || !/^date,open/i.test(lines[0])) {
    throw new Error('cci30: réponse invalide')
  }
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const [date, open, high, low, close] = lines[i].split(',')
    const o = Number(open)
    const h = Number(high)
    const l = Number(low)
    const c = Number(close)
    if (date && Number.isFinite(c)) rows.push({ d: date, o, h, l, c })
  }
  rows.sort((a, b) => (a.d < b.d ? -1 : 1))
  return rows
}
