/*
 * « Actual » des publications, lu ou calculé à la source officielle — jamais inventé.
 * Une table de règles déclare, par zone, type d'événement et nom de mesure, la famille
 * de données qui porte le chiffre (`ctx[famille]`) et la manière de le lire.
 * Garde-fous : la période de référence doit exister et, pour les sources révisées en
 * place ou « dernier communiqué », la publication doit dater du jour de l'événement.
 * Les mesures sans règle restent sans « actual » (aucune source ouverte fiable).
 */
import { momDiff, momPct, shiftMonth, yoy } from '../../../shared/analytics/macroseries.mjs'
import { dayKey, zonedParts } from '../../../shared/analytics/macrotime.mjs'
import { surprise } from './calendar.mjs'

const NY = 'America/New_York'
const pad = (n) => String(n).padStart(2, '0')
const GRACE_MS = 5 * 60_000

/* Fuseau de publication de chaque zone : sert à dater l'événement comme la source. */
const ZONE_TZ = { USD: NY, GBP: 'Europe/London', EUR: 'Europe/Berlin', JPY: 'Asia/Tokyo' }
const localDate = (e) => dayKey(e.ts, ZONE_TZ[e.country] ?? 'UTC')

/** Mois de référence d'une publication mensuelle : le mois précédant la publication (heure de New York). */
export function refMonthFor(ts) {
  const p = zonedParts(ts, NY)
  return shiftMonth(`${p.year}-${pad(p.month)}-01`, -1)
}

/** Trimestre de référence : dernier trimestre achevé avant la publication. */
export function refQuarterFor(ts) {
  const p = zonedParts(ts, NY)
  const current = Math.floor((p.month - 1) / 3)
  const year = current === 0 ? p.year - 1 : p.year
  const quarter = (current + 3) % 4
  return `${year}-${pad(quarter * 3 + 1)}-01`
}

export const nyDate = (ts) => dayKey(ts, NY)

/** Mois civil de la publication (enquêtes du mois en cours : Michigan, Conference Board). */
const releaseMonth = (ts) => `${nyDate(ts).slice(0, 7)}-01`

/** Samedi clôturant la semaine couverte par un communiqué hebdomadaire des inscriptions. */
export function claimsWeekEnding(ts) {
  const d = new Date(`${nyDate(ts)}T12:00:00Z`)
  const back = (d.getUTCDay() + 1) % 7 || 7
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10)
}

const at = (rows, d) => rows?.find((r) => r.d === d)?.v

const modifiedAfter = (lastModified, ts) => {
  const t = Date.parse(lastModified ?? '')
  return Number.isFinite(t) && t >= ts - GRACE_MS
}

/* ---------- Mise en forme : même unité et même précision que le calendrier ---------- */

const TEMPLATE = /^([^\d+-]*)[+-]?\d+(?:\.(\d+))?\s*(%|K|M|B|T)?$/i

/**
 * Nombre → texte au format des chiffres du calendrier (préfixe, décimales, unité),
 * d'après la prévision ou le précédent ; `digits` sinon.
 */
export function formatLike(value, templates, { unit = '', digits = 1 } = {}) {
  let prefix = ''
  let places = digits
  for (const template of templates) {
    const m = TEMPLATE.exec(String(template ?? '').trim())
    if (!m || (m[3] ?? '').toUpperCase() !== unit) continue
    prefix = m[1].trim()
    places = Math.min((m[2] ?? '').length, 3)
    break
  }
  return `${prefix}${value.toFixed(places)}${unit}`
}

/* ---------- Lecteurs par famille ---------- */

/** Valeur la plus récente d'une série ONS, si le jeu a été publié le jour de l'événement. */
function onsLatest(ons, key, e) {
  const s = ons?.series?.[key]
  if (!s || s.releaseDate !== localDate(e) || !s.rows?.length) return null
  return s.rows[s.rows.length - 1].v
}

/** Variation du nombre de demandeurs (milliers) entre les deux derniers mois publiés. */
function onsClaimantChange(ons, e) {
  const s = ons?.series?.claimants
  if (!s || s.releaseDate !== localDate(e)) return null
  const diff = momDiff(s.rows ?? [], 1)
  return diff.length ? diff[diff.length - 1].v : null
}

