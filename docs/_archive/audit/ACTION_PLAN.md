# 🎯 ACTION PLAN - ÉTAPES À SUIVRE IMMÉDIATEMENT

## ⚠️ SITUATION ACTUELLE: APPLICATION NON CONFORME PRODUCTION

Cette application présente **15 vulnérabilités majeures** dont certaines **critiques (CVSS 9-10)**. 
**NE PAS DÉPLOYER en production sans appliquer ces corrections.**

---

## 📅 TIMELINE RECOMMANDÉE

### 🔴 JOUR 1: Corrections Critiques (4-6 heures)

#### 1. Sauvegarder + Créer branche de sécurité
```bash
git checkout -b security/critical-fixes
git commit -m "backup: pre-security-audit"
```

#### 2. Mettre à jour .env.production
```bash
# ❌ ACTUELLEMENT NON SÉCURISÉ
JWT_SECRET=change-me

# ✅ À GÉNÉRER
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ALLOWED_ORIGINS=https://app.example.com,https://www.example.com
DATABASE_URL=postgresql://secure-user:secure-pass@secure-host:5432/prod_db
EMAIL_PASS=votre-app-password-depuis-SendGrid-ou-autre
```

#### 3. Corriger le CORS dans server.js
```javascript
// Remplacer la config CORS permissive (ligne 46-74)
// par la version sécurisée de middleware.security-fixes.js
```

#### 4. Ajouter validation de paramètres numériques
```bash
grep -r "req.params.id" server/src/routes/ | wc -l
# Résultat: ~15 endpoints sans validation
```

Appliquer `validateNumericId` middleware sur TOUS les endpoints.

#### 5. Remplacer routes/auth.js par la version sécurisée
```bash
cp server/src/routes/auth-secured.js server/src/routes/auth.js
```

#### 6. Configurer HTTPS forcé
Ajouter redirection HTTP → HTTPS dans server.js et nginx.

#### 7. Tester localement
```bash
npm test  # (si tests existent)
./test-security.sh http://localhost:4000
```

#### 8. Créer PR pour review de sécurité
```bash
git push origin security/critical-fixes
# Créer PR sur GitHub avec checklist
```

---

### 🟠 JOUR 2-3: Améliorations Majeures (8-10 heures)

#### 9. Mettre à jour migrations (nouvelles tables)
- [ ] Exécuter migration `016_add_security_tables.sql`
- [ ] Créer table `audit_logs`
- [ ] Créer table `revoked_tokens`
- [ ] Créer table `login_attempts`

#### 10. Implémenter Token Blacklist
- [ ] Ajouter logique de revocation dans logout
- [ ] Tester revocation de token

#### 11. Ajouter Rate Limiting granulaire
```bash
grep -r "rateLimit" server/src/routes/ | wc -l
# Ajouter sur: auth, password-reset, exports
```

#### 12. Audit Logging
- [ ] Créer middleware auditLog()
- [ ] Appeler auditLog() sur tous les CREATE/UPDATE/DELETE
- [ ] Vérifier logs dans audit_logs table

#### 13. Forcer HTTPS + HSTS
```javascript
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && 
      req.header('x-forwarded-proto') !== 'https') {
    return res.redirect(`https://${req.header('host')}${req.url}`);
  }
  next();
});
```

#### 14. Configuration Nginx Production
- [ ] Copier `DEPLOYMENT_SECURITY.md` nginx config
- [ ] Générer certificat Let's Encrypt
- [ ] Tester avec ssllabs.com

#### 15. Tests de pénétration basiques
```bash
# SQL injection
curl "http://localhost/api/projects/1' OR '1'='1"

# CORS
curl -H "Origin: https://attacker.com" http://localhost/api/projects

# Rate limiting
for i in {1..20}; do curl -X POST http://localhost/api/auth/login; done
```

---

### 🟡 JOUR 4-5: Features Avancées (6-8 heures)

#### 16. Implémenter 2FA (optionnel mais recommandé)
- [ ] Installer `otplib` package
- [ ] Créer endpoints `/2fa/setup`, `/2fa/verify`
- [ ] Ajouter table `two_factor_secrets`
- [ ] Forcer 2FA pour admin

#### 17. Monitoring & Alertes
- [ ] Configuration Datadog ou ELK pour logs
- [ ] Configurer alertes sur événements de sécurité
- [ ] Setup Sentry pour error tracking

#### 18. Backup & Recovery Plan
- [ ] Configurer backups chiffrés automatiques
- [ ] Tester restore procedure
- [ ] Documenter RTO/RPO

---

## ✅ CHECKLIST PRE-DEPLOYMENT

```bash
# Sécurité
- [ ] CORS configuré avec whitelist stricte
- [ ] JWT_SECRET: min 64 chars aléatoires
- [ ] DATABASE_URL avec SSL/TLS
- [ ] HTTPS obligatoire (redirection + HSTS)
- [ ] Tous les paramètres numériques validés
- [ ] Token blacklist/revocation implémenté
- [ ] Rate limiting sur auth + exports
- [ ] Password validation stricte (12+ chars, complexité)
- [ ] Audit logging actif
- [ ] .env.production sécurisé (git ignored)

