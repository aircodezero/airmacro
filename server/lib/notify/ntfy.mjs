/*
 * ntfy (https://ntfy.sh ou serveur auto-hébergé via AIRMACRO_NTFY_URL) :
 * publication JSON sur un topic choisi dans l'interface, jeton optionnel.
 * Le topic et le jeton restent côté serveur (jamais renvoyés en clair).
 */
import { allowHost, request } from '../http.mjs'
import { validTimeZone } from './plan.mjs'
import { readJson, writeJson } from './store.mjs'

export const NTFY_SERVER = (() => {
  const raw = process.env.AIRMACRO_NTFY_URL?.trim()
  if (!raw) return 'https://ntfy.sh'
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') throw new Error('https required')
    allowHost(url.hostname)
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch (err) {
    console.warn(`[notify] AIRMACRO_NTFY_URL ignored (${err.message}) — using https://ntfy.sh`)
    return 'https://ntfy.sh'
  }
})()

const TOPIC = /^[A-Za-z0-9_-]{12,64}$/
const TOKEN = /^[\x21-\x7e]{8,200}$/

export function validateNtfy(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' }
  const { topic, token, timeZone, appUrl } = body
  if (typeof topic !== 'string' || !TOPIC.test(topic)) return { ok: false, error: 'topic must be 12–64 letters, digits, “-” or “_”' }
  if (token != null && (typeof token !== 'string' || !TOKEN.test(token))) return { ok: false, error: 'invalid access token' }
  let origin = null
  if (appUrl != null) {
    try {
      const url = new URL(appUrl)
      if (!['http:', 'https:'].includes(url.protocol) || appUrl.length > 200) throw new Error('bad')
      origin = url.origin
    } catch {
      return { ok: false, error: 'invalid app URL' }
    }
  }
  return { ok: true, value: { topic, token: token ?? null, timeZone: validTimeZone(timeZone), appUrl: origin } }
}

export const getNtfy = () => readJson('ntfy', null)
export const saveNtfy = (settings) => writeJson('ntfy', { ...settings, updatedAt: new Date().toISOString() })
export const clearNtfy = () => writeJson('ntfy', null)

/** Indice non sensible du topic (le début seulement). */
export const topicHint = (topic) => (topic ? `${topic.slice(0, Math.min(9, Math.floor(topic.length / 3)))}…` : null)

/**
 * Publie une notification sur le topic.
 * @returns {Promise<boolean>}
 */
export async function deliverNtfy(settings, message) {
  const body = {
    topic: settings.topic,
    title: message.title,
    message: message.body,
    tags: message.tags,
    priority: message.priority,
    ...(settings.appUrl ? { click: `${settings.appUrl}${message.path}` } : {}),
  }
  try {
    await request(`${NTFY_SERVER}/`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}),
      },
      timeoutMs: 8000,
      retries: 2,
    })
    return true
  } catch (err) {
    console.warn(`[notify] ntfy publish failed: ${String(err?.message ?? err).slice(0, 80)}`)
    return false
  }
}
