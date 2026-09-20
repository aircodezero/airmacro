import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useRouter } from '@tanstack/react-router'
import { NotifyButton } from '../../../src/macro/notifications/NotifyPanel'
import {
  planPush,
  pushSupport,
  registerDevice,
  rememberRestore,
  restorePush,
  serviceWorkers,
  snapshotPush,
} from '../../../src/macro/notifications/push'
import { qNotifyConfig } from '../../../src/macro/queries'
import { browserTimeZone, localOffsetLabel } from '../../../src/macro/format'
import { useNow } from '../../../src/macro/useNow'
import { eventParam } from './search'

/* Clic sur une notification alors qu'un onglet AirMacro est ouvert (message du service worker). */
function useNotificationLinks() {
  const router = useRouter()
  useEffect(() => {
    const sw = serviceWorkers()
    if (!sw) return
    const onMessage = (message: MessageEvent) => {
      if (message.data?.type !== 'airmacro-open' || typeof message.data.path !== 'string') return
      const url = new URL(message.data.path, window.location.origin)
      if (url.pathname !== '/') return
      void router.navigate({ to: '/', search: { event: eventParam(url.searchParams.get('event')) } })
    }
    sw.addEventListener('message', onMessage)
    return () => sw.removeEventListener('message', onMessage)
  }, [router])
}

/*
 * Appareil inscrit aux alertes : abonnement rétabli dès l'ouverture de l'app, et à
 * chaque retour au premier plan, si le navigateur l'a perdu (Android, app installée :
 * désinscription constatée à chaque lancement), sans attendre que le panneau Alerts
 * soit ouvert. Idempotent : un abonnement intact ne provoque rien. L'inscription est
 * lue en mémoire locale, ou déduite de notre service worker + permission accordée.
 */
function usePushRestore() {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!pushSupport().ok) return
    let alive = true
    let running: Promise<void> | null = null
    let lastRun = 0
    const restore = async () => {
      const config = await queryClient.fetchQuery(qNotifyConfig())
      if (!alive || !config.vapidPublicKey) return
      const { snapshot } = await snapshotPush(config.vapidPublicKey)
      const plan = planPush(snapshot)
      if (plan.action !== 'restore') return
      const restored = await restorePush(config.vapidPublicKey)
      await registerDevice(restored.subscription, restored.replaces)
      rememberRestore(plan.reason)
      await queryClient.invalidateQueries({ queryKey: ['macro', 'notify-config'] })
    }
    const run = () => {
      if (running || Date.now() - lastRun < 15_000) return
      lastRun = Date.now()
      running = restore()
        .catch(() => {
          /* réparation impossible ici : le panneau Alerts affichera l'état réel */
        })
        .finally(() => {
          running = null
        })
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') run()
    }
    run()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [queryClient])
}

export function AppShell() {
  const now = useNow(60_000)
  useNotificationLinks()
  usePushRestore()
  return (
    <>
      <a className="skip-link" href="#contenu">
        Skip to content
      </a>
      <header className="macro-topbar">
        <div className="macro-brand">
          <span className="brand-mark macro-mark" aria-hidden="true">
            M
          </span>
          <div>
            <h1 className="macro-app-title">AirMacro</h1>
            <p className="macro-sub">
              The macro numbers that move markets · times in your time zone ({browserTimeZone()},{' '}
              {localOffsetLabel(now)})
            </p>
          </div>
        </div>
        <NotifyButton />
      </header>
      <main id="contenu" className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer">
        <span>
          AirMacro — information tool built on public data (BLS, BEA, US Treasury, NY Fed, Federal Reserve, Cboe, ECB,
          EIA; calendar consensus from FairEconomy). Charts by TradingView Lightweight Charts™.
        </span>
        <span>Not investment advice.</span>
      </footer>
    </>
  )
}

export function NotFound() {
  return (
    <div className="macro-notfound">
      <h2>Page not found</h2>
      <p>
        AirMacro has a single page.{' '}
        <Link to="/" search={{}} className="linklike">
          Back to the calendar
        </Link>
      </p>
    </div>
  )
}
