/*
 * Alertes AirMacro (push natif + ntfy) :
 *   GET    /api/macro/notify/config         — clé VAPID publique, état des canaux et de la surveillance
 *   POST   /api/macro/notify/subscriptions  — enregistre l'abonnement push d'un appareil
 *   DELETE /api/macro/notify/subscriptions  — le retire
 *   PUT    /api/macro/notify/ntfy           — topic ntfy (+ jeton optionnel)
 *   DELETE /api/macro/notify/ntfy
 *   POST   /api/macro/notify/test           — notification de test sur un canal enregistré
 * Écritures refusées aux requêtes inter-sites (Sec-Fetch-Site / Origin) et limitées en débit.
 */
import express from 'express'
import { isOffline } from '../lib/cache.mjs'
import { createRateLimiter } from '../lib/macro/explain.mjs'
import { createNotifier } from '../lib/notify/notifier.mjs'
import { clearNtfy, deliverNtfy, getNtfy, NTFY_SERVER, saveNtfy, topicHint, validateNtfy } from '../lib/notify/ntfy.mjs'
import { notifiable, REMINDER_LEAD_MS, testMessage, validTimeZone } from '../lib/notify/plan.mjs'
import { readJson, writeJson } from '../lib/notify/store.mjs'
import {
  addSubscription,
  deliverPush,
  listSubscriptions,
  removeSubscription,
  validateSubscription,
  vapidKeys,
} from '../lib/notify/webpush.mjs'

const writeLimiter = createRateLimiter({ limit: 30, windowMs: 3_600_000 })
const testLimiter = createRateLimiter({ limit: 10, windowMs: 600_000 })

let notifier = null

/** Démarre la surveillance des annonces (serveur AirMacro uniquement, pas dans les tests). */
export function startNotifier() {
  notifier?.start().catch((err) => console.warn(`[notify] start failed: ${String(err?.message ?? err).slice(0, 120)}`))
}

export const notifierStatus = () => notifier?.status() ?? null

/* Formulaires et scripts d'autres sites : refusés (CSRF, rebinding DNS). */
function sameSiteOnly(req, res, next) {
  const site = req.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') {
    res.status(403).json({ error: 'forbidden', detail: 'cross-site request' })
    return
  }
  const origin = req.get('origin')
  if (!site && origin) {
    const host = req.get('x-forwarded-host') ?? req.get('host')
    let originHost = null
    try {
      originHost = new URL(origin).host
    } catch {}
    if (originHost !== host) {
      res.status(403).json({ error: 'forbidden', detail: 'cross-site request' })
      return
    }
  }
  next()
}

const limited = (limiter) => (req, res, next) => {
  const verdict = limiter.take(req.ip ?? req.socket.remoteAddress ?? 'unknown', Date.now())
  if (verdict.ok) return next()
  const retryAfterSec = Math.ceil(verdict.retryAfterMs / 1000)
  res.setHeader('Retry-After', String(retryAfterSec))
  res.status(429).json({ error: 'rate_limited', retryAfterSec })
}

const safe = (handler) => async (req, res) => {
  try {
    await handler(req, res)
  } catch (err) {
    console.error(`[notify] ${req.method} ${req.path} failed:`, String(err?.message ?? err).slice(0, 160))
    if (!res.headersSent) res.status(500).json({ error: 'internal_error' })
  }
}

async function recipientCount() {
  const [subs, ntfy] = await Promise.all([listSubscriptions(), getNtfy()])
  return subs.length + (ntfy ? 1 : 0)
}

