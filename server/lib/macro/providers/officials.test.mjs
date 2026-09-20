import { describe, it, expect } from 'vitest'
import { parseClaimsRelease } from './dol.mjs'
import { formatBoeVotes, isSummaryUrl, parseBoeRss, parseBoeSummary, summaryUrlFor } from './boe.mjs'
import { onsPeriod, parseOnsSeries } from './ons.mjs'
import { parseBojRss, parseBojStatement, statementUrlFor } from './boj.mjs'
import { decisionUrl, parseEcbDecision, parseEcbRss } from './ecbpress.mjs'
import { parseConferenceBoard, parseMichigan } from './surveys.mjs'
import { parseIsmHeadlines } from './ism.mjs'
import { parseHicpFirstReleases } from './eurostat.mjs'

/* Extraits réels (communiqués du 17/09/2026 et antérieurs), coupures de mots comprises. */

describe('DOL — inscriptions hebdomadaires', () => {
  const text = `1 News Release 8:30 A.M. (Eastern) Thursday, September 17, 2026
UNEMPLOYMENT INSURANCE WEEKLY CLAIMS
In the week ending September 12, the advance figure for seasonally adjusted
initial claims
was 196,000, a decrease of
10,000 from the previous week’s unrevised level of 206,000. The 4
-
week moving average was 203,250`

  it('chiffre advance, semaine couverte et date du communiqué', () => {
    expect(parseClaimsRelease(text)).toEqual({ releaseDate: '2026-09-17', weekEnding: '2026-09-12', initialClaims: 196000, previousLevel: 206000 })
  })
  it('semaine de décembre publiée en janvier ; « unchanged »', () => {
    const jan = 'Thursday, January 7, 2027 In the week ending January 2, the advance figure for seasonally adjusted initial claims was 211,000, unchanged from the previous week'
    expect(parseClaimsRelease(jan)).toMatchObject({ releaseDate: '2027-01-07', weekEnding: '2027-01-02', initialClaims: 211000, previousLevel: null })
    const dec = 'Wednesday, December 31, 2025 In the week ending December 27, the advance figure for seasonally adjusted initial claims was 199,000, a decrease of 16,000'
    expect(parseClaimsRelease(dec)).toMatchObject({ weekEnding: '2025-12-27' })
    const newYear = 'Thursday, January 1, 2026 In the week ending December 27, the advance figure for seasonally adjusted initial claims was 199,000'
    expect(parseClaimsRelease(newYear)).toMatchObject({ releaseDate: '2026-01-01', weekEnding: '2025-12-27' })
  })
  it('page d’erreur ou texte sans phrase-titre → null', () => {
    expect(parseClaimsRelease('Access Denied')).toBeNull()
  })
})

describe('Banque d’Angleterre — Monetary Policy Summary', () => {
  const summary = (sentence) => `Published on 17 September 2026 Monetary Policy Summary, September 2026 At its meeting ending on 16 September 2026, the Monetary Policy Committee (MPC) ${sentence} Protracted conflict in the Middle East…`

  it('maintien 6–3, trois voix pour une hausse → « 3-0-6 » (hausse–baisse–maintien)', () => {
    const r = parseBoeSummary(summary('voted by a majority of 6–3 to maintain Bank Rate at 3.75%. Three members voted to increase Bank Rate by 0.25 percentage points, to 4%.'))
    expect(r).toEqual({ rate: 3.75, action: 'hold', votes: { hike: 3, cut: 0, hold: 6 }, published: '2026-09-17' })
    expect(formatBoeVotes(r.votes)).toBe('3-0-6')
  })
  it('baisse 5–4, puis minorités multiples', () => {
    expect(parseBoeSummary(summary('voted by a majority of 5–4 to reduce Bank Rate by 0.25 percentage points, to 3.75%. Four members voted to maintain Bank Rate at 4%.'))).toMatchObject({
      rate: 3.75,
      action: 'cut',
      votes: { hike: 0, cut: 5, hold: 4 },
    })
    const may = parseBoeSummary(
      summary('voted by a majority of 5–4 to reduce Bank Rate by 0.25 percentage points, to 4.25%. Two members voted to reduce Bank Rate by 0.5 percentage points, to 4%, and two members voted to maintain Bank Rate at 4.5%.'),
    )
    expect(formatBoeVotes(may.votes)).toBe('0-7-2')
  })
  it('unanimité et décompte incohérent', () => {
    expect(parseBoeSummary(summary('voted unanimously to maintain Bank Rate at 5.25%.'))).toMatchObject({ rate: 5.25, votes: { hike: 0, cut: 0, hold: 9 } })
    // minorité détaillée introuvable : taux publié, votes non devinés
    expect(parseBoeSummary(summary('voted by a majority of 6–3 to maintain Bank Rate at 3.75%. The minority preferred otherwise.'))).toMatchObject({ rate: 3.75, votes: null })
  })
  it('flux RSS et adresse mensuelle', () => {
    const xml = `<rss><channel>
<item><link>https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/2026/september-2026</link><title>Bank rate maintained at 3.75% - September 2026 Monetary Policy Summary and Minutes</title><pubDate>Thu, 17 Sep 2026 12:00:00 +0100</pubDate></item>
<item><link>https://www.bankofengland.co.uk/news/2026/september/mpc-dates-for-2027</link><title>Monetary Policy Committee dates for 2027</title><pubDate>Thu, 17 Sep 2026 14:30:00 +0100</pubDate></item>
</channel></rss>`
    expect(parseBoeRss(xml)).toEqual([
      {
        title: 'Bank rate maintained at 3.75% - September 2026 Monetary Policy Summary and Minutes',
        url: 'https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/2026/september-2026',
        date: '2026-09-17',
      },
    ])
    expect(summaryUrlFor(Date.UTC(2026, 10, 5, 12))).toBe('https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/2026/november-2026')
    expect(isSummaryUrl('https://evil.example/monetary-policy-summary-and-minutes/2026/september-2026')).toBe(false)
  })
})

