/*
 * Résolveurs AirMacro : une clé de cache par famille de données, chacune avec sa
 * chaîne source officielle → repli → FRED → dernier bon connu (disque) → seed.
 * Les TTL sont passés par l'appelant (adaptatifs les jours de publication).
 */
import { resolveData } from '../cache.mjs'
import { diskBacked } from './diskcache.mjs'
import * as faireconomy from './providers/faireconomy.mjs'
import * as bls from './providers/bls.mjs'
import * as bea from './providers/bea.mjs'
import * as treasury from './providers/treasury.mjs'
import * as cboe from './providers/cboe.mjs'
import * as nyfed from './providers/nyfed.mjs'
import * as fedpress from './providers/fedpress.mjs'
import * as ecbfx from './providers/ecbfx.mjs'
import * as eia from './providers/eia.mjs'
import * as boe from './providers/boe.mjs'
import * as boj from './providers/boj.mjs'
import * as dol from './providers/dol.mjs'
import * as ecbpress from './providers/ecbpress.mjs'
import * as eurostat from './providers/eurostat.mjs'
import * as ism from './providers/ism.mjs'
import * as ons from './providers/ons.mjs'
import * as surveys from './providers/surveys.mjs'
import { fredSeries } from './providers/fred.mjs'
import * as yahoo from '../providers/yahoo.mjs'
import { dayKey } from '../../../shared/analytics/macrotime.mjs'
import { nyDate, refMonthFor } from './actuals.mjs'

export const MIN = 60_000
export const HOUR = 3_600_000
const DAY = 24 * HOUR

const isoDaysAgo = (days) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10)
const since = (rows, from) => (rows ?? []).filter((r) => r.d >= from)

/** Enveloppe de résolveur à partir d'un résultat disque. */
function fromDisk(disk) {
  return {
    provider: disk.value.provider,
    fetchedAt: disk.fetchedAt,
    data: { ...disk.value, fetchedAt: disk.fetchedAt, stale: disk.stale },
  }
}

/** Repli FRED : { clé: idFRED } → { clé: lignes } (erreur si tout est vide). */
async function fromFred(map, startDate) {
  const ids = Object.values(map)
  const { series, via } = await fredSeries(ids, startDate)
  const out = {}
  for (const [key, id] of Object.entries(map)) out[key] = series[id] ?? []
  if (Object.values(out).every((rows) => !rows.length)) throw new Error('fred: séries vides')
  return { via, series: out }
}

/* ---------- Calendrier (FairEconomy) ---------- */

export const rMacroFf = (ttlMs = 15 * MIN) =>
  resolveData({
    key: 'macro:ff',
    ttlMs,
    seed: 'macro-calendar',
    live: async () => {
      const disk = await diskBacked('ff-thisweek', ttlMs, async () => ({
        provider: 'FairEconomy',
        thisWeek: (await faireconomy.weekFeed('thisweek')) ?? [],
      }))
      // la semaine suivante n'est publiée qu'en fin de semaine : sondée au plus toutes les 30 min
      const next = await diskBacked('ff-nextweek', 30 * MIN, async () => ({
        provider: 'FairEconomy',
        nextWeek: await faireconomy.weekFeed('nextweek'),
      })).catch(() => null)
      const result = fromDisk(disk)
      result.data.nextWeek = next?.value?.nextWeek ?? null
      result.data.nextWeekPublished = Array.isArray(next?.value?.nextWeek)
      return result
    },
  })

/* ---------- BLS : IPC, emploi ---------- */

const FRED_BLS = {
  cpiNsa: 'CPIAUCNS',
  coreCpiNsa: 'CPILFENS',
  cpiSa: 'CPIAUCSL',
  coreCpiSa: 'CPILFESL',
  unrate: 'UNRATE',
  payems: 'PAYEMS',
  ahe: 'CES0500000003',
}

export const rMacroBls = (ttlMs = 12 * HOUR) =>
  resolveData({
    key: 'macro:bls',
    ttlMs,
    seed: 'macro-bls',
    liveBudgetMs: 12_000,
    live: async () => {
      const disk = await diskBacked('bls', ttlMs, async () => {
        const end = new Date().getUTCFullYear()
        try {
          return { provider: 'BLS', ...(await bls.fetchBls(end - 5, end)) }
        } catch (err) {
          const fred = await fromFred(FRED_BLS, `${end - 5}-01-01`).catch(() => null)
          if (!fred) throw err
          return { provider: fred.via, series: fred.series, preliminary: {}, missing: [] }
        }
      })
      return fromDisk(disk)
    },
  })

