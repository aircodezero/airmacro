import { describe, it, expect } from 'vitest'
import { buildSeries, effectiveTarget } from './build.mjs'
import { calendarTtl, blsTtl, beaTtl, fedTtl, releaseTtl } from '../../routes/macro.mjs'

const NOW = Date.UTC(2026, 8, 16, 13, 0)
const monthly = (from, values) =>
  values.map((v, i) => {
    const d = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1 + i, 1))
    return { d: d.toISOString().slice(0, 10), v }
  })

const NYFED = {
  provider: 'NY Fed',
  rows: [
    { d: '2025-09-15', effr: 4.33, lower: 4.25, upper: 4.5 },
    { d: '2026-09-14', effr: 3.63, lower: 3.5, upper: 3.75 },
    { d: '2026-09-15', effr: 3.63, lower: 3.5, upper: 3.75 },
  ],
}

describe('cible Fed effective', () => {
  it('NY Fed par défaut, communiqué plus récent prioritaire', () => {
    expect(effectiveTarget(NYFED.rows, [])).toEqual({ lower: 3.5, upper: 3.75, asOf: '2026-09-15', source: 'NY Fed' })
    const decisions = [{ date: '2026-09-16', decision: { lower: 3.75, upper: 4 } }]
    expect(effectiveTarget(NYFED.rows, decisions)).toEqual({ lower: 3.75, upper: 4, asOf: '2026-09-16', source: 'Fed statement' })
    // communiqué plus ancien que la dernière donnée NY Fed : ignoré
    expect(effectiveTarget(NYFED.rows, [{ date: '2026-07-29', decision: { lower: 3.5, upper: 3.75 } }]).source).toBe('NY Fed')
    // J+1 matin : NY Fed publie la ligne du jour J, encore à l'ancienne fourchette → le communiqué prime
    const cut = [{ date: '2025-09-17', decision: { lower: 4, upper: 4.25 } }]
    const rows = [
      { d: '2025-09-16', effr: 4.33, lower: 4.25, upper: 4.5 },
      { d: '2025-09-17', effr: 4.33, lower: 4.25, upper: 4.5 },
    ]
    expect(effectiveTarget(rows, cut)).toMatchObject({ lower: 4, upper: 4.25, source: 'Fed statement' })
    // J+2 : la ligne du lendemain porte la nouvelle fourchette → NY Fed reprend la main
    expect(effectiveTarget([...rows, { d: '2025-09-18', effr: 4.08, lower: 4, upper: 4.25 }], cut).source).toBe('NY Fed')
    expect(effectiveTarget([], [])).toBeNull()
  })
})

