import Database from 'better-sqlite3'
import { createReadStream, existsSync, unlinkSync } from 'fs'
import { createInterface } from 'readline'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const GTFS_DIR = join(__dirname, '../../../data/gtfs')
const DB_PATH = join(__dirname, '../../../data/gtfs.sqlite')

const REQUIRED_FILES = ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt']
const OPTIONAL_FILES = ['calendar.txt', 'calendar_dates.txt']

function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  fields.push(current.trim())
  return fields
}

async function* readCSV(
  filePath: string
): AsyncGenerator<{ headers: string[]; row: Record<string, string> }> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  let headers: string[] = []
  let isFirstLine = true

  for await (const line of rl) {
    if (!line.trim()) continue

    if (isFirstLine) {
      headers = parseCSVLine(line).map((h) => h.replace(/^\uFEFF/, ''))
      isFirstLine = false
      continue
    }

    const values = parseCSVLine(line)
    const row: Record<string, string> = {}

    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = values[i] ?? ''
    }

    yield { headers, row }
  }
}

function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE stops (
      stop_id TEXT PRIMARY KEY,
      stop_name TEXT,
      stop_lat REAL,
      stop_lon REAL,
      location_type INTEGER,
      parent_station TEXT,
      platform_code TEXT
    );

    CREATE TABLE routes (
      route_id TEXT PRIMARY KEY,
      route_short_name TEXT,
      route_long_name TEXT
    );

    CREATE TABLE trips (
      trip_id TEXT PRIMARY KEY,
      route_id TEXT,
      service_id TEXT,
      trip_headsign TEXT,
      direction_id INTEGER
    );

    CREATE TABLE stop_times (
      trip_id TEXT,
      arrival_time TEXT,
      departure_time TEXT,
      stop_id TEXT,
      stop_sequence INTEGER
    );

    CREATE TABLE calendar (
      service_id TEXT PRIMARY KEY,
      monday INTEGER,
      tuesday INTEGER,
      wednesday INTEGER,
      thursday INTEGER,
      friday INTEGER,
      saturday INTEGER,
      sunday INTEGER,
      start_date TEXT,
      end_date TEXT
    );

    CREATE TABLE calendar_dates (
      service_id TEXT,
      date TEXT,
      exception_type INTEGER
    );
  `)
}

function createIndexes(db: Database.Database): void {
  console.log('Creation des index...')

  db.exec(`
    CREATE INDEX idx_stop_times_stop_id ON stop_times(stop_id);
    CREATE INDEX idx_stop_times_trip_id ON stop_times(trip_id);
    CREATE INDEX idx_trips_route_id ON trips(route_id);
    CREATE INDEX idx_trips_service_id ON trips(service_id);
    CREATE INDEX idx_trips_headsign ON trips(trip_headsign);
    CREATE INDEX idx_stops_parent_station ON stops(parent_station);
    CREATE INDEX idx_stops_location_type ON stops(location_type);
  `)

  console.log('Index crees.')
}

async function importStops(db: Database.Database): Promise<number> {
  const filePath = join(GTFS_DIR, 'stops.txt')
  const stmt = db.prepare(
    'INSERT INTO stops (stop_id, stop_name, stop_lat, stop_lon, location_type, parent_station, platform_code) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )

  let count = 0
  const insert = db.transaction(
    (rows: Array<[string, string, number, number, number | null, string | null, string | null]>) => {
      for (const row of rows) {
        stmt.run(...row)
        count++
      }
    }
  )

  const batch: Array<[string, string, number, number, number | null, string | null, string | null]> =
    []
  const BATCH_SIZE = 1000

  for await (const { row } of readCSV(filePath)) {
    const locationType = row['location_type'] ? parseInt(row['location_type'], 10) : null
    const parentStation = row['parent_station'] || null
    const platformCode = row['platform_code'] || null

    batch.push([
      row['stop_id'],
      row['stop_name'],
      parseFloat(row['stop_lat']) || 0,
      parseFloat(row['stop_lon']) || 0,
      locationType,
      parentStation,
      platformCode,
    ])

    if (batch.length >= BATCH_SIZE) {
      insert(batch)
      batch.length = 0
    }
  }

  if (batch.length > 0) {
    insert(batch)
  }

  return count
}

async function importRoutes(db: Database.Database): Promise<number> {
  const filePath = join(GTFS_DIR, 'routes.txt')
  const stmt = db.prepare(
    'INSERT INTO routes (route_id, route_short_name, route_long_name) VALUES (?, ?, ?)'
  )

  let count = 0
  const insert = db.transaction((rows: Array<[string, string, string]>) => {
    for (const row of rows) {
      stmt.run(...row)
      count++
    }
  })

  const batch: Array<[string, string, string]> = []
  const BATCH_SIZE = 1000

  for await (const { row } of readCSV(filePath)) {
    batch.push([row['route_id'], row['route_short_name'], row['route_long_name']])

    if (batch.length >= BATCH_SIZE) {
      insert(batch)
      batch.length = 0
    }
  }

  if (batch.length > 0) {
    insert(batch)
  }

  return count
}

async function importTrips(db: Database.Database): Promise<number> {
  const filePath = join(GTFS_DIR, 'trips.txt')
  const stmt = db.prepare(
    'INSERT INTO trips (trip_id, route_id, service_id, trip_headsign, direction_id) VALUES (?, ?, ?, ?, ?)'
  )

  let count = 0
  const insert = db.transaction(
    (rows: Array<[string, string, string, string, number | null]>) => {
      for (const row of rows) {
        stmt.run(...row)
        count++
      }
    }
  )

  const batch: Array<[string, string, string, string, number | null]> = []
  const BATCH_SIZE = 1000

  for await (const { row } of readCSV(filePath)) {
    const directionId = row['direction_id'] ? parseInt(row['direction_id'], 10) : null
    batch.push([
      row['trip_id'],
      row['route_id'],
      row['service_id'],
      row['trip_headsign'],
      directionId,
    ])

    if (batch.length >= BATCH_SIZE) {
      insert(batch)
      batch.length = 0
    }
  }

  if (batch.length > 0) {
    insert(batch)
  }

  return count
}

async function importStopTimes(db: Database.Database): Promise<number> {
  const filePath = join(GTFS_DIR, 'stop_times.txt')
  const stmt = db.prepare(
    'INSERT INTO stop_times (trip_id, arrival_time, departure_time, stop_id, stop_sequence) VALUES (?, ?, ?, ?, ?)'
  )

  let count = 0
  const insert = db.transaction((rows: Array<[string, string, string, string, number]>) => {
    for (const row of rows) {
      stmt.run(...row)
      count++
    }
  })

  const batch: Array<[string, string, string, string, number]> = []
  const BATCH_SIZE = 5000

  for await (const { row } of readCSV(filePath)) {
    batch.push([
      row['trip_id'],
      row['arrival_time'],
      row['departure_time'],
      row['stop_id'],
      parseInt(row['stop_sequence'], 10) || 0,
    ])

    if (batch.length >= BATCH_SIZE) {
      insert(batch)
      batch.length = 0
      process.stdout.write(`\r  stop_times: ${count} lignes importees...`)
    }
  }

  if (batch.length > 0) {
    insert(batch)
  }

  return count
}

async function importCalendar(db: Database.Database): Promise<number> {
  const filePath = join(GTFS_DIR, 'calendar.txt')

  if (!existsSync(filePath)) {
    console.log('  calendar.txt non trouve, table vide creee.')
    return 0
  }

  const stmt = db.prepare(`
    INSERT INTO calendar (
      service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday,
      start_date, end_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let count = 0
  const insert = db.transaction(
    (
      rows: Array<[string, number, number, number, number, number, number, number, string, string]>
    ) => {
      for (const row of rows) {
        stmt.run(...row)
        count++
      }
    }
  )

  const batch: Array<
    [string, number, number, number, number, number, number, number, string, string]
  > = []
  const BATCH_SIZE = 1000

  for await (const { row } of readCSV(filePath)) {
    batch.push([
      row['service_id'],
      parseInt(row['monday'], 10) || 0,
      parseInt(row['tuesday'], 10) || 0,
      parseInt(row['wednesday'], 10) || 0,
      parseInt(row['thursday'], 10) || 0,
      parseInt(row['friday'], 10) || 0,
      parseInt(row['saturday'], 10) || 0,
      parseInt(row['sunday'], 10) || 0,
      row['start_date'],
      row['end_date'],
    ])

    if (batch.length >= BATCH_SIZE) {
      insert(batch)
      batch.length = 0
    }
  }

  if (batch.length > 0) {
    insert(batch)
  }

  return count
}

