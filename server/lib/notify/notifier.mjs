/*
 * Surveillance des annonces : toutes les 30 s, planifie les alertes (rappels,
 * chiffres publiés) et les distribue aux abonnés push et ntfy, chacun dans son fuseau.
 * Suivi par destinataire : un échec est retenté aux passages suivants pendant 10 min
 * (coupures réseau par rafales, disjoncteur de 90 s) sans renvoyer aux destinataires
 * déjà servis. État persisté : un redémarrage ne renvoie rien ; pas de rattrapage
 * des publications antérieures à l'activation.
 */
import { createHash } from 'node:crypto'
import { buildMessage, notifiable, planNotifications } from './plan.mjs'

const TICK_MS = 30_000
const KEEP_MS = 8 * 86_400_000
export const RETRY_WINDOW_MS = 10 * 60_000
const RECENT = 12

export const emptyState = () => ({ since: null, sent: {}, pending: {}, recent: [] })

export const recipientId = (endpoint) => `push:${createHash('sha256').update(endpoint).digest('base64url').slice(0, 16)}`

/**
 * @param {{
 *   getEvents: () => Promise<any[]>,
 *   recipients: () => Promise<{ push: any[], ntfy: any|null }>,
 *   deliverPush: (record: any, message: any) => Promise<boolean>,
 *   deliverNtfy: (settings: any, message: any) => Promise<boolean>,
 *   loadState: () => Promise<any>,
 *   saveState: (state: any) => Promise<void>,
 *   isPaused?: () => boolean,
 *   clock?: () => number,
 * }} deps
 */
export function createNotifier(deps) {
  const { getEvents, recipients, deliverPush, deliverNtfy, loadState, saveState, isPaused = () => false, clock = Date.now } = deps
  const status = { lastCheckAt: null, lastError: null, nextEvent: null, paused: false }
  let recent = []
  let timer = null
  let busy = null
  let activatedAt = null

  const targetsOf = (who) => [
    ...who.push.map((record) => ({ id: recipientId(record.endpoint), channel: 'push', timeZone: record.timeZone, send: (m) => deliverPush(record, m) })),
    ...(who.ntfy ? [{ id: 'ntfy', channel: 'ntfy', timeZone: who.ntfy.timeZone, send: (m) => deliverNtfy(who.ntfy, m) }] : []),
  ]

  async function run() {
    const now = clock()
    status.lastCheckAt = new Date(now).toISOString()
    status.paused = isPaused()
    if (status.paused) return
    const who = await recipients()
    const targets = targetsOf(who)
    if (!targets.length) {
      status.nextEvent = null
      return
    }
    const events = await getEvents()
    const next = events.filter((e) => notifiable(e) && e.ts > now).sort((a, b) => a.ts - b.ts)[0]
    status.nextEvent = next ? { title: next.title, ts: next.ts } : null

    const state = { ...emptyState(), ...(await loadState()) }
    if (activatedAt != null) {
      state.since = Math.max(state.since ?? 0, activatedAt)
      activatedAt = null
    }
    state.since ??= now // première activation : pas de rattrapage
    const items = planNotifications(events, now, state.sent, state.since)

    for (const item of items) {
      const progress = state.pending[item.key] ?? { done: [], attempts: 0, firstAt: now, push: 0, ntfy: false, title: null }
      const todo = targets.filter((t) => !progress.done.includes(t.id))
      const results = await Promise.all(
        todo.map(async (t) => {
          const message = buildMessage(item, { timeZone: t.timeZone, now })
          progress.title ??= message.title
          return { t, ok: await t.send(message).catch(() => false) }
        }),
      )
      for (const { t, ok } of results) {
        if (!ok) continue
        progress.done.push(t.id)
        if (t.channel === 'push') progress.push += 1
        else progress.ntfy = true
      }
      progress.attempts += 1
      const complete = targets.every((t) => progress.done.includes(t.id))
      if (complete || now - progress.firstAt >= RETRY_WINDOW_MS) {
        state.sent[item.key] = now
        delete state.pending[item.key]
        state.recent = [
          { key: item.key, type: item.type, title: progress.title, at: new Date(now).toISOString(), delivered: { push: progress.push, ntfy: progress.ntfy } },
          ...(state.recent ?? []),
        ].slice(0, RECENT)
      } else {
        state.pending[item.key] = progress
      }
    }

    const planned = new Set(items.map((i) => i.key))
    for (const key of Object.keys(state.pending)) if (!planned.has(key)) delete state.pending[key]
    for (const [key, at] of Object.entries(state.sent)) if (now - at > KEEP_MS) delete state.sent[key]
    recent = state.recent ?? []
    await saveState(state)
  }

  /** Un seul passage à la fois ; un appel concurrent reçoit le passage en cours. */
  function tick() {
    busy ??= run()
      .then(() => {
        status.lastError = null
      })
      .catch((err) => {
        status.lastError = String(err?.message ?? err).slice(0, 160)
        console.warn(`[notify] check failed: ${status.lastError}`)
      })
      .finally(() => {
        busy = null
      })
    return busy
  }

  return {
    tick,
    async start() {
      if (timer) return
      timer = setInterval(tick, TICK_MS)
      timer.unref?.()
      recent = (await loadState().catch(() => null))?.recent ?? []
      await tick()
    },
    stop() {
      clearInterval(timer)
      timer = null
    },
    /** Premier destinataire ajouté : les publications déjà passées ne sont pas envoyées. */
    activated() {
      activatedAt = clock()
      const inflight = busy
      return inflight ? inflight.then(tick) : tick()
    },
    status: () => ({ running: timer != null, ...status, recent }),
  }
}
