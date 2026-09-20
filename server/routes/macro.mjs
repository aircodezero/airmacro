/*
 * Endpoints AirMacro :
 *   GET /api/macro/calendar — semaine courante + suivante (flux curé ⊕ référence) avec « actual » officiels
 *   GET /api/macro/series   — tuiles, graphiques et politique monétaire (familles indépendantes)
 */
import { isOffline, worstSource } from '../lib/cache.mjs'
import { upstreamStats } from '../lib/http.mjs'
import { part, composed, wrap } from './util.mjs'
import {
  HOUR,
  MIN,
  familyMeta,
  familySource,
  rMacroBea,
  rMacroBls,
  rMacroBoe,
  rMacroBoj,
  rMacroConfBoard,
  rMacroDol,
  rMacroDxy,
  rMacroEcb,
  rMacroEurostat,
  rMacroFed,
  rMacroFf,
  rMacroIsm,
  rMacroNyfed,
  rMacroOns,
  rMacroRetail,
  rMacroTreasury,
  rMacroUmich,
  rMacroVix,
  rMacroWti,
} from '../lib/macro/sources.mjs'
import { buildCalendarEvents } from '../lib/macro/calendar.mjs'
import { actualNeeds, attachActuals, ruleFor } from '../lib/macro/actuals.mjs'
import { buildSeries } from '../lib/macro/build.mjs'
import { lastMeeting, nextMeeting, referenceEvents } from '../lib/macro/reference.mjs'
import { calendarWeekStart } from '../../shared/analytics/macrotime.mjs'
import { llmHealth, registerExplainApi } from './macro-explain.mjs'
import { registerNotifyApi } from './macro-notify.mjs'

const DAY = 24 * HOUR

/* Derniers événements servis : pilotent les TTL adaptatifs (jours de publication). */
let lastEvents = []

const releasedWithin = (e, now, ms) => !e.allDay && e.ts <= now && now - e.ts < ms

/** 5 min si un événement High tombe dans les 12 h (avant ou après), sinon 15 min. */
export function calendarTtl(events, now) {
  const busy = events.some((e) => e.impact === 'High' && !e.allDay && Math.abs(e.ts - now) < 12 * HOUR)
  return busy ? 5 * MIN : 15 * MIN
}

/** L'événement attend-il un chiffre que la famille `family` doit fournir ? */
const awaits = (e, family) => (e.measures ?? []).some((m) => m.actual == null && ruleFor(e, m.name)?.family === family)

/*
 * Publication officielle récente sans « actual » : sondage toutes les 3 min pendant
 * 20 min (le chiffre part vite en notification), puis toutes les 15 min jusqu'à 90 min.
 * BLS : au plus ~12 requêtes un jour de publication (quota 25/jour).
 */
function pendingTtl(events, now, kinds, idle, family) {
  let ttl = idle
  for (const e of events) {
    if (e.country !== 'USD' || !releasedWithin(e, now, 90 * MIN)) continue
    const pending = kinds.includes(e.kind) ? e.actual == null : family ? awaits(e, family) : false
    if (!pending) continue
    if (now - e.ts < 20 * MIN) return 3 * MIN
    ttl = 15 * MIN
  }
  return ttl
}

// BLS couvre aussi le PPI et les offres d'emploi JOLTS (mesures reconnues par les règles d'« actual »)
export const blsTtl = (events, now) => pendingTtl(events, now, ['cpi', 'nfp'], 12 * HOUR, 'bls')
export const beaTtl = (events, now) => pendingTtl(events, now, ['pce', 'gdp'], 6 * HOUR)

/*
 * Sources « au fil des communiqués » (DOL, ONS, BoE, BCE, BoJ, Eurostat, FRED, enquêtes) :
 * elles ne relisent que ce qui manque, le TTL règle seulement la cadence d'attente.
 * 2 min pendant 20 min après la publication, 10 min jusqu'à 3 h, puis toutes les heures
 * (au-delà de 2 jours, toutes les 6 h) ; une fois tous les chiffres lus, une fois par jour.
 */
