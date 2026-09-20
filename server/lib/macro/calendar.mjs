/*
 * Calendrier AirMacro — logique pure (testée) :
 *   flux FairEconomy → normalisation (heure → UTC) → curation « vraiment important »
 *   → typage (kind/category) → regroupement par publication → fusion avec la référence.
 */
import { parseFeedDate } from '../../../shared/analytics/macrotime.mjs'

export const MAJOR_COUNTRIES = new Set(['USD', 'EUR', 'GBP', 'JPY'])

export const COUNTRY_LABELS = {
  USD: 'US',
  EUR: 'Euro area',
  GBP: 'UK',
  JPY: 'Japan',
  CNY: 'China',
  CAD: 'Canada',
  AUD: 'Australia',
  NZD: 'New Zealand',
  CHF: 'Switzerland',
  All: 'Global',
}

const IMPACTS = new Set(['High', 'Medium', 'Low', 'Holiday'])
const IMPACT_RANK = { Info: 0, Low: 1, Holiday: 1, Medium: 2, High: 3 }

const clean = (value) => {
  if (value == null) return null
  const text = String(value).trim()
  return text === '' ? null : text.slice(0, 40)
}

/** Ligne brute du flux → ligne normalisée (null si inexploitable). */
export function normalizeFfRow(row) {
  if (!row || typeof row.title !== 'string' || !row.title.trim()) return null
  const ts = parseFeedDate(row.date)
  if (ts == null) return null
  return {
    title: row.title.trim().slice(0, 120),
    country: String(row.country ?? '').trim().toUpperCase() === 'ALL' ? 'All' : String(row.country ?? '').trim().toUpperCase(),
    ts,
    impact: IMPACTS.has(row.impact) ? row.impact : 'Low',
    forecast: clean(row.forecast),
    previous: clean(row.previous),
    // le flux actuel n'a pas de champ « actual » ; repris s'il apparaît un jour
    actual: clean(row.actual),
  }
}

const RULES = [
  { kind: 'fomc', category: 'decision', country: 'USD', re: /^(Federal Funds Rate|FOMC Statement|FOMC Economic Projections)$/i },
  { kind: 'fomc', category: 'presser', country: 'USD', re: /^FOMC Press Conference$/i },
  { kind: 'fomc', category: 'minutes', country: 'USD', re: /^FOMC Meeting Minutes$/i },
  { kind: 'ecb', category: 'decision', country: 'EUR', re: /^(Main Refinancing Rate|Deposit Facility Rate|Marginal Lending Facility Rate|Monetary Policy Statement)$/i },
  { kind: 'ecb', category: 'presser', country: 'EUR', re: /^ECB Press Conference$/i },
  { kind: 'ecb', category: 'minutes', country: 'EUR', re: /^ECB Monetary Policy Meeting Accounts$/i },
  { kind: 'boe', category: 'decision', country: 'GBP', re: /^(Official Bank Rate|Monetary Policy Summary|MPC Official Bank Rate Votes|MPC Asset Purchase Facility Votes|BOE Monetary Policy Report)$/i },
  { kind: 'boj', category: 'decision', country: 'JPY', re: /^(BOJ Policy Rate|Monetary Policy Statement|BOJ Outlook Report)$/i },
  { kind: 'boj', category: 'presser', country: 'JPY', re: /^BOJ Press Conference$/i },
  { kind: 'speech', category: 'speech', re: /\b(Speaks|Testifies|Remarks)\b/i },
  { kind: 'pce', category: 'data', re: /\bPCE\b/i },
  { kind: 'cpi', category: 'data', re: /\bCPI\b|Consumer Price Index/i },
  { kind: 'nfp', category: 'data', country: 'USD', re: /^(Non-Farm Employment Change|Unemployment Rate|Average Hourly Earnings m\/m)$/i },
  { kind: 'claims', category: 'data', re: /Unemployment Claims/i },
  { kind: 'jolts', category: 'data', re: /JOLTS/i },
  { kind: 'gdp', category: 'data', re: /\bGDP\b/i },
  { kind: 'ism', category: 'data', re: /^ISM\b/i },
  { kind: 'pmi', category: 'data', re: /\bPMI\b/i },
  { kind: 'retail', category: 'data', re: /Retail Sales/i },
  { kind: 'sentiment', category: 'data', re: /UoM|Consumer Sentiment|Inflation Expectations|ZEW|Ifo/i },
  { kind: 'labor', category: 'data', re: /Claimant Count|Employment Change|Unemployment Rate|Average Earnings/i },
]

/** Type d'événement d'après le titre et la devise. */
export function classify(title, country) {
  for (const rule of RULES) {
    if (rule.country && rule.country !== country) continue
    if (rule.re.test(title)) return { kind: rule.kind, category: rule.category }
  }
  return { kind: 'other', category: 'data' }
}

