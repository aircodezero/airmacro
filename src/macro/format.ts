/*
 * Formatage AirMacro : heures dans le fuseau du navigateur (avec libellé UTC±),
 * périodes des séries, libellés de zones et de catégories. Interface en anglais.
 */
import { formatUtcOffset } from '../../shared/analytics/macrotime.mjs'
import type { EventKind, FomcDecision, Impact, MacroEvent, Tile } from './types'

const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const longDayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
const utcFmt = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' })
const nyFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const shortDateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const fullDateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

export const browserTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'local'

/** « UTC+2 » pour le fuseau du navigateur à l'instant donné. */
export const localOffsetLabel = (ts: number): string => formatUtcOffset(-new Date(ts).getTimezoneOffset())

export const fmtTime = (ts: number): string => timeFmt.format(ts)
export const fmtDay = (ts: number): string => dayFmt.format(ts)
export const fmtLongDay = (ts: number): string => longDayFmt.format(ts)
export const fmtUtcTime = (ts: number): string => `${utcFmt.format(ts)} UTC`
export const fmtNyTime = (ts: number): string => `${nyFmt.format(ts)} ET`

/** « Wed, Sep 16 · 8:00 PM (UTC+2) » */
export const fmtLocalDateTime = (ts: number): string => `${fmtDay(ts)} · ${fmtTime(ts)} (${localOffsetLabel(ts)})`

/** Clé 'YYYY-MM-DD' du jour local du navigateur. */
export function localDayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const civilLongFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })

/** Date civile 'YYYY-MM-DD' (indépendante du fuseau) → « Tuesday, September 15 ». */
export const fmtCivilLongDay = (isoDate: string): string => civilLongFmt.format(Date.parse(`${isoDate.slice(0, 10)}T12:00:00Z`))

/**
 * Jour d'un événement : les marqueurs « jour 1 » de réunion sont ancrés à minuit
 * heure de la banque centrale — ils gardent leur date civile, quel que soit le fuseau.
 */
export const eventDayKey = (e: Pick<MacroEvent, 'ts' | 'allDay' | 'meeting'>): string =>
  e.allDay && e.meeting?.start ? e.meeting.start : localDayKey(e.ts)

export function relativeDayLabel(dayKey: string, now: number): string | null {
  const today = localDayKey(now)
  if (dayKey === today) return 'Today'
  if (dayKey === localDayKey(now + 86_400_000)) return 'Tomorrow'
  if (dayKey === localDayKey(now - 86_400_000)) return 'Yesterday'
  return null
}

/** Période d'une observation : mensuelle « Aug 2026 », trimestrielle « Q2 2026 », quotidienne « Sep 15 ». */
export function fmtPeriod(d: string, period: Tile['period']): string {
  const ts = Date.parse(`${d}T00:00:00Z`)
  if (!Number.isFinite(ts)) return d
  if (period === 'monthly') return monthFmt.format(ts)
  if (period === 'quarterly') return `Q${Math.floor(Number(d.slice(5, 7)) / 3) + 1} ${d.slice(0, 4)}`
  return shortDateFmt.format(ts)
}

export const fmtIsoDate = (d: string): string => {
  const ts = Date.parse(`${d.slice(0, 10)}T00:00:00Z`)
  return Number.isFinite(ts) ? fullDateFmt.format(ts) : d
}

export const COUNTRY_CODES: Record<string, string> = {
  USD: 'US',
  EUR: 'EZ',
  GBP: 'UK',
  JPY: 'JP',
  CNY: 'CN',
  CAD: 'CA',
  All: 'GL',
}

export const COUNTRY_NAMES: Record<string, string> = {
  USD: 'United States',
  EUR: 'Euro area',
  GBP: 'United Kingdom',
  JPY: 'Japan',
  CNY: 'China',
  CAD: 'Canada',
  All: 'Global',
}

