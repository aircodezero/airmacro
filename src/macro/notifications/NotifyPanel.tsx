import { useEffect, useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { relativeTime } from '../../lib/format'
import { browserTimeZone, fmtTime } from '../format'
import { qNotifyConfig, type NotifyConfig } from '../queries'
import {
  currentSubscription,
  disablePush,
  enablePush,
  planPush,
  PushPermissionError,
  pushSupport,
  readRestore,
  registerDevice,
  rememberEnrollment,
  rememberRestore,
  restorePush,
  serviceWorkers,
  snapshotPush,
  type PushUnavailable,
} from './push'

type PushState = 'checking' | 'off' | 'on' | 'working'
type Flash = { tone: 'ok' | 'error'; text: string } | null

const UNAVAILABLE: Record<PushUnavailable, string> = {
  insecure: 'Push notifications need a secure (HTTPS) address. Open AirMacro over HTTPS to enable them.',
  iframe: 'Push notifications can’t be enabled inside an embedded view. Open AirMacro in its own browser tab.',
  'ios-install': 'On iPhone and iPad, add AirMacro to your Home Screen first (Share → Add to Home Screen), then enable alerts from the installed app.',
  unsupported: 'This browser doesn’t support push notifications. Use the ntfy option below instead.',
  denied: 'Notifications are blocked for this site. Allow them in your browser’s site settings, then reload.',
}

/* Réparation silencieuse : l'utilisateur voit ce qui s'est passé au lieu d'un « Off » inexpliqué. */
const RESTORED = {
  dropped: 'the browser had dropped this device’s subscription, so it was registered again',
  'key-changed': 'the server key had changed, so this device was registered again with the current key',
} as const
const OFF_REASON = {
  'permission-reset': 'This device had alerts on, but the system reset its notification permission. Turn them on again.',
  'permission-denied': 'Notifications are blocked for this app in system settings.',
  'never-enrolled': null,
} as const

async function api<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; detail?: string }
  if (!res.ok) throw new Error(json.detail ?? json.error ?? `HTTP ${res.status}`)
  return json
}

const randomTopic = () => {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(18))
  return `airmacro-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')}`
}

function PushSection({ config, onChanged }: { config: NotifyConfig; onChanged: () => void }) {
  const support = pushSupport()
  const [state, setState] = useState<PushState>('checking')
  const [flash, setFlash] = useState<Flash>(null)
  // réparation récente affichée 24 h : l'utilisateur sait pourquoi l'appareil est resté inscrit
  const restore = (() => {
    const last = readRestore()
    return last && Date.now() - new Date(last.at).getTime() < 86_400_000 ? last : null
  })()

  useEffect(() => {
    const sw = serviceWorkers()
    const key = config.vapidPublicKey
    if (!support.ok || !sw || !key) return
    let alive = true
    const sync = async () => {
      const { snapshot, subscription } = await snapshotPush(key)
      const plan = planPush(snapshot)
      if (plan.action === 'on') {
        // abonnement en place : réenregistré côté serveur (fuseau à jour, serveur réinitialisé)
        if (subscription) {
          rememberEnrollment(subscription)
          await registerDevice(subscription, null).catch(() => {})
        }
        if (alive) setState('on')
        return
      }
      if (plan.action === 'restore') {
        // appareil déjà inscrit, permission accordée : réabonnement sans geste, ancien point d'accès remplacé
        const restored = await restorePush(key)
        await registerDevice(restored.subscription, restored.replaces)
        rememberRestore(plan.reason)
        if (alive) {
          setState('on')
          setFlash({ tone: 'ok', text: `Alerts were restored on this device: ${RESTORED[plan.reason]}.` })
        }
        onChanged()
        return
      }
      if (!alive) return
      setState('off')
      const reason = OFF_REASON[plan.reason]
      if (reason) setFlash({ tone: 'error', text: reason })
    }
    sync().catch(() => alive && setState('off'))
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'airmacro-push') setFlash({ tone: 'ok', text: `Received on this device: “${event.data.title}”.` })
    }
    sw.addEventListener('message', onMessage)
    return () => {
      alive = false
      sw.removeEventListener('message', onMessage)
    }
  }, [support.ok, config.vapidPublicKey])

  const enable = async () => {
    if (!config.vapidPublicKey) return
    setState('working')
    setFlash(null)
    try {
      const { subscription, replaces } = await enablePush(config.vapidPublicKey)
      await registerDevice(subscription, replaces)
      setState('on')
      setFlash({ tone: 'ok', text: 'Alerts are on for this device. Send a test to check delivery.' })
      onChanged()
    } catch (err) {
      setState('off')
      setFlash({
        tone: 'error',
        text: err instanceof PushPermissionError ? err.message : `Could not enable push notifications: ${(err as Error).message}`,
      })
    }
  }

  const disable = async () => {
    setState('working')
    try {
      const endpoint = await disablePush()
      if (endpoint) await api('/api/macro/notify/subscriptions', 'DELETE', { endpoint })
      setState('off')
      setFlash({ tone: 'ok', text: 'Alerts are off for this device.' })
      onChanged()
    } catch (err) {
      setState('on')
      setFlash({ tone: 'error', text: `Could not turn alerts off: ${(err as Error).message}` })
    }
  }

  const test = async () => {
    setFlash(null)
    try {
      const subscription = await currentSubscription()
      if (!subscription) throw new Error('this device is not subscribed')
      await api('/api/macro/notify/test', 'POST', { channel: 'push', endpoint: subscription.endpoint })
      setFlash({ tone: 'ok', text: 'Test sent — it should appear within a few seconds.' })
    } catch (err) {
      setFlash({ tone: 'error', text: `Test failed: ${(err as Error).message}` })
    }
  }

  return (
    <section className="notify-section" aria-labelledby="notify-push-title">
      <h3 id="notify-push-title" className="drawer-subtitle">
        Push notifications on this device
      </h3>
      {!support.ok ? (
        <p className="panel-note notify-warn">{UNAVAILABLE[support.reason]}</p>
      ) : !config.vapidPublicKey ? (
        <p className="panel-note notify-warn">Push is not available on the server right now.</p>
      ) : (
        <>
          <p className="notify-status">
            <span className={`notify-dot ${state === 'on' ? 'is-on' : ''}`} aria-hidden="true" />
            {state === 'checking' ? 'Checking…' : state === 'working' ? 'Working…' : state === 'on' ? 'On for this device' : 'Off for this device'}
          </p>
          {restore && state === 'on' && (
            <p className="notify-hint">
              Restored {relativeTime(restore.at)}: {RESTORED[restore.reason]}.
            </p>
          )}
          <div className="notify-actions">
            {state === 'on' ? (
              <>
                <button type="button" className="btn" onClick={test}>
                  Send a test
                </button>
                <button type="button" className="btn" onClick={disable}>
                  Turn off
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={enable} disabled={state !== 'off'}>
                Turn on push notifications
              </button>
            )}
          </div>
        </>
      )}
      {flash && (
        <p className={`notify-flash is-${flash.tone}`} role={flash.tone === 'error' ? 'alert' : 'status'}>
          {flash.text}
        </p>
      )}
    </section>
  )
}

