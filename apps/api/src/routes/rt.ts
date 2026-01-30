import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { getRtStatus, getRtCache, normalizeTripId, createFuzzyKey, parseTripIdComponents } from '../rt/rtClient.js'
import { openDb } from '../db.js'

const router: RouterType = Router()

/**
 * GET /rt/status
 * Returns the status of the GTFS-RT integration
 */
router.get('/status', (_req: Request, res: Response) => {
  const status = getRtStatus()
  res.json(status)
})

/**
 * GET /rt/debug
 * Debug endpoint to analyze trip_id matching
 */
router.get('/debug', (_req: Request, res: Response) => {
  const rtCache = getRtCache()

  if (!rtCache) {
    res.json({ error: 'No RT cache available' })
    return
  }

  // Get sample RT trip IDs
  const rtTripIds = Array.from(rtCache.data.keys())
  const sampleRtTrips = rtTripIds.slice(0, 20)

  // Get detailed RT data for first 5 trips
  const rtDetails = Array.from(rtCache.data.entries()).slice(0, 5).map(([tripId, update]) => ({
    tripId,
    routeId: update.routeId,
    directionId: update.directionId,
    delay: update.delay,
    stopIds: Array.from(update.stopTimesByStopId.keys()).slice(0, 3),
    stopSequences: Array.from(update.stopTimesBySequence.keys()).slice(0, 3),
  }))

  // Get sample DB trip IDs
  let db
  try {
    db = openDb()

    // Get trips for line B (tramway)
    const dbTripsB = db.prepare(`
      SELECT DISTINCT t.trip_id, r.route_short_name as line, t.trip_headsign
      FROM trips t
      JOIN routes r ON r.route_id = t.route_id
      WHERE r.route_short_name = 'B'
      LIMIT 20
    `).all() as Array<{ trip_id: string; line: string; trip_headsign: string }>

    // Check for exact matches
    const rtTripIdSet = new Set(rtTripIds)
    const matchesB = dbTripsB.filter(t => rtTripIdSet.has(t.trip_id))

    // Build normalized RT index
    const rtNormalizedSet = new Set(rtTripIds.map(normalizeTripId))

    // Check normalized matches for line B
    const normalizedMatchesB = dbTripsB.filter(t => rtNormalizedSet.has(normalizeTripId(t.trip_id)))

    // Get ALL DB trip IDs to check total matches
    const allDbTrips = db.prepare('SELECT trip_id FROM trips').all() as Array<{ trip_id: string }>
    const dbTripIdSet = new Set(allDbTrips.map(t => t.trip_id))

    let totalMatches = 0
    let totalNormalizedMatches = 0
    const matchedRtTrips: string[] = []
    const normalizedMatchedTrips: Array<{ rt: string; db: string }> = []

    // Build DB normalized index
    const dbNormalizedMap = new Map<string, string>()
    for (const t of allDbTrips) {
      dbNormalizedMap.set(normalizeTripId(t.trip_id), t.trip_id)
    }

    for (const rtId of rtTripIds) {
      if (dbTripIdSet.has(rtId)) {
        totalMatches++
        if (matchedRtTrips.length < 10) {
          matchedRtTrips.push(rtId)
        }
      }

      const normalizedRt = normalizeTripId(rtId)
      const matchingDbTrip = dbNormalizedMap.get(normalizedRt)
      if (matchingDbTrip) {
        totalNormalizedMatches++
        if (normalizedMatchedTrips.length < 10) {
          normalizedMatchedTrips.push({ rt: rtId, db: matchingDbTrip })
        }
      }
    }

    // Build fuzzy index from DB
    const dbFuzzyMap = new Map<string, string>()
    for (const t of allDbTrips) {
      const fuzzyKey = createFuzzyKey(t.trip_id)
      if (fuzzyKey) {
        dbFuzzyMap.set(fuzzyKey, t.trip_id)
      }
    }

    // Check fuzzy matches
    let totalFuzzyMatches = 0
    const fuzzyMatchedTrips: Array<{ rt: string; db: string; fuzzyKey: string }> = []

    for (const rtId of rtTripIds) {
      const fuzzyKey = createFuzzyKey(rtId)
      if (fuzzyKey) {
        const matchingDbTrip = dbFuzzyMap.get(fuzzyKey)
        if (matchingDbTrip) {
          totalFuzzyMatches++
          if (fuzzyMatchedTrips.length < 10) {
            fuzzyMatchedTrips.push({ rt: rtId, db: matchingDbTrip, fuzzyKey })
          }
        }
      }
    }

    // Check fuzzy matches for line B
    const fuzzyMatchesBCount = dbTripsB.filter(t => {
      const fuzzyKey = createFuzzyKey(t.trip_id)
      return fuzzyKey && rtCache.dataByFuzzyKey.has(fuzzyKey)
    }).length

    res.json({
      rtTripCount: rtTripIds.length,
      dbTripCount: allDbTrips.length,
      exactMatches: totalMatches,
      exactMatchPercentage: ((totalMatches / rtTripIds.length) * 100).toFixed(1) + '%',
      normalizedMatches: totalNormalizedMatches,
      normalizedMatchPercentage: ((totalNormalizedMatches / rtTripIds.length) * 100).toFixed(1) + '%',
      fuzzyMatches: totalFuzzyMatches,
      fuzzyMatchPercentage: ((totalFuzzyMatches / rtTripIds.length) * 100).toFixed(1) + '%',
      sampleRtTripIds: sampleRtTrips.slice(0, 5).map(id => ({
        full: id,
        normalized: normalizeTripId(id),
        fuzzyKey: createFuzzyKey(id),
        components: parseTripIdComponents(id),
      })),
      sampleDbTripIdsLineB: dbTripsB.slice(0, 5).map(t => ({
        trip_id: t.trip_id,
        fuzzyKey: createFuzzyKey(t.trip_id),
        components: parseTripIdComponents(t.trip_id),
        headsign: t.trip_headsign,
      })),
      exactMatchesLineB: matchesB.length,
      normalizedMatchesLineB: normalizedMatchesB.length,
      fuzzyMatchesLineB: fuzzyMatchesBCount,
      fuzzyMatchedTrips,
      rtDetails,
    })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  } finally {
    db?.close()
  }
})

export default router
