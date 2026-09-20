import { describe, it, expect } from 'vitest'
import {
  annualizedBasisPct,
  simplePremiumPct,
  lastFridayOfMonth,
  cmeFrontExpiry,
  basisRegime,
} from './basis.mjs'

describe('basis annualisée', () => {
  it('+5 % à 365 jours = 5 % annualisé', () => {
    expect(annualizedBasisPct(105, 100, 365)).toBeCloseTo(5, 6)
  })
  it('+2.5 % à 6 mois = (1.025)² − 1', () => {
    expect(annualizedBasisPct(102.5, 100, 182.5)).toBeCloseTo(5.0625, 4)
  })
  it('prime simple', () => {
    expect(simplePremiumPct(101, 100)).toBeCloseTo(1, 10)
  })
  it('entrées invalides → null', () => {
    expect(annualizedBasisPct(0, 100, 30)).toBeNull()
    expect(annualizedBasisPct(100, 100, 0)).toBeNull()
  })
})

describe('échéances CME', () => {
  it('dernier vendredi de septembre 2026 = 25/09', () => {
    expect(lastFridayOfMonth(2026, 8).toISOString().slice(0, 10)).toBe('2026-09-25')
  })
  it('dernier vendredi d’octobre 2026 = 30/10 (le 31 est un samedi)', () => {
    expect(lastFridayOfMonth(2026, 9).toISOString().slice(0, 10)).toBe('2026-10-30')
  })
  it('front month depuis le 16/09/2026 → 25/09/2026', () => {
    expect(cmeFrontExpiry(new Date('2026-09-16T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-09-25')
  })
  it('à moins d’un jour de l’échéance → bascule sur le mois suivant', () => {
    expect(cmeFrontExpiry(new Date('2026-09-25T14:30:00Z')).toISOString().slice(0, 10)).toBe('2026-10-30')
  })
  it('décembre bascule sur janvier de l’année suivante', () => {
    expect(cmeFrontExpiry(new Date('2026-12-30T00:00:00Z')).toISOString().slice(0, 10)).toBe('2027-01-29')
  })
})

describe('régime', () => {
  it('signe → contango / backwardation', () => {
    expect(basisRegime(2)).toBe('contango')
    expect(basisRegime(-0.5)).toBe('backwardation')
    expect(basisRegime(null)).toBeNull()
  })
})
