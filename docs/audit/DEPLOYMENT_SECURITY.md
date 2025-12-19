# ⚙️ CONFIGURATION NGINX - HARDENING PRODUCTION

## Fichier: `/etc/nginx/sites-available/tao-app`

```nginx
# Upstream Node.js
upstream tao_backend {
    server localhost:4000;
    keepalive 32;
}

# Redirection HTTP -> HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name app.example.com www.example.com;
    
    # ✅ Redirection forcée HTTPS
    return 301 https://$server_name$request_uri;
}

# HTTPS Configuration (Certbot + Let's Encrypt)
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name app.example.com www.example.com;

    # ====== SSL CONFIGURATION ======
    # Générer avec Let's Encrypt: certbot certonly --nginx
    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;
    
    # ✅ Ciphers sécurisés (Mozilla Modern Config)
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256';
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # ✅ HSTS Header
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    
    # ====== SECURITY HEADERS ======
    # CSP
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data: https:; object-src 'none';" always;
    
    # X-Frame-Options
    add_header X-Frame-Options "DENY" always;
    
    # X-Content-Type-Options
    add_header X-Content-Type-Options "nosniff" always;
    
    # X-XSS-Protection
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Referrer-Policy
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # Remove server header
    server_tokens off;

    # ====== RATE LIMITING ======
    limit_req_zone $binary_remote_addr zone=general:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/m;
    limit_req_zone $binary_remote_addr zone=export:10m rate=3r/m;
    limit_conn_zone $binary_remote_addr zone=addr:10m;
    
    # ====== LOGGING ======
    access_log /var/log/nginx/tao-access.log;
    error_log /var/log/nginx/tao-error.log;
    
    # ====== PROXY TO NODE ======
    location / {
        limit_req zone=general burst=20 nodelay;
        limit_conn addr 10;
        
        proxy_pass http://tao_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeout
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # ====== AUTH ENDPOINTS - RATE LIMIT STRICT ======
    location ~ ^/api/auth/(login|register|forgot-password|reset-password)$ {
        limit_req zone=auth burst=3 nodelay;
        
        proxy_pass http://tao_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # ====== EXPORT ENDPOINTS - RATE LIMIT ======
    location ~ ^/api/exports/ {
        limit_req zone=export burst=1 nodelay;
        
        proxy_pass http://tao_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeout pour exports (fichiers volumineux)
        proxy_read_timeout 300s;
    }
    
    # ====== BLOCK COMMON ATTACKS ======
    location ~ /\. {
        deny all;
    }
    
    location ~ ~$ {
        deny all;
    }
    
    # Deny access to backup files
    location ~ \.sql$ {
        deny all;
    }
    
    # Deny access to env files
    location ~ \.env {
        deny all;
    }
}

# Redirect www to non-www
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name www.example.com;
    
    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;
    
    return 301 https://app.example.com$request_uri;
}
```

---

## Activation

```bash
# Vérifier la syntaxe
sudo nginx -t

# Activer le site
sudo ln -s /etc/nginx/sites-available/tao-app /etc/nginx/sites-enabled/

# Recharger Nginx
sudo systemctl reload nginx

# Vérifier le statut
sudo systemctl status nginx
```

---

## 🔍 Vérification SSL/TLS

```bash
# Test SSL
openssl s_client -connect app.example.com:443

# Vérifier certificat
openssl x509 -in /etc/letsencrypt/live/app.example.com/fullchain.pem -text -noout

# Scan de sécurité (SSL Labs)
# Aller sur: https://www.ssllabs.com/ssltest/analyze.html?d=app.example.com
```

---

## 📜 Certificat Auto-Renouvellement Let's Encrypt

```bash
# Installer Certbot
sudo apt-get install certbot python3-certbot-nginx

# Créer le certificat
sudo certbot certonly --nginx -d app.example.com -d www.example.com

# Auto-renewal (Certbot gère automatiquement)
sudo systemctl status certbot.timer

# Tester renouvellement
sudo certbot renew --dry-run
```

---