/* ---------- BEA : Core PCE, PIB ---------- */

const FRED_BEA_M = { corePce: 'PCEPILFE', pce: 'PCEPI' }
const FRED_BEA_Q = { gdpQoQ: 'A191RL1Q225SBEA' }
const BEA_FROM = '2016-01-01'

export const rMacroBea = (ttlMs = 6 * HOUR) =>
  resolveData({
    key: 'macro:bea',
    ttlMs,
    seed: 'macro-bea',
    liveBudgetMs: 15_000,
    live: async () => {
      const disk = await diskBacked('bea', ttlMs, async (prev) => {
        const usable = prev?.provider === 'BEA'
        try {
          const [m, q] = await Promise.all([
            bea.fetchNipa('M', usable ? prev.lastModifiedM : null),
            bea.fetchNipa('Q', usable ? prev.lastModifiedQ : null),
          ])
          const trim = (series) => Object.fromEntries(Object.entries(series).map(([k, rows]) => [k, since(rows, BEA_FROM)]))
          return {
            provider: 'BEA',
            monthly: m.notModified ? prev.monthly : trim(m.series),
            quarterly: q.notModified ? prev.quarterly : trim(q.series),
            lastModifiedM: m.notModified ? prev.lastModifiedM : m.lastModified,
            lastModifiedQ: q.notModified ? prev.lastModifiedQ : q.lastModified,
          }
        } catch (err) {
          const [fm, fq] = await Promise.all([
            fromFred(FRED_BEA_M, BEA_FROM).catch(() => null),
            fromFred(FRED_BEA_Q, BEA_FROM).catch(() => null),
          ])
          if (!fm && !fq) throw err
          // pas d'horodatage de publication fiable via FRED → pas d'« actual » dérivé
          return {
            provider: (fm ?? fq).via,
            monthly: fm?.series ?? { corePce: [], pce: [] },
            quarterly: fq?.series ?? { gdpQoQ: [] },
            lastModifiedM: null,
            lastModifiedQ: null,
          }
        }
      })
      return fromDisk(disk)
    },
  })

/* ---------- Trésor US : 10 ans, 3 mois ---------- */

export const rMacroTreasury = (ttlMs = HOUR) =>
  resolveData({
    key: 'macro:treasury',
    ttlMs,
    seed: 'macro-treasury',
    live: async () => {
      const disk = await diskBacked('treasury', ttlMs, async (prev) => {
        const year = new Date().getUTCFullYear()
        const byYear = {}
        try {
          for (const y of [year - 3, year - 2, year - 1, year]) {
            const cached = prev?.byYear?.[y]
            const complete = cached?.y10?.length && cached.y10[cached.y10.length - 1].d >= `${y}-12-28`
            if (y < year && complete) {
              byYear[y] = cached // année close : figée
              continue
            }
            try {
              byYear[y] = await treasury.yieldCurveYear(y)
            } catch (err) {
              if (y === year) throw err
            }
          }
          const merge = (field) => Object.values(byYear).flatMap((part) => part[field])
          return { provider: 'US Treasury', byYear, y10: merge('y10'), m3: merge('m3') }
        } catch (err) {
          const fred = await fromFred({ y10: 'DGS10', m3: 'DGS3MO' }, `${year - 3}-01-01`).catch(() => null)
          if (!fred) throw err
          return { provider: fred.via, byYear: {}, ...fred.series }
        }
      })
      return fromDisk(disk)
    },
  })

/* ---------- NY Fed : EFFR + fourchette cible ---------- */

export const rMacroNyfed = (ttlMs = 6 * HOUR) =>
  resolveData({
    key: 'macro:nyfed',
    ttlMs,
    seed: 'macro-nyfed',
    liveBudgetMs: 12_000,
    live: async () => {
      const disk = await diskBacked('nyfed', ttlMs, async () => {
        const start = isoDaysAgo(3 * 365 + 45)
        try {
          return { provider: 'NY Fed', rows: await nyfed.effrHistory(start, isoDaysAgo(0)) }
        } catch (err) {
          const fred = await fromFred({ upper: 'DFEDTARU', lower: 'DFEDTARL', effr: 'EFFR' }, start).catch(() => null)
          if (!fred) throw err
          const lower = new Map(fred.series.lower.map((r) => [r.d, r.v]))
          const upper = new Map(fred.series.upper.map((r) => [r.d, r.v]))
          const rows = fred.series.effr.map((r) => ({ d: r.d, effr: r.v, lower: lower.get(r.d) ?? null, upper: upper.get(r.d) ?? null }))
          return { provider: fred.via, rows }
        }
      })
      return fromDisk(disk)
    },
  })

