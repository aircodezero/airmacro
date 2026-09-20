/*
 * Actualités crypto via flux RSS publics (pas de clé requise).
 * Parse minimal <item> : titre, lien, date, catégories, description texte.
 */
import { fetchText } from '../http.mjs'

const FEEDS = [
  { source: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { source: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { source: 'Decrypt', url: 'https://decrypt.co/feed' },
  { source: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/feed' },
  { source: 'The Block', url: 'https://www.theblock.co/rss.xml' },
]

const CATEGORY_RULES = [
  { key: 'Regulation', pattern: /\b(regulat|sec\b|cftc|mica|lawsuit|court|ban|law|legal|congress|senate|treasury|doj|fine[sd]?)\b/i },
  { key: 'ETF', pattern: /\b(etf|etp|spot fund|ishares|blackrock|fidelity fund|grayscale)\b/i },
  { key: 'DeFi', pattern: /\b(defi|dex|lending|liquidity|staking|yield|uniswap|aave|protocol)\b/i },
  { key: 'Macro', pattern: /\b(fed|fomc|inflation|cpi|rate[s]? cut|treasur|macro|recession|dollar|gold)\b/i },
  { key: 'Security', pattern: /\b(hack|exploit|breach|stolen|phishing|scam|drain)\b/i },
  { key: 'Tech', pattern: /\b(upgrade|layer[- ]?2|rollup|zk|mainnet|testnet|protocol upgrade|hard fork|halving|ai\b|node)\b/i },
]

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .trim()
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? decodeEntities(m[1]) : null
}

function tags(block, name) {
  const out = []
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'gi')
  let m
  while ((m = re.exec(block))) out.push(decodeEntities(m[1]))
  return out
}

function categorize(title, description, feedCategories) {
  const haystack = `${title} ${description} ${feedCategories.join(' ')}`
  const cats = new Set()
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(haystack)) cats.add(rule.key)
  }
  if (!cats.size) cats.add('Markets')
  return [...cats].slice(0, 3)
}

function parseFeed(xml, source) {
  const items = []
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []
  for (const block of blocks) {
    const title = tag(block, 'title')
    const link = tag(block, 'link') ?? tag(block, 'guid')
    const pubDate = tag(block, 'pubDate') ?? tag(block, 'dc:date')
    if (!title || !link) continue
    const ts = pubDate ? Date.parse(pubDate) : NaN
    const description = stripTags(tag(block, 'description') ?? '')
    const feedCategories = tags(block, 'category')
    items.push({
      id: `${source}:${link}`.slice(0, 300),
      title: stripTags(title),
      url: link.trim(),
      source,
      publishedAt: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
      categories: categorize(title, description, feedCategories),
      excerpt: description.slice(0, 220),
    })
  }
  return items
}

/** Fusionne les flux joignables, tri anté-chronologique. */
export async function latestNews(limit = 60) {
  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => parseFeed(await fetchText(feed.url, { timeoutMs: 9000 }), feed.source)),
  )
  const items = results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .filter((item) => item.publishedAt)
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
    .slice(0, limit)
  if (!items.length) throw new Error('rss: aucun flux joignable')
  const okFeeds = results.filter((r) => r.status === 'fulfilled').length
  return { items, feedsOk: okFeeds, feedsTotal: FEEDS.length }
}
