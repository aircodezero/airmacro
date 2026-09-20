import { queryOptions } from '@tanstack/react-query'
import { getJson, type Envelope } from '../lib/api'
import type { CalendarData, SeriesData } from './types'

const MIN = 60_000

/**
 * Calendrier : sondage rapproché (1 min) quand un événement High est à moins
 * de 2 h (avant ou après), ou qu'un chiffre officiel est attendu depuis moins de
 * 30 min (quelle que soit l'importance), pour afficher l'« actual » dès sa
 * publication ; sinon toutes les 5 min. Le serveur borne lui-même le coût (cache/TTL).
 */
export function calendarRefetchInterval(data: Envelope<CalendarData> | undefined, now = Date.now()): number {
  const events = data?.data.events ?? []
  const hot = events.some((e) => e.impact === 'High' && !e.allDay && Math.abs(e.ts - now) < 2 * 60 * MIN)
  const awaiting = events.some(
    (e) => !e.allDay && e.ts <= now && now - e.ts < 30 * MIN && e.measures.some((m) => m.actualFrom && m.actual == null),
  )
  return hot || awaiting ? MIN : 5 * MIN
}

export const qMacroCalendar = () =>
  queryOptions({
    queryKey: ['macro', 'calendar'],
    queryFn: () => getJson<CalendarData>('/api/macro/calendar'),
    staleTime: 45_000,
    refetchInterval: (query) => calendarRefetchInterval(query.state.data),
  })

export interface AiStatus {
  available: boolean
  offline: boolean
  reason: 'offline' | 'no_backend' | null
  providers: Array<{ id: string; label: string; kind: 'claude' | 'ollama' }>
  primary: { id: string; label: string; kind: 'claude' | 'ollama' } | null
  localQueue: number
}

/** Disponibilité IA ; `warm` précharge le modèle local à l'ouverture d'une fiche. */
export const qAiStatus = () =>
  queryOptions({
    queryKey: ['macro', 'ai-status'],
    queryFn: async (): Promise<AiStatus> => {
      const res = await fetch('/api/macro/ai-status?warm=1', { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`ai-status → HTTP ${res.status}`)
      return (await res.json()) as AiStatus
    },
    staleTime: 30_000,
  })

export interface NotifyConfig {
  offline: boolean
  vapidPublicKey: string | null
  push: { devices: number }
  ntfy: { enabled: boolean; server: string; topicHint: string | null; hasToken: boolean }
  watcher: {
    running: boolean
    paused: boolean
    lastCheckAt: string | null
    lastError: string | null
    nextEvent: { title: string; ts: number } | null
    recent: Array<{ key: string; type: string; title: string; at: string; delivered: { push: number; ntfy: boolean } }>
  }
  rules: { reminderMinutes: number; impact: 'High' }
}

export const qNotifyConfig = () =>
  queryOptions({
    queryKey: ['macro', 'notify-config'],
    queryFn: async (): Promise<NotifyConfig> => {
      const res = await fetch('/api/macro/notify/config', { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`notify config → HTTP ${res.status}`)
      return (await res.json()) as NotifyConfig
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

export const qMacroSeries = () =>
  queryOptions({
    queryKey: ['macro', 'series'],
    queryFn: () => getJson<SeriesData>('/api/macro/series'),
    staleTime: 5 * MIN,
    refetchInterval: 10 * MIN,
  })
