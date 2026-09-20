/*
 * ISM (Report On Business) — PMI manufacturier et services, lus dans les titres des
 * communiqués officiels de l'ISM diffusés par PR Newswire (10:00 ET) : le site de
 * l'ISM est injoignable depuis cette machine, sa salle de presse PR Newswire ne l'est pas.
 * « Sep 01, 2026, 10:00 ET Manufacturing PMI® at 54.6%; August 2026 ISM® Manufacturing PMI® Report »
 */
import { fetchText } from '../../http.mjs'
import { htmlToText } from './fedpress.mjs'

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const REG = '(?:®|&reg;|&#174;)?'
const pad = (n) => String(n).padStart(2, '0')

/** Texte de la salle de presse → [{ date (New York), sector, pmi, month }], plus récent d'abord. */
export function parseIsmHeadlines(text) {
  const flat = String(text).replace(/\s+/g, ' ')
  const re = new RegExp(
    `(${SHORT.join('|')}) (\\d{1,2}), (\\d{4}),? \\d{1,2}:\\d{2} ET (Manufacturing|Services) PMI${REG} at (\\d+(?:\\.\\d+)?)%; (${MONTHS.join('|')}) (\\d{4}) ISM${REG} (?:Manufacturing|Services) PMI${REG} Report`,
    'g',
  )
  const out = []
  for (const m of flat.matchAll(re)) {
    out.push({
      date: `${m[3]}-${pad(SHORT.indexOf(m[1]) + 1)}-${pad(Number(m[2]))}`,
      sector: m[4].toLowerCase(),
      pmi: Number(m[5]),
      month: `${m[7]}-${pad(MONTHS.indexOf(m[6]) + 1)}-01`,
    })
  }
  return out
}

export async function ismHeadlines() {
  const html = await fetchText('https://www.prnewswire.com/news/institute-for-supply-management/', { timeoutMs: 20_000 })
  const items = parseIsmHeadlines(htmlToText(html))
  if (!items.length) throw new Error('ism: aucun communiqué PMI dans la salle de presse')
  return items
}
