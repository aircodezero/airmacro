/*
 * Stockage local des notifications AirMacro : clés VAPID, abonnements push,
 * réglages ntfy, état des envois. Répertoire `.data/airmacro/` (ignoré par git,
 * hors des chemins surveillés par node --watch), fichiers en mode 0600.
 */
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'

const DIR = new URL('../../../.data/airmacro/', import.meta.url)

let dirOverride = null
/** Répertoire de test (vitest). */
export const setStoreDir = (url) => {
  dirOverride = url
}
const dir = () => dirOverride ?? DIR

const safeName = (name) => name.replace(/[^a-z0-9._-]/gi, '_')

export async function readJson(name, fallback) {
  try {
    return JSON.parse(await readFile(new URL(`${safeName(name)}.json`, dir()), 'utf8'))
  } catch {
    return fallback
  }
}

async function persist(key, value) {
  await mkdir(dir(), { recursive: true, mode: 0o700 })
  const file = new URL(`${key}.json`, dir())
  const tmp = new URL(`${key}.${process.pid}.${Date.now()}.tmp`, dir())
  await writeFile(tmp, JSON.stringify(value, null, 1), { mode: 0o600 })
  await rename(tmp, file)
  await chmod(file, 0o600).catch(() => {})
}

/* Opérations sérialisées par fichier : pas d'entrelacement entre requêtes concurrentes. */
const chains = new Map()

function serialize(key, task) {
  const run = (chains.get(key) ?? Promise.resolve()).then(task)
  chains.set(
    key,
    run.catch(() => {}),
  )
  return run
}

export const writeJson = (name, value) => serialize(safeName(name), () => persist(safeName(name), value))

/** Lecture → modification → écriture, sans concurrence au sein du processus. */
export function updateJson(name, fallback, mutate) {
  const key = safeName(name)
  return serialize(key, async () => {
    const current = await readJson(name, fallback)
    const result = await mutate(current)
    await persist(key, current)
    return result
  })
}