/* ---------- Réserve fédérale : communiqués (décision du jour) ---------- */

export const rMacroFed = (ttlMs = 30 * MIN) =>
  resolveData({
    key: 'macro:fed',
    ttlMs,
    seed: 'macro-fed',
    liveBudgetMs: 12_000,
    live: async () => {
      const disk = await diskBacked('fed', ttlMs, async (prev) => {
        const items = await fedpress.monetaryFeed()
        const decisions = []
        for (const item of items.filter((i) => i.type === 'statement').slice(0, 3)) {
          const known = prev?.decisions?.find((d) => d.url === item.url && d.decision)
          if (known) {
            decisions.push(known)
            continue
          }
          const decision = await fedpress.statementDecision(item.url).catch(() => null)
          decisions.push({ date: item.date, url: item.url, decision })
        }
        return { provider: 'Federal Reserve', items: items.slice(0, 12), decisions }
      })
      return fromDisk(disk)
    },
  })

/* ---------- Marchés : VIX, dollar, pétrole ---------- */

async function yahooRows(symbol) {
  const chart = await yahoo.chartDaily(symbol, '2y', { curlFallback: true })
  const rows = chart.rows.map((r) => ({ d: r.d, v: r.c }))
  if (rows.length < 30) throw new Error(`yahoo ${symbol}: historique trop court`)
  return rows
}

export const rMacroVix = (ttlMs = HOUR) =>
  resolveData({
    key: 'macro:vix',
    ttlMs,
    seed: 'macro-vix',
    live: async () => {
      const disk = await diskBacked('vix', ttlMs, async () => {
        const start = isoDaysAgo(3 * 365)
        try {
          return { provider: 'Cboe · VIX close', rows: await cboe.vixHistory(start) }
        } catch (err) {
          try {
            return { provider: 'Cboe VIX via Yahoo', rows: await yahooRows('^VIX') }
          } catch {
            const fred = await fromFred({ vix: 'VIXCLS' }, start).catch(() => null)
            if (!fred) throw err
            return { provider: `${fred.via} · VIXCLS`, rows: fred.series.vix }
          }
        }
      })
      return fromDisk(disk)
    },
  })

export const rMacroDxy = (ttlMs = 30 * MIN) =>
  resolveData({
    key: 'macro:dxy',
    ttlMs,
    seed: 'macro-dxy',
    live: async () => {
      const disk = await diskBacked('dxy', ttlMs, async () => {
        try {
          return { provider: 'ICE DXY via Yahoo', kind: 'dxy', rows: await yahooRows('DX-Y.NYB') }
        } catch {
          // réplique : taux de référence BCE (publiés vers 16:00 CET) — cache disque 6 h
          const replica = await diskBacked('dxy-replica', 6 * HOUR, async () => ({
            rows: await ecbfx.dxyReplica(isoDaysAgo(3 * 365)),
          }))
          return {
            provider: 'DXY replica · ICE formula on ECB reference rates',
            kind: 'replica',
            rows: replica.value.rows,
          }
        }
      })
      return fromDisk(disk)
    },
  })

export const rMacroWti = (ttlMs = 30 * MIN) =>
  resolveData({
    key: 'macro:wti',
    ttlMs,
    seed: 'macro-wti',
    live: async () => {
      const disk = await diskBacked('wti', ttlMs, async () => {
        try {
          return { provider: 'NYMEX WTI front month via Yahoo', kind: 'futures', rows: await yahooRows('CL=F') }
        } catch (err) {
          try {
            // EIA : publication hebdomadaire, clé de démonstration → cache disque 6 h
            const spot = await diskBacked('wti-eia', 6 * HOUR, async () => ({ rows: await eia.wtiSpot(isoDaysAgo(3 * 365)) }))
            return { provider: 'EIA · WTI Cushing spot', kind: 'spot', rows: spot.value.rows }
          } catch {
            const fred = await fromFred({ wti: 'DCOILWTICO' }, isoDaysAgo(3 * 365)).catch(() => null)
            if (!fred) throw err
            return { provider: `${fred.via} · DCOILWTICO`, kind: 'spot', rows: fred.series.wti }
          }
        }
      })
      return fromDisk(disk)
    },
  })

/* ---------- Chiffres publiés (« actual ») : une famille par source officielle ----------
 * Chaque famille reçoit les événements publiés qui ont besoin d'elle et ne va chercher
 * que ce qui manque encore (historique conservé sur disque) : une fois le chiffre lu,
 * les passages suivants ne coûtent aucune requête. Pas de seed : sans donnée, pas d'actual.
 */

