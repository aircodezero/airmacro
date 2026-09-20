/*
 * Réplique interne « AirCrypto 30 » : indice √capitalisation des 30 premières
 * cryptos (méthodologie inspirée du CCi30), pondérations statiques calées sur
 * les capitalisations courantes — approximation clairement étiquetée, servie
 * uniquement quand la source officielle est indisponible.
 */
import { alignByDate } from './series.mjs'

/**
 * @param {Record<string, Array<{d: string, c: number}>>} seriesBySymbol
 * @param {Record<string, number>} mcapBySymbol
 * @returns {{rows: Array<{d: string, c: number}>, weights: Record<string, number>}|null}
 */
export function sqrtMcapIndex(seriesBySymbol, mcapBySymbol) {
  const symbols = Object.keys(seriesBySymbol).filter((s) => mcapBySymbol[s] > 0)
  if (symbols.length < 5) return null
  const subset = {}
  for (const s of symbols) subset[s] = seriesBySymbol[s]
  const { dates, values } = alignByDate(subset)
  if (dates.length < 30) return null

  const raw = symbols.map((s) => Math.sqrt(mcapBySymbol[s]))
  const total = raw.reduce((a, b) => a + b, 0)
  const weights = {}
  symbols.forEach((s, i) => {
    weights[s] = raw[i] / total
  })

  const rows = dates.map((d, t) => {
    let level = 0
    for (const s of symbols) {
      const base = values[s][0]
      level += weights[s] * (values[s][t] / base)
    }
    return { d, c: level * 100 }
  })
  return { rows, weights }
}
