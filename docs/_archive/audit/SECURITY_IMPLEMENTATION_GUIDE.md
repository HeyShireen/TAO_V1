# 🔧 GUIDE D'IMPLÉMENTATION - CORRECTIONS DE SÉCURITÉ

## Phase 1: CORRECTIONS IMMÉDIATE (AVANT PRODUCTION)

### ÉTAPE 1: Sauvegarder la version actuelle
```bash
git commit -m "Backup version pre-security-audit"
git tag v0.1.0-pre-audit
```

### ÉTAPE 2: Mettre à jour les dépendances
```bash
cd server
npm install --save-dev helmet csurf dotenv-safe
npm audit fix
npm update
```

**package.json après mise à jour:**
```json
{
  "dependencies": {
    "bcrypt": "^5.1.1",
    "cors": "^2.8.5",
    "csurf": "^1.11.0",
    "dotenv": "^16.4.5",
    "dotenv-safe": "^8.2.0",
    "express": "^4.19.2",
    "express-rate-limit": "^8.2.1",
    "helmet": "^8.1.0",
    "jsonwebtoken": "^9.0.2",
    "morgan": "^1.10.0",
    "multer": "^1.4.5-lts.1",
    "nodemailer": "^7.0.10",
    "pg": "^8.12.0"
  }
}
```

### ÉTAPE 3: Créer les tables d'audit et de sécurité

**Nouveau fichier migration:**  `migrations/016_add_security_tables.sql`

```sql
-- Audit log pour traçabilité
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL, -- 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'EXPORT'
  resource_type TEXT, -- 'project', 'lot', 'offer', 'user'
  resource_id BIGINT,
  changes JSONB, -- Avant/après changements
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Token revocation list
CREATE TABLE IF NOT EXISTS revoked_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_revoked_tokens_expires_at ON revoked_tokens(expires_at);

-- Tentatives de connexion suspectes
CREATE TABLE IF NOT EXISTS login_attempts (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  ip_address INET,
  success BOOLEAN,
  user_agent TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_attempts_email ON login_attempts(email);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip_address);
CREATE INDEX idx_login_attempts_attempted_at ON login_attempts(attempted_at);

-- 2FA (TOTP) - à venir
CREATE TABLE IF NOT EXISTS two_factor_secrets (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  secret TEXT NOT NULL,
  backup_codes TEXT[] NOT NULL, -- JSON array de codes
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ
);

-- Sessions pour CSRF/Rate limiting par session
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
```

### ÉTAPE 4: Mettre à jour les fichiers .env

**`.env.example` (à committer):**
```bash
# ====== CRITIQUE: CHANGER EN PRODUCTION ======

# JWT Secret: Min 64 caractères aléatoires
# Générer avec: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=your-super-secret-key-min-64-chars-CHANGE-THIS

# Base de données
DATABASE_URL=postgresql://user:password@host:5432/db

# Origines CORS autorisées (virgule-séparées)
ALLOWED_ORIGINS=https://app.example.com,https://www.example.com

# Email (utiliser service géré: SendGrid, Brevo, etc.)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_FROM="TAO <noreply@example.com>"

# URL publique de l'application
APP_URL=https://app.example.com

# Environnement
NODE_ENV=production
PORT=4000

# ====== OPTIONNEL ======
# SSL Database (si Render)
DB_SSL=true

# Render deployment
RENDER=false
```

### ÉTAPE 5: Mettre à jour server.js avec les corrections CORS

**Remplacer le CORS block en entier:**

```javascript
// AVANT (vuln): À remplacer complètement
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [];

app.use(cors({ 
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (process.env.RENDER || process.env.NODE_ENV === 'production') {
      return callback(null, true);  // ❌ DANGER!
    }
    if (allowedOrigins.length === 0) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`⚠️ Origine bloquée: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true 
}))

// APRÈS (sécurisé): Nouveau code
import { getCorsConfig } from './middleware.security-fixes.js';

const corsConfig = getCorsConfig();
app.use(cors(corsConfig));

