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
import { LineChart } from '../components/charts/LineChart'
import { XYChart, type XYLine } from '../components/charts/XYChart'
import { qFunding, qBasis } from '../lib/queries'
import { fmtNum, fmtPct, fmtUsd, fmtCompact, formatDate, signClass } from '../lib/format'
import { SERIES } from '../lib/colors'
import type { FundingRow } from '../lib/types'

export const Route = createFileRoute('/funding')({ component: FundingPage })

const columnHelper = createColumnHelper<FundingRow>()
const ANNUALIZE = 3 * 365

function rateCell(rate8hPct: number | null | undefined, annualized: boolean) {
  if (rate8hPct == null || !Number.isFinite(rate8hPct)) {
    return <span className="muted">—</span>
  }
  const value = annualized ? rate8hPct * ANNUALIZE : rate8hPct
  const alpha = Math.min(Math.abs(rate8hPct) / 0.03, 1) * 0.45
  const background =
    rate8hPct >= 0 ? `rgba(62, 207, 163, ${alpha})` : `rgba(255, 126, 147, ${alpha})`
  return (
    <span className="rate-pill mono" style={{ background }}>
      {annualized ? fmtPct(value, 1) : fmtPct(value, 4)}
    </span>
  )
}

function nextFundingLabel(ts: number | null | undefined) {
  if (!ts) return '—'
  const diffMin = Math.max(0, Math.round((ts - Date.now()) / 60000))
  const h = Math.floor(diffMin / 60)
  const m = diffMin % 60
  return h > 0 ? `in ${h}h ${String(m).padStart(2, '0')}m` : `in ${m} min`
}

