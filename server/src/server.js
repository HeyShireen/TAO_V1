// server/src/server.js
import 'dotenv/config'

// 🔒 SÉCURITÉ: Valider la configuration au démarrage AVANT toute autre chose
import './security-init.js'

import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import jwt from 'jsonwebtoken'

import { query, ensureSchema } from './db.js'
import { sanitizeInput } from './middleware.security.js'
import authRoutes from './routes/auth.js'
import projectRoutes from './routes/projects.js'
import lotRoutes from './routes/lots.js'
import roundRoutes from './routes/rounds.js'
import questionRoutes from './routes/questions.js'
import questionConfigRoutes from './routes/question-config.js'
import optionsRoutes from './routes/options.js'
import userRoutes from './routes/users.js'
import shareRoutes from './routes/shares.js'
import accessRequestRoutes from './routes/access-requests.js'
import exportRoutes from './routes/exports.js'

const app = express()

// Trust proxy: nécessaire pour Render et autres hébergeurs derrière un proxy
// Permet de récupérer la vraie IP client via X-Forwarded-For
if (process.env.RENDER || process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// CORS : Whitelist stricte - SÉCURITÉ CRITIQUE
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [];

// Valider que les origines sont configurées en production
if ((process.env.RENDER || process.env.NODE_ENV === 'production') && allowedOrigins.length === 0) {
  console.error('❌ ERREUR CRITIQUE: ALLOWED_ORIGINS doit être défini en production');
  console.error('   Exemple: ALLOWED_ORIGINS=https://monsite.com,https://app.monsite.com');
  process.exit(1);
}

app.use(cors({ 
  origin: (origin, callback) => {
    // 1. Pas d'origin = requête same-origin (curl, mobile, même serveur)
    if (!origin) return callback(null, true);
    
    // 2. Production: vérifier strictement la whitelist
    if (process.env.RENDER || process.env.NODE_ENV === 'production') {
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`🚫 Tentative CORS bloquée: ${origin}`);
        callback(new Error('CORS policy: Origin not allowed'));
      }
      return;
    }
    
    // 3. Développement : utiliser whitelist ou localhost
    const devOrigins = ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080', 'http://localhost:4000'];
    const allowedInDev = [...devOrigins, ...allowedOrigins];
    
    if (allowedInDev.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`⚠️ Origine bloquée par CORS (dev): ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token']
}))
app.use(express.json({ limit: '10mb' }))
app.use(morgan('dev'))
app.disable('x-powered-by')

// Sécurité: Headers HTTP avec Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  }, // Allow inline styles and scripts for dynamic UI

  hsts: {
    maxAge: 31536000, // 1 an
    includeSubDomains: true,
    preload: true,
  },
  frameguard: { action: 'deny' }, // Anti-clickjacking
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}))

// Rate Limiting Global: adaptatif selon environnement
// Dev: 10000 req/15min (quasi illimité), Prod: 2000 req/15min (usage intensif OK)
// Note: 2000 req/15min = ~2 req/sec soutenu par utilisateur, largement suffisant
// Un serveur moyen (4 CPU, 4GB RAM) peut gérer 500+ req/sec total
const isDev = process.env.NODE_ENV === 'development';
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDev ? 10000 : 2000, // Dev: quasi illimité, Prod: usage intensif supporté
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
app.use('/api/options', optionsRoutes)
app.use('/api/exports', exportRoutes)

// Front same-origin
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const publicDir = path.resolve(__dirname, './public') // server/src/public
const homeFile = path.join(publicDir, 'home.html')
const loginFile = path.join(publicDir, 'login.html')
const appFile = path.join(publicDir, 'index.html')

// Helper: détecter cookie auth pour décider quelle page servir
function getTokenFromCookie(req){
  const c = req.headers.cookie || ''
  const pair = c.split(';').map(s => s.trim()).find(s => s.startsWith('auth='))
  if (!pair) return null
  const val = decodeURIComponent(pair.slice('auth='.length))
  if (!val || val === 'undefined' || val === 'null') return null
  return val
}

function isValidJwt(token){
  if (!token) return false
  try {
    jwt.verify(token, process.env.JWT_SECRET)
    return true
  } catch {
    return false
  }
}

// Page de login dédiée avec CSP permettant les styles inline
const loginCsp = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
    }
  }
});

// Routes spécifiques AVANT express.static
// Page d'accueil publique (pas d'authentification requise)
app.get('/', (_req, res) => {
  res.sendFile(homeFile)
})

app.get('/login', loginCsp, (_req, res) => {
  res.sendFile(loginFile)
})

// Route pour la SPA (authentification requise)
app.get('/app', (req, res) => {
  const token = getTokenFromCookie(req)
  if (!isValidJwt(token)) return res.redirect('/login')
  res.sendFile(appFile)
})

// Static files APRÈS les routes, sans servir index.html automatiquement
app.use(express.static(publicDir, { index: false }))

// Catch-all: pour les routes non définies, rediriger vers home (hors /api)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Route API introuvable' })
  res.status(404).send('Page non trouvée')
})

// Middleware global de gestion d'erreurs (doit être après toutes les routes)
import { errorHandler } from './middleware.errors.js'
app.use(errorHandler)

// Init BDD puis lancement
await ensureSchema()
const port = process.env.PORT || 4000
app.listen(port, '0.0.0.0', () => {
  console.log(`✅ Serveur démarré sur le port ${port}`)
  // console.log(`   - API: http://localhost:${port}/api`)
  // console.log(`   - Interface: http://localhost:${port}`)
})
