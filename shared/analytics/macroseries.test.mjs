import { describe, it, expect } from 'vitest'
import {
  shiftMonth,
  yoy,
  momPct,
  momDiff,
  spread,
  changePoints,
  decimate,
  lastWithDelta,
  valueAsOf,
  pctChangeOverDays,
  dxyFromEurCrosses,
  parseFedFraction,
  parseFomcDecision,
} from './macroseries.mjs'

describe('shiftMonth', () => {
  it('passe les années dans les deux sens', () => {
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01')
    expect(shiftMonth('2025-12-01', 1)).toBe('2026-01-01')
    expect(shiftMonth('2026-08-01', -12)).toBe('2025-08-01')
    expect(shiftMonth('2026-03-01', -27)).toBe('2023-12-01')
  })
})

describe('yoy / momPct / momDiff — valeurs à la main', () => {
  it('yoy apparie par mois, pas par index (trou ignoré)', () => {
    const rows = [
      { d: '2025-08-01', v: 100 },
      { d: '2025-09-01', v: 101 },
      // 2026-07 manquant volontairement
      { d: '2026-08-01', v: 103 },
      { d: '2026-09-01', v: 103.02 },
    ]
    // 103/100 − 1 = 3.0 % ; 103.02/101 − 1 = 2.0 %
    expect(yoy(rows)).toEqual([
      { d: '2026-08-01', v: 3 },
      { d: '2026-09-01', v: 2 },
    ])
  })

  it('momPct sur l’IPC désaisonnalisé BLS (juin→août 2026)', () => {
    const rows = [
      { d: '2026-06-01', v: 332.568 },
      { d: '2026-07-01', v: 332.813 },
      { d: '2026-08-01', v: 334.131 },
    ]
    // 332.813/332.568 − 1 = 0.0737 % → 0.1 ; 334.131/332.813 − 1 = 0.3960 % → 0.4
    expect(momPct(rows)).toEqual([
      { d: '2026-07-01', v: 0.1 },
      { d: '2026-08-01', v: 0.4 },
    ])
  })

  it('momDiff : créations d’emplois (milliers) et mois non consécutifs ignorés', () => {
    const rows = [
      { d: '2026-06-01', v: 158892 },
      { d: '2026-07-01', v: 158913 },
      { d: '2026-08-01', v: 159075 },
    ]
    expect(momDiff(rows)).toEqual([
      { d: '2026-07-01', v: 21 },
      { d: '2026-08-01', v: 162 },
    ])
    expect(momDiff([{ d: '2026-05-01', v: 10 }, { d: '2026-07-01', v: 12 }])).toEqual([])
  })
})

describe('spread / changePoints / decimate', () => {
  it('spread 10Y − 3M apparié par date', () => {
    const y10 = [
      { d: '2026-09-14', v: 4.97 },
      { d: '2026-09-15', v: 5.0 },
    ]
    const m3 = [{ d: '2026-09-15', v: 4.11 }]
    expect(spread(y10, m3)).toEqual([{ d: '2026-09-15', v: 0.89 }])
  })

  it('changePoints garde les ruptures et le dernier point', () => {
    const rows = [
      { d: '2026-01-01', v: 3.5 },
      { d: '2026-01-02', v: 3.5 },
      { d: '2026-01-03', v: 3.75 },
      { d: '2026-01-04', v: 3.75 },
    ]
    expect(changePoints(rows).map((r) => r.d)).toEqual(['2026-01-01', '2026-01-03', '2026-01-04'])
  })

  it('decimate conserve premier et dernier points', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ d: `2026-01-${String(i + 1).padStart(2, '0')}`, v: i }))
    expect(decimate(rows, 4).map((r) => r.v)).toEqual([0, 3, 6, 9])
    expect(decimate(rows, 20)).toHaveLength(10)
  })
})

