# ⚙️ 05_INFRASTRUCTURE - Configuration Production

Configurations sécurisées pour déployer en production.

---

## 📄 Fichiers dans ce dossier

### 1. **nginx.conf**
- **Format:** Nginx configuration
- **Usage:** Production web server
- **Contient:**
  - SSL/TLS configuration (Let's Encrypt)
  - Security headers (HSTS, CSP, etc.)
  - Rate limiting by endpoint
  - CORS handling
  - Reverse proxy to Node.js
  - Protection contre attaques communes

### 2. **docker-compose.yml**
- **Format:** Docker Compose
- **Usage:** Développement + Production
- **Services:**
  - App Node.js
  - PostgreSQL database
  - Nginx reverse proxy
- **Features:**
  - Health checks
  - Environment variables
  - Security settings
  - Volume management

### 3. **Dockerfile**
- **Format:** Docker image definition
- **Usage:** Containerization
- **Features:**
  - Non-root user (nodejs)
  - Minimal image (alpine)
  - Health check
  - Security context

### 4. **systemd-service.conf**
- **Format:** Systemd unit file
- **Usage:** Linux service management
- **Features:**
  - Auto-restart
  - Resource limits
  - Security hardening
  - Logging configuration

---

## 🚀 Déploiement Rapide

### Option A: Docker Compose (Recommandé)
```bash
cd 05_INFRASTRUCTURE
docker-compose up -d
```

### Option B: Nginx + Node (Manual)
```bash
# 1. Copier nginx.conf
sudo cp nginx.conf /etc/nginx/sites-available/tao-app
sudo ln -s /etc/nginx/sites-available/tao-app /etc/nginx/sites-enabled/

# 2. Générer SSL
sudo certbot certonly --nginx -d app.example.com

# 3. Redémarrer Nginx
sudo systemctl reload nginx
```

### Option C: Systemd (Production VM)
```bash
# 1. Copier service file
sudo cp systemd-service.conf /etc/systemd/system/tao-app.service

# 2. Créer utilisateur
sudo useradd -r -s /bin/false tao-user

# 3. Activer et démarrer
sudo systemctl daemon-reload
sudo systemctl enable tao-app.service
sudo systemctl start tao-app.service
```

---

## 📋 Pre-Deployment Checklist

- [ ] Certificat SSL valide
- [ ] ALLOWED_ORIGINS configuré
- [ ] DATABASE_URL sécurisé (SSL/TLS)
- [ ] JWT_SECRET min 64 chars
- [ ] Email credentials sécurisés
- [ ] Backups configurés
- [ ] Monitoring actif
- [ ] Logs centralisés

---

## 🔐 Configuration Security

### Nginx
- ✅ HTTPS obligatoire (redirection HTTP→HTTPS)
- ✅ HSTS header (1 an)
- ✅ CSP policy strict
- ✅ Security headers complets
- ✅ Rate limiting adaptatif
- ✅ Protection fichiers sensibles

### Docker
- ✅ Non-root user
- ✅ No new privileges
- ✅ Capability dropping
- ✅ Read-only root filesystem option
- ✅ Health checks
- ✅ Resource limits

### Systemd
- ✅ Private tmp
- ✅ Protect system
- ✅ Protect home
- ✅ No new privileges
- ✅ Restrict namespaces
- ✅ Lock personality

---

## 📊 Architecture Recommandée

```
Internet
  ↓
Firewall (port 80, 443)
  ↓
Nginx (Load Balancer + WAF)
  ↓
Node.js App (×3 instances)
  ↓
PostgreSQL (Master/Replica)
  ↓
Backups (Encrypted, Off-site)
```

---

## 🔗 Intégration avec Guides

- **Pour Nginx:** Consulter [../02_GUIDES/DEPLOYMENT_SECURITY.md](../02_GUIDES/DEPLOYMENT_SECURITY.md)
- **Pour Docker:** Consulter [../02_GUIDES/DEPLOYMENT_SECURITY.md](../02_GUIDES/DEPLOYMENT_SECURITY.md)
- **Pour systemd:** Consulter [../02_GUIDES/DEPLOYMENT_SECURITY.md](../02_GUIDES/DEPLOYMENT_SECURITY.md)

---

## 💡 Support

**Nginx questions?** Consulter [../02_GUIDES/DEPLOYMENT_SECURITY.md](../02_GUIDES/DEPLOYMENT_SECURITY.md) section Nginx

**Docker questions?** Consulter [../02_GUIDES/DEPLOYMENT_SECURITY.md](../02_GUIDES/DEPLOYMENT_SECURITY.md) section Docker

**SSL issues?** Utiliser certbot: `certbot certonly --nginx -d app.example.com`

---

**Après setup:** Valider avec [../04_SCRIPTS/test-security.sh](../04_SCRIPTS/test-security.sh)

