import type { Handler } from '@netlify/functions'
import GtfsRealtimeBindings from 'gtfs-realtime-bindings'

const GTFS_RT_URL = 'https://proxy.transport.data.gouv.fr/resource/t2c-clermont-gtfs-rt-trip-update'

interface TripUpdate {
  tripId: string
  routeId?: string
  stopTimeUpdates: Array<{
    stopId: string
    arrival?: { delay: number; time?: number }
    departure?: { delay: number; time?: number }
  }>
}

export const handler: Handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 's-maxage=30, stale-while-revalidate=60',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  try {
    const response = await fetch(GTFS_RT_URL)

    if (!response.ok) {
      throw new Error(`GTFS-RT fetch failed: ${response.status}`)
    }

    const buffer = await response.arrayBuffer()
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer)
    )

    const tripUpdates: TripUpdate[] = []

    for (const entity of feed.entity) {
      if (entity.tripUpdate) {
        const tu = entity.tripUpdate
        const stopTimeUpdates = (tu.stopTimeUpdate || []).map(stu => ({
          stopId: stu.stopId || '',
          arrival: stu.arrival ? {
            delay: stu.arrival.delay || 0,
            time: stu.arrival.time ? Number(stu.arrival.time) : undefined
          } : undefined,
          departure: stu.departure ? {
            delay: stu.departure.delay || 0,
            time: stu.departure.time ? Number(stu.departure.time) : undefined
          } : undefined
        }))

        tripUpdates.push({
          tripId: tu.trip?.tripId || '',
          routeId: tu.trip?.routeId || undefined,
          stopTimeUpdates
        })
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        timestamp: feed.header?.timestamp ? Number(feed.header.timestamp) : Date.now() / 1000,
        tripUpdates
      })
    }
  } catch (error) {
    console.error('GTFS-RT error:', error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to fetch GTFS-RT data',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}