# Infrastructure
- [ ] NGINX configuré avec security headers
- [ ] SSL/TLS certificat valide (Let's Encrypt)
- [ ] Firewall configuré
- [ ] Logs centralisés
- [ ] Backups testés

# Testing
- [ ] npm audit clean
- [ ] test-security.sh: 100%
- [ ] Load testing: 1000 req/min OK
- [ ] Penetration test: 0 vulnerabilités critiques
- [ ] Test de recovery: backup restore OK

# Documentation
- [ ] SECURITY.md mis à jour
- [ ] Incident response plan documenté
- [ ] Admin manual pour 2FA
- [ ] Credential rotation schedule défini
```

---

## 🚀 DÉPLOIEMENT SÉCURISÉ

### Option A: Render (Recommandé pour MVP)

```yaml
# render.yaml
services:
  - type: web
    name: tao-app
    runtime: node
    buildCommand: cd server && npm install
    startCommand: cd server && npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: JWT_SECRET
        sync: false  # Manual set dans Render dashboard
      - key: DATABASE_URL
        fromDatabase:
          name: tao-db
          property: connectionString
      - key: ALLOWED_ORIGINS
        value: https://app.example.com
    
  - type: pserv
    name: tao-db
    service: postgresql
    plan: starter
    maxConnections: 100
    properties:
      version: "15"
```

### Option B: Docker + DigitalOcean

```bash
# Build image
docker build -t tao-app:latest .

# Push to registry
docker push your-registry/tao-app:latest

# Deploy via DigitalOcean CLI
doctl apps create --spec app.yaml
```

### Option C: Kubernetes (Enterprise)

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tao-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: tao-app
  template:
    metadata:
      labels:
        app: tao-app
    spec:
      securityContext:
        fsGroup: 1001
      containers:
        - name: app
          image: your-registry/tao-app:latest
          securityContext:
            runAsNonRoot: true
            runAsUser: 1001
            capabilities:
              drop:
                - ALL
          env:
            - name: NODE_ENV
              value: "production"
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: app-secrets
                  key: jwt-secret
          livenessProbe:
            httpGet:
              path: /api/healthz
              port: 4000
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /api/healthz
              port: 4000
            initialDelaySeconds: 5
            periodSeconds: 5
```

---

## 🔍 TESTS POST-DEPLOYMENT

```bash
#!/bin/bash
# test-production.sh

APP_URL="https://app.example.com"

echo "🧪 Tests Post-Deployment"

# 1. Vérifier HTTPS
curl -I $APP_URL | grep "Strict-Transport-Security"

# 2. Tester login
curl -X POST $APP_URL/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"pass"}'

# 3. Vérifier token expiration
TOKEN=$(curl ... | jq '.token')
sleep 7200  # Wait 2 hours
curl -H "Authorization: Bearer $TOKEN" $APP_URL/api/projects  # Should fail

# 4. Test rate limiting
for i in {1..100}; do
  curl -X POST $APP_URL/api/auth/login &
done
# Should see 429 errors after limit

# 5. Vérifier CORS
curl -H "Origin: https://attacker.com" $APP_URL/api/projects
# Should be blocked
```

---

## 📞 ESCALADE D'INCIDENTS

En cas de problème de sécurité en production:

### CRITIQUE (Breach détecté)
1. Isoler le serveur du réseau
2. Prendre snapshot de l'état
3. Restaurer depuis backup
4. Notifier: Clients + DPO
5. Audit complet

### MAJEUR (Attaque en cours)
1. Activer rate limiting maximal
2. Bloquer IPs malveillantes
3. Vérifier logs d'audit
4. Rotater secrets

### MINEUR (Tentative d'exploit)
1. Monitorer activité
2. Documenter dans incident log
3. Analyser à froid

---

## 📚 RESSOURCES

- [OWASP Top 10 2023](https://owasp.org/www-project-top-ten/)
- [CWE-200: Information Exposure](https://cwe.mitre.org/data/definitions/200.html)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Express Security](https://expressjs.com/en/advanced/best-practice-security.html)
- [PostgreSQL Security](https://www.postgresql.org/docs/current/sql-syntax.html)

---

## 👥 RESPONSABILITÉS

| Rôle | Tâche |
|------|-------|
| **Dev Lead** | Implémenter corrections + Superviser tests |
| **DevOps** | Configurer infrastructure + Certificats SSL |
| **QA** | Tests de sécurité + Penetration testing |
| **Product** | Communiquer avec clients + Gestion d'incidents |
| **Security** | Audit + Validation finale + Monitoring |

---

## ⏰ VALIDATION FINALE

Avant de déclarer "PRODUCTION-READY":

- [ ] Security Audit: PASSÉ
- [ ] Penetration Test: 0 vulnérabilités critiques
- [ ] Load Test: 10,000 requêtes/min OK
- [ ] Disaster Recovery: Testé avec succès
- [ ] Compliance: RGPD, HIPAA (si applicable)
- [ ] Sign-off: CTO + Security Officer

---

## ✍️ NOTES FINALES

Cette application **était dangereuse** pour la production. Les corrections proposées la rendent **acceptable** mais pas **entreprise-ready**. 

Pour un système critique:
- Ajouter 2FA obligatoire
- Implémenter Zero-Trust architecture
- Faire pen-test professionnel
- Obtenir certification SOC2/ISO27001
- Mettre en place EDR (Endpoint Detection & Response)

**Timeframe total: 2-3 semaines (avec équipe de 3-4 personnes)**

