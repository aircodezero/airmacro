/*
 * Graphique XY en SVG (axes numériques libres, option Y logarithmique) —
 * pour les vues que lightweight-charts ne couvre pas : superposition par
 * « jours depuis halving », structure par terme, nuage de régression.
 * Tooltip au survol (point le plus proche par série), légende cliquable.
 */
import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface XYPoint {
  x: number
  y: number
}

export interface XYLine {
  key: string
  label: string
  color: string
  points: XYPoint[]
  width?: number
  dashed?: boolean
  /** nuage de points plutôt que ligne */
  scatter?: boolean
  /** points visibles en plus de la ligne */
  markers?: boolean
  emphasis?: boolean
}

interface XYChartProps {
  lines: XYLine[]
  height?: number
  ariaLabel: string
  xFormat?: (x: number) => string
  yFormat?: (y: number) => string
  logY?: boolean
  legend?: boolean
  xTicksCount?: number
  yTicksCount?: number
  extra?: ReactNode
  refLinesY?: Array<{ value: number; label?: string; color?: string }>
}

const PAD = { top: 10, right: 12, bottom: 24, left: 8 }
const AXIS_WIDTH = 58

function niceTicks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [min]
  const span = max - min
  const step0 = span / Math.max(1, count)
  const magnitude = 10 ** Math.floor(Math.log10(step0))
  const candidates = [1, 2, 2.5, 5, 10]
  const step = candidates.map((c) => c * magnitude).find((s) => span / s <= count) ?? magnitude * 10
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step / 1e6; v += step) ticks.push(Number(v.toPrecision(12)))
  return ticks
}

function logTicks(min: number, max: number): number[] {
  const ticks: number[] = []
  const lo = Math.floor(Math.log10(Math.max(min, 1e-9)))
  const hi = Math.ceil(Math.log10(Math.max(max, 1e-9)))
  for (let e = lo; e <= hi; e++) {
    const v = 10 ** e
    if (v >= min && v <= max) ticks.push(v)
  }
  if (ticks.length < 2) return niceTicks(min, max, 4)
  return ticks
}

