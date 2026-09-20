import { describe, it, expect } from 'vitest'
import { sqrtMcapIndex } from './replica.mjs'

const DAY = 86_400_000

function series(startDate, count, priceFn) {
  const start = Date.parse(`${startDate}T00:00:00Z`)
  return Array.from({ length: count }, (_, i) => ({
    d: new Date(start + i * DAY).toISOString().slice(0, 10),
    c: priceFn(i),
  }))
}

describe('indice réplique √mcap', () => {
  const flatA = series('2024-01-01', 40, () => 10)
  const flatB = series('2024-01-01', 40, () => 20)
  const flat = { A: flatA, B: flatB, C: flatA, D: flatB, E: flatA }
  const mcaps = { A: 100, B: 400, C: 100, D: 100, E: 100 }

  it('poids √mcap normalisés', () => {
    const { weights } = sqrtMcapIndex(flat, mcaps)
    // √ : 10, 20, 10, 10, 10 → total 60
    expect(weights.A).toBeCloseTo(10 / 60, 10)
    expect(weights.B).toBeCloseTo(20 / 60, 10)
  })

  it('séries plates → indice constant à 100', () => {
    const { rows } = sqrtMcapIndex(flat, mcaps)
    for (const row of rows) expect(row.c).toBeCloseTo(100, 10)
  })

  it('un composant qui double tire l’indice de son poids', () => {
    const doubling = { ...flat, B: series('2024-01-01', 40, (i) => 20 * (1 + i / 39)) }
    const { rows, weights } = sqrtMcapIndex(doubling, mcaps)
    const expected = 100 * (1 - weights.B) + 100 * weights.B * 2
    expect(rows[rows.length - 1].c).toBeCloseTo(expected, 6)
  })

  it('moins de 5 composants → null', () => {
    expect(sqrtMcapIndex({ A: flatA, B: flatB }, mcaps)).toBeNull()
  })
})
