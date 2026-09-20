export type Source = 'live' | 'cache' | 'seed'

export interface Envelope<T> {
  data: T
  source: Source
  provider?: string
  asOf: string
  note?: string
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function getJson<T>(path: string): Promise<Envelope<T>> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    throw new ApiError(res.status, `${path} → HTTP ${res.status}`)
  }
  return (await res.json()) as Envelope<T>
}
