/**
 * Import GTFS data to Supabase
 * Downloads GTFS from Open Data and imports to Supabase PostgreSQL
 */

import { createClient } from '@supabase/supabase-js'
import { createReadStream, existsSync, mkdirSync, createWriteStream } from 'fs'
import { createInterface } from 'readline'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { pipeline } from 'stream/promises'
import { createUnzip } from 'zlib'
import { Extract } from 'unzip-stream'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Supabase config
const SUPABASE_URL = 'https://mtiyxgopscxqzpfsvuun.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || ''

if (!SUPABASE_SERVICE_KEY) {
  console.error('Error: SUPABASE_SERVICE_KEY environment variable is required')
  console.error('Get it from: https://supabase.com/dashboard/project/mtiyxgopscxqzpfsvuun/settings/api')
  console.error('Look for "service_role" key (NOT anon key)')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const GTFS_URL = 'https://opendata.clermontmetropole.eu/api/v2/catalog/datasets/gtfs-smtc/alternative_exports/gtfs'
const DATA_DIR = join(__dirname, '../data')
const GTFS_ZIP = join(DATA_DIR, 'gtfs.zip')
const GTFS_DIR = join(DATA_DIR, 'gtfs')

async function downloadGtfs(): Promise<void> {
  console.log('[import] Downloading GTFS data...')

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }

  const response = await fetch(GTFS_URL)
  if (!response.ok) {
    throw new Error(`Failed to download GTFS: ${response.status}`)
  }

  const fileStream = createWriteStream(GTFS_ZIP)
  // @ts-ignore
  await pipeline(response.body, fileStream)

  console.log('[import] Download complete. Extracting...')

  // Extract ZIP
  if (!existsSync(GTFS_DIR)) {
    mkdirSync(GTFS_DIR, { recursive: true })
  }

  await new Promise<void>((resolve, reject) => {
    createReadStream(GTFS_ZIP)
      .pipe(Extract({ path: GTFS_DIR }))
      .on('close', resolve)
      .on('error', reject)
  })

  console.log('[import] Extraction complete.')
}

async function parseCSV(filename: string): Promise<Record<string, string>[]> {
  const filepath = join(GTFS_DIR, filename)
  if (!existsSync(filepath)) {
    console.log(`[import] File ${filename} not found, skipping`)
    return []
  }

  const rows: Record<string, string>[] = []
  let headers: string[] = []

  const rl = createInterface({
    input: createReadStream(filepath, 'utf-8'),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    if (!headers.length) {
      headers = line.split(',').map(h => h.trim().replace(/"/g, ''))
      continue
    }

    const values = line.split(',').map(v => v.trim().replace(/"/g, ''))
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = values[i] || ''
    })
    rows.push(row)
  }

  return rows
}

async function importStops(): Promise<void> {
  console.log('[import] Importing stops...')
  const rows = await parseCSV('stops.txt')

  // Clear existing data
  await supabase.from('stops').delete().neq('stop_id', '')

  // Insert in batches
  const batchSize = 500
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).map(row => ({
      stop_id: row.stop_id,
      stop_name: row.stop_name,
      stop_lat: parseFloat(row.stop_lat),
      stop_lon: parseFloat(row.stop_lon),
      location_type: parseInt(row.location_type || '0'),
      parent_station: row.parent_station || null,
    }))

    const { error } = await supabase.from('stops').insert(batch)
    if (error) {
      console.error(`[import] Error inserting stops batch: ${error.message}`)
    }
  }

  console.log(`[import] Imported ${rows.length} stops`)
}

async function importRoutes(): Promise<void> {
  console.log('[import] Importing routes...')
  const rows = await parseCSV('routes.txt')

  await supabase.from('routes').delete().neq('route_id', '')

  const batchSize = 500
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).map(row => ({
      route_id: row.route_id,
      route_short_name: row.route_short_name || null,
      route_long_name: row.route_long_name || null,
      route_type: parseInt(row.route_type || '3'),
    }))

    const { error } = await supabase.from('routes').insert(batch)
    if (error) {
      console.error(`[import] Error inserting routes batch: ${error.message}`)
    }
  }

  console.log(`[import] Imported ${rows.length} routes`)
}