/* Événements « Medium » qui comptent vraiment (liste blanche). */
const MEDIUM_WHITELIST = [
  { country: 'USD', re: /PCE Price Index/i },
  { country: 'USD', re: /^JOLTS Job Openings/i },
  { country: 'USD', re: /^Prelim UoM (Consumer Sentiment|Inflation Expectations)/i },
  { country: 'USD', re: /^Unemployment Claims$/i },
  { country: 'USD', re: /^(Core )?Retail Sales m\/m$/i },
  { country: 'USD', re: /^ISM (Manufacturing|Services) PMI$/i },
  { country: 'USD', re: /^FOMC Meeting Minutes$/i },
  { country: '*', re: /^(Fed Chair|ECB President|BOE Gov|BOJ Gov)\b.*\b(Speaks|Testifies)\b/i },
]

/** Curation : impact High des 4 grandes zones + liste blanche Medium. */
export function isCurated(row) {
  if (!MAJOR_COUNTRIES.has(row.country)) return false
  if (row.impact === 'High') return true
  if (row.impact !== 'Medium') return false
  return MEDIUM_WHITELIST.some((w) => (w.country === '*' || w.country === row.country) && w.re.test(row.title))
}

const HEADLINE_ORDER = {
  fomc: [/^Federal Funds Rate$/i, /Economic Projections/i, /Statement/i],
  ecb: [/Main Refinancing Rate/i, /Deposit Facility Rate/i],
  boe: [/^Official Bank Rate$/i, /Votes/i],
  boj: [/^BOJ Policy Rate$/i],
  cpi: [/^CPI y\/y/i, /^Core CPI m\/m/i, /^CPI m\/m/i, /^Core CPI y\/y/i],
  nfp: [/^Non-Farm/i, /^Unemployment Rate/i, /^Average Hourly/i],
  pce: [/^Core PCE Price Index m\/m/i, /^Core PCE Price Index y\/y/i],
  gdp: [/GDP q\/q/i],
  retail: [/^Retail Sales m\/m/i, /^Core Retail Sales m\/m/i],
}

function headlineRank(kind, name) {
  const order = HEADLINE_ORDER[kind]
  if (!order) return 99
  const i = order.findIndex((re) => re.test(name))
  return i < 0 ? 50 : i
}

const REGION_PREFIX = { German: 'Germany', French: 'France', Italian: 'Italy', Spanish: 'Spain' }

function regionLabel(country, titles) {
  const first = titles[0]?.split(' ')[0]
  if (REGION_PREFIX[first] && titles.every((t) => t.startsWith(first))) return REGION_PREFIX[first]
  return COUNTRY_LABELS[country] ?? country
}

const GROUP_TITLES = {
  fomc: { decision: 'FOMC rate decision', presser: 'FOMC press conference', minutes: 'FOMC meeting minutes' },
  ecb: { decision: 'ECB rate decision', presser: 'ECB press conference', minutes: 'ECB meeting accounts' },
  boe: { decision: 'BoE rate decision' },
  boj: { decision: 'BoJ rate decision', presser: 'BoJ press conference' },
}

/** Titre lisible d'une publication regroupée. */
export function groupTitle(kind, category, country, titles) {
  const fixed = GROUP_TITLES[kind]?.[category]
  if (fixed) return fixed
  const region = regionLabel(country, titles)
  const stage = (() => {
    const joined = titles.join(' ')
    if (/\bFlash\b/i.test(joined)) return ' (flash)'
    if (/\bAdvance\b/i.test(joined)) return ' (advance)'
    if (/\bPrelim\b/i.test(joined) && kind === 'gdp') return ' (second estimate)'
    if (/\bFinal\b/i.test(joined) && kind === 'gdp') return ' (third estimate)'
    return ''
  })()
  switch (kind) {
    case 'cpi':
      return `${region} CPI${stage}`
    case 'pce':
      return `${region} PCE inflation`
    case 'nfp':
      return 'US jobs report (NFP)'
    case 'gdp':
      return `${region} GDP${stage}`
    case 'retail':
      return `${region} retail sales`
    case 'claims':
      return `${region} jobless claims`
    case 'labor':
      return `${region} labor market`
    default:
      return titles.length === 1 ? titles[0] : `${region} ${titles[0]}`
  }
}

const GROUPABLE = new Set(['fomc', 'ecb', 'boe', 'boj', 'cpi', 'pce', 'nfp', 'gdp', 'retail', 'labor'])

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)

/**
 * Regroupe les lignes d'une même publication (même zone, même heure, même type)
 * en un événement portant plusieurs mesures.
 */
