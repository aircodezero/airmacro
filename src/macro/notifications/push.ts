/*
 * Abonnement Web Push du navigateur (service worker /sw.js).
 *
 * Mémoire locale (`airmacro.push.v1`) : cet appareil a activé les alertes ici, et
 * avec quel point d'accès. Elle permet de réabonner silencieusement un appareil
 * dont le navigateur a perdu l'abonnement (constaté sur Android, app installée :
 * abonnement désinscrit à chaque lancement, service worker et permission intacts)
 * et de faire remplacer l'ancien point d'accès côté serveur au lieu d'en empiler
 * un nouveau à chaque ouverture.
 */
import { browserTimeZone } from '../format'
import { inferEnrolled, planPushSync, type EnrollmentState, type PushPlan, type PushSnapshot } from './push-sync'

export type PushUnavailable = 'insecure' | 'iframe' | 'ios-install' | 'unsupported' | 'denied'

/** navigator.serviceWorker, ou null (absent, ou lecture refusée dans une iframe isolée). */
export function serviceWorkers(): ServiceWorkerContainer | null {
  try {
    return typeof navigator !== 'undefined' ? (navigator.serviceWorker ?? null) : null
  } catch {
    return null
  }
}

export function pushSupport(): { ok: true } | { ok: false; reason: PushUnavailable } {
  if (typeof window === 'undefined') return { ok: false, reason: 'unsupported' }
  if (!window.isSecureContext) return { ok: false, reason: 'insecure' }
  let framed = false
  try {
    framed = window.self !== window.top
  } catch {
    framed = true
  }
  if (framed) return { ok: false, reason: 'iframe' }
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  const apis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (ios && !standalone) return { ok: false, reason: 'ios-install' }
  if (!apis) return { ok: false, reason: 'unsupported' }
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' }
  return { ok: true }
}

/** Clé VAPID base64url → octets (applicationServerKey). */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

const sameKey = (subscription: PushSubscription, key: Uint8Array) => {
  const current = subscription.options?.applicationServerKey
  if (!current) return false
  const bytes = new Uint8Array(current)
  return bytes.length === key.length && bytes.every((b, i) => b === key[i])
}

/** L'abonnement a-t-il été créé avec la clé VAPID actuelle du serveur ? */
export const usesKey = (subscription: PushSubscription, vapidPublicKey: string) =>
  sameKey(subscription, urlBase64ToUint8Array(vapidPublicKey))

export async function currentSubscription(): Promise<PushSubscription | null> {
  const sw = serviceWorkers()
  if (!sw) return null
  const registration = await sw.getRegistration('/')
  return (await registration?.pushManager.getSubscription()) ?? null
}

export const permissionState = (): NotificationPermission => (typeof Notification === 'undefined' ? 'default' : Notification.permission)

/* ---------- mémoire locale de l'inscription ---------- */

const ENROLLMENT_KEY = 'airmacro.push.v1'
const RESTORE_KEY = 'airmacro.push.restored.v1'

export type PushEnrollment = { endpoint: string; at: string }
type PushOptOut = { off: true; at: string }
export type PushRestore = { at: string; reason: 'dropped' | 'key-changed' }

function readLocal<T>(key: string, check: (v: unknown) => v is T): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    return check(value) ? value : null
  } catch {
    return null
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* stockage indisponible : pas de mémoire, rien d'autre ne change */
  }
}

const isEnrollment = (v: unknown): v is PushEnrollment =>
  typeof v === 'object' && v !== null && typeof (v as PushEnrollment).endpoint === 'string' && typeof (v as PushEnrollment).at === 'string'
const isOptOut = (v: unknown): v is PushOptOut => typeof v === 'object' && v !== null && (v as PushOptOut).off === true
const isRestore = (v: unknown): v is PushRestore =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as PushRestore).at === 'string' &&
  ((v as PushRestore).reason === 'dropped' || (v as PushRestore).reason === 'key-changed')

export const readEnrollment = () => readLocal(ENROLLMENT_KEY, isEnrollment)
export const enrollmentState = (): EnrollmentState =>
  readEnrollment() ? 'enrolled' : readLocal(ENROLLMENT_KEY, isOptOut) ? 'opted-out' : 'unknown'
export const rememberEnrollment = (subscription: PushSubscription) =>
  writeLocal(ENROLLMENT_KEY, { endpoint: subscription.endpoint, at: new Date().toISOString() } satisfies PushEnrollment)
/** « Turn off » explicite : mémorisé pour ne jamais réabonner cet appareil dans le dos de l'utilisateur. */
export const rememberOptOut = () => {
  writeLocal(ENROLLMENT_KEY, { off: true, at: new Date().toISOString() } satisfies PushOptOut)
  writeLocal(RESTORE_KEY, null)
}

