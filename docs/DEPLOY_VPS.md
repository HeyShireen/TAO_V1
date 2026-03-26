# Guide de déploiement webhook — TAO sur VPS

## Architecture

```
GitHub push → webhook GitHub → nginx (HTTPS) → webhook.js:9000 → deploy.sh → pm2 reload
```

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

## 2. Générer le secret webhook

```bash
# Sur le VPS, générer un secret fort
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# → Copier cette valeur, vous en aurez besoin dans les étapes 3 et 4
```

---

## 3. Configurer les variables d'environnement du webhook

Créer `/var/www/tao/server/.env.webhook` :

```env
WEBHOOK_SECRET=votre_secret_généré_ci-dessus
WEBHOOK_PORT=9000
WEBHOOK_BRANCH=main
DEPLOY_SCRIPT=/var/www/tao/server/deploy.sh
```

Puis sourcer ce fichier au démarrage PM2 (dans ecosystem.config.cjs, remplacer `WEBHOOK_SECRET: ''`
par votre secret, ou utiliser un gestionnaire de secrets).

---

## 4. Rendre deploy.sh exécutable

```bash
chmod +x /var/www/tao/server/deploy.sh

# Tester manuellement une fois
bash /var/www/tao/server/deploy.sh
```

---

## 5. Démarrer avec PM2

```bash
cd /var/www/tao/server
pm2 start ecosystem.config.cjs

# Sauvegarder pour redémarrage automatique au boot
pm2 save
pm2 startup   # Suivre la commande affichée
```

---

## 6. Configurer nginx comme reverse proxy

Modifier votre vhost nginx (ex. `/etc/nginx/sites-available/tao`) :

```nginx
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
        proxy_cache_bypass $http_upgrade;
    }

    # Endpoint webhook (exposé publiquement pour GitHub)
    location /deploy {
        proxy_pass         http://127.0.0.1:9000/deploy;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Hub-Signature-256 $http_x_hub_signature_256;
    }

    location /webhook-health {
        proxy_pass http://127.0.0.1:9000/health;
    }
}
```

```bash
nginx -t && systemctl reload nginx
```

---

## 7. Configurer le webhook sur GitHub

1. Aller sur `github.com/VOTRE_ORG/VOTRE_REPO` → **Settings** → **Webhooks** → **Add webhook**
2. **Payload URL** : `https://votredomaine.com/deploy`
3. **Content type** : `application/json`
4. **Secret** : le secret généré à l'étape 2
5. **Which events** : sélectionner **Just the push event**
6. **Active** : coché ✓
7. Cliquer **Add webhook**

---

## 8. Vérifier que tout fonctionne

```bash
# Vérifier les processus PM2
pm2 list

# Suivre les logs en temps réel
pm2 logs tao-webhook
pm2 logs tao-app

# Tester le health check
curl https://votredomaine.com/webhook-health

# Suivre le log de déploiement
tail -f /var/log/tao-deploy.log
```

---

## Dépannage courant

| Problème | Solution |
|---|---|
| `401 Signature invalide` | Le `WEBHOOK_SECRET` ne correspond pas à celui configuré sur GitHub |
| `Branche ignorée` | Vérifier que `WEBHOOK_BRANCH=main` correspond à votre branche par défaut |
| `pm2 reload` échoue | S'assurer que le nom `tao-app` correspond dans `ecosystem.config.cjs` |
| `deploy.sh: Permission denied` | Lancer `chmod +x deploy.sh` |
| nginx `502 Bad Gateway` | Vérifier que `webhook.js` tourne avec `pm2 list` |
