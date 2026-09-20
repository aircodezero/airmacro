/*
 * Score composite Buy/Hold/Sell 0–100, décomposé en quatre familles :
 *   Tendance 35 % · Momentum 30 % · Contexte 20 % · Risque 15 %.
 * Chaque famille est un score 0–100 avec le détail de ses composantes,
 * affiché tel quel dans l'interface (transparence avant tout).
 */
import { sma, pctChange, realizedVolAnnualizedPct, drawdownFromHighPct, clamp } from './series.mjs'
import { rsi, macd } from './indicators.mjs'

export const WEIGHTS = { trend: 0.35, momentum: 0.3, context: 0.2, risk: 0.15 }
export const BUY_THRESHOLD = 65
export const SELL_THRESHOLD = 35

/** Note à partir du score. */
export function ratingFromScore(score) {
  if (score == null) return 'NA'
  if (score >= BUY_THRESHOLD) return 'BUY'
  if (score < SELL_THRESHOLD) return 'SELL'
  return 'HOLD'
}

const comp = (label, score, detail) => ({ label, score: score == null ? null : Math.round(score), detail })

function familyScore(components) {
  const valid = components.filter((c) => c.score != null)
  if (!valid.length) return null
  return valid.reduce((a, c) => a + c.score, 0) / valid.length
}

/**
 * @param {{
 *  closes: number[],
 *  fundingAnnualizedPct?: number|null,
 *  fngValue?: number|null,
 *  universeMedianVolPct?: number|null,
 *  btcCloses?: number[]|null,
 * }} input
 */
