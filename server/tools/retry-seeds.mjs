/*
 * Recapture patiente des seeds manquants (cme-btc, cme-eth, equities) quand
 * les fournisseurs sortent de leur période de rate-limit.
 * Usage : node server/tools/retry-seeds.mjs
 */
import { access, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rCmeChart, rEquities } from '../lib/sources.mjs'

const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed')
const NOTE = "instantané d'exemple capturé depuis les sources publiques — affiché quand le direct est indisponible"
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const TARGETS = [
  { name: 'cme-btc', make: () => rCmeChart('BTC') },
  { name: 'cme-eth', make: () => rCmeChart('ETH') },
  { name: 'equities', make: () => rEquities(), minSeries: 6 },
]

async function exists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function attempt(target) {
  const file = path.join(seedDir, `${target.name}.json`)
  if (await exists(file)) return true
  try {
    const env = await target.make()
    if (env.source === 'seed') return false
    if (target.minSeries && Object.keys(env.data.series ?? {}).length < target.minSeries) {
      console.log(`~ ${target.name}: seulement ${Object.keys(env.data.series ?? {}).length} séries, on réessaiera`)
      return false
    }
    await writeFile(file, JSON.stringify({ capturedAt: env.asOf, note: NOTE, data: env.data }))
    console.log(`✓ ${target.name} capturé (${(JSON.stringify(env.data).length / 1024).toFixed(0)} ko)`)
    return true
  } catch (err) {
    console.log(`✗ ${target.name}: ${String(err?.message ?? err).slice(0, 120)}`)
    return false
  }
}

for (let round = 1; round <= 6; round++) {
  console.log(`— tour ${round}`)
  const done = []
  for (const target of TARGETS) {
    done.push(await attempt(target))
    await sleep(5000)
  }
  if (done.every(Boolean)) {
    console.log('Tous les seeds manquants sont capturés.')
    process.exit(0)
  }
  if (round < 6) await sleep(8 * 60_000)
}
console.log('Fin des tours — certains seeds restent absents (replis étiquetés en place).')
