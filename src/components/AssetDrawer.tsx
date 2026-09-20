import { useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { qOhlc } from '../lib/queries'
import { CandleChart } from './charts/CandleChart'
import { RatingChip } from './RatingChip'
import { FreshnessBadge } from './FreshnessBadge'
import { ErrorState, LoadingState } from './ErrorState'
import { fmtUsd, fmtPct, fmtCompact, fmtNum, signClass } from '../lib/format'
import type { ScoreFamily, SignalItem } from '../lib/types'

function FamilyBlock({ family }: { family: ScoreFamily }) {
  return (
    <div className="fam-block">
      <div className="fam-head">
        <span className="fam-name">
          {family.label} <span className="muted">({Math.round(family.weight * 100)}%)</span>
        </span>
        <span className="mono fam-score">{family.score ?? '—'}</span>
      </div>
      <div className="fam-bar" role="img" aria-label={`${family.label}: ${family.score ?? 'unavailable'} out of 100`}>
        <div className="fam-bar-fill" style={{ width: `${family.score ?? 0}%` }} />
      </div>
      <ul className="fam-components">
        {family.components.map((component) => (
          <li key={component.label}>
            <span>{component.label}</span>
            <span className="muted">{component.detail}</span>
            <span className="mono">{component.score ?? '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AssetDrawer({ item, onClose }: { item: SignalItem; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const ohlc = useQuery(qOhlc(item.symbol))
  const candles = useMemo(() => (ohlc.data?.data.candles ?? []).slice(-180), [ohlc.data])

  const metrics = item.metrics
  const stats: Array<{ label: string; value: string; className?: string }> = []
  if (metrics?.rsi14 != null) stats.push({ label: 'RSI(14)', value: fmtNum(metrics.rsi14, 0) })
  if (metrics?.vol30dAnnualizedPct != null)
    stats.push({ label: '30d vol (ann.)', value: `${fmtNum(metrics.vol30dAnnualizedPct, 0)}%` })
  if (metrics?.drawdownFromHighPct != null)
    stats.push({ label: 'Drawdown vs 1y high', value: fmtPct(metrics.drawdownFromHighPct), className: 'negative' })
  if (item.fundingAnnualizedPct != null)
    stats.push({
      label: 'Annualized funding',
      value: fmtPct(item.fundingAnnualizedPct),
      className: signClass(item.fundingAnnualizedPct),
    })
  if (metrics?.ret30dPct != null)
    stats.push({ label: '30d return', value: fmtPct(metrics.ret30dPct), className: signClass(metrics.ret30dPct) })
  if (metrics?.ret90dPct != null)
    stats.push({ label: '90d return', value: fmtPct(metrics.ret90dPct), className: signClass(metrics.ret90dPct) })
  if (metrics?.priceVsSma200Pct != null)
    stats.push({
      label: 'Price vs SMA200',
      value: fmtPct(metrics.priceVsSma200Pct),
      className: signClass(metrics.priceVsSma200Pct),
    })
  if (metrics?.relStrengthVsBtc30dPct != null)
    stats.push({
      label: 'Rel. strength vs BTC (30d)',
      value: fmtPct(metrics.relStrengthVsBtc30dPct),
      className: signClass(metrics.relStrengthVsBtc30dPct),
    })
  stats.push({ label: 'Market cap', value: `$${fmtCompact(item.mcap)}` })
  stats.push({ label: '24h volume', value: `$${fmtCompact(item.volume24h)}` })

  return (
    <dialog
      ref={dialogRef}
      className="drawer"
      aria-label={`Detailed view — ${item.name}`}
      onClose={onClose}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
    >
      <div className="drawer-inner">
        <header className="drawer-head">
          <div className="drawer-title">
            <h2>
              {item.name} <span className="muted mono">{item.symbol}</span>
            </h2>
            <p className="mono drawer-price">
              {fmtUsd(item.price)}{' '}
              {item.chg24hPct != null && (
                <span className={signClass(item.chg24hPct)}>{fmtPct(item.chg24hPct)} / 24h</span>
              )}
            </p>
          </div>
          <div className="drawer-rating">
            <RatingChip rating={item.rating} partial={item.partial} />
            {item.score != null && <span className="mono drawer-score">{item.score}/100</span>}
          </div>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </header>

        <section aria-label={`${item.symbol} 6-month chart`}>
          {ohlc.isPending ? (
            <LoadingState label="Loading candles…" />
          ) : ohlc.isError ? (
            <ErrorState message="Daily series unavailable for this asset." onRetry={() => ohlc.refetch()} />
          ) : (
            <>
              <div className="drawer-chart-meta">
                <span className="muted text-xs">Daily candles · 6 months</span>
                <FreshnessBadge source={ohlc.data.source} asOf={ohlc.data.asOf} provider={ohlc.data.provider} />
              </div>
              <CandleChart
                candles={candles}
                height={220}
                ariaLabel={`Daily candles for ${item.name} over 6 months`}
              />
            </>
          )}
        </section>

        {item.families ? (
          <section aria-label="Score breakdown">
            <h3 className="drawer-subtitle">Score breakdown</h3>
            <FamilyBlock family={item.families.trend} />
            <FamilyBlock family={item.families.momentum} />
            <FamilyBlock family={item.families.context} />
            <FamilyBlock family={item.families.risk} />
          </section>
        ) : (
          <p className="panel-note">{item.reason ?? 'Score unavailable for this asset.'}</p>
        )}

        <section aria-label="Key statistics">
          <h3 className="drawer-subtitle">Key statistics</h3>
          <dl className="stats-grid">
            {stats.map((stat) => (
              <div key={stat.label}>
                <dt>{stat.label}</dt>
                <dd className={`mono ${stat.className ?? ''}`}>{stat.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <p className="drawer-disclaimer">
          Score generated automatically from public data — an information tool, not investment
          advice.
        </p>
      </div>
    </dialog>
  )
}
