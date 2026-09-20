import { describe, it, expect } from 'vitest'
import { actualNeeds, actualSupport, attachActuals, claimsWeekEnding, formatLike, refMonthFor, refQuarterFor, ruleFor } from './actuals.mjs'

const CPI_TS = Date.UTC(2026, 8, 11, 12, 30) // 11/09/2026 08:30 New York
const NFP_TS = Date.UTC(2026, 8, 4, 12, 30)
const AFTER = Date.UTC(2026, 8, 16, 13, 0)

// Niveaux réels BLS (extraits de la capture du 16/09/2026)
const BLS = {
  series: {
    cpiNsa: [
      { d: '2025-07-01', v: 323.048 },
      { d: '2025-08-01', v: 323.976 },
      { d: '2026-07-01', v: 333.918 },
      { d: '2026-08-01', v: 334.98 },
    ],
    coreCpiNsa: [
      { d: '2025-08-01', v: 329.97 },
      { d: '2026-08-01', v: 338.041 },
    ],
    cpiSa: [
      { d: '2026-07-01', v: 332.813 },
      { d: '2026-08-01', v: 334.131 },
    ],
    coreCpiSa: [
      { d: '2026-07-01', v: 336.789 },
      { d: '2026-08-01', v: 337.765 },
    ],
    unrate: [
      { d: '2026-07-01', v: 4.1 },
      { d: '2026-08-01', v: 4.1 },
    ],
    payems: [
      { d: '2026-07-01', v: 158913 },
      { d: '2026-08-01', v: 159075 },
    ],
    ahe: [
      { d: '2026-07-01', v: 37.1 },
      { d: '2026-08-01', v: 37.21 },
    ],
  },
}

const cpiEvent = (ts = CPI_TS) => ({
  id: 'cpi',
  kind: 'cpi',
  category: 'data',
  country: 'USD',
  ts,
  measures: [
    { name: 'CPI y/y', forecast: '3.3%', previous: '3.3%', actual: null },
    { name: 'Core CPI m/m', forecast: '0.3%', previous: '0.3%', actual: null },
    { name: 'CPI m/m', forecast: '0.4%', previous: '0.0%', actual: null },
    { name: 'Core CPI y/y', forecast: '2.4%', previous: '2.5%', actual: null },
  ],
})

describe('périodes de référence (heure de New York)', () => {
  it('mois précédant la publication', () => {
    expect(refMonthFor(CPI_TS)).toBe('2026-08-01')
    expect(refMonthFor(Date.UTC(2027, 0, 13, 13, 30))).toBe('2026-12-01')
    // 1er du mois 00:30 UTC = veille à New York
    expect(refMonthFor(Date.UTC(2026, 9, 1, 0, 30))).toBe('2026-08-01')
  })
  it('dernier trimestre achevé', () => {
    expect(refQuarterFor(Date.UTC(2026, 8, 24, 12, 30))).toBe('2026-04-01')
    expect(refQuarterFor(Date.UTC(2027, 0, 29, 13, 30))).toBe('2026-10-01')
    expect(refQuarterFor(Date.UTC(2027, 3, 29, 12, 30))).toBe('2027-01-01')
  })
})

describe('IPC US', () => {
  it('actual calculé depuis les niveaux BLS, surprise vs consensus', () => {
    const e = attachActuals(cpiEvent(), { bls: BLS }, AFTER)
    const byName = Object.fromEntries(e.measures.map((m) => [m.name, m]))
    expect(byName['CPI y/y']).toMatchObject({ actual: '3.4%', surprise: 'above' }) // 334.980/323.976 − 1 = 3.397 %
    expect(byName['Core CPI m/m']).toMatchObject({ actual: '0.3%', surprise: 'inline' }) // 337.765/336.789 − 1 = 0.290 %
    expect(byName['CPI m/m']).toMatchObject({ actual: '0.4%', surprise: 'inline' }) // 0.396 %
    expect(byName['Core CPI y/y']).toMatchObject({ actual: '2.4%' }) // 338.041/329.970 − 1 = 2.446 %
    expect(byName['CPI y/y'].actualSource).toMatch(/BLS/)
    expect(e.actual).toBe('3.4%')
  })
  it('événement futur : jamais d’actual', () => {
    const e = attachActuals(cpiEvent(AFTER + 3_600_000), { bls: BLS }, AFTER)
    expect(e.measures.every((m) => m.actual == null)).toBe(true)
  })
  it('mois de référence absent : pas d’actual (la série n’est pas encore publiée)', () => {
    const e = attachActuals(cpiEvent(Date.UTC(2026, 9, 14, 12, 30)), { bls: BLS }, Date.UTC(2026, 9, 14, 13, 0))
    expect(e.actual).toBeNull()
  })
})

