import { describe, it, expect } from 'vitest'
import { rsi, macd } from './indicators.mjs'

describe('RSI (Wilder)', () => {
  it('série strictement haussière → 100', () => {
    const values = Array.from({ length: 20 }, (_, i) => 10 + i)
    const out = rsi(values, 14)
    expect(out[19]).toBe(100)
  })
  it('série strictement baissière → 0', () => {
    const values = Array.from({ length: 20 }, (_, i) => 100 - i)
    const out = rsi(values, 14)
    expect(out[19]).toBe(0)
  })
  it('références à la main, période 3 sur [10,11,10,12,11,13]', () => {
    const out = rsi([10, 11, 10, 12, 11, 13], 3)
    // amorçage : gains (1, 2) pertes (1) → avgGain 1, avgLoss 1/3 → RS 3 → RSI 75
    expect(out[3]).toBeCloseTo(75, 6)
    // pas 4 : avgGain 2/3, avgLoss 5/9 → RS 1.2 → RSI 54.5455
    expect(out[4]).toBeCloseTo(100 - 100 / 2.2, 4)
    // pas 5 : avgGain 10/9, avgLoss 10/27 → RS 3 → RSI 75
    expect(out[5]).toBeCloseTo(75, 6)
  })
})

describe('MACD', () => {
  it('série constante → histogramme nul après amorçage', () => {
    const values = new Array(60).fill(5)
    const { histogram } = macd(values)
    const lastValues = histogram.slice(-10)
    for (const h of lastValues) expect(h).toBeCloseTo(0, 10)
  })
  it('tendance haussière régulière → ligne MACD positive', () => {
    const values = Array.from({ length: 80 }, (_, i) => 100 * Math.pow(1.01, i))
    const { macdLine, signalLine } = macd(values)
    expect(macdLine[79]).toBeGreaterThan(0)
    expect(signalLine[79]).toBeGreaterThan(0)
  })
})