async function importCalendarDates(db: Database.Database): Promise<number> {
  const filePath = join(GTFS_DIR, 'calendar_dates.txt')

  if (!existsSync(filePath)) {
    console.log('  calendar_dates.txt non trouve, table vide creee.')
    return 0
  }

  const stmt = db.prepare(
    'INSERT INTO calendar_dates (service_id, date, exception_type) VALUES (?, ?, ?)'
  )

  let count = 0
  const insert = db.transaction((rows: Array<[string, string, number]>) => {
    for (const row of rows) {
      stmt.run(...row)
      count++
    }
  })

  const batch: Array<[string, string, number]> = []
  const BATCH_SIZE = 1000

  for await (const { row } of readCSV(filePath)) {
    batch.push([row['service_id'], row['date'], parseInt(row['exception_type'], 10) || 0])

    if (batch.length >= BATCH_SIZE) {
      insert(batch)
      batch.length = 0
    }
  }

  if (batch.length > 0) {
    insert(batch)
  }

  return count
}

async function main(): Promise<void> {
  console.log('=== Import GTFS vers SQLite ===\n')

  // Check required files
  console.log('Verification des fichiers GTFS...')
  const missingFiles: string[] = []

  for (const file of REQUIRED_FILES) {
    const filePath = join(GTFS_DIR, file)
    if (!existsSync(filePath)) {
      missingFiles.push(file)
    }
  }

  if (missingFiles.length > 0) {
    console.error(`\nErreur: Fichiers GTFS manquants dans ${GTFS_DIR}:`)
    for (const file of missingFiles) {
      console.error(`  - ${file}`)
    }
    process.exit(1)
  }

  console.log('Tous les fichiers requis sont presents.\n')

  // Remove old database
  if (existsSync(DB_PATH)) {
    console.log('Suppression de l\'ancienne base de donnees...')
    unlinkSync(DB_PATH)
    // Also remove WAL and SHM files if they exist
    if (existsSync(DB_PATH + '-wal')) unlinkSync(DB_PATH + '-wal')
    if (existsSync(DB_PATH + '-shm')) unlinkSync(DB_PATH + '-shm')
  }

  // Create new database
  console.log('Creation de la nouvelle base de donnees...')
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')

  try {
    // Create tables
    console.log('Creation des tables...\n')
    createTables(db)

    // Import data
    console.log('Import des donnees:')

    const stopsCount = await importStops(db)
    console.log(`  stops: ${stopsCount} lignes`)

    const routesCount = await importRoutes(db)
    console.log(`  routes: ${routesCount} lignes`)

    const tripsCount = await importTrips(db)
    console.log(`  trips: ${tripsCount} lignes`)

    const stopTimesCount = await importStopTimes(db)
    console.log(`\n  stop_times: ${stopTimesCount} lignes`)

    const calendarCount = await importCalendar(db)
    console.log(`  calendar: ${calendarCount} lignes`)

    const calendarDatesCount = await importCalendarDates(db)
    console.log(`  calendar_dates: ${calendarDatesCount} lignes`)

    console.log('')

    // Create indexes
    createIndexes(db)

    console.log(`\nImport termine avec succes!`)
    console.log(`Base de donnees: ${DB_PATH}`)
  } finally {
    db.close()
  }
}

main().catch((error) => {
  console.error('Erreur lors de l\'import:', error)
  process.exit(1)
})
