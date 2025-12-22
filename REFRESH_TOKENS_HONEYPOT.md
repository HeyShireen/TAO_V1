# Refresh Tokens & Honeypot Fields - Documentation de mise en œuvre

**Deux nouvelles couches de sécurité avancée pour TAO V1**

---

## 1️⃣ REFRESH TOKENS (Token Rotation)

### Concept

Les **refresh tokens** permettent une rotation automatique des JWT sans demander à l'utilisateur de se reconnecter.

**Avant** (actuel) :
- JWT valide 7 jours
- Si JWT volé : accès pendant 7 jours

**Après** (nouveau) :
- JWT court terme : 15 minutes
- Refresh token long terme : 30 jours
- Rotation automatique : nouveau JWT tous les 15 min
- Détection d'abus : 2 utilisations simultanées = tous les tokens révoqués

### Architecture

#### Base de données (migration 019)

```sql
CREATE TABLE refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  token VARCHAR(255) UNIQUE,  -- Token aléatoire 32 bytes
  family VARCHAR(255),         -- Groupe (détecte les rotations suspectes)
  expires_at TIMESTAMPTZ,      -- 30 jours
  revoked_at TIMESTAMPTZ,      -- Si logout ou abus détecté
  rotation_count INT            -- Nombre de rotations
);

CREATE TABLE suspicious_token_attempts (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  token_family VARCHAR(255),
  ip_address VARCHAR(45),
  user_agent TEXT,
  attempted_at TIMESTAMPTZ
);
```

#### Workflow

```
1. LOGIN (POST /api/auth/login)
   ↓
   Client envoie : { email, password }
   Serveur retourne : { token, refreshToken }
   
2. Cookies définis :
   - auth = JWT (15 min)
   - refreshToken = Token (30 j)

3. Appels API (GET /api/projects, etc.)
   ↓
   Header: Authorization: Bearer <JWT>
   
4. JWT expire après 15 min
   ↓
   Frontend détecte erreur 401
   
5. REFRESH (POST /api/auth/refresh)
   ↓
   Cookie: refreshToken
   
6. Rotation effectuée :
   ↓
   Ancien token : révoqué
   Nouveau token : généré (même famille)
   Rotation count : +1
   
   Si 2 utilisations du même token en < 10 sec :
   → TOUS les tokens de la famille révoqués
   → Email d'alerte
   → Reconnecter l'utilisateur

7. Nouveaux cookies :
   - auth = Nouveau JWT (15 min)
   - refreshToken = Nouveau token (30 j)
```

### Endpoints

#### `POST /api/auth/login`
```javascript
Request: { email, password }
Response: {
  token: "eyJhbGc...",          // JWT court (15 min)
  user: { id, email, role }
}
Cookies: 
  - auth = JWT (HttpOnly, 15 min)
  - refreshToken = Token (HttpOnly, 30 j)
```

#### `POST /api/auth/refresh`
**Rotation automatique du token**
```javascript
Request: (automatique, lit le cookie refreshToken)
Response: {
  token: "eyJhbGc...",          // Nouveau JWT
  refreshToken: "a1b2c3d4...",  // Nouveau token rotationné
  user: { id, email, role }
}
Cookies: 
  - auth = Nouveau JWT
  - refreshToken = Nouveau token
```

#### `POST /api/auth/logout`
**Déconnexion simple**
```javascript
Request: Authorization: Bearer <JWT>
Response: { ok: true }
Cookies supprimés : auth, refreshToken
DB : JWT + refresh token révoqués
```

#### `POST /api/auth/logout-everywhere`
**Déconnexion de TOUS les appareils (sécurité)**
```javascript
Request: Authorization: Bearer <JWT>
Response: { ok: true, message: "Déconnecté de tous les appareils" }
DB : TOUS les refresh tokens de l'utilisateur révoqués
Effet : Toutes les sessions terminées
```

### Frontend : Comment implémenter

