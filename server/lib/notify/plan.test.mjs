import { describe, it, expect } from 'vitest'
import { buildMessage, hasOfficialActual, localTime, planNotifications, testMessage, validTimeZone } from './plan.mjs'

const MIN = 60_000
const FOMC_TS = Date.UTC(2026, 8, 16, 18, 0) // 16/09/2026 14:00 New York
const CPI_TS = Date.UTC(2026, 9, 14, 12, 30)
const BOE_TS = Date.UTC(2026, 8, 17, 11, 0)

const fomc = {
  id: 'fomc-2026-09-16-decision',
  kind: 'fomc',
  category: 'decision',
  title: 'FOMC rate decision',
  country: 'USD',
  ts: FOMC_TS,
  impact: 'High',
  allDay: false,
  actual: null,
  measures: [
    { name: 'Federal Funds Rate', forecast: '4.00%', previous: '3.75%', actual: null },
    { name: 'FOMC Statement', forecast: null, previous: null, actual: null },
  ],
  meeting: { bank: 'Fed', sep: true },
}
const fomcDecided = {
  ...fomc,
  actual: '4.00%',
  measures: [{ ...fomc.measures[0], actual: '4.00%', actualSource: 'Fed statement', surprise: 'inline' }, fomc.measures[1]],
  decision: { action: 'hike', lower: 3.75, upper: 4, changePts: 0.25, vote: { for: 11, against: 1 }, url: 'https://www.federalreserve.gov/x' },
}
const presser = { ...fomc, id: 'fomc-2026-09-16-presser', category: 'presser', title: 'FOMC press conference', ts: FOMC_TS + 30 * MIN, measures: [] }
const day1 = { ...fomc, id: 'fomc-2026-09-15-day1', category: 'meeting', impact: 'Info', allDay: true, ts: FOMC_TS - 86_400_000 }
const cpi = {
  id: 'ff-usd-cpi-data-2026-10-14',
  kind: 'cpi',
  category: 'data',
  title: 'US CPI',
  country: 'USD',
  ts: CPI_TS,
  impact: 'High',
  allDay: false,
  actual: null,
  measures: [
    { name: 'CPI m/m', forecast: '0.3%', previous: '0.2%', actual: null },
    { name: 'Core CPI m/m', forecast: '0.3%', previous: '0.3%', actual: null },
  ],
}
const cpiOut = {
  ...cpi,
  actual: '0.4%',
  measures: [
    { ...cpi.measures[0], actual: '0.4%', actualSource: 'BLS', surprise: 'above' },
    { ...cpi.measures[1], actual: '0.3%', actualSource: 'BLS', surprise: 'inline' },
  ],
}
const boe = {
  id: 'ff-gbp-boe-decision-2026-09-17',
  kind: 'boe',
  category: 'decision',
  title: 'BoE rate decision',
  country: 'GBP',
  ts: BOE_TS,
  impact: 'High',
  allDay: false,
  actual: null,
  measures: [{ name: 'Official Bank Rate', forecast: '4.00%', previous: '4.00%', actual: null }],
}
const medium = { ...cpi, id: 'medium', impact: 'Medium' }
// PMI S&P Global : aucune source ouverte pour le chiffre
const pmi = {
  id: 'ff-gbp-pmi-flash-manufacturing-pmi',
  kind: 'pmi',
  category: 'data',
  title: 'Flash Manufacturing PMI',
  country: 'GBP',
  ts: BOE_TS,
  impact: 'High',
  allDay: false,
  actual: null,
  measures: [{ name: 'Flash Manufacturing PMI', forecast: '47.5', previous: '47.0', actual: null }],
}

const keys = (items) => items.map((i) => i.key)

