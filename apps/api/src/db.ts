import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DB_PATH = join(__dirname, '../../../data/gtfs.sqlite')

export function openDb(): Database.Database {
  try {
    const db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    return db
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue'
    throw new Error(`Impossible d'ouvrir la base de données: ${message}`)
  }
}

export function getDbPath(): string {
  return DB_PATH
}