describe('rapport emploi', () => {
  it('NFP en milliers, chômage et salaires', () => {
    const e = attachActuals(
      {
        id: 'nfp',
        kind: 'nfp',
        category: 'data',
        country: 'USD',
        ts: NFP_TS,
        measures: [
          { name: 'Non-Farm Employment Change', forecast: '75K', previous: '21K', actual: null },
          { name: 'Unemployment Rate', forecast: '4.2%', previous: '4.1%', actual: null },
          { name: 'Average Hourly Earnings m/m', forecast: '0.3%', previous: '0.3%', actual: null },
        ],
      },
      { bls: BLS },
      AFTER,
    )
    expect(e.measures.map((m) => m.actual)).toEqual(['162K', '4.1%', '0.3%'])
    expect(e.measures[0].surprise).toBe('above')
    expect(e.measures[1].surprise).toBe('below')
  })
})

describe('BEA : garde-fou d’horodatage', () => {
  const bea = (lastModifiedM, lastModifiedQ) => ({
    monthly: {
      corePce: [
        { d: '2025-08-01', v: 126.9 },
        { d: '2026-07-01', v: 130.658 },
        { d: '2026-08-01', v: 131.05 },
      ],
      pce: [],
    },
    quarterly: {
      gdpQoQ: [
        { d: '2026-01-01', v: 2.1 },
        { d: '2026-04-01', v: 1.5 },
      ],
    },
    lastModifiedM,
    lastModifiedQ,
  })
  const pceTs = Date.UTC(2026, 8, 25, 12, 30)
  const pceEvent = {
    id: 'pce',
    kind: 'pce',
    category: 'data',
    country: 'USD',
    ts: pceTs,
    measures: [
      { name: 'Core PCE Price Index m/m', forecast: '0.2%', previous: '0.3%', actual: null },
      { name: 'Core PCE Price Index y/y', forecast: '3.2%', previous: '3.3%', actual: null },
    ],
  }
  it('fichier modifié avant la publication → pas d’actual', () => {
    const e = attachActuals(pceEvent, { bea: bea('Wed, 26 Aug 2026 12:30:02 GMT') }, pceTs + 60_000)
    expect(e.actual).toBeNull()
  })
  it('fichier mis à jour après la publication → actual', () => {
    const e = attachActuals(pceEvent, { bea: bea('Fri, 25 Sep 2026 12:30:03 GMT') }, pceTs + 60_000)
    expect(e.measures.map((m) => m.actual)).toEqual(['0.3%', '3.3%']) // 131.05/130.658 = +0.30 % ; 131.05/126.9 = +3.27 %
    expect(e.measures[0].actualSource).toMatch(/BEA/)
  })
  it('PIB : estimation révisée en place, horodatage requis', () => {
    const gdpTs = Date.UTC(2026, 8, 24, 12, 30)
    const gdpEvent = {
      id: 'gdp',
      kind: 'gdp',
      category: 'data',
      country: 'USD',
      ts: gdpTs,
      measures: [{ name: 'Final GDP q/q', forecast: '1.6%', previous: '1.5%', actual: null }],
    }
    expect(attachActuals(gdpEvent, { bea: bea(null, 'Wed, 26 Aug 2026 12:30:05 GMT') }, gdpTs + 60_000).actual).toBeNull()
    const fresh = attachActuals(gdpEvent, { bea: bea(null, 'Thu, 24 Sep 2026 12:30:05 GMT') }, gdpTs + 60_000)
    expect(fresh.actual).toBe('1.5%')
    expect(fresh.measures[0].surprise).toBe('below')
  })
})

