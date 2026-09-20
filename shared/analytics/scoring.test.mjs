import { describe, it, expect } from 'vitest'
import { scoreAsset, ratingFromScore } from './scoring.mjs'

const up = Array.from({ length: 260 }, (_, i) => 100 * Math.pow(1.004, i))
const down = Array.from({ length: 260 }, (_, i) => 250 * Math.pow(0.996, i))

describe('seuils de notation', () => {
  it('Buy ≥ 65, Sell < 35, Hold entre les deux, NA sans score', () => {
    expect(ratingFromScore(65)).toBe('BUY')
    expect(ratingFromScore(64.4)).toBe('HOLD')
    expect(ratingFromScore(35)).toBe('HOLD')
    expect(ratingFromScore(34.9)).toBe('SELL')
    expect(ratingFromScore(null)).toBe('NA')
  })
})

describe('scoreAsset', () => {
  it('tendance haussière score nettement au-dessus de la baissière', () => {
    const scoreUp = scoreAsset({ closes: up })
    const scoreDown = scoreAsset({ closes: down })
    expect(scoreUp.score).toBeGreaterThan(scoreDown.score + 20)
    expect(scoreUp.rating === 'BUY' || scoreUp.rating === 'HOLD').toBe(true)
    expect(scoreDown.rating === 'SELL' || scoreDown.rating === 'HOLD').toBe(true)
  })
  it('décomposition complète en 4 familles pondérées', () => {
    const r = scoreAsset({ closes: up, fundingAnnualizedPct: 8, fngValue: 50, universeMedianVolPct: 60 })
    expect(r.families.trend.weight).toBeCloseTo(0.35, 10)
    expect(r.families.momentum.weight).toBeCloseTo(0.3, 10)
    expect(r.families.context.weight).toBeCloseTo(0.2, 10)
    expect(r.families.risk.weight).toBeCloseTo(0.15, 10)
    for (const family of Object.values(r.families)) {
      expect(family.score).not.toBeNull()
      expect(family.components.length).toBeGreaterThan(0)
    }
    expect(r.metrics.rsi14).not.toBeNull()
    expect(r.partial).toBe(false)
  })
  it('historique < 60 j → NA ; 60–219 j → partiel', () => {
    expect(scoreAsset({ closes: up.slice(0, 50) }).rating).toBe('NA')
    const partial = scoreAsset({ closes: up.slice(0, 120) })
    expect(partial.partial).toBe(true)
    expect(partial.score).not.toBeNull()
  })
  it('funding très positif pénalise le contexte', () => {
    const calm = scoreAsset({ closes: up, fundingAnnualizedPct: 2, fngValue: 50 })
    const hot = scoreAsset({ closes: up, fundingAnnualizedPct: 45, fngValue: 50 })
    expect(hot.families.context.score).toBeLessThan(calm.families.context.score)
  })
})
