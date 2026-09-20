import { fetchJson } from '../http.mjs'

const UA_HEADERS = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' }

/**
 * Série quotidienne Yahoo Finance ({ d, c }) + méta (dernier prix).
 * `curlFallback` : bascule sur curl après un 429 (empreinte TLS de node refusée).
 */
export async function chartDaily(symbol, range = '1y', { curlFallback = false } = {}) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`
  let json
  try {
    json = await fetchJson(`https://query1.finance.yahoo.com${path}`, {
      timeoutMs: 7000,
      retries: 1,
      headers: UA_HEADERS,
      curlFallback,
    })
  } catch {
    json = await fetchJson(`https://query2.finance.yahoo.com${path}`, {
      timeoutMs: 7000,
      retries: 1,
      headers: UA_HEADERS,
      curlFallback,
    })
  }
  const result = json.chart?.result?.[0]
  if (!result) throw new Error(`yahoo: pas de données pour ${symbol}`)
  const timestamps = result.timestamp ?? []
  const closes = result.indicators?.quote?.[0]?.close ?? []
  const rows = []
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i]
    if (Number.isFinite(c)) {
      rows.push({ d: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), c })
    }
  }
  return {
    symbol,
    lastPrice: result.meta?.regularMarketPrice ?? (rows.length ? rows[rows.length - 1].c : null),
    lastTime: result.meta?.regularMarketTime ?? null,
    exchange: result.meta?.fullExchangeName ?? null,
    rows,
  }
}
