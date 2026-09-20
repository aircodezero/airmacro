/*
 * BCE — décision de politique monétaire lue dans le communiqué officiel
 * « Monetary policy decisions » (14:15 heure de Francfort), découvert par le flux
 * RSS des communiqués. Taux des trois facilités, dans l'ordre où le texte les cite.
 */
import { fetchText } from '../../http.mjs'
import { dayKey } from '../../../../shared/analytics/macrotime.mjs'
import { decodeEntities, htmlToText } from './fedpress.mjs'

const FRANKFURT = 'Europe/Berlin'
const DECISION_PATH = /^\/press\/pr\/date\/\d{4}\/html\/ecb\.mp\d{6}[^/]*\.en\.html$/

/** Normalise une adresse du flux (double barre) ; null si ce n'est pas un communiqué de décision. */
export function decisionUrl(value) {
  try {
    const url = new URL(value)
    url.pathname = url.pathname.replace(/\/{2,}/g, '/')
    return url.protocol === 'https:' && url.hostname === 'www.ecb.europa.eu' && DECISION_PATH.test(url.pathname) ? url.toString() : null
  } catch {
    return null
  }
}

export function parseEcbRss(xml) {
  const out = []
  for (const match of String(xml).matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)) {
    const pick = (tag) => {
      const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(match[1])
      return m ? decodeEntities(m[1]) : null
    }
    const url = decisionUrl(pick('link') ?? '')
    const ts = Date.parse(pick('pubDate') ?? '')
    if (!url || !Number.isFinite(ts)) continue
    out.push({ title: pick('title') ?? '', url, date: dayKey(ts, FRANKFURT) })
  }
  return out
}

const FACILITIES = [
  ['deposit', /deposit facility/i],
  ['mro', /main refinancing operations/i],
  ['mlf', /marginal lending facility/i],
]

/**
 * Texte du communiqué → { deposit, mro, mlf } (en %), ou null.
 * « …the interest rates on the deposit facility, the main refinancing operations and the
 * marginal lending facility will be increased to 2.50%, 2.65% and 2.90% respectively… »
 */
export function parseEcbDecision(text) {
  const flat = String(text).replace(/\s+/g, ' ')
  const m = /interest rates? on the ([^.]{10,260}?) will (?:remain unchanged at|be (?:increased|decreased|reduced|raised|lowered|cut) to|stand at) ((?:\d+(?:\.\d+)?\s?%(?:,\s|\sand\s)?){3}) ?respectively/i.exec(flat)
  if (!m) return null
  const order = FACILITIES.map(([key, re]) => ({ key, at: m[1].search(re) }))
    .filter((f) => f.at >= 0)
    .sort((a, b) => a.at - b.at)
  const rates = [...m[2].matchAll(/(\d+(?:\.\d+)?)\s?%/g)].map((r) => Number(r[1]))
  if (order.length !== 3 || rates.length !== 3) return null
  return Object.fromEntries(order.map((f, i) => [f.key, rates[i]]))
}

/**
 * Décision annoncée le jour `date` (Francfort), ou null si pas encore publiée.
 * @returns {Promise<null | { date: string, url: string, deposit: number, mro: number, mlf: number }>}
 */
export async function decisionOn(date) {
  const items = parseEcbRss(await fetchText('https://www.ecb.europa.eu/rss/press.html', { timeoutMs: 15_000 }))
  const item = items.find((i) => i.date === date)
  if (!item) return null
  const rates = parseEcbDecision(htmlToText(await fetchText(item.url, { timeoutMs: 20_000 })))
  return rates ? { date, url: item.url, ...rates } : null
}
