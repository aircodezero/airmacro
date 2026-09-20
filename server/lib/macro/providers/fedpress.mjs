/*
 * Réserve fédérale — flux RSS officiel des communiqués de politique monétaire
 * et lecture de la décision dans le communiqué FOMC (page officielle liée).
 */
import { fetchText } from '../../http.mjs'
import { parseFomcDecision } from '../../../../shared/analytics/macroseries.mjs'

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘' }

export function decodeEntities(text) {
  return String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .trim()
}

export function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ')
}

const STATEMENT_PATH = /^\/newsevents\/pressreleases\/monetary(\d{4})(\d{2})(\d{2})[a-z]\.htm$/

export function isFedPressUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'www.federalreserve.gov' && STATEMENT_PATH.test(url.pathname)
  } catch {
    return false
  }
}

/** Date 'YYYY-MM-DD' d'un communiqué d'après son URL (monetary20260916a.htm). */
export function pressReleaseDate(value) {
  try {
    const m = STATEMENT_PATH.exec(new URL(value).pathname)
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null
  } catch {
    return null
  }
}

export function classifyFedItem(title) {
  if (/issues FOMC statement/i.test(title)) return 'statement'
  if (/^Minutes of the Federal Open Market Committee/i.test(title)) return 'minutes'
  if (/economic projections/i.test(title)) return 'projections'
  return 'other'
}

export function parseFedRss(xml) {
  const items = []
  for (const match of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const pick = (tag) => {
      const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(match[1])
      return m ? decodeEntities(m[1]) : null
    }
    const title = pick('title')
    const url = pick('link')
    if (!title || !url || !isFedPressUrl(url)) continue
    const ts = Date.parse(pick('pubDate') ?? '')
    items.push({
      title,
      url,
      date: pressReleaseDate(url),
      ts: Number.isFinite(ts) ? ts : null,
      type: classifyFedItem(title),
    })
  }
  return items
}

export async function monetaryFeed() {
  const xml = await fetchText('https://www.federalreserve.gov/feeds/press_monetary.xml', { timeoutMs: 20_000 })
  const items = parseFedRss(xml)
  if (!items.length) throw new Error('fed rss: aucun communiqué')
  return items
}

/** Décision lue dans un communiqué officiel (null si le texte ne la contient pas). */
export async function statementDecision(url) {
  if (!isFedPressUrl(url)) throw new Error('fed: URL de communiqué inattendue')
  const html = await fetchText(url, { timeoutMs: 25_000 })
  return parseFomcDecision(htmlToText(html))
}