export function scoreAsset(input) {
  const { closes, fundingAnnualizedPct = null, fngValue = null, universeMedianVolPct = null, btcCloses = null } = input
  const n = closes.length
  if (n < 60) {
    return { score: null, rating: 'NA', partial: true, families: null, metrics: null, reason: 'insufficient history (< 60d)' }
  }
  const partial = n < 220

  const sma50 = sma(closes, 50)
  const sma200 = sma(closes, 200)
  const rsiSeries = rsi(closes, 14)
  const { histogram } = macd(closes)

  const last = closes[n - 1]
  const lastSma50 = sma50[n - 1]
  const lastSma200 = sma200[n - 1]
  const lastRsi = rsiSeries[n - 1]
  const lastHist = histogram[n - 1]
  const prevHist = histogram[n - 6] ?? null

  const ret30 = pctChange(closes, 30)
  const ret90 = pctChange(closes, 90)
  const vol30 = realizedVolAnnualizedPct(closes, 30)
  const dd = drawdownFromHighPct(closes)

  let relStrength30 = null
  if (btcCloses && btcCloses.length > 31) {
    const assetRet = pctChange(closes, 30)
    const btcRet = pctChange(btcCloses, 30)
    if (assetRet != null && btcRet != null) relStrength30 = assetRet - btcRet
  }

  /* ----- Tendance ----- */
  const trendComponents = []
  const refMa = lastSma200 ?? lastSma50
  const refLabel = lastSma200 != null ? 'SMA200' : 'SMA50 (short history)'
  if (refMa != null) {
    const distPct = (last / refMa - 1) * 100
    const base = distPct >= 0 ? 68 + clamp(distPct / 2, 0, 17) : 32 + clamp(distPct / 2, -17, 0)
    trendComponents.push(comp(`Price vs ${refLabel}`, clamp(base, 0, 100), `${distPct >= 0 ? '+' : ''}${distPct.toFixed(1)}%`))
  }
  if (lastSma50 != null && lastSma200 != null) {
    const golden = lastSma50 >= lastSma200
    trendComponents.push(comp('SMA50 vs SMA200', golden ? 70 : 30, golden ? 'golden cross' : 'death cross'))
  }
  const sma50Prev = sma50[n - 21]
  if (lastSma50 != null && sma50Prev != null) {
    const slopePct = (lastSma50 / sma50Prev - 1) * 100
    trendComponents.push(comp('SMA50 slope (20d)', clamp(50 + slopePct * 4, 0, 100), `${slopePct >= 0 ? '+' : ''}${slopePct.toFixed(1)}%`))
  }
  const trend = familyScore(trendComponents)

  /* ----- Momentum ----- */
  const momentumComponents = []
  if (lastRsi != null) {
    let rsiScore = clamp(50 + (lastRsi - 50) * 1.4, 0, 100)
    if (lastRsi > 75) rsiScore -= 15
    if (lastRsi < 25) rsiScore += 15
    momentumComponents.push(comp('RSI(14)', clamp(rsiScore, 0, 100), lastRsi.toFixed(0)))
  }
  if (lastHist != null) {
    const rising = prevHist != null ? lastHist > prevHist : null
    const score = lastHist > 0 ? (rising === false ? 58 : 72) : rising === true ? 45 : 28
    momentumComponents.push(comp('MACD (histogram)', score, `${lastHist > 0 ? 'positive' : 'negative'}${rising == null ? '' : rising ? ', rising' : ', falling'}`))
  }
  if (ret30 != null && ret90 != null) {
    const blended = 0.6 * ret30 + 0.4 * ret90
    momentumComponents.push(comp('30/90d returns', clamp(50 + 50 * Math.tanh(blended / 35), 0, 100), `30d ${fmtSigned(ret30)} · 90d ${fmtSigned(ret90)}`))
  }
  if (relStrength30 != null) {
    momentumComponents.push(comp('Rel. strength vs BTC (30d)', clamp(50 + 50 * Math.tanh(relStrength30 / 20), 0, 100), fmtSigned(relStrength30)))
  }
  const momentum = familyScore(momentumComponents)

  /* ----- Contexte ----- */
  const contextComponents = []
  if (fundingAnnualizedPct != null) {
    let s
    if (fundingAnnualizedPct > 30) s = 25
    else if (fundingAnnualizedPct > 12) s = 45
    else if (fundingAnnualizedPct >= -2) s = 60
    else if (fundingAnnualizedPct >= -15) s = 65
    else s = 52
    contextComponents.push(comp('Annualized funding', s, `${fmtSigned(fundingAnnualizedPct)} — ${fundingAnnualizedPct > 12 ? 'crowded longs' : fundingAnnualizedPct < -2 ? 'shorts paying' : 'neutral'}`))
  }
  if (fngValue != null) {
    let s
    if (fngValue > 80) s = 35
    else if (fngValue > 60) s = 50
    else if (fngValue >= 40) s = 60
    else if (fngValue >= 20) s = 65
    else s = 70
    contextComponents.push(comp('Fear & Greed regime', s, `${fngValue} (contrarian read at extremes)`))
  }
  const context = familyScore(contextComponents)

  /* ----- Risque ----- */
  const riskComponents = []
  if (vol30 != null && universeMedianVolPct != null && universeMedianVolPct > 0) {
    const ratio = vol30 / universeMedianVolPct
    const s = ratio <= 0.8 ? 70 : ratio <= 1.2 ? 55 : ratio <= 2 ? 40 : 25
    riskComponents.push(comp("30d vol vs universe", s, `${vol30.toFixed(0)}% vs median ${universeMedianVolPct.toFixed(0)}%`))
  } else if (vol30 != null) {
    riskComponents.push(comp('30d volatility', vol30 <= 45 ? 65 : vol30 <= 80 ? 50 : 35, `${vol30.toFixed(0)}% annualized`))
  }
  if (dd != null) {
    const s = dd > -20 ? 65 : dd > -50 ? 50 : dd > -75 ? 40 : 30
    riskComponents.push(comp('Drawdown vs 1y high', s, `${dd.toFixed(0)}%`))
  }
  const risk = familyScore(riskComponents)

  const families = {
    trend: { label: 'Trend', weight: WEIGHTS.trend, score: trend == null ? null : Math.round(trend), components: trendComponents },
    momentum: { label: 'Momentum', weight: WEIGHTS.momentum, score: momentum == null ? null : Math.round(momentum), components: momentumComponents },
    context: { label: 'Context', weight: WEIGHTS.context, score: context == null ? null : Math.round(context), components: contextComponents },
    risk: { label: 'Risk', weight: WEIGHTS.risk, score: risk == null ? null : Math.round(risk), components: riskComponents },
  }

  let totalWeight = 0
  let weighted = 0
  for (const key of Object.keys(WEIGHTS)) {
    const family = families[key]
    if (family.score != null) {
      weighted += family.score * WEIGHTS[key]
      totalWeight += WEIGHTS[key]
    }
  }
  const score = totalWeight > 0 ? Math.round(weighted / totalWeight) : null

  return {
    score,
    rating: ratingFromScore(score),
    partial,
    families,
    metrics: {
      rsi14: lastRsi,
      sma50: lastSma50,
      sma200: lastSma200,
      priceVsSma200Pct: lastSma200 != null ? (last / lastSma200 - 1) * 100 : null,
      priceVsSma50Pct: lastSma50 != null ? (last / lastSma50 - 1) * 100 : null,
      aboveSma50: lastSma50 != null ? last >= lastSma50 : null,
      aboveSma200: lastSma200 != null ? last >= lastSma200 : null,
      macdHistogram: lastHist,
      ret30dPct: ret30,
      ret90dPct: ret90,
      vol30dAnnualizedPct: vol30,
      drawdownFromHighPct: dd,
      relStrengthVsBtc30dPct: relStrength30,
    },
  }
}

function fmtSigned(v) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}
