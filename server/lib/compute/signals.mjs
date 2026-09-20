/*
 * Calcul des signaux Buy/Hold/Sell : univers top 30 (hors stablecoins,
 * wrapped/staked, RWA), score composite décomposé, breadth de l'univers.
 * Résultat mis en cache 10 min (clé « signals ») avec seed de repli.
 */
import { resolveData } from '../cache.mjs'
import { isExcludedFromSignals, SIGNALS_UNIVERSE_SIZE } from '../universe.mjs'
import { rMarkets, rOhlc, rFunding, rFng } from '../sources.mjs'
import { scoreAsset, ratingFromScore } from '../../../shared/analytics/scoring.mjs'
import { realizedVolAnnualizedPct, quantile } from '../../../shared/analytics/series.mjs'

async function tolerant(promise) {
  try {
    return await promise
  } catch {
    return null
  }
}

async function signalsComputeLive() {
  const markets = await rMarkets()
  const [fng, funding] = await Promise.all([tolerant(rFng()), tolerant(rFunding())])

  const universe = (markets.data.items ?? [])
    .filter((item) => !isExcludedFromSignals(item.symbol))
    .slice(0, SIGNALS_UNIVERSE_SIZE)
  if (universe.length < 10) throw new Error('signals: univers trop restreint')

  const candleEnvs = await Promise.all(universe.map((item) => tolerant(rOhlc(item.symbol))))

  const closesBySymbol = new Map()
  universe.forEach((item, i) => {
    const candles = candleEnvs[i]?.data?.candles
    if (candles?.length) {
      closesBySymbol.set(item.symbol, candles.map((k) => k.c))
    }
  })

  const btcCloses = closesBySymbol.get('BTC') ?? null

  const vols = []
  for (const closes of closesBySymbol.values()) {
    const vol = realizedVolAnnualizedPct(closes, 30)
    if (vol != null) vols.push(vol)
  }
  const universeMedianVolPct = vols.length ? quantile(vols, 0.5) : null

  const fngHistory = fng?.data?.history ?? []
  const fngValue = fngHistory.length ? fngHistory[fngHistory.length - 1].value : null

  const fundingBySymbol = new Map()
  for (const row of funding?.data?.rows ?? []) {
    const rate = row.binance?.rate8hPct ?? row.bybit?.rate8hPct ?? row.okx?.rate8hPct
    if (Number.isFinite(rate)) fundingBySymbol.set(row.symbol, rate * 3 * 365)
  }

  const items = universe.map((item, i) => {
    const closes = closesBySymbol.get(item.symbol)
    const candleEnv = candleEnvs[i]
    if (!closes) {
      return {
        ...marketFields(item),
        candleSource: null,
        score: null,
        rating: 'NA',
        partial: true,
        families: null,
        metrics: null,
        fundingAnnualizedPct: fundingBySymbol.get(item.symbol) ?? null,
        reason: 'daily series unavailable',
      }
    }
    const scored = scoreAsset({
      closes,
      fundingAnnualizedPct: fundingBySymbol.get(item.symbol) ?? null,
      fngValue,
      universeMedianVolPct,
      btcCloses: item.symbol === 'BTC' ? null : btcCloses,
    })
    return {
      ...marketFields(item),
      candleSource: candleEnv.source,
      score: scored.score,
      rating: scored.rating,
      partial: scored.partial,
      families: scored.families,
      metrics: scored.metrics,
      fundingAnnualizedPct: fundingBySymbol.get(item.symbol) ?? null,
      reason: scored.reason ?? null,
    }
  })

  const rated = items.filter((item) => item.rating !== 'NA')
  if (rated.length < 10) throw new Error(`signals: trop peu d'actifs notés (${rated.length})`)

  const counts = {
    buy: items.filter((i) => i.rating === 'BUY').length,
    hold: items.filter((i) => i.rating === 'HOLD').length,
    sell: items.filter((i) => i.rating === 'SELL').length,
    na: items.filter((i) => i.rating === 'NA').length,
  }

  const withSma50 = items.filter((i) => i.metrics?.aboveSma50 != null)
  const aboveSma50Pct = withSma50.length
    ? (withSma50.filter((i) => i.metrics.aboveSma50).length / withSma50.length) * 100
    : null
  const with7d = items.filter((i) => Number.isFinite(i.chg7dPct))
  const positive7dPct = with7d.length
    ? (with7d.filter((i) => i.chg7dPct > 0).length / with7d.length) * 100
    : null

  return {
    provider: 'AirCrypto engine (binance/coingecko series)',
    data: {
      items,
      counts,
      breadth: { aboveSma50Pct, positive7dPct, sample: items.length },
      fngValue,
      universeNote: `top ${SIGNALS_UNIVERSE_SIZE} by market cap, excluding stablecoins, wrapped/staked and RWA`,
      thresholds: { buy: 65, sell: 35 },
    },
  }
}

function marketFields(item) {
  return {
    id: item.id,
    symbol: item.symbol,
    name: item.name,
    rank: item.rank,
    price: item.price,
    chg24hPct: item.chg24hPct,
    chg7dPct: item.chg7dPct,
    chg30dPct: item.chg30dPct,
    mcap: item.mcap,
    volume24h: item.volume24h,
    spark7d: item.spark7d,
    athChangePct: item.athChangePct,
  }
}

export const rSignals = () =>
  resolveData({ key: 'signals', ttlMs: 10 * 60_000, live: signalsComputeLive, seed: 'signals' })

export { ratingFromScore }
