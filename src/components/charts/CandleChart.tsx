import { useEffect, useRef } from 'react'
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { CHART } from '../../lib/colors'
import type { Candle } from '../../lib/types'

interface CandleChartProps {
  candles: Candle[]
  height?: number
  showVolume?: boolean
  onHover?: (candle: Candle | null) => void
  ariaLabel: string
}

export function CandleChart({ candles, height = 330, showVolume = true, onHover, ariaLabel }: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const dataRef = useRef<Candle[]>([])
  const onHoverRef = useRef(onHover)
  onHoverRef.current = onHover

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
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: CHART.up,
      downColor: CHART.down,
      borderVisible: false,
      wickUpColor: CHART.up,
      wickDownColor: CHART.down,
    })
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    })
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

    chart.subscribeCrosshairMove((param) => {
      const callback = onHoverRef.current
      if (!callback) return
      if (param.time == null) {
        callback(null)
        return
      }
      const t = param.time as number
      callback(dataRef.current.find((k) => k.t === t) ?? null)
    })

    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    volumeSeriesRef.current = volumeSeries
    return () => {
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
    }
  }, [])

  useEffect(() => {
    const candleSeries = candleSeriesRef.current
    const volumeSeries = volumeSeriesRef.current
    if (!candleSeries || !volumeSeries) return
    dataRef.current = candles
    candleSeries.setData(
      candles.map((k) => ({
        time: k.t as UTCTimestamp,
        open: k.o,
        high: k.h,
        low: k.l,
        close: k.c,
      })),
    )
    const hasVolume = showVolume && candles.some((k) => k.v > 0)
    volumeSeries.applyOptions({ visible: hasVolume })
    volumeSeries.setData(
      hasVolume
        ? candles.map((k) => ({
            time: k.t as UTCTimestamp,
            value: k.v,
            color: k.c >= k.o ? CHART.upSoft : CHART.downSoft,
          }))
        : [],
    )
    chartRef.current?.timeScale().fitContent()
  }, [candles, showVolume])

  return <div ref={containerRef} className="chart-host" style={{ height }} role="img" aria-label={ariaLabel} />
}
