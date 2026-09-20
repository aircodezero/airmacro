import { describe, it, expect } from 'vitest'
import {
  mayerMultiple,
  piCycle,
  powerLawFit,
  halvingOverlay,
  cyclePhase,
  monthlySeasonality,
  cycleGauge,
  GENESIS_DATE,
} from './cycles.mjs'

const DAY = 86_400_000

function makeRows(startDate, count, priceFn) {
  const start = Date.parse(`${startDate}T00:00:00Z`)
  return Array.from({ length: count }, (_, i) => ({
    d: new Date(start + i * DAY).toISOString().slice(0, 10),
    c: priceFn(i),
  }))
}

describe('Mayer Multiple', () => {
  it('série constante → multiple 1, percentile 100', () => {
    const rows = makeRows('2020-01-01', 300, () => 100)
    const m = mayerMultiple(rows)
    expect(m.current).toBeCloseTo(1, 10)
    expect(m.percentile).toBeCloseTo(100, 6)
    expect(m.bands).toEqual({ low: 0.8, high: 2.4 })
  })
})

describe('Pi Cycle', () => {
  it('série constante → SMA111 = 100, 2×SMA350 = 200, écart −50 %, non déclenché', () => {
    const rows = makeRows('2020-01-01', 400, () => 100)
    const p = piCycle(rows)
    expect(p.gapPct).toBeCloseTo(-50, 6)
    expect(p.triggered).toBe(false)
    expect(p.crossings).toEqual([])
  })
})

describe('Power law', () => {
  it('loi de puissance exacte récupérée : pente 1.2, R² 1', () => {
    const genesis = Date.parse(`${GENESIS_DATE}T00:00:00Z`)
    const rows = Array.from({ length: 601 }, (_, i) => {
      const days = 100 + i
      return {
        d: new Date(genesis + days * DAY).toISOString().slice(0, 10),
        c: 10 ** (0.5 + 1.2 * Math.log10(days)),
      }
    })
    const fit = powerLawFit(rows)
    expect(fit.slope).toBeCloseTo(1.2, 6)
    expect(fit.intercept).toBeCloseTo(0.5, 6)
    expect(fit.r2).toBeCloseTo(1, 8)
    const last = fit.series[fit.series.length - 1]
    expect(last.lower).toBeLessThanOrEqual(last.fit + 1e-9)
    expect(last.upper).toBeGreaterThanOrEqual(last.fit - 1e-9)
  })
})

describe('Superposition des halvings', () => {
  it('base 100 au halving 2020, série qui double', () => {
    const rows = makeRows('2020-05-11', 100, (i) => 100 * (1 + i / 99))
    const { overlays, currentHalving } = halvingOverlay(rows)
    expect(overlays.length).toBe(1)
    expect(currentHalving).toBe('2020-05-11')
    const points = overlays[0].points
    expect(points[0].y).toBeCloseTo(100, 10)
    expect(points[points.length - 1].y).toBeCloseTo(200, 6)
  })
  it("n'aligne pas un halving hors de la couverture de la série", () => {
    const rows = makeRows('2024-06-01', 200, () => 100)
    const { overlays } = halvingOverlay(rows)
    expect(overlays.length).toBe(0) // 2024-04-20 est à plus de 30 j du début
  })
})

describe('Phase de cycle', () => {
  it('878 jours après le halving 2024 au 2026-09-15', () => {
    const phase = cyclePhase('2026-09-15')
    expect(phase.halving).toBe('2024-04-20')
    expect(phase.daysSince).toBe(878)
    expect(phase.pctOfTypicalCycle).toBeCloseTo((878 / 1460) * 100, 4)
  })
})

describe('Saisonnalité', () => {
  it('rendements mensuels à la main', () => {
    const rows = [
      { d: '2024-01-31', c: 100 },
      { d: '2024-02-29', c: 110 },
      { d: '2024-03-31', c: 99 },
      { d: '2024-04-30', c: 108.9 },
    ]
    const { matrix, monthlyMeans } = monthlySeasonality(rows, 2013)
    expect(matrix[2024][1]).toBeCloseTo(10, 6) // février +10 %
    expect(matrix[2024][2]).toBeCloseTo(-10, 6) // mars −10 %
    expect(matrix[2024][3]).toBeCloseTo(10, 6) // avril +10 %
    expect(monthlyMeans[1]).toBeCloseTo(10, 6)
  })
})

describe('Jauge de cycle', () => {
  it('pondération à la main : Mayer p50, MVRV 2, Pi −30 %, phase 50 % → 49', () => {
    const gauge = cycleGauge({ mayerPercentile: 50, mvrv: 2, piGapPct: -30, phasePct: 50 })
    // 0.5·0.3 + 0.55·0.3 + 0.35·0.2 + 0.5·0.2 = 0.485 → 49
    expect(gauge.score).toBe(49)
    expect(gauge.components.length).toBe(4)
  })
  it('zone extrême haute', () => {
    const gauge = cycleGauge({ mayerPercentile: 99, mvrv: 4, piGapPct: 1, phasePct: 90 })
    expect(gauge.score).toBeGreaterThan(85)
  })
})
