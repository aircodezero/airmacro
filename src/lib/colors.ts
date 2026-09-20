/*
 * Couleurs concrètes pour les canvases (lightweight-charts ne lit pas les
 * variables CSS). Une seule source de vérité, alignée sur src/styles/tokens.css.
 * L'affectation catégorielle est FIXE par entité — jamais cyclée.
 */

export const CHART = {
  up: '#3ecfa3',
  down: '#ff7e93',
  upSoft: 'rgba(62, 207, 163, 0.45)',
  downSoft: 'rgba(255, 126, 147, 0.45)',
  grid: '#232a34',
  border: '#2a313c',
  text: '#94a0b5',
  ink: '#edf1f7',
  accent: '#f2c94c',
  fontFamily: "'SFMono-Regular', 'Cascadia Mono', Consolas, ui-monospace, monospace",
} as const

/** Palette catégorielle validée (dark) — slots fixes. */
export const SERIES = {
  blue: '#3987e5',
  green: '#008300',
  magenta: '#d55181',
  gold: '#c98500',
  aqua: '#199e70',
  orange: '#d95926',
  violet: '#9085e9',
  red: '#e66767',
} as const

/** La couleur suit l'entité, partout dans l'application. */
export const ENTITY_COLORS: Record<string, string> = {
  BTC: SERIES.gold,
  ETH: SERIES.violet,
  CCI30: SERIES.blue,
  QQQ: SERIES.aqua,
  NVDA: SERIES.green,
  'Crypto-equities basket': SERIES.magenta,
  'AI basket': SERIES.orange,
}

export function entityColor(key: string): string {
  return ENTITY_COLORS[key] ?? SERIES.red
}