/** Estimation rapide / définitive de l'IPCH : jeu mis à jour le jour même, dernier mois disponible. */
function euroHicp(hicp, stage, scope, e) {
  const rows = hicp?.[stage]?.[scope]
  if (!rows?.length || hicp.updated !== localDate(e)) return null
  return rows[rows.length - 1].v
}

const decisionOn = (list, e) => (list ?? []).find((d) => d.date === localDate(e)) ?? null

/** Inscriptions hebdomadaires (milliers) : communiqué DOL du jour, sinon FRED (ICSA) pour la semaine attendue. */
function claimsFor(dol, e) {
  const release = dol?.releases?.[nyDate(e.ts)]
  const week = claimsWeekEnding(e.ts)
  if (release && release.weekEnding === week) return { v: release.initialClaims / 1000, source: 'US Department of Labor' }
  const fred = at(dol?.fred, week)
  return Number.isFinite(fred) ? { v: fred / 1000, source: 'FRED (US Department of Labor data)' } : null
}

const PRELIM = /^Prelim\b/i

/** Lecture Michigan du mois de publication, au stade de l'événement (préliminaire ou définitif). */
function michiganReading(u, e) {
  const stage = e.measures.some((m) => PRELIM.test(m.name)) ? 'preliminary' : 'final'
  return (u.readings ?? []).find((r) => r.month === releaseMonth(e.ts) && r.stage === stage) ?? null
}

/**
 * Règles : zone, types (optionnel), nom de mesure, famille, éditeur (source attendue),
 * lecture → nombre (mis en forme comme le calendrier) ou texte déjà formaté.
 * `series` : séries ONS à charger pour cette mesure.
 * @type {Array<{ country: string, kinds?: string[], name: RegExp, family: string, publisher: string,
 *   source?: string, unit?: string, digits?: number, series?: string[],
 *   read: (data: any, e: any) => number | string | { v: number, source: string } | null | undefined }>}
 */
