/*
 * Calcul des indicateurs de cyclicité BTC à partir de l'historique long
 * (Coin Metrics : PriceUSD + MVRV depuis 2010). Séries décimées pour le
 * transport ; les calculs se font sur la série complète.
 */
import { resolveData } from '../cache.mjs'
import { rBtcLong } from '../sources.mjs'
import {
  mayerMultiple,
  piCycle,
  wma200,
  powerLawFit,
  halvingOverlay,
  cyclePhase,
  monthlySeasonality,
  cycleGauge,
  cycleSummaryText,
  HALVINGS,
  NEXT_HALVING_ESTIMATE,
} from '../../../shared/analytics/cycles.mjs'
import { decimate } from '../../../shared/analytics/series.mjs'

async function cyclesComputeLive() {
  const env = await rBtcLong()
  if (env.source === 'seed') {
    // l'historique long lui-même est en mode exemple → laisser /api/cycles
    // retomber sur son propre seed complet
    throw new Error('historique long indisponible en direct')
  }
  return computeCyclesData(env.data.rows, env.provider)
}

/** Calcul pur (utilisé aussi par le générateur de seeds). */
export function computeCyclesData(rows, providerLabel) {
  const lastRow = rows[rows.length - 1]

  const mayer = mayerMultiple(rows)
  const pi = piCycle(rows)
  const wma = wma200(rows)
  const power = powerLawFit(rows)
  const overlay = halvingOverlay(rows)
  const phase = cyclePhase(lastRow.d)
  const seasonality = monthlySeasonality(rows, 2013)

  const mvrvRows = rows.filter((r) => r.mvrv != null).map((r) => ({ d: r.d, v: r.mvrv }))
  const lastMvrv = mvrvRows.length ? mvrvRows[mvrvRows.length - 1].v : null

  const gauge = cycleGauge({
    mayerPercentile: mayer?.percentile ?? null,
    mvrv: lastMvrv,
    piGapPct: pi?.gapPct ?? null,
    phasePct: phase?.pctOfTypicalCycle ?? null,
  })

  const summary = cycleSummaryText({
    phase,
    mayer,
    mvrv: lastMvrv,
    pi,
    wma,
    gauge,
  })

  const recent = (series, keep) => decimate(series.slice(-keep), 700)

  return {
    provider: `${providerLabel} + AirCrypto engine`,
    data: {
      meta: { lastDate: lastRow.d, lastPrice: lastRow.c, points: rows.length },
      phase,
      halvings: HALVINGS,
      nextHalvingEstimate: NEXT_HALVING_ESTIMATE,
      overlay: overlay.overlays.map((o) => ({
        halving: o.halving,
        current: o.halving === overlay.currentHalving,
        points: decimate(o.points, 400),
      })),
      piCycle: pi
        ? {
            gapPct: pi.gapPct,
            triggered: pi.triggered,
            crossings: pi.crossings,
            series: recent(pi.series, 1500),
          }
        : null,
      mayer: mayer
        ? {
            current: mayer.current,
            percentile: mayer.percentile,
            bands: mayer.bands,
            series: decimate(mayer.series, 700),
          }
        : null,
      wma200: wma
        ? {
            current: wma.current,
            distancePct: wma.distancePct,
            series: decimate(wma.series, 600),
          }
        : null,
      mvrv: mvrvRows.length > 100
        ? {
            current: lastMvrv,
            zones: { low: 1, high: 3.5 },
            series: decimate(mvrvRows, 700),
          }
        : null,
      powerLaw: power
        ? {
            slope: power.slope,
            r2: power.r2,
            positionPercentile: power.positionPercentile,
            series: decimate(power.series, 400),
          }
        : null,
      seasonality,
      gauge,
      summary,
    },
  }
}

export const rCycles = () =>
  resolveData({ key: 'cycles', ttlMs: 6 * 3_600_000, live: cyclesComputeLive, seed: 'cycles' })
