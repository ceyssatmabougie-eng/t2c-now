/**
 * Script de debug pour analyser la correspondance GTFS-RT
 */
import { openDb } from '../src/db.js'
import GtfsRealtimeBindings from 'gtfs-realtime-bindings'

const { transit_realtime } = GtfsRealtimeBindings

const GTFS_RT_URL = 'https://proxy.transport.data.gouv.fr/resource/t2c-clermont-gtfs-rt-trip-update'

async function main() {
  console.log('=== Debug GTFS-RT ===\n')

  // 1. Fetch RT data
  console.log('Fetching GTFS-RT from:', GTFS_RT_URL)
  const response = await fetch(GTFS_RT_URL, {
    headers: { 'Accept': 'application/x-protobuf' }
  })

  if (!response.ok) {
    console.error('Failed to fetch:', response.status, response.statusText)
    return
  }

  const buffer = await response.arrayBuffer()
  const feed = transit_realtime.FeedMessage.decode(new Uint8Array(buffer))

  console.log(`\nRT Feed: ${feed.entity.length} entities`)

  // Extract trip IDs from RT
  const rtTripIds = new Set<string>()
  for (const entity of feed.entity) {
    if (entity.tripUpdate?.trip?.tripId) {
      rtTripIds.add(entity.tripUpdate.trip.tripId)
    }
  }
  console.log(`RT Trip IDs count: ${rtTripIds.size}`)

  // Show sample RT trip IDs
  const sampleRtTrips = Array.from(rtTripIds).slice(0, 10)
  console.log('\nSample RT trip_ids:')
  sampleRtTrips.forEach(id => console.log(`  - "${id}"`))

  // 2. Get DB trip IDs
  const db = openDb()

  // Get sample trip IDs from DB
  const dbTrips = db.prepare(`
    SELECT DISTINCT t.trip_id, r.route_short_name as line, t.trip_headsign
    FROM trips t
    JOIN routes r ON r.route_id = t.route_id
    WHERE r.route_short_name = 'B'
    LIMIT 20
  `).all() as Array<{ trip_id: string; line: string; trip_headsign: string }>

  console.log('\n\nSample DB trip_ids for line B:')
  dbTrips.forEach(t => console.log(`  - "${t.trip_id}" -> ${t.trip_headsign}`))

  // 3. Check for matches
  console.log('\n\n=== Matching Analysis ===')

  let matchCount = 0
  for (const dbTrip of dbTrips) {
    if (rtTripIds.has(dbTrip.trip_id)) {
      matchCount++
      console.log(`MATCH: "${dbTrip.trip_id}"`)
    }
  }

  console.log(`\nMatches found: ${matchCount}/${dbTrips.length}`)

  // 4. Analyze trip_id format differences
  console.log('\n\n=== Format Analysis ===')

  const rtSample = Array.from(rtTripIds)[0]
  const dbSample = dbTrips[0]?.trip_id

  console.log('RT trip_id format example:', rtSample)
  console.log('DB trip_id format example:', dbSample)

  // Check if there's a pattern (e.g., prefix/suffix differences)
  if (rtSample && dbSample) {
    // Check for common substrings
    const rtParts = rtSample.split(/[-_:]/)
    const dbParts = dbSample.split(/[-_:]/)

    console.log('\nRT parts:', rtParts)
    console.log('DB parts:', dbParts)
  }

  // 5. Check all trips in DB that might match
  const allDbTripIds = db.prepare('SELECT trip_id FROM trips LIMIT 1000').all() as Array<{ trip_id: string }>
  const dbTripIdSet = new Set(allDbTripIds.map(t => t.trip_id))

  let totalMatches = 0
  for (const rtId of rtTripIds) {
    if (dbTripIdSet.has(rtId)) {
      totalMatches++
    }
  }

  console.log(`\n\nTotal matches across all checked trips: ${totalMatches}`)
  console.log(`RT trips: ${rtTripIds.size}`)
  console.log(`DB trips checked: ${dbTripIdSet.size}`)

  db.close()
}

main().catch(console.error)
