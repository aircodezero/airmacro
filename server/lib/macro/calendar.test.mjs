import { describe, it, expect } from 'vitest'
import {
  normalizeFfRow,
  classify,
  isCurated,
  groupReleases,
  mergeWithReference,
  buildCalendarEvents,
  parseFfNumber,
  surprise,
} from './calendar.mjs'
import { referenceEvents } from './reference.mjs'

// Lignes réelles du flux FairEconomy (semaine du 13/09/2026), plus quelques cas limites.
const FEED = [
  { title: 'CPI m/m', country: 'CAD', date: '2026-09-14T08:30:00-04:00', impact: 'High', forecast: '-0.1%', previous: '0.5%' },
  { title: 'ECB President Lagarde Speaks', country: 'EUR', date: '2026-09-14T11:15:00-04:00', impact: 'Medium', forecast: '', previous: '' },
  { title: 'Claimant Count Change', country: 'GBP', date: '2026-09-15T02:00:00-04:00', impact: 'High', forecast: '8.3K', previous: '-11.0K' },
  { title: 'Treasury Sec Bessent Speaks', country: 'USD', date: '2026-09-15T10:00:00-04:00', impact: 'Medium', forecast: '', previous: '' },
  { title: 'Core Retail Sales m/m', country: 'USD', date: '2026-09-16T08:30:00-04:00', impact: 'Medium', forecast: '0.6%', previous: '-0.3%' },
  { title: 'Retail Sales m/m', country: 'USD', date: '2026-09-16T08:30:00-04:00', impact: 'Medium', forecast: '0.8%', previous: '-0.6%' },
  { title: 'Federal Funds Rate', country: 'USD', date: '2026-09-16T14:00:00-04:00', impact: 'High', forecast: '4.00%', previous: '3.75%' },
  { title: 'FOMC Economic Projections', country: 'USD', date: '2026-09-16T14:00:00-04:00', impact: 'High', forecast: '', previous: '' },
  { title: 'FOMC Statement', country: 'USD', date: '2026-09-16T14:00:00-04:00', impact: 'High', forecast: '', previous: '' },
  { title: 'FOMC Statement', country: 'USD', date: '2026-09-16T14:00:00-04:00', impact: 'High', forecast: '', previous: '' }, // doublon
  { title: 'FOMC Press Conference', country: 'USD', date: '2026-09-16T14:30:00-04:00', impact: 'High', forecast: '', previous: '' },
  { title: 'GDP q/q', country: 'NZD', date: '2026-09-16T18:45:00-04:00', impact: 'High', forecast: '0.4%', previous: '0.5%' },
  { title: 'Philly Fed Manufacturing Index', country: 'USD', date: '2026-09-17T08:30:00-04:00', impact: 'Medium', forecast: '31.3', previous: '47.4' },
  { title: 'Unemployment Claims', country: 'USD', date: '2026-09-17T08:30:00-04:00', impact: 'Medium', forecast: '207K', previous: '206K' },
  { title: 'BOJ Policy Rate', country: 'JPY', date: '2026-09-17T22:30:00-04:00', impact: 'High', forecast: '<1.25%', previous: '<1.00%' },
  { title: 'Monetary Policy Statement', country: 'JPY', date: '2026-09-17T22:30:00-04:00', impact: 'High', forecast: '', previous: '' },
  { title: 'Broken date', country: 'USD', date: 'Tentative', impact: 'High', forecast: '', previous: '' },
  { title: 'Outside window', country: 'USD', date: '2026-10-05T08:30:00-04:00', impact: 'High', forecast: '', previous: '' },
]

const WEEK_START = Date.UTC(2026, 8, 13, 4, 0)
const WEEK_END = WEEK_START + 14 * 86_400_000

describe('normalizeFfRow', () => {
  it('convertit l’heure de New York en UTC et nettoie les champs vides', () => {
    expect(normalizeFfRow(FEED[6])).toEqual({
      title: 'Federal Funds Rate',
      country: 'USD',
      ts: Date.UTC(2026, 8, 16, 18, 0),
      impact: 'High',
      forecast: '4.00%',
      previous: '3.75%',
      actual: null,
    })
    expect(normalizeFfRow(FEED[1]).forecast).toBeNull()
  })
  it('rejette les lignes sans date exploitable ou sans titre', () => {
    expect(normalizeFfRow(FEED[16])).toBeNull()
    expect(normalizeFfRow({ date: '2026-09-16T14:00:00-04:00' })).toBeNull()
    expect(normalizeFfRow(null)).toBeNull()
  })
  it('impact inconnu → Low', () => {
    expect(normalizeFfRow({ ...FEED[6], impact: 'Non-Economic' }).impact).toBe('Low')
  })
})

