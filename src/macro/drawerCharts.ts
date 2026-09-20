/*
 * Graphiques et tables de la fiche détaillée : série liée à un événement ou à
 * un indicateur (couleurs d'entité fixes, mêmes que les panneaux).
 */
import type { MacroPriceLine, MacroSeriesDef } from './charts/MacroTimeChart'
import { toPoints } from './charts/MacroTimeChart'
import { MACRO_COLORS } from './colors'
import type { MacroEvent, SeriesData, SeriesPoint, TileKey } from './types'

export interface DrawerChart {
  title: string
  series: MacroSeriesDef[]
  format: (v: number) => string
  dateStyle: 'day' | 'month' | 'quarter'
  priceLines?: MacroPriceLine[]
  /** série de référence pour la table des dernières valeurs */
  table: { rows: SeriesPoint[]; format: (v: number) => string; period: 'daily' | 'monthly' | 'quarterly' }
}

const pct1 = (v: number) => `${v.toFixed(1)}%`
const pct2 = (v: number) => `${v.toFixed(2)}%`
const kFmt = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)}k`
const bpFmt = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v * 100))} bp`
const num2 = (v: number) => v.toFixed(2)
const usd = (v: number) => `$${v.toFixed(2)}`

const line = (key: string, label: string, color: string, rows: SeriesPoint[]): MacroSeriesDef => ({
  key,
  label,
  color,
  kind: 'line',
  data: toPoints(rows),
})

export function chartForTile(key: TileKey, charts: SeriesData['charts']): DrawerChart | null {
  const target = [{ value: charts.inflation.target, label: '2% target' }]
  switch (key) {
    case 'cpiYoY':
      return {
        title: 'CPI inflation, % year over year',
        series: [line('cpi', 'CPI', MACRO_COLORS.cpi, charts.inflation.cpiYoY)],
        format: pct1,
        dateStyle: 'month',
        priceLines: target,
        table: { rows: charts.inflation.cpiYoY, format: pct1, period: 'monthly' },
      }
    case 'coreCpiYoY':
      return {
        title: 'Core CPI inflation, % year over year',
        series: [line('coreCpi', 'Core CPI', MACRO_COLORS.coreCpi, charts.inflation.coreCpiYoY)],
        format: pct1,
        dateStyle: 'month',
        priceLines: target,
        table: { rows: charts.inflation.coreCpiYoY, format: pct1, period: 'monthly' },
      }
    case 'corePceYoY':
      return {
        title: 'Core PCE inflation, % year over year',
        series: [line('corePce', 'Core PCE', MACRO_COLORS.corePce, charts.inflation.corePceYoY)],
        format: pct1,
        dateStyle: 'month',
        priceLines: target,
        table: { rows: charts.inflation.corePceYoY, format: pct1, period: 'monthly' },
      }
    case 'unrate':
      return {
        title: 'Unemployment rate, %',
        series: [line('unrate', 'Unemployment rate', MACRO_COLORS.unrate, charts.labor.unrate)],
        format: pct1,
        dateStyle: 'month',
        table: { rows: charts.labor.unrate, format: pct1, period: 'monthly' },
      }
    case 'nfp':
      return {
        title: 'Monthly payroll change, thousands',
        series: [{ key: 'nfp', label: 'Payrolls change', color: MACRO_COLORS.reference, kind: 'bars', data: toPoints(charts.labor.nfpMoM) }],
        format: kFmt,
        dateStyle: 'month',
        table: { rows: charts.labor.nfpMoM, format: kFmt, period: 'monthly' },
      }
    case 'fedTarget':
      return {
        title: 'Fed funds target, upper bound, %',
        series: [{ key: 'fed', label: 'Fed target (upper)', color: MACRO_COLORS.fedTarget, kind: 'step', data: toPoints(charts.rates.fedTargetUpper) }],
        format: pct2,
        dateStyle: 'day',
        table: { rows: charts.rates.fedTargetUpper, format: pct2, period: 'daily' },
      }
    case 'y10':
      return {
        title: 'US 10-year Treasury yield, %',
        series: [line('y10', '10Y yield', MACRO_COLORS.y10, charts.rates.y10)],
        format: pct2,
        dateStyle: 'day',
        table: { rows: charts.rates.y10, format: pct2, period: 'daily' },
      }
    case 'spread10y3m':
      return {
        title: '10Y–3M Treasury spread, % (below zero = inverted)',
        series: [{ key: 'spread', label: '10Y–3M spread', color: MACRO_COLORS.reference, kind: 'baseline', data: toPoints(charts.rates.spread10y3m) }],
        format: pct2,
        dateStyle: 'day',
        priceLines: [{ value: 0 }],
        table: { rows: charts.rates.spread10y3m, format: bpFmt, period: 'daily' },
      }
    case 'vix':
      return {
        title: 'VIX, index points',
        series: [line('vix', 'VIX', MACRO_COLORS.vix, charts.growthRisk.vix)],
        format: num2,
        dateStyle: 'day',
        table: { rows: charts.growthRisk.vix, format: num2, period: 'daily' },
      }
    case 'dxy':
      return {
        title: 'US dollar index',
        series: [line('dxy', 'Dollar index', MACRO_COLORS.dxy, charts.growthRisk.dxy)],
        format: num2,
        dateStyle: 'day',
        table: { rows: charts.growthRisk.dxy, format: num2, period: 'daily' },
      }
    case 'wti':
      return {
        title: 'WTI crude oil, $ per barrel',
        series: [line('wti', 'WTI', MACRO_COLORS.wti, charts.growthRisk.wti)],
        format: usd,
        dateStyle: 'day',
        table: { rows: charts.growthRisk.wti, format: usd, period: 'daily' },
      }
    case 'gdp':
      return {
        title: 'Real GDP growth, % annualized (quarterly)',
        series: [{ key: 'gdp', label: 'Real GDP, % SAAR', color: MACRO_COLORS.reference, kind: 'bars', data: toPoints(charts.growthRisk.gdpQoQ) }],
        format: pct1,
        dateStyle: 'quarter',
        table: { rows: charts.growthRisk.gdpQoQ, format: pct1, period: 'quarterly' },
      }
    default:
      return null
  }
}

