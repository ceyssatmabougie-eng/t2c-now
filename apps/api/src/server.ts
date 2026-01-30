import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import healthRouter from './routes/health.js'
import stopsRouter from './routes/stops.js'
import rtRouter from './routes/rt.js'
import { startRtPolling } from './rt/rtClient.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const PORT = process.env.PORT ?? 3001
const isProduction = process.env.NODE_ENV === 'production'

// CORS configuration
if (isProduction) {
  // En production, autoriser toutes les origines
  app.use(cors())
} else {
  app.use(
    cors({
      origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'],
      methods: ['GET', 'POST'],
    })
  )
}

app.use(express.json())

// API routes
app.use('/api/health', healthRouter)
app.use('/api/stops', stopsRouter)
app.use('/api/rt', rtRouter)

// Legacy routes (without /api prefix) for backwards compatibility
app.use('/health', healthRouter)
app.use('/stops', stopsRouter)
app.use('/rt', rtRouter)

// Serve frontend static files in production
if (isProduction) {
  const frontendPath = join(__dirname, '../../web/dist')

  if (existsSync(frontendPath)) {
    app.use(express.static(frontendPath))

    // SPA fallback - serve index.html for all non-API routes
    app.get('*', (_req, res) => {
      res.sendFile(join(frontendPath, 'index.html'))
    })

    console.log(`[t2c-now] Serving frontend from ${frontendPath}`)
  }
}

// Start GTFS-RT polling if configured
startRtPolling()

app.listen(PORT, () => {
  console.log(`[t2c-now-api] Server running on http://localhost:${PORT}`)
})
