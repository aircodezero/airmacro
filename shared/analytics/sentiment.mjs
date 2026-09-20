/*
 * Jauge composite de sentiment AirCrypto 0–100.
 * 0 = peur extrême / positionnement vendeur, 100 = euphorie.
 * Composantes : Fear & Greed, positionnement funding, largeur de marché,
 * part des stablecoins (risk-off). Chaque composante est affichée avec sa
 * contribution — pas de boîte noire.
 */
import { clamp } from './series.mjs'

/**
 * @param {{
 *  fngValue?: number|null,
 *  fundingAnnualizedPct?: number|null,
 *  breadthPositive7dPct?: number|null,
 *  breadthAboveSma50Pct?: number|null,
 *  stablecoinDominancePct?: number|null,
 * }} input
 */
export function compositeSentiment(input) {
  const components = []

  if (input.fngValue != null) {
    components.push({
      key: 'fng',
      label: 'Fear & Greed',
      weight: 0.35,
      value: clamp(input.fngValue, 0, 100),
      detail: `${Math.round(input.fngValue)}/100`,
    })
  }
  if (input.fundingAnnualizedPct != null) {
    // -30 % annualisé → ~15 (positionnement short), 0 % → 50, +30 % → ~85 (euphorie longue)
    const value = clamp(50 + 35 * Math.tanh(input.fundingAnnualizedPct / 25), 0, 100)
    components.push({
      key: 'funding',
      label: 'Funding positioning',
      weight: 0.25,
      value,
      detail: `${input.fundingAnnualizedPct >= 0 ? '+' : ''}${input.fundingAnnualizedPct.toFixed(1)}% annualized`,
    })
  }
  const breadth = input.breadthAboveSma50Pct ?? input.breadthPositive7dPct
  if (breadth != null) {
    components.push({
      key: 'breadth',
      label: 'Market breadth',
      weight: 0.25,
      value: clamp(breadth, 0, 100),
      detail: `${Math.round(breadth)}% of assets`,
    })
  }
  if (input.stablecoinDominancePct != null) {
    // Part des stablecoins élevée = cash en attente = prudence. 4 % → ~75, 8 % → 50, 14 % → ~20.
    const value = clamp(50 - (input.stablecoinDominancePct - 8) * 5, 0, 100)
    components.push({
      key: 'stables',
      label: 'Stablecoin share',
      weight: 0.15,
      value,
      detail: `${input.stablecoinDominancePct.toFixed(1)}% of market cap`,
    })
  }

  if (!components.length) return null
  const totalWeight = components.reduce((a, c) => a + c.weight, 0)
  const score = Math.round(components.reduce((a, c) => a + c.value * c.weight, 0) / totalWeight)
  return {
    score,
    label: sentimentLabel(score),
    components: components.map((c) => ({ ...c, value: Math.round(c.value) })),
  }
}

export function sentimentLabel(score) {
  if (score < 20) return 'Extreme fear'
  if (score < 40) return 'Fear'
  if (score < 60) return 'Neutral'
  if (score < 80) return 'Optimism'
  return 'Euphoria'
}
