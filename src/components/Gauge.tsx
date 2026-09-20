/*
 * Jauge semi-circulaire 0–100. La valeur est toujours doublée d'un texte —
 * la couleur ne porte jamais l'information seule.
 */

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) }
}

function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number) {
  const start = polar(cx, cy, r, fromDeg)
  const end = polar(cx, cy, r, toDeg)
  const large = Math.abs(fromDeg - toDeg) > 180 ? 1 : 0
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
}

export function Gauge({
  value,
  label,
  detail,
  color,
  width = 168,
}: {
  value: number
  label: string
  detail?: string
  color: string
  width?: number
}) {
  const clamped = Math.min(100, Math.max(0, value))
  const r = width / 2 - 10
  const cx = width / 2
  const cy = width / 2 - 4
  const angle = 180 - clamped * 1.8
  const needle = polar(cx, cy, r - 7, angle)
  const height = cy + 12

  return (
    <figure
      className="gauge"
      role="img"
      aria-label={`${label}: ${Math.round(clamped)} out of 100${detail ? ` — ${detail}` : ''}`}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <path d={arcPath(cx, cy, r, 180, 0)} fill="none" stroke="var(--ac-border)" strokeWidth="7" strokeLinecap="round" />
        {clamped > 0.5 && (
          <path d={arcPath(cx, cy, r, 180, angle)} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" />
        )}
        <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke="var(--ac-ink)" strokeWidth="1.5" />
        <circle cx={cx} cy={cy} r="3" fill="var(--ac-ink)" />
        <text
          x={cx}
          y={cy - r / 2.6}
          textAnchor="middle"
          fill="var(--ac-ink)"
          style={{ font: `600 ${Math.round(width / 6.5)}px var(--ac-font-mono)` }}
        >
          {Math.round(clamped)}
        </text>
      </svg>
      <figcaption>
        <span className="gauge-label">{label}</span>
        {detail && <span className="gauge-detail">{detail}</span>}
      </figcaption>
    </figure>
  )
}
