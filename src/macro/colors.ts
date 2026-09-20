/*
 * Couleurs AirMacro — affectation FIXE par entité, depuis la palette validée
 * (src/lib/colors.ts). Jeux validés contre la surface des panneaux (#12161d)
 * avec scripts/validate_palette.js (skill dataviz), mode sombre, toutes paires :
 *   inflation or / magenta / violet — CVD ΔE min 13.2, vision normale 19.3
 *   taux aqua / bleu — CVD ΔE 19.6, vision normale 20.9
 * La cible Fed est une série de contexte (gris neutre, en escalier) ; les barres
 * NFP / PIB et l'écart 10Y–3M sont signés (teal / rose de l'application).
 */
import { CHART, SERIES } from '../lib/colors'

export const MACRO_COLORS = {
  cpi: SERIES.gold,
  coreCpi: SERIES.magenta,
  corePce: SERIES.violet,
  unrate: SERIES.blue,
  y10: SERIES.aqua,
  m3: SERIES.blue,
  fedTarget: CHART.text,
  vix: SERIES.orange,
  dxy: SERIES.blue,
  wti: SERIES.blue,
  reference: CHART.text,
  up: CHART.up,
  down: CHART.down,
} as const

/** Remplissage d'aire ~10 % d'opacité (règle dataviz). */
export const wash = (hex: string, alpha = 0.1): string => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
