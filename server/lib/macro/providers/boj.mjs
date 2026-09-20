/*
 * Banque du Japon — décision de politique monétaire lue dans le communiqué officiel
 * (PDF anglais « Statement on Monetary Policy » / « Change in the Guideline… »,
 * /en/mopo/mpmdeci/mpr_<année>/k<aammjj>a.pdf), découvert par le flux « What's New ».
 * L'heure de publication varie (fin de réunion) : le calendrier ne la donne qu'à titre indicatif.
 */
import { fetchText, request } from '../../http.mjs'
import { dayKey } from '../../../../shared/analytics/macrotime.mjs'
import { compact, pdfText } from '../pdftext.mjs'
import { decodeEntities } from './fedpress.mjs'

const TOKYO = 'Asia/Tokyo'
const STATEMENT_PATH = /^\/en\/mopo\/mpmdeci\/mpr_(\d{4})\/k(\d{2})(\d{2})(\d{2})a\.pdf$/
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function isStatementUrl(value) {
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) && url.hostname === 'www.boj.or.jp' && STATEMENT_PATH.test(url.pathname)
  } catch {
    return false
  }
}

/** Adresse du communiqué d'une réunion conclue le jour `date` (Tokyo, 'YYYY-MM-DD'). */
export function statementUrlFor(date) {
  const [y, m, d] = date.split('-')
  return `https://www.boj.or.jp/en/mopo/mpmdeci/mpr_${y}/k${y.slice(2)}${m}${d}a.pdf`
}

/** Flux « What's New » → communiqués de politique monétaire { title, url (https), date (Tokyo) }. */
export function parseBojRss(xml) {
  const out = []
  for (const match of String(xml).matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)) {
    const pick = (tag) => {
      const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(match[1])
      return m ? decodeEntities(m[1]) : null
    }
    const link = pick('link')
    const ts = Date.parse(pick('pubDate') ?? pick('dc:date') ?? '')
    if (!link || !isStatementUrl(link) || !Number.isFinite(ts)) continue
    out.push({ title: pick('title') ?? '', url: link.replace(/^http:/, 'https:'), date: dayKey(ts, TOKYO) })
  }
  return out
}

/**
 * Texte du communiqué → { date, dates, rate, vote } ou null ; `date` = première date citée
 * (en-tête), `dates` = toutes les dates du texte.
 * « The Bank will encourage the uncollateralized overnight call rate to remain at around 1.25 percent. »
 */
export function parseBojStatement(text) {
  const flat = compact(text)
  const rate = /overnightcallratetoremainataround(\d+(?:\.\d+)?)percent/i.exec(flat)
  if (!rate) return null
  const dates = [...flat.matchAll(new RegExp(`(${MONTHS.join('|')})(\\d{1,2}),(\\d{4})`, 'g'))].map(
    (d) => `${d[3]}-${String(MONTHS.indexOf(d[1]) + 1).padStart(2, '0')}-${d[2].padStart(2, '0')}`,
  )
  const vote = /bya(\d+)-(\d+)majorityvote/i.exec(flat)
  return {
    date: dates[0] ?? null,
    dates,
    rate: Number(rate[1]),
    vote: vote ? { for: Number(vote[1]), against: Number(vote[2]) } : /byaunanimousvote/i.test(flat) ? { for: 9, against: 0 } : null,
  }
}

/**
 * Décision de la réunion conclue le jour `date` (Tokyo), ou null si pas encore publiée.
 * @returns {Promise<null | { date: string, url: string, rate: number, vote: any }>}
 */
export async function decisionOn(date) {
  let url = null
  try {
    const xml = await fetchText('https://www.boj.or.jp/en/rss/whatsnew.xml', { timeoutMs: 15_000 })
    url = parseBojRss(xml).find((item) => item.date === date)?.url ?? null
  } catch {
    // flux indisponible : l'adresse prévisible reste tentée
  }
  url ??= statementUrlFor(date)
  const res = await request(url, { as: 'buffer', timeoutMs: 25_000, acceptStatus: [404], withMeta: true })
  if (res.status === 404 || !res.body) return null
  const parsed = parseBojStatement(pdfText(res.body, { maxPages: 4 }))
  // le communiqué cite sa propre date : un autre document ne compte pas
  if (!parsed || (parsed.dates.length && !parsed.dates.includes(date))) return null
  return { date, url, rate: parsed.rate, vote: parsed.vote }
}
