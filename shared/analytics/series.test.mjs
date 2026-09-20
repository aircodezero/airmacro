import { describe, it, expect } from 'vitest'
import {
  sma,
  ema,
  stdev,
  maxDrawdownPct,
  drawdownFromHighPct,
  pctChange,
  pearson,
  rollingCorrelation,
  olsRegression,
  alignByDate,
  quantile,
  percentileRank,
  toBase100,
  realizedVolAnnualizedPct,
} from './series.mjs'

describe('sma / ema', () => {
  it('sma(3) sur [1..5] — références à la main', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
  })
  it('ema(3) amorcée par SMA : [null,null,2,3,4]', () => {
    const out = ema([1, 2, 3, 4, 5], 3)
    expect(out[2]).toBeCloseTo(2, 10)
    expect(out[3]).toBeCloseTo(3, 10) // 4·0.5 + 2·0.5
    expect(out[4]).toBeCloseTo(4, 10) // 5·0.5 + 3·0.5
  })
})

describe('dispersion / drawdown', () => {
  it('stdev échantillon de [2,4,4,4,5,5,7,9] = √(32/7)', () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 10)
  })
  it('drawdown max de [100,120,60,90] = −50 %', () => {
    expect(maxDrawdownPct([100, 120, 60, 90])).toBeCloseTo(-50, 10)
  })
  it('drawdown courant de [100,120,90] = −25 %', () => {
    expect(drawdownFromHighPct([100, 120, 90])).toBeCloseTo(-25, 10)
  })
  it('vol réalisée nulle sur série constante', () => {
    expect(realizedVolAnnualizedPct(new Array(40).fill(100), 30)).toBeCloseTo(0, 10)
  })
})

describe('rendements', () => {
  it('pctChange lookback 2 : 100→121 = +21 %', () => {
    expect(pctChange([100, 110, 121], 2)).toBeCloseTo(21, 10)
  })
})

describe('corrélation / régression', () => {
  it('pearson parfait ±1', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10)
    expect(pearson([1, 2, 3, 4], [-1, -2, -3, -4])).toBeCloseTo(-1, 10)
  })
  it('OLS exacte : y = 2x + 1 → beta 2, alpha 1, R² 1', () => {
    const fit = olsRegression([1, 2, 3, 4], [3, 5, 7, 9])
    expect(fit.beta).toBeCloseTo(2, 10)
    expect(fit.alpha).toBeCloseTo(1, 10)
    expect(fit.r2).toBeCloseTo(1, 10)
  })
  it('corrélation glissante alignée, fenêtre 3', () => {
    const out = rollingCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10], 3)
    expect(out.length).toBe(5)
    expect(out[0]).toBeNull()
    expect(out[1]).toBeNull()
    expect(out[4]).toBeCloseTo(1, 10)
  })
})

describe('alignement par dates', () => {
  it('intersection triée', () => {
    const { dates, values } = alignByDate({
      A: [
        { d: '2024-01-01', c: 1 },
        { d: '2024-01-02', c: 2 },
        { d: '2024-01-03', c: 3 },
      ],
      B: [
        { d: '2024-01-02', c: 20 },
        { d: '2024-01-03', c: 30 },
        { d: '2024-01-04', c: 40 },
      ],
    })
    expect(dates).toEqual(['2024-01-02', '2024-01-03'])
    expect(values.A).toEqual([2, 3])
    expect(values.B).toEqual([20, 30])
  })
})

describe('quantiles / base 100', () => {
  it('quantile 0.5 de [1,2,3,4] = 2.5', () => {
    expect(quantile([4, 1, 3, 2], 0.5)).toBeCloseTo(2.5, 10)
  })
  it('percentileRank(3 dans [1,2,3,4]) = 75', () => {
    expect(percentileRank([1, 2, 3, 4], 3)).toBeCloseTo(75, 10)
  })
  it('toBase100', () => {
    expect(toBase100([50, 100])).toEqual([100, 200])
  })
})
