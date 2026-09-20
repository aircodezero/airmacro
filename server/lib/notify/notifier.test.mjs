import { describe, it, expect } from 'vitest'
import { createNotifier, recipientId, RETRY_WINDOW_MS } from './notifier.mjs'

const MIN = 60_000
const T = Date.UTC(2026, 8, 17, 11, 0)
const boe = {
  id: 'boe-1',
  kind: 'boe',
  category: 'decision',
  title: 'BoE rate decision',
  country: 'GBP',
  ts: T,
  impact: 'High',
  allDay: false,
  actual: null,
  measures: [],
}

function setup({ push = [{ endpoint: 'https://fcm.googleapis.com/a', timeZone: 'Europe/Paris' }], ntfy = null, pushOk = () => true, ntfyOk = () => true, state = null, paused = false } = {}) {
  let now = T - 20 * MIN
  let saved = state
  const sent = { push: [], ntfy: [] }
  const notifier = createNotifier({
    getEvents: async () => [boe],
    recipients: async () => ({ push, ntfy }),
    deliverPush: async (record, message) => {
      sent.push.push({ endpoint: record.endpoint, title: message.title, body: message.body })
      return pushOk(record)
    },
    deliverNtfy: async (_settings, message) => {
      sent.ntfy.push({ title: message.title })
      return ntfyOk()
    },
    loadState: async () => (saved ? structuredClone(saved) : null),
    saveState: async (s) => {
      saved = structuredClone(s)
    },
    isPaused: () => paused,
    clock: () => now,
  })
  return {
    notifier,
    sent,
    at: (ts) => {
      now = ts
    },
    state: () => saved,
  }
}

describe('createNotifier', () => {
  it('rappel puis publication, une seule fois chacun', async () => {
    const t = setup()
    await t.notifier.tick() // T-20 : rien, mais l'activation est datée
    expect(t.state().since).toBe(T - 20 * MIN)
    t.at(T - 15 * MIN + 10_000)
    await t.notifier.tick()
    await t.notifier.tick()
    expect(t.sent.push.map((m) => m.title)).toEqual(['In 15 min: BoE rate decision'])
    expect(t.sent.push[0].body).toMatch(/1:00 PM \(UTC\+2\)/)
    t.at(T + 20_000)
    await t.notifier.tick()
    await t.notifier.tick()
    expect(t.sent.push.map((m) => m.title)).toEqual(['In 15 min: BoE rate decision', 'BoE rate decision announced'])
    const status = t.notifier.status()
    expect(status.recent.map((r) => r.type)).toEqual(['released', 'reminder'])
    expect(status.recent[0].delivered).toEqual({ push: 1, ntfy: false })
    expect(status.lastError).toBeNull()
  })

  it('premier passage après l’événement : pas de rattrapage', async () => {
    const t = setup()
    t.at(T + 5 * MIN)
    await t.notifier.tick()
    expect(t.sent.push).toEqual([])
  })

  it('réactivation : les publications passées pendant l’arrêt ne sont pas envoyées', async () => {
    const t = setup({ state: { since: T - 60 * MIN, sent: {}, pending: {}, recent: [] } })
    t.at(T + 5 * MIN)
    await t.notifier.activated()
    expect(t.sent.push).toEqual([])
    expect(t.state().since).toBe(T + 5 * MIN)
  })

  it('échec partiel : seul le destinataire en échec est relancé', async () => {
    let ntfyUp = false
    const t = setup({ ntfy: { topic: 'airmacro-test-topic', timeZone: 'UTC' }, ntfyOk: () => ntfyUp })
    await t.notifier.tick()
    t.at(T + 10_000)
    await t.notifier.tick()
    expect(t.sent.push).toHaveLength(1)
    expect(t.sent.ntfy).toHaveLength(1)
    expect(t.state().pending['released:boe-1'].done).toEqual([recipientId('https://fcm.googleapis.com/a')])
    ntfyUp = true
    t.at(T + 40_000)
    await t.notifier.tick()
    expect(t.sent.push).toHaveLength(1)
    expect(t.sent.ntfy).toHaveLength(2)
    expect(t.state().sent['released:boe-1']).toBe(T + 40_000)
    expect(t.state().pending).toEqual({})
    expect(t.notifier.status().recent[0].delivered).toEqual({ push: 1, ntfy: true })
  })

  it('relances pendant 10 min, puis abandon consigné', async () => {
    const t = setup({ pushOk: () => false })
    await t.notifier.tick()
    const perTick = 30_000
    for (let i = 0; i <= RETRY_WINDOW_MS / perTick + 4; i++) {
      t.at(T + i * perTick)
      await t.notifier.tick()
    }
    expect(t.sent.push).toHaveLength(RETRY_WINDOW_MS / perTick + 1)
    expect(t.state().sent['released:boe-1']).toBe(T + RETRY_WINDOW_MS)
    expect(t.notifier.status().recent[0].delivered).toEqual({ push: 0, ntfy: false })
  })

  it('en pause (offline) ou sans destinataire : aucun envoi', async () => {
    const paused = setup({ paused: true })
    paused.at(T - 10 * MIN)
    await paused.notifier.tick()
    expect(paused.sent.push).toEqual([])
    expect(paused.notifier.status().paused).toBe(true)

    const nobody = setup({ push: [] })
    nobody.at(T - 10 * MIN)
    await nobody.notifier.tick()
    expect(nobody.state()).toBeNull()
    expect(nobody.notifier.status().nextEvent).toBeNull()
  })

  it('passages concurrents : un seul envoi', async () => {
    const t = setup()
    await t.notifier.tick()
    t.at(T - 10 * MIN)
    await Promise.all([t.notifier.tick(), t.notifier.tick(), t.notifier.tick()])
    expect(t.sent.push).toHaveLength(1)
  })

  it('erreur de lecture du calendrier : signalée dans l’état, sans exception', async () => {
    const notifier = createNotifier({
      getEvents: async () => {
        throw new Error('calendar down')
      },
      recipients: async () => ({ push: [{ endpoint: 'https://fcm.googleapis.com/a' }], ntfy: null }),
      deliverPush: async () => true,
      deliverNtfy: async () => true,
      loadState: async () => null,
      saveState: async () => {},
    })
    await notifier.tick()
    expect(notifier.status().lastError).toBe('calendar down')
  })
})