export const ACTUAL_RULES = [
  /* ---------- États-Unis ---------- */
  { country: 'USD', kinds: ['cpi'], name: /^CPI m\/m$/i, family: 'bls', publisher: 'BLS', source: 'BLS (computed from index levels)', unit: '%', read: (b, e) => at(momPct(b.series?.cpiSa ?? []), refMonthFor(e.ts)) },
  { country: 'USD', kinds: ['cpi'], name: /^Core CPI m\/m$/i, family: 'bls', publisher: 'BLS', source: 'BLS (computed from index levels)', unit: '%', read: (b, e) => at(momPct(b.series?.coreCpiSa ?? []), refMonthFor(e.ts)) },
  { country: 'USD', kinds: ['cpi'], name: /^CPI y\/y$/i, family: 'bls', publisher: 'BLS', source: 'BLS (computed from index levels)', unit: '%', read: (b, e) => at(yoy(b.series?.cpiNsa ?? []), refMonthFor(e.ts)) },
  { country: 'USD', kinds: ['cpi'], name: /^Core CPI y\/y$/i, family: 'bls', publisher: 'BLS', source: 'BLS (computed from index levels)', unit: '%', read: (b, e) => at(yoy(b.series?.coreCpiNsa ?? []), refMonthFor(e.ts)) },
  { country: 'USD', kinds: ['nfp'], name: /^Non-Farm Employment Change$/i, family: 'bls', publisher: 'BLS', unit: 'K', digits: 0, read: (b, e) => at(momDiff(b.series?.payems ?? []), refMonthFor(e.ts)) },
  { country: 'USD', kinds: ['nfp'], name: /^Unemployment Rate$/i, family: 'bls', publisher: 'BLS', unit: '%', read: (b, e) => at(b.series?.unrate, refMonthFor(e.ts)) },
  { country: 'USD', kinds: ['nfp'], name: /^Average Hourly Earnings m\/m$/i, family: 'bls', publisher: 'BLS', unit: '%', read: (b, e) => at(momPct(b.series?.ahe ?? []), refMonthFor(e.ts)) },
  // PPI : lignes « other » du calendrier (pas de regroupement dédié)
  { country: 'USD', name: /^PPI m\/m$/i, family: 'bls', publisher: 'BLS', source: 'BLS (computed from index levels)', unit: '%', read: (b, e) => at(momPct(b.series?.ppiSa ?? []), refMonthFor(e.ts)) },
  { country: 'USD', name: /^Core PPI m\/m$/i, family: 'bls', publisher: 'BLS', source: 'BLS (computed from index levels)', unit: '%', read: (b, e) => at(momPct(b.series?.corePpiSa ?? []), refMonthFor(e.ts)) },
  { country: 'USD', name: /^PPI y\/y$/i, family: 'bls', publisher: 'BLS', source: 'BLS (computed from index levels)', unit: '%', read: (b, e) => at(yoy(b.series?.ppiNsa ?? []), refMonthFor(e.ts)) },
  { country: 'USD', name: /^Core PPI y\/y$/i, family: 'bls', publisher: 'BLS', source: 'BLS (computed from index levels)', unit: '%', read: (b, e) => at(yoy(b.series?.corePpiNsa ?? []), refMonthFor(e.ts)) },
  // JOLTS : publié début M+2 pour le mois M, en milliers → millions
  { country: 'USD', kinds: ['jolts'], name: /^JOLTS Job Openings$/i, family: 'bls', publisher: 'BLS', unit: 'M', digits: 2, read: (b, e) => {
    const v = at(b.series?.jolts, shiftMonth(refMonthFor(e.ts), -1))
    return Number.isFinite(v) ? v / 1000 : null
  } },
  { country: 'USD', kinds: ['pce'], name: /^Core PCE Price Index m\/m$/i, family: 'bea', publisher: 'BEA', source: 'BEA (computed from index levels)', unit: '%', read: (b, e) => (modifiedAfter(b.lastModifiedM, e.ts) ? at(momPct(b.monthly?.corePce ?? []), refMonthFor(e.ts)) : null) },
  { country: 'USD', kinds: ['pce'], name: /^Core PCE Price Index y\/y$/i, family: 'bea', publisher: 'BEA', source: 'BEA (computed from index levels)', unit: '%', read: (b, e) => (modifiedAfter(b.lastModifiedM, e.ts) ? at(yoy(b.monthly?.corePce ?? []), refMonthFor(e.ts)) : null) },
  { country: 'USD', kinds: ['pce'], name: /^PCE Price Index m\/m$/i, family: 'bea', publisher: 'BEA', source: 'BEA (computed from index levels)', unit: '%', read: (b, e) => (modifiedAfter(b.lastModifiedM, e.ts) ? at(momPct(b.monthly?.pce ?? []), refMonthFor(e.ts)) : null) },
  { country: 'USD', kinds: ['pce'], name: /^PCE Price Index y\/y$/i, family: 'bea', publisher: 'BEA', source: 'BEA (computed from index levels)', unit: '%', read: (b, e) => (modifiedAfter(b.lastModifiedM, e.ts) ? at(yoy(b.monthly?.pce ?? []), refMonthFor(e.ts)) : null) },
  { country: 'USD', kinds: ['gdp'], name: /GDP q\/q$/i, family: 'bea', publisher: 'BEA', unit: '%', read: (b, e) => (modifiedAfter(b.lastModifiedQ, e.ts) ? at(b.quarterly?.gdpQoQ, refQuarterFor(e.ts)) : null) },
  { country: 'USD', kinds: ['fomc'], name: /^Federal Funds Rate$/i, family: 'fed', publisher: 'Federal Reserve', source: 'Fed statement', unit: '%', digits: 2, read: (f, e) => {
    if (e.category !== 'decision') return null
    return (f.decisions ?? []).find((d) => d.date === nyDate(e.ts) && d.decision)?.decision.upper ?? null
  } },
  { country: 'USD', kinds: ['claims'], name: /^Unemployment Claims$/i, family: 'dol', publisher: 'US Department of Labor', unit: 'K', digits: 0, read: claimsFor },
  { country: 'USD', kinds: ['retail'], name: /^Retail Sales m\/m$/i, family: 'retail', publisher: 'Census Bureau', source: 'Census Bureau via FRED (computed from sales levels)', unit: '%', read: (r, e) => at(momPct(r.series?.total ?? []), refMonthFor(e.ts)) },
  { country: 'USD', kinds: ['retail'], name: /^Core Retail Sales m\/m$/i, family: 'retail', publisher: 'Census Bureau', source: 'Census Bureau via FRED (computed from sales levels)', unit: '%', read: (r, e) => at(momPct(r.series?.exAuto ?? []), refMonthFor(e.ts)) },
  { country: 'USD', kinds: ['ism'], name: /^ISM Manufacturing PMI$/i, family: 'ism', publisher: 'ISM', source: 'ISM press release', read: (items, e) => items.find((h) => h.sector === 'manufacturing' && h.date === nyDate(e.ts))?.pmi },
  { country: 'USD', kinds: ['ism'], name: /^ISM Services PMI$/i, family: 'ism', publisher: 'ISM', source: 'ISM press release', read: (items, e) => items.find((h) => h.sector === 'services' && h.date === nyDate(e.ts))?.pmi },
  { country: 'USD', kinds: ['sentiment'], name: /^(Prelim|Revised) UoM Consumer Sentiment$/i, family: 'umich', publisher: 'University of Michigan', read: (u, e) => michiganReading(u, e)?.sentiment },
  { country: 'USD', kinds: ['sentiment'], name: /^(Prelim|Revised) UoM Inflation Expectations$/i, family: 'umich', publisher: 'University of Michigan', unit: '%', read: (u, e) => michiganReading(u, e)?.inflation1y },
  { country: 'USD', name: /^CB Consumer Confidence$/i, family: 'confboard', publisher: 'The Conference Board', read: (c, e) => (c.readings ?? []).find((r) => r.month === releaseMonth(e.ts))?.index },

  /* ---------- Royaume-Uni ---------- */
  { country: 'GBP', kinds: ['boe'], name: /^Official Bank Rate$/i, family: 'boe', publisher: 'Bank of England', source: 'Bank of England Monetary Policy Summary', unit: '%', digits: 2, read: (b, e) => decisionOn(b.decisions, e)?.rate },
  { country: 'GBP', kinds: ['boe'], name: /^MPC Official Bank Rate Votes$/i, family: 'boe', publisher: 'Bank of England', source: 'Bank of England Monetary Policy Summary', read: (b, e) => {
    // format du calendrier : hausse–baisse–maintien
    const v = decisionOn(b.decisions, e)?.votes
    return v ? `${v.hike}-${v.cut}-${v.hold}` : null
  } },
  { country: 'GBP', kinds: ['cpi'], name: /^CPI y\/y$/i, family: 'ons', publisher: 'ONS', series: ['cpiYoY'], unit: '%', read: (o, e) => onsLatest(o, 'cpiYoY', e) },
  { country: 'GBP', kinds: ['cpi'], name: /^Core CPI y\/y$/i, family: 'ons', publisher: 'ONS', series: ['coreCpiYoY'], unit: '%', read: (o, e) => onsLatest(o, 'coreCpiYoY', e) },
  { country: 'GBP', kinds: ['cpi'], name: /^CPI m\/m$/i, family: 'ons', publisher: 'ONS', series: ['cpiMoM'], unit: '%', read: (o, e) => onsLatest(o, 'cpiMoM', e) },
  { country: 'GBP', kinds: ['labor'], name: /^Claimant Count Change$/i, family: 'ons', publisher: 'ONS', source: 'ONS (computed from claimant levels)', series: ['claimants'], unit: 'K', digits: 1, read: onsClaimantChange },
  { country: 'GBP', kinds: ['labor'], name: /^Average Earnings Index 3m\/y$/i, family: 'ons', publisher: 'ONS', series: ['earnings3m'], unit: '%', read: (o, e) => onsLatest(o, 'earnings3m', e) },
  { country: 'GBP', kinds: ['labor'], name: /^Unemployment Rate$/i, family: 'ons', publisher: 'ONS', series: ['unemployment'], unit: '%', read: (o, e) => onsLatest(o, 'unemployment', e) },
  { country: 'GBP', kinds: ['gdp'], name: /^GDP m\/m$/i, family: 'ons', publisher: 'ONS', series: ['gdpMoM'], unit: '%', read: (o, e) => onsLatest(o, 'gdpMoM', e) },
  { country: 'GBP', kinds: ['gdp'], name: /^Prelim GDP q\/q$/i, family: 'ons', publisher: 'ONS', series: ['gdpQoQFirst'], unit: '%', read: (o, e) => onsLatest(o, 'gdpQoQFirst', e) },
  { country: 'GBP', kinds: ['gdp'], name: /^(Revised|Final) GDP q\/q$/i, family: 'ons', publisher: 'ONS', series: ['gdpQoQ'], unit: '%', read: (o, e) => onsLatest(o, 'gdpQoQ', e) },
  { country: 'GBP', kinds: ['retail'], name: /^Retail Sales m\/m$/i, family: 'ons', publisher: 'ONS', series: ['retailMoM'], unit: '%', read: (o, e) => onsLatest(o, 'retailMoM', e) },
  { country: 'GBP', kinds: ['retail'], name: /^Core Retail Sales m\/m$/i, family: 'ons', publisher: 'ONS', series: ['coreRetailMoM'], unit: '%', read: (o, e) => onsLatest(o, 'coreRetailMoM', e) },

  /* ---------- Zone euro ---------- */
  { country: 'EUR', kinds: ['ecb'], name: /^Main Refinancing Rate$/i, family: 'ecb', publisher: 'ECB', source: 'ECB press release', unit: '%', digits: 2, read: (b, e) => decisionOn(b.decisions, e)?.mro },
  { country: 'EUR', kinds: ['ecb'], name: /^Deposit Facility Rate$/i, family: 'ecb', publisher: 'ECB', source: 'ECB press release', unit: '%', digits: 2, read: (b, e) => decisionOn(b.decisions, e)?.deposit },
  { country: 'EUR', kinds: ['ecb'], name: /^Marginal Lending Facility Rate$/i, family: 'ecb', publisher: 'ECB', source: 'ECB press release', unit: '%', digits: 2, read: (b, e) => decisionOn(b.decisions, e)?.mlf },
  { country: 'EUR', kinds: ['cpi'], name: /^CPI Flash Estimate y\/y$/i, family: 'eurostat', publisher: 'Eurostat', unit: '%', read: (h, e) => euroHicp(h, 'flash', 'total', e) },
  { country: 'EUR', kinds: ['cpi'], name: /^Core CPI Flash Estimate y\/y$/i, family: 'eurostat', publisher: 'Eurostat', unit: '%', read: (h, e) => euroHicp(h, 'flash', 'core', e) },
  { country: 'EUR', kinds: ['cpi'], name: /^Final CPI y\/y$/i, family: 'eurostat', publisher: 'Eurostat', unit: '%', read: (h, e) => euroHicp(h, 'final', 'total', e) },
  { country: 'EUR', kinds: ['cpi'], name: /^Final Core CPI y\/y$/i, family: 'eurostat', publisher: 'Eurostat', unit: '%', read: (h, e) => euroHicp(h, 'final', 'core', e) },

  /* ---------- Japon ---------- */
  { country: 'JPY', kinds: ['boj'], name: /^BOJ Policy Rate$/i, family: 'boj', publisher: 'Bank of Japan', source: 'Bank of Japan statement', unit: '%', digits: 2, read: (b, e) => decisionOn(b.decisions, e)?.rate },
]

