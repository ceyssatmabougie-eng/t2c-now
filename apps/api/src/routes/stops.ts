import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { existsSync } from 'fs'
import { openDb, getDbPath } from '../db.js'
import { haversineDistance } from '../utils/geo.js'
import { resolveStopIds } from '../gtfs/resolveStopIds.js'
import {
  formatYyyymmddLocal,
  getWeekdayLocal,
  getServiceDayDateLocal,
  type Weekday,
} from '../gtfs/date.js'
import { getRtCache, normalizeTripId, createFuzzyKey, findClosestRtUpdate } from '../rt/rtClient.js'

const router: RouterType = Router()

interface StopRow {
  stop_id: string
  stop_name: string
  stop_lat: number
  stop_lon: number
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

export interface StopSearchResult {
  id: string
  name: string
  kind?: 'station' | 'platform'
  parentId?: string
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
  rtAgeSeconds?: number
}

interface NearQuery {
  lat?: string
  lon?: string
  radius?: string
}

interface SearchQuery {
  q?: string
  limit?: string
}

interface StopParams {
  stopId: string
}

interface NextQuery {
  directionId?: string
  limit?: string
  debug?: string
}

interface DirectionRow {
  route_id: string
  line: string
  direction_id: number | null
  headsign: string
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

const MAX_RESULTS = 20

router.get('/near', (req: Request<object, object, object, NearQuery>, res: Response) => {
  const { lat, lon, radius: radiusParam } = req.query

  if (!lat || !lon) {
    res.status(400).json({
      error: 'Paramètres manquants',
      message: 'Les paramètres "lat" et "lon" sont requis',
    })
    return
  }

  const latNum = parseFloat(lat)
  const lonNum = parseFloat(lon)

  if (isNaN(latNum) || isNaN(lonNum)) {
    res.status(400).json({
      error: 'Paramètres invalides',
      message: 'Les paramètres "lat" et "lon" doivent être des nombres valides',
    })
    return
  }

  if (latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
    res.status(400).json({
      error: 'Coordonnées hors limites',
      message: 'lat doit être entre -90 et 90, lon entre -180 et 180',
    })
    return
  }

  const radius = radiusParam ? parseFloat(radiusParam) : 800

  if (isNaN(radius) || radius <= 0) {
    res.status(400).json({
      error: 'Paramètre invalide',
      message: 'Le paramètre "radius" doit être un nombre positif',
    })
    return
  }

  const dbPath = getDbPath()
  if (!existsSync(dbPath)) {
    res.status(500).json({
      error: 'GTFS_DB_MISSING',
      message: 'Base GTFS manquante : lancez pnpm import:gtfs',
    })
    return
  }

  let db
  try {
    db = openDb()

    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stops'")
      .get()

    if (!tableExists) {
      res.status(500).json({
        error: 'GTFS_DB_MISSING',
        message: 'Base GTFS manquante : lancez pnpm import:gtfs',
      })
      return
    }

    const rows = db
      .prepare('SELECT stop_id, stop_name, stop_lat, stop_lon FROM stops')
      .all() as StopRow[]

    const stopsWithDistance = rows
      .map((row) => ({
        id: row.stop_id,
        name: row.stop_name,
        distance: haversineDistance(latNum, lonNum, row.stop_lat, row.stop_lon),
      }))
      .filter((stop) => stop.distance <= radius)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, MAX_RESULTS)

    // Get directions (line + headsign) for each stop
    const stopIds = stopsWithDistance.map((s) => s.id)
    const directionsMap = new Map<string, StopDirection[]>()

    if (stopIds.length > 0) {
      const placeholders = stopIds.map(() => '?').join(',')
      const directionsQuery = db.prepare(`
        SELECT DISTINCT
          st.stop_id,
          COALESCE(NULLIF(r.route_short_name, ''), r.route_long_name) as line,
          t.trip_headsign as headsign
        FROM stop_times st
        JOIN trips t ON t.trip_id = st.trip_id
        JOIN routes r ON r.route_id = t.route_id
        WHERE st.stop_id IN (${placeholders})
          AND t.trip_headsign IS NOT NULL
          AND trim(t.trip_headsign) <> ''
      `)
      const directionRows = directionsQuery.all(...stopIds) as Array<{ stop_id: string; line: string; headsign: string }>

      for (const row of directionRows) {
        const existing = directionsMap.get(row.stop_id) || []
        // Avoid duplicates
        const key = `${row.line}|${row.headsign}`
        if (!existing.some(d => `${d.line}|${d.headsign}` === key)) {
          existing.push({ line: row.line, headsign: row.headsign })
        }
        directionsMap.set(row.stop_id, existing)
      }

      // Sort by line then headsign
      for (const [stopId, directions] of directionsMap) {
        directions.sort((a, b) => {
          const lineCompare = a.line.localeCompare(b.line, 'fr', { numeric: true })
          if (lineCompare !== 0) return lineCompare
          return a.headsign.localeCompare(b.headsign, 'fr')
        })
        directionsMap.set(stopId, directions)
      }
    }

    const stops: StopNear[] = stopsWithDistance.map((stop) => ({
      ...stop,
      directions: directionsMap.get(stop.id) || [],
    }))

    res.json(stops)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue'
    res.status(500).json({
      error: 'DB_ERROR',
      message: `Erreur base de données: ${message}`,
    })
  } finally {
    db?.close()
  }
})

interface StopSearchRow {
  stop_id: string
  stop_name: string
  location_type: number | null
  parent_station: string | null
}

interface ParentStopRow {
  stop_id: string
  stop_name: string
}

router.get('/search', (req: Request<object, object, object, SearchQuery>, res: Response) => {
  const { q, limit: limitParam } = req.query

  if (!q || q.trim().length < 2) {
    res.status(400).json({
      error: 'Paramètre invalide',
      message: 'Le paramètre "q" est requis et doit contenir au moins 2 caractères',
    })
    return
  }

  const searchTerm = q.trim()
  const limit = Math.min(Math.max(1, parseInt(limitParam ?? '10', 10) || 10), 20)

  const dbPath = getDbPath()
  if (!existsSync(dbPath)) {
    res.status(500).json({
      error: 'GTFS_DB_MISSING',
      message: 'Base GTFS manquante : lancez pnpm import:gtfs',
    })
    return
  }

  let db
  try {
    db = openDb()

    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stops'")
      .get()

    if (!tableExists) {
      res.status(500).json({
        error: 'GTFS_DB_MISSING',
        message: 'Base GTFS manquante : lancez pnpm import:gtfs',
      })
      return
    }

    // Fetch more results to account for deduplication after parent resolution
    const fetchLimit = limit * 3

    const rows = db
      .prepare(`
        SELECT stop_id, stop_name, location_type, parent_station
        FROM stops
        WHERE lower(stop_name) LIKE '%' || lower(?) || '%'
        ORDER BY
          CASE WHEN lower(stop_name) LIKE lower(?) || '%' THEN 0 ELSE 1 END,
          stop_name
        LIMIT ?
      `)
      .all(searchTerm, searchTerm, fetchLimit) as StopSearchRow[]

    // Collect parent station IDs we need to fetch
    const parentIdsToFetch = new Set<string>()
    for (const row of rows) {
      if ((row.location_type === 0 || row.location_type === null) && row.parent_station) {
        parentIdsToFetch.add(row.parent_station)
      }
    }

    // Fetch parent stations
    const parentStops = new Map<string, ParentStopRow>()
    if (parentIdsToFetch.size > 0) {
      const parentIds = Array.from(parentIdsToFetch)
      const placeholders = parentIds.map(() => '?').join(',')
      const parentRows = db
        .prepare(`SELECT stop_id, stop_name FROM stops WHERE stop_id IN (${placeholders})`)
        .all(...parentIds) as ParentStopRow[]

      for (const parent of parentRows) {
        parentStops.set(parent.stop_id, parent)
      }
    }

    // Build results with deduplication
    const seen = new Set<string>()
    const results: StopSearchResult[] = []

    for (const row of rows) {
      // Case 1: location_type=1 (station) -> keep as station
      if (row.location_type === 1) {
        if (!seen.has(row.stop_id)) {
          seen.add(row.stop_id)
          results.push({
            id: row.stop_id,
            name: row.stop_name,
            kind: 'station',
          })
        }
      }
      // Case 2: platform with parent_station -> use parent
      else if (row.parent_station) {
        const parent = parentStops.get(row.parent_station)
        if (parent && !seen.has(parent.stop_id)) {
          seen.add(parent.stop_id)
          results.push({
            id: parent.stop_id,
            name: parent.stop_name,
            kind: 'station',
          })
        }
      }
      // Case 3: standalone platform/stop -> keep as platform
      else {
        if (!seen.has(row.stop_id)) {
          seen.add(row.stop_id)
          results.push({
            id: row.stop_id,
            name: row.stop_name,
            kind: 'platform',
          })
        }
      }

      if (results.length >= limit) break
    }

    // Sort: startswith boost then alphabetical
    const searchLower = searchTerm.toLowerCase()
    results.sort((a, b) => {
      const aStartsWith = a.name.toLowerCase().startsWith(searchLower) ? 0 : 1
      const bStartsWith = b.name.toLowerCase().startsWith(searchLower) ? 0 : 1
      if (aStartsWith !== bStartsWith) return aStartsWith - bStartsWith
      return a.name.localeCompare(b.name, 'fr')
    })

    res.json(results.slice(0, limit))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue'
    res.status(500).json({
      error: 'DB_ERROR',
      message: `Erreur base de données: ${message}`,
    })
  } finally {
    db?.close()
  }
})

router.get('/:stopId/directions', (req: Request<StopParams>, res: Response) => {
  const { stopId } = req.params

  const dbPath = getDbPath()
  if (!existsSync(dbPath)) {
    res.status(500).json({
      error: 'GTFS_DB_MISSING',
      message: 'Base GTFS manquante : lancez pnpm import:gtfs',
    })
    return
  }

  let db
  try {
    db = openDb()

    // Resolve stop_ids (handle parent stations)
    const stopIds = resolveStopIds(db, stopId)

    if (stopIds.length === 0) {
      res.status(404).json({
        error: 'Aucune direction trouvée',
        message: `Aucune direction trouvée pour l'arrêt "${stopId}"`,
      })
      return
    }

    // Build placeholders for IN clause
    const placeholders = stopIds.map(() => '?').join(',')

    const rows = db
      .prepare(
        `SELECT DISTINCT
          r.route_id as route_id,
          COALESCE(NULLIF(r.route_short_name, ''), r.route_long_name) as line,
          t.direction_id as direction_id,
          t.trip_headsign as headsign
        FROM stop_times st
        JOIN trips t ON t.trip_id = st.trip_id
        JOIN routes r ON r.route_id = t.route_id
        WHERE st.stop_id IN (${placeholders})
          AND t.trip_headsign IS NOT NULL
          AND trim(t.trip_headsign) <> ''
        LIMIT 200`
      )
      .all(...stopIds) as DirectionRow[]

    // Deduplicate by (route_id, direction_id, headsign)
    const seen = new Set<string>()
    const directions: DirectionOption[] = []

    for (const row of rows) {
      const key = `${row.route_id}|${row.direction_id ?? ''}|${row.headsign}`
      if (!seen.has(key)) {
        seen.add(key)
        directions.push({
          id: key,
          headsign: row.headsign,
          line: row.line,
        })
      }
    }

    // Sort by line, then headsign
    directions.sort((a, b) => {
      const lineCompare = a.line.localeCompare(b.line, 'fr', { numeric: true })
      if (lineCompare !== 0) return lineCompare
      return a.headsign.localeCompare(b.headsign, 'fr')
    })

    // Limit to 30 results
    const limitedDirections = directions.slice(0, 30)

    if (limitedDirections.length === 0) {
      res.status(404).json({
        error: 'Aucune direction trouvée',
        message: `Aucune direction trouvée pour l'arrêt "${stopId}"`,
      })
      return
    }

    res.json(limitedDirections)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue'
    res.status(500).json({
      error: 'DB_ERROR',
      message: `Erreur base de données: ${message}`,
    })
  } finally {
    db?.close()
  }
})

interface StopTimeRow {
  trip_id: string
  service_id: string
  departure_time: string
  stop_id: string
  stop_sequence: number
}

interface ServiceIdRow {
  service_id: string
}

function timeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':')
  const hours = parseInt(parts[0], 10)
  const minutes = parseInt(parts[1], 10)
  const seconds = parseInt(parts[2] ?? '0', 10)
  return hours * 3600 + minutes * 60 + seconds
}

