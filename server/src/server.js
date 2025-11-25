// server/src/server.js
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { query, ensureSchema } from './db.js'
import { sanitizeInput } from './middleware.security.js'
import authRoutes from './routes/auth.js'
import projectRoutes from './routes/projects.js'
import lotRoutes from './routes/lots.js'
import roundRoutes from './routes/rounds.js'
import questionRoutes from './routes/questions.js'
import questionConfigRoutes from './routes/question-config.js'
import userRoutes from './routes/users.js'
import shareRoutes from './routes/shares.js'
import accessRequestRoutes from './routes/access-requests.js'

// Validation des variables d'environnement critiques
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me' || process.env.JWT_SECRET.length < 32) {
  console.error('❌ ERREUR: JWT_SECRET doit être défini et sécurisé (min 32 caractères)');
  console.error('   Ajoutez dans votre .env: JWT_SECRET=votre-secret-très-long-et-sécurisé');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('❌ ERREUR: DATABASE_URL doit être défini');
  console.error('   Ajoutez dans votre .env: DATABASE_URL=postgresql://...');
  process.exit(1);
}

const app = express()

// CORS : autoriser same-origin + origines configurées
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [];

app.use(cors({ 
  origin: (origin, callback) => {
    // 1. Pas d'origin = requête same-origin (curl, mobile, même serveur)
    if (!origin) return callback(null, true);
    
    // 2. En production sur Render, autoriser l'URL publique même si pas configurée
    // (le frontend fetch depuis https://xxx.onrender.com vers /api sur le même domaine)
    if (process.env.RENDER || process.env.NODE_ENV === 'production') {
      return callback(null, true);
    }
    
    // 3. Développement : vérifier liste ou accepter tout si vide
    if (allowedOrigins.length === 0) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`⚠️ Origine bloquée par CORS: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true 
}))
app.use(express.json({ limit: '10mb' }))
app.use(morgan('dev'))
app.disable('x-powered-by')

// Sécurité: Headers HTTP avec Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline pour app.js inline
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  hsts: {
    maxAge: 31536000, // 1 an
    includeSubDomains: true,
    preload: true,
  },
  frameguard: { action: 'deny' }, // Anti-clickjacking
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}))

// Rate Limiting Global: 100 requêtes / 15 min par IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limite par IP
  message: { error: 'Trop de requêtes, réessayez dans 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Rate Limiting Auth: 5 tentatives / 15 min (login/register)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
  skipSuccessfulRequests: true, // Ne compte que les échecs
})

// Appliquer le rate limiter global sur toutes les routes API
app.use('/api/', globalLimiter)

// Sanitizer global: nettoyer les inputs
app.use(sanitizeInput)

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
app.use('/api/auth', authLimiter, authRoutes)
app.use('/api/projects', projectRoutes)
app.use('/api/lots', lotRoutes)
app.use('/api/rounds', roundRoutes)
app.use('/api/users', userRoutes)
app.use('/api/shares', shareRoutes)
app.use('/api/access-requests', accessRequestRoutes)
app.use('/api/questions', questionRoutes)
app.use('/api/question-config', questionConfigRoutes)

// Front same-origin
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const publicDir = path.resolve(__dirname, './public') // server/src/public
app.use(express.static(publicDir))
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Route API introuvable' })
  res.sendFile(path.join(publicDir, 'index.html'))
})

// Middleware global de gestion d'erreurs (doit être après toutes les routes)
import { errorHandler } from './middleware.errors.js'
app.use(errorHandler)

// Init BDD puis lancement
await ensureSchema()
const port = process.env.PORT || 4000
app.listen(port, '0.0.0.0', () => {
  console.log(`✅ Serveur démarré sur le port ${port}`)
  console.log(`   - API: http://localhost:${port}/api`)
  console.log(`   - Interface: http://localhost:${port}`)
})
