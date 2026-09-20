import { describe, it, expect } from 'vitest'
import { growthSummary, inflationSummary, joinTable, laborSummary, ratesSummary } from './summaries'

describe('résumés textuels', () => {
  it('inflation : dernières valeurs et position vs cible', () => {
    const text = inflationSummary({
      cpiYoY: [
        { d: '2026-07-01', v: 3.4 },
        { d: '2026-08-01', v: 3.4 },
      ],
      coreCpiYoY: [{ d: '2026-08-01', v: 2.4 }],
      corePceYoY: [{ d: '2026-07-01', v: 3.3 }],
      target: 2,
    })
    expect(text).toBe(
      'CPI inflation was 3.4% year over year in August 2026 (Jul: 3.4%); core CPI 2.4%. Core PCE, the Fed’s preferred gauge, was 3.3% in July 2026. All three measures are above the 2% target.',
    )
    expect(
      inflationSummary({ cpiYoY: [{ d: '2026-08-01', v: 1.8 }], coreCpiYoY: [{ d: '2026-08-01', v: 2.4 }], corePceYoY: [], target: 2 }),
    ).toMatch(/1 of 2 measures are above the 2% target\.$/)
    expect(inflationSummary({ cpiYoY: [], coreCpiYoY: [], corePceYoY: [], target: 2 })).toBeNull()
  })

  it('emploi : moyenne 3 mois et variation du chômage', () => {
    const text = laborSummary({
      nfpMoM: [
        { d: '2026-06-01', v: 30 },
        { d: '2026-07-01', v: 21 },
        { d: '2026-08-01', v: 162 },
      ],
      unrate: [
        { d: '2026-07-01', v: 4.2 },
        { d: '2026-08-01', v: 4.1 },
      ],
    })
    expect(text).toBe(
      'Payrolls rose by 162k in August 2026 (3-month average +71k). The unemployment rate was 4.1% in August 2026, down from 4.2%.',
    )
    expect(laborSummary({ nfpMoM: [{ d: '2026-08-01', v: -12 }], unrate: [] })).toBe(
      'Payrolls fell by 12k in August 2026 (3-month average −12k).',
    )
  })

  it('taux : écart en points de base, inversion et fourchette Fed', () => {
    const text = ratesSummary(
      {
        y10: [{ d: '2026-09-15', v: 5 }],
        m3: [{ d: '2026-09-15', v: 4.11 }],
        spread10y3m: [
          { d: '2024-01-02', v: -1.65 },
          { d: '2026-09-15', v: 0.89 },
        ],
        fedTargetUpper: [],
        fedTargetLower: [],
        effr: null,
      },
      {
        target: { lower: 3.5, upper: 3.75, asOf: '2026-09-15', source: 'NY Fed' },
        effr: { value: 3.63, date: '2026-09-15' },
        lastDecision: null,
        links: { statement: null, statementDate: null, minutes: null, minutesTitle: null },
      },
    )
    expect(text).toBe(
      'On Sep 15, 2026 the 10-year yield was 5.00% and the 3-month bill 4.11%: the 10Y–3M spread is +89 bp (curve not inverted; range over the period −165 to +89 bp). The Fed’s target range is 3.50%–3.75% (effective rate 3.63%).',
    )
  })

  it('croissance : trimestre et fourchette du VIX', () => {
    const text = growthSummary({
      gdpQoQ: [
        { d: '2026-01-01', v: 2.1 },
        { d: '2026-04-01', v: -0.4 },
      ],
      vix: [
        { d: '2026-09-14', v: 12.8 },
        { d: '2026-09-15', v: 17.2 },
      ],
      dxy: [],
      wti: [],
    })
    expect(text).toBe(
      'Real GDP contracted at a 0.4% annualized rate in Q2 2026 (Q1: +2.1%). The VIX closed at 17.20 on Sep 15, 2026 (two-year range 12.8–17.2).',
    )
  })
})

describe('table jumelle', () => {
  it('jointure par date, plus récent en premier, escalier « à date »', () => {
    const rows = joinTable(
      [
        { label: '10Y', rows: [{ d: '2026-09-14', v: 4.97 }, { d: '2026-09-15', v: 5 }], format: (v) => v.toFixed(2) },
        { label: 'Fed', rows: [{ d: '2025-12-10', v: 3.75 }], format: (v) => v.toFixed(2), asOf: true },
        { label: '3M', rows: [{ d: '2026-09-15', v: 4.11 }], format: (v) => v.toFixed(2) },
      ],
      (d) => d,
      5,
    )
    expect(rows).toEqual([
      ['2026-09-15', '5.00', '3.75', '4.11'],
      ['2026-09-14', '4.97', '3.75', '—'],
    ])
  })
})
