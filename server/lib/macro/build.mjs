/*
 * Assemblage pur des séries AirMacro : tuiles, graphiques, coin « politique monétaire ».
 * Chaque famille peut manquer : les tuiles/graphiques correspondants sont alors absents.
 */
import {
  changePoints,
  decimate,
  lastWithDelta,
  momDiff,
  since,
  spread,
  valueAsOf,
  yoy,
} from '../../../shared/analytics/macroseries.mjs'

const DAY = 86_400_000
const round = (v, digits) => (Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : null)
const isoDaysBefore = (now, days) => new Date(now - days * DAY).toISOString().slice(0, 10)

function tile({ key, label, rows, unit, period, family, provider, spark = 24, deltaScale = 1, deltaUnit, digits = 2, extra }) {
  const last = lastWithDelta(rows ?? [], 6)
  if (!last) return null
  const sparkRows = period === 'daily' ? decimate((rows ?? []).slice(-130), 60) : (rows ?? []).slice(-spark)
  return {
    key,
    label,
    unit,
    period,
    value: round(last.v, digits),
    date: last.d,
    delta: last.delta != null ? round(last.delta * deltaScale, digits) : null,
    deltaUnit,
    deltaBase: last.prevD,
    spark: sparkRows.map((r) => r.v),
    family,
    provider,
    ...extra,
  }
}

/** Variation en % entre les deux derniers points (séries de prix). */
function lastPctTile(args) {
  const rows = args.rows ?? []
  const base = tile({ ...args, deltaUnit: '%' })
  if (!base || rows.length < 2) return base
  const prev = rows[rows.length - 2].v
  return { ...base, delta: prev ? round((rows[rows.length - 1].v / prev - 1) * 100, 2) : null }
}

/**
 * Cible Fed effective : NY Fed (J+1) complétée par une décision lue dans le
 * communiqué du jour quand elle est plus récente.
 */
export function effectiveTarget(nyfedRows, decisions) {
  const last = nyfedRows?.length ? nyfedRows[nyfedRows.length - 1] : null
  const latestDecision = (decisions ?? [])
    .filter((d) => d.decision && d.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0]
  // La ligne NY Fed du jour de la décision porte encore l'ancienne fourchette (la
  // nouvelle s'applique le lendemain) : le communiqué prime tant que NY Fed n'a pas
  // publié de ligne postérieure à la décision.
  if (latestDecision && (!last || latestDecision.date >= last.d)) {
    return {
      lower: latestDecision.decision.lower,
      upper: latestDecision.decision.upper,
      asOf: latestDecision.date,
      source: 'Fed statement',
    }
  }
  if (last && Number.isFinite(last.upper)) {
    return { lower: last.lower, upper: last.upper, asOf: last.d, source: 'NY Fed' }
  }
  return null
}

/**
 * @param {{ bls?: any, bea?: any, treasury?: any, nyfed?: any, fed?: any, vix?: any, dxy?: any, wti?: any }} f
 * @param {number} now
 */
