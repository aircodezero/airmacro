import { describe, it, expect } from 'vitest'
import { compositeSentiment, sentimentLabel } from './sentiment.mjs'

describe('jauge composite de sentiment', () => {
  it('tout neutre → ~50, libellé Neutre', () => {
    const g = compositeSentiment({
      fngValue: 50,
      fundingAnnualizedPct: 0,
      breadthAboveSma50Pct: 50,
      stablecoinDominancePct: 8,
    })
    expect(g.score).toBeGreaterThanOrEqual(45)
    expect(g.score).toBeLessThanOrEqual(55)
    expect(g.label).toBe('Neutral')
    expect(g.components.length).toBe(4)
  })
  it('régime euphorique → score élevé', () => {
    const g = compositeSentiment({
      fngValue: 90,
      fundingAnnualizedPct: 40,
      breadthAboveSma50Pct: 92,
      stablecoinDominancePct: 4,
    })
    expect(g.score).toBeGreaterThan(75)
  })
  it('régime de peur → score bas', () => {
    const g = compositeSentiment({
      fngValue: 12,
      fundingAnnualizedPct: -25,
      breadthAboveSma50Pct: 10,
      stablecoinDominancePct: 13,
    })
    expect(g.score).toBeLessThan(30)
  })
  it('libellés par tranches', () => {
    expect(sentimentLabel(10)).toBe('Extreme fear')
    expect(sentimentLabel(50)).toBe('Neutral')
    expect(sentimentLabel(85)).toBe('Euphoria')
  })
  it('aucune donnée → null', () => {
    expect(compositeSentiment({})).toBeNull()
  })
})
