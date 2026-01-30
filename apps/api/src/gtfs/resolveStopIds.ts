import type Database from 'better-sqlite3'

interface StopIdRow {
  stop_id: string
}

/**
 * Resolves a stopId to a list of stop_ids that have stop_times.
 * If the given stopId has stop_times directly, returns [stopId].
 * Otherwise, looks for children stops (where parent_station = stopId).
 */
export function resolveStopIds(db: Database.Database, stopId: string): string[] {
  // Check if stopId directly has stop_times
  const directMatch = db
    .prepare('SELECT 1 FROM stop_times WHERE stop_id = ? LIMIT 1')
    .get(stopId)

  if (directMatch) {
    return [stopId]
  }

  // Look for children stops (quais) with this parent_station
  const children = db
    .prepare(
      `SELECT stop_id FROM stops
       WHERE parent_station = ?
       AND (location_type IS NULL OR location_type = 0)`
    )
    .all(stopId) as StopIdRow[]

  return children.map((row) => row.stop_id)
}
