/*
 * Résolveurs canoniques : une clé de cache par source de données, partagée
 * entre tous les endpoints. Chaque résolveur renvoie une enveloppe
 * { data, source, provider, asOf }.
 */
import { resolveData } from './cache.mjs'
import { HEADLINE_PERPS, EQUITY_SYMBOLS } from './universe.mjs'
import * as coingecko from './providers/coingecko.mjs'
import * as binance from './providers/binance.mjs'
import * as bybit from './providers/bybit.mjs'
import * as okx from './providers/okx.mjs'
import * as deribit from './providers/deribit.mjs'
import * as klines from './providers/klines.mjs'
import * as cci30 from './providers/cci30.mjs'
import * as coinmetrics from './providers/coinmetrics.mjs'
import * as stooq from './providers/stooq.mjs'
import * as yahoo from './providers/yahoo.mjs'
import { fearGreedHistory } from './providers/fng.mjs'
import { latestNews } from './providers/rssnews.mjs'
import { annualizedBasisPct } from '../../shared/analytics/basis.mjs'
import { sqrtMcapIndex } from '../../shared/analytics/replica.mjs'
import { isExcludedFromSignals } from './universe.mjs'

const MIN = 60_000
const HOUR = 3_600_000

export const rGlobal = () =>
  resolveData({ key: 'global', ttlMs: MIN, live: () => coingecko.globalStats(), seed: 'global' })

export const rMarkets = () =>
  resolveData({
    key: 'markets',
    ttlMs: MIN,
    live: async () => {
      const result = await coingecko.markets(50)
      klines.registerCoinIds(result.data.items)
      return result
    },
    seed: 'markets',
  })

export const rFng = () =>
  resolveData({
    key: 'fng',
    ttlMs: 30 * MIN,
    live: async () => ({ provider: 'alternative.me', data: { history: await fearGreedHistory(140) } }),
    seed: 'fng',
  })

/** Réplique interne « AirCrypto 30 » (√mcap, pondérations courantes) — repli du CCi30. */
async function buildCci30Replica() {
  const markets = await rMarkets()
  const universe = (markets.data.items ?? [])
    .filter((item) => !isExcludedFromSignals(item.symbol))
    .slice(0, 30)
  const envs = await Promise.all(universe.map((item) => rOhlc(item.symbol).catch(() => null)))
  const seriesBySymbol = {}
  const mcapBySymbol = {}
  universe.forEach((item, i) => {
    const candles = envs[i]?.data?.candles
    if (candles?.length > 60) {
      seriesBySymbol[item.symbol] = candles.map((k) => ({
        d: new Date(k.t * 1000).toISOString().slice(0, 10),
        c: k.c,
      }))
      mcapBySymbol[item.symbol] = item.mcap
    }
  })
  const replica = sqrtMcapIndex(seriesBySymbol, mcapBySymbol)
  if (!replica) return null
  return replica.rows.map((r) => ({ d: r.d, o: r.c, h: r.c, l: r.c, c: r.c }))
}

export const rCci30 = () =>
  resolveData({
    key: 'cci30',
    ttlMs: 6 * HOUR,
    live: async () => {
      try {
        return { provider: 'cci30.com', data: { rows: await cci30.indexHistory(), isReplica: false } }
      } catch (err) {
        const rows = await buildCci30Replica()
        if (rows) {
          return { provider: 'internal AirCrypto 30 replica (√mcap)', data: { rows, isReplica: true } }
        }
        throw err
      }
    },
    seed: 'cci30',
  })

export const rOhlc = (base) =>
  resolveData({
    key: `ohlc:${base}`,
    ttlMs: 5 * MIN,
    live: async () => {
      const result = await klines.dailyCandles(base, 400)
      return { provider: result.provider, data: { symbol: base, candles: result.candles } }
    },
    seed: `ohlc-${base}`,
  })

export const rBtcLong = () =>
  resolveData({
    key: 'btc-long',
    ttlMs: 12 * HOUR,
    live: async () => ({ provider: 'coinmetrics', data: { rows: await coinmetrics.btcLongHistory() } }),
    seed: 'btc-long',
  })

export const rCmeChart = (base) =>
  resolveData({
    key: `cme:${base}`,
    ttlMs: 10 * MIN,
    live: async () => ({ provider: 'yahoo (CME)', data: await yahoo.chartDaily(`${base}=F`, '1y') }),
    seed: `cme-${base.toLowerCase()}`,
  })

export const rDeribitCurve = (currency) =>
  resolveData({
    key: `deribit:${currency}`,
    ttlMs: 5 * MIN,
    live: async () => {
      const { indexPrice, points } = await deribit.futuresCurve(currency)
      const curve = points.map((p) => ({
        ...p,
        basisAnnualizedPct: annualizedBasisPct(p.markPrice, indexPrice, p.daysToExpiry),
      }))
      return { provider: 'deribit', data: { indexPrice, curve } }
    },
    seed: `deribit-${currency.toLowerCase()}`,
  })

export const rNews = () =>
  resolveData({
    key: 'news',
    ttlMs: 10 * MIN,
    live: async () => {
      const result = await latestNews(60)
      return { provider: `RSS (${result.feedsOk}/${result.feedsTotal} feeds)`, data: { items: result.items } }
    },
    seed: 'news',
  })