describe('décision FOMC', () => {
  const decisionTs = Date.UTC(2026, 8, 16, 18, 0)
  const fed = {
    decisions: [
      {
        date: '2026-09-16',
        url: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm',
        decision: { action: 'hike', lower: 3.75, upper: 4, changePts: 0.25, vote: { for: 10, against: 2 } },
      },
      { date: '2026-07-29', url: 'https://www.federalreserve.gov/x', decision: { action: 'hold', lower: 3.5, upper: 3.75, changePts: 0, vote: null } },
    ],
  }
  const event = {
    id: 'fomc-2026-09-16-decision',
    kind: 'fomc',
    category: 'decision',
    country: 'USD',
    ts: decisionTs,
    measures: [
      { name: 'Federal Funds Rate', forecast: '4.00%', previous: '3.75%', actual: null },
      { name: 'FOMC Statement', forecast: null, previous: null, actual: null },
    ],
  }

  it('actual lu dans le communiqué du jour', () => {
    const e = attachActuals(event, { fed }, decisionTs + 5 * 60_000)
    expect(e.actual).toBe('4.00%')
    expect(e.measures[0]).toMatchObject({ actualSource: 'Fed statement', surprise: 'inline' })
    expect(e.decision).toMatchObject({ action: 'hike', upper: 4, url: fed.decisions[0].url })
    expect(e.measures[1].actual).toBeNull()
  })

  it('communiqué pas encore publié → rien', () => {
    const e = attachActuals(event, { fed: { decisions: [fed.decisions[1]] } }, decisionTs + 60_000)
    expect(e.actual).toBeNull()
    expect(e.decision).toBeUndefined()
  })

  it('flux calendrier absent : mesure reconstituée, précédent = dernière cible NY Fed', () => {
    const refOnly = { ...event, measures: [], isReference: true }
    const policy = { targetHistory: [{ d: '2026-09-14', upper: 3.75 }, { d: '2026-09-15', upper: 3.75 }] }
    const e = attachActuals(refOnly, { fed, policy }, decisionTs + 60_000)
    expect(e.measures).toEqual([
      {
        name: 'Federal Funds Rate',
        forecast: null,
        previous: '3.75%',
        actual: '4.00%',
        actualSource: 'Fed statement',
        actualFrom: 'Federal Reserve',
        surprise: null,
      },
    ])
  })
})

/* ---------- Sources ajoutées : BoE, DOL, ONS, BoJ, BCE, FRED/Census, BLS PPI/JOLTS, enquêtes ---------- */

describe('mise en forme calquée sur le calendrier', () => {
  it('préfixe, décimales et unité de la prévision (ou du précédent)', () => {
    expect(formatLike(1.25, ['<1.25%', '<1.00%'], { unit: '%' })).toBe('<1.25%')
    expect(formatLike(196, ['207K', '206K'], { unit: 'K' })).toBe('196K')
    expect(formatLike(27.8, ['8.3K', '-11.0K'], { unit: 'K' })).toBe('27.8K')
    expect(formatLike(7.227, [null, '7.18M'], { unit: 'M', digits: 1 })).toBe('7.23M')
    expect(formatLike(4, [null, null], { unit: '%', digits: 2 })).toBe('4.00%')
    // unité différente : précision par défaut
    expect(formatLike(47.8, ['3-0-6'], { unit: '', digits: 1 })).toBe('47.8')
  })
})

describe('Banque d’Angleterre', () => {
  const boeTs = Date.UTC(2026, 8, 17, 11, 0) // 12:00 Londres
  const event = {
    id: 'boe',
    kind: 'boe',
    category: 'decision',
    country: 'GBP',
    ts: boeTs,
    measures: [
      { name: 'Official Bank Rate', forecast: '3.75%', previous: '3.75%', actual: null },
      { name: 'MPC Official Bank Rate Votes', forecast: '3-0-6', previous: '3-0-6', actual: null },
      { name: 'Monetary Policy Summary', forecast: null, previous: null, actual: null },
    ],
  }
  const boe = { decisions: [{ date: '2026-09-17', url: 'https://www.bankofengland.co.uk/x', rate: 3.75, action: 'hold', votes: { hike: 3, cut: 0, hold: 6 } }] }

  it('taux et votes (hausse–baisse–maintien) du résumé officiel', () => {
    const e = attachActuals(event, { boe }, boeTs + 5 * 60_000)
    expect(e.measures.map((m) => m.actual)).toEqual(['3.75%', '3-0-6', null])
    expect(e.measures[0]).toMatchObject({ actualSource: 'Bank of England Monetary Policy Summary', actualFrom: 'Bank of England', surprise: 'inline' })
    expect(e.actualFrom).toBe('Bank of England')
    expect(e.measures[2].actualFrom).toBeUndefined()
  })
  it('résumé d’une autre réunion ou pas encore lu → en attente, éditeur annoncé', () => {
    const e = attachActuals(event, { boe: { decisions: [{ ...boe.decisions[0], date: '2026-07-30' }] } }, boeTs + 5 * 60_000)
    expect(e.actual).toBeNull()
    expect(e.actualFrom).toBe('Bank of England')
    expect(attachActuals(event, {}, boeTs + 60_000).measures[0]).toMatchObject({ actual: null, actualFrom: 'Bank of England' })
  })
})

