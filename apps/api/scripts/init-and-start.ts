/**
 * Script de démarrage pour la production
 * - Télécharge les données GTFS si la base n'existe pas
 * - Lance le serveur
 */

import { existsSync } from 'fs'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DB_PATH = join(__dirname, '../../../data/gtfs.sqlite')

async function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[init] Running: ${command} ${args.join(' ')}`)

    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      cwd: join(__dirname, '..'),
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command failed with code ${code}`))
      }
    })

    child.on('error', reject)
  })
}

async function main() {
  console.log('[init] T2C Now - Production Startup')
  console.log('[init] Checking database...')

  if (!existsSync(DB_PATH)) {
    console.log('[init] Database not found. Downloading GTFS data...')

    try {
      // Download GTFS
      await runCommand('npx', ['tsx', 'scripts/download-gtfs.ts'])

      // Import to SQLite
      await runCommand('npx', ['tsx', 'scripts/import-gtfs.ts'])

      console.log('[init] GTFS data imported successfully!')
    } catch (error) {
      console.error('[init] Failed to initialize GTFS data:', error)
      console.error('[init] The app will start but may not work correctly.')
    }
  } else {
    console.log('[init] Database found. Skipping GTFS download.')
  }

  // Start the server
  console.log('[init] Starting server...')
  await runCommand('node', ['--env-file=.env', 'dist/server.js'])
}

main().catch((error) => {
  console.error('[init] Fatal error:', error)
  process.exit(1)
})
