import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest'
import { createECDH, createPublicKey, randomBytes, verify } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import webpush from 'web-push'
import { readJson, setStoreDir, updateJson, writeJson } from './store.mjs'
import {
  addSubscription,
  deliverPush,
  listSubscriptions,
  MAX_SUBSCRIPTIONS,
  pushPayload,
  pushTopic,
  removeSubscription,
  validateSubscription,
  vapidKeys,
} from './webpush.mjs'
import { topicHint, validateNtfy } from './ntfy.mjs'

// déchiffrement côté abonné (dépendance de web-push)
const ece = createRequire(import.meta.url)('http_ece')

// clés au format réel : p256dh = point P-256 non compressé (65 octets), auth = 16 octets
const P256DH = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url')
const AUTH = Buffer.alloc(16, 9).toString('base64url')
const sub = (endpoint) => ({ endpoint, keys: { p256dh: P256DH, auth: AUTH } })

let dir
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'airmacro-notify-'))
  setStoreDir(pathToFileURL(`${dir}/`))
})
afterAll(async () => {
  setStoreDir(null)
  await rm(dir, { recursive: true, force: true })
})

describe('validateSubscription', () => {
  it('accepte les services push connus', () => {
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QGx',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) {
      expect(validateSubscription(sub(endpoint))).toMatchObject({ ok: true, value: { endpoint } })
    }
  })

  it('refuse toute autre destination (SSRF) et les clés malformées', () => {
    for (const endpoint of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com.evil.com/x',
      'https://evilfcm.googleapis.com/x',
      'https://127.0.0.1/x',
      'https://user:pw@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:444/x',
      'not a url',
      `https://fcm.googleapis.com/${'a'.repeat(1100)}`,
    ]) {
      expect(validateSubscription(sub(endpoint)).ok).toBe(false)
    }
    expect(validateSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'abc', auth: AUTH } }).ok).toBe(false)
    expect(validateSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: P256DH, auth: 'a+b/' } }).ok).toBe(false)
    expect(validateSubscription(null).ok).toBe(false)
    // champs supplémentaires ignorés
    const extra = validateSubscription({ ...sub('https://fcm.googleapis.com/x'), expirationTime: null, evil: 1 })
    expect(Object.keys(extra.value)).toEqual(['endpoint', 'keys'])
  })
})

describe('abonnements', () => {
  it('ajout idempotent, remplacement et retrait', async () => {
    expect(await addSubscription({ subscription: sub('https://fcm.googleapis.com/1'), timeZone: 'Europe/Paris', label: 'Chrome on <b>Linux</b>' })).toBe(1)
    expect(await addSubscription({ subscription: sub('https://fcm.googleapis.com/1'), timeZone: null, label: undefined })).toBe(1)
    let list = await listSubscriptions()
    expect(list[0]).toMatchObject({ timeZone: 'Europe/Paris', label: 'Chrome on bLinuxb' })

    // renouvellement par le service worker : l'ancien point d'accès disparaît, le fuseau est repris
    await addSubscription({ subscription: sub('https://fcm.googleapis.com/2'), timeZone: null, replaces: 'https://fcm.googleapis.com/1' })
    list = await listSubscriptions()
    expect(list.map((r) => r.endpoint)).toEqual(['https://fcm.googleapis.com/2'])
    expect(list[0].timeZone).toBe('Europe/Paris')

    expect(await removeSubscription('https://fcm.googleapis.com/2')).toBe(0)
  })

  it(`au plus ${MAX_SUBSCRIPTIONS} appareils, écritures concurrentes sans perte`, async () => {
    await Promise.all(
      Array.from({ length: MAX_SUBSCRIPTIONS + 3 }, (_, i) =>
        addSubscription({ subscription: sub(`https://fcm.googleapis.com/n${i}`), timeZone: 'UTC' }),
      ),
    )
    const list = await listSubscriptions()
    expect(list).toHaveLength(MAX_SUBSCRIPTIONS)
    await Promise.all(list.map((r) => removeSubscription(r.endpoint)))
    expect(await listSubscriptions()).toEqual([])
  })

  it('fichiers privés (0600) et écriture atomique', async () => {
    await writeJson('probe', { a: 1 })
    const info = await stat(path.join(dir, 'probe.json'))
    expect(info.mode & 0o777).toBe(0o600)
    expect(await readJson('probe', null)).toEqual({ a: 1 })
    expect(await readJson('missing', 'fallback')).toBe('fallback')
    await Promise.all([1, 2, 3].map((n) => updateJson('counter', { n: 0 }, (c) => void (c.n += n))))
    expect(await readJson('counter', null)).toEqual({ n: 6 })
    expect(await readJson('../../etc/passwd', 'safe')).toBe('safe')
  })
})