describe('buildSeries', () => {
  const families = {
    bls: {
      provider: 'BLS',
      series: {
        cpiNsa: monthly('2025-07-01', [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 103, 104.03]),
        payems: monthly('2026-05-01', [158800, 158892, 158913, 159075]),
        unrate: monthly('2026-07-01', [4.1, 4.2]),
      },
      preliminary: { payems: true },
    },
    treasury: {
      provider: 'US Treasury',
      y10: [
        { d: '2026-09-14', v: 4.97 },
        { d: '2026-09-15', v: 5.0 },
      ],
      m3: [
        { d: '2026-09-14', v: 4.11 },
        { d: '2026-09-15', v: 4.11 },
      ],
    },
    nyfed: NYFED,
    fed: {
      items: [{ type: 'statement', url: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm', date: '2026-07-29', title: 'x' }],
      decisions: [{ date: '2026-07-29', url: 'u', decision: { action: 'hold', lower: 3.5, upper: 3.75, changePts: 0, vote: null } }],
    },
    dxy: {
      provider: 'replica',
      kind: 'replica',
      rows: [
        { d: '2026-09-14', v: 99.48 },
        { d: '2026-09-15', v: 99.62 },
      ],
    },
  }
  const out = buildSeries(families, NOW)

  it('tuiles : valeurs, variations et unités', () => {
    // CPI : 103/100 − 1 = 3.0 % puis 104.03/101 − 1 = 3.0 %
    expect(out.tiles.cpiYoY).toMatchObject({ value: 3, date: '2026-08-01', delta: 0, deltaUnit: 'pp', unit: '%' })
    expect(out.tiles.nfp).toMatchObject({ value: 162, delta: 141, unit: 'k', avg3: 92, preliminary: true }) // (92+21+162)/3
    expect(out.tiles.unrate).toMatchObject({ value: 4.2, delta: 0.1 })
    expect(out.tiles.y10).toMatchObject({ value: 5, delta: 3, deltaUnit: 'bp' })
    expect(out.tiles.spread10y3m).toMatchObject({ value: 89, delta: 3, unit: 'bp', inverted: false })
    expect(out.tiles.fedTarget).toMatchObject({ value: 3.75, lower: 3.5, delta: -0.75, targetSource: 'NY Fed', effr: { value: 3.63, date: '2026-09-15' } })
    expect(out.tiles.dxy).toMatchObject({ label: 'Dollar index (replica)', value: 99.62, delta: 0.14, deltaUnit: '%' })
    // familles absentes → tuiles absentes (jamais de valeur inventée)
    expect(out.tiles.gdp).toBeUndefined()
    expect(out.tiles.corePceYoY).toBeUndefined()
    expect(out.tiles.wti).toBeUndefined()
  })

  it('décision du jour : points NY Fed du même jour remplacés, dates croissantes', () => {
    const out2 = buildSeries(
      {
        ...families,
        nyfed: { provider: 'NY Fed', rows: [...NYFED.rows, { d: '2026-09-16', effr: 3.63, lower: 3.5, upper: 3.75 }] },
        fed: { items: [], decisions: [{ date: '2026-09-16', url: 'u', decision: { action: 'hike', lower: 3.75, upper: 4, changePts: 0.25, vote: null } }] },
      },
      NOW,
    )
    expect(out2.tiles.fedTarget).toMatchObject({ value: 4, lower: 3.75, targetSource: 'Fed statement', family: 'fed' })
    const dates = out2.charts.rates.fedTargetUpper.map((r) => r.d)
    expect(dates).toEqual([...new Set(dates)].sort())
    expect(out2.charts.rates.fedTargetUpper.at(-1)).toEqual({ d: '2026-09-16', v: 4 })
  })

  it('graphiques et politique monétaire', () => {
    expect(out.charts.rates.spread10y3m).toEqual([
      { d: '2026-09-14', v: 0.86 },
      { d: '2026-09-15', v: 0.89 },
    ])
    expect(out.charts.rates.fedTargetUpper.map((r) => r.v)).toEqual([4.5, 3.75, 3.75])
    expect(out.charts.inflation.target).toBe(2)
    expect(out.policy.lastDecision).toMatchObject({ date: '2026-07-29', action: 'hold' })
    expect(out.policy.links.statement).toMatch(/monetary20260729a/)
    expect(out.meta.sourcesBySerie.cpiYoY).toMatch(/CUUR0000SA0/)
  })
})

describe('TTL adaptatifs', () => {
  const fomc = { kind: 'fomc', category: 'decision', impact: 'High', country: 'USD', ts: Date.UTC(2026, 8, 16, 18, 0), actual: null }
  const cpi = { kind: 'cpi', category: 'data', impact: 'High', country: 'USD', ts: Date.UTC(2026, 9, 14, 12, 30), actual: null }

  it('calendrier : 5 min autour d’un événement High, sinon 15 min', () => {
    expect(calendarTtl([fomc], NOW)).toBe(5 * 60_000)
    expect(calendarTtl([fomc], Date.UTC(2026, 8, 20))).toBe(15 * 60_000)
    expect(calendarTtl([], NOW)).toBe(15 * 60_000)
  })
  it('BLS : 3 min pendant 20 min après une publication sans actual, puis 15 min jusqu’à 90 min', () => {
    expect(blsTtl([cpi], cpi.ts)).toBe(3 * 60_000)
    expect(blsTtl([cpi], cpi.ts + 10 * 60_000)).toBe(3 * 60_000)
    expect(blsTtl([cpi], cpi.ts + 30 * 60_000)).toBe(15 * 60_000)
    expect(blsTtl([{ ...cpi, actual: '3.1%' }], cpi.ts + 10 * 60_000)).toBe(12 * 3_600_000)
    expect(blsTtl([cpi], cpi.ts + 2 * 3_600_000)).toBe(12 * 3_600_000)
    expect(blsTtl([cpi], cpi.ts - 60_000)).toBe(12 * 3_600_000)
    // une publication plus ancienne n'éclipse pas la plus récente
    const older = { ...cpi, kind: 'nfp', ts: cpi.ts - 40 * 60_000 }
    expect(blsTtl([older, cpi], cpi.ts + 5 * 60_000)).toBe(3 * 60_000)
  })
  it('BEA et communiqué Fed', () => {
    expect(beaTtl([{ ...cpi, kind: 'pce' }], cpi.ts + 60_000)).toBe(3 * 60_000)
    expect(beaTtl([{ ...cpi, kind: 'pce' }], cpi.ts + 45 * 60_000)).toBe(15 * 60_000)
    expect(beaTtl([cpi], cpi.ts + 60_000)).toBe(6 * 3_600_000)
    expect(fedTtl([fomc], fomc.ts + 60_000)).toBe(2 * 60_000)
    expect(fedTtl([{ ...fomc, decision: { upper: 4 } }], fomc.ts + 60_000)).toBe(30 * 60_000)
    expect(fedTtl([fomc], fomc.ts - 60_000)).toBe(30 * 60_000)
  })
  it('BLS : le PPI (lignes « other ») relance aussi le sondage rapproché', () => {
    const ppi = { id: 'ppi', kind: 'other', category: 'data', impact: 'High', country: 'USD', ts: cpi.ts, actual: null, measures: [{ name: 'PPI m/m', actual: null }] }
    expect(blsTtl([ppi], ppi.ts + 60_000)).toBe(3 * 60_000)
    expect(blsTtl([{ ...ppi, measures: [{ name: 'PPI m/m', actual: '0.3%' }] }], ppi.ts + 60_000)).toBe(12 * 3_600_000)
    expect(blsTtl([{ ...ppi, measures: [{ name: 'Philly Fed Manufacturing Index', actual: null }] }], ppi.ts + 60_000)).toBe(12 * 3_600_000)
  })
  it('sources « au fil des communiqués » : cadence d’attente selon l’âge, une fois par jour une fois lu', () => {
    const boe = { id: 'boe', kind: 'boe', category: 'decision', country: 'GBP', ts: Date.UTC(2026, 8, 17, 11, 0), measures: [{ name: 'Official Bank Rate', actual: null }] }
    const resolved = { ...boe, measures: [{ name: 'Official Bank Rate', actual: '3.75%' }] }
    expect(releaseTtl('boe', [boe], [], boe.ts + 5 * 60_000)).toBe(2 * 60_000)
    expect(releaseTtl('boe', [boe], [boe], boe.ts + 60 * 60_000)).toBe(10 * 60_000)
    expect(releaseTtl('boe', [boe], [boe], boe.ts + 5 * 3_600_000)).toBe(3_600_000)
    expect(releaseTtl('boe', [boe], [boe], boe.ts + 3 * 86_400_000)).toBe(6 * 3_600_000)
    expect(releaseTtl('boe', [boe], [resolved], boe.ts + 5 * 60_000)).toBe(24 * 3_600_000)
  })
})