export function releaseTtl(family, events, previous, now) {
  let ttl = 24 * HOUR
  for (const e of events) {
    const last = previous.find((p) => p.id === e.id)
    if (last && !awaits(last, family)) continue
    const age = now - e.ts
    ttl = Math.min(ttl, age < 20 * MIN ? 2 * MIN : age < 3 * HOUR ? 10 * MIN : age < 2 * DAY ? HOUR : 6 * HOUR)
  }
  return ttl
}

/* Familles de chiffres publiés : résolveur (ttl, événements concernés, séries ONS). */
const RELEASE_FAMILIES = {
  dol: rMacroDol,
  retail: rMacroRetail,
  ons: rMacroOns,
  boe: rMacroBoe,
  ecb: rMacroEcb,
  boj: rMacroBoj,
  eurostat: rMacroEurostat,
  ism: rMacroIsm,
  umich: rMacroUmich,
  confboard: rMacroConfBoard,
}

/** Communiqué FOMC : sondage toutes les 2 min pendant 3 h après l'heure de décision. */
export function fedTtl(events, now) {
  const pending = events.some(
    (e) => e.kind === 'fomc' && e.category === 'decision' && releasedWithin(e, now, 3 * HOUR) && !e.decision,
  )
  return pending ? 2 * MIN : 30 * MIN
}

function policyCalendar(now) {
  const hold = 2 * HOUR
  const pick = (m) => (m ? { id: m.id, start: m.start, end: m.end, sep: m.sep, decisionTs: m.decisionTs, day1Ts: m.day1Ts } : null)
  return {
    nextFomc: pick(nextMeeting('fomc', now, hold)),
    followingFomc: pick(nextMeeting('fomc', (nextMeeting('fomc', now, hold)?.decisionTs ?? now) + 1)),
    lastFomc: pick(lastMeeting('fomc', now)),
    nextEcb: pick(nextMeeting('ecb', now, hold)),
  }
}

export async function calendarHandler() {
  const now = Date.now()
  const weekStart = calendarWeekStart(now)
  const fromTs = weekStart
  const toTs = weekStart + 14 * DAY

  const [ff, bls, bea, fed, nyfed] = await Promise.all([
    part(rMacroFf(calendarTtl(lastEvents, now))),
    part(rMacroBls(blsTtl(lastEvents, now))),
    part(rMacroBea(beaTtl(lastEvents, now))),
    part(rMacroFed(fedTtl(lastEvents, now))),
    part(rMacroNyfed()),
  ])

  const rawRows = [...(ff?.data?.thisWeek ?? []), ...(ff?.data?.nextWeek ?? [])]
  const refEvents = referenceEvents(fromTs, toTs)
  const base = buildCalendarEvents({ rawRows, refEvents, fromTs, toTs })

  // chiffres publiés : seules les familles utiles aux événements déjà passés sont interrogées
  const needs = actualNeeds(base, now)
  const releases = Object.fromEntries(
    await Promise.all(
      Object.entries(RELEASE_FAMILIES).map(async ([family, resolve]) => {
        const need = needs.get(family)
        if (!need) return [family, null]
        return [family, await part(resolve(releaseTtl(family, need.events, lastEvents, now), need.events, need.series))]
      }),
    ),
  )

  const ctx = {
    bls: bls?.data ?? null,
    bea: bea?.data ?? null,
    fed: fed?.data ?? null,
    policy: { targetHistory: nyfed?.data?.rows ?? [] },
    ...Object.fromEntries(Object.entries(releases).map(([family, env]) => [family, env?.data ?? null])),
  }
  // PMI ISM : la famille porte une liste de titres
  ctx.ism = releases.ism?.data?.items ?? null
  const events = base.map((e) => attachActuals(e, ctx, now))
  lastEvents = events

  return composed(
    {
      weekOf: new Date(weekStart).toISOString(),
      window: { from: fromTs, to: toTs },
      events,
      nextWeekPublished: Boolean(ff?.data?.nextWeekPublished),
      policy: policyCalendar(now),
      families: {
        calendar: familyMeta(ff),
        bls: familyMeta(bls),
        bea: familyMeta(bea),
        fed: familyMeta(fed),
        ...Object.fromEntries(Object.entries(releases).filter(([, env]) => env).map(([family, env]) => [family, familyMeta(env)])),
      },
      counts: {
        total: events.length,
        high: events.filter((e) => e.impact === 'High' && !e.allDay).length,
      },
    },
    {
      calendar: familySource(ff),
      actuals: (() => {
        const envs = [bls, bea, fed, ...Object.values(releases)].filter(Boolean)
        return envs.length ? worstSource(envs.map((env) => familySource(env) ?? 'seed')) : null
      })(),
    },
  )
}

