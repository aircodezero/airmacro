/*
 * Endpoints /api/* : composition des sources canoniques en enveloppes
 * { data, source, provider, asOf } avec sous-parties tracées (data.parts).
 */
import { isOffline, worstSource, cacheInfo } from '../lib/cache.mjs'
import { upstreamStats } from '../lib/http.mjs'
import { part, composed, wrap, nowIso } from './util.mjs'
import { isStable, EQUITY_SYMBOLS } from '../lib/universe.mjs'
import {
  rGlobal,
  rMarkets,
  rFng,
  rCci30,
  rOhlc,
  rCmeChart,
  rDeribitCurve,
  rFunding,
  rPerpBasis,
  rEquities,
  rNews,
} from '../lib/sources.mjs'
import { rSignals } from '../lib/compute/signals.mjs'
import { rCycles } from '../lib/compute/cycles.mjs'
import { annualizedBasisPct, simplePremiumPct, cmeFrontExpiry, basisRegime } from '../../shared/analytics/basis.mjs'
import { compositeSentiment } from '../../shared/analytics/sentiment.mjs'

/* ---------- Compositions ---------- */

function cci30LastLevels(rows) {
  if (!rows?.length) return null
  const last = rows[rows.length - 1]
  const prev = rows.length > 1 ? rows[rows.length - 2] : null
  return {
    level: last.c,
    date: last.d,
    chg24hPct: prev ? (last.c / prev.c - 1) * 100 : null,
  }
}

function marketPrice(marketsEnv, symbol) {
  const item = marketsEnv?.data?.items?.find((i) => i.symbol === symbol)
  return item?.price ?? null
}

function cmeCurrent(chartEnv, spot) {
  const future = chartEnv?.data?.lastPrice
  if (!(future > 0) || !(spot > 0)) return null
  const expiry = cmeFrontExpiry()
  const daysToExpiry = Math.max(1, (expiry.getTime() - Date.now()) / 86_400_000)
  const annualized = annualizedBasisPct(future, spot, daysToExpiry)
  return {
    futurePrice: future,
    spotPrice: spot,
    premiumPct: simplePremiumPct(future, spot),
    basisAnnualizedPct: annualized,
    regime: basisRegime(annualized),
    estimatedExpiry: expiry.toISOString().slice(0, 10),
    daysToExpiry: Math.round(daysToExpiry * 10) / 10,
  }
}

/** Prime CME quotidienne (non annualisée) : future vs clôture spot du même jour. */
function cmeHistory(chartEnv, candlesEnv) {
  const rows = chartEnv?.data?.rows
  const candles = candlesEnv?.data?.candles
  if (!rows?.length || !candles?.length) return []
  const spotByDate = new Map(candles.map((k) => [new Date(k.t * 1000).toISOString().slice(0, 10), k.c]))
  const out = []
  for (const row of rows) {
    const spot = spotByDate.get(row.d)
    if (spot > 0 && row.c > 0) out.push({ d: row.d, premiumPct: simplePremiumPct(row.c, spot) })
  }
  return out
}

async function overviewHandler() {
  const [global, fng, cci, cme, markets] = await Promise.all([
    part(rGlobal()),
    part(rFng()),
    part(rCci30()),
    part(rCmeChart('BTC')),
    part(rMarkets()),
  ])

  const fngHistory = fng?.data?.history ?? []
  const fngLast = fngHistory.length ? fngHistory[fngHistory.length - 1] : null
  const spotBtc = marketPrice(markets, 'BTC')

  const stableShare = (() => {
    const items = markets?.data?.items ?? []
    const total = global?.data?.totalMcapUsd
    if (!items.length || !(total > 0)) return null
    const stables = items.filter((i) => isStable(i.symbol)).reduce((acc, i) => acc + (i.mcap ?? 0), 0)
    return (stables / total) * 100
  })()

  return composed(
    {
      global: global?.data ?? null,
      stablecoinDominancePct: stableShare,
      fng: fngLast ? { value: fngLast.value, classification: fngLast.classification } : null,
      cci30: cci ? { ...cci30LastLevels(cci.data.rows), isReplica: cci.data.isReplica ?? false } : null,
      cme: cmeCurrent(cme, spotBtc),
      btcSpot: spotBtc,
    },
    {
      global: global?.source ?? null,
      fng: fng?.source ?? null,
      cci30: cci?.source ?? null,
      cme: cme && markets ? worstSource([cme.source, markets.source]) : null,
    },
  )
}

