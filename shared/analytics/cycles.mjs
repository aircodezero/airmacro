/*
 * Indicateurs de cyclicité Bitcoin : Mayer Multiple, Pi Cycle Top, 200WMA,
 * régression power-law log-log, alignement sur les halvings, saisonnalité,
 * jauge composite de position dans le cycle.
 * Entrée standard : rows = [{ d: 'YYYY-MM-DD', c: number }] chronologique.
 */
import { sma, quantile, percentileRank, clamp, olsRegression } from './series.mjs'

export const HALVINGS = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20']
export const NEXT_HALVING_ESTIMATE = '2028-04'
export const GENESIS_DATE = '2009-01-03'
export const TYPICAL_CYCLE_DAYS = 1460

const DAY_MS = 86_400_000
const dateMs = (d) => Date.parse(`${d}T00:00:00Z`)

/** Mayer Multiple : prix / SMA200, avec percentile historique du niveau courant. */
export function mayerMultiple(rows) {
  const closes = rows.map((r) => r.c)
  const sma200 = sma(closes, 200)
  const series = []
  for (let i = 0; i < rows.length; i++) {
    if (sma200[i] != null) series.push({ d: rows[i].d, m: closes[i] / sma200[i] })
  }
  if (!series.length) return null
  const values = series.map((p) => p.m)
  const current = values[values.length - 1]
  return {
    series,
    current,
    percentile: percentileRank(values, current),
    bands: { low: 0.8, high: 2.4 },
  }
}

/** Pi Cycle Top : SMA111 vs 2×SMA350 — croisement à la hausse = signal de sommet historique. */
export function piCycle(rows) {
  const closes = rows.map((r) => r.c)
  const sma111 = sma(closes, 111)
  const sma350 = sma(closes, 350)
  const series = []
  const crossings = []
  let prevDiff = null
  for (let i = 0; i < rows.length; i++) {
    if (sma111[i] == null || sma350[i] == null) continue
    const upper = sma350[i] * 2
    const diff = sma111[i] - upper
    series.push({ d: rows[i].d, price: closes[i], sma111: sma111[i], sma350x2: upper })
    if (prevDiff != null && prevDiff < 0 && diff >= 0) crossings.push(rows[i].d)
    prevDiff = diff
  }
  if (!series.length) return null
  const last = series[series.length - 1]
  const gapPct = (last.sma111 / last.sma350x2 - 1) * 100
  return { series, gapPct, triggered: gapPct >= 0, crossings }
}

/** 200WMA approximée par SMA 1400 jours. */
export function wma200(rows) {
  const closes = rows.map((r) => r.c)
  const w = sma(closes, 1400)
  const series = []
  for (let i = 0; i < rows.length; i++) {
    if (w[i] != null) series.push({ d: rows[i].d, price: closes[i], wma: w[i] })
  }
  if (!series.length) return null
  const last = series[series.length - 1]
  return { series, current: last.wma, distancePct: (last.price / last.wma - 1) * 100 }
}

/**
 * Régression power-law : log10(prix) ~ log10(jours depuis la genèse).
 * Bandes = fit décalé par les quantiles 5 % / 95 % des résidus.
 */
export function powerLawFit(rows) {
  const genesis = dateMs(GENESIS_DATE)
  const points = rows
    .map((r) => ({ d: r.d, days: (dateMs(r.d) - genesis) / DAY_MS, c: r.c }))
    .filter((p) => p.days > 30 && p.c > 0)
  if (points.length < 500) return null
  const x = points.map((p) => Math.log10(p.days))
  const y = points.map((p) => Math.log10(p.c))
  const fit = olsRegression(x, y)
  if (!fit) return null
  const residuals = points.map((p, i) => y[i] - (fit.alpha + fit.beta * x[i]))
  const q05 = quantile(residuals, 0.05)
  const q95 = quantile(residuals, 0.95)
  const series = points.map((p, i) => {
    const logFit = fit.alpha + fit.beta * x[i]
    return {
      d: p.d,
      price: p.c,
      fit: 10 ** logFit,
      lower: 10 ** (logFit + q05),
      upper: 10 ** (logFit + q95),
    }
  })
  const lastResidual = residuals[residuals.length - 1]
  return {
    slope: fit.beta,
    intercept: fit.alpha,
    r2: fit.r2,
    series,
    positionPercentile: percentileRank(residuals, lastResidual),
  }
}

/** Performance base 100 depuis chaque halving, axée « jours depuis halving ». */
export function halvingOverlay(rows, maxDays = TYPICAL_CYCLE_DAYS) {
  const byDate = new Map(rows.map((r) => [r.d, r.c]))
  const sortedDates = rows.map((r) => r.d)
  const overlays = []
  for (const halving of HALVINGS) {
    const start = dateMs(halving)
    const startIdx = sortedDates.findIndex((d) => dateMs(d) >= start)
    if (startIdx < 0) continue
    // la série doit réellement couvrir ce halving (à 30 j près)
    if (dateMs(rows[startIdx].d) - start > 30 * DAY_MS) continue
    const base = rows[startIdx].c
    if (!(base > 0)) continue
    const points = []
    for (let i = startIdx; i < rows.length; i++) {
      const days = Math.round((dateMs(rows[i].d) - start) / DAY_MS)
      if (days > maxDays) break
      points.push({ x: days, y: (rows[i].c / base) * 100 })
    }
    if (points.length > 30) overlays.push({ halving, points })
  }
  const current = overlays.length ? overlays[overlays.length - 1] : null
  return { overlays, currentHalving: current?.halving ?? null }
}