export function groupReleases(rows) {
  const groups = new Map()
  for (const row of rows) {
    const { kind, category } = row.kind ? row : classify(row.title, row.country)
    const regionWord = REGION_PREFIX[row.title.split(' ')[0]] ? row.title.split(' ')[0] : ''
    const key = GROUPABLE.has(kind)
      ? `${row.country}|${row.ts}|${kind}|${category}|${regionWord}`
      : `${row.country}|${row.ts}|${kind}|${category}|${row.title}`
    let group = groups.get(key)
    if (!group) {
      group = { kind, category, country: row.country, ts: row.ts, impact: row.impact, region: regionWord, rows: [] }
      groups.set(key, group)
    }
    if (IMPACT_RANK[row.impact] > IMPACT_RANK[group.impact]) group.impact = row.impact
    group.rows.push(row)
  }

  const events = []
  for (const group of groups.values()) {
    const measures = group.rows
      .map((r) => ({ name: r.title, forecast: r.forecast, previous: r.previous, actual: r.actual }))
      .sort((a, b) => headlineRank(group.kind, a.name) - headlineRank(group.kind, b.name))
    const titles = group.rows.map((r) => r.title)
    const title = groupTitle(group.kind, group.category, group.country, titles)
    const headline = measures[0]
    const date = new Date(group.ts).toISOString().slice(0, 10)
    events.push({
      id: GROUPABLE.has(group.kind)
        ? `ff-${group.country.toLowerCase()}-${group.kind}-${group.category}${group.region ? `-${group.region.toLowerCase()}` : ''}-${date}-${group.ts}`
        : `ff-${group.country.toLowerCase()}-${group.kind}-${slug(titles[0])}-${group.ts}`,
      kind: group.kind,
      category: group.category,
      title,
      country: group.country,
      ts: group.ts,
      impact: group.impact,
      allDay: false,
      forecast: headline?.forecast ?? null,
      previous: headline?.previous ?? null,
      actual: headline?.actual ?? null,
      measures,
      isReference: false,
      sources: ['faireconomy'],
    })
  }
  return events.sort((a, b) => a.ts - b.ts)
}

/**
 * Fusionne flux live et référence : un événement live du même type à moins de
 * `toleranceMs` d'un événement de référence le confirme (identifiant stable de
 * la référence, heure et chiffres du flux live) ; sinon la référence est gardée.
 */
export function mergeWithReference(liveEvents, refEvents, toleranceMs = 3 * 3_600_000) {
  const used = new Set()
  const out = []
  for (const ref of refEvents) {
    let best = null
    for (const live of liveEvents) {
      if (used.has(live) || live.kind !== ref.kind || live.category !== ref.category) continue
      const gap = Math.abs(live.ts - ref.ts)
      if (gap <= toleranceMs && (!best || gap < Math.abs(best.ts - ref.ts))) best = live
    }
    if (best) {
      used.add(best)
      out.push({
        ...best,
        id: ref.id,
        title: ref.title,
        meeting: ref.meeting,
        links: ref.links,
        isReference: false,
        sources: ['faireconomy', 'reference'],
      })
    } else {
      out.push(ref)
    }
  }
  for (const live of liveEvents) if (!used.has(live)) out.push(live)
  return out.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1))
}

/** Chaîne de pipeline complète sur les lignes brutes. */
export function buildCalendarEvents({ rawRows, refEvents, fromTs, toTs }) {
  const rows = []
  const seen = new Set()
  for (const raw of rawRows) {
    const row = normalizeFfRow(raw)
    if (!row || !isCurated(row)) continue
    if (row.ts < fromTs || row.ts >= toTs) continue
    const dedupeKey = `${row.country}|${row.ts}|${row.title}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    rows.push(row)
  }
  return mergeWithReference(groupReleases(rows), refEvents)
}

/** « 0.3% » → { value: 0.3, unit: '%' } ; « 207K » → { value: 207, unit: 'K' } ; « 3-0-6 » → null. */
export function parseFfNumber(text) {
  if (text == null) return null
  const m = /^([+-]?\d+(?:\.\d+)?)\s*(%|K|M|B|T)?$/i.exec(String(text).trim())
  if (!m) return null
  return { value: Number(m[1]), unit: (m[2] ?? '').toUpperCase() }
}

/** Écart publié vs consensus (sans jugement bon/mauvais). */
export function surprise(actual, forecast) {
  const a = parseFfNumber(actual)
  const f = parseFfNumber(forecast)
  if (!a || !f || a.unit !== f.unit) return null
  const diff = Math.round((a.value - f.value) * 1e6) / 1e6
  return diff > 0 ? 'above' : diff < 0 ? 'below' : 'inline'
}
