import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { Panel } from '../components/Panel'
import { FreshnessBadge } from '../components/FreshnessBadge'
import { ErrorState, LoadingState } from '../components/ErrorState'
import { RatingChip } from '../components/RatingChip'
import { Sparkline } from '../components/Sparkline'
import { AssetDrawer } from '../components/AssetDrawer'
import { qSignals } from '../lib/queries'
import { fmtUsd, fmtPct, fmtCompact, fmtNum, signClass } from '../lib/format'
import type { Rating, SignalItem } from '../lib/types'

export const Route = createFileRoute('/signaux')({ component: SignauxPage })

const columnHelper = createColumnHelper<SignalItem>()
const RATING_ORDER: Record<Rating, number> = { BUY: 3, HOLD: 2, SELL: 1, NA: 0 }
const FILTERS: Array<{ key: 'ALL' | Rating; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'BUY', label: 'Buy' },
  { key: 'HOLD', label: 'Hold' },
  { key: 'SELL', label: 'Sell' },
]

function signedCell(value: number | null) {
  if (value == null) return <span className="muted">—</span>
  return <span className={signClass(value)}>{fmtPct(value)}</span>
}

function SignauxPage() {
  const signals = useQuery(qSignals())
  const [sorting, setSorting] = useState<SortingState>([{ id: 'rank', desc: false }])
  const [ratingFilter, setRatingFilter] = useState<'ALL' | Rating>('ALL')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<SignalItem | null>(null)

  const data = signals.data?.data
  const filtered = useMemo(() => {
    const items = data?.items ?? []
    const needle = search.trim().toLowerCase()
    return items.filter(
      (item) =>
        (ratingFilter === 'ALL' || item.rating === ratingFilter) &&
        (!needle || `${item.name} ${item.symbol}`.toLowerCase().includes(needle)),
    )
  }, [data, ratingFilter, search])

  const columns = useMemo(
    () => [
      columnHelper.accessor('rank', {
        id: 'rank',
        header: '#',
        cell: (info) => info.getValue() ?? '—',
      }),
      columnHelper.accessor((row) => row.name, {
        id: 'asset',
        header: 'Asset',
        cell: (info) => {
          const item = info.row.original
          return (
            <button
              type="button"
              className="asset-btn"
              onClick={() => setSelected(item)}
              aria-label={`Open detailed view for ${item.name}`}
            >
              <b>{item.symbol}</b>
              <span className="muted">{item.name}</span>
            </button>
          )
        },
      }),
      columnHelper.accessor('price', {
        id: 'price',
        header: 'Price / USD',
        cell: (info) => fmtUsd(info.getValue()),
      }),
      columnHelper.accessor((row) => row.chg24hPct ?? -1e9, {
        id: 'chg24h',
        header: '24h %',
        cell: (info) => signedCell(info.row.original.chg24hPct),
      }),
      columnHelper.accessor((row) => row.chg7dPct ?? -1e9, {
        id: 'chg7d',
        header: '7d %',
        cell: (info) => signedCell(info.row.original.chg7dPct),
      }),
      columnHelper.accessor('mcap', {
        id: 'mcap',
        header: 'Mcap',
        cell: (info) => `$${fmtCompact(info.getValue())}`,
      }),
      columnHelper.display({
        id: 'spark',
        header: '7d',
        cell: (info) => <Sparkline values={info.row.original.spark7d} />,
      }),
      columnHelper.accessor((row) => row.metrics?.rsi14 ?? -1, {
        id: 'rsi',
        header: 'RSI(14)',
        cell: (info) => {
          const rsi = info.row.original.metrics?.rsi14
          if (rsi == null) return <span className="muted">—</span>
          const zone = rsi >= 70 ? 'overbought' : rsi <= 30 ? 'oversold' : null
          return (
            <span title={zone ?? undefined} className={zone ? 'rsi-extreme' : undefined}>
              {fmtNum(rsi, 0)}
            </span>
          )
        },
      }),
      columnHelper.accessor((row) => row.metrics?.priceVsSma200Pct ?? -1e9, {
        id: 'trend',
        header: 'Trend',
        cell: (info) => {
          const metrics = info.row.original.metrics
          if (metrics?.aboveSma200 == null) {
            return metrics?.aboveSma50 != null ? (
              <span className={metrics.aboveSma50 ? 'positive' : 'negative'}>
                {metrics.aboveSma50 ? '▲ > SMA50' : '▼ < SMA50'}
              </span>
            ) : (
              <span className="muted">—</span>
            )
          }
          return (
            <span className={metrics.aboveSma200 ? 'positive' : 'negative'}>
              {metrics.aboveSma200 ? '▲ > SMA200' : '▼ < SMA200'}
            </span>
          )
        },
      }),
      columnHelper.accessor((row) => row.fundingAnnualizedPct ?? -1e9, {
        id: 'funding',
        header: 'Funding ann.',
        cell: (info) => {
          const value = info.row.original.fundingAnnualizedPct
          return value == null ? <span className="muted">—</span> : signedCell(value)
        },
      }),
      columnHelper.accessor((row) => row.score ?? -1, {
        id: 'score',
        header: 'Score',
        cell: (info) => {
          const score = info.row.original.score
          if (score == null) return <span className="muted">—</span>
          return (
            <span className="score-cell">
              <span className="score-track" aria-hidden="true">
                <span className="score-fill" style={{ width: `${score}%` }} />
              </span>
              {score}
            </span>
          )
        },
      }),
      columnHelper.accessor((row) => RATING_ORDER[row.rating], {
        id: 'rating',
        header: 'Rating',
        cell: (info) => {
          const item = info.row.original
          return <RatingChip rating={item.rating} partial={item.partial} />
        },
      }),
    ],
    [],
  )

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className="sig-page">
      <h1 className="page-title">Signals</h1>
      <Panel
        title="Rated universe"
        meta={data?.universeNote}
        actions={
          <>
            {data && (
              <span className="muted text-xs">
                Buy ≥ {data.thresholds.buy} · Sell &lt; {data.thresholds.sell}
              </span>
            )}
            {signals.data && (
              <FreshnessBadge
                source={signals.data.source}
                asOf={signals.data.asOf}
                provider={signals.data.provider}
              />
            )}
          </>
        }
      >
        {signals.isPending ? (
          <LoadingState label="Computing signals…" />
        ) : signals.isError || !data ? (
          <ErrorState message="Signals unavailable." onRetry={() => signals.refetch()} />
        ) : (
          <>
            <div className="sig-toolbar">
              <div className="seg" role="group" aria-label="Filter by rating">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={ratingFilter === f.key}
                    onClick={() => setRatingFilter(f.key)}
                  >
                    {f.label}
                    {f.key !== 'ALL' && data && (
                      <span className="muted">
                        {' '}
                        {f.key === 'BUY' ? data.counts.buy : f.key === 'HOLD' ? data.counts.hold : data.counts.sell}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <label className="search-field">
                <span className="sr-only">Search assets</span>
                <input
                  type="search"
                  placeholder="Search (name or symbol)…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <span className="muted text-xs">
                {filtered.length} / {data.items.length} assets
              </span>
            </div>

            <div className="table-scroll" role="region" aria-label="Signals table" tabIndex={0}>
              <table className="data sig-table">
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => {
                        const sorted = header.column.getIsSorted()
                        const canSort = header.column.getCanSort() && header.column.id !== 'spark'
                        return (
                          <th
                            key={header.id}
                            aria-sort={
                              sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
                            }
                          >
                            {canSort ? (
                              <button
                                type="button"
                                className="th-sort"
                                onClick={header.column.getToggleSortingHandler()}
                              >
                                {flexRender(header.column.columnDef.header, header.getContext())}
                                <span aria-hidden="true" className="sort-mark">
                                  {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : ''}
                                </span>
                              </button>
                            ) : (
                              flexRender(header.column.columnDef.header, header.getContext())
                            )}
                          </th>
                        )
                      })}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="panel-note sig-footnote">
              * score computed on partial history (&lt; 220 days). Weights: Trend 35% · Momentum 30% ·
              Context 20% · Risk 15%. Scores are generated automatically from public data — an
              information tool, <b>not investment advice</b>.
            </p>
          </>
        )}
      </Panel>

      {selected && <AssetDrawer item={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