describe('planNotifications', () => {
  it('rappel dans les 15 min précédant un événement High, jamais pour Medium ni « toute la journée »', () => {
    expect(keys(planNotifications([fomc, medium, day1], FOMC_TS - 14 * MIN))).toEqual(['reminder:fomc-2026-09-16-decision'])
    expect(planNotifications([fomc], FOMC_TS - 16 * MIN)).toEqual([])
    // moins d'une minute avant : trop tard pour un rappel
    expect(planNotifications([fomc], FOMC_TS - 30_000)).toEqual([])
    expect(planNotifications([{ ...medium, ts: CPI_TS }], CPI_TS - 10 * MIN)).toEqual([])
  })

  it('ne renvoie pas une alerte déjà envoyée', () => {
    const sent = { 'reminder:fomc-2026-09-16-decision': FOMC_TS - 15 * MIN }
    expect(planNotifications([fomc], FOMC_TS - 14 * MIN, sent)).toEqual([])
    // clé héritée d'Object.prototype : sans effet
    expect(keys(planNotifications([fomc], FOMC_TS - 14 * MIN, { constructor: 1 }))).toHaveLength(1)
  })

  it('FOMC : décision officielle dès qu’elle est lue, sinon avis d’attente après 20 min', () => {
    expect(planNotifications([fomc], FOMC_TS + 5 * MIN)).toEqual([])
    expect(keys(planNotifications([fomc], FOMC_TS + 21 * MIN))).toEqual(['pending:fomc-2026-09-16-decision'])
    expect(keys(planNotifications([fomcDecided], FOMC_TS + 2 * MIN))).toEqual(['actual:fomc-2026-09-16-decision'])
    // l'avis d'attente n'empêche pas l'envoi du chiffre ensuite
    const sent = { 'pending:fomc-2026-09-16-decision': FOMC_TS + 21 * MIN }
    expect(keys(planNotifications([fomcDecided], FOMC_TS + 30 * MIN, sent))).toEqual(['actual:fomc-2026-09-16-decision'])
  })

  it('pas d’alerte de publication pour une conférence de presse ni au-delà de 3 h', () => {
    expect(planNotifications([presser], presser.ts + MIN)).toEqual([])
    expect(planNotifications([fomcDecided], FOMC_TS + 3 * 60 * MIN + MIN)).toEqual([])
  })

  it('événement sans source officielle : « publié » immédiatement', () => {
    expect(keys(planNotifications([pmi], BOE_TS))).toEqual(['released:ff-gbp-pmi-flash-manufacturing-pmi'])
    expect(hasOfficialActual(pmi)).toBe(false)
    expect(hasOfficialActual(cpi)).toBe(true)
    expect(hasOfficialActual({ ...cpi, country: 'EUR' })).toBe(false)
    expect(hasOfficialActual(presser)).toBe(false)
  })

  it('BoE : chiffre lu dans le Monetary Policy Summary, sinon avis d’attente après 20 min', () => {
    expect(hasOfficialActual(boe)).toBe(true)
    expect(planNotifications([boe], BOE_TS + 5 * MIN)).toEqual([])
    expect(keys(planNotifications([boe], BOE_TS + 21 * MIN))).toEqual(['pending:ff-gbp-boe-decision-2026-09-17'])
    const decided = { ...boe, actual: '4.00%', measures: [{ ...boe.measures[0], actual: '4.00%', actualSource: 'Bank of England Monetary Policy Summary' }] }
    expect(keys(planNotifications([decided], BOE_TS + 2 * MIN))).toEqual(['actual:ff-gbp-boe-decision-2026-09-17'])
    const m = buildMessage({ type: 'actual', event: decided }, { now: BOE_TS + 2 * MIN })
    expect(m.title).toBe('BoE rate decision: Official Bank Rate 4.00%')
    expect(m.body).toBe('Official Bank Rate 4.00% (forecast 4.00% · previous 4.00%)\nSource: Bank of England Monetary Policy Summary')
  })

  it('pas de rattrapage des publications antérieures à l’activation', () => {
    expect(planNotifications([pmi], BOE_TS + 10 * MIN, {}, BOE_TS + MIN)).toEqual([])
    expect(keys(planNotifications([pmi], BOE_TS + 10 * MIN, {}, BOE_TS - MIN))).toHaveLength(1)
  })

  it('trie par heure d’événement', () => {
    const items = planNotifications([presser, fomcDecided], FOMC_TS + 20 * MIN)
    expect(keys(items)).toEqual(['actual:fomc-2026-09-16-decision', 'reminder:fomc-2026-09-16-presser'])
  })
})

