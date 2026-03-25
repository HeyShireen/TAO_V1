# 🔒 AUDIT DE SÉCURITÉ COMPLET - AO Link

**Date:** 18 Décembre 2025  
**Environnement:** Production  
**Sévérité Globale:** 🔴 **CRITIQUE**

---

## 📋 RÉSUMÉ EXÉCUTIF

Cette application présente **15 vulnérabilités majeures** qui pourraient permettre à des attaquants de:
- Accéder à des données sensibles (authentification faible)
- Modifier/supprimer des données sans autorisation (escalade de privilèges)
- Exécuter du code malveillant (injection de code)
- Bloquer l'application (DoS)
- Voler des sessions utilisateur (CSRF, XSS)

**Statut de Production:** ❌ **NON CONFORME - À CORRIGER IMMÉDIATEMENT**

---

## 🚨 VULNÉRABILITÉS CRITIQUES (Severity: 9-10/10)

### 1. **CORS Trop Permissif en Production** ⚠️ CRITIQUE
**Fichier:** [server.js](server/src/server.js#L46-L74)  
**Impact:** SSRF, Accès non autorisé, Vol de données

#### ❌ Problème:
```javascript
// En production (process.env.RENDER), accepte TOUTES les origines!
if (process.env.RENDER || process.env.NODE_ENV === 'production') {
  return callback(null, true);  // 🔴 DANGER CRITIQUE!
}
```

**Scénario d'attaque:**
```bash
# Attaquant: attacker.com
curl -H "Origin: attacker.com" https://votre-app.onrender.com/api/projects
# ✅ Accepté! Les données sensibles sont exposées en CORS!

# Attaquant peut aussi faire:
# 1. Voler les JWT des utilisateurs via le navigateur
# 2. Exécuter des requêtes en tant qu'utilisateur connecté
# 3. Accéder aux projets/offres d'autres entreprises
```

#### ✅ Correction Requise:
```javascript
// OBLIGATOIRE en production
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['https://votredomaine.com']; // Valeur par défaut SÉCURISÉE

if (allowedOrigins.length === 0 && process.env.NODE_ENV === 'production') {
  throw new Error('ALLOWED_ORIGINS doit être configuré en production!');
}

app.use(cors({ 
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

---

### 2. **Paramètres SQL Utilisateur Non Validés** 🔴 SQL INJECTION
**Fichiers:** [exports.js](server/src/routes/exports.js#L50) (et d'autres routes)  
**Impact:** Accès à toutes les données, Suppression de BD

#### ❌ Problème:
```javascript
router.get('/summary/:roundId', async (req, res) => {
  const { roundId } = req.params;
  // PROBLÈME: roundId n'est jamais validé!
  await query(`SELECT r.* FROM rounds r WHERE r.id = $1`, [roundId]);
});
```

**Scénario d'attaque:**
```bash
# L'attaquant passe:
GET /api/exports/summary/1 OR 1=1 --
# La requête devient:
SELECT * FROM rounds WHERE id = (1 OR 1=1)  # Retourne TOUS les rounds!

# Ou accès à d'autres données:
GET /api/exports/summary/1; DROP TABLE users; --
```

#### ✅ Correction Requise:
```javascript
import { validateNumericId } from '../middleware.security.js';

router.get('/summary/:roundId', validateNumericId('roundId'), async (req, res) => {
  const roundId = parseInt(req.params.roundId, 10);
  if (isNaN(roundId)) {
    return res.status(400).json({ error: 'ID invalide' });
  }
  // Maintenant sûr - PostgreSQL le traite comme nombre
  await query(`SELECT * FROM rounds WHERE id = $1`, [roundId]);
});
```

---

### 3. **Token JWT Non Validé - Session Hijacking Possible** 🔴
**Fichier:** [middleware.auth.js](server/src/middleware.auth.js#L1-25)  
**Impact:** Accès non autorisé, Vol de session, Escalade de privilèges

#### ❌ Problèmes:
```javascript
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : null;
  
  // ❌ PROBLÈME 1: Le cookie 'auth' n'est pas HttpOnly!
  // ❌ PROBLÈME 2: Pas de vérification d'expiration propre
  // ❌ PROBLÈME 3: Pas de refresh token mechanism
  // ❌ PROBLÈME 4: Pas de token revocation (blacklist)
  
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
```

**Scénario d'attaque:**
```javascript
// Attaquant vole le JWT du cookie/localStorage via XSS
const token = document.cookie.split('auth=')[1];
// Maintenant il peut accéder comme l'utilisateur:
fetch('/api/projects', {
  headers: { 'Authorization': `Bearer ${token}` }
});

// Ou avec un client volé, accéder PENDANT 7 JOURS!
// Aucun moyen pour la victime de révoquer le token
```

#### ✅ Correction Requise:
```javascript
// 1. Implémenter token blacklist (Redis/DB)
const TOKEN_BLACKLIST = new Set();

export function revokeToken(token) {
  TOKEN_BLACKLIST.add(token);
  // Nettoyer après expiration du token
  setTimeout(() => TOKEN_BLACKLIST.delete(token), 7 * 24 * 60 * 60 * 1000);
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : null;
  
  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.split(';').find(s => s.trim().startsWith('auth='));
    if (match) token = decodeURIComponent(match.slice(5));
  }
  
  if (!token) return res.status(401).json({ error: 'Missing token' });
  
  // Vérifier blacklist
  if (TOKEN_BLACKLIST.has(token)) {
    return res.status(401).json({ error: 'Token revoked' });
  }
  
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // ✅ Ajouter timestamp de validation
    if (payload.iat < Date.now() / 1000 - 604800) { // 7 jours
      return res.status(401).json({ error: 'Token expired' });
    }
    req.user = payload;
    req.token = token; // Pour revocation à la déconnexion
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
```

---

### 4. **Pas de Protection CSRF** 🔴 CROSS-SITE REQUEST FORGERY
**Impact:** Modification/suppression non autorisées via attaques CSRF

#### ❌ Problème:
```javascript
// L'application accepte des POST/PUT/DELETE sans validation CSRF
// Attaquant peut faire:
<img src="https://app.com/api/users/123/reset-password" />
// Cette requête s'exécute silencieusement avec les cookies de l'utilisateur!
```

#### ✅ Correction Requise:
```javascript
import csrf from 'csurf';

const csrfProtection = csrf({ cookie: false }); // Utiliser session/token

// Générer token CSRF
app.get('/api/csrf-token', (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Protéger les routes de modification
app.post('/api/users/:id/reset-password', csrfProtection, async (req, res) => {
  // Token CSRF doit être valide
  // ...
});
```

---

### 5. **Pas de Rate Limiting Par Route Critique** 🔴 BRUTE FORCE
**Fichier:** [server.js](server/src/server.js#L115-130)  
**Impact:** Attaque par brute-force, Énumération d'utilisateurs

#### ❌ Problèmes:
```javascript
// Rate limiter global peu utile
const globalLimiter = rateLimit({
  max: 2000, // 2000 req/15min = 2 req/sec (trop!)
});

// MANQUE: Rate limiters spécifiques pour
// - Réinitialisation mot de passe (reset)
// - Vérification email
// - Export (GoS/DoS)
```

**Scénario d'attaque:**
```bash
# 1. Énumération d'utilisateurs
for i in {1..1000}; do
  curl https://app.com/api/auth/forgot-password -d "email=user$i@company.com"
done
# Attaquant peut deviner quels emails existent!

# 2. Brute-force mot de passe (avec emailRateLimiter faible)
# 20 tentatives en 5 minutes = très lent mais possible avec proxy

# 3. Export massif (DoS)
for i in {1..100}; do
  curl "https://app.com/api/exports/summary/$i" -o file$i.xlsx &
done
# Surcharge CPU/mémoire serveur
```

---

### 6. **Variables d'Environnement Non Sécurisées** 🔴
**Fichier:** [server.js](server/src/server.js#L28-39)  
**Impact:** Fuite de données, Accès non autorisé

#### ❌ Problèmes:
```javascript
// Vérification JWT_SECRET insuffisante
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me' || 
    process.env.JWT_SECRET.length < 32) {
  // ERROR - mais comment en prod?
  process.exit(1);
}

// MANQUE: Vérification pour
// - EMAIL_PASS (mot de passe SMTP exposé)
// - DATABASE_URL (credentials en clair?)
// - SECRET_KEY supplémentaire
// - ALLOWED_ORIGINS (non vérifiée en prod)
```

**Scénario d'attaque:**
```bash
# Si APPLICATION_SETTINGS exposée (logs, dumps, sourcemaps):
process.env.EMAIL_PASS = "smtp_password_123"
# Attaquant obtient accès à tous les comptes email

# Si DATABASE_URL visible:
# postgresql://admin:password@db.render.com:5432/prod_db
# Attaquant peut se connecter directement!
```

---

## ⚠️ VULNÉRABILITÉS MAJEURES (Severity: 7-8/10)

### 7. **Pas de Validation de Rôle Granulaire** 🟠 ESCALADE DE PRIVILÈGES
**Fichier:** [middleware.roles.js](server/src/middleware.roles.js), [utils.permissions.js](server/src/utils.permissions.js)  
**Impact:** Accès aux données d'autres utilisateurs

#### ❌ Problème:
```javascript
async function canViewProject(userId, projectId, userRole) {
  // ✅ Bon - vérifie le rôle
  if (userRole === 'admin' || userRole === 'responsable') {
    return true;
  }
  
  // ❌ MAIS: Pas de vérification pour les OBJECTS imbriqués
  // Exemple: Un visionneur peut voir son lot, mais peut-il voir les offres d'autres visionneurs?
  // Cette logique n'est vérifiée que au niveau du projet, pas au niveau item/offer
}
```

---

### 8. **Exposition de Métadonnées Sensibles** 🟠 INFORMATION DISCLOSURE
**Fichier:** [middleware.errors.js](server/src/middleware.errors.js#L45-60)  
**Impact:** Information sur l'architecture du système

#### ❌ Problème:
```javascript
// En développement, la stack trace est exposée!
if (process.env.NODE_ENV !== 'production' && err.stack) {
  response.stack = err.stack;  // 🔴 DANGER si production leak
}

// Les codes d'erreur PostgreSQL sont visibles:
// 23505 = Unique constraint
// 23503 = Foreign key
// Attaquant peut mapper la structure BD!
```

---

### 9. **Pas de Rate Limiting Sur Les Exports** 🟠 DENIAL OF SERVICE
**Fichier:** [routes/exports.js](server/src/routes/exports.js)  
**Impact:** Crash serveur, DoS

#### ❌ Problème:
```javascript
router.get('/summary/:roundId', async (req, res) => {
  // ❌ Pas de vérification de taille fichier
  // ❌ Pas de timeout sur la génération
  // ❌ Pas de limite sur le nombre d'exports simultanés
  
  // Attaquant peut faire:
  for (let i = 0; i < 1000; i++) {
    fetch(`/api/exports/summary/${i}`).then(r => r.blob()); // 1000 exports simultanés!
  }
  // Serveur: Crash OOM!
});
```

---

### 10. **Pas de Logging/Audit Trail** 🟠 NON-COMPLIANCE
**Impact:** Impossible d'enquêter sur les incidents, Violation RGPD

#### ❌ Problème:
```javascript
// Aucune table d'audit pour tracer:
// - Qui a accédé à quoi?
// - Qui a modifié les données?
// - Quand les permissions ont changé?
// - Qui a exporté les données?
// 
// Obligation légale: Traçabilité RGPD
```

---

## ⚡ VULNÉRABILITÉS MINEURES (Severity: 5-6/10)

### 11. **Pas de HTTPS Forcé** 🟡
**Impact:** Man-in-the-middle, Vol de credentials

#### ❌ Problème:
```javascript
res.cookie('auth', token, {
  secure: isProd,  // ✅ OK
  sameSite: 'lax', // ⚠️ Devrait être 'strict'
});

// MANQUE: Pas de redirection HTTP -> HTTPS
// MANQUE: Pas de HSTS preload
```

---

### 12. **Email Validation Faible** 🟡
**Fichier:** [routes/auth.js](server/src/routes/auth.js#L26)  
**Impact:** Inscription avec faux emails, Enumération

#### ❌ Problème:
```javascript
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  // MAUVAIS regex! Accepte: a@b.c (3 lettres!)
  // Devrait: /^[a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
}
```

---

### 13. **Mot de Passe Faible Lors du Reset** 🟡
**Fichier:** [routes/users.js](server/src/routes/users.js#L131-136)  
**Impact:** Comptes hackables après reset

#### ❌ Problème:
```javascript
if (!password || password.length < 6) {
  // ❌ Min 6 caractères?! Devrait être 12+ avec complexité
  return res.status(400).json({ error: 'Mot de passe trop court' });
}

// MANQUE: Validation de complexité (upper, lower, number, symbol)
```

---

### 14. **Pas de Timeout de Session** 🟡
**Impact:** Sessions ouvertes indéfiniment

#### ❌ Problème:
```javascript
res.cookie('auth', token, {
  maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 jours!
  // MANQUE: Session timeout inactivité (ex: 30 min)
});
```

---

### 15. **Pas de Validation de Contenu** 🟡
**Fichier:** [middleware.security.js](server/src/middleware.security.js#L67-77)  
**Impact:** Injection de caractères nuls, XSS stocké

#### ❌ Problème:
```javascript
export function sanitizeInput(req, res, next) {
  const sanitize = (obj) => {
    if (typeof obj === 'string') {
      return obj.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
      // ✅ Bon - supprime caractères nuls
      // ❌ MAIS: Ne nettoie pas HTML/JavaScript
      // Attaquant peut faire: "<script>alert('XSS')</script>"
    }
  };
}
```

---

## 🔧 PLAN D'ACTION IMMÉDIAT

### Phase 1: CRITIQUE (Faire AVANT le déploiement)
- [ ] Corriger CORS - Whitelist stricte d'origines
- [ ] Ajouter CSRF protection sur POST/PUT/DELETE
- [ ] Valider tous les params numériques
- [ ] Implémenter token blacklist/revocation
- [ ] Vérifier .env n'est pas exposé en production

### Phase 2: MAJEUR (Semaine 1)
- [ ] Ajouter audit logging (table `audit_logs`)
- [ ] Implémenter rate limiting granulaire
- [ ] Ajouter 2FA (Time-based OTP)
- [ ] Forcer HTTPS + HSTS

### Phase 3: IMPORTANT (Semaine 2)
- [ ] Validation de mot de passe stricte
- [ ] Timeout de session inactivité
- [ ] Meilleur nettoyage des inputs (DOMPurify côté front)
- [ ] Tests de pénétration

---

## 📊 Matrice de Sévérité

| Vuln | Titre | Exploitabilité | Impact | Sévérité |
|------|-------|-----------------|--------|----------|
| 1 | CORS Trop Permissif | 🔴 Très Facile | 🔴 Critique | **10/10** |
| 2 | SQL Injection | 🔴 Très Facile | 🔴 Critique | **9/10** |
| 3 | Token Hijacking | 🟠 Facile | 🔴 Critique | **9/10** |
| 4 | No CSRF | 🟠 Facile | 🟠 Majeur | **8/10** |
| 5 | Rate Limit Faible | 🟠 Facile | 🟠 Majeur | **8/10** |
| 6 | .env Non Sécurisé | 🟡 Moyen | 🔴 Critique | **9/10** |
| 7 | RBAC Faible | 🟠 Facile | 🟠 Majeur | **7/10** |
| 8 | Info Disclosure | 🟡 Moyen | 🟡 Mineur | **6/10** |
| 9 | DoS Export | 🟡 Moyen | 🟠 Majeur | **7/10** |
| 10 | No Audit Log | 🟢 N/A | 🟡 Compliance | **6/10** |
| 11 | HTTPS Faible | 🟡 Moyen | 🟡 Mineur | **5/10** |
| 12 | Email Weak | 🟡 Moyen | 🟡 Mineur | **5/10** |
| 13 | Password Weak | 🟡 Moyen | 🟠 Majeur | **7/10** |
| 14 | No Timeout | 🟡 Moyen | 🟠 Majeur | **7/10** |
| 15 | Input Validation | 🟡 Moyen | 🟡 Mineur | **6/10** |

---

## ✅ Checklist de Conformité Production

- [ ] JWT_SECRET: Min 64 caractères aléatoires
- [ ] ALLOWED_ORIGINS: Configuré explicitement (pas * ni localhost)
- [ ] DATABASE_URL: HTTPS/SSL obligatoire
- [ ] EMAIL_PASS: Stocké dans secret manager (pas en .env)
- [ ] CORS: Whitelist stricte
- [ ] CSRF: Token sur toutes les mutations
- [ ] Rate Limits: Configurés pour toutes les routes critiques
- [ ] 2FA: Activé pour admin
- [ ] Logs: Centralisés et sécurisés
- [ ] Backup: Chiffré et hors-site
- [ ] Tests de pénétration: Passés
- [ ] OWASP Top 10: Toutes les vulns adressées

---

## 📞 Support

Pour questions/clarifications: Consultez SECURITY.md ou contactez l'équipe de sécurité.

