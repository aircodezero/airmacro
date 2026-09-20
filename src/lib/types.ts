import type { Source } from './api'

/* ---------- Marché / vue d'ensemble ---------- */

export interface GlobalStats {
  totalMcapUsd: number | null
  totalVolumeUsd: number | null
  btcDominancePct: number | null
  ethDominancePct: number | null
  mcapChange24hPct: number | null
}

export interface CmeCurrent {
  futurePrice: number
  spotPrice: number
  premiumPct: number | null
  basisAnnualizedPct: number | null
  regime: 'contango' | 'backwardation' | null
  estimatedExpiry: string
  daysToExpiry: number
}

export interface OverviewData {
  global: GlobalStats | null
  stablecoinDominancePct: number | null
  fng: { value: number; classification: string | null } | null
  cci30: { level: number; date: string; chg24hPct: number | null; isReplica: boolean } | null
  cme: CmeCurrent | null
  btcSpot: number | null
  parts: Record<string, Source | null>
}

export interface MarketItem {
  id: string
  symbol: string
  name: string
  rank: number
  price: number
  chg24hPct: number | null
  chg7dPct: number | null
  chg30dPct: number | null
  mcap: number
  volume24h: number
  athChangePct: number | null
  spark7d: number[]
}

export interface MarketsData {
  items: MarketItem[]
}

export interface Candle {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface OhlcData {
  symbol: string
  candles: Candle[]
  isReplica?: boolean
}

/* ---------- Signaux ---------- */

export type Rating = 'BUY' | 'HOLD' | 'SELL' | 'NA'

export interface ScoreComponent {
  label: string
  score: number | null
  detail: string
}

export interface ScoreFamily {
  label: string
  weight: number
  score: number | null
  components: ScoreComponent[]
}

export interface SignalMetrics {
  rsi14: number | null
  sma50: number | null
  sma200: number | null
  priceVsSma200Pct: number | null
  priceVsSma50Pct: number | null
  aboveSma50: boolean | null
  aboveSma200: boolean | null
  macdHistogram: number | null
  ret30dPct: number | null
  ret90dPct: number | null
  vol30dAnnualizedPct: number | null
  drawdownFromHighPct: number | null
  relStrengthVsBtc30dPct: number | null
}

export interface SignalItem extends MarketItem {
  candleSource: Source | null
  score: number | null
  rating: Rating
  partial: boolean
  families: {
    trend: ScoreFamily
    momentum: ScoreFamily
    context: ScoreFamily
    risk: ScoreFamily
  } | null
  metrics: SignalMetrics | null
  fundingAnnualizedPct: number | null
  reason?: string | null
}

export interface SignalsData {
  items: SignalItem[]
  counts: { buy: number; hold: number; sell: number; na: number }
  breadth: { aboveSma50Pct: number | null; positive7dPct: number | null; sample: number }
  fngValue: number | null
  universeNote: string
  thresholds: { buy: number; sell: number }
}

/* ---------- Sentiment ---------- */

export interface GaugeComponent {
  key: string
  label: string
  weight: number
  value: number
  detail?: string
}

export interface SentimentData {
  fng: {
    value: number
    classification: string | null
    history: Array<{ t: number; value: number; classification: string | null }>
  } | null
  funding: { avg8hPct: number | null; annualizedPct: number | null; sample: number } | null
  breadth: {
    positive7dPct: number | null
    aboveSma50Pct: number | null
    sample: number
    universeSample?: number | null
  }
  dominance: { btcPct: number | null; ethPct: number | null; stablecoinsPct: number | null } | null
  composite: { score: number; label: string; components: GaugeComponent[] } | null
  parts: Record<string, Source | null>
}

/* ---------- Cycles ---------- */

export interface CyclesData {
  meta: { lastDate: string; lastPrice: number; points: number }
  phase: { halving: string; daysSince: number; pctOfTypicalCycle: number; nextEstimate: string }
  halvings: string[]
  nextHalvingEstimate: string
  overlay: Array<{ halving: string; current: boolean; points: Array<{ x: number; y: number }> }>
  piCycle: {
    gapPct: number
    triggered: boolean
    crossings: string[]
    series: Array<{ d: string; price: number; sma111: number; sma350x2: number }>
  } | null
  mayer: {
    current: number
    percentile: number
    bands: { low: number; high: number }
    series: Array<{ d: string; m: number }>
  } | null
  wma200: {
    current: number
    distancePct: number
    series: Array<{ d: string; price: number; wma: number }>
  } | null
  mvrv: {
    current: number
    zones: { low: number; high: number }
    series: Array<{ d: string; v: number }>
  } | null
  powerLaw: {
    slope: number
    r2: number
    positionPercentile: number
    series: Array<{ d: string; price: number; fit: number; lower: number; upper: number }>
  } | null
  seasonality: { matrix: Record<string, Array<number | null>>; monthlyMeans: Array<number | null> }
  gauge: { score: number; label: string; components: GaugeComponent[] } | null
  summary: string
}

/* ---------- Funding & Basis ---------- */

export interface FundingCell {
  rate8hPct: number
  nextFundingTime?: number | null
  oiUsd?: number | null
}

export interface FundingRow {
  symbol: string
  price: number | null
  binance: FundingCell | null
  okx: FundingCell | null
  bybit: FundingCell | null
}

export interface FundingData {
  rows: FundingRow[]
  history: Record<'BTC' | 'ETH', Array<{ t: number; rate8hPct: number }>>
  aggregate: { avg8hPct: number | null; annualizedPct: number | null; sample: number }
}

export interface DeribitCurvePoint {
  instrument: string
  expiry: string
  daysToExpiry: number
  markPrice: number
  openInterest: number | null
  basisAnnualizedPct: number | null
}

export interface BasisData {
  deribit: Record<'BTC' | 'ETH', { indexPrice: number; curve: DeribitCurvePoint[] } | null>
  cme: Record<
    'BTC' | 'ETH',
    { current: CmeCurrent | null; history: Array<{ d: string; premiumPct: number }> } | null
  >
  perp: Record<'BTC' | 'ETH', { markPrice: number; indexPrice: number; premiumPct: number } | null> | null
  parts: Record<string, Source | null>
}

/* ---------- Classe d'actifs ---------- */

export interface EquitiesData {
  series: Record<string, Array<{ d: string; c: number }>>
  failed: string[]
  /** vrai si les séries actions proviennent d'un seed simulé (sources indisponibles) */
  simulated?: boolean
  cci30IsReplica: boolean
  parts: Record<string, Source | null>
}

/* ---------- CCi30 ---------- */

export interface Cci30Data {
  history: Array<{ d: string; c: number }>
  stats: {
    level: number | null
    date: string | null
    chg24hPct: number | null
    ytdPct: number | null
    oneYearPct: number | null
    maxDrawdownPct: number
    vol30dAnnualizedPct: number | null
  }
  isReplica: boolean
}

/* ---------- Actualités ---------- */

export interface NewsItem {
  id: string
  title: string
  url: string
  source: string
  publishedAt: string
  categories: string[]
  excerpt?: string
}

export interface NewsData {
  items: NewsItem[]
}
