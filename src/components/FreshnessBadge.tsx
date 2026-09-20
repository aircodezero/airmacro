import type { Source } from '../lib/api'
import { formatTime } from '../lib/format'

const LABELS: Record<Source, string> = {
  live: 'live',
  cache: 'cached',
  seed: 'sample',
}

const CLASSES: Record<Source, string> = {
  live: 'badge badge-live',
  cache: 'badge badge-cache',
  seed: 'badge badge-seed',
}

export function FreshnessBadge({
  source,
  asOf,
  provider,
}: {
  source: Source
  asOf?: string
  provider?: string
}) {
  const time = asOf ? formatTime(asOf) : undefined
  const title = [
    source === 'seed' ? 'Bundled sample data' : source === 'cache' ? 'Last known data (upstream refreshing)' : 'Live data',
    provider ? `source: ${provider}` : undefined,
    asOf ? `at ${time}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <span className={CLASSES[source]} title={title}>
      <span className="dot" aria-hidden="true" />
      {LABELS[source]}
      {time && source !== 'seed' ? ` · ${time}` : ''}
    </span>
  )
}
