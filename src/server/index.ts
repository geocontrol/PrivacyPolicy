import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDb } from './db/schema.js'
import { servicesRouter } from './routes/services.js'
import { analysesRouter } from './routes/analyses.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT ?? 3000

const app = express()
app.use(express.json())

// Serve built client assets in production
app.use(express.static(path.resolve(__dirname, '../../dist/client')))

// Initialise DB on startup
getDb()

// Routes
app.use('/api/services', servicesRouter)
app.use('/api/analyses', analysesRouter)
// app.use('/api/graph', graphRouter)  — coming next

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.listen(PORT, () => {
  console.log(`Privacy Policy Dashboard running at http://localhost:${PORT}`)
})
