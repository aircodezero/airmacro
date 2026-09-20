import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { qAiStatus } from './queries'
import { readSse } from './sse'

type TurnState = 'waiting' | 'streaming' | 'done' | 'stopped' | 'error'

interface Turn {
  id: number
  question: string | null
  /** question réellement posée (renvoyée par le serveur), pour l'historique */
  asked: string | null
  text: string
  provider: string | null
  label: string | null
  state: TurnState
  notice: string | null
  elapsedMs: number
  waitingFor: string | null
  switched: boolean
}

interface DonePayload {
  provider: string
  label: string
  question?: string
  text: string
  notice?: string | null
  durationMs?: number
}

const NOTICES: Record<string, string> = {
  offline: 'Offline mode: AI answers are disabled, so the built-in explanation is shown.',
  no_backend: 'No AI backend is configured on this server, so the built-in explanation is shown.',
  rate_limited: 'Hourly AI question limit reached — the built-in explanation is shown. Try again later.',
  providers_failed: 'The AI did not answer in time, so the built-in explanation is shown.',
}

const MAX_EXCHANGES = 3

const seconds = (ms: number) => `${Math.max(0, Math.round(ms / 1000))} s`

function ProviderBadge({ provider, label }: { provider: string | null; label: string | null }) {
  if (!label) return null
  const kind = provider === 'static' ? 'static' : provider?.startsWith('ollama') ? 'local' : 'claude'
  return <span className={`provider-badge provider-${kind}`}>{label}</span>
}

