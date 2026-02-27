import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

// Load .env file manually (no dotenv dependency needed)
try {
  const envFile = readFileSync(new URL('../../.env', import.meta.url), 'utf-8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!(key in process.env)) process.env[key] = value
  }
} catch {
  // .env file not found — rely on environment variables being set externally
}
import { getDb } from './db/schema.js'
import { servicesRouter } from './routes/services.js'
import { analysesRouter } from './routes/analyses.js'
import { extensionRouter } from './routes/extension.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT ?? 3000

const app = express()
app.use(express.json())

// Serve built client assets in production only
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.resolve(__dirname, '../../dist/client')))
}

// Initialise DB on startup
getDb()

// Routes
app.use('/api/services', servicesRouter)
app.use('/api/analyses', analysesRouter)
app.use('/api/integrations/extension', extensionRouter)
// app.use('/api/graph', graphRouter)  — coming next

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.listen(PORT, () => {
  console.log(`Privacy Policy Dashboard running at http://localhost:${PORT}`)
})
