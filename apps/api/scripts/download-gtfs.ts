import { createWriteStream, existsSync, mkdirSync, rmSync, createReadStream } from 'fs'
import { pipeline } from 'stream/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createUnzip } from 'zlib'
import { Readable } from 'stream'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const GTFS_DIR = join(__dirname, '../../../data/gtfs')
const TEMP_ZIP = join(__dirname, '../../../data/gtfs-download.zip')

// URL de telechargement direct du GTFS T2C depuis Clermont Metropole Open Data
const GTFS_DOWNLOAD_URL =
  'https://opendata.clermontmetropole.eu/api/v2/catalog/datasets/gtfs-smtc/alternative_exports/gtfs'

// Page d'information sur le dataset
const DATASET_INFO_URL =
  'https://transport.data.gouv.fr/datasets/syndicat-mixte-des-transports-en-commun-de-lagglomeration-clermontoise-smtc-ac-reseau-t2c-gtfs-gtfs-rt'

async function downloadFile(url: string, destPath: string): Promise<void> {
  console.log(`Telechargement depuis: ${url}`)

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Erreur telechargement: ${response.status} ${response.statusText}`)
  }

  const contentLength = response.headers.get('content-length')
  const totalSize = contentLength ? parseInt(contentLength, 10) : 0

  if (!response.body) {
    throw new Error('Response body is null')
  }

  const fileStream = createWriteStream(destPath)
  const reader = response.body.getReader()

  let downloadedSize = 0

  const readableStream = new Readable({
    async read() {
      const { done, value } = await reader.read()

      if (done) {
        this.push(null)
        return
      }

      downloadedSize += value.length

      if (totalSize > 0) {
        const percent = ((downloadedSize / totalSize) * 100).toFixed(1)
        const sizeMB = (downloadedSize / 1024 / 1024).toFixed(2)
        process.stdout.write(`\r  Progres: ${sizeMB} MB (${percent}%)`)
      } else {
        const sizeMB = (downloadedSize / 1024 / 1024).toFixed(2)
        process.stdout.write(`\r  Telecharge: ${sizeMB} MB`)
      }

      this.push(value)
    },
  })

  await pipeline(readableStream, fileStream)
  console.log('\n  Telechargement termine.')
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  console.log(`Extraction vers: ${destDir}`)

  // Use PowerShell on Windows or unzip on Unix
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  // Clean destination directory
  if (existsSync(destDir)) {
    rmSync(destDir, { recursive: true })
  }
  mkdirSync(destDir, { recursive: true })

  const isWindows = process.platform === 'win32'

  if (isWindows) {
    // Use PowerShell Expand-Archive on Windows
    const command = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`
    await execAsync(command)
  } else {
    // Use unzip on Unix
    await execAsync(`unzip -o "${zipPath}" -d "${destDir}"`)
  }

  console.log('  Extraction terminee.')
}

async function main(): Promise<void> {
  console.log('=== Telechargement GTFS T2C depuis Open Data ===\n')
  console.log(`Source: ${DATASET_INFO_URL}\n`)

  try {
    // Download the file
    await downloadFile(GTFS_DOWNLOAD_URL, TEMP_ZIP)

    // Extract the zip
    console.log('')
    await extractZip(TEMP_ZIP, GTFS_DIR)

    // Clean up temp file
    if (existsSync(TEMP_ZIP)) {
      rmSync(TEMP_ZIP)
      console.log('\nFichier temporaire supprime.')
    }

    console.log('\n=== Telechargement termine avec succes! ===')
    console.log(`\nFichiers GTFS disponibles dans: ${GTFS_DIR}`)
    console.log('\nPour importer dans SQLite, executez:')
    console.log('  pnpm --filter @t2c-now/api import:gtfs')
  } catch (error) {
    console.error('\nErreur:', error)

    // Clean up on error
    if (existsSync(TEMP_ZIP)) {
      rmSync(TEMP_ZIP)
    }

    process.exit(1)
  }
}

main()