const KEEP = 16
const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)
const datesOf = (events, timeZone) => [...new Map(events.map((e) => [dayKey(e.ts, timeZone), e.ts])).entries()]

/** Échec réseau sans aucune donnée nouvelle : diskBacked resservira la dernière valeur (périmée). */
function settle(failure, gained) {
  if (failure && !gained) throw failure
}

/** Décisions de banque centrale datées (jour local de la banque), lues communiqué par communiqué. */
function decisionsFamily({ key, provider, timeZone, find }) {
  return (ttlMs, events) =>
    resolveData({
      key: `macro:${key}`,
      ttlMs,
      liveBudgetMs: 12_000,
      live: async () => {
        const disk = await diskBacked(key, ttlMs, async (prev) => {
          const decisions = [...(prev?.decisions ?? [])]
          let failure = null
          let gained = 0
          for (const [date, ts] of datesOf(events, timeZone)) {
            if (decisions.some((d) => d.date === date)) continue
            try {
              const found = await find(date, ts)
              if (found) {
                decisions.push(found)
                gained++
              }
            } catch (err) {
              failure = err
            }
          }
          settle(failure, gained)
          return { provider, decisions: decisions.sort(byDateDesc).slice(0, KEEP) }
        })
        return fromDisk(disk)
      },
    })
}

export const rMacroBoe = decisionsFamily({ key: 'boe', provider: 'Bank of England', timeZone: 'Europe/London', find: boe.decisionOn })
export const rMacroEcb = decisionsFamily({ key: 'ecb', provider: 'ECB', timeZone: 'Europe/Berlin', find: ecbpress.decisionOn })
export const rMacroBoj = decisionsFamily({ key: 'boj', provider: 'Bank of Japan', timeZone: 'Asia/Tokyo', find: boj.decisionOn })

/** Inscriptions hebdomadaires : communiqué DOL (PDF) du jour, repli FRED (ICSA). */
export const rMacroDol = (ttlMs, events) =>
  resolveData({
    key: 'macro:dol',
    ttlMs,
    liveBudgetMs: 15_000,
    live: async () => {
      const disk = await diskBacked('dol', ttlMs, async (prev) => {
        const releases = { ...(prev?.releases ?? {}) }
        let fred = prev?.fred ?? []
        const missing = () => datesOf(events, 'America/New_York').filter(([date]) => !releases[date])
        let failure = null
        let gained = 0
        if (missing().length) {
          try {
            const latest = await dol.latestClaimsRelease()
            if (!releases[latest.releaseDate]) gained++
            releases[latest.releaseDate] = { weekEnding: latest.weekEnding, initialClaims: latest.initialClaims, previousLevel: latest.previousLevel }
          } catch (err) {
            failure = err
          }
          if (missing().length) {
            try {
              const rows = (await fredSeries(['ICSA'], isoDaysAgo(120))).series.ICSA ?? []
              if (rows.length) {
                fred = rows.slice(-20)
                gained++
              }
            } catch (err) {
              failure ??= err
            }
          }
        }
        settle(failure, gained)
        const recent = Object.keys(releases).sort().slice(-KEEP)
        return { provider: 'US Department of Labor', releases: Object.fromEntries(recent.map((d) => [d, releases[d]])), fred }
      })
      return fromDisk(disk)
    },
  })

/** Ventes au détail US (Census, séries FRED RSAFS / RSFSXMV) : niveaux → variation mensuelle. */
export const rMacroRetail = (ttlMs, events) =>
  resolveData({
    key: 'macro:retail',
    ttlMs,
    liveBudgetMs: 12_000,
    live: async () => {
      const disk = await diskBacked('retail', ttlMs, async (prev) => {
        const have = prev?.series?.total ?? []
        if (prev && events.every((e) => have.some((r) => r.d === refMonthFor(e.ts)))) return prev
        const { series, via } = await fredSeries(['RSAFS', 'RSFSXMV'], isoDaysAgo(2 * 365))
        if (!series.RSAFS?.length) throw new Error('retail: série RSAFS vide')
        return { provider: `Census Bureau via ${via}`, series: { total: series.RSAFS, exAuto: series.RSFSXMV ?? [] } }
      })
      return fromDisk(disk)
    },
  })

