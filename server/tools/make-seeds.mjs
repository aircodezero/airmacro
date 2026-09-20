/*
 * Génère les données d'exemple embarquées (server/seed/*.json) à partir des
 * sources réelles. À relancer quand le réseau est disponible pour rafraîchir
 * les instantanés. Usage : node server/tools/make-seeds.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isExcludedFromSignals } from '../lib/universe.mjs'
import {
  rGlobal,
  rMarkets,
  rFng,
  rCci30,
  rOhlc,
  rCmeChart,
  rDeribitCurve,
  rFunding,
  rPerpBasis,
  rEquities,
  rNews,
  rBtcLong,
} from '../lib/sources.mjs'
import { rSignals } from '../lib/compute/signals.mjs'
import { rCycles } from '../lib/compute/cycles.mjs'

const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed')
const NOTE = "instantané d'exemple capturé depuis les sources publiques — affiché quand le direct est indisponible"

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function writeSeed(name, envPromise) {
  try {
    const env = await envPromise
    if (!env || env.source === 'seed') {
      console.log(`~ ${name}: pas de capture live (source=${env?.source ?? 'aucune'})`)
      return false
    }
    const payload = { capturedAt: env.asOf, note: NOTE, data: env.data }
    const file = path.join(seedDir, `${name}.json`)
    await writeFile(file, JSON.stringify(payload))
    console.log(`✓ ${name} (${(JSON.stringify(payload).length / 1024).toFixed(0)} ko)`)
    return true
  } catch (err) {
    console.log(`✗ ${name}: ${String(err?.message ?? err).slice(0, 140)}`)
    return false
  }
}

async function main() {
  if (process.env.AIRCRYPTO_OFFLINE === '1') {
    console.error('AIRCRYPTO_OFFLINE=1 — impossible de capturer des seeds. Abandon.')
    process.exit(1)
  }
  await mkdir(seedDir, { recursive: true })

  const markets = await rMarkets()
  await writeSeed('markets', Promise.resolve(markets))

  await writeSeed('global', rGlobal())
  await writeSeed('fng', rFng())
  await writeSeed('cci30', rCci30())
  await writeSeed('funding', rFunding())
  await writeSeed('basis-perp', rPerpBasis())
  await writeSeed('cme-btc', rCmeChart('BTC'))
  await writeSeed('cme-eth', rCmeChart('ETH'))
  await writeSeed('deribit-btc', rDeribitCurve('BTC'))
  await writeSeed('deribit-eth', rDeribitCurve('ETH'))
  await writeSeed('news', rNews())
  await writeSeed('btc-long', rBtcLong())
  await writeSeed('equities', rEquities())

  const universe = (markets.data.items ?? [])
    .filter((item) => !isExcludedFromSignals(item.symbol))
    .slice(0, 30)
    .map((item) => item.symbol)
  const symbols = [...new Set(['BTC', 'ETH', ...universe])]
  console.log(`OHLC pour ${symbols.length} symboles…`)
  for (const symbol of symbols) {
    await writeSeed(`ohlc-${symbol}`, rOhlc(symbol))
    await sleep(250)
  }

  // après les OHLC : les calculs réutilisent les séries en cache mémoire
  await writeSeed('signals', rSignals())
  await writeSeed('cycles', rCycles())

  console.log('Terminé.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
