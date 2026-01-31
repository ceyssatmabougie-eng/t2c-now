import { supabase } from './supabase'

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

// Haversine distance calculation
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000 // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export async function fetchStopsNear(
  lat: number,
  lon: number,
  radius: number = 800
): Promise<StopNear[]> {
  // Get all stops
  const { data: stops, error } = await supabase
    .from('stops')
    .select('stop_id, stop_name, stop_lat, stop_lon, location_type')

  if (error) throw new Error(error.message)
  if (!stops) return []

  // Filter platforms only and calculate distances
  const stopsWithDistance = stops
    .filter(stop => stop.location_type === 0 || stop.location_type === null)
    .map(stop => ({
      id: stop.stop_id,
      name: stop.stop_name,
      lat: stop.stop_lat,
      lon: stop.stop_lon,
      distance: haversineDistance(lat, lon, stop.stop_lat, stop.stop_lon),
    }))
    .filter(stop => stop.distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 20)

  if (stopsWithDistance.length === 0) {
    return []
  }

  // Get directions for each stop using separate queries
  const stopIds = stopsWithDistance.map(s => s.id)

  // Get stop_times for these stops
  const { data: stopTimesData } = await supabase
    .from('stop_times')
    .select('stop_id, trip_id')
    .in('stop_id', stopIds)
    .limit(500)

  if (!stopTimesData || stopTimesData.length === 0) {
    return stopsWithDistance.map(stop => ({
      id: stop.id,
      name: stop.name,
      distance: Math.round(stop.distance),
      directions: [],
    }))
  }

  // Get unique trip IDs - limit to avoid URL too long
  const tripIds = [...new Set(stopTimesData.map(st => st.trip_id))].slice(0, 50)

  // Get trips info
  const { data: tripsData } = await supabase
    .from('trips')
    .select('trip_id, route_id, trip_headsign')
    .in('trip_id', tripIds)
    .not('trip_headsign', 'is', null)

  if (!tripsData) {
    return stopsWithDistance.map(stop => ({
      id: stop.id,
      name: stop.name,
      distance: Math.round(stop.distance),
      directions: [],
    }))
  }

  // Get routes info
  const routeIds = [...new Set(tripsData.map(t => t.route_id))]
  const { data: routesData } = await supabase
    .from('routes')
    .select('route_id, route_short_name, route_long_name')
    .in('route_id', routeIds)

  // Build lookup maps
  const tripsMap = new Map(tripsData.map(t => [t.trip_id, t]))
  const routesMap = new Map(routesData?.map(r => [r.route_id, r]) || [])

  // Build directions map
  const directionsMap = new Map<string, StopDirection[]>()

  for (const st of stopTimesData) {
    const trip = tripsMap.get(st.trip_id)
    if (!trip?.trip_headsign) continue

    const route = routesMap.get(trip.route_id)
    const line = route?.route_short_name || route?.route_long_name || ''
    const headsign = trip.trip_headsign

    const existing = directionsMap.get(st.stop_id) || []
    const key = `${line}|${headsign}`
    if (!existing.some(d => `${d.line}|${d.headsign}` === key)) {
      existing.push({ line, headsign })
    }
    directionsMap.set(st.stop_id, existing)
  }

  return stopsWithDistance.map(stop => ({
    id: stop.id,
    name: stop.name,
    distance: Math.round(stop.distance),
    directions: (directionsMap.get(stop.id) || [])
      .sort((a, b) => a.line.localeCompare(b.line, 'fr', { numeric: true }))
      .slice(0, 10),
  }))
}

