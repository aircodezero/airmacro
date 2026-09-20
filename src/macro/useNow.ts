import { useEffect, useState } from 'react'

/**
 * Horloge partagée d'un composant : se réveille toutes les `intervalMs`,
 * alignée sur la seconde pour que les minutes affichées basculent à l'heure juste.
 */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      setNow(Date.now())
      const drift = Date.now() % 1000
      timer = setTimeout(tick, intervalMs - drift)
    }
    timer = setTimeout(tick, intervalMs - (Date.now() % 1000))
    return () => clearTimeout(timer)
  }, [intervalMs])
  return now
}
