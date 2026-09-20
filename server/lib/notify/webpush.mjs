/*
 * Web Push natif (VAPID) : clés générées une fois et conservées localement
 * (ou fournies par AIRMACRO_VAPID_PUBLIC_KEY / AIRMACRO_VAPID_PRIVATE_KEY),
 * abonnements des navigateurs, envoi chiffré via le service push du navigateur.
 * Seuls les services push connus sont acceptés comme destinations (pas de SSRF).
 */
import { createHash } from 'node:crypto'
import webpush from 'web-push'
import { readJson, updateJson, writeJson } from './store.mjs'

const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
]
export const MAX_SUBSCRIPTIONS = 20
const SUBJECT = process.env.AIRMACRO_VAPID_SUBJECT?.trim() || 'mailto:alerts@example.com'
const B64URL = /^[A-Za-z0-9_-]+$/

export function validateSubscription(sub) {
  if (!sub || typeof sub !== 'object') return { ok: false, error: 'subscription must be an object' }
  const { endpoint, keys } = sub
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return { ok: false, error: 'invalid endpoint' }
  let url
  try {
    url = new URL(endpoint)
  } catch {
    return { ok: false, error: 'invalid endpoint' }
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !PUSH_HOSTS.some((re) => re.test(url.hostname))) {
    return { ok: false, error: 'unsupported push service' }
  }
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return { ok: false, error: 'invalid keys' }
  if (!B64URL.test(keys.p256dh) || !B64URL.test(keys.auth)) return { ok: false, error: 'invalid keys' }
  if (Buffer.from(keys.p256dh, 'base64url').length !== 65 || Buffer.from(keys.auth, 'base64url').length !== 16) {
    return { ok: false, error: 'invalid keys' }
  }
  return { ok: true, value: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } } }
}

let keysPromise = null

/** Paire VAPID : environnement, sinon stockage local, sinon générée puis conservée. */
export function vapidKeys() {
  keysPromise ??= (async () => {
    const publicKey = process.env.AIRMACRO_VAPID_PUBLIC_KEY?.trim()
    const privateKey = process.env.AIRMACRO_VAPID_PRIVATE_KEY?.trim()
    if (publicKey && privateKey) return { publicKey, privateKey }
    const stored = await readJson('vapid', null)
    if (stored?.publicKey && stored?.privateKey) return { publicKey: stored.publicKey, privateKey: stored.privateKey }
    const generated = webpush.generateVAPIDKeys()
    await writeJson('vapid', { ...generated, createdAt: new Date().toISOString() })
    return generated
  })().catch((err) => {
    keysPromise = null
    throw err
  })
  return keysPromise
}

export const listSubscriptions = () => readJson('push-subscriptions', [])

const cleanLabel = (label) => (typeof label === 'string' ? label.replace(/[^\w .()-]/g, '').slice(0, 40) : null)

export function addSubscription({ subscription, timeZone, label, replaces }) {
  return updateJson('push-subscriptions', [], (list) => {
    const previous = list.find((r) => r.endpoint === replaces || r.endpoint === subscription.endpoint)
    const kept = list.filter((r) => r.endpoint !== subscription.endpoint && r.endpoint !== replaces)
    kept.push({
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      timeZone: timeZone ?? previous?.timeZone ?? 'UTC',
      label: cleanLabel(label) ?? previous?.label ?? null,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      lastSuccessAt: previous?.lastSuccessAt ?? null,
      lastError: null,
    })
    kept.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    list.splice(0, list.length, ...kept.slice(-MAX_SUBSCRIPTIONS))
    return list.length
  })
}

export function removeSubscription(endpoint) {
  return updateJson('push-subscriptions', [], (list) => {
    const kept = list.filter((r) => r.endpoint !== endpoint)
    list.splice(0, list.length, ...kept)
    return list.length
  })
}

function markResult(endpoint, ok, error) {
  return updateJson('push-subscriptions', [], (list) => {
    const record = list.find((r) => r.endpoint === endpoint)
    if (!record) return
    if (ok) {
      record.lastSuccessAt = new Date().toISOString()
      record.lastError = null
    } else {
      record.lastError = error
    }
  })
}

/** En-tête Topic : 32 caractères base64url max — remplace un message non encore délivré. */
export const pushTopic = (tag) => createHash('sha256').update(String(tag)).digest('base64url').slice(0, 32)

export const pushPayload = (message) =>
  JSON.stringify({
    title: message.title,
    body: message.body,
    tag: message.tag,
    path: message.path,
    timestamp: Date.now(),
  })

/**
 * Envoie une notification à un abonnement. Abonnement expiré (404/410) : supprimé.
 * @returns {Promise<boolean>} vrai si le service push a accepté le message
 */
export async function deliverPush(record, message) {
  let error
  // egress instable : un second essai si la connexion tombe (pas après une réponse du service)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const keys = await vapidKeys()
      await webpush.sendNotification({ endpoint: record.endpoint, keys: record.keys }, pushPayload(message), {
        TTL: message.ttlSec,
        urgency: message.urgency,
        topic: pushTopic(message.tag),
        vapidDetails: { subject: SUBJECT, publicKey: keys.publicKey, privateKey: keys.privateKey },
        timeout: 15_000,
      })
      await markResult(record.endpoint, true)
      return true
    } catch (err) {
      error = err
      if (err?.statusCode) break
    }
  }
  const status = error?.statusCode
  const host = new URL(record.endpoint).hostname
  if (status === 404 || status === 410) {
    console.warn(`[notify] push subscription expired (${host}) — removed`)
    await removeSubscription(record.endpoint)
  } else {
    const reason = status ? `HTTP ${status}` : String(error?.message ?? error).slice(0, 80)
    console.warn(`[notify] push to ${host} failed: ${reason}`)
    await markResult(record.endpoint, false, reason)
  }
  return false
}