export function XYChart({
  lines,
  height = 280,
  ariaLabel,
  xFormat = (x) => String(x),
  yFormat = (y) => y.toLocaleString('en-US', { maximumFractionDigits: 2 }),
  logY = false,
  legend,
  xTicksCount = 6,
  yTicksCount = 5,
  refLinesY = [],
}: XYChartProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<{
    px: number
    rows: Array<{ label: string; color: string; x: number; y: number }>
  } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const width = 720 // viewBox : le SVG est fluide via CSS

  const visible = lines.filter((line) => !hidden.has(line.key) && line.points.length > 0)

  const domain = useMemo(() => {
    let xMin = Infinity
    let xMax = -Infinity
    let yMin = Infinity
    let yMax = -Infinity
    for (const line of visible) {
      for (const p of line.points) {
        if (p.x < xMin) xMin = p.x
        if (p.x > xMax) xMax = p.x
        if (p.y < yMin) yMin = p.y
        if (p.y > yMax) yMax = p.y
      }
    }
    for (const ref of refLinesY) {
      if (ref.value < yMin) yMin = ref.value
      if (ref.value > yMax) yMax = ref.value
    }
    if (!Number.isFinite(xMin)) return null
    if (yMin === yMax) {
      yMin -= 1
      yMax += 1
    }
    if (!logY) {
      const pad = (yMax - yMin) * 0.06
      yMin -= pad
      yMax += pad
    } else {
      yMin = Math.max(yMin * 0.9, 1e-9)
      yMax *= 1.1
    }
    return { xMin, xMax, yMin, yMax }
  }, [visible, refLinesY, logY])

  if (!domain) {
    return <p className="muted text-sm">No data to plot.</p>
  }

  const plotW = width - PAD.left - PAD.right - AXIS_WIDTH
  const plotH = height - PAD.top - PAD.bottom
  const sx = (x: number) => PAD.left + ((x - domain.xMin) / (domain.xMax - domain.xMin || 1)) * plotW
  const sy = (y: number) => {
    if (logY) {
      const ly = Math.log10(Math.max(y, 1e-9))
      const lMin = Math.log10(domain.yMin)
      const lMax = Math.log10(domain.yMax)
      return PAD.top + (1 - (ly - lMin) / (lMax - lMin || 1)) * plotH
    }
    return PAD.top + (1 - (y - domain.yMin) / (domain.yMax - domain.yMin || 1)) * plotH
  }

  const xTicks = niceTicks(domain.xMin, domain.xMax, xTicksCount)
  const yTicks = logY ? logTicks(domain.yMin, domain.yMax) : niceTicks(domain.yMin, domain.yMax, yTicksCount)

  const showLegend = legend ?? lines.length > 1

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * width
    const dataX = domain.xMin + ((px - PAD.left) / plotW) * (domain.xMax - domain.xMin)
    const rows: Array<{ label: string; color: string; x: number; y: number }> = []
    for (const line of visible) {
      let best: XYPoint | null = null
      let bestDist = Infinity
      for (const p of line.points) {
        const dist = Math.abs(p.x - dataX)
        if (dist < bestDist) {
          bestDist = dist
          best = p
        }
      }
      if (best && bestDist <= (domain.xMax - domain.xMin) * 0.05) {
        rows.push({ label: line.label, color: line.color, x: best.x, y: best.y })
      }
    }
    setHover(rows.length ? { px, rows } : null)
  }


  return (
    <div className="xychart">
      {showLegend && (
        <div className="chart-legend" role="group" aria-label="Displayed series">
          {lines.map((line) => (
            <button
              key={line.key}
              type="button"
              className="legend-item"
              aria-pressed={!hidden.has(line.key)}
              onClick={() =>
                setHidden((prev) => {
                  const next = new Set(prev)
                  if (next.has(line.key)) next.delete(line.key)
                  else next.add(line.key)
                  return next
                })
              }
            >
              <span className="legend-dot" style={{ background: line.color }} aria-hidden="true" />
              {line.label}
            </button>
          ))}
        </div>
      )}
      <div className="chart-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="xychart-svg"
          role="img"
          aria-label={ariaLabel}
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* grille + axes */}
          {yTicks.map((tick) => (
            <g key={`y${tick}`}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={sy(tick)} y2={sy(tick)} className="xy-grid" />
              <text x={PAD.left + plotW + 6} y={sy(tick) + 3} className="xy-tick">
                {yFormat(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <g key={`x${tick}`}>
              <line x1={sx(tick)} x2={sx(tick)} y1={PAD.top} y2={PAD.top + plotH} className="xy-grid" />
              <text x={sx(tick)} y={height - 8} textAnchor="middle" className="xy-tick">
                {xFormat(tick)}
              </text>
            </g>
          ))}
          {refLinesY.map((ref) => (
            <g key={`ref${ref.value}`}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={sy(ref.value)}
                y2={sy(ref.value)}
                stroke={ref.color ?? 'var(--ac-border-strong)'}
                strokeDasharray="4 4"
                strokeWidth="1"
              />
              {ref.label && (
                <text x={PAD.left + 4} y={sy(ref.value) - 4} className="xy-tick" fill={ref.color}>
                  {ref.label}
                </text>
              )}
            </g>
          ))}
          {/* séries */}
          {visible.map((line) =>
            line.scatter ? (
              <g key={line.key} fill={line.color} opacity={0.75}>
                {line.points.map((p, i) => (
                  <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={2.6} />
                ))}
              </g>
            ) : (
              <g key={line.key}>
                <path
                  d={line.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ')}
                  fill="none"
                  stroke={line.color}
                  strokeWidth={line.width ?? (line.emphasis ? 2.4 : 1.7)}
                  strokeDasharray={line.dashed ? '5 4' : undefined}
                  opacity={line.emphasis === false ? 0.6 : 1}
                  strokeLinejoin="round"
                />
                {line.markers &&
                  line.points.map((p, i) => (
                    <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={3.4} fill={line.color} stroke="var(--ac-surface)" strokeWidth="1.5" />
                  ))}
              </g>
            ),
          )}
          {hover && (
            <line x1={hover.px} x2={hover.px} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--ac-border-strong)" strokeWidth="1" strokeDasharray="3 3" />
          )}
        </svg>
        {hover && (
          <div
            className="chart-tooltip mono"
            style={{
              left: `min(${(hover.px / width) * 100}% + 14px, calc(100% - 180px))`,
              top: 8,
            }}
          >
            {hover.rows.map((row) => (
              <div key={row.label} className="tooltip-row">
                <span className="legend-dot" style={{ background: row.color }} aria-hidden="true" />
                <span className="tooltip-label">{row.label}</span>
                <span>
                  {xFormat(row.x)} · {yFormat(row.y)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
