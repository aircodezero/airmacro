/** Identifiant d'événement reçu dans l'URL (lien de notification), sinon undefined. */
export const eventParam = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[\w.:-]{1,160}$/.test(value) ? value : undefined

export interface HomeSearch {
  /** Événement à ouvrir (lien d'une notification). */
  event?: string
}

// valeur invalide : `undefined` explicite (le routeur fusionne la recherche brute de l'URL)
export const validateHomeSearch = (search: Record<string, unknown>): HomeSearch => ({ event: eventParam(search.event) })