function FundingPage() {
  const funding = useQuery(qFunding())
  const basis = useQuery(qBasis())
  const [annualized, setAnnualized] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])

  const fundingData = funding.data?.data
  const basisData = basis.data?.data

  const columns = useMemo(
    () => [
      columnHelper.accessor('symbol', {
        id: 'symbol',
        header: 'Perp',
        cell: (info) => (
          <span className="asset-btn">
            <b>{info.getValue()}USDT</b>
          </span>
        ),
      }),
      columnHelper.accessor((row) => row.price ?? -1, {
        id: 'price',
        header: 'Mark / USD',
        cell: (info) => (info.row.original.price != null ? fmtUsd(info.row.original.price) : '—'),
      }),
      columnHelper.accessor((row) => row.binance?.rate8hPct ?? -1e9, {
        id: 'binance',
        header: 'Binance',
        cell: (info) => rateCell(info.row.original.binance?.rate8hPct, annualized),
      }),
      columnHelper.accessor((row) => row.okx?.rate8hPct ?? -1e9, {
        id: 'okx',
        header: 'OKX',
        cell: (info) => rateCell(info.row.original.okx?.rate8hPct, annualized),
      }),
      columnHelper.accessor((row) => row.bybit?.rate8hPct ?? -1e9, {
        id: 'bybit',
        header: 'Bybit',
        cell: (info) => rateCell(info.row.original.bybit?.rate8hPct, annualized),
      }),
      columnHelper.accessor(
        (row) => row.binance?.oiUsd ?? row.bybit?.oiUsd ?? -1,
        {
          id: 'oi',
          header: 'Open Interest',
          cell: (info) => {
            const row = info.row.original
            const oi = row.binance?.oiUsd ?? row.bybit?.oiUsd
            return oi != null ? `$${fmtCompact(oi)}` : <span className="muted">—</span>
          },
        },
      ),
      columnHelper.accessor((row) => row.binance?.nextFundingTime ?? 0, {
        id: 'next',
        header: 'Next funding',
        cell: (info) => (
          <span className="muted">{nextFundingLabel(info.row.original.binance?.nextFundingTime)}</span>
        ),
      }),
    ],
    [annualized],
  )

  const table = useReactTable({
    data: fundingData?.rows ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const historySeries = useMemo(() => {
    if (!fundingData) return []
    const factor = annualized ? ANNUALIZE : 1
    return [
      {
        key: 'btc',
        label: 'BTC',
        color: SERIES.gold,
        data: fundingData.history.BTC.map((p) => ({ t: p.t, v: p.rate8hPct * factor })),
      },
      {
        key: 'eth',
        label: 'ETH',
        color: SERIES.violet,
        data: fundingData.history.ETH.map((p) => ({ t: p.t, v: p.rate8hPct * factor })),
      },
    ]
  }, [fundingData, annualized])

  const termLines = useMemo<XYLine[]>(() => {
    if (!basisData) return []
    const lines: XYLine[] = []
    const btc = basisData.deribit.BTC
    const eth = basisData.deribit.ETH
    if (btc?.curve?.length) {
      lines.push({
        key: 'btc',
        label: 'BTC',
        color: SERIES.gold,
        markers: true,
        points: btc.curve
          .filter((p) => p.basisAnnualizedPct != null)
          .map((p) => ({ x: p.daysToExpiry, y: p.basisAnnualizedPct as number })),
      })
    }
    if (eth?.curve?.length) {
      lines.push({
        key: 'eth',
        label: 'ETH',
        color: SERIES.violet,
        markers: true,
        points: eth.curve
          .filter((p) => p.basisAnnualizedPct != null)
          .map((p) => ({ x: p.daysToExpiry, y: p.basisAnnualizedPct as number })),
      })
    }
    return lines
  }, [basisData])

  const cmeHistorySeries = useMemo(() => {
    if (!basisData) return []
    const series = []
    if (basisData.cme.BTC?.history?.length) {
      series.push({
        key: 'btc',
        label: 'BTC (CME premium %)',
        color: SERIES.gold,
        data: basisData.cme.BTC.history.map((p) => ({ t: Date.parse(`${p.d}T00:00:00Z`) / 1000, v: p.premiumPct })),
      })
    }
    if (basisData.cme.ETH?.history?.length) {
      series.push({
        key: 'eth',
        label: 'ETH (CME premium %)',
        color: SERIES.violet,
        data: basisData.cme.ETH.history.map((p) => ({ t: Date.parse(`${p.d}T00:00:00Z`) / 1000, v: p.premiumPct })),
      })
    }
    return series
  }, [basisData])

  const fundingBadge = funding.data && (
    <FreshnessBadge source={funding.data.source} asOf={funding.data.asOf} provider={funding.data.provider} />
  )
  const basisBadge = basis.data && (
    <FreshnessBadge source={basis.data.source} asOf={basis.data.asOf} provider={basis.data.provider} />
  )

  const cmeBtc = basisData?.cme.BTC?.current ?? null
  const cmeEth = basisData?.cme.ETH?.current ?? null
  const perp = basisData?.perp ?? null

  return (
    <div className="page-stack">
      <h1 className="page-title">Funding &amp; Basis</h1>

      <Panel
        title="Funding rates"
        meta="USDT perps · rate per 8h period"
        actions={
          <>
            <div className="seg" role="group" aria-label="Rate unit">
              <button type="button" aria-pressed={!annualized} onClick={() => setAnnualized(false)}>
                8h
              </button>
              <button type="button" aria-pressed={annualized} onClick={() => setAnnualized(true)}>
                Annualized
              </button>
            </div>
            {fundingBadge}
          </>
        }
      >
        {funding.isPending ? (
          <LoadingState label="Loading funding rates…" />
        ) : funding.isError || !fundingData ? (
          <ErrorState message="Funding rates unavailable." onRetry={() => funding.refetch()} />
        ) : (
          <>
            <div className="table-scroll" role="region" aria-label="Funding by exchange" tabIndex={0}>
              <table className="data">
                <thead>
                  {table.getHeaderGroups().map((hg) => (
                    <tr key={hg.id}>
                      {hg.headers.map((header) => {
                        const sorted = header.column.getIsSorted()
                        return (
                          <th
                            key={header.id}
                            aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                          >
                            <button type="button" className="th-sort" onClick={header.column.getToggleSortingHandler()}>
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              <span aria-hidden="true" className="sort-mark">
                                {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : ''}
                              </span>
                            </button>
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
            <p className="panel-note">
              Rates paid per 8h period ({annualized ? 'annualized display: rate × 3 × 365' : 'raw rates'}).
              Positive: longs pay shorts. Top-10 average:{' '}
              {fundingData.aggregate.avg8hPct != null ? (
                <b className={signClass(fundingData.aggregate.avg8hPct)}>
                  {annualized
                    ? `${fmtPct((fundingData.aggregate.annualizedPct ?? 0), 1)} annualized`
                    : `${fmtPct(fundingData.aggregate.avg8hPct, 4)} / 8h`}
                </b>
              ) : (
                '—'
              )}
              .
            </p>
          </>
        )}
      </Panel>

      <div className="fund-grid">
        <Panel title="Funding history" meta="BTC & ETH · ~90 days" actions={fundingBadge}>
          {fundingData && historySeries.some((s) => s.data.length > 0) ? (
            <>
              <LineChart
                series={historySeries}
                height={240}
                ariaLabel="BTC and ETH funding rate history"
                valueFormat={(v) => (annualized ? fmtPct(v, 1) : fmtPct(v, 4))}
                priceLines={[{ value: 0, label: '0', dashed: false }]}
              />
              <p className="chart-summary">
                Persistently positive funding signals crowded longs (overheating); negative funding,
                shorts paying (selling stress).
              </p>
            </>
          ) : (
            <ErrorState message="History unavailable." />
          )}
        </Panel>

        <Panel title="Deribit term structure" meta="annualized basis by expiry" actions={basisBadge}>
          {basis.isPending ? (
            <LoadingState />
          ) : termLines.length ? (
            <>
              <XYChart
                lines={termLines}
                height={240}
                ariaLabel="Annualized basis of Deribit futures by expiry"
                xFormat={(x) => `${Math.round(x)}d`}
                yFormat={(y) => fmtPct(y, 1)}
                refLinesY={[{ value: 0, label: '0' }]}
              />
              <p className="chart-summary">
                {basisData?.deribit.BTC ? (
                  <>
                    BTC index: {fmtUsd(basisData.deribit.BTC.indexPrice)} ·{' '}
                    {termLines[0].points.every((p) => p.y >= 0)
                      ? 'curve in contango (positive basis)'
                      : termLines[0].points.every((p) => p.y <= 0)
                        ? 'curve in backwardation (negative basis)'
                        : 'mixed curve'}
                    .
                  </>
                ) : null}{' '}
                Annualized basis = (mark/index)^(365/d) − 1.
              </p>
            </>
          ) : (
            <ErrorState message="Deribit curve unavailable — labeled fallback." onRetry={() => basis.refetch()} />
          )}
        </Panel>
      </div>

      <Panel
        title="CME — regulated futures"
        meta="front month vs spot (Yahoo Finance)"
        actions={basisBadge}
      >
        {basis.isPending ? (
          <LoadingState />
        ) : cmeBtc || cmeEth ? (
          <div className="cme-wrap">
            <div className="cme-stats">
              {cmeBtc && (
                <div className="cme-block">
                  <h3 className="drawer-subtitle">BTC=F</h3>
                  <p className="funding-big mono">
                    <span className={signClass(cmeBtc.basisAnnualizedPct ?? 0)}>
                      {cmeBtc.basisAnnualizedPct != null ? fmtPct(cmeBtc.basisAnnualizedPct, 2) : '—'}
                    </span>
                  </p>
                  <p className="muted text-sm">
                    annualized basis · {cmeBtc.regime ?? '—'} · premium {cmeBtc.premiumPct != null ? fmtPct(cmeBtc.premiumPct, 2) : '—'}
                  </p>
                  <p className="muted text-xs">
                    Future {fmtUsd(cmeBtc.futurePrice)} vs spot {fmtUsd(cmeBtc.spotPrice)} · est. expiry{' '}
                    {formatDate(cmeBtc.estimatedExpiry)} ({fmtNum(cmeBtc.daysToExpiry, 0)}d)
                  </p>
                </div>
              )}
              {cmeEth && (
                <div className="cme-block">
                  <h3 className="drawer-subtitle">ETH=F</h3>
                  <p className="funding-big mono">
                    <span className={signClass(cmeEth.basisAnnualizedPct ?? 0)}>
                      {cmeEth.basisAnnualizedPct != null ? fmtPct(cmeEth.basisAnnualizedPct, 2) : '—'}
                    </span>
                  </p>
                  <p className="muted text-sm">
                    annualized basis · {cmeEth.regime ?? '—'} · premium {cmeEth.premiumPct != null ? fmtPct(cmeEth.premiumPct, 2) : '—'}
                  </p>
                </div>
              )}
              {perp && (
                <div className="cme-block">
                  <h3 className="drawer-subtitle">Perp basis (comparison)</h3>
                  <ul className="perp-list mono text-sm">
                    {perp.BTC && (
                      <li>
                        BTC mark vs index:{' '}
                        <span className={signClass(perp.BTC.premiumPct)}>{fmtPct(perp.BTC.premiumPct, 3)}</span>
                      </li>
                    )}
                    {perp.ETH && (
                      <li>
                        ETH mark vs index:{' '}
                        <span className={signClass(perp.ETH.premiumPct)}>{fmtPct(perp.ETH.premiumPct, 3)}</span>
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
            {cmeHistorySeries.length > 0 && (
              <>
                <LineChart
                  series={cmeHistorySeries}
                  height={230}
                  ariaLabel="CME futures premium vs spot over one year"
                  valueFormat={(v) => fmtPct(v, 2)}
                  priceLines={[{ value: 0, label: '0', dashed: false }]}
                />
                <p className="chart-summary">
                  Daily front-month premium vs spot (not annualized): above zero the market pays a
                  premium (contango); below, a discount (backwardation).
                </p>
              </>
            )}
          </div>
        ) : (
          <div>
            <ErrorState
              message="CME source (Yahoo Finance) is currently unavailable — levels and history will appear as soon as it returns."
              onRetry={() => basis.refetch()}
            />
            {perp && (
              <ul className="perp-list mono text-sm" style={{ marginTop: 12 }}>
                {perp.BTC && (
                  <li>
                    BTC perp basis (mark vs index):{' '}
                    <span className={signClass(perp.BTC.premiumPct)}>{fmtPct(perp.BTC.premiumPct, 3)}</span>
                  </li>
                )}
                {perp.ETH && (
                  <li>
                    ETH perp basis (mark vs index):{' '}
                    <span className={signClass(perp.ETH.premiumPct)}>{fmtPct(perp.ETH.premiumPct, 3)}</span>
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </Panel>
    </div>
  )
}
