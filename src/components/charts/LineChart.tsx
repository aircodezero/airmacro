import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createChart,
  LineSeries,
  AreaSeries,
  ColorType,
  LineStyle,
  PriceScaleMode,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { CHART } from '../../lib/colors'

export interface LinePoint {
  t: number
  v: number
}

export interface LineSeriesDef {
  key: string
  label: string
  color: string
  data: LinePoint[]
  area?: boolean
  dashed?: boolean
  width?: 1 | 2 | 3
}

export interface PriceLineDef {
  value: number
  label?: string
  color?: string
  dashed?: boolean
}

interface LineChartProps {
  series: LineSeriesDef[]
  height?: number
  ariaLabel: string
  valueFormat?: (v: number) => string
  priceLines?: PriceLineDef[]
  logScale?: boolean
  legend?: boolean
  rightOffset?: number
}

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export function LineChart({
  series,
  height = 260,
  ariaLabel,
  valueFormat = (v) => v.toLocaleString('en-US', { maximumFractionDigits: 2 }),
  priceLines = [],
  logScale = false,
  legend,
}: LineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const apiRef = useRef<Map<string, ISeriesApi<'Line'> | ISeriesApi<'Area'>>>(new Map())
  const priceLineRefs = useRef<Array<{ api: ISeriesApi<'Line'> | ISeriesApi<'Area'>; line: IPriceLine }>>([])
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [tooltip, setTooltip] = useState<{
    x: number
    y: number
    time: string
    rows: Array<{ label: string; color: string; value: string }>
  } | null>(null)
  const seriesRef = useRef(series)
  seriesRef.current = series
  const formatRef = useRef(valueFormat)
  formatRef.current = valueFormat

  const showLegend = legend ?? series.length > 1

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: CHART.text,
        fontFamily: CHART.fontFamily,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: CHART.grid },
        horzLines: { color: CHART.grid },
      },
      rightPriceScale: { borderColor: CHART.border },
      timeScale: { borderColor: CHART.border, timeVisible: false },
      crosshair: {
        horzLine: { labelBackgroundColor: '#20262e' },
        vertLine: { labelBackgroundColor: '#20262e' },
      },
      localization: { locale: 'en-US' },
    })
    chartRef.current = chart

    chart.subscribeCrosshairMove((param) => {
      if (param.time == null || !param.point) {
        setTooltip(null)
        return
      }
      const rows: Array<{ label: string; color: string; value: string }> = []
      for (const def of seriesRef.current) {
        const api = apiRef.current.get(def.key)
        if (!api) continue
        const point = param.seriesData.get(api) as { value?: number } | undefined
        if (point?.value != null) {
          rows.push({ label: def.label, color: def.color, value: formatRef.current(point.value) })
        }
      }
      if (!rows.length) {
        setTooltip(null)
        return
      }
      setTooltip({
        x: param.point.x,
        y: param.point.y,
        time: dateFmt.format(new Date((param.time as number) * 1000)),
        rows,
      })
    })

    return () => {
      chart.remove()
      chartRef.current = null
      apiRef.current.clear()
    }
  }, [])

  useEffect(() => {
    chartRef.current?.priceScale('right').applyOptions({
      mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    })
  }, [logScale])

  const dataSignature = useMemo(
    () => series.map((s) => `${s.key}:${s.data.length}:${s.data[s.data.length - 1]?.v ?? 0}`).join('|'),
    [series],
  )

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const seen = new Set<string>()
    for (const def of series) {
      seen.add(def.key)
      let api = apiRef.current.get(def.key)
      if (!api) {
        api = def.area
          ? chart.addSeries(AreaSeries, {
              lineColor: def.color,
              topColor: `${def.color}44`,
              bottomColor: `${def.color}05`,
              lineWidth: def.width ?? 2,
              priceLineVisible: false,
              lastValueVisible: false,
            })
          : chart.addSeries(LineSeries, {
              color: def.color,
              lineWidth: def.width ?? 2,
              lineStyle: def.dashed ? LineStyle.Dashed : LineStyle.Solid,
              priceLineVisible: false,
              lastValueVisible: false,
            })
        apiRef.current.set(def.key, api)
      }
      api.setData(def.data.map((p) => ({ time: p.t as UTCTimestamp, value: p.v })))
      api.applyOptions({ visible: !hidden.has(def.key) })
    }
    for (const [key, api] of apiRef.current.entries()) {
      if (!seen.has(key)) {
        chart.removeSeries(api)
        apiRef.current.delete(key)
      }
    }
    // lignes de niveau : purge puis re-création (rattachées à la première série)
    for (const { api, line } of priceLineRefs.current) {
      try {
        api.removePriceLine(line)
      } catch {
        /* série déjà retirée */
      }
    }
    priceLineRefs.current = []
    const first = series.find((s) => apiRef.current.has(s.key))
    if (first) {
      const api = apiRef.current.get(first.key)!
      for (const line of priceLines) {
        priceLineRefs.current.push({
          api,
          line: api.createPriceLine({
            price: line.value,
            color: line.color ?? CHART.border,
            lineWidth: 1,
            lineStyle: line.dashed === false ? LineStyle.Solid : LineStyle.Dashed,
            axisLabelVisible: true,
            title: line.label ?? '',
          }),
        })
      }
    }
    chart.timeScale().fitContent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSignature, hidden])

  return (
    <div className="linechart">
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
              <span className="legend-dot" style={{ background: def.color }} aria-hidden="true" />
              {def.label}
            </button>
          ))}
        </div>
      )}
      <div className="chart-wrap">
        <div ref={containerRef} className="chart-host" style={{ height }} role="img" aria-label={ariaLabel} />
        {tooltip && (
          <div
            className="chart-tooltip mono"
            style={{
              left: Math.min(tooltip.x + 14, (containerRef.current?.clientWidth ?? 300) - 170),
              top: Math.max(tooltip.y - 10, 4),
            }}
          >
            <div className="tooltip-time">{tooltip.time}</div>
            {tooltip.rows.map((row) => (
              <div key={row.label} className="tooltip-row">
                <span className="legend-dot" style={{ background: row.color }} aria-hidden="true" />
                <span className="tooltip-label">{row.label}</span>
                <span>{row.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