/** Dernière réparation silencieuse (affichée dans le panneau : l'utilisateur sait ce qui s'est passé). */
export const readRestore = () => readLocal(RESTORE_KEY, isRestore)
export const rememberRestore = (reason: PushRestore['reason']) =>
  writeLocal(RESTORE_KEY, { at: new Date().toISOString(), reason } satisfies PushRestore)

/* ---------- état et décision ---------- */

/** Le service worker racine enregistré est-il celui d'AirMacro (/sw.js) ? */
async function ownsRootWorker(): Promise<boolean> {
  const registration = await serviceWorkers()?.getRegistration('/')
  const worker = registration?.active ?? registration?.waiting ?? registration?.installing ?? null
  if (!worker) return false
  try {
    return new URL(worker.scriptURL).pathname === '/sw.js'
  } catch {
    return false
  }
}

/** Photographie de l'état du navigateur pour `planPushSync`. */
export async function snapshotPush(vapidPublicKey: string): Promise<{ snapshot: PushSnapshot; subscription: PushSubscription | null }> {
  const [subscription, ownWorker] = await Promise.all([currentSubscription(), ownsRootWorker()])
  const permission = permissionState()
  return {
    subscription,
    snapshot: {
      permission,
      subscriptionKeyMatches: subscription ? usesKey(subscription, vapidPublicKey) : null,
      enrolled: inferEnrolled({ state: enrollmentState(), ownWorker, permission }),
    },
  }
}

export const planPush = (snapshot: PushSnapshot): PushPlan => planPushSync(snapshot)

export class PushPermissionError extends Error {
  constructor(public outcome: NotificationPermission) {
    super(outcome === 'denied' ? 'Notifications are blocked for this site.' : 'Notification permission was not granted.')
  }
}

export type PushEnableResult = {
  subscription: PushSubscription
  /** Point d'accès précédent de cet appareil, à remplacer côté serveur (null : rien à remplacer). */
  replaces: string | null
}

/** Permission déjà accordée : enregistre le service worker et (ré)abonne avec la clé du serveur. */
async function subscribeWithKey(vapidPublicKey: string): Promise<PushEnableResult> {
  const sw = serviceWorkers()
  if (!sw) throw new Error('service workers are unavailable here')
  await sw.register('/sw.js', { scope: '/' })
  const registration = await sw.ready
  const key = urlBase64ToUint8Array(vapidPublicKey)
  const remembered = readEnrollment()?.endpoint ?? null
  const existing = await registration.pushManager.getSubscription()
  if (existing && sameKey(existing, key)) {
    rememberEnrollment(existing)
    return { subscription: existing, replaces: remembered && remembered !== existing.endpoint ? remembered : null }
  }
  if (existing) await existing.unsubscribe()
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  rememberEnrollment(subscription)
  const previous = remembered ?? existing?.endpoint ?? null
  return { subscription, replaces: previous && previous !== subscription.endpoint ? previous : null }
}

/** Geste utilisateur : demande la permission, enregistre le service worker et s'abonne. */
export async function enablePush(vapidPublicKey: string): Promise<PushEnableResult> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new PushPermissionError(permission)
  return subscribeWithKey(vapidPublicKey)
}

/** Sans geste : rétablit l'abonnement d'un appareil déjà inscrit dont la permission est toujours accordée. */
export async function restorePush(vapidPublicKey: string): Promise<PushEnableResult> {
  const permission = permissionState()
  if (permission !== 'granted') throw new PushPermissionError(permission)
  return subscribeWithKey(vapidPublicKey)
}

/** Désabonne ce navigateur ; renvoie l'ancien point d'accès (à retirer côté serveur). */
export async function disablePush(): Promise<string | null> {
  const subscription = await currentSubscription()
  rememberOptOut()
  if (!subscription) return null
  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  return endpoint
}

/** Enregistre (ou remplace) l'abonnement de cet appareil côté serveur. */
export async function registerDevice(subscription: PushSubscription, replaces: string | null): Promise<void> {
  const res = await fetch('/api/macro/notify/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      timeZone: browserTimeZone(),
      label: deviceLabel(),
      replaces,
    }),
  })
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string; detail?: string }
    throw new Error(json.detail ?? json.error ?? `HTTP ${res.status}`)
  }
}

/** Libellé lisible de l'appareil (affiché dans la liste des abonnements). */
export function deviceLabel(): string {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser'
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'device'
  return `${browser} on ${os}`
}