describe('ONS — séries chronologiques', () => {
  it('périodes mensuelles et trimestrielles', () => {
    expect(onsPeriod('2026 AUG')).toBe('2026-08-01')
    expect(onsPeriod('2026 Q2')).toBe('2026-04-01')
    expect(onsPeriod('2026')).toBeNull()
  })
  it('date de publication à Londres, mensuel prioritaire, valeurs non numériques ignorées', () => {
    const s = parseOnsSeries({
      description: { title: 'CPI ANNUAL RATE 00: ALL ITEMS 2015=100', releaseDate: '2026-09-15T23:00:00.000Z' },
      months: [
        { date: '2026 JUL', value: '2.9' },
        { date: '2026 AUG', value: '3.1' },
        { date: '2026 SEP', value: '' },
      ],
      quarters: [{ date: '2026 Q2', value: '2.7' }],
    })
    expect(s.releaseDate).toBe('2026-09-16')
    expect(s.rows).toEqual([
      { d: '2026-07-01', v: 2.9 },
      { d: '2026-08-01', v: 3.1 },
    ])
    const q = parseOnsSeries({ description: { releaseDate: '2026-08-12T23:00:00.000Z' }, months: [], quarters: [{ date: '2026 Q2', value: '0.4' }] })
    expect(q.rows).toEqual([{ d: '2026-04-01', v: 0.4 }])
    expect(() => parseOnsSeries({ description: {}, months: [] })).toThrow()
  })
})

describe('Banque du Japon — communiqué', () => {
  const text = `1 September 1 8 , 202 6 Bank of Japan Statement on Monetary Policy 1. At the Monetary Policy Meeting held today, the Policy Board of the Bank of Japan decided, by a 7 - 2 majority vote, to set the following guideline for money market operations for the intermeeting period : The Bank will encourage the uncollateralized overnight call rate to remain at around 1. 25 percent.`
  it('taux cible, date et vote (texte PDF découpé)', () => {
    expect(parseBojStatement(text)).toEqual({ date: '2026-09-18', dates: ['2026-09-18'], rate: 1.25, vote: { for: 7, against: 2 } })
    expect(parseBojStatement('The Bank will encourage the uncollateralized overnight call rate to remain at around 0.5 percent. decided, by a unanimous vote')).toMatchObject({ rate: 0.5, vote: { for: 9, against: 0 } })
    expect(parseBojStatement('Outlook for Economic Activity and Prices')).toBeNull()
  })
  it('flux « What’s New » et adresse prévisible', () => {
    const xml = `<rss><channel>
<item><title>Change in the Guideline for Money Market Operations</title><link>http://www.boj.or.jp/en/mopo/mpmdeci/mpr_2026/k260918a.pdf</link><pubDate>Fri, 18 Sep 2026 12:40:00 +0900</pubDate></item>
<item><title>(Reference) Change in the Guideline</title><link>http://www.boj.or.jp/en/mopo/mpmdeci/mpr_2026/k260918b.pdf</link><pubDate>Fri, 18 Sep 2026 11:54:00 +0900</pubDate></item>
</channel></rss>`
    expect(parseBojRss(xml)).toEqual([
      { title: 'Change in the Guideline for Money Market Operations', url: 'https://www.boj.or.jp/en/mopo/mpmdeci/mpr_2026/k260918a.pdf', date: '2026-09-18' },
    ])
    expect(statementUrlFor('2026-10-30')).toBe('https://www.boj.or.jp/en/mopo/mpmdeci/mpr_2026/k261030a.pdf')
  })
})