/** Règle applicable à une mesure d'un événement (null si AirMacro n'a pas de source). */
export function ruleFor(event, measureName) {
  return (
    ACTUAL_RULES.find(
      (r) => r.country === event.country && (!r.kinds || r.kinds.includes(event.kind)) && r.name.test(measureName),
    ) ?? null
  )
}

/** Éditeur officiel dont AirMacro lit le chiffre de cet événement, ou null. */
export function actualSupport(event) {
  for (const m of event?.measures ?? []) {
    const rule = ruleFor(event, m.name)
    if (rule) return rule.publisher
  }
  // décision FOMC tirée du seul calendrier de référence (mesure reconstituée plus tard)
  if (event?.kind === 'fomc' && event.category === 'decision' && event.country === 'USD') return 'Federal Reserve'
  return null
}

/**
 * Familles de données nécessaires aux événements déjà publiés (et séries ONS à charger).
 * @returns {Map<string, { events: any[], series: Set<string> }>}
 */
export function actualNeeds(events, now) {
  const needs = new Map()
  for (const e of events ?? []) {
    if (e.allDay || e.ts > now) continue
    const measures = e.measures?.length ? e.measures : e.kind === 'fomc' && e.category === 'decision' ? [{ name: 'Federal Funds Rate' }] : []
    for (const m of measures) {
      const rule = ruleFor(e, m.name)
      if (!rule) continue
      let need = needs.get(rule.family)
      if (!need) needs.set(rule.family, (need = { events: [], series: new Set() }))
      if (!need.events.includes(e)) need.events.push(e)
      for (const s of rule.series ?? []) need.series.add(s)
    }
  }
  return needs
}