export const KIND_LABELS: Record<EventKind, string> = {
  fomc: 'Fed',
  ecb: 'ECB',
  boe: 'BoE',
  boj: 'BoJ',
  cpi: 'Inflation',
  pce: 'Inflation',
  nfp: 'Jobs',
  claims: 'Jobs',
  jolts: 'Jobs',
  labor: 'Jobs',
  gdp: 'Growth',
  ism: 'Activity',
  pmi: 'Activity',
  retail: 'Consumer',
  sentiment: 'Sentiment',
  speech: 'Speech',
  other: 'Data',
}

export const IMPACT_LABELS: Record<Impact, string> = {
  High: 'High',
  Medium: 'Medium',
  Low: 'Low',
  Holiday: 'Holiday',
  Info: 'Info',
}

const num = (value: number, digits: number) =>
  value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** Valeur principale d'une tuile. */
export function fmtTileValue(tile: Tile): string {
  switch (tile.key) {
    case 'fedTarget':
      return tile.lower != null && tile.upper != null ? `${num(tile.lower, 2)}–${num(tile.upper, 2)}%` : `${num(tile.value, 2)}%`
    case 'nfp':
      return `${tile.value > 0 ? '+' : tile.value < 0 ? '−' : ''}${num(Math.abs(tile.value), 0)}k`
    case 'spread10y3m':
      return `${tile.value > 0 ? '+' : tile.value < 0 ? '−' : ''}${num(Math.abs(tile.value), 0)} bp`
    case 'wti':
      return `$${num(tile.value, 2)}`
    case 'vix':
    case 'dxy':
      return num(tile.value, 2)
    case 'y10':
      return `${num(tile.value, 2)}%`
    default:
      return `${num(tile.value, 1)}%`
  }
}

const DELTA_DIGITS: Record<Tile['deltaUnit'], number> = { pp: 1, k: 0, bp: 0, pts: 2, '%': 2 }

/** Variation signée avec unité : « +0.1 pp », « −141k », « +3 bp », « +0.14% ». */
export function fmtTileDelta(tile: Tile): string | null {
  if (tile.delta == null) return null
  const digits = tile.key === 'fedTarget' ? 2 : DELTA_DIGITS[tile.deltaUnit]
  const sign = tile.delta > 0 ? '+' : tile.delta < 0 ? '−' : '±'
  const abs = num(Math.abs(tile.delta), digits)
  switch (tile.deltaUnit) {
    case 'k':
      return `${sign}${abs}k`
    case '%':
      return `${sign}${abs}%`
    default:
      return `${sign}${abs} ${tile.deltaUnit}`
  }
}

/** Base de comparaison de la variation (« vs Jul 2026 »). */
export function fmtDeltaBase(tile: Tile): string | null {
  if (!tile.deltaBase) return null
  if (tile.key === 'fedTarget') return `vs ${fmtIsoDate(tile.deltaBase)}`
  if (tile.key === 'nfp') return `vs ${fmtPeriod(tile.deltaBase, tile.period)} print`
  return `vs ${fmtPeriod(tile.deltaBase, tile.period)}`
}

export const surpriseLabel = (s: 'above' | 'below' | 'inline' | null | undefined): string | null =>
  s === 'above' ? 'above forecast' : s === 'below' ? 'below forecast' : s === 'inline' ? 'in line with forecast' : null

export const surpriseGlyph = (s: 'above' | 'below' | 'inline' | null | undefined): string =>
  s === 'above' ? '▲' : s === 'below' ? '▼' : s === 'inline' ? '=' : ''

const pct2 = (v: number) => `${v.toFixed(2)}%`

/** « Rates held at 3.50–3.75% », « Raised by 25 bp to 3.75–4.00% ». */
export function decisionSentence(d: Pick<FomcDecision, 'action' | 'lower' | 'upper' | 'changePts'>): string {
  const range = `${pct2(d.lower)}–${pct2(d.upper)}`
  const bp = Math.round(Math.abs(d.changePts) * 100)
  if (d.action === 'hold') return `Rates held at ${range}`
  return `${d.action === 'hike' ? 'Raised' : 'Cut'} by ${bp} bp to ${range}`
}
