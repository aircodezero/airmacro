import { describe, it, expect } from 'vitest'
import { inferEnrolled, planPushSync } from './push-sync'

describe('synchronisation de l’abonnement push', () => {
  it('abonnement présent avec la clé du serveur : on', () => {
    expect(planPushSync({ permission: 'granted', subscriptionKeyMatches: true, enrolled: false })).toEqual({ action: 'on' })
  })

  it('appareil inscrit, permission accordée, abonnement disparu : réabonnement silencieux', () => {
    expect(planPushSync({ permission: 'granted', subscriptionKeyMatches: null, enrolled: true })).toEqual({ action: 'restore', reason: 'dropped' })
  })

  it('appareil inscrit, clé serveur changée : réabonnement avec la clé actuelle', () => {
    expect(planPushSync({ permission: 'granted', subscriptionKeyMatches: false, enrolled: true })).toEqual({ action: 'restore', reason: 'key-changed' })
  })

  it('jamais inscrit ici : off, sans toucher à un abonnement d’une autre clé', () => {
    expect(planPushSync({ permission: 'granted', subscriptionKeyMatches: null, enrolled: false })).toEqual({ action: 'off', reason: 'never-enrolled' })
    expect(planPushSync({ permission: 'granted', subscriptionKeyMatches: false, enrolled: false })).toEqual({ action: 'off', reason: 'never-enrolled' })
    expect(planPushSync({ permission: 'default', subscriptionKeyMatches: null, enrolled: false })).toEqual({ action: 'off', reason: 'never-enrolled' })
  })

  it('appareil inscrit mais permission remise à zéro par le système : off, geste utilisateur requis', () => {
    expect(planPushSync({ permission: 'default', subscriptionKeyMatches: null, enrolled: true })).toEqual({ action: 'off', reason: 'permission-reset' })
    expect(planPushSync({ permission: 'default', subscriptionKeyMatches: false, enrolled: true })).toEqual({ action: 'off', reason: 'permission-reset' })
  })

  it('inscription déduite sans mémoire locale : notre service worker + permission accordée', () => {
    expect(inferEnrolled({ state: 'unknown', ownWorker: true, permission: 'granted' })).toBe(true)
    expect(inferEnrolled({ state: 'unknown', ownWorker: false, permission: 'granted' })).toBe(false)
    expect(inferEnrolled({ state: 'unknown', ownWorker: true, permission: 'default' })).toBe(false)
    expect(inferEnrolled({ state: 'enrolled', ownWorker: false, permission: 'default' })).toBe(true)
    // « Turn off » explicite : jamais réabonné dans le dos de l'utilisateur
    expect(inferEnrolled({ state: 'opted-out', ownWorker: true, permission: 'granted' })).toBe(false)
  })

  it('permission refusée : off, quel que soit l’historique', () => {
    expect(planPushSync({ permission: 'denied', subscriptionKeyMatches: null, enrolled: true })).toEqual({ action: 'off', reason: 'permission-denied' })
    expect(planPushSync({ permission: 'denied', subscriptionKeyMatches: false, enrolled: false })).toEqual({ action: 'off', reason: 'permission-denied' })
  })
})
