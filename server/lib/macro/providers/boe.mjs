/*
 * Banque d'Angleterre — décision du MPC lue dans le « Monetary Policy Summary »
 * officiel (12:00 heure de Londres) : taux directeur et répartition des votes.
 * Découverte par le flux RSS des actualités ; repli sur l'adresse mensuelle
 * prévisible (/monetary-policy-summary-and-minutes/<année>/<mois>-<année>).
 */
import { fetchText, request } from '../../http.mjs'
import { dayKey } from '../../../../shared/analytics/macrotime.mjs'
import { decodeEntities, htmlToText } from './fedpress.mjs'

const BASE = 'https://www.bankofengland.co.uk'
const LONDON = 'Europe/London'
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const COUNTS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }
const SUMMARY_PATH = /^\/monetary-policy-summary-and-minutes\/\d{4}\/[a-z]+-\d{4}$/

export function isSummaryUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'www.bankofengland.co.uk' && SUMMARY_PATH.test(url.pathname)
  } catch {
    return false
  }
}

/** Adresse attendue du résumé d'une réunion annoncée à `ts` (mois de Londres). */
export function summaryUrlFor(ts) {
  const [year, month] = dayKey(ts, LONDON).split('-').map(Number)
  return `${BASE}/monetary-policy-summary-and-minutes/${year}/${MONTHS[month - 1]}-${year}`
}

/** Flux RSS → résumés de politique monétaire { title, url, date (Londres) }. */
export function parseBoeRss(xml) {
  const out = []
  for (const match of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const pick = (tag) => {
      const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(match[1])
      return m ? decodeEntities(m[1]) : null
    }
    const url = pick('link')
    const ts = Date.parse(pick('pubDate') ?? '')
    if (!url || !isSummaryUrl(url) || !Number.isFinite(ts)) continue
    out.push({ title: pick('title') ?? '', url, date: dayKey(ts, LONDON) })
  }
  return out
}

const actionOf = (verb) => (/maintain|hold|keep/i.test(verb) ? 'hold' : /reduce|cut|lower/i.test(verb) ? 'cut' : 'hike')
const countOf = (word) => COUNTS[word.toLowerCase()] ?? Number(word)

/**
 * Texte du résumé → { rate, action, votes: { hike, cut, hold } | null, published }.
 * « …voted by a majority of 6–3 to maintain Bank Rate at 3.75%. Three members voted
 * to increase Bank Rate by 0.25 percentage points, to 4%. »
 */
export function parseBoeSummary(text) {
  const flat = String(text).replace(/\s+/g, ' ')
  const at = flat.search(/At its meeting ending on/i)
  if (at < 0) return null
  const para = flat.slice(at, at + 900)
  const main =
    /voted (unanimously|by a majority of (\d+)\s*[–-]\s*(\d+)) to (maintain|reduce|increase|cut|raise|lower) Bank Rate(?: by [\d.]+ percentage points?)?,? (?:at|to) (\d+(?:\.\d+)?)%/i.exec(para)
  if (!main) return null
  const action = actionOf(main[4])
  const counts = { hike: 0, cut: 0, hold: 0 }
  let votes = null
  if (/unanimously/i.test(main[1])) {
    counts[action] = 9
    votes = counts
  } else {
    counts[action] += Number(main[2])
    let minority = 0
    const rest = para.slice(main.index + main[0].length)
    for (const m of rest.matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|\d) members? (?:voted|preferred) to (maintain|reduce|increase|cut|raise|lower) Bank Rate/gi)) {
      const n = countOf(m[1])
      counts[actionOf(m[2])] += n
      minority += n
    }
    // votes publiés seulement si la minorité détaillée correspond au décompte annoncé
    votes = minority === Number(main[3]) ? counts : null
  }
  const published = /Published on (\d{1,2}) ([A-Za-z]+) (\d{4})/.exec(flat)
  const month = published ? MONTHS.indexOf(published[2].toLowerCase()) + 1 : 0
  return {
    rate: Number(main[5]),
    action,
    votes,
    published: month ? `${published[3]}-${String(month).padStart(2, '0')}-${published[1].padStart(2, '0')}` : null,
  }
}

/** Format du calendrier pour les votes : hausse–baisse–maintien (« 3-0-6 »). */
export const formatBoeVotes = (v) => `${v.hike}-${v.cut}-${v.hold}`

export async function newsFeed() {
  return parseBoeRss(await fetchText(`${BASE}/rss/news`, { timeoutMs: 15_000 }))
}

/**
 * Décision annoncée le jour `date` (Londres) : RSS puis adresse prévisible.
 * @returns {Promise<null | { date: string, url: string, rate: number, action: string, votes: any }>}
 */
export async function decisionOn(date, ts) {
  let url = null
  try {
    url = (await newsFeed()).find((item) => item.date === date)?.url ?? null
  } catch {
    // flux indisponible : l'adresse mensuelle prévisible reste tentée
  }
  url ??= summaryUrlFor(ts)
  const res = await request(url, { as: 'text', timeoutMs: 20_000, acceptStatus: [404], withMeta: true })
  if (res.status === 404 || !res.body) return null
  const parsed = parseBoeSummary(htmlToText(res.body))
  // une page d'une autre réunion (même mois) ne compte pas
  if (!parsed || (parsed.published && parsed.published !== date)) return null
  return { date, url, rate: parsed.rate, action: parsed.action, votes: parsed.votes }
}
