# Guide de déploiement — TAO sur VPS

## Architecture

```
Internet → nginx (443 HTTPS + Let's Encrypt) → Node.js :3000 (HTTP interne, PM2)
```

Le déploiement se fait manuellement via SSH : `git pull` + `pm2 reload`.

---

## 1. Préparer le VPS

```bash
# Installer Node.js v22+ (via nvm recommandé)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 22
nvm use 22

# Installer PM2
npm install -g pm2

# Créer le dossier de l'application
mkdir -p /var/www/tao

# Cloner le dépôt
cd /var/www/tao
git clone https://github.com/VOTRE_ORG/VOTRE_REPO.git .

# Installer les dépendances
cd server
npm ci --omit=dev

# Créer le fichier .env de production
cp .env.example .env
nano .env   # Compléter toutes les variables
```

---

## 2. Démarrer avec PM2

```bash
cd /var/www/tao/server
pm2 start ecosystem.config.cjs

# Sauvegarder pour redémarrage automatique au boot
pm2 save
pm2 startup   # Suivre la commande affichée
```

---

## 3. Configurer nginx comme reverse proxy

Créer ou modifier votre vhost nginx (ex. `/etc/nginx/sites-available/tao`) :

```nginx
server {
    listen 80;
    server_name votredomaine.com;
    # Rediriger tout le HTTP vers HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name votredomaine.com;

    # Certificat Let's Encrypt (certbot)
    ssl_certificate     /etc/letsencrypt/live/votredomaine.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/votredomaine.com/privkey.pem;

    # Application principale
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Activer le site et recharger nginx
ln -s /etc/nginx/sites-available/tao /etc/nginx/sites-enabled/tao
nginx -t && systemctl reload nginx
```

---

## 4. Obtenir un certificat SSL (Let's Encrypt)

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d votredomaine.com
# Certbot modifie automatiquement la config nginx et configure le renouvellement automatique
```

---

## 5. Variables d'environnement requises

Dans `/var/www/tao/server/.env`, s'assurer que les variables suivantes sont définies :

```env
NODE_ENV=production
HTTPS_PROXY=true          # Indique à l'app qu'elle est derrière nginx HTTPS → active HSTS
ALLOWED_ORIGINS=https://votredomaine.com
JWT_SECRET=...            # Secret JWT fort (32+ caractères)
DATABASE_URL=...
```

---

## 6. Déployer une mise à jour (manuellement via SSH)

```bash
cd /var/www/tao

# Récupérer le code
git pull origin main

# Mettre à jour les dépendances si nécessaire
cd server
npm ci --omit=dev

# Recharger l'application sans interruption
pm2 reload tao-app --update-env
```

---

## 7. Vérifier que tout fonctionne

```bash
# Vérifier les processus PM2
pm2 list

# Suivre les logs en temps réel
pm2 logs tao-app

# Tester le health check
curl https://votredomaine.com/api/healthz
```

---

## Dépannage courant

| Problème | Solution |
|---|---|
| Styles cassés / redirect HTTPS en boucle | Vérifier que `HTTPS_PROXY=true` est dans `.env` et que nginx proxy vers `:3000` |
| `pm2 reload` échoue | S'assurer que le nom `tao-app` correspond dans `ecosystem.config.cjs` |
| nginx `502 Bad Gateway` | Vérifier que `tao-app` tourne avec `pm2 list` |
| Certificat SSL expiré | `certbot renew` (normalement automatique via cron) |
