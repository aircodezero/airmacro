/*
 * AirMacro — app dédiée : calendrier macro, indicateurs officiels, explications IA
 * et alertes (push natif + ntfy). Seul ce serveur surveille les annonces.
 */
import path from 'node:path'
import { bootServer, rootDir } from './boot.mjs'
import { cacheInfo, isOffline } from './lib/cache.mjs'
import { nowIso } from './routes/util.mjs'
import { calendarHandler, macroHealth, registerMacroApi, seriesHandler } from './routes/macro.mjs'
import { notifierStatus, startNotifier } from './routes/macro-notify.mjs'

const appDir = path.join(rootDir, 'apps', 'airmacro')

await bootServer({
  name: 'AirMacro',
  defaultPort: 4518,
  registerApi: (api) => {
    registerMacroApi(api)
    api.get('/health', async (_req, res) => {
      res.json({
        ok: true,
        app: 'airmacro',
        mode: isOffline() ? 'offline (seeds forced)' : 'online',
        now: nowIso(),
        cache: cacheInfo(),
        macro: await macroHealth().catch((err) => ({ error: String(err?.message ?? err).slice(0, 120) })),
        notify: notifierStatus(),
      })
    })
  },
  vite: { root: appDir, configFile: path.join(appDir, 'vite.config.ts') },
  distDir: path.join(rootDir, 'dist-airmacro'),
  onListening: startNotifier,
})

// Préchauffage : caches disque d'abord (quotas BLS/EIA), puis amont si périmé.
if (process.env.AIRCRYPTO_OFFLINE !== '1') {
  setTimeout(() => {
    calendarHandler()
      .then(() => seriesHandler())
      .catch(() => {})
  }, 1200)
}
