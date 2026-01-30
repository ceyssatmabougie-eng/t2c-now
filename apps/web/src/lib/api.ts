export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string

export interface HealthResponse {
  ok: boolean
  name: string
}

export interface StopDirection {
  line: string
  headsign: string
}

export interface StopNear {
  id: string
  name: string
  distance: number
  directions: StopDirection[]
}

export interface DirectionOption {
  id: string
  headsign: string
  line: string
}

export interface Departure {
  minutes: number
  time: string
  realtime: boolean
  delayMinutes?: number
}

export interface NextDeparturesResponse {
  stopId: string
  directionId: string
  departures: Departure[]
}

export interface StopSearchResult {
  id: string
  name: string
  kind?: 'station' | 'platform'
  parentId?: string
}

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/health`)

  if (!response.ok) {
    throw new Error(`Erreur HTTP: ${response.status}`)
  }

  return response.json()
}

export async function fetchStopsNear(
  lat: number,
  lon: number,
  radius: number = 800
): Promise<StopNear[]> {
  const params = new URLSearchParams({
    lat: lat.toString(),
    lon: lon.toString(),
    radius: radius.toString(),
  })

  const response = await fetch(`${API_BASE_URL}/stops/near?${params}`)

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message ?? `Erreur HTTP: ${response.status}`)
  }

  return response.json()
}

export async function fetchDirections(stopId: string): Promise<DirectionOption[]> {
  const response = await fetch(`${API_BASE_URL}/stops/${stopId}/directions`)

  if (response.status === 404) {
    throw new Error('Aucune direction trouvée pour cet arrêt.')
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message ?? `Erreur HTTP: ${response.status}`)
  }

  return response.json()
}

export async function fetchNextDepartures(
  stopId: string,
  directionId: string,
  limit: number = 3
): Promise<NextDeparturesResponse> {
  const params = new URLSearchParams({
    directionId,
    limit: limit.toString(),
  })

  const response = await fetch(`${API_BASE_URL}/stops/${stopId}/next?${params}`)

  if (response.status === 400) {
    throw new Error('Paramètres de requête invalides.')
  }

  if (response.status === 404) {
    throw new Error('Arrêt ou direction non trouvé.')
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message ?? `Erreur HTTP: ${response.status}`)
  }

  return response.json()
}

export async function fetchStopsSearch(
  q: string,
  limit: number = 10
): Promise<StopSearchResult[]> {
  const params = new URLSearchParams({
    q,
    limit: limit.toString(),
  })

  const response = await fetch(`${API_BASE_URL}/stops/search?${params}`)

  if (response.status === 400) {
    throw new Error('Terme de recherche invalide.')
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    if (error.error === 'GTFS_DB_MISSING') {
      throw new Error('Base GTFS manquante. Contactez l\'administrateur.')
    }
    throw new Error(error.message ?? `Erreur HTTP: ${response.status}`)
  }

  return response.json()
}
