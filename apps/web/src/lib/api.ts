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

  // Get directions for each stop
  const stopIds = stopsWithDistance.map(s => s.id)

  const { data: directions } = await supabase
    .from('stop_times')
    .select(`
      stop_id,
      trips!inner(
        trip_headsign,
        routes!inner(route_short_name, route_long_name)
      )
    `)
    .in('stop_id', stopIds)
    .not('trips.trip_headsign', 'is', null)
    .limit(1000)

  // Build directions map
  const directionsMap = new Map<string, StopDirection[]>()

  if (directions) {
    for (const row of directions) {
      const trip = row.trips as { trip_headsign: string; routes: { route_short_name: string | null; route_long_name: string | null } }
      if (!trip?.trip_headsign) continue

      const line = trip.routes?.route_short_name || trip.routes?.route_long_name || ''
      const headsign = trip.trip_headsign

      const existing = directionsMap.get(row.stop_id) || []
      const key = `${line}|${headsign}`
      if (!existing.some(d => `${d.line}|${d.headsign}` === key)) {
        existing.push({ line, headsign })
      }
      directionsMap.set(row.stop_id, existing)
    }
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

  // Get directions for these stops
  const { data, error } = await supabase
    .from('stop_times')
    .select(`
      trips!inner(
        route_id,
        direction_id,
        trip_headsign,
        routes!inner(route_short_name, route_long_name)
      )
    `)
    .in('stop_id', stopIds)
    .not('trips.trip_headsign', 'is', null)
    .limit(500)

  if (error) throw new Error(error.message)
  if (!data) return []

  // Deduplicate directions
  const seen = new Set<string>()
  const directions: DirectionOption[] = []

  for (const row of data) {
    const trip = row.trips as { route_id: string; direction_id: number | null; trip_headsign: string; routes: { route_short_name: string | null; route_long_name: string | null } }
    if (!trip?.trip_headsign) continue

    const line = trip.routes?.route_short_name || trip.routes?.route_long_name || ''
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

  // Build query for stop_times
  let query = supabase
    .from('stop_times')
    .select(`
      departure_time,
      trips!inner(
        trip_id,
        service_id,
        route_id,
        direction_id,
        trip_headsign
      )
    `)
    .in('stop_id', stopIds)
    .eq('trips.route_id', routeId)
    .eq('trips.trip_headsign', headsign)
    .order('departure_time')
    .limit(200)

  if (directionIdNum !== null) {
    query = query.eq('trips.direction_id', directionIdNum)
  }

  const { data: stopTimes, error } = await query

  if (error) throw new Error(error.message)
  if (!stopTimes) return { stopId, directionId, departures: [] }

  // Filter by active service IDs and future departures
  const departures: Departure[] = []

  for (const st of stopTimes) {
    const trip = st.trips as { trip_id: string; service_id: string; route_id: string; direction_id: number | null; trip_headsign: string }
    if (!activeServiceIds.has(trip.service_id)) continue

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