```javascript
// Dans app.js ou login.js

// 1. Helper pour appels API avec auto-refresh
async function api(url, options = {}) {
  let response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  })
  
  // 2. Si 401 (JWT expiré) → Refresh automatique
  if (response.status === 401) {
    console.log('🔄 JWT expiré, refresh...')
    const refreshResponse = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include' // Envoie les cookies
    })
    
    if (!refreshResponse.ok) {
      // Refresh échoué = reconnecter
      window.location.href = '/login'
      throw new Error('Session expirée')
    }
    
    const { token } = await refreshResponse.json()
    localStorage.setItem('token', token) // Sauvegarder nouveau JWT
    
    // 3. Réessayer la requête originale
    response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    })
  }
  
  return response
}

// 4. Logout sécurisé
async function logout() {
  await api('/api/auth/logout', { method: 'POST' })
  localStorage.removeItem('token')
  window.location.href = '/login'
}

// 5. Logout everywhere (sécurité)
async function logoutEverywhere() {
  await api('/api/auth/logout-everywhere', { method: 'POST' })
  localStorage.removeItem('token')
  window.location.href = '/login'
  alert('Déconnecté de tous les appareils')
}
```

### Détection d'abus

Si deux tentatives d'utilisation du même refresh token en < 10 secondes :

1. **Tous les tokens de la famille révoqués**
2. **Tentative loggée** en DB (suspicious_token_attempts)
3. **Alerte générale** après 3 tentatives en 1h
4. **Email d'alerte** envoyé à l'utilisateur
5. **Reconnecter obligatoire**

```sql
-- Voir les tentatives suspectes
SELECT * FROM suspicious_token_attempts 
WHERE user_id = 123 AND attempted_at > NOW() - INTERVAL '24 hours'
ORDER BY attempted_at DESC;
```

---

## 2️⃣ HONEYPOT FIELDS (Anti-Bots)

### Concept

Les **honeypot fields** sont des champs cachés dans les formulaires que les bots remplissent automatiquement, mais les humains ne voient pas.

**Exemple** :
```html
<!-- Utilisateur voit : email + password -->
<!-- Bot voit aussi : website_url, phone_number, company_name (cachés) -->
```

Si un champ est rempli → C'est un bot

### Implémentation

#### HTML (login.html / register.html)

```html
<form id="registerForm">
  <!-- Champs visibles -->
  <input type="email" name="email" placeholder="Email" required>
  <input type="password" name="password" placeholder="Mot de passe" required>
  
  <!-- HONEYPOT FIELDS (invisibles pour les humains) -->
  <!-- Les bots les remplissent automatiquement -->
  <input type="text" name="website_url" style="display:none;" tabindex="-1" autocomplete="off">
  <input type="text" name="phone_number" style="display:none;" tabindex="-1" autocomplete="off">
  <input type="text" name="company_name" style="display:none;" tabindex="-1" autocomplete="off">
  
  <!-- Champs décoy (trompeurs) -->
  <input type="hidden" name="contact_us_asap" value="">
  <input type="hidden" name="send_password_email" value="">
  
  <button type="submit">S'inscrire</button>
</form>

<style>
  /* Masquer les honeypots de manière robuste */
  input[name="website_url"],
  input[name="phone_number"],
  input[name="company_name"],
  input[name="contact_us_asap"],
  input[name="send_password_email"] {
    position: absolute;
    left: -9999px;
    opacity: 0;
    pointer-events: none;
  }
</style>
```

#### Backend (middleware.honeypot.js)

```javascript
// Dans routes/auth.js
router.post('/login', honeypotValidator, async (req, res) => {
  // Si website_url, phone_number, ou company_name sont remplis:
  // → Middleware bloque silencieusement (répond 200 OK fake)
  // → Logs l'IP + User-Agent
  // → Pas d'alerte
})

router.post('/register', honeypotValidator, async (req, res) => {
  // Même chose
})
```

### Workflow de détection

```
1. Bot remplit le formulaire (incluant honeypots)
   ↓
   POST /api/auth/register avec website_url rempli
   
2. Middleware honeypotValidator s'exécute
   ↓
   
3. Détecte website_url rempli
   ↓
   
4. Actions silencieuses :
   - Log en DB : IP, User-Agent, champs remplis
   - Pas de réponse d'erreur (répondre "OK" fake)
   
5. Bot croit avoir réussi (réponds 200 OK)
   ↓
   
6. Réalité: Requête bloquée sans sauvegarder le compte
   
7. Si > 5 hits honeypot / heure de la même IP
   ↓
   Rate limiter bloque l'IP pour 15 min
```