describe('classify', () => {
  it.each([
    ['Federal Funds Rate', 'USD', 'fomc', 'decision'],
    ['FOMC Press Conference', 'USD', 'fomc', 'presser'],
    ['Monetary Policy Statement', 'JPY', 'boj', 'decision'],
    ['Monetary Policy Statement', 'EUR', 'ecb', 'decision'],
    ['Official Bank Rate', 'GBP', 'boe', 'decision'],
    ['Core PCE Price Index m/m', 'USD', 'pce', 'data'],
    ['Tokyo Core CPI y/y', 'JPY', 'cpi', 'data'],
    ['Non-Farm Employment Change', 'USD', 'nfp', 'data'],
    ['Unemployment Rate', 'GBP', 'labor', 'data'],
    ['Fed Chair Warsh Speaks', 'USD', 'speech', 'speech'],
    ['Advance GDP q/q', 'USD', 'gdp', 'data'],
    ['ISM Manufacturing PMI', 'USD', 'ism', 'data'],
    ['PPI m/m', 'USD', 'other', 'data'],
  ])('%s (%s) → %s/%s', (title, country, kind, category) => {
    expect(classify(title, country)).toEqual({ kind, category })
  })
})

describe('curation', () => {
  const row = (i) => normalizeFfRow(FEED[i])
  it('High des 4 grandes zones uniquement', () => {
    expect(isCurated(row(0))).toBe(false) // CAD
    expect(isCurated(row(11))).toBe(false) // NZD
    expect(isCurated(row(2))).toBe(true) // GBP
  })
  it('liste blanche Medium', () => {
    expect(isCurated(row(1))).toBe(true) // Lagarde
    expect(isCurated(row(5))).toBe(true) // US retail sales
    expect(isCurated(row(13))).toBe(true) // jobless claims
    expect(isCurated(row(3))).toBe(false) // Bessent
    expect(isCurated(row(12))).toBe(false) // Philly Fed
    expect(isCurated({ ...row(12), title: 'JOLTS Job Openings' })).toBe(true)
    expect(isCurated({ ...row(12), title: 'Prelim UoM Consumer Sentiment' })).toBe(true)
  })
  it('Low jamais retenu', () => {
    expect(isCurated({ ...row(6), impact: 'Low' })).toBe(false)
  })
})

describe('groupReleases', () => {
  it('une décision FOMC = un événement, taux directeur en tête', () => {
    const rows = [7, 8, 6].map((i) => normalizeFfRow(FEED[i]))
    const [event] = groupReleases(rows)
    expect(event.title).toBe('FOMC rate decision')
    expect(event.measures.map((m) => m.name)).toEqual(['Federal Funds Rate', 'FOMC Economic Projections', 'FOMC Statement'])
    expect(event.forecast).toBe('4.00%')
    expect(event.previous).toBe('3.75%')
  })
  it('IPC US : trois lignes regroupées, glissement annuel en tête', () => {
    const base = { country: 'USD', date: '2026-10-14T08:30:00-04:00', impact: 'High', previous: '0.3%' }
    const rows = [
      { ...base, title: 'Core CPI m/m', forecast: '0.3%' },
      { ...base, title: 'CPI m/m', forecast: '0.2%' },
      { ...base, title: 'CPI y/y', forecast: '3.3%', previous: '3.4%' },
    ].map(normalizeFfRow)
    const events = groupReleases(rows)
    expect(events).toHaveLength(1)
    expect(events[0].title).toBe('US CPI')
    expect(events[0].measures.map((m) => m.name)).toEqual(['CPI y/y', 'Core CPI m/m', 'CPI m/m'])
    expect(events[0].forecast).toBe('3.3%')
  })
  it('allemand et zone euro ne se mélangent pas', () => {
    const base = { country: 'EUR', date: '2026-09-30T08:00:00-04:00', impact: 'High', forecast: '', previous: '' }
    const events = groupReleases([
      normalizeFfRow({ ...base, title: 'German Prelim CPI m/m' }),
      normalizeFfRow({ ...base, title: 'CPI Flash Estimate y/y' }),
    ])
    expect(events.map((e) => e.title).sort()).toEqual(['Euro area CPI (flash)', 'Germany CPI'])
    // identifiants distincts (clés React, fiche détaillée, explication IA)
    expect(new Set(events.map((e) => e.id)).size).toBe(2)
  })
  it('discours : jamais regroupés', () => {
    const base = { country: 'USD', date: '2026-09-18T10:00:00-04:00', impact: 'High', forecast: '', previous: '' }
    const events = groupReleases([
      normalizeFfRow({ ...base, title: 'Fed Chair Warsh Speaks' }),
      normalizeFfRow({ ...base, title: 'Fed Chair Warsh Testifies' }),
    ])
    expect(events).toHaveLength(2)
  })
})