describe('lastWithDelta / valueAsOf / pctChangeOverDays', () => {
  const rows = [
    { d: '2026-09-01', v: 100 },
    { d: '2026-09-08', v: 110 },
    { d: '2026-09-15', v: 99 },
  ]
  it('dernier point et variation', () => {
    expect(lastWithDelta(rows)).toEqual({ d: '2026-09-15', v: 99, prevD: '2026-09-08', prevV: 110, delta: -11 })
    expect(lastWithDelta([])).toBeNull()
  })
  it('valeur à date (≤ cible)', () => {
    expect(valueAsOf(rows, '2026-09-10')).toEqual({ d: '2026-09-08', v: 110 })
    expect(valueAsOf(rows, '2026-08-31')).toBeNull()
  })
  it('variation sur 14 jours : 99/100 − 1 = −1 %', () => {
    expect(pctChangeOverDays(rows, 14)).toBe(-1)
  })
})

describe('dxyFromEurCrosses — formule ICE', () => {
  it('parité unitaire → constante de la formule', () => {
    expect(dxyFromEurCrosses({ USD: 1, JPY: 1, GBP: 1, CAD: 1, SEK: 1, CHF: 1 })).toBeCloseTo(50.14348112, 8)
  })
  it('croisements via l’euro = calcul direct sur les paires USD', () => {
    // EURUSD 1.10, USDJPY 150, GBPUSD 1.30, USDCAD 1.35, USDSEK 10.5, USDCHF 0.88
    const direct =
      50.14348112 * 1.1 ** -0.576 * 150 ** 0.136 * 1.3 ** -0.119 * 1.35 ** 0.091 * 10.5 ** 0.042 * 0.88 ** 0.036
    const viaEur = dxyFromEurCrosses({
      USD: 1.1,
      JPY: 150 * 1.1,
      GBP: 1.1 / 1.3,
      CAD: 1.35 * 1.1,
      SEK: 10.5 * 1.1,
      CHF: 0.88 * 1.1,
    })
    expect(viaEur).toBeCloseTo(direct, 9)
    expect(viaEur).toBeCloseTo(102.69, 1) // calcul à la main (ln) : 102.686
  })
  it('devise manquante → null', () => {
    expect(dxyFromEurCrosses({ USD: 1.1, JPY: 160, GBP: 0.85, CAD: 1.5, SEK: null, CHF: 0.95 })).toBeNull()
  })
})

describe('communiqué FOMC', () => {
  it('fractions de la Fed', () => {
    expect(parseFedFraction('3-1/2')).toBe(3.5)
    expect(parseFedFraction('3-3/4')).toBe(3.75)
    expect(parseFedFraction('4')).toBe(4)
    expect(parseFedFraction('1/4')).toBe(0.25)
    expect(parseFedFraction('abc')).toBeNull()
  })

  it('statu quo (texte réel du 29 juillet 2026)', () => {
    const text =
      'The Federal Open Market Committee approved the following statement for release by a 9 – 3 vote: The Committee decided to maintain the target range for the federal funds rate at 3-1/2 to 3-3/4 percent, in support of the Federal Reserve’s dual mandate.'
    expect(parseFomcDecision(text)).toEqual({
      action: 'hold',
      lower: 3.5,
      upper: 3.75,
      changePts: 0,
      vote: { for: 9, against: 3 },
    })
  })

  it('hausse et baisse', () => {
    const hike = parseFomcDecision(
      'In support of its goals, the Committee decided to raise the target range for the federal funds rate by 1/4 percentage point to 3-3/4 to 4 percent.',
    )
    expect(hike).toMatchObject({ action: 'hike', lower: 3.75, upper: 4, changePts: 0.25 })
    const cut = parseFomcDecision(
      'the Committee decided to lower the target range for the federal funds rate by 1/2 percentage point to 4-3/4 to 5 percent.',
    )
    expect(cut).toMatchObject({ action: 'cut', lower: 4.75, upper: 5, changePts: -0.5 })
  })

  it('texte sans décision → null (jamais inventé)', () => {
    expect(parseFomcDecision('Minutes of the Federal Open Market Committee')).toBeNull()
  })
})
