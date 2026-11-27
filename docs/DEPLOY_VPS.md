# Guide de déploiement — TAO sur VPS

> Mis à jour le 25 novembre 2026 pour l'architecture multi-tenant V2.0.0.
> Les versions antérieures de ce guide ne mentionnaient ni les deux rôles
> PostgreSQL, ni l'exécution explicite des migrations : ces deux points
> sont désormais **bloquants au démarrage**.

## Architecture

```
Internet → nginx (443 HTTPS + Let's Encrypt) → Node.js :3000 (HTTP interne, PM2)
```

Le déploiement principal documenté ici concerne l'application web servie par `server/src/app/server.js`. La configuration PM2 du dépôt déclare aussi un processus `tao-webhook` optionnel pour automatiser les mises à jour, en plus du processus principal `tao-app`.

Le déploiement manuel reste : `git pull` + migrations + `pm2 reload`.

---

## 0. Deux rôles PostgreSQL — à lire avant tout

Depuis la migration 045, toutes les tables métier sont protégées par `FORCE ROW LEVEL SECURITY`. L'application **refuse de démarrer** si son rôle PostgreSQL est propriétaire des tables, `SUPERUSER` ou `BYPASSRLS` (contrôle `assertRuntimeRoleSafety()` dans `server/src/app/db.js`).

Il faut donc **deux credentials distincts** :

| Usage | Rôle | Variable |
|---|---|---|
| Application en production | `aolink_runtime` — non propriétaire, `NOSUPERUSER`, `NOBYPASSRLS` | `DATABASE_URL` |
| Migrations uniquement | propriétaire du schéma | `MIGRATION_DATABASE_URL` |

**Le service web ne doit jamais recevoir `MIGRATION_DATABASE_URL`.**

Pour préparer ou vérifier le rôle runtime :

```bash
cd /home/tao/TAO/TAO_V1/server
npm run tenant:validate-app-role   # contrôle le rôle et la RLS
npm run tenant:harden-app-role     # applique les restrictions si besoin
```

Voir [MULTI_TENANT.md](MULTI_TENANT.md) pour le détail.

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
mkdir -p /home/tao/TAO/TAO_V1

# Cloner le dépôt
cd /home/tao/TAO/TAO_V1
git clone https://github.com/HeyShireen/TAO_V1.git .

# Installer les dépendances
cd server
npm ci --omit=dev

# Créer le fichier .env de production
cp .env.example .env
nano .env   # Compléter toutes les variables (cf. section 6)
```

### Java, pour l'import PDF

L'import PDF tente d'abord une extraction de tableaux avec **Tabula** (`server/tools/tabula/tabula.jar`, versionné dans le dépôt), puis retombe sur un parseur JavaScript moins précis. Tabula a besoin d'un runtime Java :

```bash
sudo apt install default-jre-headless
java -version   # doit répondre
```

Sans Java, l'import PDF reste fonctionnel mais dégradé (extraction par découpage de texte, moins fiable sur les tableaux complexes). C'est l'un des avantages du VPS sur un hébergement Node pur, qui ne peut pas fournir Java.

---

## 2. Appliquer les migrations

**À faire avant le premier démarrage, puis à chaque déploiement qui contient de nouvelles migrations.** L'application n'exécute aucun DDL elle-même, et `assertSchemaSanity()` **arrête le process** (`exit(1)`) si des colonnes attendues manquent.

```bash
cd /home/tao/TAO/TAO_V1/server
MIGRATION_DATABASE_URL="postgres://proprietaire:...@host/base" npm run db:migrate
```

Chaque fichier SQL s'exécute dans une transaction et est enregistré dans la table `migrations`. Pour une cible distante, les garde-fous `ALLOW_REMOTE_MIGRATION`, `MIGRATION_CONFIRM_TARGET` et `MIGRATION_BACKUP_REFERENCE` sont exigés — voir [MAINTENANCE.md](MAINTENANCE.md).

> ⚠️ **Sauvegarde fraîche et vérifiée avant toute migration.** Un incident de juillet 2026 a montré le scénario à éviter : du code déployé **sans** ses migrations produit, à chaque action, des `DELETE` suivis d'une erreur SQL — soit une perte de données à chaque utilisation. Vérifier donc toujours que les nouveaux fichiers de migration sont bien partis dans le commit déployé.

---

## 3. Démarrer avec PM2

```bash
cd /home/tao/TAO/TAO_V1/server
pm2 start ecosystem.config.cjs

