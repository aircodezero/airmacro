/*
 * Formatage numérique : convention US (64,280.50) et USD, libellés français.
 */

const nfCache = new Map<string, Intl.NumberFormat>()

function nf(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options)
  let format = nfCache.get(key)
  if (!format) {
    format = new Intl.NumberFormat('en-US', options)
    nfCache.set(key, format)
  }
  return format
}

/** Prix en USD avec précision adaptée au niveau (0.0421 → 4 déc., 64 280 → 2 déc.). */
export function fmtUsd(value: number): string {
  const abs = Math.abs(value)
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6
  return nf({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
}

/** Nombre brut, précision fixe. */
export function fmtNum(value: number, digits = 2): string {
  return nf({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
}

/** Montant compact : 2.41T, 384.2B, 61.4M. */
export function fmtCompact(value: number, digits = 1): string {
  const abs = Math.abs(value)
  if (abs >= 1e12) return `${fmtNum(value / 1e12, digits)}T`
  if (abs >= 1e9) return `${fmtNum(value / 1e9, digits)}B`
  if (abs >= 1e6) return `${fmtNum(value / 1e6, digits)}M`
  if (abs >= 1e3) return `${fmtNum(value / 1e3, digits)}k`
  return fmtNum(value, digits)
}

/** Pourcentage signé à partir de points de pourcentage (1.78 → "+1.78%"). */
export function fmtPct(points: number, digits = 2): string {
  const sign = points > 0 ? '+' : points < 0 ? '−' : ''
  return `${sign}${fmtNum(Math.abs(points), digits)}%`
}

/** Pourcentage non signé (42.1 → "42.1%"). */
export function fmtPctPlain(points: number, digits = 1): string {
  return `${fmtNum(points, digits)}%`
}

/** Classe CSS selon le signe. */
export function signClass(value: number): string {
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return ''
}

export function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Relative time: "3h ago", "12 min ago". */
export function relativeTime(iso: string | number): string {
  const ts = typeof iso === 'number' ? iso : new Date(iso).getTime()
  if (Number.isNaN(ts)) return '—'
  const diffMs = Date.now() - ts
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}