// Validation stricte: Vérifier que les variables critiques sont configurées
if (process.env.NODE_ENV === 'production') {
  if (!process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS.trim() === '') {
    console.error('❌ ERREUR: ALLOWED_ORIGINS non configuré en production!');
    process.exit(1);
  }
  const origins = process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
  console.log(`✅ CORS autorisé pour: ${origins.join(', ')}`);
}
```

### ÉTAPE 6: Remplacer les routes auth

```bash
# Sauvegarder l'ancien
cp server/src/routes/auth.js server/src/routes/auth.js.backup

# Remplacer par la version sécurisée
cp server/src/routes/auth-secured.js server/src/routes/auth.js
```

### ÉTAPE 7: Ajouter les rate limiters sur les exports

**Fichier: `routes/exports-secured.js` (à créer)**

```javascript
import rateLimit from 'express-rate-limit';
import { exportLimiter } from '../middleware.security-fixes.js';

// Appliquer sur les routes d'export
router.get('/summary/:roundId', exportLimiter, async (req, res) => {
  // ... reste du code
});

// Limiter la taille des fichiers exportés
const MAX_EXPORT_SIZE = 50 * 1024 * 1024; // 50 MB
router.get('/summary/:roundId', (req, res, next) => {
  // Timeout: 5 minutes max pour générer un export
  req.setTimeout(5 * 60 * 1000);
  next();
});
```

### ÉTAPE 8: Valider tous les paramètres numériques

**Chercher et remplacer dans toutes les routes:**

```javascript
// AVANT:
router.get('/:id', async (req, res) => {
  const id = req.params.id;
  await query('SELECT * FROM table WHERE id = $1', [id]);
});

// APRÈS:
import { validateNumericId } from '../middleware.security-fixes.js';

router.get('/:id', validateNumericId('id'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await query('SELECT * FROM table WHERE id = $1', [id]);
});
```

---

## Phase 2: AMÉLIORATIONS MAJEURES (Semaine 1)

### ÉTAPE 9: Implémenter 2FA (TOTP)

**Nouveau fichier: `utils.otp.js`**

```javascript
import { authenticator } from 'otplib';

export function generateSecret(email) {
  const secret = authenticator.generateSecret({
    name: `TAO (${email})`,
    issuer: 'TAO Comparateur'
  });
  return secret;
}

export function verifyToken(secret, token) {
  return authenticator.verify({ secret, encoding: 'utf8', token });
}

export function generateBackupCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    codes.push(
      Math.random().toString(36).substring(2, 10).toUpperCase()
    );
  }
  return codes;
}
```

**New route: `POST /api/auth/2fa/setup`**

```javascript
router.post('/2fa/setup', requireAuth, async (req, res) => {
  // 1. Générer secret TOTP
  // 2. Générer codes de secours
  // 3. Renvoyer QR code
  // 4. Attendre confirmation avec token OTP
});
```

### ÉTAPE 10: Ajouter logging d'audit centralisé

**Table PostgreSQL pour audit:**

```sql
INSERT INTO audit_logs (user_id, action, resource_type, resource_id, changes, ip_address, user_agent)
VALUES ($1, $2, $3, $4, $5, $6, $7);
```

**Utilisation dans les routes:**

```javascript
import { auditLog } from '../middleware.security-fixes.js';

router.post('/projects', isResponsableOrAdmin, async (req, res) => {
  const result = await query(
    'INSERT INTO projects (...) VALUES (...) RETURNING *',
    [...]
  );
  
  // Enregistrer l'action
  auditLog(req, 'CREATE', 'project', result.rows[0].id, {
    name: req.body.name,
    reference: req.body.reference
  });
  
  res.json(result.rows[0]);
});
```

### ÉTAPE 11: Session timeout inactivité

**Middleware: `middleware.session-timeout.js`**

```javascript
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

