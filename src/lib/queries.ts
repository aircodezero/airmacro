import { queryOptions } from '@tanstack/react-query'
import { getJson } from './api'
import type {
  BasisData,
  Cci30Data,
  CyclesData,
  EquitiesData,
  FundingData,
  MarketsData,
  NewsData,
  OhlcData,
  OverviewData,
  SentimentData,
  SignalsData,
} from './types'

const MIN = 60_000

export const qOverview = () =>
  queryOptions({
    queryKey: ['overview'],
    queryFn: () => getJson<OverviewData>('/api/overview'),
    refetchInterval: MIN,
  })

export const qMarkets = () =>
  queryOptions({
    queryKey: ['markets'],
    queryFn: () => getJson<MarketsData>('/api/markets'),
    refetchInterval: MIN,
  })

export const qOhlc = (symbol: string) =>
  queryOptions({
    queryKey: ['ohlc', symbol],
    queryFn: () => getJson<OhlcData>(`/api/ohlc?symbol=${encodeURIComponent(symbol)}&days=400`),
    refetchInterval: 5 * MIN,
    staleTime: 4 * MIN,
  })

export const qSignals = () =>
  queryOptions({
    queryKey: ['signals'],
    queryFn: () => getJson<SignalsData>('/api/signals'),
    refetchInterval: 10 * MIN,
    staleTime: 5 * MIN,
  })

export const qSentiment = () =>
  queryOptions({
    queryKey: ['sentiment'],
    queryFn: () => getJson<SentimentData>('/api/sentiment'),
    refetchInterval: 10 * MIN,
    staleTime: 5 * MIN,
  })

export const qCycles = () =>
  queryOptions({
    queryKey: ['cycles'],
    queryFn: () => getJson<CyclesData>('/api/cycles'),
    staleTime: 60 * MIN,
    refetchInterval: 6 * 60 * MIN,
  })

export const qFunding = () =>
  queryOptions({
    queryKey: ['funding'],
    queryFn: () => getJson<FundingData>('/api/funding'),
    refetchInterval: 5 * MIN,
  })

export const qBasis = () =>
  queryOptions({
    queryKey: ['basis'],
    queryFn: () => getJson<BasisData>('/api/basis'),
    refetchInterval: 5 * MIN,
  })

export const qEquities = () =>
  queryOptions({
    queryKey: ['equities'],
    queryFn: () => getJson<EquitiesData>('/api/equities'),
    refetchInterval: 30 * MIN,
    staleTime: 15 * MIN,
  })

export const qCci30 = () =>
  queryOptions({
    queryKey: ['cci30'],
    queryFn: () => getJson<Cci30Data>('/api/cci30'),
    staleTime: 60 * MIN,
    refetchInterval: 6 * 60 * MIN,
  })

export const qNews = () =>
  queryOptions({
    queryKey: ['news'],
    queryFn: () => getJson<NewsData>('/api/news'),
    refetchInterval: 10 * MIN,
  })
