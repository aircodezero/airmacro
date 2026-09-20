import type { ReactNode } from 'react'

export interface StatItem {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'up' | 'down' | 'muted' | 'accent'
}

const TONE_CLASS: Record<NonNullable<StatItem['tone']>, string> = {
  up: 'positive',
  down: 'negative',
  muted: 'muted',
  accent: '',
}

export function StatStrip({ items, label }: { items: StatItem[]; label?: string }) {
  return (
    <dl className="stat-strip" aria-label={label}>
      {items.map((item) => (
        <div className="stat" key={item.label}>
          <dt>{item.label}</dt>
          <dd className={item.tone ? TONE_CLASS[item.tone] : undefined}>{item.value}</dd>
          {item.sub != null && <span className="stat-sub">{item.sub}</span>}
        </div>
      ))}
    </dl>
  )
}
