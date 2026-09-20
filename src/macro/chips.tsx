import type { EventKind, Impact } from './types'
import { COUNTRY_CODES, COUNTRY_NAMES, IMPACT_LABELS, KIND_LABELS } from './format'

/** Impact : toujours doublé du mot (jamais la couleur seule). */
export function ImpactChip({ impact }: { impact: Impact }) {
  return (
    <span className={`impact-chip impact-${impact.toLowerCase()}`} title={`${IMPACT_LABELS[impact]} impact`}>
      {IMPACT_LABELS[impact]}
      <span className="sr-only"> impact</span>
    </span>
  )
}

export function CountryTag({ country }: { country: string }) {
  return (
    <abbr className="country-tag mono" title={COUNTRY_NAMES[country] ?? country}>
      {COUNTRY_CODES[country] ?? country}
    </abbr>
  )
}

export function KindTag({ kind }: { kind: EventKind }) {
  return <span className="kind-tag">{KIND_LABELS[kind]}</span>
}
