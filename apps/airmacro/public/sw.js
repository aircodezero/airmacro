/*
 * AirMacro — service worker de l'app dédiée : notifications push uniquement (aucune mise en cache).
 * Charge utile JSON envoyée par le serveur : { title, body, tag, path, timestamp }.
 */

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

const text = (value, fallback = '') => (typeof value === 'string' ? value : fallback)

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = text(data.title, 'AirMacro')
  const tag = text(data.tag) || undefined
  const path = text(data.path, '/')
  const options = {
    body: text(data.body),
    tag,
    renotify: Boolean(tag),
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
    // chemin interne uniquement (pas d'URL « //hôte »)
    data: { path: path.startsWith('/') && !path.startsWith('//') ? path : '/' },
  }
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options)
      // onglets ouverts : accusé de réception (tests, rafraîchissement de l'affichage)
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) client.postMessage({ type: 'airmacro-push', title, tag })
    })(),
  )
})

// Clic : un onglet AirMacro ouvert est ramené au premier plan et ouvre la fiche
// sans rechargement (message à l'application) ; sinon nouvelle fenêtre.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.path ?? '/', self.location.origin)
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const client = windows.find((c) => new URL(c.url).origin === target.origin)
      if (client) {
        await client.focus().catch(() => {})
        client.postMessage({ type: 'airmacro-open', path: target.pathname + target.search })
        return
      }
      await self.clients.openWindow(target.href)
    })(),
  )
})

// Abonnement renouvelé par le navigateur : le serveur remplace l'ancien point d'accès.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const options = event.oldSubscription?.options
      const subscription = event.newSubscription ?? (options ? await self.registration.pushManager.subscribe(options) : null)
      if (!subscription) return
      await fetch('/api/macro/notify/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          replaces: event.oldSubscription?.endpoint ?? null,
        }),
      })
    })(),
  )
})