export async function fetchStopsSearch(
  q: string,
  limit: number = 10
): Promise<StopSearchResult[]> {
  const searchTerm = q.trim()

  const { data: stops, error } = await supabase
    .from('stops')
    .select('stop_id, stop_name, location_type, parent_station')
    .ilike('stop_name', `%${searchTerm}%`)
    .limit(limit * 3)

  if (error) throw new Error(error.message)
  if (!stops) return []

  // Deduplicate and prefer parent stations
  const seen = new Set<string>()
  const results: StopSearchResult[] = []

  for (const stop of stops) {
    if (stop.location_type === 1) {
      if (!seen.has(stop.stop_id)) {
        seen.add(stop.stop_id)
        results.push({
          id: stop.stop_id,
          name: stop.stop_name,
          kind: 'station',
        })
      }
    } else if (stop.parent_station) {
      if (!seen.has(stop.parent_station)) {
        seen.add(stop.parent_station)
        const { data: parent } = await supabase
          .from('stops')
          .select('stop_id, stop_name')
          .eq('stop_id', stop.parent_station)
          .single()

        if (parent) {
          results.push({
            id: parent.stop_id,
            name: parent.stop_name,
            kind: 'station',
          })
        }
      }
    } else {
      if (!seen.has(stop.stop_id)) {
        seen.add(stop.stop_id)
        results.push({
          id: stop.stop_id,
          name: stop.stop_name,
          kind: 'platform',
        })
      }
    }

    if (results.length >= limit) break
  }

  return results.slice(0, limit)
}

export async function fetchDirections(stopId: string): Promise<DirectionOption[]> {
  // First resolve child stops if this is a parent station
  const { data: childStops } = await supabase
    .from('stops')
    .select('stop_id')
    .eq('parent_station', stopId)

  const stopIds = childStops?.length
    ? childStops.map(s => s.stop_id)
    : [stopId]

  // Get stop_times for these stops
  const { data: stopTimesData, error } = await supabase
    .from('stop_times')
    .select('trip_id')
    .in('stop_id', stopIds)
    .limit(2000)

  if (error) throw new Error(error.message)
  if (!stopTimesData || stopTimesData.length === 0) return []

  // Get unique trip IDs
  const allTripIds = [...new Set(stopTimesData.map(st => st.trip_id))]

  // Fetch trips in batches of 30 to avoid URL too long
  const BATCH_SIZE = 30
  const tripsWithHeadsign: Array<{trip_id: string; route_id: string; direction_id: number | null; trip_headsign: string}> = []

  for (let i = 0; i < allTripIds.length && tripsWithHeadsign.length < 100; i += BATCH_SIZE) {
    const batch = allTripIds.slice(i, i + BATCH_SIZE)
    const { data: batchTrips } = await supabase
      .from('trips')
      .select('trip_id, route_id, direction_id, trip_headsign')
      .in('trip_id', batch)

    if (batchTrips) {
      for (const trip of batchTrips) {
        if (trip.trip_headsign) {
          tripsWithHeadsign.push(trip as typeof tripsWithHeadsign[0])
        }
      }
    }
  }

  if (tripsWithHeadsign.length === 0) return []

  // Get routes
  const routeIds = [...new Set(tripsWithHeadsign.map(t => t.route_id))]
  const { data: routesData } = await supabase
    .from('routes')
    .select('route_id, route_short_name, route_long_name')
    .in('route_id', routeIds)

  const routesMap = new Map(routesData?.map(r => [r.route_id, r]) || [])

  // Deduplicate directions
  const seen = new Set<string>()
  const directions: DirectionOption[] = []

  for (const trip of tripsWithHeadsign) {
    if (!trip.trip_headsign) continue

    const route = routesMap.get(trip.route_id)
    const line = route?.route_short_name || route?.route_long_name || ''
    const key = `${trip.route_id}|${trip.direction_id ?? ''}|${trip.trip_headsign}`

    if (!seen.has(key)) {
      seen.add(key)
      directions.push({
        id: key,
        headsign: trip.trip_headsign,
        line,
      })
    }
  }

  // Sort by line then headsign
  directions.sort((a, b) => {
    const lineCompare = a.line.localeCompare(b.line, 'fr', { numeric: true })
    if (lineCompare !== 0) return lineCompare
    return a.headsign.localeCompare(b.headsign, 'fr')
  })

  return directions.slice(0, 30)
}

function getWeekday(date: Date): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  return days[date.getDay()]
}

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function timeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':')
  const hours = parseInt(parts[0], 10)
  const minutes = parseInt(parts[1], 10)
  const seconds = parseInt(parts[2] ?? '0', 10)
  return hours * 3600 + minutes * 60 + seconds
}