describe('inscriptions hebdomadaires (DOL)', () => {
  const ts = Date.UTC(2026, 8, 17, 12, 30) // jeudi 8:30 New York
  const event = { id: 'claims', kind: 'claims', category: 'data', country: 'USD', ts, measures: [{ name: 'Unemployment Claims', forecast: '207K', previous: '206K', actual: null }] }

  it('semaine close le samedi précédent (jeudi, ou mercredi les semaines fériées)', () => {
    expect(claimsWeekEnding(ts)).toBe('2026-09-12')
    expect(claimsWeekEnding(Date.UTC(2026, 10, 25, 13, 30))).toBe('2026-11-21')
  })
  it('communiqué du jour, sinon FRED pour la semaine attendue, sinon rien', () => {
    const dol = { releases: { '2026-09-17': { weekEnding: '2026-09-12', initialClaims: 196000 } }, fred: [] }
    expect(attachActuals(event, { dol }, ts + 60_000).measures[0]).toMatchObject({ actual: '196K', actualSource: 'US Department of Labor', surprise: 'below' })
    const viaFred = attachActuals(event, { dol: { releases: {}, fred: [{ d: '2026-09-12', v: 196000 }] } }, ts + 60_000)
    expect(viaFred.measures[0]).toMatchObject({ actual: '196K', actualSource: 'FRED (US Department of Labor data)' })
    // communiqué de la semaine précédente (data.pdf pas encore remplacé) : ignoré
    const stale = { releases: { '2026-09-10': { weekEnding: '2026-09-05', initialClaims: 206000 } }, fred: [{ d: '2026-09-05', v: 206000 }] }
    expect(attachActuals(event, { dol: stale }, ts + 60_000).actual).toBeNull()
  })
})

describe('ONS (Royaume-Uni)', () => {
  const cpiTs = Date.UTC(2026, 8, 16, 6, 0) // 07:00 Londres
  const cpi = { id: 'ukcpi', kind: 'cpi', category: 'data', country: 'GBP', ts: cpiTs, measures: [{ name: 'CPI y/y', forecast: '3.1%', previous: '2.9%', actual: null }] }
  const series = (releaseDate, rows) => ({ releaseDate, rows })

  it('valeur du jour de publication seulement', () => {
    const ons = { series: { cpiYoY: series('2026-09-16', [{ d: '2026-07-01', v: 2.9 }, { d: '2026-08-01', v: 3.1 }]) } }
    expect(attachActuals(cpi, { ons }, cpiTs + 60_000).measures[0]).toMatchObject({ actual: '3.1%', actualSource: 'ONS', surprise: 'inline' })
    const old = { series: { cpiYoY: series('2026-08-19', [{ d: '2026-07-01', v: 2.9 }]) } }
    expect(attachActuals(cpi, { ons: old }, cpiTs + 60_000).actual).toBeNull()
  })
  it('variation du nombre de demandeurs (milliers)', () => {
    const labor = {
      id: 'uklab',
      kind: 'labor',
      category: 'data',
      country: 'GBP',
      ts: Date.UTC(2026, 8, 15, 6, 0),
      measures: [{ name: 'Claimant Count Change', forecast: '8.3K', previous: '-11.0K', actual: null }],
    }
    const ons = { series: { claimants: series('2026-09-15', [{ d: '2026-07-01', v: 1663.7 }, { d: '2026-08-01', v: 1691.5 }]) } }
    expect(attachActuals(labor, { ons }, labor.ts + 60_000).measures[0]).toMatchObject({ actual: '27.8K', surprise: 'above' })
  })
})

