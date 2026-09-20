/*
 * Basis futures : annualisation et échéances CME.
 * Module partagé serveur/client (ESM pur, JSDoc).
 */

/**
 * Basis annualisée en % : ((F/S)^(365/j) − 1) × 100.
 * @param {number} future prix du future
 * @param {number} spot prix spot
 * @param {number} daysToExpiry jours restants (> 0)
 * @returns {number|null}
 */
export function annualizedBasisPct(future, spot, daysToExpiry) {
  if (!(future > 0) || !(spot > 0) || !(daysToExpiry > 0)) return null
  return (Math.pow(future / spot, 365 / daysToExpiry) - 1) * 100
}

/**
 * Prime simple non annualisée en % : (F/S − 1) × 100.
 * @param {number} future
 * @param {number} spot
 * @returns {number|null}
 */
export function simplePremiumPct(future, spot) {
  if (!(future > 0) || !(spot > 0)) return null
  return (future / spot - 1) * 100
}

/**
 * Dernier vendredi d'un mois (UTC, 15:00 — approximation du règlement CME).
 * @param {number} year
 * @param {number} month 0–11
 */
export function lastFridayOfMonth(year, month) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0))
  const shift = (lastDay.getUTCDay() - 5 + 7) % 7
  return new Date(Date.UTC(year, month, lastDay.getUTCDate() - shift, 15, 0, 0))
}

/**
 * Échéance estimée du contrat CME front-month : dernier vendredi du mois
 * courant s'il reste plus d'un jour, sinon celui du mois suivant.
 * @param {Date} [from]
 */
export function cmeFrontExpiry(from = new Date()) {
  const current = lastFridayOfMonth(from.getUTCFullYear(), from.getUTCMonth())
  if (current.getTime() - from.getTime() > 86_400_000) return current
  const nextMonth = (from.getUTCMonth() + 1) % 12
  const nextYear = from.getUTCFullYear() + (from.getUTCMonth() === 11 ? 1 : 0)
  return lastFridayOfMonth(nextYear, nextMonth)
}

/** Régime de la courbe selon le signe de la basis. */
export function basisRegime(basisPct) {
  if (basisPct == null) return null
  return basisPct >= 0 ? 'contango' : 'backwardation'
}