describe('BCE — communiqué de décision', () => {
  it('ordre actuel et ancien ordre des facilités', () => {
    expect(
      parseEcbDecision('Accordingly, the interest rates on the deposit facility, the main refinancing operations and the marginal lending facility will be increased to 2.50%, 2.65% and 2.90% respectively, with effect from 16 September 2026.'),
    ).toEqual({ deposit: 2.5, mro: 2.65, mlf: 2.9 })
    expect(
      parseEcbDecision('the interest rate on the main refinancing operations and the interest rates on the marginal lending facility and the deposit facility will remain unchanged at 4.50%, 4.75% and 4.00% respectively.'),
    ).toEqual({ mro: 4.5, mlf: 4.75, deposit: 4 })
    expect(parseEcbDecision('The Governing Council today decided to keep rates unchanged.')).toBeNull()
  })
  it('flux RSS : double barre normalisée, seuls les communiqués de décision', () => {
    const xml = `<rss><channel>
<item><title>Monetary policy decisions</title><link>https://www.ecb.europa.eu//press/pr/date/2026/html/ecb.mp260910~314e508016.en.html</link><pubDate>Thu, 10 Sep 2026 14:15:00 +0200</pubDate></item>
<item><title>ECB wage tracker</title><link>https://www.ecb.europa.eu//press/pr/date/2026/html/ecb.pr260916~7bc58ebef4.en.html</link><pubDate>Wed, 16 Sep 2026 10:00:00 +0200</pubDate></item>
</channel></rss>`
    expect(parseEcbRss(xml)).toEqual([
      { title: 'Monetary policy decisions', url: 'https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.mp260910~314e508016.en.html', date: '2026-09-10' },
    ])
    expect(decisionUrl('https://example.com/press/pr/date/2026/html/ecb.mp260910~x.en.html')).toBeNull()
  })
})

describe('enquêtes de confiance', () => {
  it('Michigan : stade, mois, sentiment et anticipations d’inflation à un an', () => {
    const page =
      'Surveys of Consumers Preliminary Results for September 2026 Sep Aug Sep M-M Y-Y 2026 2026 2025 Change Change Index of Consumer Sentiment 47.8 51.7 55.1 -7.5% -13.2% … Year-ahead inflation expectations jumped from 4.0% last month to 4.6% this month, the highest reading since June. Long-run inflation expectations ticked up to 3.4%.'
    expect(parseMichigan(page)).toEqual({ stage: 'preliminary', month: '2026-09-01', sentiment: 47.8, inflation1y: 4.6 })
    expect(parseMichigan('Final Results for August 2026 Index of Consumer Sentiment 51.7 Year-ahead inflation expectations were unchanged at 4.0%.')).toMatchObject({
      stage: 'final',
      inflation1y: 4,
    })
  })
  it('Conference Board : mois de référence = premier mois cité', () => {
    expect(parseConferenceBoard('The Conference Board Consumer Confidence Index® decreased by 0.8 points to 89.4 (1985=100) in August, down from 90.2 in July. The Present', 2026)).toEqual({
      month: '2026-08-01',
      index: 89.4,
    })
    expect(parseConferenceBoard('The Conference Board Consumer Confidence Index® fell by 1.3 points in August to 97.4 (1985=100), from 98.7 in July.', 2025)).toEqual({
      month: '2025-08-01',
      index: 97.4,
    })
    expect(parseConferenceBoard('Consumer Confidence Index® menu', 2026)).toBeNull()
  })
})

describe('ISM (PR Newswire) et Eurostat', () => {
  it('titres des communiqués PMI', () => {
    const text =
      'Sep 03, 2026, 10:00 ET Services PMI® at 55.4%; August 2026 ISM® Services PMI® Report Economic activity… Sep 01, 2026, 10:00 ET Manufacturing PMI&reg; at 54%; August 2026 ISM&reg; Manufacturing PMI&reg; Report'
    expect(parseIsmHeadlines(text)).toEqual([
      { date: '2026-09-03', sector: 'services', pmi: 55.4, month: '2026-08-01' },
      { date: '2026-09-01', sector: 'manufacturing', pmi: 54, month: '2026-08-01' },
    ])
  })
  it('IPCH : estimation rapide et définitive, date de mise à jour', () => {
    const json = {
      id: ['freq', 'unit', 'coicop18', 'release', 'geo', 'time'],
      size: [1, 1, 2, 2, 1, 2],
      updated: '2026-09-17T11:00:00+0200',
      dimension: {
        freq: { category: { index: { M: 0 } } },
        unit: { category: { index: { RCH_A: 0 } } },
        coicop18: { category: { index: { TOTAL: 0, TOT_X_NRG_FOOD: 1 } } },
        release: { category: { index: { FIN: 0, FLS: 1 } } },
        geo: { category: { index: { EA: 0 } } },
        time: { category: { index: { '2026-07': 0, '2026-08': 1 } } },
      },
      value: { 0: 2.9, 1: 3.2, 2: 2.9, 3: 3.3, 4: 2.5, 5: 2.4, 6: 2.5, 7: 2.4 },
    }
    const out = parseHicpFirstReleases(json)
    expect(out.updated).toBe('2026-09-17')
    expect(out.flash.total).toEqual([
      { d: '2026-07-01', v: 2.9 },
      { d: '2026-08-01', v: 3.3 },
    ])
    expect(out.final.total.at(-1)).toEqual({ d: '2026-08-01', v: 3.2 })
    expect(out.final.core.at(-1)).toEqual({ d: '2026-08-01', v: 2.4 })
  })
})