/** Séries ONS : une série n'est relue que si elle date d'avant la publication attendue. */
export const rMacroOns = (ttlMs, events, seriesKeys) =>
  resolveData({
    key: 'macro:ons',
    ttlMs,
    liveBudgetMs: 12_000,
    live: async () => {
      const latest = datesOf(events, 'Europe/London').map(([date]) => date).sort().at(-1)
      const disk = await diskBacked('ons', ttlMs, async (prev) => {
        const series = { ...(prev?.series ?? {}) }
        let failure = null
        let gained = 0
        await Promise.all(
          [...seriesKeys].map(async (key) => {
            if (series[key]?.releaseDate >= latest) return
            try {
              series[key] = await ons.onsSeries(key)
              gained++
            } catch (err) {
              failure = err
            }
          }),
        )
        settle(failure, gained)
        return { provider: 'ONS', series }
      })
      return fromDisk(disk)
    },
  })

/** IPCH de la zone euro (Eurostat, premières publications). */
export const rMacroEurostat = (ttlMs, events) =>
  resolveData({
    key: 'macro:eurostat',
    ttlMs,
    liveBudgetMs: 12_000,
    live: async () => {
      const latest = datesOf(events, 'Europe/Brussels').map(([date]) => date).sort().at(-1)
      const disk = await diskBacked('eurostat', ttlMs, async (prev) => {
        if (prev && prev.updated >= latest) return prev
        return { provider: 'Eurostat', ...(await eurostat.hicpFirstReleases()) }
      })
      return fromDisk(disk)
    },
  })

/** PMI ISM (communiqués officiels via PR Newswire), historique des titres lus. */
export const rMacroIsm = (ttlMs, events) =>
  resolveData({
    key: 'macro:ism',
    ttlMs,
    liveBudgetMs: 12_000,
    live: async () => {
      const disk = await diskBacked('ism', ttlMs, async (prev) => {
        const items = prev?.items ?? []
        if (prev && events.every((e) => items.some((h) => h.date === nyDate(e.ts)))) return prev
        const fresh = await ism.ismHeadlines()
        const merged = [...fresh, ...items.filter((h) => !fresh.some((f) => f.date === h.date && f.sector === h.sector))]
        return { provider: 'ISM via PR Newswire', items: merged.sort(byDateDesc).slice(0, KEEP) }
      })
      return fromDisk(disk)
    },
  })

const surveyMonth = (ts) => `${nyDate(ts).slice(0, 7)}-01`

/** Michigan : lectures préliminaires et définitives, par mois. */
export const rMacroUmich = (ttlMs, events) =>
  resolveData({
    key: 'macro:umich',
    ttlMs,
    liveBudgetMs: 12_000,
    live: async () => {
      const disk = await diskBacked('umich', ttlMs, async (prev) => {
        const readings = prev?.readings ?? []
        const stageOf = (e) => (e.measures.some((m) => /^Prelim\b/i.test(m.name)) ? 'preliminary' : 'final')
        if (prev && events.every((e) => readings.some((r) => r.month === surveyMonth(e.ts) && r.stage === stageOf(e)))) return prev
        const latest = await surveys.michiganLatest()
        const rest = readings.filter((r) => !(r.month === latest.month && r.stage === latest.stage))
        return { provider: 'University of Michigan', readings: [latest, ...rest].slice(0, 8) }
      })
      return fromDisk(disk)
    },
  })

/** Conference Board : indice de confiance du mois. */
export const rMacroConfBoard = (ttlMs, events) =>
  resolveData({
    key: 'macro:confboard',
    ttlMs,
    liveBudgetMs: 12_000,
    live: async () => {
      const disk = await diskBacked('confboard', ttlMs, async (prev) => {
        const readings = prev?.readings ?? []
        if (prev && events.every((e) => readings.some((r) => r.month === surveyMonth(e.ts)))) return prev
        const year = Number(nyDate(Math.max(...events.map((e) => e.ts))).slice(0, 4))
        const latest = await surveys.conferenceBoardLatest(year)
        return { provider: 'The Conference Board', readings: [latest, ...readings.filter((r) => r.month !== latest.month)].slice(0, 8) }
      })
      return fromDisk(disk)
    },
  })

/** Source « fraîcheur » d'une famille : les données disque périmées comptent comme cache. */
export function familySource(env) {
  if (!env) return null
  if (env.source === 'seed') return 'seed'
  if (env.source === 'cache' || env.data?.stale) return 'cache'
  return 'live'
}

/** Résumé par famille pour l'interface (source, fournisseur, heure de récupération). */
export function familyMeta(env) {
  if (!env) return null
  return {
    source: familySource(env),
    // un seed garde le nom du fournisseur d'origine de la capture
    provider: env.source === 'seed' ? (env.data?.provider ?? null) : (env.provider ?? null),
    fetchedAt: env.data?.fetchedAt ?? env.asOf ?? null,
    note: env.note ?? null,
  }
}