export function registerNotifyApi(api, { calendarHandler }) {
  notifier ??= createNotifier({
    getEvents: async () => (await calendarHandler())?.data?.events ?? [],
    recipients: async () => {
      const [push, ntfy] = await Promise.all([listSubscriptions(), getNtfy()])
      return { push, ntfy }
    },
    deliverPush,
    deliverNtfy,
    loadState: () => readJson('notify-state', null),
    saveState: (state) => writeJson('notify-state', state),
    isPaused: isOffline,
  })

  const json = express.json({ limit: '8kb' })
  const write = [sameSiteOnly, limited(writeLimiter), json]

  async function nextHighEvent() {
    const events = (await calendarHandler().catch(() => null))?.data?.events ?? []
    const now = Date.now()
    return events.filter((e) => notifiable(e) && e.ts > now).sort((a, b) => a.ts - b.ts)[0] ?? null
  }

  api.get(
    '/macro/notify/config',
    safe(async (_req, res) => {
      const [keys, subs, ntfy] = await Promise.all([vapidKeys().catch(() => null), listSubscriptions(), getNtfy()])
      res.setHeader('Cache-Control', 'no-store')
      res.json({
        offline: isOffline(),
        vapidPublicKey: keys?.publicKey ?? null,
        push: { devices: subs.length },
        ntfy: { enabled: Boolean(ntfy), server: NTFY_SERVER, topicHint: topicHint(ntfy?.topic), hasToken: Boolean(ntfy?.token) },
        watcher: notifier.status(),
        rules: { reminderMinutes: REMINDER_LEAD_MS / 60_000, impact: 'High' },
      })
    }),
  )

  api.post(
    '/macro/notify/subscriptions',
    ...write,
    safe(async (req, res) => {
      const parsed = validateSubscription(req.body?.subscription)
      if (!parsed.ok) {
        res.status(400).json({ error: 'invalid_request', detail: parsed.error })
        return
      }
      const replaces = typeof req.body.replaces === 'string' && req.body.replaces.length <= 1024 ? req.body.replaces : null
      const before = await recipientCount()
      const devices = await addSubscription({
        subscription: parsed.value,
        // renouvellement par le service worker : fuseau et nom repris de l'ancien abonnement
        timeZone: req.body.timeZone == null ? null : validTimeZone(req.body.timeZone),
        label: req.body.label,
        replaces,
      })
      if (before === 0) void notifier.activated()
      res.json({ ok: true, devices })
    }),
  )

  api.delete(
    '/macro/notify/subscriptions',
    ...write,
    safe(async (req, res) => {
      const endpoint = req.body?.endpoint
      if (typeof endpoint !== 'string' || endpoint.length > 1024) {
        res.status(400).json({ error: 'invalid_request', detail: 'endpoint required' })
        return
      }
      const devices = await removeSubscription(endpoint)
      res.json({ ok: true, devices })
    }),
  )

  api.put(
    '/macro/notify/ntfy',
    ...write,
    safe(async (req, res) => {
      const parsed = validateNtfy(req.body)
      if (!parsed.ok) {
        res.status(400).json({ error: 'invalid_request', detail: parsed.error })
        return
      }
      const [existing, before] = await Promise.all([getNtfy(), recipientCount()])
      const settings = parsed.value
      // même topic sans nouveau jeton : le jeton enregistré est conservé
      if (!settings.token && existing?.topic === settings.topic) settings.token = existing.token ?? null
      await saveNtfy(settings)
      if (before === 0) void notifier.activated()
      res.json({ ok: true })
    }),
  )

  api.delete(
    '/macro/notify/ntfy',
    ...write,
    safe(async (_req, res) => {
      await clearNtfy()
      res.json({ ok: true })
    }),
  )

  api.post(
    '/macro/notify/test',
    sameSiteOnly,
    limited(testLimiter),
    json,
    safe(async (req, res) => {
      const channel = req.body?.channel
      if (channel === 'push') {
        const endpoint = req.body.endpoint
        const record = typeof endpoint === 'string' ? (await listSubscriptions()).find((r) => r.endpoint === endpoint) : null
        if (!record) {
          res.status(404).json({ error: 'not_found', detail: 'this device is not registered — turn alerts off and on again' })
          return
        }
        const message = testMessage(await nextHighEvent(), { timeZone: record.timeZone })
        if (!(await deliverPush(record, message))) {
          res.status(502).json({ error: 'delivery_failed', detail: 'the push service rejected the notification' })
          return
        }
        res.json({ ok: true })
        return
      }
      if (channel === 'ntfy') {
        const settings = await getNtfy()
        if (!settings) {
          res.status(404).json({ error: 'not_found', detail: 'no ntfy topic saved' })
          return
        }
        const message = testMessage(await nextHighEvent(), { timeZone: settings.timeZone })
        if (!(await deliverNtfy(settings, message))) {
          res.status(502).json({
            error: 'delivery_failed',
            detail: `${NTFY_SERVER.replace(/^https:\/\//, '')} could not be reached or refused the message — try again in a minute`,
          })
          return
        }
        res.json({ ok: true })
        return
      }
      res.status(400).json({ error: 'invalid_request', detail: 'channel must be "push" or "ntfy"' })
    }),
  )

  // corps JSON invalide ou trop gros : réponse JSON
  api.use('/macro/notify', (err, _req, res, next) => {
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      res.status(err.status ?? 400).json({ error: 'invalid_request', detail: err.type === 'entity.too.large' ? 'body too large' : 'invalid JSON' })
      return
    }
    next(err)
  })
}