export function buildSeries(f, now) {
  const tiles = {}
  const add = (t) => {
    if (t) tiles[t.key] = t
  }

  /* ---------- Inflation & emploi ---------- */
  const s = f.bls?.series ?? {}
  const cpiYoY = yoy(s.cpiNsa ?? [])
  const coreCpiYoY = yoy(s.coreCpiNsa ?? [])
  const corePceYoY = yoy(f.bea?.monthly?.corePce ?? [])
  const nfpMoM = momDiff(s.payems ?? [])
  const unrate = s.unrate ?? []
  const blsProvider = f.bls?.provider ?? null

  add(tile({ key: 'cpiYoY', label: 'CPI YoY', rows: cpiYoY, unit: '%', period: 'monthly', family: 'bls', provider: blsProvider, deltaUnit: 'pp', digits: 1 }))
  add(tile({ key: 'coreCpiYoY', label: 'Core CPI YoY', rows: coreCpiYoY, unit: '%', period: 'monthly', family: 'bls', provider: blsProvider, deltaUnit: 'pp', digits: 1 }))
  add(tile({ key: 'corePceYoY', label: 'Core PCE YoY', rows: corePceYoY, unit: '%', period: 'monthly', family: 'bea', provider: f.bea?.provider ?? null, deltaUnit: 'pp', digits: 1 }))
  add(tile({ key: 'unrate', label: 'Unemployment', rows: unrate, unit: '%', period: 'monthly', family: 'bls', provider: blsProvider, deltaUnit: 'pp', digits: 1 }))
  if (nfpMoM.length) {
    const last3 = nfpMoM.slice(-3).map((r) => r.v)
    add(
      tile({
        key: 'nfp',
        label: 'Payrolls (NFP)',
        rows: nfpMoM,
        unit: 'k',
        period: 'monthly',
        family: 'bls',
        provider: blsProvider,
        deltaUnit: 'k',
        digits: 0,
        extra: {
          avg3: round(last3.reduce((a, b) => a + b, 0) / last3.length, 0),
          preliminary: Boolean(f.bls?.preliminary?.payems),
        },
      }),
    )
  }

  /* ---------- Taux & politique monétaire ---------- */
  const y10 = f.treasury?.y10 ?? []
  const m3 = f.treasury?.m3 ?? []
  const spread10y3m = spread(y10, m3, 2)
  const treasuryProvider = f.treasury?.provider ?? null
  add(tile({ key: 'y10', label: 'US 10Y yield', rows: y10, unit: '%', period: 'daily', family: 'treasury', provider: treasuryProvider, deltaScale: 100, deltaUnit: 'bp', digits: 2 }))
  // tuile en points de base (le graphique reste en %)
  const spreadBp = spread10y3m.map((r) => ({ d: r.d, v: Math.round(r.v * 100) }))
  add(
    tile({
      key: 'spread10y3m',
      label: '10Y–3M spread',
      rows: spreadBp,
      unit: 'bp',
      period: 'daily',
      family: 'treasury',
      provider: treasuryProvider,
      deltaUnit: 'bp',
      digits: 0,
      extra: { inverted: spreadBp.length ? spreadBp[spreadBp.length - 1].v < 0 : null },
    }),
  )

  const nyRows = f.nyfed?.rows ?? []
  const target = effectiveTarget(nyRows, f.fed?.decisions)
  const lastEffr = nyRows.length ? nyRows[nyRows.length - 1] : null
  const fromStatement = target?.source === 'Fed statement'
  // points NY Fed à partir de la date du communiqué remplacés par la décision (dates uniques et croissantes)
  const nyBefore = fromStatement ? nyRows.filter((r) => r.d < target.asOf) : nyRows
  if (target) {
    const upperRows = nyBefore.filter((r) => Number.isFinite(r.upper)).map((r) => ({ d: r.d, v: r.upper }))
    if (fromStatement) upperRows.push({ d: target.asOf, v: target.upper })
    const yearAgo = valueAsOf(upperRows, isoDaysBefore(Date.parse(`${target.asOf}T12:00:00Z`), 365))
    tiles.fedTarget = {
      key: 'fedTarget',
      label: 'Fed funds target',
      unit: '%',
      period: 'daily',
      value: target.upper,
      lower: target.lower,
      upper: target.upper,
      date: target.asOf,
      delta: yearAgo ? round(target.upper - yearAgo.v, 2) : null,
      deltaUnit: 'pp',
      deltaBase: yearAgo?.d ?? null,
      spark: decimate(upperRows.slice(-520), 60).map((r) => r.v),
      effr: lastEffr ? { value: lastEffr.effr, date: lastEffr.d } : null,
      targetSource: target.source,
      family: fromStatement ? 'fed' : 'nyfed',
      provider: fromStatement ? 'Federal Reserve' : (f.nyfed?.provider ?? null),
    }
  }

  /* ---------- Croissance & risque ---------- */
  const gdp = f.bea?.quarterly?.gdpQoQ ?? []
  add(tile({ key: 'gdp', label: 'GDP QoQ (SAAR)', rows: gdp, unit: '%', period: 'quarterly', family: 'bea', provider: f.bea?.provider ?? null, spark: 12, deltaUnit: 'pp', digits: 1 }))
  const vix = f.vix?.rows ?? []
  add(tile({ key: 'vix', label: 'VIX', rows: vix, unit: 'pts', period: 'daily', family: 'vix', provider: f.vix?.provider ?? null, deltaUnit: 'pts', digits: 2 }))
  const dxy = f.dxy?.rows ?? []
  add(
    lastPctTile({
      key: 'dxy',
      label: f.dxy?.kind === 'replica' ? 'Dollar index (replica)' : 'Dollar index (DXY)',
      rows: dxy,
      unit: 'index',
      period: 'daily',
      family: 'dxy',
      provider: f.dxy?.provider ?? null,
      digits: 2,
      extra: { variant: f.dxy?.kind ?? null },
    }),
  )
  const wti = f.wti?.rows ?? []
  add(
    lastPctTile({
      key: 'wti',
      label: f.wti?.kind === 'spot' ? 'WTI crude (spot)' : 'WTI crude',
      rows: wti,
      unit: '$/bbl',
      period: 'daily',
      family: 'wti',
      provider: f.wti?.provider ?? null,
      digits: 2,
      extra: { variant: f.wti?.kind ?? null },
    }),
  )

  /* ---------- Graphiques ---------- */
  const threeYears = isoDaysBefore(now, 3 * 365)
  const twoYears = isoDaysBefore(now, 2 * 365)
  const upperDaily = nyBefore.filter((r) => Number.isFinite(r.upper)).map((r) => ({ d: r.d, v: r.upper }))
  const lowerDaily = nyBefore.filter((r) => Number.isFinite(r.lower)).map((r) => ({ d: r.d, v: r.lower }))
  if (fromStatement) {
    upperDaily.push({ d: target.asOf, v: target.upper })
    lowerDaily.push({ d: target.asOf, v: target.lower })
  }

  const charts = {
    inflation: {
      cpiYoY: since(cpiYoY, '2022-01-01'),
      coreCpiYoY: since(coreCpiYoY, '2022-01-01'),
      corePceYoY: since(corePceYoY, '2022-01-01'),
      target: 2,
    },
    labor: {
      nfpMoM: nfpMoM.slice(-36),
      unrate: unrate.slice(-36),
    },
    rates: {
      y10: since(y10, threeYears),
      m3: since(m3, threeYears),
      spread10y3m: since(spread10y3m, threeYears),
      fedTargetUpper: changePoints(since(upperDaily, threeYears)),
      fedTargetLower: changePoints(since(lowerDaily, threeYears)),
      effr: lastEffr ? { d: lastEffr.d, v: lastEffr.effr } : null,
    },
    growthRisk: {
      gdpQoQ: gdp.slice(-20),
      vix: since(vix, twoYears),
      dxy: since(dxy, twoYears),
      wti: since(wti, twoYears),
    },
  }

  /* ---------- Politique monétaire ---------- */
  const decisions = (f.fed?.decisions ?? []).filter((d) => d.date).sort((a, b) => (a.date < b.date ? 1 : -1))
  const items = f.fed?.items ?? []
  const latestOf = (type) => items.filter((i) => i.type === type).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0] ?? null
  const policy = {
    target,
    effr: lastEffr ? { value: lastEffr.effr, date: lastEffr.d } : null,
    lastDecision: decisions[0]?.decision ? { date: decisions[0].date, url: decisions[0].url, ...decisions[0].decision } : null,
    links: {
      statement: latestOf('statement')?.url ?? null,
      statementDate: latestOf('statement')?.date ?? null,
      minutes: latestOf('minutes')?.url ?? null,
      minutesTitle: latestOf('minutes')?.title ?? null,
    },
  }

  const sourcesBySerie = {
    cpiYoY: blsProvider === 'BLS' ? 'BLS · CPI-U, NSA (CUUR0000SA0)' : blsProvider,
    coreCpiYoY: blsProvider === 'BLS' ? 'BLS · CPI-U less food & energy, NSA (CUUR0000SA0L1E)' : blsProvider,
    corePceYoY: f.bea?.provider === 'BEA' ? 'BEA · PCE price index ex food & energy (DPCCRG)' : (f.bea?.provider ?? null),
    unrate: blsProvider === 'BLS' ? 'BLS · unemployment rate, SA (LNS14000000)' : blsProvider,
    nfp: blsProvider === 'BLS' ? 'BLS · total nonfarm payrolls, SA (CES0000000001)' : blsProvider,
    fedTarget: target?.source === 'Fed statement' ? 'Federal Reserve · FOMC statement' : (f.nyfed?.provider === 'NY Fed' ? 'NY Fed · EFFR & target range' : (f.nyfed?.provider ?? null)),
    y10: treasuryProvider === 'US Treasury' ? 'US Treasury · 10-year CMT yield' : treasuryProvider,
    spread10y3m: treasuryProvider === 'US Treasury' ? 'US Treasury · 10-year minus 3-month CMT' : treasuryProvider,
    gdp: f.bea?.provider === 'BEA' ? 'BEA · real GDP, % change SAAR (A191RL)' : (f.bea?.provider ?? null),
    vix: f.vix?.provider ?? null,
    dxy: f.dxy?.provider ?? null,
    wti: f.wti?.provider ?? null,
  }

  return { tiles, charts, policy, meta: { sourcesBySerie } }
}
