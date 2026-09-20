import path from 'node:path'
import { bootServer, rootDir } from './boot.mjs'
import { registerApi } from './routes/index.mjs'

await bootServer({
  name: 'AirCrypto',
  defaultPort: 4517,
  registerApi,
  vite: { root: rootDir },
  distDir: path.join(rootDir, 'dist'),
})

// Préchauffage des caches après le démarrage : la première visite ne paie pas
// les retries amont (egress instable). Sans effet en mode offline.
if (process.env.AIRCRYPTO_OFFLINE !== '1') {
  setTimeout(async () => {
    const { rMarkets, rGlobal, rFng, rFunding, rNews, rCci30, rCmeChart, rDeribitCurve, rPerpBasis, rEquities } =
      await import('./lib/sources.mjs')
    const { rSignals } = await import('./lib/compute/signals.mjs')
    const { rCycles } = await import('./lib/compute/cycles.mjs')
    const warmups = [
      rMarkets,
      rGlobal,
      rFng,
      rFunding,
      rNews,
      rCci30,
      rSignals,
      rCycles,
      rPerpBasis,
      rEquities,
      () => rCmeChart('BTC'),
      () => rCmeChart('ETH'),
      () => rDeribitCurve('BTC'),
      () => rDeribitCurve('ETH'),
    ]
    for (const warm of warmups) {
      warm().catch(() => {})
    }
  }, 1200)
}