export function AskAI({ contextType, id, suggestions }: { contextType: 'event' | 'indicator'; id: string; suggestions: string[] }) {
  const status = useQuery(qAiStatus())
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const seq = useRef(0)
  const inputId = useId()
  const headingId = useId()

  // fermeture de la fiche : la génération en cours est annulée (libère le CPU côté serveur)
  useEffect(() => () => abortRef.current?.abort(), [])

  const busy = turns.some((t) => t.state === 'waiting' || t.state === 'streaming')
  const ai = status.data
  const available = ai?.available ?? false

  const patch = (turnId: number, change: Partial<Turn> | ((t: Turn) => Partial<Turn>)) =>
    setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, ...(typeof change === 'function' ? change(t) : change) } : t)))

  const finish = (turnId: number, data: DonePayload) => {
    patch(turnId, {
      state: 'done',
      text: data.text,
      provider: data.provider,
      label: data.label,
      notice: data.notice ?? null,
      asked: data.question ?? null,
      elapsedMs: data.durationMs ?? 0,
    })
    setAnnouncement(`Answer ready from ${data.label}.`)
  }

  async function ask(question: string | null) {
    if (busy || !available) return
    const history = turns
      .filter((t) => t.state === 'done' && t.provider && t.provider !== 'static' && t.asked)
      .slice(-MAX_EXCHANGES)
      .flatMap((t) => [
        { role: 'user', content: t.asked as string },
        { role: 'assistant', content: t.text.slice(0, 4000) },
      ])
    const turnId = ++seq.current
    setTurns((prev) => [
      ...prev,
      {
        id: turnId,
        question,
        asked: null,
        text: '',
        provider: null,
        label: null,
        state: 'waiting',
        notice: null,
        elapsedMs: 0,
        waitingFor: ai?.primary?.label ?? null,
        switched: false,
      },
    ])
    setAnnouncement(`Asking ${ai?.primary?.label ?? 'the AI'}…`)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch('/api/macro/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ contextType, id, question, history, stream: true }),
        signal: controller.signal,
      })
      if (!res.ok || !res.headers.get('content-type')?.includes('text/event-stream')) {
        const body = (await res.json().catch(() => null)) as (DonePayload & { error?: string }) | null
        if (body?.text) finish(turnId, body)
        else {
          patch(turnId, {
            state: 'error',
            notice: body?.error === 'unknown_subject' ? 'This item is no longer in the loaded data.' : `The request failed (HTTP ${res.status}).`,
          })
          setAnnouncement('The AI request failed.')
        }
        return
      }
      let completed = false
      for await (const message of readSse(res)) {
        const data = message.data as Record<string, unknown>
        switch (message.event) {
          case 'status':
            patch(turnId, (t) => ({
              elapsedMs: typeof data.elapsedMs === 'number' ? data.elapsedMs : t.elapsedMs,
              waitingFor: typeof data.label === 'string' ? data.label : t.waitingFor,
            }))
            break
          case 'meta':
            patch(turnId, { provider: String(data.provider), label: String(data.label), state: 'streaming' })
            break
          case 'delta':
            patch(turnId, (t) => ({ text: t.text + String(data.text ?? ''), state: 'streaming' }))
            break
          case 'reset':
            patch(turnId, { text: '', state: 'waiting', switched: true, provider: null, label: null })
            break
          case 'done':
            completed = true
            finish(turnId, data as unknown as DonePayload)
            break
        }
      }
      if (!completed) {
        patch(turnId, { state: 'error', notice: 'The connection closed before the answer finished.' })
        setAnnouncement('The answer was interrupted.')
      }
    } catch {
      if (controller.signal.aborted) {
        patch(turnId, (t) => ({ state: 'stopped', notice: t.text ? 'Stopped — partial answer.' : 'Stopped.' }))
        setAnnouncement('Stopped.')
      } else {
        patch(turnId, { state: 'error', notice: 'The AI request failed — the built-in explanation above still applies.' })
        setAnnouncement('The AI request failed.')
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const question = input.trim()
    if (!question) return
    setInput('')
    void ask(question)
  }

  const unavailableText =
    ai?.reason === 'offline'
      ? 'AI answers are disabled in offline mode — the built-in explanation above still applies.'
      : 'No AI backend is available on this server (configure a Claude API key on the server or run Ollama locally) — the built-in explanation above still applies.'

  return (
    <section className="askai" aria-labelledby={headingId}>
      <div className="askai-head">
        <h3 id={headingId} className="drawer-subtitle">
          Ask AI
        </h3>
        {ai?.primary && <ProviderBadge provider={ai.primary.kind === 'ollama' ? ai.primary.id : 'claude'} label={ai.primary.label} />}
      </div>

      {status.isPending ? (
        <p className="panel-note">Checking AI availability…</p>
      ) : status.isError ? (
        <p className="panel-note">AI availability could not be checked.</p>
      ) : !available ? (
        <p className="panel-note askai-off">{unavailableText}</p>
      ) : ai?.primary?.kind === 'ollama' ? (
        <p className="panel-note">
          Runs on this server’s CPU with a local model — answers stream as they are written and can take one to three
          minutes.
        </p>
      ) : null}

      {turns.length === 0 && (
        <button type="button" className="btn btn-primary" disabled={!available || busy} onClick={() => void ask(null)}>
          Explain with AI
        </button>
      )}

      {turns.length > 0 && (
        <ol className="askai-turns">
          {turns.map((t) => (
            <li key={t.id} className={`askai-turn is-${t.state}`} aria-busy={t.state === 'waiting' || t.state === 'streaming'}>
              <p className="askai-q">
                <span className="askai-q-label">{t.question ? 'You asked' : 'Explain with AI'}</span>
                {t.question && <span className="askai-q-text">{t.question}</span>}
              </p>
              <div className="askai-a">
                <div className="askai-meta">
                  <ProviderBadge provider={t.provider} label={t.label} />
                  {t.state === 'waiting' && (
                    <span className="muted">
                      {t.switched ? 'Switching source… ' : ''}Waiting for {t.waitingFor ?? 'the AI'} · {seconds(t.elapsedMs)}
                    </span>
                  )}
                  {t.state === 'streaming' && <span className="muted">Writing…</span>}
                  {t.state === 'done' && t.provider !== 'static' && t.elapsedMs > 0 && (
                    <span className="muted">{seconds(t.elapsedMs)}</span>
                  )}
                </div>
                {t.text && <p className="askai-text">{t.text}</p>}
                {t.notice && <p className="askai-notice">{NOTICES[t.notice] ?? t.notice}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}

      {available && (
        <form className="askai-form" onSubmit={submit}>
          <label htmlFor={inputId} className="askai-label">
            {turns.length ? 'Ask a follow-up' : 'Or ask your own question'}
          </label>
          <div className="askai-row">
            <input
              id={inputId}
              type="text"
              maxLength={2000}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={turns.length ? 'e.g. What would change the outlook?' : 'e.g. What is expected today?'}
              autoComplete="off"
            />
            {busy ? (
              <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>
                Stop
              </button>
            ) : (
              <button type="submit" className="btn" disabled={!input.trim()}>
                Send
              </button>
            )}
          </div>
          {!busy && turns.some((t) => t.state === 'done') && (
            <div className="askai-suggest" role="group" aria-label="Suggested follow-ups">
              {suggestions.map((s) => (
                <button key={s} type="button" className="legend-item" onClick={() => void ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </form>
      )}

      <p className="askai-disclaimer">
        AI-generated — verify before acting · Not investment advice. Your question and the figures shown in AirMacro
        are sent to the model; AirMacro does not store conversations.
      </p>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </section>
  )
}
