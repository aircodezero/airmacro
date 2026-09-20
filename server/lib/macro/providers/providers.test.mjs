import { describe, it, expect } from 'vitest'
import { splitCsvLine, csvNumber, usDateToIso } from './csv.mjs'
import { parseBlsResponse } from './bls.mjs'
import { beaPeriodToDate, parseNipaLines } from './bea.mjs'
import { parseTreasuryCsv } from './treasury.mjs'
import { parseVixCsv } from './cboe.mjs'
import { parseEffr } from './nyfed.mjs'
import { parseFedRss, htmlToText, isFedPressUrl, pressReleaseDate } from './fedpress.mjs'
import { parseEcbExrToDxy } from './ecbfx.mjs'
import { parseEiaSeries } from './eia.mjs'
import { parseFredGraphCsv } from './fred.mjs'
import { parseFomcDecision } from '../../../../shared/analytics/macroseries.mjs'

describe('csv', () => {
  it('guillemets, virgules et valeurs manquantes', () => {
    expect(splitCsvLine('A015RC,1967M01,"22,068"')).toEqual(['A015RC', '1967M01', '22,068'])
    expect(splitCsvLine('a,"b ""c""",d')).toEqual(['a', 'b "c"', 'd'])
    expect(csvNumber('"22,068"')).toBe(22068)
    expect(csvNumber('.')).toBeNull()
    expect(csvNumber('')).toBeNull()
    expect(usDateToIso('09/15/2026')).toBe('2026-09-15')
    expect(usDateToIso('2026-09-15')).toBeNull()
  })
})

describe('BLS v1', () => {
  it('mensuel uniquement, trié, drapeau préliminaire', () => {
    const out = parseBlsResponse({
      status: 'REQUEST_SUCCEEDED',
      Results: {
        series: [
          {
            seriesID: 'CES0000000001',
            data: [
              { year: '2026', period: 'M08', latest: 'true', value: '159075', footnotes: [{ code: 'P', text: 'preliminary' }] },
              { year: '2026', period: 'M07', value: '158913', footnotes: [{}] },
              { year: '2025', period: 'M13', value: '158000', footnotes: [{}] },
              { year: '2026', period: 'M06', value: '-', footnotes: [{}] },
            ],
          },
          { seriesID: 'UNKNOWN', data: [{ year: '2026', period: 'M08', value: '1' }] },
        ],
      },
    })
    expect(out.series.payems).toEqual([
      { d: '2026-07-01', v: 158913 },
      { d: '2026-08-01', v: 159075 },
    ])
    expect(out.preliminary.payems).toBe(true)
    expect(out.missing).toContain('cpiNsa')
  })
  it('quota épuisé → erreur explicite', () => {
    expect(() =>
      parseBlsResponse({ status: 'REQUEST_NOT_PROCESSED', message: ['daily threshold reached'] }),
    ).toThrow(/REQUEST_NOT_PROCESSED daily threshold/)
  })
})

describe('BEA fichiers plats', () => {
  it('périodes', () => {
    expect(beaPeriodToDate('2026M07')).toBe('2026-07-01')
    expect(beaPeriodToDate('2026Q2')).toBe('2026-04-01')
    expect(beaPeriodToDate('2026')).toBeNull()
  })
  it('lignes filtrées', () => {
    const series = parseNipaLines(
      ['DPCCRG,2026M07,"130.658"', 'DPCCRG,2026M06,"130.338"', 'DPCERG,2026M07,"131.659"', 'A191RL,2026Q2,"1.5"', 'DPCCRG,2026M08,""'],
      { corePce: 'DPCCRG', pce: 'DPCERG' },
    )
    expect(series.corePce).toEqual([
      { d: '2026-06-01', v: 130.338 },
      { d: '2026-07-01', v: 130.658 },
    ])
    expect(series.pce).toEqual([{ d: '2026-07-01', v: 131.659 }])
  })
})

describe('Trésor US', () => {
  it('colonnes 3 Mo et 10 Yr, dates US, tri croissant', () => {
    const csv = [
      'Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"',
      '09/15/2026,3.93,4.00,4.06,4.11,4.19,4.17,4.39,4.67,4.76,4.83,4.91,5.00,5.40,5.36',
      '09/14/2026,3.94,4.00,4.06,4.11,4.18,4.18,4.37,4.65,4.73,4.80,4.88,4.97,5.37,5.34',
    ].join('\n')
    expect(parseTreasuryCsv(csv)).toEqual({
      m3: [
        { d: '2026-09-14', v: 4.11 },
        { d: '2026-09-15', v: 4.11 },
      ],
      y10: [
        { d: '2026-09-14', v: 4.97 },
        { d: '2026-09-15', v: 5 },
      ],
    })
    expect(() => parseTreasuryCsv('Date,foo\n01/01/2026,1')).toThrow(/colonnes/)
  })
})

describe('Cboe VIX', () => {
  it('clôtures depuis une date', () => {
    const csv = 'DATE,OPEN,HIGH,LOW,CLOSE\n09/14/2026,17.5,18.17,16.58,17.1\n09/15/2026,17.57,18.03,16.79,17.2\n01/02/1990,17.24,17.24,17.24,17.24'
    expect(parseVixCsv(csv, '2026-01-01')).toEqual([
      { d: '2026-09-14', v: 17.1 },
      { d: '2026-09-15', v: 17.2 },
    ])
  })
})

