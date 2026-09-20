import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Panel } from '../components/Panel'
import { FreshnessBadge } from '../components/FreshnessBadge'
import { ErrorState, LoadingState } from '../components/ErrorState'
import { qNews } from '../lib/queries'
import { relativeTime } from '../lib/format'

export const Route = createFileRoute('/actualites')({ component: NewsPage })

const CATEGORIES = ['All', 'Regulation', 'ETF', 'DeFi', 'Macro', 'Security', 'Tech', 'Markets'] as const
const PAGE_SIZE = 12

function NewsPage() {
  const news = useQuery(qNews())
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All')
  const [limit, setLimit] = useState(PAGE_SIZE)

  const items = news.data?.data.items ?? []
  const filtered = useMemo(
    () => (category === 'All' ? items : items.filter((item) => item.categories.includes(category))),
    [items, category],
  )
  const visible = filtered.slice(0, limit)

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of items) {
      for (const cat of item.categories) map.set(cat, (map.get(cat) ?? 0) + 1)
    }
    return map
  }, [items])

  return (
    <div className="page-stack">
      <h1 className="page-title">News</h1>
      <Panel
        title="Crypto feed"
        meta="Cointelegraph · CoinDesk · Decrypt · Bitcoin Magazine · The Block"
        actions={
          news.data && (
            <FreshnessBadge source={news.data.source} asOf={news.data.asOf} provider={news.data.provider} />
          )
        }
      >
        {news.isPending ? (
          <LoadingState label="Loading feed…" />
        ) : news.isError ? (
          <ErrorState message="News feed unavailable." onRetry={() => news.refetch()} />
        ) : (
          <>
            <div className="seg news-filters" role="group" aria-label="Filter by category">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  aria-pressed={category === cat}
                  onClick={() => {
                    setCategory(cat)
                    setLimit(PAGE_SIZE)
                  }}
                >
                  {cat}
                  {cat !== 'All' && counts.get(cat) ? <span className="muted"> {counts.get(cat)}</span> : null}
                </button>
              ))}
            </div>

            {visible.length === 0 ? (
              <p className="panel-note">No articles in this category yet.</p>
            ) : (
              <ul className="news-list news-page-list">
                {visible.map((item) => (
                  <li key={item.id}>
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      {item.title}
                    </a>
                    {item.excerpt && <p className="news-excerpt">{item.excerpt}</p>}
                    <span className="news-meta">
                      {item.source} · {item.publishedAt ? relativeTime(item.publishedAt) : '—'}
                      {item.categories.length > 0 && <> · {item.categories.join(' · ')}</>}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {filtered.length > visible.length && (
              <button type="button" className="btn news-more" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                Load more ({filtered.length - visible.length} remaining)
              </button>
            )}
            <p className="panel-note">
              Headlines from public RSS feeds, opened in a new tab. Categories are assigned
              automatically by keyword.
            </p>
          </>
        )}
      </Panel>
    </div>
  )
}
