import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Panel } from '../components/Panel'
import { StatStrip, type StatItem } from '../components/StatStrip'
import { FreshnessBadge } from '../components/FreshnessBadge'
import { ErrorState, LoadingState } from '../components/ErrorState'
import { CandleChart } from '../components/charts/CandleChart'
import { Gauge } from '../components/Gauge'
import { qOverview, qOhlc, qSignals, qSentiment, qCycles, qNews } from '../lib/queries'
import { fmtUsd, fmtNum, fmtCompact, fmtPct, fmtPctPlain, signClass, relativeTime, formatDate } from '../lib/format'
import { CHART } from '../lib/colors'
import type { Candle } from '../lib/types'

export const Route = createFileRoute('/')({ component: OverviewPage })

const RANGES = [
  { key: '1M', days: 30 },
  { key: '3M', days: 90 },
  { key: '6M', days: 180 },
  { key: '1Y', days: 365 },
] as const

function sentimentColor(score: number) {
  if (score < 40) return CHART.down
  if (score <= 60) return CHART.text
  return CHART.up
}

function cycleColor(score: number) {
  if (score < 40) return CHART.up
  if (score <= 70) return CHART.text
  return CHART.down
}

function OverviewPage() {
  const overview = useQuery(qOverview())
  const signals = useQuery(qSignals())
  const sentiment = useQuery(qSentiment())
  const cycles = useQuery(qCycles())
  const news = useQuery(qNews())

  const [chartSymbol, setChartSymbol] = useState<'BTC' | 'CCI30'>('BTC')
  const [rangeKey, setRangeKey] = useState<(typeof RANGES)[number]['key']>('6M')
  const ohlc = useQuery(qOhlc(chartSymbol))
  const [hovered, setHovered] = useState<Candle | null>(null)

  const days = RANGES.find((r) => r.key === rangeKey)?.days ?? 180
  const candles = useMemo(
    () => (ohlc.data?.data.candles ?? []).slice(-days),
    [ohlc.data, days],
  )
  const readout = hovered ?? (candles.length ? candles[candles.length - 1] : null)

  const summary = useMemo(() => {
    if (candles.length < 2) return null
    const first = candles[0]
    const last = candles[candles.length - 1]
    const high = Math.max(...candles.map((k) => k.h))
    const low = Math.min(...candles.map((k) => k.l))
    const chg = (last.c / first.c - 1) * 100
    return `From ${formatDate(new Date(first.t * 1000).toISOString())} to ${formatDate(new Date(last.t * 1000).toISOString())}: ${fmtUsd(first.c)} → ${fmtUsd(last.c)} (${fmtPct(chg)}). High ${fmtUsd(high)}, low ${fmtUsd(low)}.`
  }, [candles])

  const ov = overview.data?.data
  const stats: StatItem[] = []
  if (ov?.global?.totalMcapUsd != null) {
    stats.push({
      label: 'Total market cap',
      value: `$${fmtCompact(ov.global.totalMcapUsd)}`,
      sub: ov.global.mcapChange24hPct != null ? (
        <span className={signClass(ov.global.mcapChange24hPct)}>{fmtPct(ov.global.mcapChange24hPct)} / 24h</span>
      ) : undefined,
    })
  }
  if (ov?.global?.totalVolumeUsd != null) {
    stats.push({ label: '24h volume', value: `$${fmtCompact(ov.global.totalVolumeUsd)}` })
  }
  if (ov?.global?.btcDominancePct != null) {
    stats.push({
      label: 'BTC / ETH dominance',
      value: fmtPctPlain(ov.global.btcDominancePct),
      sub: ov.global.ethDominancePct != null ? `ETH ${fmtPctPlain(ov.global.ethDominancePct)}` : undefined,
    })
  }
  if (ov?.fng) {
    stats.push({
      label: 'Fear & Greed',
      value: String(ov.fng.value),
      sub: ov.fng.classification ?? undefined,
      tone: ov.fng.value < 40 ? 'down' : ov.fng.value > 60 ? 'up' : 'muted',
    })
  }
  if (ov?.cci30) {
    stats.push({
      label: ov.cci30.isReplica ? 'CCi30 (replica)' : 'CCi30',
      value: fmtNum(ov.cci30.level),
      sub: ov.cci30.chg24hPct != null ? (
        <span className={signClass(ov.cci30.chg24hPct)}>{fmtPct(ov.cci30.chg24hPct)} / 24h</span>
      ) : undefined,
    })
  }
  if (ov?.cme?.basisAnnualizedPct != null) {
    stats.push({
      label: 'CME basis (ann.)',
      value: fmtPct(ov.cme.basisAnnualizedPct),
      sub: `${ov.cme.regime ?? ''} · exp. ${formatDate(ov.cme.estimatedExpiry)}`,
      tone: ov.cme.basisAnnualizedPct >= 0 ? 'up' : 'down',
    })
  } else if (ov) {
    stats.push({ label: 'CME basis (ann.)', value: '—', sub: 'source unavailable', tone: 'muted' })
  }

  const sig = signals.data?.data
  const movers = useMemo(() => {
    const items = (sig?.items ?? []).filter((i) => Number.isFinite(i.chg24hPct))
    const sorted = [...items].sort((a, b) => (b.chg24hPct ?? 0) - (a.chg24hPct ?? 0))
    return { up: sorted.slice(0, 3), down: sorted.slice(-3).reverse() }
  }, [sig])

  const senti = sentiment.data?.data
  const cyc = cycles.data?.data

  return (
    <div className="ov-page">
      <h1 className="page-title">Overview</h1>

      <section aria-label="Global market statistics" className="ov-strip">
        {overview.isPending ? (
          <LoadingState label="Loading global statistics…" />
        ) : overview.isError ? (
          <ErrorState message="Global statistics unavailable." onRetry={() => overview.refetch()} />
        ) : (
          <div className="strip-wrap">
            <StatStrip items={stats} label="Global market" />
            <div className="strip-badge">
              <FreshnessBadge
                source={overview.data.source}
                asOf={overview.data.asOf}
                provider={overview.data.provider}
              />
            </div>
          </div>
        )}
      </section>

      <div className="ov-grid">
        <Panel
          className="ov-chart"
          title="Market"
          meta={chartSymbol === 'BTC' ? 'BTC / USD · daily candles' : 'CCi30 index · daily candles'}
          labelledBy="ov-chart-title"
          actions={
            <>
              <div className="seg" role="group" aria-label="Chart asset">
                {(['BTC', 'CCI30'] as const).map((s) => (
                  <button key={s} type="button" aria-pressed={chartSymbol === s} onClick={() => setChartSymbol(s)}>
                    {s === 'CCI30' ? 'CCi30' : s}
                  </button>
                ))}
              </div>
              <div className="seg" role="group" aria-label="Range">
                {RANGES.map((r) => (
                  <button key={r.key} type="button" aria-pressed={rangeKey === r.key} onClick={() => setRangeKey(r.key)}>
                    {r.key}
                  </button>
                ))}
              </div>
              {ohlc.data && (
                <FreshnessBadge source={ohlc.data.source} asOf={ohlc.data.asOf} provider={ohlc.data.provider} />
              )}
            </>
          }
        >
          {ohlc.isPending ? (
            <LoadingState label="Loading candles…" />
          ) : ohlc.isError ? (
            <ErrorState message="Series unavailable for this market." onRetry={() => ohlc.refetch()} />
          ) : (
            <>
              {readout && (
                <p className="ohlc-row mono" aria-live="off">
                  <span>{formatDate(new Date(readout.t * 1000).toISOString())}</span>
                  <span>O <b>{fmtUsd(readout.o)}</b></span>
                  <span>H <b>{fmtUsd(readout.h)}</b></span>
                  <span>L <b>{fmtUsd(readout.l)}</b></span>
                  <span>C <b className={signClass(readout.c - readout.o)}>{fmtUsd(readout.c)}</b></span>
                  {readout.v > 0 && <span>Vol <b>{fmtCompact(readout.v)}</b></span>}
                </p>
              )}
              <CandleChart
                candles={candles}
                height={330}
                onHover={setHovered}
                ariaLabel={`Daily candles for ${chartSymbol === 'CCI30' ? 'the CCi30 index' : 'Bitcoin'} over ${rangeKey}`}
              />
              {summary && <p className="chart-summary">{summary}</p>}
              {chartSymbol === 'CCI30' && ohlc.data.data.isReplica && (
                <p className="panel-note">Internal “AirCrypto 30” replica (√mcap) — cci30.com unavailable.</p>
              )}
            </>
          )}
        </Panel>

        <div className="ov-side">
          <Panel
            title="Sentiment"
            meta="composite gauge"
            actions={
              sentiment.data && (
                <FreshnessBadge source={sentiment.data.source} asOf={sentiment.data.asOf} />
              )
            }
          >
            {sentiment.isPending ? (
              <LoadingState />
            ) : sentiment.isError || !senti?.composite ? (
              <ErrorState message="Sentiment gauge unavailable." onRetry={() => sentiment.refetch()} />
            ) : (
              <div className="gauge-block">
                <Gauge
                  value={senti.composite.score}
                  label={senti.composite.label}
                  detail={`F&G ${senti.fng?.value ?? '—'} · funding ${senti.funding?.annualizedPct != null ? fmtPct(senti.funding.annualizedPct) : '—'} ann.`}
                  color={sentimentColor(senti.composite.score)}
                />
                <Link to="/sentiment" className="panel-link">
                  Sentiment details →
                </Link>
              </div>
            )}
          </Panel>

          <Panel
            title="Cycle"
            meta="estimated position"
            actions={cycles.data && <FreshnessBadge source={cycles.data.source} asOf={cycles.data.asOf} />}
          >
            {cycles.isPending ? (
              <LoadingState />
            ) : cycles.isError || !cyc?.gauge ? (
              <ErrorState message="Cycle gauge unavailable." onRetry={() => cycles.refetch()} />
            ) : (
              <div className="gauge-block">
                <Gauge
                  value={cyc.gauge.score}
                  label={cyc.gauge.label}
                  detail={`${cyc.phase.daysSince}d since the ${formatDate(cyc.phase.halving)} halving`}
                  color={cycleColor(cyc.gauge.score)}
                />
                <Link to="/cycles" className="panel-link">
                  Cycle details →
                </Link>
              </div>
            )}
          </Panel>
        </div>
      </div>

      <div className="ov-bottom">
        <Panel
          title="Signals"
          meta={sig ? `${sig.items.length} assets tracked` : undefined}
          actions={signals.data && <FreshnessBadge source={signals.data.source} asOf={signals.data.asOf} />}
        >
          {signals.isPending ? (
            <LoadingState />
          ) : signals.isError || !sig ? (
            <ErrorState message="Signals unavailable." onRetry={() => signals.refetch()} />
          ) : (
            <>
              <div className="count-chips" role="group" aria-label="Rating distribution">
                <span className="chip chip-buy">
                  Buy <b>{sig.counts.buy}</b>
                </span>
                <span className="chip chip-hold">
                  Hold <b>{sig.counts.hold}</b>
                </span>
                <span className="chip chip-sell">
                  Sell <b>{sig.counts.sell}</b>
                </span>
                {sig.counts.na > 0 && (
                  <span className="chip chip-na">
                    n/a <b>{sig.counts.na}</b>
                  </span>
                )}
              </div>
              <div className="movers">
                <div>
                  <h3 className="movers-title">Top gainers 24h</h3>
                  <ul>
                    {movers.up.map((i) => (
                      <li key={i.id}>
                        <span className="mono">{i.symbol}</span>
                        <span className="mono">{fmtUsd(i.price)}</span>
                        <span className={`mono ${signClass(i.chg24hPct ?? 0)}`}>{fmtPct(i.chg24hPct ?? 0)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="movers-title">Top losers 24h</h3>
                  <ul>
                    {movers.down.map((i) => (
                      <li key={i.id}>
                        <span className="mono">{i.symbol}</span>
                        <span className="mono">{fmtUsd(i.price)}</span>
                        <span className={`mono ${signClass(i.chg24hPct ?? 0)}`}>{fmtPct(i.chg24hPct ?? 0)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <Link to="/signaux" className="panel-link">
                Full signals table →
              </Link>
            </>
          )}
        </Panel>

        <Panel
          title="Latest news"
          meta="RSS feeds"
          actions={news.data && <FreshnessBadge source={news.data.source} asOf={news.data.asOf} />}
        >
          {news.isPending ? (
            <LoadingState />
          ) : news.isError ? (
            <ErrorState message="News unavailable." onRetry={() => news.refetch()} />
          ) : (
            <>
              <ul className="news-list">
                {news.data.data.items.slice(0, 5).map((item) => (
                  <li key={item.id}>
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      {item.title}
                    </a>
                    <span className="news-meta">
                      {item.source} · {relativeTime(item.publishedAt)}
                    </span>
                  </li>
                ))}
              </ul>
              <Link to="/actualites" className="panel-link">
                All news →
              </Link>
            </>
          )}
        </Panel>
      </div>
    </div>
  )
}
