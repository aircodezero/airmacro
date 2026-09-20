import type { Rating } from '../lib/types'

const CONFIG: Record<Rating, { label: string; className: string }> = {
  BUY: { label: 'Buy', className: 'rating-chip rating-buy' },
  HOLD: { label: 'Hold', className: 'rating-chip rating-hold' },
  SELL: { label: 'Sell', className: 'rating-chip rating-sell' },
  NA: { label: '—', className: 'rating-chip rating-na' },
}

export function RatingChip({ rating, partial }: { rating: Rating; partial?: boolean }) {
  const { label, className } = CONFIG[rating]
  return (
    <span
      className={className}
      title={
        rating === 'NA'
          ? 'Insufficient history to rate this asset'
          : partial
            ? 'Score computed on partial history (< 220 days)'
            : undefined
      }
    >
      {label}
      {partial && rating !== 'NA' ? '*' : ''}
    </span>
  )
}
