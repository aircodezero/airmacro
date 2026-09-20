/*
 * Outils de séries : moyennes mobiles, rendements, volatilité, drawdown,
 * corrélation, régression OLS, alignement par dates.
 * Module partagé serveur/client (ESM pur, JSDoc). Conventions :
 *  - les sorties « alignées » ont la même longueur que l'entrée, null avant
 *    d'avoir assez d'historique ;
 *  - les pourcentages sont exprimés en points (1.5 = +1.5 %).
 */

/** @param {number[]} values @param {number} period @returns {(number|null)[]} */
export function sma(values, period) {
  const out = new Array(values.length).fill(null)
  if (period <= 0) return out
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

/** EMA amorcée par la SMA des `period` premières valeurs. */
export function ema(values, period) {
  const out = new Array(values.length).fill(null)
  if (period <= 0 || values.length < period) return out
  const k = 2 / (period + 1)
  let prev = 0
  for (let i = 0; i < period; i++) prev += values[i]
  prev /= period
  out[period - 1] = prev
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

/** @param {number[]} values */
export function mean(values) {
  if (!values.length) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Écart-type échantillon (n−1). */
export function stdev(values) {
  if (values.length < 2) return null
  const m = mean(values)
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

/** Rendements logarithmiques successifs (longueur n−1). */
export function logReturns(values) {
  const out = []
  for (let i = 1; i < values.length; i++) {
    out.push(Math.log(values[i] / values[i - 1]))
  }
  return out
}

/** Rendements simples successifs en % (longueur n−1). */
export function simpleReturnsPct(values) {
  const out = []
  for (let i = 1; i < values.length; i++) {
    out.push((values[i] / values[i - 1] - 1) * 100)
  }
  return out
}

/** Variation en % sur `lookback` pas (dernier point vs n−lookback). */
export function pctChange(values, lookback) {
  if (values.length <= lookback) return null
  const ref = values[values.length - 1 - lookback]
  if (!(ref > 0)) return null
  return (values[values.length - 1] / ref - 1) * 100
}

/** Volatilité réalisée annualisée en % sur les `window` derniers pas. */
export function realizedVolAnnualizedPct(values, window = 30, periodsPerYear = 365) {
  if (values.length < window + 1) return null
  const rets = logReturns(values.slice(-(window + 1)))
  const sd = stdev(rets)
  if (sd == null) return null
  return sd * Math.sqrt(periodsPerYear) * 100
}

/** Drawdown maximal en % (négatif) sur toute la série. */
export function maxDrawdownPct(values) {
  let peak = -Infinity
  let worst = 0
  for (const v of values) {
    if (v > peak) peak = v
    const dd = (v / peak - 1) * 100
    if (dd < worst) worst = dd
  }
  return worst
}

/** Drawdown courant vs plus-haut de la série en %. */
export function drawdownFromHighPct(values) {
  if (!values.length) return null
  const high = Math.max(...values)
  return (values[values.length - 1] / high - 1) * 100
}

/** Corrélation de Pearson. */
export function pearson(a, b) {
  const n = Math.min(a.length, b.length)
  if (n < 3) return null
  const ma = mean(a.slice(0, n))
  const mb = mean(b.slice(0, n))
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma
    const xb = b[i] - mb
    num += xa * xb
    da += xa * xa
    db += xb * xb
  }
  if (da === 0 || db === 0) return null
  return num / Math.sqrt(da * db)
}

/** Corrélation glissante (fenêtre `window`), alignée sur l'entrée. */
export function rollingCorrelation(a, b, window) {
  const n = Math.min(a.length, b.length)
  const out = new Array(n).fill(null)
  for (let i = window - 1; i < n; i++) {
    out[i] = pearson(a.slice(i - window + 1, i + 1), b.slice(i - window + 1, i + 1))
  }
  return out
}

/**
 * Régression OLS y = alpha + beta·x.
 * @returns {{beta: number, alpha: number, r2: number, n: number}|null}
 */
export function olsRegression(x, y) {
  const n = Math.min(x.length, y.length)
  if (n < 3) return null
  const mx = mean(x.slice(0, n))
  const my = mean(y.slice(0, n))
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx
    const dy = y[i] - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  if (sxx === 0) return null
  const beta = sxy / sxx
  const alpha = my - beta * mx
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy)
  return { beta, alpha, r2, n }
}

/**
 * Intersection de séries datées [{d,c}] : dates communes triées.
 * @param {Record<string, Array<{d: string, c: number}>>} seriesMap
 * @returns {{dates: string[], values: Record<string, number[]>}}
 */
export function alignByDate(seriesMap) {
  const keys = Object.keys(seriesMap)
  if (!keys.length) return { dates: [], values: {} }
  const maps = keys.map((k) => new Map(seriesMap[k].map((row) => [row.d, row.c])))
  let common = [...maps[0].keys()]
  for (let i = 1; i < maps.length; i++) {
    common = common.filter((d) => maps[i].has(d))
  }
  common.sort()
  const values = {}
  keys.forEach((k, i) => {
    values[k] = common.map((d) => maps[i].get(d))
  })
  return { dates: common, values }
}

/** Base 100 au premier point. */
export function toBase100(values) {
  if (!values.length || !(values[0] > 0)) return values.map(() => null)
  return values.map((v) => (v / values[0]) * 100)
}

/** Quantile (méthode linéaire) d'un tableau non trié. */
export function quantile(values, q) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** Rang centile de `x` dans `values` (0–100). */
export function percentileRank(values, x) {
  if (!values.length) return null
  let below = 0
  for (const v of values) if (v <= x) below++
  return (below / values.length) * 100
}

/** Décimation en gardant premier/dernier points. */
export function decimate(rows, target) {
  if (rows.length <= target) return rows
  const step = (rows.length - 1) / (target - 1)
  const out = []
  for (let i = 0; i < target; i++) {
    out.push(rows[Math.round(i * step)])
  }
  return out
}

/** Borne une valeur dans [lo, hi]. */
export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}