/** Position dans le cycle courant (jours depuis halving, % du cycle type). */
export function cyclePhase(lastDate) {
  const last = dateMs(lastDate)
  let activeHalving = HALVINGS[0]
  for (const h of HALVINGS) {
    if (dateMs(h) <= last) activeHalving = h
  }
  const daysSince = Math.round((last - dateMs(activeHalving)) / DAY_MS)
  return {
    halving: activeHalving,
    daysSince,
    pctOfTypicalCycle: clamp((daysSince / TYPICAL_CYCLE_DAYS) * 100, 0, 150),
    nextEstimate: NEXT_HALVING_ESTIMATE,
  }
}

/** Rendements mensuels (matrice année × mois) + moyennes par mois. */
export function monthlySeasonality(rows, sinceYear = 2013) {
  const monthEnd = new Map()
  for (const r of rows) {
    monthEnd.set(r.d.slice(0, 7), r.c) // dernier point du mois (rows chronologique)
  }
  const months = [...monthEnd.keys()].sort()
  const matrix = {}
  const byMonth = Array.from({ length: 12 }, () => [])
  for (let i = 1; i < months.length; i++) {
    const [year, month] = months[i].split('-').map(Number)
    if (year < sinceYear) continue
    const ret = (monthEnd.get(months[i]) / monthEnd.get(months[i - 1]) - 1) * 100
    if (!matrix[year]) matrix[year] = new Array(12).fill(null)
    matrix[year][month - 1] = ret
    byMonth[month - 1].push(ret)
  }
  return {
    matrix,
    monthlyMeans: byMonth.map((arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)),
  }
}

/** Zone MVRV → intensité 0–1 (proxy de position dans le cycle). */
export function mvrvIntensity(mvrv) {
  if (mvrv == null) return null
  if (mvrv < 1) return 0.08
  if (mvrv < 1.5) return 0.3
  if (mvrv < 2.5) return 0.55
  if (mvrv < 3.5) return 0.8
  return 0.95
}

/** Écart Pi Cycle → intensité 0–1. */
export function piGapIntensity(gapPct) {
  if (gapPct == null) return null
  if (gapPct >= 0) return 0.97
  if (gapPct >= -5) return 0.85
  if (gapPct >= -20) return 0.6
  if (gapPct >= -50) return 0.35
  return 0.12
}

/**
 * Jauge composite « position dans le cycle » 0–100.
 * 0 = plancher/accumulation, 100 = zone de sommet historique.
 */
export function cycleGauge({ mayerPercentile, mvrv, piGapPct, phasePct }) {
  const components = []
  if (mayerPercentile != null) {
    components.push({ key: 'mayer', label: 'Mayer percentile', weight: 0.3, value: mayerPercentile / 100 })
  }
  const mvrvI = mvrvIntensity(mvrv)
  if (mvrvI != null) {
    components.push({ key: 'mvrv', label: 'MVRV zone', weight: 0.3, value: mvrvI })
  }
  const piI = piGapIntensity(piGapPct)
  if (piI != null) {
    components.push({ key: 'pi', label: 'Pi Cycle gap', weight: 0.2, value: piI })
  }
  if (phasePct != null) {
    components.push({ key: 'phase', label: 'Halving phase', weight: 0.2, value: clamp(phasePct / 100, 0, 1) })
  }
  if (!components.length) return null
  const totalWeight = components.reduce((a, c) => a + c.weight, 0)
  const score = Math.round((components.reduce((a, c) => a + c.value * c.weight, 0) / totalWeight) * 100)
  return {
    score,
    label: gaugeLabel(score),
    components: components.map((c) => ({ ...c, value: Math.round(c.value * 100) })),
  }
}

function gaugeLabel(score) {
  if (score < 25) return 'Historical low / accumulation zone'
  if (score < 45) return 'Early-to-mid cycle'
  if (score < 65) return 'Mid cycle'
  if (score < 82) return 'Late cycle'
  return 'Historical top zone'
}

/** Synthèse texte (FR) générée par règles — badge « automatique » côté UI. */
export function cycleSummaryText({ phase, mayer, mvrv, pi, wma, gauge }) {
  const parts = []
  if (phase) {
    parts.push(
      `We are ${phase.daysSince} days past the ${phase.halving} halving (~${Math.round(phase.pctOfTypicalCycle)}% of a typical 4-year cycle; next halving estimated ${phase.nextEstimate}).`,
    )
  }
  if (mayer) {
    parts.push(
      `Mayer Multiple at ${mayer.current.toFixed(2)} (historical percentile ${Math.round(mayer.percentile)}%) — ${mayer.current > 2.4 ? 'historically overheated zone' : mayer.current < 0.8 ? 'historical accumulation zone' : 'intermediate zone'}.`,
    )
  }
  if (mvrv != null) {
    parts.push(
      `MVRV at ${mvrv.toFixed(2)} — ${mvrv > 3.5 ? 'historical top zone' : mvrv < 1 ? 'historical capitulation zone' : 'neither extreme high nor extreme low'}.`,
    )
  }
  if (pi) {
    parts.push(
      pi.triggered
        ? 'Pi Cycle Top triggered (SMA111 ≥ 2×SMA350), a configuration historically close to tops.'
        : `Pi Cycle not triggered (${pi.gapPct.toFixed(1)}% below the threshold).`,
    )
  }
  if (wma) {
    parts.push(`Price is ${wma.distancePct >= 0 ? '+' : ''}${wma.distancePct.toFixed(0)}% from the 200WMA, the historical cycle floor.`)
  }
  if (gauge) {
    parts.push(`Composite gauge: ${gauge.score}/100 — ${gauge.label.toLowerCase()}.`)
  }
  return parts.join(' ')
}