async function basisHandler() {
  const [deribitBtc, deribitEth, cmeBtc, cmeEth, perp, markets, btcCandles, ethCandles] = await Promise.all([
    part(rDeribitCurve('BTC')),
    part(rDeribitCurve('ETH')),
    part(rCmeChart('BTC')),
    part(rCmeChart('ETH')),
    part(rPerpBasis()),
    part(rMarkets()),
    part(rOhlc('BTC')),
    part(rOhlc('ETH')),
  ])

  const spotBtc = marketPrice(markets, 'BTC')
  const spotEth = marketPrice(markets, 'ETH')

  return composed(
    {
      deribit: {
        BTC: deribitBtc?.data ?? null,
        ETH: deribitEth?.data ?? null,
      },
      cme: {
        BTC: cmeBtc
          ? { current: cmeCurrent(cmeBtc, spotBtc), history: cmeHistory(cmeBtc, btcCandles) }
          : null,
        ETH: cmeEth
          ? { current: cmeCurrent(cmeEth, spotEth), history: cmeHistory(cmeEth, ethCandles) }
          : null,
      },
      perp: perp?.data ?? null,
    },
    {
      deribit: deribitBtc?.source ?? null,
      cme: cmeBtc?.source ?? null,
      perp: perp?.source ?? null,
    },
  )
}

async function sentimentHandler() {
  const [fng, funding, markets, global, signals] = await Promise.all([
    part(rFng()),
    part(rFunding()),
    part(rMarkets()),
    part(rGlobal()),
    part(rSignals()),
  ])

  const history = fng?.data?.history ?? []
  const last = history.length ? history[history.length - 1] : null

  const items = (markets?.data?.items ?? []).filter((i) => !isStable(i.symbol))
  const with7d = items.filter((i) => Number.isFinite(i.chg7dPct))
  const positive7dPct = with7d.length
    ? (with7d.filter((i) => i.chg7dPct > 0).length / with7d.length) * 100
    : null
  const aboveSma50Pct = signals?.data?.breadth?.aboveSma50Pct ?? null

  const stableShare = (() => {
    const all = markets?.data?.items ?? []
    const total = global?.data?.totalMcapUsd
    if (!all.length || !(total > 0)) return null
    const stables = all.filter((i) => isStable(i.symbol)).reduce((acc, i) => acc + (i.mcap ?? 0), 0)
    return (stables / total) * 100
  })()

  const fundingAnnualizedPct = funding?.data?.aggregate?.annualizedPct ?? null

  return composed(
    {
      fng: last ? { value: last.value, classification: last.classification, history } : null,
      funding: funding?.data?.aggregate ?? null,
      breadth: {
        positive7dPct,
        aboveSma50Pct,
        sample: with7d.length,
        universeSample: signals?.data?.breadth?.sample ?? null,
      },
      dominance: global
        ? {
            btcPct: global.data.btcDominancePct,
            ethPct: global.data.ethDominancePct,
            stablecoinsPct: stableShare,
          }
        : null,
      composite: compositeSentiment({
        fngValue: last?.value ?? null,
        fundingAnnualizedPct,
        breadthPositive7dPct: positive7dPct,
        breadthAboveSma50Pct: aboveSma50Pct,
        stablecoinDominancePct: stableShare,
      }),
    },
    {
      fng: fng?.source ?? null,
      funding: funding?.source ?? null,
      markets: markets?.source ?? null,
      global: global?.source ?? null,
      signals: signals?.source ?? null,
    },
  )
}

