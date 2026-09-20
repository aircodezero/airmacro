/*
 * Décision de synchronisation de l'abonnement push (au lancement de l'app et à
 * l'ouverture du panneau Alerts). Pure : l'état du navigateur est fourni par
 * l'appelant, ce qui rend la logique testable sans DOM.
 *
 * Constat terrain (Android, app installée) : le navigateur peut désinscrire
 * l'abonnement à chaque lancement alors que le service worker reste enregistré
 * et la permission accordée. Un appareil déjà inscrit est alors réabonné
 * silencieusement, et l'ancien point d'accès est remplacé côté serveur.
 */

export type PushSnapshot = {
  permission: NotificationPermission
  /** true/false : un abonnement existe et sa clé correspond (ou non) au serveur ; null : aucun abonnement. */
  subscriptionKeyMatches: boolean | null
  /** Cet appareil a déjà activé les alertes depuis AirMacro (mémoire locale). */
  enrolled: boolean
}

export type EnrollmentState = 'enrolled' | 'opted-out' | 'unknown'

/**
 * Appareil inscrit ? La mémoire locale fait foi ; sans mémoire (appareil inscrit
 * avant qu'elle existe), notre propre service worker enregistré avec la
 * permission accordée ne peut venir que d'un « Turn on » dans AirMacro. Un
 * « Turn off » explicite laisse une mémoire d'opposition et n'est jamais déduit.
 */
export function inferEnrolled(s: { state: EnrollmentState; ownWorker: boolean; permission: NotificationPermission }): boolean {
  if (s.state === 'enrolled') return true
  if (s.state === 'opted-out') return false
  return s.ownWorker && s.permission === 'granted'
}

export type PushPlan =
  | { action: 'on' }
  | { action: 'off'; reason: 'never-enrolled' | 'permission-reset' | 'permission-denied' }
  | { action: 'restore'; reason: 'dropped' | 'key-changed' }

export function planPushSync(s: PushSnapshot): PushPlan {
  if (s.subscriptionKeyMatches === true) return { action: 'on' }
  if (s.permission === 'denied') return { action: 'off', reason: 'permission-denied' }
  // Jamais activé ici : un abonnement d'une autre origine de clé (ex. AirCode Ø) n'est pas touché.
  if (!s.enrolled) return { action: 'off', reason: 'never-enrolled' }
  if (s.permission !== 'granted') return { action: 'off', reason: 'permission-reset' }
  return { action: 'restore', reason: s.subscriptionKeyMatches === false ? 'key-changed' : 'dropped' }
}
