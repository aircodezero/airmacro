import type { Source } from '../lib/api'

/* ---------- Calendrier ---------- */

export type Impact = 'High' | 'Medium' | 'Low' | 'Holiday' | 'Info'

export type EventCategory = 'decision' | 'data' | 'presser' | 'speech' | 'minutes' | 'meeting'

export type EventKind =
  | 'fomc'
  | 'ecb'
  | 'boe'
  | 'boj'
  | 'cpi'
  | 'pce'
  | 'nfp'
  | 'gdp'
  | 'ism'
  | 'pmi'
  | 'claims'
  | 'jolts'
  | 'retail'
  | 'sentiment'
  | 'labor'
  | 'speech'
  | 'other'

export type Surprise = 'above' | 'below' | 'inline'

export interface Measure {
  name: string
  forecast: string | null
  previous: string | null
  actual: string | null
  actualSource?: string
  /** Éditeur officiel dont AirMacro lit ce chiffre (absent : aucune source ouverte). */
  actualFrom?: string
  surprise?: Surprise | null
}

export interface MeetingInfo {
  bank: 'Fed' | 'ECB'
  start: string
  end: string
  sep: boolean
  day1Ts: number
  decisionTs: number
}

export interface FomcDecision {
  action: 'hold' | 'hike' | 'cut'
  lower: number
  upper: number
  changePts: number
  vote: { for: number; against: number } | null
  url: string
}

export interface MacroEvent {
  id: string
  kind: EventKind
  category: EventCategory
  title: string
  country: string
  ts: number
  impact: Impact
  allDay: boolean
  forecast: string | null
  previous: string | null
  actual: string | null
  measures: Measure[]
  isReference: boolean
  sources: string[]
  meeting?: MeetingInfo
  links?: Array<{ label: string; url: string }>
  decision?: FomcDecision
  /** Éditeur officiel dont AirMacro lit le chiffre de la publication. */
  actualFrom?: string
}

export interface FamilyMeta {
  source: Source | null
  provider: string | null
  fetchedAt: string | null
  note: string | null
}

export interface PolicyMeeting {
  id: string
  start: string
  end: string
  sep: boolean
  decisionTs: number
  day1Ts: number
}

export interface CalendarData {
  weekOf: string
  window: { from: number; to: number }
  events: MacroEvent[]
  nextWeekPublished: boolean
  policy: {
    nextFomc: PolicyMeeting | null
    followingFomc: PolicyMeeting | null
    lastFomc: PolicyMeeting | null
    nextEcb: PolicyMeeting | null
  }
  families: Record<'calendar' | 'bls' | 'bea' | 'fed', FamilyMeta | null>
  counts: { total: number; high: number }
  parts: Record<string, Source | null>
}

/* ---------- Séries ---------- */

export interface SeriesPoint {
  d: string
  v: number
}

export type TileKey =
  | 'cpiYoY'
  | 'coreCpiYoY'
  | 'corePceYoY'
  | 'unrate'
  | 'nfp'
  | 'fedTarget'
  | 'y10'
  | 'spread10y3m'
  | 'vix'
  | 'dxy'
  | 'wti'
  | 'gdp'

export type FamilyKey = 'bls' | 'bea' | 'treasury' | 'nyfed' | 'fed' | 'vix' | 'dxy' | 'wti'

export interface Tile {
  key: TileKey
  label: string
  unit: '%' | 'k' | 'bp' | 'pts' | 'index' | '$/bbl'
  period: 'monthly' | 'quarterly' | 'daily'
  value: number
  date: string
  delta: number | null
  deltaUnit: 'pp' | 'k' | 'bp' | 'pts' | '%'
  deltaBase: string | null
  spark: number[]
  family: FamilyKey
  provider: string | null
  avg3?: number | null
  preliminary?: boolean
  inverted?: boolean | null
  lower?: number
  upper?: number
  effr?: { value: number; date: string } | null
  targetSource?: 'NY Fed' | 'Fed statement'
  variant?: 'dxy' | 'replica' | 'futures' | 'spot' | null
}

export interface PolicyData {
  target: { lower: number; upper: number; asOf: string; source: 'NY Fed' | 'Fed statement' } | null
  effr: { value: number; date: string } | null
  lastDecision: (Omit<FomcDecision, 'url'> & { date: string; url: string }) | null
  links: {
    statement: string | null
    statementDate: string | null
    minutes: string | null
    minutesTitle: string | null
  }
}

export interface SeriesData {
  tiles: Partial<Record<TileKey, Tile>>
  charts: {
    inflation: { cpiYoY: SeriesPoint[]; coreCpiYoY: SeriesPoint[]; corePceYoY: SeriesPoint[]; target: number }
    labor: { nfpMoM: SeriesPoint[]; unrate: SeriesPoint[] }
    rates: {
      y10: SeriesPoint[]
      m3: SeriesPoint[]
      spread10y3m: SeriesPoint[]
      fedTargetUpper: SeriesPoint[]
      fedTargetLower: SeriesPoint[]
      effr: SeriesPoint | null
    }
    growthRisk: { gdpQoQ: SeriesPoint[]; vix: SeriesPoint[]; dxy: SeriesPoint[]; wti: SeriesPoint[] }
  }
  policy: PolicyData
  meta: { sourcesBySerie: Partial<Record<TileKey, string | null>> }
  families: Record<FamilyKey, FamilyMeta | null>
  parts: Record<'inflation' | 'labor' | 'rates' | 'growthRisk', Source | null>
}

/* ---------- Sélection (fiche détaillée) ---------- */

export type MacroSelection = { type: 'event'; id: string } | { type: 'indicator'; key: TileKey }