# Sauvegarder pour redémarrage automatique au boot
pm2 save
pm2 startup   # Suivre la commande affichée
```

Le fichier `ecosystem.config.cjs` déclare par défaut :
- `tao-app` sur le port `3000`
- `tao-webhook` sur le port `9000` (script `server/webhook.js`, qui appelle `server/deploy.sh`)

Si vous n'utilisez pas le webhook de déploiement, vous pouvez ne lancer que `tao-app`.

> Note : `deploy.sh` fait `git fetch --all` puis `git reset --hard origin/main`. Toute modification locale commitée ou non sur le VPS est donc **écrasée** à chaque déploiement automatique. Les fichiers non suivis par git (dont `.env`) sont en revanche préservés.

---

## 4. Configurer nginx comme reverse proxy

Créer ou modifier votre vhost nginx (ex. `/etc/nginx/sites-available/tao`) :

```nginx
server {
    listen 80;
    server_name ao-link.fr www.ao-link.fr;
    # Rediriger tout le HTTP vers HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name ao-link.fr www.ao-link.fr;

    # Certificat Let's Encrypt (certbot)
    ssl_certificate     /etc/letsencrypt/live/ao-link.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ao-link.fr/privkey.pem;

    # Imports DPGF : la limite applicative est de 10 Mo par fichier
    client_max_body_size 20M;

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
sudo nginx -t && systemctl reload nginx
```

---

## 5. Obtenir un certificat SSL (Let's Encrypt)

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d ao-link.fr -d www.ao-link.fr
# Certbot modifie automatiquement la config nginx et configure le renouvellement
```

---

## 6. Variables d'environnement requises

Dans `/home/tao/TAO/TAO_V1/server/.env` :

```env
NODE_ENV=production
HTTPS_PROXY=true          # Derrière nginx HTTPS → active HSTS
ALLOWED_ORIGINS=https://ao-link.fr
APP_URL=https://ao-link.fr

# Critiques : le démarrage échoue sans elles (security-init.js)
JWT_SECRET=...            # 32 caractères minimum, ni vide ni "change-me"
DATABASE_URL=...          # rôle aolink_runtime UNIQUEMENT (cf. section 0)

# Administration plateforme
PLATFORM_ADMIN_EMAIL=...

# Recommandé : révocation JWT et rate limiting
REDIS_URL=...

# Email (SMTP générique : Brevo, Gmail, SendGrid...)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=...        # identifiant de connexion SMTP
EMAIL_PASS=...        # mot de passe applicatif ou clé SMTP
EMAIL_FROM=           # adresse d'expédition, ex. AO Link <contact@ao-link.fr>
```

`EMAIL_FROM` est **obligatoire dès que `EMAIL_USER` n'est pas une adresse email
réelle**, ce qui est le cas de Brevo : son identifiant SMTP ressemble à
`9xxxxx@smtp-brevo.com` et serait refusé comme expéditeur. Pour Brevo, poser :

```env
EMAIL_HOST=smtp-relay.brevo.com
EMAIL_PORT=587
EMAIL_USER=<identifiant SMTP Brevo>
EMAIL_PASS=<clé SMTP Brevo>
EMAIL_FROM=AO Link <contact@votredomaine.fr>
```

Le domaine de `EMAIL_FROM` doit être validé dans Brevo (SPF/DKIM), sans quoi les
messages partent en spam. Aucune modification de code n'est nécessaire : tout
l'envoi passe par `server/src/app/utils/email.js`.

`DB_SSL=true` si le serveur PostgreSQL impose TLS.

Environnement de démonstration, uniquement si un hôte DEMO est servi : `DEMO_HOST`, `DEMO_USER_EMAIL`, `DEMO_USER_PASSWORD`.

**Ne jamais définir `MIGRATION_DATABASE_URL` dans ce fichier** : il est réservé aux commandes de migration lancées à la main.

---

## 7. Déployer une mise à jour (manuellement via SSH)

```bash
cd /home/tao/TAO/TAO_V1

# 1. Récupérer le code
git pull origin main

# 2. Mettre à jour les dépendances si nécessaire
cd server
npm ci --omit=dev

# 3. Appliquer les migrations SI le déploiement en contient
#    (sauvegarde vérifiée au préalable)
MIGRATION_DATABASE_URL="..." npm run db:migrate

# 4. Recharger l'application sans interruption
pm2 reload tao-app --update-env
```

L'ordre importe : **migrations avant rechargement**. Du code neuf sur un schéma ancien est le scénario destructeur décrit en section 2.

Si le webhook est utilisé, recharger aussi :

```bash
pm2 reload tao-webhook --update-env
```

---

## 8. Vérifier que tout fonctionne

```bash
# Processus PM2
pm2 list

# Logs en temps réel
pm2 logs tao-app

# Health check applicatif
curl https://ao-link.fr/api/healthz

# Rôle PostgreSQL et RLS
cd /home/tao/TAO/TAO_V1/server
npm run tenant:validate-app-role

# Intégrité et volumes par tenant (lecture seule)
npm run tenant:audit
```

Vérifier que la réponse `healthz` indique bien `db: true`. Si `redis: false`, l'application fonctionne mais la révocation de JWT et le rate limiting sont dégradés.

Enfin, tester une connexion et **un export Excel et un export Word dans chaque tenant** : c'est le contrôle de non-régression le plus large disponible.

---

## Dépannage courant

| Problème | Solution |
|---|---|
| L'app s'arrête au démarrage avec une erreur de schéma | Migrations non appliquées : lancer `npm run db:migrate` (section 2) |
| L'app refuse de démarrer en citant le rôle PostgreSQL | `DATABASE_URL` utilise un rôle propriétaire, `SUPERUSER` ou `BYPASSRLS` : voir section 0 |
| Une requête métier ne renvoie aucune ligne | Contexte tenant absent (comportement *fail-closed* de la RLS), pas forcément une absence de données |
| Import DPGF qui perd le contexte tenant | Toute route d'upload doit passer par `preserveDbContext()` autour de multer |
| Import PDF imprécis sur les tableaux | Java absent : `sudo apt install default-jre-headless` (section 1) |
| Styles cassés / redirect HTTPS en boucle | Vérifier `HTTPS_PROXY=true` dans `.env` et que nginx proxy vers `:3000` |
| `pm2 reload` échoue | Vérifier que le nom `tao-app` correspond à `ecosystem.config.cjs` |
| nginx `502 Bad Gateway` | Vérifier que `tao-app` tourne (`pm2 list`) |
| `413 Request Entity Too Large` à l'import | Augmenter `client_max_body_size` dans nginx (section 4) |
| Certificat SSL expiré | `certbot renew` (normalement automatique via cron) |
