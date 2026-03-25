# 🛡️ Sécurité AO Link - Documentation

## Headers de Sécurité (Helmet.js)

### ✅ Content Security Policy (CSP)
- **Protection** : Bloque les scripts/styles malveillants (XSS)
- **Config** : Autorise uniquement les ressources de notre domaine
- **Impact** : Empêche l'injection de code externe

### ✅ HTTP Strict Transport Security (HSTS)
- **Protection** : Force HTTPS pendant 1 an
- **Config** : `max-age=31536000, includeSubDomains, preload`
- **Impact** : Impossible d'accéder en HTTP (protection MITM)

### ✅ X-Frame-Options
- **Protection** : Anti-clickjacking
- **Config** : `DENY` (impossible d'intégrer dans une iframe)
- **Impact** : Empêche les attaques par overlay

### ✅ X-Content-Type-Options
- **Protection** : Anti-MIME sniffing
- **Config** : `nosniff`
- **Impact** : Le navigateur respecte le Content-Type

### ✅ Referrer-Policy
- **Protection** : Contrôle les informations de referer
- **Config** : `strict-origin-when-cross-origin`
- **Impact** : Limite les fuites d'URLs internes

## Rate Limiting

### 🚦 Global API Limiter
```javascript
Limite : 100 requêtes / 15 minutes par IP
Scope  : Toutes les routes /api/*
Action : Retour 429 "Trop de requêtes"
```

### 🔐 Auth Limiter (IP)
```javascript
Limite : 5 tentatives / 15 minutes par IP
Scope  : /api/auth/* (login, register)
Reset  : Uniquement sur échec (skipSuccessfulRequests)
Action : Blocage 15 minutes
```

### 📧 Email Limiter (par email)
```javascript
Limite : 5 tentatives / 15 minutes par email
Scope  : Login uniquement
Protection : Force brute multi-IP
Reset  : Automatique après login réussi
Cleanup : Toutes les heures
```

**Avantage** : Même si l'attaquant change d'IP (VPN, proxy), l'email reste bloqué.

## Protections Anti-Injection

### 🧹 Input Sanitizer
- Nettoie **tous** les inputs (body, query, params)
- Supprime les caractères de contrôle (`\x00-\x1F`)
- Prévient les injections null bytes

### 🔢 Numeric ID Validator
- Valide que les IDs sont numériques
- Empêche les injections via params d'URL
- Exemple : `/api/projects/123' OR 1=1--` → Rejeté

### 🗄️ SQL Injection
- **Protection** : Prepared statements partout (`$1, $2, $3`)
- **Validation** : Aucune concaténation de strings SQL
- **Impact** : Impossible d'injecter du SQL

## Protections DDoS

### 🌊 Limitations
1. **Par IP** : 100 req/15min sur toute l'API
2. **Par Email** : 5 tentatives auth/15min
3. **JSON Size** : Limité à 10MB (`express.json({ limit: '10mb' })`)

### 📊 Monitoring Recommandé (à ajouter)
- Logs des IPs bloquées
- Alertes sur > 50 req/min d'une même IP
- Dashboard temps réel (optionnel : Grafana)

## Mots de Passe

### 🔒 Hashing
- **Algorithme** : bcrypt
- **Rounds** : 10 (compromise temps/sécurité)
- **Salting** : Automatique par bcrypt

### ✅ Validation
- Minimum 8 caractères
- Format email validé (regex)
- Pas de réutilisation (à implémenter si besoin)

## JWT

### 🎫 Token
- **Secret** : Min 32 caractères (validé au démarrage)
- **Expiration** : 7 jours
- **Payload** : `{ id, email, role }`
- **Storage** : localStorage côté client

### ⚠️ Limites Connues
- Pas de révocation (jusqu'à expiration)
- Pas de refresh token (à implémenter pour améliorer)

## Email Verification

### 📧 Workflow
1. Inscription → Token unique (32 bytes random)
2. Email envoyé avec lien `/api/auth/verify-email/:token`
3. Token valide 24h
4. Connexion bloquée si non vérifié

### 🔐 Sécurité Token
- Crypto.randomBytes (cryptographiquement sûr)
- Stocké en DB, jamais réutilisable
- Expire automatiquement

## CORS

### 🌐 Configuration
- **Développement** : Permissif (localhost)
- **Production** : Same-origin uniquement
- **Credentials** : Activés (cookies/auth headers)

## Variables Sensibles

### ⚠️ À NE JAMAIS COMMITER
```
JWT_SECRET
DATABASE_URL (avec credentials)
EMAIL_PASS
```

### ✅ Configuration Render
Toutes les variables sensibles dans Dashboard > Environment

## Améliorations Futures

### 🔜 Niveau 2 (Optionnel)
1. **Redis** pour rate limiting partagé (multi-instances)
2. **Refresh tokens** avec rotation
3. **2FA** (TOTP via Google Authenticator)
4. **CAPTCHA** après N échecs de login
5. **IP Whitelist** pour routes admin
6. **Audit logs** complets (qui a fait quoi, quand)
7. **Honeypot fields** (anti-bots)

### 🔜 Niveau 3 (Entreprise)
1. **WAF** (Web Application Firewall)
2. **DDoS Protection** (Cloudflare, AWS Shield)
3. **Pen Testing** régulier
4. **Bug Bounty Program**

## Checklist Production

- [ ] `NODE_ENV=production` sur Render
- [ ] JWT_SECRET unique (64+ chars)
- [ ] DATABASE_URL avec credentials sécurisés
- [ ] HSTS activé (HTTPS only)
- [ ] Rate limits configurés
- [ ] Email SMTP configuré
- [ ] `.env` dans `.gitignore`
- [ ] Logs monitoring actifs
- [ ] Backups DB automatiques

## Tests de Sécurité

### 🧪 À Tester Régulièrement
```bash
# Test rate limiting
for i in {1..10}; do curl -X POST http://localhost:4000/api/auth/login -d '{"email":"test","password":"test"}' -H "Content-Type: application/json"; done

# Test SQL injection
curl http://localhost:4000/api/projects/1'%20OR%201=1--

# Test XSS
curl -X POST http://localhost:4000/api/projects -d '{"name":"<script>alert(1)</script>"}' -H "Authorization: Bearer TOKEN"

# Test CSP
# Ouvrir DevTools → Network → Headers → Vérifier Content-Security-Policy
```

## Contacts Sécurité

- **Responsable** : [Votre email]
- **Incident** : [Email d'urgence]
- **Render Support** : support@render.com