async function importTrips(): Promise<void> {
  console.log('[import] Importing trips...')
  const rows = await parseCSV('trips.txt')

  await supabase.from('trips').delete().neq('trip_id', '')

  const batchSize = 500
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).map(row => ({
      trip_id: row.trip_id,
      route_id: row.route_id,
      service_id: row.service_id,
      trip_headsign: row.trip_headsign || null,
      direction_id: row.direction_id ? parseInt(row.direction_id) : null,
    }))

    const { error } = await supabase.from('trips').insert(batch)
    if (error) {
      console.error(`[import] Error inserting trips batch: ${error.message}`)
    }

    if (i % 5000 === 0) {
      console.log(`[import] Trips progress: ${i}/${rows.length}`)
    }
  }

  console.log(`[import] Imported ${rows.length} trips`)
}

async function importStopTimes(): Promise<void> {
  console.log('[import] Importing stop_times (this may take a while)...')
  const rows = await parseCSV('stop_times.txt')

  await supabase.from('stop_times').delete().neq('trip_id', '')

  const batchSize = 1000
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).map(row => ({
      trip_id: row.trip_id,
      stop_id: row.stop_id,
      arrival_time: row.arrival_time || null,
      departure_time: row.departure_time,
      stop_sequence: parseInt(row.stop_sequence),
    }))

    const { error } = await supabase.from('stop_times').insert(batch)
    if (error) {
      console.error(`[import] Error inserting stop_times batch at ${i}: ${error.message}`)
    }

    if (i % 10000 === 0) {
      console.log(`[import] Stop times progress: ${i}/${rows.length}`)
    }
  }

  console.log(`[import] Imported ${rows.length} stop_times`)
}

async function importCalendar(): Promise<void> {
  console.log('[import] Importing calendar...')
  const rows = await parseCSV('calendar.txt')

  await supabase.from('calendar').delete().neq('service_id', '')

  const batch = rows.map(row => ({
    service_id: row.service_id,
    monday: parseInt(row.monday),
    tuesday: parseInt(row.tuesday),
    wednesday: parseInt(row.wednesday),
    thursday: parseInt(row.thursday),
    friday: parseInt(row.friday),
    saturday: parseInt(row.saturday),
    sunday: parseInt(row.sunday),
    start_date: row.start_date,
    end_date: row.end_date,
  }))

  const { error } = await supabase.from('calendar').insert(batch)
  if (error) {
    console.error(`[import] Error inserting calendar: ${error.message}`)
  }

  console.log(`[import] Imported ${rows.length} calendar entries`)
}

async function importCalendarDates(): Promise<void> {
  console.log('[import] Importing calendar_dates...')
  const rows = await parseCSV('calendar_dates.txt')

  await supabase.from('calendar_dates').delete().neq('service_id', '')

  const batchSize = 500
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).map(row => ({
      service_id: row.service_id,
      date: row.date,
      exception_type: parseInt(row.exception_type),
    }))

    const { error } = await supabase.from('calendar_dates').insert(batch)
    if (error) {
      console.error(`[import] Error inserting calendar_dates batch: ${error.message}`)
    }
  }

  console.log(`[import] Imported ${rows.length} calendar_dates`)
}

async function main() {
  console.log('[import] Starting GTFS import to Supabase...')

  try {
    await downloadGtfs()
    await importStops()
    await importRoutes()
    await importTrips()
    await importStopTimes()
    await importCalendar()
    await importCalendarDates()

    console.log('[import] Import complete!')
  } catch (error) {
    console.error('[import] Import failed:', error)
    process.exit(1)
  }
}

main()
