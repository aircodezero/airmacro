/*
 * Graphique temporel AirMacro (lightweight-charts) : lignes, escaliers, barres
 * signées, ligne de base à zéro. Un seul axe vertical par graphique (les mesures
 * d'échelles différentes vont dans des petits multiples). Infobulle au réticule
 * listant toutes les séries à la date survolée (valeur « à date » pour les
 * escaliers), légende cliquable dès deux séries.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BaselineSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  LineStyle,
  LineType,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type UTCTimestamp,
} from 'lightweight-charts'
import { CHART } from '../../lib/colors'
import { MACRO_COLORS, wash } from '../colors'

export interface TimePoint {
  t: number
  v: number
}

export type MacroSeriesKind = 'line' | 'step' | 'bars' | 'baseline'

export interface MacroSeriesDef {
  key: string
  label: string
  color: string
  kind: MacroSeriesKind
  data: TimePoint[]
}

export interface MacroPriceLine {
  value: number
  label?: string
  color?: string
}

interface Props {
  series: MacroSeriesDef[]
  height: number
  ariaLabel: string
  format: (v: number) => string
  priceLines?: MacroPriceLine[]
  dateStyle?: 'day' | 'month' | 'quarter'
  /** largeur minimale de l'échelle de droite : aligne les petits multiples */
  scaleWidth?: number
}

const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })

