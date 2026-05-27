# Guide de mise en place - Version Démo démo.ao-link.fr

## Prérequis
- Serveur VPS avec nginx et PM2 déjà configurés pour ao-link.fr
- Accès DNS pour créer un sous-domaine
- Accès root au serveur

---

## ÉTAPE 1 : Configuration DNS

1. Se connecter au panneau DNS (OVH, Cloudflare, etc.)
2. Créer un enregistrement CNAME :
   - **Nom** : `démo`
   - **Cible** : `ao-link.fr`
3. Attendre la propagation DNS (quelques minutes à 24h)

---

## ÉTAPE 2 : Préparer les variables d'environnement

1. Se connecter au serveur VPS :
   ```bash
   ssh user@ao-link.fr
   ```

2. Créer le fichier de configuration démo :
   ```bash
   cd /home/tao/TAO/TAO_V1/server
   cp .env .env.démo
   ```

3. Modifier `.env.démo` :
   ```bash
   nano .env.démo
   ```

4. Modifier ou ajouter ces variables :
   ```
   DEMO_MODE=true
   BETA_ACCESS_MODE=true
   DEMO_USER_EMAIL=démo@ao-link.fr
   DEMO_USER_PASSWORD=DemoAoLink2026!
   ALLOWED_ORIGINS=https://démo.ao-link.fr,https://ao-link.fr
   HTTPS_PROXY=true
   ```

   Quand `BETA_ACCESS_MODE=true` ou `DEMO_MODE=true`, la page `/login` pre-remplit le compte beta et masque la creation de compte. L'API `/api/auth/register` refuse aussi les inscriptions publiques. Si `DEMO_USER_PASSWORD` n'est pas defini en mode démo, l'application utilisé `DemoAoLink2026!`.

---

## ÉTAPE 3 : Adapter le code de l'application

Le dépôt contient déjà le support du mode démo :

- `server/src/app/middleware/démo-mode.js` bloque les requêtes `DELETE /api/...` quand `DEMO_MODE=true`
- `server/src/app/server.js` active ce middleware avant les routes API
- `server/ecosystem.config.cjs` définit un environnement PM2 `démo` qui charge `.env.démo`

À vérifier après déploiement :

- Les actions de lecture restent disponibles
- Les suppressions API renvoient une erreur `403`
- Le log de démarrage contient `Mode démo active`

---

## ÉTAPE 4 : Configurer nginx pour le sous-domaine

1. Éditer la configuration nginx :
   ```bash
   sudo nano /etc/nginx/sites-available/tao
   ```

2. Ajouter un nouveau bloc server pour le sous-domaine :

```nginx
# HTTP - Redirection vers HTTPS
server {
    listen 80;
    server_name démo.ao-link.fr;
    return 301 https://$host$request_uri;
}

# HTTPS - Proxy vers l'application
server {
    listen 443 ssl;
    server_name démo.ao-link.fr;

    ssl_certificate     /etc/letsencrypt/live/ao-link.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ao-link.fr/privkey.pem;

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

3. Tester et recharger nginx :
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

---

## ÉTAPE 5 : Créer un compte utilisateur démo

1. Definir `DEMO_USER_EMAIL` et `DEMO_USER_PASSWORD` dans `.env.démo`, ou conserver les valeurs démo par défaut.
2. Le serveur crée ou met a jour automatiquement ce compte au démarrage quand le mode beta/démo est actif.
3. Pour charger aussi les Données démo, lancer :
   ```bash
   cd /home/tao/TAO/TAO_V1/server
   npm run démo:seed
   ```
4. Le compte sera vérifié automatiquement et disponible directement sur `/login`.

---

## ÉTAPE 6 : Déployer la version démo

1. Pousser les modifications sur le serveur :
   ```bash
   cd /home/tao/TAO/TAO_V1
   git pull
   cd server
   npm ci --omit=dev
   ```

2. Redémarrer l'application avec les variables démo :
   ```bash
   pm2 startOrRestart ecosystem.config.cjs --only tao-app --env démo --update-env
   pm2 save
   ```

3. Vérifier le statut :
   ```bash
   pm2 logs tao-app
   ```

---

## ÉTAPE 7 : Vérifier le fonctionnement

1. Ouvrir https://démo.ao-link.fr dans un navigateur
2. Vérifier que le message `Mode démo active` apparaît dans les logs
3. Tester la connexion avec le compte démo
4. Vérifier que les actions bloquées renvoient une erreur 403

---

## ÉTAPE 8 : (Optionnel) Réinitialisation automatique des données

Pour réinitialiser les données démo chaque nuit, créer un script cron :

1. Créer le script de réinitialisation :
   ```bash
   nano /home/tao/TAO/TAO_V1/server/reset-démo.sh
   ```

   ```bash
   #!/bin/bash
   # Script de réinitialisation des données démo
   cd /home/tao/TAO/TAO_V1/server
   node reset-migration.js
   ```

2. Ajouter au cron (une fois par jour à 3h du matin) :
   ```bash
   crontab -e
   ```

   Ajouter :
   ```
   0 3 * * * /home/tao/TAO/TAO_V1/server/reset-démo.sh >> /var/log/reset-démo.log 2>&1
   ```

---

## Résumé des commandes rapides

```bash
# Connexion serveur
ssh user@ao-link.fr

# Configuration
cd /home/tao/TAO/TAO_V1/server
cp .env .env.démo
nano .env.démo  # Ajouter DEMO_MODE=true

# Déploiement
git pull
cd server
npm ci --omit=dev
pm2 startOrRestart ecosystem.config.cjs --only tao-app --env démo --update-env
pm2 save

# Vérification
pm2 logs tao-app
curl -I https://démo.ao-link.fr
```

---

## Dépannage

| Problème | Solution |
|----------|----------|
| Erreur 403 CORS | Vérifier que `démo.ao-link.fr` est dans `ALLOWED_ORIGINS` |
| Page blanche | Vérifier les logs : `pm2 logs tao-app` |
| Certificat SSL manquant | Lancer `sudo certbot --nginx -d démo.ao-link.fr` |
| Le mode démo ne s'active pas | Vérifier que `DEMO_MODE=true` est dans `.env.démo` |