export async function fetchNextDepartures(
  stopId: string,
  directionId: string,
  limit: number = 3
): Promise<NextDeparturesResponse> {
  // Parse directionId: format is "route_id|direction_id|headsign"
  const parts = directionId.split('|')
  if (parts.length < 3) {
    throw new Error('Format de direction invalide')
  }

  const [routeId, dirId, ...headsignParts] = parts
  const headsign = headsignParts.join('|') // In case headsign contains |
  const directionIdNum = dirId !== '' ? parseInt(dirId, 10) : null

  // Resolve child stops if this is a parent station
  const { data: childStops } = await supabase
    .from('stops')
    .select('stop_id')
    .eq('parent_station', stopId)

  const stopIds = childStops?.length
    ? childStops.map(s => s.stop_id)
    : [stopId]

  // Get current time info
  const now = new Date()
  const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()

  // Service day (starts at 03:00)
  const serviceDayStart = new Date(now)
  if (now.getHours() < 3) {
    serviceDayStart.setDate(serviceDayStart.getDate() - 1)
  }
  serviceDayStart.setHours(0, 0, 0, 0)

  const serviceDate = formatDate(serviceDayStart)
  const weekday = getWeekday(serviceDayStart)

  // Get active service IDs
  const { data: calendarData } = await supabase
    .from('calendar')
    .select('service_id')
    .eq(weekday, 1)
    .lte('start_date', serviceDate)
    .gte('end_date', serviceDate)

  const activeServiceIds = new Set(calendarData?.map(c => c.service_id) || [])

  // Apply calendar_dates exceptions
  const { data: exceptions } = await supabase
    .from('calendar_dates')
    .select('service_id, exception_type')
    .eq('date', serviceDate)

  if (exceptions) {
    for (const exc of exceptions) {
      if (exc.exception_type === 1) {
        activeServiceIds.add(exc.service_id)
      } else if (exc.exception_type === 2) {
        activeServiceIds.delete(exc.service_id)
      }
    }
  }

  if (activeServiceIds.size === 0) {
    return { stopId, directionId, departures: [] }
  }

  // Get trips matching our criteria
  let tripsQuery = supabase
    .from('trips')
    .select('trip_id, service_id')
    .eq('route_id', routeId)
    .eq('trip_headsign', headsign)
    .in('service_id', Array.from(activeServiceIds))

  if (directionIdNum !== null) {
    tripsQuery = tripsQuery.eq('direction_id', directionIdNum)
  }

  const { data: tripsData, error: tripsError } = await tripsQuery

  if (tripsError) throw new Error(tripsError.message)
  if (!tripsData || tripsData.length === 0) {
    return { stopId, directionId, departures: [] }
  }

  const tripIds = tripsData.map(t => t.trip_id)

  // Get stop_times for these trips at our stops
  const { data: stopTimes, error } = await supabase
    .from('stop_times')
    .select('departure_time, trip_id')
    .in('stop_id', stopIds)
    .in('trip_id', tripIds)
    .order('departure_time')
    .limit(200)

  if (error) throw new Error(error.message)
  if (!stopTimes) return { stopId, directionId, departures: [] }

  // Filter future departures
  const departures: Departure[] = []

  for (const st of stopTimes) {
    const depSeconds = timeToSeconds(st.departure_time)
    if (depSeconds <= nowSeconds) continue

    const deltaMinutes = Math.round((depSeconds - nowSeconds) / 60)
    if (deltaMinutes < 0) continue

    const departureDate = new Date(now)
    departureDate.setHours(0, 0, 0, 0)
    departureDate.setSeconds(depSeconds)

    departures.push({
      minutes: deltaMinutes,
      time: formatTime(departureDate),
      realtime: false,
    })

    if (departures.length >= limit * 2) break
  }

  departures.sort((a, b) => a.minutes - b.minutes)

  return {
    stopId,
    directionId,
    departures: departures.slice(0, limit),
  }
}
