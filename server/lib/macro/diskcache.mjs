/*
 * Cache disque « dernier bon connu » pour les sources à quota ou lourdes
 * (BLS v1 : 25 requêtes/jour ; EIA DEMO_KEY ; fichiers plats BEA de 36 Mo).
 * Le serveur de dev redémarre à chaque modification (node --watch) : sans ce
 * cache, chaque redémarrage consommerait du quota.
 * Emplacement : node_modules/.cache/airmacro (ignoré par git et par Vite).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'

const DIR = new URL('../../../node_modules/.cache/airmacro/', import.meta.url)

const safeName = (name) => name.replace(/[^a-z0-9._-]/gi, '_')

export async function readDisk(name) {
  try {
    const parsed = JSON.parse(await readFile(new URL(`${safeName(name)}.json`, DIR), 'utf8'))
    return parsed && typeof parsed.savedAt === 'string' ? parsed : null
  } catch {
    return null
  }
}

export async function writeDisk(name, value, savedAt = new Date().toISOString()) {
  try {
    await mkdir(DIR, { recursive: true })
    const file = new URL(`${safeName(name)}.json`, DIR)
    const tmp = new URL(`${safeName(name)}.${process.pid}.tmp`, DIR)
    await writeFile(tmp, JSON.stringify({ savedAt, value }))
    await rename(tmp, file)
  } catch (err) {
    console.warn(`[macro] cache disque ${name} non écrit: ${String(err?.message ?? err).slice(0, 120)}`)
  }
  return savedAt
}

/**
 * Sert la valeur disque si elle a moins de `maxAgeMs`, sinon appelle
 * `fetcher(previousValue)` (qui peut s'en servir pour une requête
 * conditionnelle) et persiste le résultat. En cas d'échec, la dernière valeur
 * connue est resservie marquée `stale` plutôt que de tomber sur le seed.
 * @returns {Promise<{value: any, fetchedAt: string, stale: boolean}>}
 */
export async function diskBacked(name, maxAgeMs, fetcher) {
  const cached = await readDisk(name)
  const age = cached ? Date.now() - Date.parse(cached.savedAt) : Infinity
  if (cached && age >= 0 && age < maxAgeMs) {
    return { value: cached.value, fetchedAt: cached.savedAt, stale: false }
  }
  try {
    const value = await fetcher(cached?.value ?? null)
    const fetchedAt = await writeDisk(name, value)
    return { value, fetchedAt, stale: false }
  } catch (err) {
    if (cached) {
      console.warn(`[macro] ${name}: amont indisponible, dernière valeur connue resservie (${cached.savedAt})`)
      return { value: cached.value, fetchedAt: cached.savedAt, stale: true }
    }
    throw err
  }
}
