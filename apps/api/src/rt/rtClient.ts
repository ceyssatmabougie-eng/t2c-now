/**
 * GTFS-RT Client with in-memory cache
 * Supports both URL fetch and local file reading
 */
import GtfsRealtimeBindings from 'gtfs-realtime-bindings'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'

const { transit_realtime } = GtfsRealtimeBindings

// Environment configuration
const GTFS_RT_URL = process.env.GTFS_RT_URL
const GTFS_RT_PATH = process.env.GTFS_RT_PATH
const GTFS_RT_POLL_SECONDS = parseInt(process.env.GTFS_RT_POLL_SECONDS ?? '15', 10)
const GTFS_RT_HEADERS_JSON = process.env.GTFS_RT_HEADERS_JSON

// Determine the source type
type RtSourceType = 'url' | 'file' | null
function getSourceType(): RtSourceType {
  if (GTFS_RT_URL) return 'url'
  if (GTFS_RT_PATH) return 'file'
  return null
}

const RT_SOURCE_TYPE = getSourceType()

/**
 * Stop time update with delay and absolute times
 */
export interface StopTimeUpdate {
  arrivalTime?: number
  arrivalDelay?: number
  departureTime?: number
  departureDelay?: number
}

/**
 * Indexed trip update for fast lookup
 */
export interface TripUpdateIndex {
  tripId: string
  routeId?: string
  directionId?: number
  delay?: number
  /** Map of stop_id -> StopTimeUpdate */
  stopTimesByStopId: Map<string, StopTimeUpdate>
  /** Map of stop_sequence -> StopTimeUpdate */
  stopTimesBySequence: Map<number, StopTimeUpdate>
}

/**
 * Stop time update with departure epoch for sorting
 */
export interface StopTimeUpdateWithEpoch extends StopTimeUpdate {
  departureEpoch: number
}

/**
 * RT Cache structure
 */
export interface RtCache {
  fetchedAt: number
  entityCount: number
  tripUpdatesCount: number
  /** Index by full trip_id */
  data: Map<string, TripUpdateIndex>
  /** Index by normalized trip_id (without first segment) for fuzzy matching */
  dataByNormalizedId: Map<string, TripUpdateIndex>
  /** Index by fuzzy key (serviceCode_line_timeWindow) for approximate matching */
  dataByFuzzyKey: Map<string, TripUpdateIndex>
  /** Index by route+stop+time for direct stop-level matching */
  dataByRouteStopTime: Map<string, StopTimeUpdate>
  /** Index by route+stop for finding closest RT update */
  dataByRouteStop: Map<string, StopTimeUpdateWithEpoch[]>
}

/**
 * Create a route+stop+time key for direct matching
 * Key format: "routeId_stopId_timeWindow"
 */
export function createRouteStopTimeKey(routeId: string, stopId: string, timeSeconds: number): string {
  // Round time to 5-minute window
  const timeWindow = Math.floor(timeSeconds / 300) * 300
  return `${routeId}_${stopId}_${timeWindow}`
}

/**
 * Create a route+stop key (without time) for proximity matching
 * Key format: "routeId_stopId"
 */
export function createRouteStopKey(routeId: string, stopId: string): string {
  return `${routeId}_${stopId}`
}

/**
 * Find the closest RT update for a given route+stop at a target epoch time
 * Returns the update if within maxDeltaSeconds, null otherwise
 */
export function findClosestRtUpdate(
  cache: RtCache,
  routeId: string,
  stopId: string,
  targetEpoch: number,
  maxDeltaSeconds: number = 900 // 15 minutes default
): StopTimeUpdate | null {
  const key = createRouteStopKey(routeId, stopId)
  const updates = cache.dataByRouteStop.get(key)

  if (!updates || updates.length === 0) {
    return null
  }

  // Binary search for the closest update
  let left = 0
  let right = updates.length - 1
  let closest: StopTimeUpdateWithEpoch | null = null
  let closestDelta = Infinity

  // Find the first update >= targetEpoch
  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const delta = Math.abs(updates[mid].departureEpoch - targetEpoch)

    if (delta < closestDelta) {
      closestDelta = delta
      closest = updates[mid]
    }

    if (updates[mid].departureEpoch < targetEpoch) {
      left = mid + 1
    } else {
      right = mid - 1
    }
  }

  // Check neighbors for potentially closer match
  if (left < updates.length) {
    const delta = Math.abs(updates[left].departureEpoch - targetEpoch)
    if (delta < closestDelta) {
      closestDelta = delta
      closest = updates[left]
    }
  }
  if (left > 0) {
    const delta = Math.abs(updates[left - 1].departureEpoch - targetEpoch)
    if (delta < closestDelta) {
      closestDelta = delta
      closest = updates[left - 1]
    }
  }

  // Return if within max delta
  if (closest && closestDelta <= maxDeltaSeconds) {
    return closest
  }

  return null
}

/**
 * Normalize trip_id by removing the first segment
 * T2C trip_id format: "1306_1000002_B_5_144800" -> "1000002_B_5_144800"
 * This handles the case where GTFS and GTFS-RT have different calendar prefixes
 */
