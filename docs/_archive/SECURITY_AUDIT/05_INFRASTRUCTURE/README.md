# âš™ï¸ 05_INFRASTRUCTURE - Configuration Production

Configurations sÃ©curisÃ©es pour dÃ©ployer en production.

---

## ðŸ“„ Fichiers dans ce dossier

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
- **Usage:** DÃ©veloppement + Production
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

## ðŸš€ DÃ©ploiement Rapide

### Option A: Docker Compose (RecommandÃ©)
```bash
cd 05_INFRASTRUCTURE
docker-compose up -d
```

### Option B: Nginx + Node (Manual)
```bash
# 1. Copier nginx.conf
sudo cp nginx.conf /etc/nginx/sites-available/aolink-app
sudo ln -s /etc/nginx/sites-available/aolink-app /etc/nginx/sites-enabled/

# 2. GÃ©nÃ©rer SSL
sudo certbot certonly --nginx -d app.example.com

# 3. RedÃ©marrer Nginx
sudo systemctl reload nginx
```

### Option C: Systemd (Production VM)
```bash
# 1. Copier service file
sudo cp systemd-service.conf /etc/systemd/system/aolink-app.service

# 2. CrÃ©er utilisateur
sudo useradd -r -s /bin/false aolink-user

# 3. Activer et dÃ©marrer
sudo systemctl daemon-reload
sudo systemctl enable aolink-app.service
sudo systemctl start aolink-app.service
```

---

## ðŸ“‹ Pre-Deployment Checklist

- [ ] Certificat SSL valide
- [ ] ALLOWED_ORIGINS configurÃ©
- [ ] DATABASE_URL sÃ©curisÃ© (SSL/TLS)
- [ ] JWT_SECRET min 64 chars
- [ ] Email credentials sÃ©curisÃ©s
- [ ] Backups configurÃ©s
- [ ] Monitoring actif
- [ ] Logs centralisÃ©s

---

## ðŸ” Configuration Security

### Nginx
- âœ… HTTPS obligatoire (redirection HTTPâ†’HTTPS)
- âœ… HSTS header (1 an)
- âœ… CSP policy strict
- âœ… Security headers complets
- âœ… Rate limiting adaptatif
- âœ… Protection fichiers sensibles

### Docker
- âœ… Non-root user
- âœ… No new privileges
- âœ… Capability dropping
- âœ… Read-only root filesystem option
- âœ… Health checks
- âœ… Resource limits

### Systemd
- âœ… Private tmp
- âœ… Protect system
- âœ… Protect home
- âœ… No new privileges
- âœ… Restrict namespaces
- âœ… Lock personality

---

## ðŸ“Š Architecture RecommandÃ©e

```
Internet
  â†“
Firewall (port 80, 443)
  â†“
Nginx (Load Balancer + WAF)
  â†“
Node.js App (Ã—3 instances)
  â†“
PostgreSQL (Master/Replica)
  â†“
Backups (Encrypted, Off-site)
```

---

## ðŸ”— IntÃ©gration avec Guides

- **Pour Nginx:** Consulter [../02_GUIDES/DEPLOYMENT_SECURITY.md](../02_GUIDES/DEPLOYMENT_SECURITY.md)
- **Pour Docker:** Consulter [../02_GUIDES/DEPLOYMENT_SECURITY.md](../02_GUIDES/DEPLOYMENT_SECURITY.md)
- **Pour systemd:** Consulter [../02_GUIDES/DEPLOYMENT_SECURITY.md](../02_GUIDES/DEPLOYMENT_SECURITY.md)

---

## ðŸ’¡ Support

**Nginx questions?** Consulter [../02_GUIDES/DEPLOYMENT_SECURITY.md](../02_GUIDES/DEPLOYMENT_SECURITY.md) section Nginx

**Docker questions?** Consulter [../02_GUIDES/DEPLOYMENT_SECURITY.md](../02_GUIDES/DEPLOYMENT_SECURITY.md) section Docker

**SSL issues?** Utiliser certbot: `certbot certonly --nginx -d app.example.com`

---

**AprÃ¨s setup:** Valider avec [../04_SCRIPTS/test-security.sh](../04_SCRIPTS/test-security.sh)

