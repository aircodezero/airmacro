/*
 * Génère un seed ACTIONS SIMULÉ, clairement étiqueté, quand Stooq/Yahoo sont
 * indisponibles à la capture. Les séries sont des GBM corrélés aux rendements
 * RÉELS de BTC (seed ohlc-BTC), avec volatilités/bêtas plausibles par titre.
 * Remplacé par de vraies données dès qu'une capture live réussit
 * (node server/tools/retry-seeds.mjs ou make-seeds.mjs).
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed')

// LCG déterministe + Box-Muller
let state = 42
function rand() {
  state = (state * 1664525 + 1013904223) % 4294967296
  return state / 4294967296
}
function gauss() {
  const u = Math.max(rand(), 1e-9)
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** [ancrage prix fin de série, vol idiosyncratique annuelle, bêta vs BTC, dérive annuelle] */
const PARAMS = {
  QQQ: [580, 0.15, 0.22, 0.1],
  NVDA: [175, 0.4, 0.5, 0.18],
  COIN: [210, 0.7, 1.1, 0.05],
  MSTR: [225, 0.8, 1.4, -0.05],
  HOOD: [95, 0.6, 0.8, 0.1],
  MARA: [14, 0.8, 1.2, -0.1],
  RIOT: [9.5, 0.8, 1.2, -0.1],
  CLSK: [9, 0.85, 1.2, -0.08],
  AMD: [165, 0.45, 0.45, 0.12],
  AVGO: [190, 0.35, 0.35, 0.15],
  MSFT: [470, 0.2, 0.2, 0.1],
  GOOGL: [200, 0.25, 0.25, 0.12],
  PLTR: [140, 0.55, 0.5, 0.15],
  TSM: [210, 0.32, 0.3, 0.12],
}

const DAY = 86_400_000

async function main() {
  const btcSeed = JSON.parse(await readFile(path.join(seedDir, 'ohlc-BTC.json'), 'utf8'))
  const btcByDate = new Map(
    btcSeed.data.candles.map((k) => [new Date(k.t * 1000).toISOString().slice(0, 10), k.c]),
  )

  // ~640 jours ouvrés se terminant à la dernière date BTC connue
  const lastBtcDate = [...btcByDate.keys()].sort().at(-1)
  const end = new Date(`${lastBtcDate}T00:00:00Z`)
  const days = []
  for (let ts = end.getTime(); days.length < 640; ts -= DAY) {
    const d = new Date(ts)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) days.push(d.toISOString().slice(0, 10))
  }
  days.reverse()

  // facteur BTC : rendement log réel si dispo, sinon 0
  const btcRet = new Map()
  let prevClose = null
  for (const [date, close] of [...btcByDate.entries()].sort()) {
    if (prevClose != null) btcRet.set(date, Math.log(close / prevClose))
    prevClose = close
  }

  const series = {}
  for (const [symbol, [anchor, vol, beta, drift]] of Object.entries(PARAMS)) {
    const rets = days.map((d, i) => {
      if (i === 0) return 0
      const factor = btcRet.get(d) ?? 0
      return drift / 252 + beta * factor + (vol / Math.sqrt(252)) * gauss()
    })
    const raw = []
    let level = 100
    for (const r of rets) {
      level *= Math.exp(r)
      raw.push(level)
    }
    const scale = anchor / raw[raw.length - 1]
    series[symbol] = days.map((d, i) => ({ d, c: Number((raw[i] * scale).toFixed(4)) }))
  }

  const payload = {
    capturedAt: new Date().toISOString(),
    note:
      'SÉRIES ACTIONS SIMULÉES à des fins d’illustration (sources Stooq/Yahoo indisponibles à la capture) — corrélées aux rendements réels de BTC, remplacées par le direct dès son retour.',
    data: { series, failed: [], simulated: true },
  }
  await writeFile(path.join(seedDir, 'equities.json'), JSON.stringify(payload))
  console.log(`equities.json (simulé) écrit — ${Object.keys(series).length} séries × ${days.length} jours`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