async function cci30Handler() {
  const env = await rCci30()
  const rows = env.data.rows ?? []
  const closes = rows.map((r) => r.c)
  const last = closes[closes.length - 1]

  const byDate = (target) => {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].d <= target) return rows[i].c
    }
    return null
  }
  const lastDate = rows.length ? rows[rows.length - 1].d : null
  const year = lastDate ? lastDate.slice(0, 4) : null
  const ytdRef = year ? byDate(`${Number(year) - 1}-12-31`) : null
  const oneYearRef = lastDate
    ? byDate(`${Number(year) - 1}${lastDate.slice(4)}`)
    : null

  let peak = -Infinity
  let maxDrawdownPct = 0
  for (const c of closes) {
    if (c > peak) peak = c
    const dd = (c / peak - 1) * 100
    if (dd < maxDrawdownPct) maxDrawdownPct = dd
  }

  const returns = []
  for (let i = Math.max(1, closes.length - 30); i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]))
  }
  const mean = returns.reduce((a, b) => a + b, 0) / (returns.length || 1)
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length > 1 ? returns.length - 1 : 1)
  const vol30dAnnualizedPct = returns.length ? Math.sqrt(variance) * Math.sqrt(365) * 100 : null

  return {
    data: {
      history: rows.slice(-2600).map((r) => ({ d: r.d, c: r.c })),
      stats: {
        level: last ?? null,
        date: lastDate,
        chg24hPct: cci30LastLevels(rows)?.chg24hPct ?? null,
        ytdPct: ytdRef ? (last / ytdRef - 1) * 100 : null,
        oneYearPct: oneYearRef ? (last / oneYearRef - 1) * 100 : null,
        maxDrawdownPct,
        vol30dAnnualizedPct,
      },
      isReplica: env.data.isReplica ?? false,
    },
    source: env.source,
    provider: env.provider,
    asOf: env.asOf,
  }
}

async function equitiesHandler() {
  const [stocks, btc, eth, cci] = await Promise.all([
    part(rEquities()),
    part(rOhlc('BTC')),
    part(rOhlc('ETH')),
    part(rCci30()),
  ])

  const toDaily = (candlesEnv) =>
    (candlesEnv?.data?.candles ?? []).map((k) => ({
      d: new Date(k.t * 1000).toISOString().slice(0, 10),
      c: k.c,
    }))

  const series = { ...(stocks?.data?.series ?? {}) }
  if (btc) series.BTC = toDaily(btc)
  if (eth) series.ETH = toDaily(eth)
  if (cci) series.CCI30 = (cci.data.rows ?? []).slice(-640).map((r) => ({ d: r.d, c: r.c }))

  return composed(
    {
      series,
      failed: stocks ? stocks.data.failed : [...EQUITY_SYMBOLS],
      simulated: stocks?.data?.simulated ?? false,
      cci30IsReplica: cci?.data?.isReplica ?? false,
    },
    {
      stocks: stocks?.source ?? null,
      btc: btc?.source ?? null,
      eth: eth?.source ?? null,
      cci30: cci?.source ?? null,
    },
  )
}

async function ohlcHandler(req) {
  const symbol = String(req.query.symbol ?? 'BTC').toUpperCase()
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new Error('invalid symbol')
  const days = Math.min(400, Math.max(30, Number(req.query.days) || 365))

  if (symbol === 'CCI30') {
    const env = await rCci30()
    const rows = (env.data.rows ?? []).slice(-days)
    return {
      data: {
        symbol,
        candles: rows.map((r) => ({
          t: Math.floor(Date.parse(`${r.d}T00:00:00Z`) / 1000),
          o: r.o ?? r.c,
          h: r.h ?? r.c,
          l: r.l ?? r.c,
          c: r.c,
          v: 0,
        })),
        isReplica: env.data.isReplica ?? false,
      },
      source: env.source,
      provider: env.provider,
      asOf: env.asOf,
    }
  }

  const env = await rOhlc(symbol)
  return {
    data: { symbol, candles: (env.data.candles ?? []).slice(-days) },
    source: env.source,
    provider: env.provider,
    asOf: env.asOf,
  }
}

/* ---------- Montage ---------- */

export function registerApi(api) {
  api.get('/overview', wrap(overviewHandler))
  api.get('/markets', wrap(() => rMarkets()))
  api.get('/ohlc', wrap(ohlcHandler))
  api.get('/funding', wrap(() => rFunding()))
  api.get('/basis', wrap(basisHandler))
  api.get('/sentiment', wrap(sentimentHandler))
  api.get('/cycles', wrap(() => rCycles()))
  api.get('/signals', wrap(() => rSignals()))
  api.get('/cci30', wrap(cci30Handler))
  api.get('/equities', wrap(equitiesHandler))
  api.get('/news', wrap(() => rNews()))
  api.get('/health', (_req, res) => {
    res.json({
      ok: true,
      mode: isOffline() ? 'offline (seeds forced)' : 'online',
      now: nowIso(),
      upstreams: upstreamStats(),
      cache: cacheInfo(),
    })
  })
}