describe('banques centrales : BoJ et BCE', () => {
  it('BoJ : taux cible au format du calendrier (« <1.25% »)', () => {
    const ts = Date.UTC(2026, 8, 18, 2, 54)
    const e = attachActuals(
      { id: 'boj', kind: 'boj', category: 'decision', country: 'JPY', ts, measures: [{ name: 'BOJ Policy Rate', forecast: '<1.25%', previous: '<1.00%', actual: null }] },
      { boj: { decisions: [{ date: '2026-09-18', rate: 1.25 }] } },
      ts + 60 * 60_000,
    )
    expect(e.measures[0]).toMatchObject({ actual: '<1.25%', actualSource: 'Bank of Japan statement' })
  })
  it('BCE : taux de refinancement et de dépôt (jour de Francfort)', () => {
    const ts = Date.UTC(2026, 8, 10, 12, 15)
    const e = attachActuals(
      {
        id: 'ecb',
        kind: 'ecb',
        category: 'decision',
        country: 'EUR',
        ts,
        measures: [
          { name: 'Main Refinancing Rate', forecast: '2.65%', previous: '2.40%', actual: null },
          { name: 'Deposit Facility Rate', forecast: '2.50%', previous: '2.25%', actual: null },
        ],
      },
      { ecb: { decisions: [{ date: '2026-09-10', mro: 2.65, deposit: 2.5, mlf: 2.9 }] } },
      ts + 5 * 60_000,
    )
    expect(e.measures.map((m) => m.actual)).toEqual(['2.65%', '2.50%'])
  })
})

describe('autres publications US', () => {
  const ts = Date.UTC(2026, 8, 16, 12, 30)
  it('ventes au détail (Census via FRED) : variation mensuelle des niveaux', () => {
    const e = attachActuals(
      {
        id: 'retail',
        kind: 'retail',
        category: 'data',
        country: 'USD',
        ts,
        measures: [
          { name: 'Retail Sales m/m', forecast: '0.8%', previous: '-0.6%', actual: null },
          { name: 'Core Retail Sales m/m', forecast: '0.6%', previous: '-0.3%', actual: null },
        ],
      },
      { retail: { series: { total: [{ d: '2026-07-01', v: 764462 }, { d: '2026-08-01', v: 773947 }], exAuto: [{ d: '2026-07-01', v: 622897 }, { d: '2026-08-01', v: 631568 }] } } },
      ts + 60_000,
    )
    expect(e.measures.map((m) => m.actual)).toEqual(['1.2%', '1.4%'])
  })
  it('PPI (lignes « other ») et JOLTS (mois M publié en M+2, millions)', () => {
    const bls = {
      series: {
        ppiSa: [{ d: '2026-07-01', v: 150.0 }, { d: '2026-08-01', v: 150.45 }],
        jolts: [{ d: '2026-07-01', v: 7227 }],
      },
    }
    const ppi = attachActuals({ id: 'ppi', kind: 'other', category: 'data', country: 'USD', ts, measures: [{ name: 'PPI m/m', forecast: '0.2%', previous: '0.1%', actual: null }] }, { bls }, ts + 60_000)
    expect(ppi.measures[0]).toMatchObject({ actual: '0.3%', surprise: 'above' })
    const joltsTs = Date.UTC(2026, 8, 1, 14, 0)
    const jolts = attachActuals(
      { id: 'jolts', kind: 'jolts', category: 'data', country: 'USD', ts: joltsTs, measures: [{ name: 'JOLTS Job Openings', forecast: '7.20M', previous: '7.44M', actual: null }] },
      { bls },
      joltsTs + 60_000,
    )
    expect(jolts.measures[0].actual).toBe('7.23M')
  })
  it('enquêtes : Michigan (stade et mois), Conference Board, ISM du jour', () => {
    const umich = { readings: [{ stage: 'preliminary', month: '2026-09-01', sentiment: 47.8, inflation1y: 4.6 }] }
    const prelimTs = Date.UTC(2026, 8, 11, 14, 0)
    const prelim = { id: 'u', kind: 'sentiment', category: 'data', country: 'USD', ts: prelimTs, measures: [{ name: 'Prelim UoM Consumer Sentiment', forecast: '50.2', previous: '51.7', actual: null }] }
    expect(attachActuals(prelim, { umich }, prelimTs + 60_000).actual).toBe('47.8')
    const revised = { ...prelim, measures: [{ name: 'Revised UoM Consumer Sentiment', forecast: '47.9', previous: '47.8', actual: null }] }
    expect(attachActuals(revised, { umich }, prelimTs + 60_000).actual).toBeNull()
    const infl = { ...prelim, measures: [{ name: 'Prelim UoM Inflation Expectations', forecast: null, previous: '4.0%', actual: null }] }
    expect(attachActuals(infl, { umich }, prelimTs + 60_000).actual).toBe('4.6%')

    const cbTs = Date.UTC(2026, 8, 29, 14, 0)
    const cb = { id: 'cb', kind: 'other', category: 'data', country: 'USD', ts: cbTs, measures: [{ name: 'CB Consumer Confidence', forecast: '88.0', previous: '89.4', actual: null }] }
    expect(attachActuals(cb, { confboard: { readings: [{ month: '2026-08-01', index: 89.4 }] } }, cbTs + 60_000).actual).toBeNull()
    expect(attachActuals(cb, { confboard: { readings: [{ month: '2026-09-01', index: 91.2 }] } }, cbTs + 60_000).actual).toBe('91.2')

    const ismTs = Date.UTC(2026, 9, 1, 14, 0)
    const ism = { id: 'i', kind: 'ism', category: 'data', country: 'USD', ts: ismTs, measures: [{ name: 'ISM Manufacturing PMI', forecast: '54.2', previous: '54.6', actual: null }] }
    const items = [{ date: '2026-10-01', sector: 'manufacturing', pmi: 53, month: '2026-09-01' }, { date: '2026-09-01', sector: 'manufacturing', pmi: 54.6, month: '2026-08-01' }]
    expect(attachActuals(ism, { ism: items }, ismTs + 60_000).measures[0]).toMatchObject({ actual: '53.0', surprise: 'below' })
  })
})