export function normalizeTripId(tripId: string): string {
  const firstUnderscore = tripId.indexOf('_')
  if (firstUnderscore === -1) return tripId
  return tripId.substring(firstUnderscore + 1)
}

/**
 * Parse T2C trip_id components
 * Format: "prefix_serviceCode_line_variant_time"
 * Example: "1306_1000002_B_5_144800" -> { serviceCode: "1000002", line: "B", time: "144800" }
 */
export interface TripIdComponents {
  serviceCode: string
  line: string
  time: string
  timeSeconds: number
}

export function parseTripIdComponents(tripId: string): TripIdComponents | null {
  // Format: prefix_serviceCode_line_variant_time
  // The time is always at the end (6 digits: HHMMSS)
  const match = tripId.match(/^\d+_(\d+)_([^_]+)_[^_]+_(\d{6})$/)
  if (!match) return null

  const [, serviceCode, line, time] = match
  const hours = parseInt(time.substring(0, 2), 10)
  const minutes = parseInt(time.substring(2, 4), 10)
  const seconds = parseInt(time.substring(4, 6), 10)
  const timeSeconds = hours * 3600 + minutes * 60 + seconds

  return { serviceCode, line, time, timeSeconds }
}

/**
 * Create a fuzzy lookup key from trip_id components
 * Key format: "serviceCode_line_timeWindow"
 * timeWindow is time rounded to 5-minute intervals
 */
export function createFuzzyKey(tripId: string): string | null {
  const components = parseTripIdComponents(tripId)
  if (!components) return null

  // Round time to 5-minute window
  const timeWindow = Math.floor(components.timeSeconds / 300) * 300

  return `${components.serviceCode}_${components.line}_${timeWindow}`
}

/**
 * RT Status for the /rt/status endpoint
 */
export interface RtStatusResponse {
  enabled: boolean
  source: RtSourceType
  url?: string
  path?: string
  fetchedAt?: number
  ageSeconds?: number
  entityCount?: number
  tripUpdatesCount?: number
  lastError?: string
}

// Module-level state
let rtCache: RtCache | null = null
let pollingInterval: ReturnType<typeof setInterval> | null = null
let lastError: string | null = null

/**
 * Parse headers from JSON string (for URL mode)
 */
function parseHeaders(): Record<string, string> {
  if (!GTFS_RT_HEADERS_JSON) {
    return {}
  }
  try {
    return JSON.parse(GTFS_RT_HEADERS_JSON) as Record<string, string>
  } catch (error) {
    console.error('[RT] Failed to parse GTFS_RT_HEADERS_JSON:', error)
    return {}
  }
}

/**
 * Load RT buffer from URL or file
 */