describe('buildMessage', () => {
  it('rappel : heure dans le fuseau du destinataire et consensus', () => {
    const now = FOMC_TS - 15 * MIN
    const m = buildMessage({ type: 'reminder', event: fomc }, { timeZone: 'Europe/Paris', now })
    expect(m.title).toBe('In 15 min: FOMC rate decision')
    expect(m.body).toBe('US · high impact · 8:00 PM (UTC+2)\nFederal Funds Rate: forecast 4.00% · previous 3.75%\nWith the Summary of Economic Projections.')
    expect(m.ttlSec).toBe(15 * 60)
    expect(m.path).toBe('/?event=fomc-2026-09-16-decision')
    const ny = buildMessage({ type: 'reminder', event: fomc }, { timeZone: 'America/New_York', now })
    expect(ny.body).toMatch(/2:00 PM \(UTC−4\)/)
  })

  it('conférence de presse : pas de mention des projections', () => {
    const m = buildMessage({ type: 'reminder', event: presser }, { timeZone: 'UTC', now: presser.ts - 10 * MIN })
    expect(m.body).toBe('US · high impact · 6:30 PM (UTC)')
  })

  it('FOMC : décision, vote et source', () => {
    const m = buildMessage({ type: 'actual', event: fomcDecided }, { now: FOMC_TS + MIN })
    expect(m.title).toBe('FOMC: rates raised by 25 bp to 3.75%–4.00%')
    expect(m.body).toBe('Fed funds 4.00% · forecast 4.00% · previous 3.75% · in line with forecast\nVote 11–1\nSource: Federal Reserve statement')
    expect(m.urgency).toBe('high')
    const hold = buildMessage(
      { type: 'actual', event: { ...fomcDecided, decision: { ...fomcDecided.decision, action: 'hold', lower: 3.5, upper: 3.75, changePts: 0, vote: null } } },
      { now: FOMC_TS + MIN },
    )
    expect(hold.title).toBe('FOMC: rates held at 3.50%–3.75%')
    const cut = buildMessage(
      { type: 'actual', event: { ...fomcDecided, decision: { ...fomcDecided.decision, action: 'cut', lower: 3.25, upper: 3.5, changePts: -0.5 } } },
      { now: FOMC_TS + MIN },
    )
    expect(cut.title).toBe('FOMC: rates cut by 50 bp to 3.25%–3.50%')
  })

  it('statistique : chiffre publié, écart au consensus et source', () => {
    const m = buildMessage({ type: 'actual', event: cpiOut }, { now: CPI_TS + MIN })
    expect(m.title).toBe('US CPI: CPI m/m 0.4%')
    expect(m.body).toBe(
      'CPI m/m 0.4% (forecast 0.3% · previous 0.2%) — above forecast\nCore CPI m/m 0.3% (forecast 0.3% · previous 0.3%) — in line with forecast\nSource: BLS',
    )
  })

  it('attente et publication sans chiffre', () => {
    const wait = buildMessage({ type: 'pending', event: cpi }, { now: CPI_TS + 21 * MIN })
    expect(wait.title).toBe('US CPI released')
    expect(wait.body).toMatch(/^The official figures aren’t available yet/)
    const waitFomc = buildMessage({ type: 'pending', event: fomc }, { now: FOMC_TS + 21 * MIN })
    expect(waitFomc.title).toBe('FOMC rate decision announced')
    const released = buildMessage({ type: 'released', event: boe }, { now: BOE_TS })
    expect(released.title).toBe('BoE rate decision announced')
    expect(released.body).toBe(
      'Official Bank Rate: forecast 4.00% · previous 4.00%\nThe actual figure is not available from AirMacro’s free sources.',
    )
  })

  it('étiquette bornée à 64 caractères (remplacement de notification)', () => {
    const long = { ...boe, id: `ff-${'x'.repeat(80)}` }
    expect(buildMessage({ type: 'released', event: long }, { now: BOE_TS }).tag).toHaveLength(64)
  })

  it('notification de test', () => {
    expect(testMessage({ title: 'FOMC rate decision', ts: FOMC_TS }, { timeZone: 'Europe/Paris' }).body).toBe(
      'Next high-impact event: FOMC rate decision at 8:00 PM (UTC+2).',
    )
    expect(testMessage(null).body).toMatch(/No high-impact event/)
  })
})

describe('fuseaux', () => {
  it('fuseau invalide → UTC', () => {
    expect(validTimeZone('Europe/Paris')).toBe('Europe/Paris')
    expect(validTimeZone('Mars/Olympus')).toBe('UTC')
    expect(validTimeZone(42)).toBe('UTC')
    expect(localTime(FOMC_TS, 'Nope/Nope')).toBe('6:00 PM (UTC)')
  })
})