describe('Eurostat : estimation rapide de l’IPCH', () => {
  it('jeu mis à jour le jour de l’événement seulement', () => {
    const ts = Date.UTC(2026, 9, 1, 9, 0) // 11:00 Francfort
    const event = {
      id: 'hicp',
      kind: 'cpi',
      category: 'data',
      country: 'EUR',
      ts,
      measures: [
        { name: 'CPI Flash Estimate y/y', forecast: '3.2%', previous: '3.3%', actual: null },
        { name: 'Core CPI Flash Estimate y/y', forecast: '2.4%', previous: '2.4%', actual: null },
      ],
    }
    const hicp = (updated) => ({ updated, flash: { total: [{ d: '2026-09-01', v: 3.4 }], core: [{ d: '2026-09-01', v: 2.5 }] }, final: { total: [], core: [] } })
    expect(attachActuals(event, { eurostat: hicp('2026-10-01') }, ts + 60_000).measures.map((m) => m.actual)).toEqual(['3.4%', '2.5%'])
    expect(attachActuals(event, { eurostat: hicp('2026-09-17') }, ts + 60_000).actual).toBeNull()
  })
})

describe('couverture : éditeur annoncé et familles à interroger', () => {
  const at = (ts, extra) => ({ id: extra.id, category: 'data', ts, measures: [], ...extra })
  const now = Date.UTC(2026, 8, 18, 12, 0)

  it('éditeur par règle ; aucune source ouverte → null', () => {
    const pmi = at(now - 60_000, { id: 'pmi', kind: 'pmi', country: 'GBP', measures: [{ name: 'Flash Manufacturing PMI', forecast: '47.5', previous: '47.0', actual: null }] })
    expect(actualSupport(pmi)).toBeNull()
    const future = attachActuals(pmi, {}, now)
    expect(future.actualFrom).toBeUndefined()
    const ukRetail = at(now + 3_600_000, { id: 'r', kind: 'retail', country: 'GBP', measures: [{ name: 'Retail Sales m/m', forecast: '-0.2%', previous: '-0.5%', actual: null }] })
    // événement à venir : éditeur annoncé, jamais de chiffre
    expect(attachActuals(ukRetail, {}, now)).toMatchObject({ actualFrom: 'ONS', measures: [{ actual: null, actualFrom: 'ONS' }] })
    expect(ruleFor(ukRetail, 'Retail Sales m/m').series).toEqual(['retailMoM'])
  })

  it('seuls les événements publiés déclenchent une famille ; séries ONS regroupées', () => {
    const events = [
      at(now - 3_600_000, { id: 'a', kind: 'cpi', country: 'GBP', measures: [{ name: 'CPI y/y' }, { name: 'Core CPI y/y' }] }),
      at(now - 7_200_000, { id: 'b', kind: 'labor', country: 'GBP', measures: [{ name: 'Claimant Count Change' }] }),
      at(now + 3_600_000, { id: 'c', kind: 'claims', country: 'USD', measures: [{ name: 'Unemployment Claims' }] }),
      at(now - 60_000, { id: 'd', kind: 'fomc', category: 'decision', country: 'USD', measures: [] }),
    ]
    const needs = actualNeeds(events, now)
    expect([...needs.keys()].sort()).toEqual(['fed', 'ons'])
    expect([...needs.get('ons').series].sort()).toEqual(['claimants', 'coreCpiYoY', 'cpiYoY'])
    expect(needs.get('ons').events.map((e) => e.id)).toEqual(['a', 'b'])
  })
})
