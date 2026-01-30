const STORAGE_KEY = 't2c_now_favorites'

export interface Favorite {
  id: string
  stopId: string
  stopName: string
  directionId: string
  headsign: string
  line: string
  createdAt: number
}

export function createFavoriteId(stopId: string, directionId: string): string {
  return `${stopId}__${directionId}`
}

export function loadFavorites(): Favorite[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

export function saveFavorites(favorites: Favorite[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites))
  } catch {
    console.error('Impossible de sauvegarder les favoris')
  }
}

export function addFavorite(favorite: Favorite): Favorite[] {
  const favorites = loadFavorites()
  const exists = favorites.some((f) => f.id === favorite.id)
  if (exists) return favorites

  const updated = [favorite, ...favorites]
  saveFavorites(updated)
  return updated
}

export function removeFavorite(id: string): Favorite[] {
  const favorites = loadFavorites()
  const updated = favorites.filter((f) => f.id !== id)
  saveFavorites(updated)
  return updated
}

export function isFavorite(id: string): boolean {
  const favorites = loadFavorites()
  return favorites.some((f) => f.id === id)
}