function resolveMeasure(event, name, ctx) {
  const rule = ruleFor(event, name)
  const data = rule ? ctx[rule.family] : null
  if (!rule || data == null) return null
  let value
  try {
    value = rule.read(data, event)
  } catch {
    return null
  }
  let source = rule.source ?? rule.publisher
  if (value && typeof value === 'object') {
    source = value.source ?? source
    value = value.v
  }
  if (typeof value === 'string') return value ? { actual: value, source } : null
  if (!Number.isFinite(value)) return null
  const m = event.measures.find((x) => x.name === name)
  return { actual: formatLike(value, [m?.forecast, m?.previous], { unit: rule.unit ?? '', digits: rule.digits ?? 1 }), source }
}

/** Dernière borne haute connue avant une date (NY Fed), formatée comme le flux. */
function previousUpperBefore(policy, date) {
  const rows = policy?.targetHistory ?? []
  let found = null
  for (const r of rows) {
    if (r.d < date && Number.isFinite(r.upper)) found = r
  }
  return found ? `${found.upper.toFixed(2)}%` : null
}

/** Mesures annotées de l'éditeur qui publiera leur chiffre (`actualFrom`), quand AirMacro sait le lire. */
function withPublishers(event, measures) {
  return measures.map((m) => {
    const rule = ruleFor(event, m.name)
    return rule ? { ...m, actualFrom: rule.publisher } : m
  })
}