describe('Web Push', () => {
  it('clés VAPID générées une fois puis relues', async () => {
    const first = await vapidKeys()
    expect(Buffer.from(first.publicKey, 'base64url')).toHaveLength(65)
    const stored = JSON.parse(await readFile(path.join(dir, 'vapid.json'), 'utf8'))
    expect(stored.publicKey).toBe(first.publicKey)
    expect(await vapidKeys()).toEqual(first)
  })

  it('en-tête Topic valide et charge utile minimale', () => {
    const topic = pushTopic('airmacro-fomc-2026-09-16-decision')
    expect(topic).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(pushTopic('airmacro-fomc-2026-09-16-decision')).toBe(topic)
    const payload = JSON.parse(pushPayload({ title: 't', body: 'b', tag: 'x', path: '/', urgency: 'high', priority: 5 }))
    expect(Object.keys(payload).sort()).toEqual(['body', 'path', 'tag', 'timestamp', 'title'])
  })

  it('envoi : options transmises ; abonnement expiré (410) retiré', async () => {
    await addSubscription({ subscription: sub('https://fcm.googleapis.com/ok'), timeZone: 'UTC' })
    await addSubscription({ subscription: sub('https://fcm.googleapis.com/gone'), timeZone: 'UTC' })
    const spy = vi.spyOn(webpush, 'sendNotification').mockImplementation(async (subscription) => {
      if (subscription.endpoint.endsWith('/gone')) throw Object.assign(new Error('Gone'), { statusCode: 410 })
      return { statusCode: 201 }
    })
    const message = { title: 'T', body: 'B', tag: 'airmacro-x', path: '/', urgency: 'high', ttlSec: 600 }
    const [record, gone] = await listSubscriptions()
    expect(await deliverPush(record, message)).toBe(true)
    const options = spy.mock.calls[0][2]
    expect(options).toMatchObject({ TTL: 600, urgency: 'high', topic: pushTopic('airmacro-x') })
    expect(options.vapidDetails.subject).toMatch(/^mailto:|^https:/)
    expect(await deliverPush(gone, message)).toBe(false)
    expect((await listSubscriptions()).map((r) => r.endpoint)).toEqual(['https://fcm.googleapis.com/ok'])
    expect((await listSubscriptions())[0].lastSuccessAt).not.toBeNull()
    spy.mockRestore()
  })

  it('bout en bout : charge utile déchiffrable par l’abonné, JWT VAPID signé pour le service push', async () => {
    const receiver = createECDH('prime256v1')
    receiver.generateKeys()
    const authSecret = randomBytes(16)
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/e2e',
      keys: { p256dh: receiver.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') },
    }
    expect(validateSubscription(subscription).ok).toBe(true)
    await addSubscription({ subscription, timeZone: 'UTC' })
    const record = (await listSubscriptions()).find((r) => r.endpoint === subscription.endpoint)

    let request
    const spy = vi.spyOn(webpush, 'sendNotification').mockImplementation(async (sub, payload, options) => {
      request = webpush.generateRequestDetails(sub, payload, options)
      return { statusCode: 201 }
    })
    const message = {
      title: 'FOMC: rates held at 3.50%–3.75%',
      body: 'Fed funds 3.75% · forecast 3.75%\nSource: Federal Reserve statement',
      tag: 'airmacro-fomc-2026-09-16-decision',
      path: '/?event=fomc-2026-09-16-decision',
      urgency: 'high',
      ttlSec: 21_600,
    }
    expect(await deliverPush(record, message)).toBe(true)
    spy.mockRestore()
    await removeSubscription(subscription.endpoint)

    expect(request.headers).toMatchObject({ TTL: 21_600, Urgency: 'high', Topic: pushTopic(message.tag), 'Content-Encoding': 'aes128gcm' })
    const clear = ece.decrypt(request.body, { version: 'aes128gcm', privateKey: receiver, authSecret: authSecret.toString('base64url') })
    expect(JSON.parse(clear.toString('utf8'))).toMatchObject({ title: message.title, body: message.body, tag: message.tag, path: message.path })

    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(request.headers.Authorization)
    const keys = await vapidKeys()
    expect(k).toBe(keys.publicKey)
    const [head, claims, signature] = jwt.split('.')
    const decoded = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8'))
    expect(decoded.aud).toBe('https://fcm.googleapis.com')
    expect(decoded.exp * 1000).toBeGreaterThan(Date.now())
    expect(decoded.exp * 1000 - Date.now()).toBeLessThanOrEqual(24 * 3_600_000)
    expect(decoded.sub).not.toMatch(/gmail/)
    const pub = Buffer.from(keys.publicKey, 'base64url')
    const jwk = { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }
    const valid = verify(
      'sha256',
      Buffer.from(`${head}.${claims}`),
      { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    )
    expect(valid).toBe(true)
  })

  it('coupure réseau : un second essai, puis échec consigné', async () => {
    const spy = vi.spyOn(webpush, 'sendNotification').mockRejectedValue(new Error('socket hang up'))
    const [record] = await listSubscriptions()
    expect(await deliverPush(record, { title: 'T', body: 'B', tag: 't', path: '/', urgency: 'normal', ttlSec: 60 })).toBe(false)
    expect(spy).toHaveBeenCalledTimes(2)
    expect((await listSubscriptions())[0].lastError).toBe('socket hang up')
    spy.mockRestore()
  })
})

describe('ntfy', () => {
  it('validation du topic, du jeton et de l’adresse de l’app', () => {
    expect(validateNtfy({ topic: 'airmacro-abc123def456', timeZone: 'Europe/Paris', appUrl: 'https://x.example/macro?a=1' })).toEqual({
      ok: true,
      value: { topic: 'airmacro-abc123def456', token: null, timeZone: 'Europe/Paris', appUrl: 'https://x.example' },
    })
    expect(validateNtfy({ topic: 'short' }).ok).toBe(false)
    expect(validateNtfy({ topic: 'has space in topic' }).ok).toBe(false)
    expect(validateNtfy({ topic: 'airmacro-abc123def456/../x' }).ok).toBe(false)
    expect(validateNtfy({ topic: 'airmacro-abc123def456', token: 'tk_ok_12345' }).value.token).toBe('tk_ok_12345')
    expect(validateNtfy({ topic: 'airmacro-abc123def456', token: 'bad\ntoken12' }).ok).toBe(false)
    expect(validateNtfy({ topic: 'airmacro-abc123def456', appUrl: 'javascript:alert(1)' }).ok).toBe(false)
    expect(validateNtfy({ topic: 'airmacro-abc123def456', timeZone: 'Nowhere/Land' }).value.timeZone).toBe('UTC')
  })

  it('indice de topic sans le révéler', () => {
    expect(topicHint('airmacro-abcdefghijklmnopqr')).toBe('airmacro-…')
    expect(topicHint('abcdefghijkl')).toBe('abcd…')
    expect(topicHint(null)).toBeNull()
  })
})