# ⚙️ CONFIGURATION DOCKER - HARDENING PRODUCTION

## Dockerfile

```dockerfile
FROM node:20-alpine

# ✅ Non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

WORKDIR /app

# Copier package*.json
COPY package*.json ./

# Installer dépendances en production
RUN npm ci --only=production && npm cache clean --force

# Copier source code
COPY --chown=nodejs:nodejs ./server/src ./src
COPY --chown=nodejs:nodejs ./server/public ./public

# Changer utilisateur
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/api/healthz', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Expose port
EXPOSE 4000

# Run app
CMD ["node", "src/server.js"]
```

## docker-compose.yml

```yaml
version: '3.9'

services:
  app:
    build: .
    container_name: tao-app
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: 4000
      JWT_SECRET: ${JWT_SECRET}
      DATABASE_URL: ${DATABASE_URL}
      ALLOWED_ORIGINS: ${ALLOWED_ORIGINS}
      EMAIL_HOST: ${EMAIL_HOST}
      EMAIL_PORT: ${EMAIL_PORT}
      EMAIL_USER: ${EMAIL_USER}
      EMAIL_PASS: ${EMAIL_PASS}
    ports:
      - "4000:4000"
    depends_on:
      - db
    networks:
      - tao-network
    volumes:
      - /var/log/tao:/app/logs
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE

  db:
    image: postgres:15-alpine
    container_name: tao-db
    restart: unless-stopped
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: tao_prod
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - tao-network
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL

  nginx:
    image: nginx:alpine
    container_name: tao-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    networks:
      - tao-network
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE

volumes:
  postgres_data:

networks:
  tao-network:
    driver: bridge
```

---

# 🔐 SYSTEMD SERVICE (Sans Docker)

## Fichier: `/etc/systemd/system/tao-app.service`

```ini
[Unit]
Description=TAO Application Server
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=tao-user
WorkingDirectory=/opt/tao/server

# ✅ Sécurité
PrivateTmp=yes
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/opt/tao/server/logs
ProtectClock=yes
ProtectHostname=yes
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes

# Environment
EnvironmentFile=/opt/tao/.env
Environment="NODE_ENV=production"
Environment="NODE_OPTIONS=--max-old-space-size=512"

ExecStart=/usr/bin/node src/server.js
ExecReload=/bin/kill -HUP $MAINPID
KillMode=process
Restart=on-failure
RestartSec=10s

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tao-app

[Install]
WantedBy=multi-user.target
```

## Commandes

```bash
# Créer utilisateur
sudo useradd -r -s /bin/false tao-user

# Activer service
sudo systemctl daemon-reload
sudo systemctl enable tao-app.service
sudo systemctl start tao-app.service

# Vérifier statut
sudo systemctl status tao-app.service
sudo journalctl -u tao-app.service -f
```

---

# 📊 MONITORING & ALERTES

## Prometheus + Grafana

### prometheus.yml

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'tao-app'
    static_configs:
      - targets: ['localhost:4000']
```

### Alertes Critiques

```yaml
# alerts.yml
groups:
  - name: tao-security
    rules:
      - alert: AuthenticationFailures
        expr: rate(auth_failures_total[5m]) > 10
        annotations:
          summary: "Nombreuses tentatives de connexion échouées"
      
      - alert: UnusualAPIActivity
        expr: rate(http_requests_total[5m]) > 1000
        annotations:
          summary: "Activité API anormale détectée"
      
      - alert: SQLErrorRate
        expr: rate(sql_errors_total[5m]) > 5
        annotations:
          summary: "Taux d'erreur SQL élevé"
```

---

# 🧪 Tests Automatisés de Sécurité

## GitHub Actions - Security Scan

```yaml
# .github/workflows/security.yml
name: Security Scan

on: [push, pull_request]

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Run npm audit
        run: npm audit
      
      - name: OWASP Dependency Check
        uses: dependency-check/Dependency-Check_Action@main
        with:
          path: 'server'
          format: 'JSON'
      
      - name: Snyk Security Scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
```