function getActiveServiceIds(db: ReturnType<typeof openDb>, serviceDate: string, weekday: Weekday): string[] {
  // Get services from calendar that are active on the service day
  // weekday is already a string like 'monday', 'tuesday', etc.
  const calendarServices = db
    .prepare(
      `SELECT service_id FROM calendar
       WHERE ${weekday} = 1
         AND start_date <= ?
         AND end_date >= ?`
    )
    .all(serviceDate, serviceDate) as ServiceIdRow[]

  const serviceIds = new Set(calendarServices.map((r) => r.service_id))

  // Apply calendar_dates exceptions for the service date
  const exceptions = db
    .prepare('SELECT service_id, exception_type FROM calendar_dates WHERE date = ?')
    .all(serviceDate) as Array<{ service_id: string; exception_type: number }>

  for (const exc of exceptions) {
    if (exc.exception_type === 1) {
      serviceIds.add(exc.service_id)
    } else if (exc.exception_type === 2) {
      serviceIds.delete(exc.service_id)
    }
  }

  return Array.from(serviceIds)
}

router.get('/:stopId/next', (req: Request<StopParams, object, object, NextQuery>, res: Response) => {
  const { stopId } = req.params
  const { directionId, limit: limitParam, debug: debugParam } = req.query
  const isDebug = debugParam === '1'

  if (!directionId) {
    res.status(400).json({
      error: 'Paramètre manquant',
      message: 'Le paramètre "directionId" est requis',
    })
    return
  }

  const dbPath = getDbPath()
  if (!existsSync(dbPath)) {
    res.status(500).json({
      error: 'GTFS_DB_MISSING',
      message: 'Base GTFS manquante : lancez pnpm import:gtfs',
    })
    return
  }

  let db
  try {
    db = openDb()

    // Current time info - all in LOCAL time
    const now = new Date()
    const timezoneOffsetMinutes = -now.getTimezoneOffset()

    // Get the service day (starts at 03:00 local)
    const serviceDayStart = getServiceDayDateLocal(now)
    const serviceDate = formatYyyymmddLocal(serviceDayStart)
    const weekday = getWeekdayLocal(serviceDayStart)

    // Current time in seconds since midnight (local)
    const nowSeconds =
      now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()

    // Resolve stop_ids (handle parent stations)
    const stopIds = resolveStopIds(db, stopId)

    if (stopIds.length === 0) {
      res.status(404).json({
        error: 'Arrêt non trouvé',
        message: `L'arrêt "${stopId}" n'existe pas`,
      })
      return
    }

    // Parse directionId: format is "route_id|direction_id|headsign"
    const parts = directionId.split('|')
    if (parts.length < 3) {
      res.status(400).json({
        error: 'Direction invalide',
        message: 'Format de direction invalide',
      })
      return
    }

    const [routeId, dirId, headsign] = parts
    const directionIdNum = dirId !== '' ? parseInt(dirId, 10) : null

    // Get active service IDs for the service day
    const activeServiceIds = getActiveServiceIds(db, serviceDate, weekday)

    // Validate that this direction exists for this stop
    const placeholders = stopIds.map(() => '?').join(',')
    const directionCheck = db
      .prepare(
        `SELECT 1 FROM stop_times st
         JOIN trips t ON t.trip_id = st.trip_id
         WHERE st.stop_id IN (${placeholders})
           AND t.route_id = ?
           AND t.trip_headsign = ?
           ${directionIdNum !== null ? 'AND t.direction_id = ?' : ''}
         LIMIT 1`
      )
      .get(...stopIds, routeId, headsign, ...(directionIdNum !== null ? [directionIdNum] : []))

    if (!directionCheck) {
      res.status(404).json({
        error: 'Direction non trouvée',
        message: `La direction "${directionId}" n'existe pas pour l'arrêt "${stopId}"`,
      })
      return
    }

    const limit = Math.min(Math.max(1, parseInt(limitParam ?? '3', 10) || 3), 10)

    // Query all candidate stop_times for this stop + direction
    const candidateQuery = `
      SELECT st.trip_id, t.service_id, st.departure_time, st.stop_id, st.stop_sequence
      FROM stop_times st
      JOIN trips t ON t.trip_id = st.trip_id
      WHERE st.stop_id IN (${placeholders})
        AND t.route_id = ?
        AND t.trip_headsign = ?
        ${directionIdNum !== null ? 'AND t.direction_id = ?' : ''}
      ORDER BY st.departure_time
    `
    const allCandidates = db
      .prepare(candidateQuery)
      .all(
        ...stopIds,
        routeId,
        headsign,
        ...(directionIdNum !== null ? [directionIdNum] : [])
      ) as StopTimeRow[]

    const candidateCountBeforeFilter = allCandidates.length

    // Filter by active service IDs
    const serviceIdSet = new Set(activeServiceIds)
    const candidatesAfterService = allCandidates.filter((c) =>
      serviceIdSet.has(c.service_id)
    )
    const candidateCountAfterService = candidatesAfterService.length

    // Filter by time (departures in the future)
    const candidatesAfterTime = candidatesAfterService.filter((c) => {
      const depSeconds = timeToSeconds(c.departure_time)
      return depSeconds > nowSeconds
    })
    const candidateCountAfterTime = candidatesAfterTime.length

    // Get RT cache for real-time data
    const rtCache = getRtCache()

    // Build departures with RT data applied
    const departuresUnsorted: Departure[] = candidatesAfterTime.map((c) => {
      const theoreticalSeconds = timeToSeconds(c.departure_time)
      let finalSeconds = theoreticalSeconds
      let isRealtime = false
      let delayMinutes: number | undefined

      // Try to get RT data for this trip
      if (rtCache) {
        // Try exact match first, then normalized match, then fuzzy match
        const fuzzyKey = createFuzzyKey(c.trip_id)
        const tripUpdate = rtCache.data.get(c.trip_id)
          ?? rtCache.dataByNormalizedId.get(normalizeTripId(c.trip_id))
          ?? (fuzzyKey ? rtCache.dataByFuzzyKey.get(fuzzyKey) : undefined)

        let stu = null

        if (tripUpdate) {
          // Look for stop time update - prioritize stop_sequence, fallback to stop_id
          const stuBySeq = tripUpdate.stopTimesBySequence.get(c.stop_sequence)
          const stuByStop = tripUpdate.stopTimesByStopId.get(c.stop_id)
          stu = stuBySeq ?? stuByStop

          // Fallback: trip-level delay (if no stop-level update)
          if (!stu && tripUpdate.delay != null) {
            finalSeconds = theoreticalSeconds + tripUpdate.delay
            isRealtime = true
            delayMinutes = Math.round(tripUpdate.delay / 60)
          }
        }

        // If no trip-level match, try direct route+stop proximity matching
        if (!stu && !isRealtime) {
          // Convert theoretical time to epoch seconds for today
          const todayStart = new Date(now)
          todayStart.setHours(0, 0, 0, 0)
          const theoreticalEpoch = Math.floor(todayStart.getTime() / 1000) + theoreticalSeconds

          // Find closest RT update within 15 minutes of theoretical time
          stu = findClosestRtUpdate(rtCache, routeId, c.stop_id, theoreticalEpoch, 900)
        }

        if (stu) {
          // Priority 1: absolute departure time from RT
          if (stu.departureTime != null) {
            // departureTime is epoch seconds - convert to seconds since midnight local
            const rtDate = new Date(stu.departureTime * 1000)
            const rtSeconds = rtDate.getHours() * 3600 + rtDate.getMinutes() * 60 + rtDate.getSeconds()
            // Handle times after midnight (GTFS can have times > 24:00)
            finalSeconds = rtSeconds < nowSeconds - 3600 ? rtSeconds + 86400 : rtSeconds
            isRealtime = true
            delayMinutes = Math.round((finalSeconds - theoreticalSeconds) / 60)
          }
          // Priority 2: delay in seconds
          else if (stu.departureDelay != null) {
            finalSeconds = theoreticalSeconds + stu.departureDelay
            isRealtime = true
            delayMinutes = Math.round(stu.departureDelay / 60)
          }
        }
      }

      const deltaMinutes = Math.round((finalSeconds - nowSeconds) / 60)
      const departureDate = new Date(now)
      departureDate.setHours(0, 0, 0, 0)
      departureDate.setSeconds(finalSeconds)

      return {
        minutes: deltaMinutes,
        time: formatTime(departureDate),
        realtime: isRealtime,
        ...(delayMinutes !== undefined && { delayMinutes }),
      }
    })

    // Filter out negative minutes (already departed) and sort by minutes
    const departures = departuresUnsorted
      .filter((d) => d.minutes >= 0)
      .sort((a, b) => a.minutes - b.minutes)
      .slice(0, limit)

    // Build response
    const response: NextDeparturesResponse & { debug?: object } = {
      stopId,
      directionId,
      departures,
      ...(rtCache && { rtAgeSeconds: Math.round((Date.now() - rtCache.fetchedAt) / 1000) }),
    }

    // Add debug info if requested
    if (isDebug) {
      const sampleUpcoming = candidatesAfterTime.slice(0, 10).map((c) => {
        const depSeconds = timeToSeconds(c.departure_time)
        const rtInfo = rtCache?.data.get(c.trip_id)
        return {
          trip_id: c.trip_id,
          service_id: c.service_id,
          stop_id: c.stop_id,
          stop_sequence: c.stop_sequence,
          departure_time: c.departure_time,
          depSeconds,
          nowSeconds,
          deltaMinutes: Math.round((depSeconds - nowSeconds) / 60),
          hasRtData: !!rtInfo,
        }
      })

      response.debug = {
        nowLocalReadable: now.toLocaleString('fr-FR'),
        serviceDayStartLocalReadable: serviceDayStart.toLocaleString('fr-FR'),
        serviceDateUsed: serviceDate,
        weekdayUsed: weekday,
        timezoneOffsetMinutes,
        activeServiceIds: activeServiceIds.slice(0, 20),
        activeServiceIdsCount: activeServiceIds.length,
        resolvedStopIds: stopIds,
        parsedDirectionId: {
          route_id: routeId,
          direction_id: directionIdNum,
          headsign,
        },
        candidateStopTimesCountBeforeFilter: candidateCountBeforeFilter,
        candidateServiceIds: [...new Set(allCandidates.map(c => c.service_id))].slice(0, 20),
        candidateStopTimesCountAfterServiceFilter: candidateCountAfterService,
        candidateStopTimesCountAfterTimeFilter: candidateCountAfterTime,
        sampleUpcoming,
        rtCacheStatus: rtCache ? {
          enabled: true,
          ageSeconds: Math.round((Date.now() - rtCache.fetchedAt) / 1000),
          tripUpdatesCount: rtCache.tripUpdatesCount,
        } : { enabled: false },
      }
    }

    res.json(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue'
    res.status(500).json({
      error: 'DB_ERROR',
      message: `Erreur base de données: ${message}`,
    })
  } finally {
    db?.close()
  }
})

export default router