/* ---------- Funding (Binance primaire, OKX + Bybit si joignables) ---------- */

async function fundingComputeLive() {
  const [premResult, oiResults, okxResults, bybitResult, historyResults] = await Promise.all([
    binance.premiumIndexAll(),
    Promise.allSettled(HEADLINE_PERPS.map((base) => binance.openInterest(base))),
    Promise.allSettled(HEADLINE_PERPS.map((base) => okx.fundingRate(base))),
    bybit.linearTickers().catch(() => null),
    Promise.allSettled([binance.fundingHistory('BTC', 270), binance.fundingHistory('ETH', 270)]),
  ])

  const rows = HEADLINE_PERPS.map((base, i) => {
    const b = premResult.get(`${base}USDT`)
    const oiQty = oiResults[i].status === 'fulfilled' ? oiResults[i].value : null
    const okxRow = okxResults[i].status === 'fulfilled' ? okxResults[i].value : null
    const bybitRow = bybitResult?.get(`${base}USDT`) ?? null
    return {
      symbol: base,
      price: b?.markPrice ?? bybitRow?.markPrice ?? null,
      binance: b
        ? {
            rate8hPct: b.fundingRate8h * 100,
            nextFundingTime: b.nextFundingTime,
            oiUsd: oiQty != null && b.markPrice ? oiQty * b.markPrice : null,
          }
        : null,
      okx: okxRow ? { rate8hPct: okxRow.fundingRate8h * 100, nextFundingTime: okxRow.nextFundingTime } : null,
      bybit: bybitRow
        ? {
            rate8hPct: bybitRow.fundingRate8h * 100,
            nextFundingTime: bybitRow.nextFundingTime,
            oiUsd: bybitRow.openInterestValueUsd,
          }
        : null,
    }
  })

  const rates = rows
    .map((row) => row.binance?.rate8hPct ?? row.bybit?.rate8hPct ?? row.okx?.rate8hPct)
    .filter((rate) => Number.isFinite(rate))
  const avg8hPct = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null

  const history = {
    BTC: historyResults[0].status === 'fulfilled'
      ? historyResults[0].value.map((r) => ({ t: r.t, rate8hPct: r.rate8h * 100 }))
      : [],
    ETH: historyResults[1].status === 'fulfilled'
      ? historyResults[1].value.map((r) => ({ t: r.t, rate8hPct: r.rate8h * 100 }))
      : [],
  }

  const exchangesOk = ['binance', bybitResult ? 'bybit' : null, okxResults.some((r) => r.status === 'fulfilled') ? 'okx' : null]
    .filter(Boolean)

  return {
    provider: exchangesOk.join('+'),
    data: {
      rows,
      history,
      aggregate: {
        avg8hPct,
        annualizedPct: avg8hPct != null ? avg8hPct * 3 * 365 : null,
        sample: rates.length,
      },
    },
  }
}

export const rFunding = () =>
  resolveData({ key: 'funding', ttlMs: 5 * MIN, live: fundingComputeLive, seed: 'funding' })

/* ---------- Perp basis (mark vs index Binance) ---------- */

export const rPerpBasis = () =>
  resolveData({
    key: 'perp-basis',
    ttlMs: 5 * MIN,
    live: async () => {
      const prem = await binance.premiumIndexAll()
      const pick = (base) => {
        const row = prem.get(`${base}USDT`)
        if (!row || !(row.indexPrice > 0)) return null
        return {
          markPrice: row.markPrice,
          indexPrice: row.indexPrice,
          premiumPct: (row.markPrice / row.indexPrice - 1) * 100,
        }
      }
      return { provider: 'binance', data: { BTC: pick('BTC'), ETH: pick('ETH') } }
    },
    seed: 'basis-perp',
  })

/* ---------- Actions / indices (Stooq primaire, Yahoo repli) ---------- */

async function equitiesComputeLive() {
  // Séquentiel + espacement : Stooq et Yahoo throttlent les rafales.
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const series = {}
  const failed = []
  let stooqCount = 0
  let yahooCount = 0
  for (const symbol of EQUITY_SYMBOLS) {
    let entry = null
    try {
      entry = { rows: await stooq.dailyCloses(symbol, 640), via: 'stooq' }
    } catch {
      try {
        const chart = await yahoo.chartDaily(symbol, '2y')
        entry = { rows: chart.rows, via: 'yahoo' }
      } catch {
        entry = null
      }
    }
    if (entry && entry.rows.length >= 60) {
      series[symbol] = entry.rows
      if (entry.via === 'stooq') stooqCount++
      else yahooCount++
    } else {
      failed.push(symbol)
    }
    await sleep(300)
  }
  if (Object.keys(series).length < 4) throw new Error(`equities: trop peu de séries (${Object.keys(series).length})`)
  return {
    provider: `stooq (${stooqCount})${yahooCount ? ` + yahoo (${yahooCount})` : ''}`,
    data: { series, failed },
  }
}

export const rEquities = () =>
  resolveData({ key: 'equities', ttlMs: 30 * MIN, live: equitiesComputeLive, seed: 'equities' })
