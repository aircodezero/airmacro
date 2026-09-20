import type { FamilyMeta, SeriesData, Tile, TileKey } from './types'
import { fmtDeltaBase, fmtIsoDate, fmtPeriod, fmtTileDelta, fmtTileValue } from './format'

export const TILE_ORDER: TileKey[] = [
  'cpiYoY',
  'coreCpiYoY',
  'corePceYoY',
  'unrate',
  'nfp',
  'gdp',
  'fedTarget',
  'y10',
  'spread10y3m',
  'vix',
  'dxy',
  'wti',
]

export const TILE_LABELS: Record<TileKey, string> = {
  cpiYoY: 'CPI YoY',
  coreCpiYoY: 'Core CPI YoY',
  corePceYoY: 'Core PCE YoY',
  unrate: 'Unemployment',
  nfp: 'Payrolls (NFP)',
  gdp: 'GDP QoQ (SAAR)',
  fedTarget: 'Fed funds target',
  y10: 'US 10Y yield',
  spread10y3m: '10Y–3M spread',
  vix: 'VIX',
  dxy: 'Dollar index',
  wti: 'WTI crude',
}

/**
 * Sparkline pleine largeur : teinte de fond, point courant accentué (pas de
 * jugement haussier/baissier). Traits en « non-scaling-stroke » pour rester
 * nets malgré l'étirement horizontal.
 */
export function TrendLine({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const width = 100
  const height = 24
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pad = 4
  const xy = values.map((v, i) => [
    pad + (i / (values.length - 1)) * (width - pad * 2),
    pad + (1 - (v - min) / span) * (height - pad * 2),
  ])
  const [lx, ly] = xy[xy.length - 1]
  return (
    <svg className="trendline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points={xy.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* segment de longueur nulle à bout rond = point circulaire malgré l'étirement */}
      <line x1={lx} y1={ly} x2={lx} y2={ly} className="trendline-halo" vectorEffect="non-scaling-stroke" />
      <line x1={lx} y1={ly} x2={lx} y2={ly} className="trendline-dot" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function subline(tile: Tile): string | null {
  switch (tile.key) {
    case 'nfp':
      return tile.avg3 != null ? `3-mo avg ${tile.avg3 > 0 ? '+' : tile.avg3 < 0 ? '−' : ''}${Math.abs(tile.avg3)}k${tile.preliminary ? ' · prelim.' : ''}` : null
    case 'fedTarget':
      return tile.effr ? `EFFR ${tile.effr.value.toFixed(2)}% (${fmtPeriod(tile.effr.date, 'daily')})` : null
    case 'spread10y3m':
      return tile.inverted ? 'Inverted curve' : 'Positive slope'
    case 'dxy':
      return tile.variant === 'replica' ? 'Replica from ECB rates' : 'ICE DXY'
    case 'wti':
      return tile.variant === 'spot' ? 'Cushing spot (EIA)' : 'Front-month future'
    case 'vix':
      return 'Cboe close'
    case 'y10':
      return 'Treasury CMT'
    case 'gdp':
      return 'Real, annualized'
    case 'corePceYoY':
      return 'Fed’s preferred gauge'
    default:
      return null
  }
}

export function tileAriaLabel(tile: Tile): string {
  const delta = fmtTileDelta(tile)
  const base = fmtDeltaBase(tile)
  return [
    `${tile.label} ${fmtTileValue(tile)}`,
    tile.key === 'fedTarget' ? `as of ${fmtIsoDate(tile.date)}` : fmtPeriod(tile.date, tile.period),
    delta ? `change ${delta} ${base ?? ''}`.trim() : null,
    subline(tile),
    'Open details',
  ]
    .filter(Boolean)
    .join('. ')
}

const SOURCE_NOTE: Record<string, string> = { cache: 'cached', seed: 'sample' }

function TileCard({ tile, family, onOpen }: { tile: Tile; family: FamilyMeta | null; onOpen: (key: TileKey) => void }) {
  const value = fmtTileValue(tile)
  const delta = fmtTileDelta(tile)
  const base = fmtDeltaBase(tile)
  const sub = subline(tile)
  const note = family?.source && family.source !== 'live' ? SOURCE_NOTE[family.source] : null
  return (
    <button
      type="button"
      className="mtile"
      onClick={() => onOpen(tile.key)}
      aria-haspopup="dialog"
      aria-label={`${tileAriaLabel(tile)}${note ? ` (${note} data)` : ''}`}
      title={tile.provider ?? undefined}
    >
      <span className="mtile-head">
        <span className="mtile-label">{tile.label}</span>
        {note && <span className={`mtile-note mtile-note-${family?.source}`}>{note}</span>}
      </span>
      <span className={value.length > 8 ? 'mtile-value is-long' : 'mtile-value'}>{value}</span>
      <span className="mtile-delta mono">
        {delta ?? '—'} {base && <span className="muted">{base}</span>}
      </span>
      <span className="mtile-date">
        {tile.key === 'fedTarget' ? `as of ${fmtPeriod(tile.date, 'daily')}` : fmtPeriod(tile.date, tile.period)}
        {sub && <span className="mtile-sub"> · {sub}</span>}
      </span>
      <TrendLine values={tile.spark} />
    </button>
  )
}

export function IndicatorTiles({ data, onOpen }: { data: SeriesData; onOpen: (key: TileKey) => void }) {
  return (
    <div className="mtiles">
      {TILE_ORDER.map((key) => {
        const tile = data.tiles[key]
        if (!tile) {
          return (
            <div key={key} className="mtile mtile-missing" role="note">
              <span className="mtile-label">{TILE_LABELS[key]}</span>
              <span className="mtile-value muted">—</span>
              <span className="mtile-date">source unavailable</span>
            </div>
          )
        }
        return <TileCard key={key} tile={tile} family={data.families[tile.family] ?? null} onOpen={onOpen} />
      })}
    </div>
  )
}