### Patterns de bots détectés

```javascript
// Patterns User-Agent courants
- "bot", "crawler", "spider", "scraper"
- "curl", "python", "java-http"

// Headers manquants (bots génériques)
- Pas de accept-language
- Pas de accept-encoding

// Timing ultra-rapide (< 50ms)
- À implémenter en frontend (tracker temps submit)
```

### Logging des tentatives

```sql
-- Voir les bots détectés (dernières 24h)
SELECT * FROM honeypot_attempts 
WHERE detected_at > NOW() - INTERVAL '24 hours'
ORDER BY detected_at DESC LIMIT 100;

-- IPs les plus actives
SELECT ip_address, COUNT(*) as attempts 
FROM honeypot_attempts
WHERE detected_at > NOW() - INTERVAL '1 hour'
GROUP BY ip_address
ORDER BY attempts DESC;
```

---

## Checklist d'implémentation

### Backend
- [x] Migration 019 : refresh_tokens table
- [x] Migration 020 : honeypot_attempts table
- [x] utils.refresh-tokens.js : Gestion rotations
- [x] middleware.honeypot.js : Validation honeypot
- [x] routes/auth.js : Endpoints /refresh, /logout-everywhere
- [ ] Endpoint GET /api/auth/honeypot-fields (retourner champs)
- [ ] Cron job : nettoyage tokens expirés (quotidien)
- [ ] Email d'alerte : tentatives suspectes

### Frontend
- [ ] Intégrer honeypot fields dans login.html
- [ ] Intégrer honeypot fields dans register.html
- [ ] Auto-refresh JWT dans app.js (fonction api())
- [ ] Bouton logout vs logout-everywhere
- [ ] Timer visuel (JWT expire dans X min)

### Documentation
- [x] Ce fichier (REFRESH_TOKENS_HONEYPOT.md)
- [ ] Guide utilisateur (security best practices)
- [ ] Tests (curl commands)

---

## Tests

### Test Honeypot (Bot simulation)

```bash
# Le bot remplit les honeypots
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "bot@example.com",
    "password": "Password123!",
    "website_url": "http://spam.com",
    "phone_number": "1234567890"
  }'

# Réponse: 200 OK (fake success)
# Reality: Compte non créé, IP loggée
```

### Test Refresh Token (Abuse detection)

```bash
# 1. Login
TOKEN=$(curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"Password123!"}' \
  -c cookies.txt | jq -r '.token')

# 2. Utiliser refresh token 2 fois rapidement
curl -X POST http://localhost:4000/api/auth/refresh \
  -b cookies.txt
sleep 0.5
curl -X POST http://localhost:4000/api/auth/refresh \
  -b cookies.txt

# Résultat: 2e tentative échoue
# → "Refresh token réutilisé, tous les tokens révoqués"
```

---

## Coûts / Bénéfices

### Refresh Tokens
| Aspect | Avant | Après |
|--------|-------|-------|
| **Durée token** | 7 jours | 15 min |
| **Sécurité vol JWT** | Haute durée | Fenêtre courte |
| **Abus détecté** | Non | Oui (famille) |
| **Revocation tokens** | Non | Oui (logout everywhere) |
| **Complexité** | Faible | Moyenne |

### Honeypot Fields
| Aspect | Avant | Après |
|--------|-------|-------|
| **Bots bloqués** | Non | ~90% des bots |
| **False positives** | N/A | ~0% (humains normaux) |
| **Complexité** | N/A | Très faible |
| **Coût serveur** | N/A | Minimal |

---

## Références

- [JWT Best Practices](https://tools.ietf.org/html/rfc8949)
- [Honeypot Fields](https://en.wikipedia.org/wiki/Honeypot_(computing))
- [OWASP: Token Rotation](https://owasp.org/www-community/attacks/Session_fixation)
