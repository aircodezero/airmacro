/*
 * Indicateurs techniques : RSI (lissage de Wilder), MACD.
 * Sorties alignées sur l'entrée (null avant amorçage).
 */
import { ema } from './series.mjs'

/**
 * RSI de Wilder.
 * @param {number[]} values
 * @param {number} period
 * @returns {(number|null)[]}
 */
export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null)
  if (values.length <= period) return out
  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1]
    if (change > 0) gainSum += change
    else lossSum -= change
  }
  let avgGain = gainSum / period
  let avgLoss = lossSum / period
  out[period] = toRsi(avgGain, avgLoss)
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1]
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? -change : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out[i] = toRsi(avgGain, avgLoss)
  }
  return out
}

function toRsi(avgGain, avgLoss) {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/**
 * MACD (EMA rapide − EMA lente), signal (EMA du MACD), histogramme.
 * @returns {{macdLine: (number|null)[], signalLine: (number|null)[], histogram: (number|null)[]}}
 */
export function macd(values, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast)
  const emaSlow = ema(values, slow)
  const macdLine = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null,
  )
  const validStart = macdLine.findIndex((v) => v != null)
  const valid = validStart >= 0 ? macdLine.slice(validStart) : []
  const signalValid = ema(valid, signal)
  const signalLine = new Array(values.length).fill(null)
  for (let i = 0; i < signalValid.length; i++) {
    if (signalValid[i] != null) signalLine[validStart + i] = signalValid[i]
  }
  const histogram = values.map((_, i) =>
    macdLine[i] != null && signalLine[i] != null ? macdLine[i] - signalLine[i] : null,
  )
  return { macdLine, signalLine, histogram }
}