/**
 * Renvoie l'événement enrichi : mesures avec `actual`, `actualSource`, `surprise`,
 * `actualFrom` (éditeur dont AirMacro lit le chiffre, aussi porté par l'événement)
 * et `decision` pour le FOMC. Un événement futur n'est jamais enrichi de chiffres.
 * @param {any} event
 * @param {Record<string, any>} ctx données par famille (bls, bea, fed, policy, dol, ons…)
 * @param {number} now
 */
export function attachActuals(event, ctx, now) {
  const actualFrom = actualSupport(event)
  if (event.ts > now || event.allDay) {
    return actualFrom ? { ...event, actualFrom, measures: withPublishers(event, event.measures ?? []) } : event
  }
  let measures = event.measures ?? []
  let decision = null

  if (event.kind === 'fomc' && event.category === 'decision') {
    const found = ctx.fed?.decisions?.find((d) => d.date === nyDate(event.ts) && d.decision)
    if (found) {
      decision = { ...found.decision, url: found.url }
      if (!measures.some((m) => /^Federal Funds Rate$/i.test(m.name))) {
        // flux live absent : mesure reconstituée (précédent = dernière cible NY Fed connue)
        measures = [
          { name: 'Federal Funds Rate', forecast: null, previous: previousUpperBefore(ctx.policy, nyDate(event.ts)), actual: null },
          ...measures,
        ]
      }
    }
  }

  const withMeasures = { ...event, measures }
  const enriched = withPublishers(event, measures).map((m) => {
    if (m.actual != null) return { ...m, actualSource: m.actualSource ?? 'calendar feed', surprise: surprise(m.actual, m.forecast) }
    const found = resolveMeasure(withMeasures, m.name, ctx)
    if (!found) return m
    return { ...m, actual: found.actual, actualSource: found.source, surprise: surprise(found.actual, m.forecast) }
  })
  const headline = enriched[0]
  return {
    ...event,
    measures: enriched,
    forecast: headline?.forecast ?? event.forecast ?? null,
    previous: headline?.previous ?? event.previous ?? null,
    actual: headline?.actual ?? null,
    ...(actualFrom ? { actualFrom } : {}),
    ...(decision ? { decision } : {}),
  }
}