export async function seriesHandler() {
  const now = Date.now()
  const [bls, bea, treasury, nyfed, fed, vix, dxy, wti] = await Promise.all([
    part(rMacroBls(blsTtl(lastEvents, now))),
    part(rMacroBea(beaTtl(lastEvents, now))),
    part(rMacroTreasury()),
    part(rMacroNyfed()),
    part(rMacroFed(fedTtl(lastEvents, now))),
    part(rMacroVix()),
    part(rMacroDxy()),
    part(rMacroWti()),
  ])
  const built = buildSeries(
    {
      bls: bls?.data,
      bea: bea?.data,
      treasury: treasury?.data,
      nyfed: nyfed?.data,
      fed: fed?.data,
      vix: vix?.data,
      dxy: dxy?.data,
      wti: wti?.data,
    },
    now,
  )
  const envs = { bls, bea, treasury, nyfed, fed, vix, dxy, wti }
  const families = Object.fromEntries(Object.entries(envs).map(([k, env]) => [k, familyMeta(env)]))
  const src = (k) => familySource(envs[k])
  const worst = (...keys) => {
    const list = keys.map(src)
    return list.every((s) => s == null) ? null : worstSource(list.map((s) => s ?? 'seed'))
  }
  return composed(
    { ...built, families },
    {
      inflation: worst('bls', 'bea'),
      labor: worst('bls'),
      rates: worst('treasury', 'nyfed'),
      growthRisk: worst('bea', 'vix', 'dxy', 'wti'),
    },
  )
}

/* ---------- Santé ---------- */

const MACRO_HOSTS = {
  faireconomy: 'nfs.faireconomy.media',
  bls: 'api.bls.gov',
  bea: 'apps.bea.gov',
  treasury: 'home.treasury.gov',
  cboe: 'cdn.cboe.com',
  nyfed: 'markets.newyorkfed.org',
  fed: 'www.federalreserve.gov',
  ecb: 'data-api.ecb.europa.eu',
  eia: 'api.eia.gov',
  fred: 'fred.stlouisfed.org',
  yahoo: 'query1.finance.yahoo.com',
  dol: 'www.dol.gov',
  ons: 'www.ons.gov.uk',
  boe: 'www.bankofengland.co.uk',
  ecbPress: 'www.ecb.europa.eu',
  boj: 'www.boj.or.jp',
  eurostat: 'ec.europa.eu',
  ism: 'www.prnewswire.com',
  umich: 'www.sca.isr.umich.edu',
  confboard: 'www.conference-board.org',
}

export async function macroHealth() {
  const stats = upstreamStats()
  const upstreams = {}
  for (const [name, host] of Object.entries(MACRO_HOSTS)) {
    const s = stats[host]
    upstreams[name] = s
      ? {
          host,
          lastSuccessAt: s.lastSuccessAt,
          lastErrorAt: s.lastErrorAt,
          lastError: s.lastError,
          successes: s.successes,
          failures: s.failures,
        }
      : { host, status: 'not contacted yet' }
  }
  return {
    offline: isOffline(),
    upstreams,
    llm: await llmHealth(),
    keys: {
      // présence uniquement — jamais la valeur
      eia: Boolean(process.env.EIA_API_KEY?.trim()),
      fred: Boolean(process.env.FRED_API_KEY?.trim()),
    },
  }
}

export function registerMacroApi(api) {
  api.get('/macro/calendar', wrap(calendarHandler))
  api.get('/macro/series', wrap(seriesHandler))
  registerExplainApi(api, { calendarHandler, seriesHandler })
  registerNotifyApi(api, { calendarHandler })
}