function NtfySection({ config, onChanged }: { config: NotifyConfig; onChanged: () => void }) {
  const [topic, setTopic] = useState('')
  const [token, setToken] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<Flash>(null)
  const topicId = useId()
  const tokenId = useId()
  const valid = /^[A-Za-z0-9_-]{12,64}$/.test(topic)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setFlash(null)
    try {
      await action()
      onChanged()
    } catch (err) {
      setFlash({ tone: 'error', text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(async () => {
      await api('/api/macro/notify/ntfy', 'PUT', {
        topic,
        token: token.trim() || null,
        timeZone: browserTimeZone(),
        appUrl: window.location.origin,
      })
      setSaved(topic)
      setToken('')
      setFlash({ tone: 'ok', text: 'Saved. Subscribe to this topic in the ntfy app, then send a test.' })
    })

  const remove = () =>
    run(async () => {
      await api('/api/macro/notify/ntfy', 'DELETE')
      setSaved(null)
      setFlash({ tone: 'ok', text: 'ntfy alerts removed.' })
    })

  const test = () =>
    run(async () => {
      await api('/api/macro/notify/test', 'POST', { channel: 'ntfy' })
      setFlash({ tone: 'ok', text: 'Test sent to ntfy.' })
    })

  const shown = saved ?? null
  return (
    <section className="notify-section" aria-labelledby="notify-ntfy-title">
      <h3 id="notify-ntfy-title" className="drawer-subtitle">
        ntfy (phone app)
      </h3>
      <p className="panel-note">
        Alerts are also published to an{' '}
        <a className="linklike" href="https://ntfy.sh" target="_blank" rel="noopener noreferrer">
          ntfy
        </a>{' '}
        topic — install the ntfy app and subscribe to the same topic. On the public server anyone who knows the topic can
        read it, so keep it long and random.
      </p>
      <p className="notify-status">
        <span className={`notify-dot ${config.ntfy.enabled ? 'is-on' : ''}`} aria-hidden="true" />
        {config.ntfy.enabled
          ? `On · ${config.ntfy.server.replace(/^https:\/\//, '')} · topic ${shown ?? config.ntfy.topicHint}${config.ntfy.hasToken ? ' · with access token' : ''}`
          : 'Off'}
      </p>
      {shown && (
        <p className="notify-topic mono">
          Topic: <strong>{shown}</strong>{' '}
          <a className="linklike" href={`${config.ntfy.server}/${shown}`} target="_blank" rel="noopener noreferrer">
            open ↗
          </a>
        </p>
      )}
      <form
        className="notify-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) void save()
        }}
      >
        <label htmlFor={topicId}>Topic</label>
        <div className="askai-row">
          <input
            id={topicId}
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value.trim())}
            placeholder="airmacro-…"
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${topicId}-hint`}
          />
          <button type="button" className="btn" onClick={() => setTopic(randomTopic())}>
            Generate
          </button>
        </div>
        <span id={`${topicId}-hint`} className="notify-hint">
          12–64 letters, digits, “-” or “_”.
        </span>
        <label htmlFor={tokenId}>Access token (optional, for protected topics)</label>
        <input id={tokenId} type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" maxLength={200} />
        <div className="notify-actions">
          <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
            Save topic
          </button>
          {config.ntfy.enabled && (
            <>
              <button type="button" className="btn" onClick={test} disabled={busy}>
                Send a test
              </button>
              <button type="button" className="btn" onClick={remove} disabled={busy}>
                Remove
              </button>
            </>
          )}
        </div>
      </form>
      {flash && (
        <p className={`notify-flash is-${flash.tone}`} role={flash.tone === 'error' ? 'alert' : 'status'}>
          {flash.text}
        </p>
      )}
    </section>
  )
}

function NotifyDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const config = useQuery(qNotifyConfig())
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['macro', 'notify-config'] })

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [])

  const c = config.data
  return (
    <dialog
      ref={dialogRef}
      className="drawer mdrawer"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close()
      }}
    >
      <div className="drawer-inner">
        <header className="drawer-head">
          <div className="drawer-title">
            <p className="kind-tag">AirMacro</p>
            <h2 id={titleId}>Alerts</h2>
          </div>
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>
            Close
          </button>
        </header>

        <p className="notify-intro">
          A reminder {c?.rules.reminderMinutes ?? 15} minutes before every high-impact event, then an alert when it is
          released — with the official figure for FOMC decisions and US CPI, jobs, PCE and GDP; consensus and previous
          value for the others. Times are shown in each device’s time zone.
        </p>

        {config.isPending ? (
          <p className="panel-note">Loading alert settings…</p>
        ) : config.isError || !c ? (
          <p className="panel-note notify-warn">Alert settings are unavailable right now.</p>
        ) : (
          <>
            {c.offline && <p className="panel-note notify-warn">Offline mode: alerts are paused until live data is back.</p>}
            <PushSection config={c} onChanged={refresh} />
            <NtfySection config={c} onChanged={refresh} />
            <section className="notify-section" aria-labelledby="notify-status-title">
              <h3 id="notify-status-title" className="drawer-subtitle">
                Status
              </h3>
              <ul className="notify-facts">
                <li>
                  Devices with push: <strong>{c.push.devices}</strong>
                </li>
                <li>
                  Last check: {c.watcher.lastCheckAt ? relativeTime(c.watcher.lastCheckAt) : 'not yet'}
                  {c.watcher.lastError ? ` · last error: ${c.watcher.lastError}` : ''}
                </li>
                {c.watcher.nextEvent && (
                  <li>
                    Next alert: {c.watcher.nextEvent.title} at {fmtTime(c.watcher.nextEvent.ts)}
                  </li>
                )}
              </ul>
              {c.watcher.recent.length > 0 && (
                <>
                  <h4 className="notify-subhead">Recent alerts</h4>
                  <ol className="notify-recent">
                    {c.watcher.recent.map((r) => (
                      <li key={`${r.key}-${r.at}`}>
                        <span>{r.title}</span>
                        <span className="muted">
                          {relativeTime(r.at)} ·{' '}
                          {r.delivered.push === 0 && !r.delivered.ntfy
                            ? 'not delivered'
                            : `${r.delivered.push} device${r.delivered.push === 1 ? '' : 's'}${r.delivered.ntfy ? ' · ntfy' : ''}`}
                        </span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </dialog>
  )
}

/** Bouton d'en-tête AirMacro : état des alertes + réglages. */
export function NotifyButton() {
  const [open, setOpen] = useState(false)
  const config = useQuery(qNotifyConfig())
  const on = Boolean(config.data && (config.data.push.devices > 0 || config.data.ntfy.enabled))
  return (
    <>
      <button type="button" className="btn notify-button" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className={`notify-dot ${on ? 'is-on' : ''}`} aria-hidden="true" />
        Alerts {on ? 'on' : 'off'}
      </button>
      {open && <NotifyDialog onClose={() => setOpen(false)} />}
    </>
  )
}
