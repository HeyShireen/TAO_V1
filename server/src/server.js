// server/src/server.js
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { query, ensureSchema } from './db.js'
import authRoutes from './routes/auth.js'
import projectRoutes from './routes/projects.js'
import lotRoutes from './routes/lots.js'

const app = express()

// CORS ok pour démarrer. Restreins origin ensuite.
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '10mb' }))
app.use(morgan('dev'))
app.disable('x-powered-by')

// API
app.get('/api', (_req, res) => res.json({ ok: true, name: 'offer-compare-server' }))
app.get('/api/healthz', async (_req, res) => {
  try {
    const r = await query('SELECT 1')
    res.json({ ok: true, db: r.rowCount === 1 })
  } catch (e) {
    console.error('healthz', e)
    res.status(500).json({ ok: false })
  }
})
app.use('/api/auth', authRoutes)
app.use('/api/projects', projectRoutes)
app.use('/api/lots', lotRoutes)

// Front same-origin
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const publicDir = path.resolve(__dirname, './public') // server/src/public
app.use(express.static(publicDir))
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).end()
  res.sendFile(path.join(publicDir, 'index.html'))
})

// Init BDD puis lancement
await ensureSchema()
const port = process.env.PORT || 4000
app.listen(port, '0.0.0.0', () => console.log(`Server running on :${port}`))