describe('fusion avec la référence', () => {
  const refs = referenceEvents(WEEK_START, WEEK_END)

  it('pipeline complet sur la semaine du 13/09/2026', () => {
    const events = buildCalendarEvents({ rawRows: FEED, refEvents: refs, fromTs: WEEK_START, toTs: WEEK_END })
    const ids = events.map((e) => e.id)
    // référence FOMC confirmée par le flux : identifiant stable, chiffres du flux
    const decision = events.find((e) => e.id === 'fomc-2026-09-16-decision')
    expect(decision).toMatchObject({ isReference: false, forecast: '4.00%', previous: '3.75%', ts: Date.UTC(2026, 8, 16, 18, 0) })
    expect(decision.sources).toEqual(['faireconomy', 'reference'])
    expect(decision.meeting).toMatchObject({ bank: 'Fed', sep: true, start: '2026-09-15', end: '2026-09-16' })
    expect(events.find((e) => e.id === 'fomc-2026-09-16-presser')?.isReference).toBe(false)
    // jour 1 : référence seule, marqueur d’information
    expect(events.find((e) => e.id === 'fomc-2026-09-15-day1')).toMatchObject({ isReference: true, allDay: true, impact: 'Info' })
    // doublon supprimé : une seule décision FOMC, 3 mesures
    expect(events.filter((e) => e.kind === 'fomc' && e.category === 'decision')).toHaveLength(1)
    expect(decision.measures).toHaveLength(3)
    // curation et fenêtre
    expect(events.some((e) => e.country === 'CAD' || e.country === 'NZD')).toBe(false)
    expect(events.some((e) => e.title.includes('Outside window'))).toBe(false)
    expect(ids.filter((id) => id.includes('boj'))).toHaveLength(1)
    // tri chronologique
    expect(events.map((e) => e.ts)).toEqual([...events.map((e) => e.ts)].sort((a, b) => a - b))
  })

  it('flux coupé : le calendrier garde la réunion FOMC', () => {
    const events = buildCalendarEvents({ rawRows: [], refEvents: refs, fromTs: WEEK_START, toTs: WEEK_END })
    expect(events.map((e) => e.id)).toEqual(['fomc-2026-09-15-day1', 'fomc-2026-09-16-decision', 'fomc-2026-09-16-presser'])
    expect(events[1].isReference).toBe(true)
  })

  it('un événement live hors tolérance ne fusionne pas', () => {
    const live = [{ id: 'x', kind: 'fomc', category: 'decision', ts: refs[1].ts + 5 * 3_600_000, measures: [] }]
    const merged = mergeWithReference(live, [refs[1]])
    expect(merged.map((e) => e.id)).toEqual(['fomc-2026-09-16-decision', 'x'])
  })
})

describe('nombres du flux et surprise', () => {
  it('parse', () => {
    expect(parseFfNumber('0.3%')).toEqual({ value: 0.3, unit: '%' })
    expect(parseFfNumber('-11.0K')).toEqual({ value: -11, unit: 'K' })
    expect(parseFfNumber('480B')).toEqual({ value: 480, unit: 'B' })
    expect(parseFfNumber('3-0-6')).toBeNull()
    expect(parseFfNumber('<1.25%')).toBeNull()
    expect(parseFfNumber(null)).toBeNull()
  })
  it('surprise sans jugement, unités identiques requises', () => {
    expect(surprise('0.4%', '0.3%')).toBe('above')
    expect(surprise('162K', '180K')).toBe('below')
    expect(surprise('4.00%', '4.00%')).toBe('inline')
    expect(surprise('162K', '0.3%')).toBeNull()
    expect(surprise(null, '0.3%')).toBeNull()
  })
})