/** Série liée à un événement (données US uniquement). */
export function chartForEvent(event: MacroEvent, charts: SeriesData['charts']): DrawerChart | null {
  if (event.country !== 'USD') return null
  switch (event.kind) {
    case 'cpi': {
      const base = chartForTile('cpiYoY', charts)
      if (!base) return null
      return {
        ...base,
        title: 'US CPI and core CPI, % year over year',
        series: [...base.series, line('coreCpi', 'Core CPI', MACRO_COLORS.coreCpi, charts.inflation.coreCpiYoY)],
      }
    }
    case 'pce':
      return chartForTile('corePceYoY', charts)
    case 'nfp':
    case 'claims':
    case 'jolts':
      return chartForTile('nfp', charts)
    case 'gdp':
    case 'retail':
    case 'ism':
      return chartForTile('gdp', charts)
    case 'fomc':
    case 'speech':
      return {
        title: 'Fed target (upper bound) and Treasury yields, %',
        series: [
          { key: 'fed', label: 'Fed target (upper)', color: MACRO_COLORS.fedTarget, kind: 'step' as const, data: toPoints(charts.rates.fedTargetUpper) },
          line('y10', '10Y yield', MACRO_COLORS.y10, charts.rates.y10),
          line('m3', '3M bill', MACRO_COLORS.m3, charts.rates.m3),
        ].filter((s) => s.data.length > 0),
        format: pct2,
        dateStyle: 'day',
        table: { rows: charts.rates.fedTargetUpper, format: pct2, period: 'daily' },
      }
    default:
      return null
  }
}

export function suggestionsFor(selection: { type: 'event'; event: MacroEvent } | { type: 'indicator'; key: TileKey }): string[] {
  if (selection.type === 'indicator') {
    return ['Is the trend improving or worsening?', 'Why does this matter for the Fed right now?']
  }
  if (selection.event.kind === 'fomc') {
    return ['What would a surprise look like?', 'How could yields and the dollar react?']
  }
  return ['How could markets react to a surprise?', 'What does the previous value tell us?']
}