function fmtDate(t: number, style: Props['dateStyle']): string {
  const d = new Date(t * 1000)
  if (style === 'month') return monthFmt.format(d)
  if (style === 'quarter') return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`
  return dayFmt.format(d)
}

/** Valeur à la date t : exacte, ou dernière connue pour un escalier. */
function valueAt(def: MacroSeriesDef, t: number): number | null {
  const data = def.data
  let lo = 0
  let hi = data.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (data[mid].t <= t) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (found < 0) return null
  if (def.kind === 'step') return t <= data[data.length - 1].t ? data[found].v : null
  return data[found].t === t ? data[found].v : null
}

export const dateToTs = (d: string): number => Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000)
export const toPoints = (rows: Array<{ d: string; v: number }>): TimePoint[] =>
  rows.map((r) => ({ t: dateToTs(r.d), v: r.v }))

export function MacroTimeChart({ series, height, ariaLabel, format, priceLines = [], dateStyle = 'day', scaleWidth = 58 }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const apisRef = useRef<Map<string, ISeriesApi<SeriesType>>>(new Map())
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [tip, setTip] = useState<{ x: number; y: number; date: string; rows: Array<{ label: string; color: string; value: string }> } | null>(null)
  const seriesRef = useRef(series)
  seriesRef.current = series
  const formatRef = useRef(format)
  formatRef.current = format
  const hiddenRef = useRef(hidden)
  hiddenRef.current = hidden

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: CHART.text,
        fontFamily: CHART.fontFamily,
        fontSize: 10,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: CHART.grid } },
      rightPriceScale: { borderColor: CHART.border, minimumWidth: scaleWidth, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderColor: CHART.border, timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        horzLine: { visible: false, labelVisible: false },
        vertLine: { labelBackgroundColor: '#20262e' },
      },
      handleScroll: false,
      handleScale: false,
      localization: { locale: 'en-US', priceFormatter: (p: number) => formatRef.current(p) },
    })
    chartRef.current = chart
    chart.subscribeCrosshairMove((param) => {
      if (param.time == null || !param.point) {
        setTip(null)
        return
      }
      const t = param.time as number
      const rows = seriesRef.current
        .filter((def) => !hiddenRef.current.has(def.key))
        .map((def) => {
          const v = valueAt(def, t)
          return v == null ? null : { label: def.label, color: def.color, value: formatRef.current(v) }
        })
        .filter((r): r is { label: string; color: string; value: string } => r != null)
      setTip(rows.length ? { x: param.point.x, y: param.point.y, date: fmtDate(t, dateStyle), rows } : null)
    })
    return () => {
      chart.remove()
      chartRef.current = null
      apisRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signature = useMemo(
    () => series.map((s) => `${s.key}:${s.kind}:${s.data.length}:${s.data[s.data.length - 1]?.v ?? ''}`).join('|') + `|${priceLines.map((p) => p.value).join(',')}`,
    [series, priceLines],
  )

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    for (const api of apisRef.current.values()) chart.removeSeries(api)
    apisRef.current.clear()
    let first: ISeriesApi<SeriesType> | null = null
    for (const def of series) {
      let api: ISeriesApi<SeriesType>
      const common = { priceLineVisible: false, lastValueVisible: false, visible: !hidden.has(def.key) }
      if (def.kind === 'bars') {
        api = chart.addSeries(HistogramSeries, { ...common, base: 0 })
        api.setData(
          def.data.map((p) => ({
            time: p.t as UTCTimestamp,
            value: p.v,
            color: p.v >= 0 ? MACRO_COLORS.up : MACRO_COLORS.down,
          })),
        )
      } else if (def.kind === 'baseline') {
        api = chart.addSeries(BaselineSeries, {
          ...common,
          baseValue: { type: 'price', price: 0 },
          lineWidth: 2,
          topLineColor: MACRO_COLORS.up,
          topFillColor1: wash(MACRO_COLORS.up, 0.14),
          topFillColor2: wash(MACRO_COLORS.up, 0.02),
          bottomLineColor: MACRO_COLORS.down,
          bottomFillColor1: wash(MACRO_COLORS.down, 0.02),
          bottomFillColor2: wash(MACRO_COLORS.down, 0.14),
        })
        api.setData(def.data.map((p) => ({ time: p.t as UTCTimestamp, value: p.v })))
      } else {
        api = chart.addSeries(LineSeries, {
          ...common,
          color: def.color,
          lineWidth: 2,
          lineType: def.kind === 'step' ? LineType.WithSteps : LineType.Simple,
          crosshairMarkerRadius: 4,
          crosshairMarkerBorderColor: '#12161d',
          crosshairMarkerBorderWidth: 2,
        })
        api.setData(def.data.map((p) => ({ time: p.t as UTCTimestamp, value: p.v })))
      }
      apisRef.current.set(def.key, api)
      if (!first) first = api
    }
    if (first) {
      for (const line of priceLines) {
        first.createPriceLine({
          price: line.value,
          color: line.color ?? MACRO_COLORS.reference,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: line.label ?? '',
        })
      }
    }
    chart.timeScale().fitContent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  useEffect(() => {
    for (const [key, api] of apisRef.current) api.applyOptions({ visible: !hidden.has(key) })
  }, [hidden])

  const showLegend = series.length > 1

  return (
    <div className="mchart">
      {showLegend && (
        <div className="chart-legend" role="group" aria-label="Displayed series">
          {series.map((def) => (
            <button
              key={def.key}
              type="button"
              className="legend-item"
              aria-pressed={!hidden.has(def.key)}
              onClick={() =>
                setHidden((prev) => {
                  const next = new Set(prev)
                  if (next.has(def.key)) next.delete(def.key)
                  else next.add(def.key)
                  return next
                })
              }
            >
              <span
                className={def.kind === 'step' ? 'legend-key legend-key-step' : 'legend-key'}
                style={{ borderColor: def.color }}
                aria-hidden="true"
              />
              {def.label}
            </button>
          ))}
        </div>
      )}
      <div className="chart-wrap">
        <div ref={hostRef} className="chart-host" style={{ height }} role="img" aria-label={ariaLabel} />
        {tip && (
          <div
            className="chart-tooltip mono"
            style={{
              left: Math.max(4, Math.min(tip.x + 14, (hostRef.current?.clientWidth ?? 300) - 176)),
              top: Math.max(tip.y - 12, 4),
            }}
          >
            <div className="tooltip-time">{tip.date}</div>
            {tip.rows.map((row) => (
              <div key={row.label} className="tooltip-row">
                <span className="tooltip-key" style={{ background: row.color }} aria-hidden="true" />
                <strong className="tooltip-value">{row.value}</strong>
                <span className="tooltip-label">{row.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