export function sessionTimeout(req, res, next) {
  if (!req.user) return next();

  const lastActivity = req.session?.lastActivity || Date.now();
  const elapsed = Date.now() - lastActivity;

  if (elapsed > SESSION_TIMEOUT) {
    return res.status(401).json({ 
      error: 'Session expirée. Veuillez vous reconnecter.' 
    });
  }

  // Mettre à jour l'activité
  req.session = req.session || {};
  req.session.lastActivity = Date.now();
  next();
}
```

**Appliquer sur toutes les routes:**

```javascript
app.use('/api/', sessionTimeout);
```

### ÉTAPE 12: HTTPS + HSTS obligatoire

**Ajouter à server.js:**

```javascript
// Redirection HTTP -> HTTPS en production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

// Helmet HSTS
app.use(helmet({
  hsts: {
    maxAge: 31536000, // 1 an
    includeSubDomains: true,
    preload: true
  }
}));
```

---

## Phase 3: HARDENING AVANCÉ (Semaine 2-3)

### ÉTAPE 13: WAF (Web Application Firewall) Rules

```javascript
// Bloquer patterns dangereux
const dangerousPatterns = [
  /union.*select/i,
  /drop.*table/i,
  /exec\(/i,
  /eval\(/i,
  /<script/i
];

app.use((req, res, next) => {
  const queryStr = JSON.stringify(req.query) + JSON.stringify(req.body);
  for (const pattern of dangerousPatterns) {
    if (pattern.test(queryStr)) {
      logSecurityEvent('CRITICAL', 'WAF_BLOCKED', { pattern, query: queryStr });
      return res.status(403).json({ error: 'Requête bloquée' });
    }
  }
  next();
});
```

### ÉTAPE 14: Monitoring & Alertes

**Intégration avec service de monitoring (Datadog, Sentry, etc.):**

```javascript
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1
});

app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.errorHandler());
```

### ÉTAPE 15: Penetration Testing

```bash
# Outils recommandés:
# - OWASP ZAP (gratuit)
# - Burp Suite Community
# - sqlmap (SQL injection testing)
# - nikto (web server scanner)

# Procédure:
1. Scanner tous les endpoints
2. Tester authentification/autorisation
3. Tester injection SQL/XSS
4. Tester CSRF
5. Tester rate limiting
6. Documenter résultats
```

---

## 🧪 TESTING DE SÉCURITÉ

### Test 1: CORS
```bash
curl -H "Origin: https://attacker.com" \
     https://app.example.com/api/projects
# ❌ Doit retourner 403 CORS error
```

### Test 2: SQL Injection
```bash
curl "https://app.example.com/api/projects/1' OR '1'='1"
# ❌ Doit retourner 400 "ID invalide"
```

### Test 3: Token Revocation
```bash
# 1. Login et récupérer token
TOKEN=$(curl -X POST https://app.example.com/api/auth/login \
  -d '{"email":"test@test.com","password":"pass"}' | jq '.token')

# 2. Logout pour révoquer
curl -H "Authorization: Bearer $TOKEN" \
     -X POST https://app.example.com/api/auth/logout

# 3. Réutiliser token (doit échouer)
curl -H "Authorization: Bearer $TOKEN" \
     https://app.example.com/api/projects
# ❌ Doit retourner 401 "Token revoked"
```

### Test 4: Rate Limiting
```bash
for i in {1..10}; do
  curl -X POST https://app.example.com/api/auth/login \
    -d '{"email":"test@test.com","password":"wrong"}'
done
# ❌ Après 5 tentatives, doit retourner 429
```

---

## 📋 Checklist Final

Avant de déployer en production:

- [ ] CORS configuré explicitement
- [ ] JWT_SECRET min 64 caractères
- [ ] DATABASE_URL avec SSL/TLS
- [ ] HTTPS obligatoire (redirection + HSTS)
- [ ] Tous les params numériques validés
- [ ] Token blacklist/revocation implémenté
- [ ] Rate limiting sur auth + exports
- [ ] Password validation stricte
- [ ] Audit logging en place
- [ ] 2FA pour admins
- [ ] Erreurs sensibles cachées
- [ ] Logs centralisés
- [ ] Monitoring actif
- [ ] Backups chiffrés
- [ ] Plan de réponse aux incidents