describe('NY Fed EFFR', () => {
  it('fourchette cible et taux effectif', () => {
    const rows = parseEffr({
      refRates: [
        { effectiveDate: '2026-09-14', type: 'EFFR', percentRate: 3.63, targetRateFrom: 3.5, targetRateTo: 3.75 },
        { effectiveDate: '2026-09-11', type: 'EFFR', percentRate: 3.62, targetRateFrom: 3.5, targetRateTo: 3.75 },
      ],
    })
    expect(rows).toEqual([
      { d: '2026-09-11', effr: 3.62, lower: 3.5, upper: 3.75 },
      { d: '2026-09-14', effr: 3.63, lower: 3.5, upper: 3.75 },
    ])
    expect(() => parseEffr({ refRates: [] })).toThrow()
  })
})

describe('Réserve fédérale', () => {
  const xml = `<rss><channel><title>FRB</title>
    <item><title>Minutes of the Federal Open Market Committee, July 28&#8211;29, 2026</title><link><![CDATA[https://www.federalreserve.gov/newsevents/pressreleases/monetary20260819a.htm]]></link><pubDate><![CDATA[Wed, 19 Aug 2026 18:00:00 GMT]]></pubDate></item>
    <item><title>Federal Reserve issues FOMC statement</title><link><![CDATA[https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm]]></link><pubDate><![CDATA[Wed, 29 Jul 2026 18:00:00 GMT]]></pubDate></item>
    <item><title>Phishing</title><link><![CDATA[https://evil.example.com/newsevents/pressreleases/monetary20260729a.htm]]></link></item>
  </channel></rss>`

  it('flux RSS : types, dates, URL officielles uniquement', () => {
    const items = parseFedRss(xml)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ type: 'minutes', date: '2026-08-19', title: 'Minutes of the Federal Open Market Committee, July 28–29, 2026' })
    expect(items[1]).toMatchObject({ type: 'statement', date: '2026-07-29', ts: Date.UTC(2026, 6, 29, 18) })
  })

  it('validation des URL de communiqué', () => {
    expect(isFedPressUrl('https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm')).toBe(true)
    expect(isFedPressUrl('http://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm')).toBe(false)
    expect(isFedPressUrl('https://www.federalreserve.gov/other.htm')).toBe(false)
    expect(pressReleaseDate('https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm')).toBe('2026-09-16')
  })

  it('HTML du communiqué → décision', () => {
    const html = `<html><head><script>var x = "decided to lower the target range for the federal funds rate by 1/4 percentage point to 1 to 2 percent"</script></head>
      <body><p>The Federal Open Market Committee approved the following statement for release by a 9&nbsp;&ndash; 3 vote:</p>
      <p>The Committee decided to maintain the target range for the federal funds rate at 3-1/2 to 3-3/4 percent, in support of the Federal Reserve&#39;s dual mandate.</p></body></html>`
    const text = htmlToText(html)
    expect(text).not.toMatch(/1 to 2 percent/)
    expect(parseFomcDecision(text)).toMatchObject({ action: 'hold', lower: 3.5, upper: 3.75, vote: { for: 9, against: 3 } })
  })
})

describe('BCE → réplique DXY', () => {
  it('dates complètes uniquement', () => {
    const csv = [
      'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE',
      ...['USD,1.1', 'JPY,165', 'GBP,0.8461538462', 'CAD,1.485', 'SEK,11.55', 'CHF,0.968'].map((p) => {
        const [cur, v] = p.split(',')
        return `EXR.D.${cur}.EUR.SP00.A,D,${cur},EUR,SP00,A,2026-09-15,${v}`
      }),
      'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-09-16,1.12',
    ].join('\n')
    const rows = parseEcbExrToDxy(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].d).toBe('2026-09-15')
    expect(rows[0].v).toBeCloseTo(102.686, 2)
  })
})

describe('EIA et FRED', () => {
  it('EIA : période/valeur', () => {
    expect(
      parseEiaSeries({ response: { data: [{ period: '2026-09-09', value: '97.26' }, { period: '2026-09-08', value: '94.21' }, { period: 'x', value: '1' }] } }),
    ).toEqual([
      { d: '2026-09-08', v: 94.21 },
      { d: '2026-09-09', v: 97.26 },
    ])
    expect(() => parseEiaSeries({ response: { data: [] } })).toThrow()
  })
  it('FRED : en-tête moderne, valeurs manquantes « . »', () => {
    const out = parseFredGraphCsv('observation_date,DGS10,DGS3MO\n2026-09-14,4.97,4.11\n2026-09-15,.,4.11\n2019-01-02,2.66,2.40', '2020-01-01')
    expect(out.DGS10).toEqual([{ d: '2026-09-14', v: 4.97 }])
    expect(out.DGS3MO).toHaveLength(2)
    expect(() => parseFredGraphCsv('<html>blocked</html>')).toThrow()
  })
})
