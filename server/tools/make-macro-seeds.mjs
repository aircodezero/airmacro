/*
 * Capture les seeds AirMacro (server/seed/macro-*.json) depuis les sources réelles.
 * Usage : node server/tools/make-macro-seeds.mjs [famille…]
 * Attention : BLS v1 est limité à 25 requêtes/jour (le cache disque évite les doublons).
 */
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  rMacroBea,
  rMacroBls,
  rMacroDxy,
  rMacroFed,
  rMacroFf,
  rMacroNyfed,
  rMacroTreasury,
  rMacroVix,
  rMacroWti,
} from '../lib/macro/sources.mjs'

const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed')
const NOTE = 'real snapshot captured from public sources — shown when live data is unavailable'

const FAMILIES = {
  'macro-calendar': rMacroFf,
  'macro-bls': rMacroBls,
  'macro-bea': rMacroBea,
  'macro-treasury': rMacroTreasury,
  'macro-nyfed': rMacroNyfed,
  'macro-fed': rMacroFed,
  'macro-vix': rMacroVix,
  'macro-dxy': rMacroDxy,
  'macro-wti': rMacroWti,
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Le budget live du résolveur peut expirer (gros fichiers) : on attend le fetch de fond. */
async function settle(resolver, maxWaitMs = 180_000) {
  const started = Date.now()
  for (;;) {
    const env = await resolver().catch(() => null)
    if (env && env.source !== 'seed') return env
    if (Date.now() - started > maxWaitMs) return env
    await sleep(3000)
  }
}

async function main() {
  if (process.env.AIRCRYPTO_OFFLINE === '1') {
    console.error('AIRCRYPTO_OFFLINE=1 — capture impossible.')
    process.exit(1)
  }
  const wanted = process.argv.slice(2)
  for (const [name, resolver] of Object.entries(FAMILIES)) {
    if (wanted.length && !wanted.some((w) => name.includes(w))) continue
    const env = await settle(resolver)
    if (!env || env.source === 'seed') {
      console.log(`✗ ${name}: pas de capture live`)
      continue
    }
    const { stale, fetchedAt, ...data } = env.data
    if (stale) console.log(`~ ${name}: donnée disque périmée (${fetchedAt}) — capturée quand même`)
    const payload = { capturedAt: fetchedAt ?? env.asOf, note: NOTE, data: { ...data, fetchedAt } }
    await writeFile(path.join(seedDir, `${name}.json`), JSON.stringify(payload))
    console.log(`✓ ${name} — ${env.provider} (${(JSON.stringify(payload).length / 1024).toFixed(0)} ko)`)
  }
  console.log('Terminé.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