async function loadRtBuffer(): Promise<Uint8Array | null> {
  if (RT_SOURCE_TYPE === 'url' && GTFS_RT_URL) {
    const headers = parseHeaders()
    const response = await fetch(GTFS_RT_URL, {
      headers: {
        ...headers,
        'Accept': 'application/x-protobuf',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    return new Uint8Array(buffer)
  }

  if (RT_SOURCE_TYPE === 'file' && GTFS_RT_PATH) {
    if (!existsSync(GTFS_RT_PATH)) {
      throw new Error(`File not found: ${GTFS_RT_PATH}`)
    }

    const buffer = await readFile(GTFS_RT_PATH)
    return new Uint8Array(buffer)
  }

  return null
}

/**
 * Fetch and parse GTFS-RT feed from configured source
 */
async function fetchRtFeed(): Promise<void> {
  if (!RT_SOURCE_TYPE) {
    return
  }

  try {
    const buffer = await loadRtBuffer()
    if (!buffer) {
      return
    }

    const feed = transit_realtime.FeedMessage.decode(buffer)

    // Build the indexes
    const data = new Map<string, TripUpdateIndex>()
    const dataByNormalizedId = new Map<string, TripUpdateIndex>()
    const dataByFuzzyKey = new Map<string, TripUpdateIndex>()
    const dataByRouteStopTime = new Map<string, StopTimeUpdate>()
    const dataByRouteStop = new Map<string, StopTimeUpdateWithEpoch[]>()
    let tripUpdatesCount = 0

    for (const entity of feed.entity) {
      if (!entity.tripUpdate) continue

      const tripUpdate = entity.tripUpdate
      const tripId = tripUpdate.trip?.tripId
      if (!tripId) continue

      tripUpdatesCount++

      const index: TripUpdateIndex = {
        tripId,
        routeId: tripUpdate.trip?.routeId ?? undefined,
        directionId: tripUpdate.trip?.directionId ?? undefined,
        delay: tripUpdate.delay ?? undefined,
        stopTimesByStopId: new Map(),
        stopTimesBySequence: new Map(),
      }

      // Process stop time updates
      if (tripUpdate.stopTimeUpdate) {
        for (const stu of tripUpdate.stopTimeUpdate) {
          const update: StopTimeUpdate = {}

          if (stu.arrival) {
            if (stu.arrival.time != null) {
              // time is Long, convert to number
              update.arrivalTime = typeof stu.arrival.time === 'number'
                ? stu.arrival.time
                : Number(stu.arrival.time)
            }
            if (stu.arrival.delay != null) {
              update.arrivalDelay = stu.arrival.delay
            }
          }

          if (stu.departure) {
            if (stu.departure.time != null) {
              update.departureTime = typeof stu.departure.time === 'number'
                ? stu.departure.time
                : Number(stu.departure.time)
            }
            if (stu.departure.delay != null) {
              update.departureDelay = stu.departure.delay
            }
          }

          // Index by stop_id
          if (stu.stopId) {
            index.stopTimesByStopId.set(stu.stopId, update)

            // Also index by route+stop+time for direct matching
            const routeId = tripUpdate.trip?.routeId
            if (routeId && update.departureTime != null) {
              const key = createRouteStopTimeKey(routeId, stu.stopId, update.departureTime)
              dataByRouteStopTime.set(key, update)

              // Also index by route+stop for proximity matching
              const routeStopKey = createRouteStopKey(routeId, stu.stopId)
              const existing = dataByRouteStop.get(routeStopKey) ?? []
              existing.push({ ...update, departureEpoch: update.departureTime })
              dataByRouteStop.set(routeStopKey, existing)
            }
          }

          // Index by stop_sequence
          if (stu.stopSequence != null) {
            index.stopTimesBySequence.set(stu.stopSequence, update)
          }
        }
      }

      data.set(tripId, index)
      // Also index by normalized trip_id for fuzzy matching
      dataByNormalizedId.set(normalizeTripId(tripId), index)
      // Also index by fuzzy key for approximate time matching
      const fuzzyKey = createFuzzyKey(tripId)
      if (fuzzyKey) {
        dataByFuzzyKey.set(fuzzyKey, index)
      }
    }

    // Sort dataByRouteStop arrays by departure time
    for (const [_key, updates] of dataByRouteStop) {
      updates.sort((a, b) => a.departureEpoch - b.departureEpoch)
    }

    // Update cache
    rtCache = {
      fetchedAt: Date.now(),
      entityCount: feed.entity.length,
      tripUpdatesCount,
      data,
      dataByNormalizedId,
      dataByFuzzyKey,
      dataByRouteStopTime,
      dataByRouteStop,
    }

    // Clear any previous error on success
    lastError = null

    const sourceInfo = RT_SOURCE_TYPE === 'url' ? GTFS_RT_URL : GTFS_RT_PATH
    console.log(`[RT] Updated cache: ${tripUpdatesCount} trip updates from ${feed.entity.length} entities (${RT_SOURCE_TYPE}: ${sourceInfo})`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    lastError = message
    console.error(`[RT] Error loading/parsing GTFS-RT (${RT_SOURCE_TYPE}):`, message)
    // Keep previous cache on error
  }
}

/**
 * Start RT polling if GTFS_RT_URL or GTFS_RT_PATH is configured
 */
export function startRtPolling(): void {
  if (!RT_SOURCE_TYPE) {
    console.log('[RT] Neither GTFS_RT_URL nor GTFS_RT_PATH configured, RT disabled')
    return
  }

  const sourceInfo = RT_SOURCE_TYPE === 'url' ? GTFS_RT_URL : GTFS_RT_PATH
  console.log(`[RT] Starting polling every ${GTFS_RT_POLL_SECONDS}s from ${RT_SOURCE_TYPE}: ${sourceInfo}`)

  // Initial fetch
  fetchRtFeed()

  // Start polling
  pollingInterval = setInterval(() => {
    fetchRtFeed()
  }, GTFS_RT_POLL_SECONDS * 1000)
}

/**
 * Stop RT polling
 */
export function stopRtPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval)
    pollingInterval = null
    console.log('[RT] Polling stopped')
  }
}

/**
 * Get the current RT cache
 */
export function getRtCache(): RtCache | null {
  return rtCache
}

/**
 * Check if RT is enabled
 */
export function isRtEnabled(): boolean {
  return RT_SOURCE_TYPE !== null
}

/**
 * Get RT status for the /rt/status endpoint
 */
export function getRtStatus(): RtStatusResponse {
  if (!RT_SOURCE_TYPE) {
    return {
      enabled: false,
      source: null,
    }
  }

  const baseStatus: RtStatusResponse = {
    enabled: true,
    source: RT_SOURCE_TYPE,
    ...(RT_SOURCE_TYPE === 'url' && GTFS_RT_URL && { url: GTFS_RT_URL }),
    ...(RT_SOURCE_TYPE === 'file' && GTFS_RT_PATH && { path: GTFS_RT_PATH }),
    ...(lastError && { lastError }),
  }

  if (!rtCache) {
    return {
      ...baseStatus,
      fetchedAt: undefined,
      ageSeconds: undefined,
      entityCount: 0,
      tripUpdatesCount: 0,
    }
  }

  return {
    ...baseStatus,
    fetchedAt: rtCache.fetchedAt,
    ageSeconds: Math.round((Date.now() - rtCache.fetchedAt) / 1000),
    entityCount: rtCache.entityCount,
    tripUpdatesCount: rtCache.tripUpdatesCount,
  }
}
